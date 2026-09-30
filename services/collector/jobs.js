/**
 * 采集任务：行情快照、日 K、估值、温度、基金净值、历史回补、缺口补齐、导入、备份
 *
 * 所有历史写入都以（标的、日期）为主键 UPSERT，任何任务都可安全重跑。
 * 外部请求串行执行并带随机间隔，避免突发流量。
 */
const fs = require('fs');
const path = require('path');
const paths = require('../db/paths');
const repo = require('../db/repo');
const sources = require('./sources');
const { normalizeMarket, exchangeDate, zonedParts, MARKET_TZ } = require('../marketHours');

const df = require('../dataFetcher');
const { fetchAllStockData } = require('../stockFetcher');
const { fetchAllETFData } = require('../etfFetcher');
const { fetchAllActiveFundData } = require('../fundFetcher');
const { fetchDailyEval } = require('../dailyEval');

const jitter = (min, max) => sources.sleep(min + Math.random() * (max - min));
const bjToday = () => exchangeDate('CN');

function addDays(dateStr, n) {
    const d = new Date(`${dateStr}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
}

function daysBetween(a, b) {
    return Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);
}

/** 蛋卷 "MM-DD" → YYYY-MM-DD（跨年时取上一年） */
function mmddToDate(mmdd, today = bjToday()) {
    const m = String(mmdd || '').match(/^(\d{1,2})-(\d{1,2})$/);
    if (!m) return /^\d{4}-\d{2}-\d{2}/.test(String(mmdd)) ? String(mmdd).slice(0, 10) : null;
    let year = parseInt(today.slice(0, 4), 10);
    let d = `${year}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
    if (d > today) { year -= 1; d = `${year}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`; }
    return d;
}

/** 知有行 "2026年9月29日 20:00" → 2026-09-29 */
function parseYzyxDate(s) {
    const m = String(s || '').match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
    return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : null;
}

function instMarket(inst) {
    if (inst.type === 'etf' || inst.type === 'fund') return 'CN';
    return normalizeMarket(inst.market);
}

function quoteSignature(list, priceKey = 'price', pctKey = 'changePercent') {
    return JSON.stringify((list || []).map(i => [i.code, i[priceKey], i[pctKey]]));
}

function createJobs({ store, log = console }) {
    const db = store.db;
    const poolMap = df.POOL_MAP || {};

    const runLogged = async (job, market, fn) => {
        const id = repo.startRun(db, job, market);
        store.markDirty();
        try {
            const r = (await fn()) || {};
            repo.finishRun(db, id, { status: r.status || 'ok', ok: r.ok || 0, fail: r.fail || 0, error: r.error || null });
            return r;
        } catch (err) {
            repo.finishRun(db, id, { status: 'error', error: err.message });
            log.warn(`[采集] 任务 ${job}${market ? '(' + market + ')' : ''} 失败: ${err.message}`);
            return { status: 'error', error: err.message };
        }
    };

    const activeOf = (type) => repo.listInstruments(db, { type, status: 'active' });
    const collectable = () => repo.listInstruments(db, { status: ['active', 'hidden'] });

    function watchlistMarkets(type) {
        const items = repo.readWatchlistRaw(type) || [];
        if (type === 'etf' || type === 'fund') return ['CN'];
        const set = new Set(items.map(i => normalizeMarket(i.market)));
        return set.size ? [...set] : ['CN'];
    }

    // ───────────────────────── 盘中行情 ─────────────────────────

    /**
     * 实时行情缺价格的指数（东财不可达且腾讯无对应代码，如中证 931787），
     * 用历史库最新一根日 K 补价格并标注，避免页面显示"暂无行情"
     */
    function fillQuoteFromDb(q) {
        if (!q || q.price > 0) return false;
        const inst = repo.findByFullCode(db, 'index', q.code);
        if (!inst) return false;
        const rows = repo.all(db, 'SELECT trade_date AS date, close, change_pct, change_amt FROM kline_daily WHERE instrument_id = ? ORDER BY trade_date DESC LIMIT 2', [inst.id]);
        if (!rows.length || !(rows[0].close > 0)) return false;
        const [last, prev] = rows;
        q.price = last.close;
        q.prevClose = prev ? prev.close : q.prevClose;
        q.changePercent = last.change_pct ?? (prev && prev.close ? +(((last.close - prev.close) / prev.close) * 100).toFixed(2) : 0);
        q.changeAmount = last.change_amt ?? (prev ? +(last.close - prev.close).toFixed(2) : 0);
        q.staleNote = `实时行情暂不可用，显示 ${last.date} 收盘数据`;
        q.quoteSource = 'db-close';
        q.quoteFetchedAt = `${last.date}T15:00:00+08:00`;
        return true;
    }

    async function runIndexQuotes() {
        const data = await df.fetchIndexQuotesForWatchlist();
        const list = (data && data.indices) || [];
        list.forEach(fillQuoteFromDb);
        if ((repo.readWatchlistRaw('index') || []).length > 0 && !list.some(i => i.price > 0)) {
            throw new Error('指数行情全部缺失');
        }
        store.setSnapshot('index-quotes', data);
        return quoteSignature(list);
    }

    async function runStockQuotes() {
        const data = await fetchAllStockData(true);
        const list = (data && data.stocks) || [];
        if ((repo.readWatchlistRaw('stock') || []).length > 0 && !list.some(i => i.price > 0)) {
            throw new Error('股票行情全部缺失');
        }
        store.setSnapshot('stocks', data);
        return quoteSignature(list);
    }

    async function runEtfQuotes() {
        const data = await fetchAllETFData(true);
        const list = (data && data.etfs) || [];
        if ((repo.readWatchlistRaw('etf') || []).length > 0 && !list.some(i => i.price > 0)) {
            throw new Error('ETF 行情全部缺失');
        }
        store.setSnapshot('etfs', data);
        return quoteSignature(list);
    }

    // ───────────────────────── 重量快照 ─────────────────────────

    /**
     * 快照中 K 线缺失的指数（外部源临时故障、或只有中证/国证官网才有数据），
     * 用历史库的日 K 补齐 historySeries 及其衍生字段（52 周 / 10 年高低、sparkline、动量）
     */
    function fillIndexHistoryFromDb(entry) {
        if (!entry || (Array.isArray(entry.historySeries) && entry.historySeries.length >= 2)) return false;
        const inst = repo.findByFullCode(db, 'index', entry.code);
        if (!inst) return false;
        const rows = repo.all(db, `SELECT trade_date AS date, close, high, low, change_pct AS changePercent, change_amt AS changeAmount, source
            FROM kline_daily WHERE instrument_id = ? ORDER BY trade_date DESC LIMIT 2520`, [inst.id]).reverse();
        if (rows.length < 2) return false;
        const hi = (arr) => Math.max(...arr.map(k => k.high ?? k.close));
        const lo = (arr) => Math.min(...arr.map(k => k.low ?? k.close));
        const last250 = rows.slice(-250);
        entry.historySeries = rows.map(({ source: _s, ...k }) => k);
        entry.high10y = hi(rows);
        entry.low10y = lo(rows);
        entry.high52w = hi(last250);
        entry.low52w = lo(last250);
        entry.sparkData = rows.slice(-30).map(k => k.close);
        if (entry.price == null) entry.price = rows[rows.length - 1].close;
        Object.assign(entry, df.calcMomentumSet(entry.historySeries, entry.price));
        entry.dataSources = entry.dataSources || {};
        entry.dataSources.kline = {
            state: 'fresh-cache', label: '本地历史库', source: `db:${rows[rows.length - 1].source}`,
            usedStaleCache: false, inCooldown: false, fallbackActive: true, specialSource: false, sourceSecid: null,
        };
        entry.dataSources.klinesCount = rows.length;
        return true;
    }

    async function refreshIndicesSnapshot() {
        const codes = (repo.readWatchlistRaw('index') || []).map(i => `${i.code}.${i.market}`);
        const data = await df.fetchAllIndexData(codes, { forceRefreshThermometer: false });
        if (!data || !Array.isArray(data.indices)) throw new Error('指数完整数据为空');
        const filled = [...data.indices, ...(data.dashboardIndices || [])].filter(fillIndexHistoryFromDb).map(e => e.name);
        if (filled.length) log.log(`[采集] 指数快照 K 线缺失，已用历史库补齐：${[...new Set(filled)].join('、')}`);
        store.writeSnap('indices', data);
        store.setStatus('indices', { lastOkAt: new Date().toISOString(), count: data.indices.length });
        return data;
    }

    async function refreshActiveFundsSnapshot({ ingestFull = false } = {}) {
        const data = await fetchAllActiveFundData(true);
        if (!data || !Array.isArray(data.funds)) throw new Error('基金数据为空');
        store.writeSnap('active-funds', data);
        const n = ingestFundNav(data, { full: ingestFull });
        store.setStatus('active-funds', { lastOkAt: new Date().toISOString(), count: data.funds.length, navRows: n });
        return data;
    }

    async function refreshDailyEvalSnapshot() {
        const data = await fetchDailyEval();
        store.setSnapshot('daily-eval', data);
        return data;
    }

    // ───────────────────────── 基金净值 ─────────────────────────

    function navSeriesOf(fund) {
        const t = fund && fund.netWorthTrend;
        if (!t) return [];
        const arr = Array.isArray(t) ? t : (t.all || t['5y'] || t['3y'] || t['1y'] || []);
        return arr.map(p => ({
            date: typeof p.date === 'number' ? new Date(p.date + 8 * 3600e3).toISOString().slice(0, 10) : String(p.date).slice(0, 10),
            nav: p.nav, dailyReturn: p.returnRate ?? null,
        }));
    }

    function ingestFundNav(data, { full = false } = {}) {
        let n = 0;
        for (const f of (data && data.funds) || []) {
            const inst = repo.getInstrument(db, 'fund', String(f.code), '');
            if (!inst) continue;
            let series = navSeriesOf(f);
            if (!full) series = series.slice(-30);
            if (f.latestNav && f.latestNavDate) series.push({ date: f.latestNavDate, nav: f.latestNav, dailyReturn: f.dayChange ?? null });
            n += repo.upsertNav(db, inst.id, series, (f.dataStatus && f.dataStatus.source) || 'eastmoney');
        }
        if (n) store.markDirty();
        return n;
    }

    /** 基金晚间采集：非 QDII 基金都拿到当日净值即完成 */
    async function fundNavJob() {
        return runLogged('fund_nav', 'CN', async () => {
            const data = await refreshActiveFundsSnapshot();
            const today = bjToday();
            const domestic = (data.funds || []).filter(f => !/QDII/i.test(f.name || ''));
            const got = domestic.filter(f => f.latestNavDate === today).length;
            store.saveDb('基金净值');
            return { ok: got, fail: domestic.length - got, done: domestic.length > 0 && got === domestic.length, status: 'ok' };
        });
    }

    // ───────────────────────── 日 K ─────────────────────────

    function cfgOf(inst) {
        return poolMap[`${inst.code}.${inst.market}`] || { name: inst.name, code: inst.code, market: inst.market, secid: inst.secid };
    }

    // 这些源返回的涨跌幅、成交量、成交额是真实值；其他兜底源可能以 0 占位
    const COMPLETE_KLINE_SOURCES = new Set(['eastmoney', 'cnindex', 'csindex']);

    /** 兜底源：0 占位的量额置空，涨跌幅按前收盘价补算 */
    function normalizeKlines(inst, klines, source) {
        if (!klines.length || COMPLETE_KLINE_SOURCES.has(source)) return klines;
        const rows = klines.map(k => ({ ...k }));
        const first = rows[0];
        const prevRow = repo.get(db, 'SELECT close FROM kline_daily WHERE instrument_id = ? AND trade_date < ? ORDER BY trade_date DESC LIMIT 1', [inst.id, first.date]);
        let prev = prevRow ? prevRow.close : null;
        for (const k of rows) {
            if (!k.volume) k.volume = null;
            if (!k.amount) k.amount = null;
            if (prev > 0 && k.close > 0) {
                k.changeAmount = +(k.close - prev).toFixed(4);
                k.changePercent = +(((k.close - prev) / prev) * 100).toFixed(2);
            } else {
                k.changeAmount = null;
                k.changePercent = null;
            }
            prev = k.close;
        }
        return rows;
    }

    /**
     * 同步一个标的的日 K
     * @param {number} limit 条数（东财）；国证按起始日期
     */
    /**
     * 同步一个标的的日 K。按顺序尝试数据源，取第一个返回数据的：
     *   全量：国证 / 中证官网（完整历史）→ 东财 → 腾讯（个股/ETF）→ 现有 failover 链（指数）
     *   增量：国证 → 东财 → 腾讯（个股/ETF）→ 现有 failover 链（指数，收盘后即可用）→ 中证官网（晚间才更新当日）
     */
    async function syncKlines(inst, { limit = 5, full = false } = {}) {
        if (inst.type === 'fund') return { rows: 0, lastDate: null, source: null };
        const last = full ? null : repo.lastDate(db, 'kline_daily', inst.id);
        const since = (fullFrom) => (full || !last ? fullFrom : addDays(last, -7));
        const tenYearsAgo = `${parseInt(bjToday().slice(0, 4), 10) - 10}-01-01`;
        const isIndex = inst.type === 'index';
        const isAShare = (inst.type === 'stock' || inst.type === 'etf') && (inst.market === 'SH' || inst.market === 'SZ');
        const csCode = isIndex ? (inst.cs_code || (inst.market === 'CSI' ? inst.code : null)) : null;

        let failoverSource = null; // 现有 failover 链实际命中的源（tencent / yahoo / 缓存）
        const csindex = csCode ? { name: 'csindex', run: () => sources.fetchCsindexPerf(csCode, since('2000-01-01'), bjToday()) } : null;
        const attempts = [
            inst.kline_source === 'cnindex' && { name: 'cnindex', run: () => sources.fetchCnindexKlines(inst.code, since('2000-01-01')) },
            full && csindex,
            inst.kline_source !== 'cnindex' && inst.secid && { name: 'eastmoney', run: () => df.fetchHistoryKlines(inst.secid, full ? 2520 : limit, [], { timeout: 8000, retries: 1 }) },
            isAShare && { name: 'tencent', run: () => sources.fetchTencentKlines(inst.code, inst.market, since(tenYearsAgo)) },
            isIndex && {
                name: 'failover',
                run: async () => {
                    const r = await df.fetchIndexHistory(cfgOf(inst), { range: '10y' });
                    const k = (r && r.klines) || [];
                    failoverSource = (r && r.status && r.status.source) || 'fallback';
                    return full ? k : k.slice(-Math.max(limit, 5));
                },
            },
            !full && csindex,
        ].filter(Boolean);

        let klines = [];
        let source = null;
        for (const a of attempts) {
            try {
                failoverSource = null;
                klines = (await a.run()) || [];
            } catch (err) {
                klines = [];
            }
            if (klines.length) { source = failoverSource || a.name; break; }
        }
        klines = normalizeKlines(inst, klines || [], source);
        const rows = repo.upsertKlines(db, inst.id, klines, source);
        if (rows) store.markDirty();
        return { rows, lastDate: klines.length ? klines[klines.length - 1].date : null, source };
    }

    /**
     * 收盘日 K：只处理当天还没拿到当日 K 线的标的
     * @returns {{done, holiday, ok, fail}}
     */
    async function closeKlinesJob(market, attempt) {
        return runLogged('kline_close', market, async () => {
            const today = exchangeDate(market);
            const list = collectable().filter(i => i.type !== 'fund' && instMarket(i) === market);
            let errors = 0; let gotToday = 0;
            for (const inst of list) {
                if (repo.lastDate(db, 'kline_daily', inst.id) === today) { gotToday++; continue; }
                try {
                    const r = await syncKlines(inst, { limit: 5 });
                    if (r.lastDate === today) gotToday++;
                } catch (err) {
                    errors++;
                }
                await jitter(300, 900);
            }
            store.saveDb(`收盘日K ${market}`);
            const done = list.length === 0 || gotToday === list.length;
            // 连续 3 次都没有任何标的出现当日 K 线：判定休市
            const holiday = !done && gotToday === 0 && attempt >= 3;
            return { ok: gotToday, fail: list.length - gotToday, error: errors ? `${errors} 个标的请求异常` : null, done, holiday, status: holiday ? 'holiday' : 'ok' };
        });
    }

    // ───────────────────────── 估值与温度 ─────────────────────────

    async function backfillDanjuan(inst) {
        if (!inst.dj_code) return { rows: 0, empty: true };
        let rows = 0; let empty = true;
        for (const metric of ['pe', 'pb']) {
            const { points, bands } = await sources.fetchDanjuanHistory(inst.dj_code, metric);
            if (points.length) empty = false;
            const last = points.length - 1;
            rows += repo.upsertValuations(db, inst.id, points.map((p, i) => ({
                date: p.date, [metric]: p.value, granularity: i === last ? 'daily' : 'weekly',
            })), 'danjuan');
            if (bands) repo.upsertBands(db, inst.id, metric, bands, 'danjuan');
            await jitter(600, 1500);
        }
        store.markDirty();
        return { rows, empty };
    }

    async function backfillValuation(inst) {
        const vs = inst.valuation_source;
        if (vs === 'danjuan') {
            const r = await backfillDanjuan(inst);
            if (r.empty) {
                repo.updateInstrument(db, inst.id, { valuation_source: 'none' });
                log.log(`[回补] ${inst.name}(${inst.dj_code}) 蛋卷无估值历史，标记为暂无估值数据`);
            }
            return r.rows;
        }
        if (vs === 'csindex') {
            const rows = await sources.fetchCsindexPerf(inst.cs_code || inst.code, '2000-01-01', bjToday());
            const n = repo.upsertValuations(db, inst.id, rows.map(r => ({ date: r.date, pe: r.pe, granularity: 'daily' })), 'csindex');
            store.markDirty();
            return n;
        }
        if (vs === 'eastmoney_dc') {
            const rows = await sources.fetchEastmoneyStockValuation(inst.code);
            const n = repo.upsertValuations(db, inst.id, rows.map(r => ({ date: r.date, pe: r.pe, pb: r.pb, granularity: 'daily' })), 'eastmoney_dc');
            store.markDirty();
            return n;
        }
        return 0;
    }

    /**
     * 每日估值快照（按各数据源自身公布的日期写入，重复执行幂等）
     * @param {boolean} fallback 是否对当日缺失的标的写入盘中兜底值
     */
    async function valuationJob({ fallback = false, cnTradingDay = null } = {}) {
        return runLogged('valuation', 'CN', async () => {
            let ok = 0; let fail = 0;
            const today = bjToday();
            const indices = repo.listInstruments(db, { type: 'index', status: ['active', 'hidden'] });
            const stocks = activeOf('stock');

            // 蛋卷（指数）
            try {
                const evaMap = await df.fetchDanjuanEvaluation();
                for (const inst of indices.filter(i => i.valuation_source === 'danjuan' && i.dj_code)) {
                    const v = evaMap[inst.dj_code];
                    const date = v && mmddToDate(v.date, today);
                    if (!v || !date) continue;
                    repo.upsertValuations(db, inst.id, [{
                        date, pe: v.pe, pb: v.pb, pePct: v.pePercentile, pbPct: v.pbPercentile,
                        roe: v.roe, dividend: v.dividend, evaType: v.evaType, granularity: 'daily',
                    }], 'danjuan');
                    ok++;
                }
            } catch (err) { fail++; log.warn('[估值] 蛋卷失败:', err.message); }

            // 中证官网（港股创新药等）
            for (const inst of indices.filter(i => i.valuation_source === 'csindex')) {
                try {
                    const rows = await sources.fetchCsindexPerf(inst.cs_code || inst.code, addDays(today, -15), today);
                    repo.upsertValuations(db, inst.id, rows.map(r => ({ date: r.date, pe: r.pe, granularity: 'daily' })), 'csindex');
                    ok++;
                } catch (err) { fail++; }
                await jitter(500, 1200);
            }

            // 东财数据中心（个股）
            for (const inst of stocks.filter(i => i.valuation_source === 'eastmoney_dc')) {
                try {
                    const rows = await sources.fetchEastmoneyStockValuation(inst.code, { pageSize: 10, recentOnly: true });
                    repo.upsertValuations(db, inst.id, rows.map(r => ({ date: r.date, pe: r.pe, pb: r.pb, granularity: 'daily' })), 'eastmoney_dc');
                    ok++;
                } catch (err) { fail++; }
                await jitter(500, 1200);
            }

            // 温度（知有行，按其公布日期）
            let tempDate = null;
            try {
                const thermo = await df.fetchYZYXThermometer({ force: true });
                tempDate = parseYzyxDate(thermo && thermo.updateTime);
                if (tempDate) {
                    const quotes = await df.fetchIndexQuotesForWatchlist();
                    for (const q of (quotes && quotes.indices) || []) {
                        if (q.temperature === null || q.temperature === undefined) continue;
                        const inst = repo.findByFullCode(db, 'index', q.code);
                        if (!inst) continue;
                        repo.upsertTemperatures(db, inst.id, [{ date: tempDate, temperature: q.temperature }], 'youzhiyouxing');
                        ok++;
                    }
                }
            } catch (err) { fail++; log.warn('[估值] 温度失败:', err.message); }

            // 分位参考线每周刷新一次（同时补齐周线历史），每次最多 3 个
            const staleBands = indices.filter(i => i.valuation_source === 'danjuan').filter(i => {
                const b = repo.getBands(db, i.id, 'pe');
                return !b || !b.updatedAt || (Date.now() - new Date(b.updatedAt).getTime()) > 7 * 86400000;
            }).slice(0, 3);
            for (const inst of staleBands) {
                try { await backfillDanjuan(inst); } catch (err) { fail++; }
            }

            // 兜底：当日为 A 股交易日、收盘后仍未取得当日估值 → 用盘中最后一次成功值
            let fallbackRows = 0;
            if (fallback && cnTradingDay === today) {
                fallbackRows = writeFallback(today, indices, stocks);
            }

            store.markDirty();
            store.saveDb('估值快照');
            return { ok, fail, fallbackRows, tempDate };
        });
    }

    function writeFallback(today, indices, stocks) {
        let n = 0;
        const iq = store.getSnapshot('index-quotes');
        const byCode = new Map((((iq && iq.data) || {}).indices || []).map(q => [q.code, q]));
        for (const inst of indices) {
            if (instMarket(inst) !== 'CN') continue;
            if (repo.lastDate(db, 'kline_daily', inst.id) !== today) continue; // 该标的今天没有交易
            const q = byCode.get(`${inst.code}.${inst.market}`);
            if (!q) continue;
            const row = repo.get(db, 'SELECT pe, pb, temperature FROM valuation_daily WHERE instrument_id = ? AND trade_date = ?', [inst.id, today]) || {};
            if (inst.valuation_source !== 'none' && row.pe == null && row.pb == null && (q.pe != null || q.pb != null)) {
                n += repo.upsertValuations(db, inst.id, [{
                    date: today, pe: q.pe, pb: q.pb, pePct: q.pePercentile, pbPct: q.pbPercentile,
                    roe: q.roe, dividend: q.dividend, evaType: q.evaType, granularity: 'daily', isFallback: true,
                }], inst.valuation_source);
            }
            if (row.temperature == null && q.temperature != null) {
                n += repo.upsertTemperatures(db, inst.id, [{ date: today, temperature: q.temperature, isFallback: true }], 'youzhiyouxing');
            }
        }
        const sq = store.getSnapshot('stocks');
        const sByCode = new Map((((sq && sq.data) || {}).stocks || []).map(s => [String(s.code).split('.')[0], s]));
        for (const inst of stocks.filter(i => i.valuation_source === 'eastmoney_dc')) {
            if (repo.lastDate(db, 'kline_daily', inst.id) !== today) continue;
            const row = repo.get(db, 'SELECT pe FROM valuation_daily WHERE instrument_id = ? AND trade_date = ?', [inst.id, today]);
            const s = sByCode.get(inst.code);
            if (row && row.pe != null) continue;
            if (!s || (s.peTTM == null && s.pbRatio == null)) continue;
            n += repo.upsertValuations(db, inst.id, [{ date: today, pe: s.peTTM, pb: s.pbRatio, granularity: 'daily', isFallback: true }], 'eastmoney_dc');
        }
        if (n) log.log(`[估值] 兜底写入 ${n} 条（${today}）`);
        return n;
    }

    // ───────────────────────── 历史回补队列 ─────────────────────────

    const queue = [];
    const queued = new Set();
    let queueRunning = false;

    function needsBackfill(inst) {
        if (inst.type === 'fund') return false;
        const b = repo.parseExtra(inst).backfill || {};
        if (!b.klineAt) return true;
        return inst.valuation_source && inst.valuation_source !== 'none' && !b.valuationAt;
    }

    function enqueueBackfill(inst) {
        if (!inst || queued.has(inst.id) || !needsBackfill(inst)) return false;
        queued.add(inst.id);
        queue.push(inst.id);
        processQueue();
        return true;
    }

    async function backfillOne(inst) {
        const b = repo.parseExtra(inst).backfill || {};
        const t0 = Date.now();
        let klineRows = 0; let valRows = 0;
        if (!b.klineAt) {
            const r = await syncKlines(inst, { full: true });
            klineRows = r.rows;
            if (r.rows > 0) repo.patchInstrumentExtra(db, inst.id, { backfill: { ...b, klineAt: new Date().toISOString(), klineSource: r.source } });
            await jitter(800, 2000);
        }
        const fresh = repo.getInstrumentById(db, inst.id);
        const fb = repo.parseExtra(fresh).backfill || {};
        if (fresh.valuation_source && fresh.valuation_source !== 'none' && !fb.valuationAt) {
            valRows = await backfillValuation(fresh);
            repo.patchInstrumentExtra(db, inst.id, { backfill: { ...fb, valuationAt: new Date().toISOString() } });
        }
        store.markDirty();
        store.saveDb(`回补 ${inst.name}`);
        log.log(`[回补] ${inst.type}:${inst.name} 日K ${klineRows} 条，估值 ${valRows} 条（${((Date.now() - t0) / 1000).toFixed(1)}s）`);
        return { klineRows, valRows };
    }

    async function processQueue() {
        if (queueRunning) return;
        queueRunning = true;
        let ok = 0; let fail = 0;
        const runId = queue.length ? repo.startRun(db, 'backfill') : null;
        try {
            while (queue.length) {
                const id = queue.shift();
                queued.delete(id);
                const inst = repo.getInstrumentById(db, id);
                if (!inst || inst.status === 'deleted') continue;
                try {
                    await backfillOne(inst);
                    ok++;
                } catch (err) {
                    fail++;
                    log.warn(`[回补] ${inst.name} 失败（下次启动重试）: ${err.message}`);
                }
                store.setStatus('backfill', { pending: queue.length, lastAt: new Date().toISOString(), ok, fail });
                await jitter(1500, 3500);
            }
        } finally {
            queueRunning = false;
            if (runId) {
                repo.finishRun(db, runId, { ok, fail, status: fail ? 'partial' : 'ok' });
                store.markDirty();
                store.saveDb('回补日志');
            }
        }
    }

    function enqueueAllPending() {
        let n = 0;
        for (const inst of collectable()) if (enqueueBackfill(inst)) n++;
        return n;
    }

    // ───────────────────────── 缺口补齐 ─────────────────────────

    async function gapFillJob() {
        return runLogged('gap_fill', null, async () => {
            let ok = 0; let fail = 0;
            for (const inst of collectable().filter(i => i.type !== 'fund')) {
                const last = repo.lastDate(db, 'kline_daily', inst.id);
                if (!last) continue; // 没有历史的由回补队列处理
                const today = exchangeDate(instMarket(inst));
                const gap = daysBetween(last, today);
                if (gap <= 0) continue;
                try {
                    await syncKlines(inst, { limit: Math.min(2520, gap + 10) });
                    ok++;
                } catch (err) { fail++; }
                await jitter(400, 1000);
            }
            store.saveDb('缺口补齐');
            return { ok, fail };
        });
    }

    // ───────────────────────── 一次性导入 ─────────────────────────

    function readLegacyCache(key) {
        try {
            const f = path.join(paths.LEGACY_CACHE_DIR, `${key}.json`);
            if (!fs.existsSync(f)) return null;
            const w = JSON.parse(fs.readFileSync(f, 'utf8'));
            return w && w.data ? w : null;
        } catch (e) {
            return null;
        }
    }

    /** 用现有 JSON 缓存为快照做初始值，采集进程首次启动即可提供数据 */
    function seedSnapshots() {
        let n = 0;
        for (const key of ['indices', 'active-funds']) {
            if (!store.readSnap(key)) {
                const w = readLegacyCache(key);
                if (w) { require('../db/atomicWrite').writeJsonAtomic(paths.snapFile(key), w); n++; }
            }
        }
        for (const key of ['index-quotes', 'stocks', 'etfs', 'daily-eval']) {
            if (!store.getSnapshot(key)) {
                const w = readLegacyCache(key);
                if (w) { store.latest.snapshots[key] = { data: w.data, time: w.time || Date.now(), seeded: true }; n++; }
            }
        }
        if (n) store.flushLatest();
        return n;
    }

    async function importLegacyJob() {
        if (repo.getMeta(db, 'import_v1') === 'done') return { skipped: true };
        return runLogged('import', null, async () => {
            let klines = 0; let navs = 0;
            const idx = readLegacyCache('indices');
            for (const i of ((idx && idx.data && idx.data.indices) || [])) {
                const inst = repo.findByFullCode(db, 'index', i.code);
                if (!inst || !Array.isArray(i.historySeries)) continue;
                klines += repo.upsertKlines(db, inst.id, i.historySeries, 'import');
            }
            const af = readLegacyCache('active-funds');
            if (af) navs = ingestFundNav(af.data, { full: true });
            repo.setMeta(db, 'import_v1', 'done');
            store.markDirty();
            store.saveDb('导入现有缓存');
            log.log(`[导入] 日K ${klines} 条，基金净值 ${navs} 条`);
            return { ok: klines + navs };
        });
    }

    // ───────────────────────── 备份 ─────────────────────────

    function backupJob() {
        const date = bjToday().replace(/-/g, '');
        if (!fs.existsSync(paths.MARKET_DB)) return { skipped: true };
        store.saveDb('备份前');
        if (!fs.existsSync(paths.BACKUP_DIR)) fs.mkdirSync(paths.BACKUP_DIR, { recursive: true });
        const target = path.join(paths.BACKUP_DIR, `market-${date}.db`);
        // market.db 始终是原子写入的完整文件，复制即得一致备份；复制到临时文件再改名
        const tmp = `${target}.tmp`;
        fs.copyFileSync(paths.MARKET_DB, tmp);
        fs.renameSync(tmp, target);
        const all = fs.readdirSync(paths.BACKUP_DIR).filter(f => /^market-\d{8}\.db$/.test(f)).sort();
        const removed = all.slice(0, Math.max(0, all.length - 14));
        for (const f of removed) fs.unlinkSync(path.join(paths.BACKUP_DIR, f));
        repo.pruneRuns(db);
        const id = repo.startRun(db, 'backup');
        repo.finishRun(db, id, { ok: 1 });
        store.markDirty();
        store.saveDb('备份日志');
        log.log(`[备份] ${path.basename(target)}，保留 ${all.length - removed.length} 份`);
        return { file: target, kept: all.length - removed.length, removed: removed.length };
    }

    return {
        watchlistMarkets,
        runIndexQuotes, runStockQuotes, runEtfQuotes,
        refreshIndicesSnapshot, refreshActiveFundsSnapshot, refreshDailyEvalSnapshot,
        closeKlinesJob, valuationJob, fundNavJob, gapFillJob, importLegacyJob, backupJob, seedSnapshots,
        syncKlines, backfillOne, enqueueBackfill, enqueueAllPending, needsBackfill,
        _util: { mmddToDate, parseYzyxDate, addDays, daysBetween, zonedParts, MARKET_TZ },
    };
}

module.exports = { createJobs };
