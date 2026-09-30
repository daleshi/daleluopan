/**
 * 采集进程专用的历史数据源（均为 2026-09-30 实测可用的公开接口）
 *
 * - 蛋卷：指数 PE/PB 历史（周线，末点为当日）+ 30/50/70 分位参考线
 * - 中证官网：指数日线（含 PE 字段 peg，无 PB）
 * - 东财数据中心：A 股个股 PE-TTM / PB-MRQ 日线（2018 起）
 * - 国证官网：深证/国证指数完整日 K
 */
const fetch = require('node-fetch');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function fetchJson(url, { timeout = 12000, retries = 1, headers = {} } = {}) {
    let lastErr = null;
    for (let i = 0; i <= retries; i++) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeout);
        try {
            const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json, text/plain, */*', ...headers }, signal: ctrl.signal });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const text = await res.text();
            return JSON.parse(text);
        } catch (err) {
            lastErr = err.name === 'AbortError' ? new Error(`超时 ${timeout}ms`) : err;
            if (i < retries) await sleep(800 + Math.random() * 1200);
        } finally {
            clearTimeout(timer);
        }
    }
    throw lastErr;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** 毫秒时间戳 → 北京日期 YYYY-MM-DD */
function tsToBjDate(ts) {
    return new Date(Number(ts) + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

const ymd = (s) => String(s).replace(/-/g, '');
const dashed = (s) => {
    const t = String(s).replace(/-/g, '');
    return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`;
};

// ───────────────────────── 蛋卷 ─────────────────────────

/**
 * @param {string} djCode 如 SH000300 / SP500 / HKHSTECH
 * @param {'pe'|'pb'} metric
 * @returns {Promise<{points: {date:string, value:number}[], bands: {p30,p50,p70}|null}>}
 */
async function fetchDanjuanHistory(djCode, metric) {
    const url = `https://danjuanfunds.com/djapi/index_eva/${metric}_history/${encodeURIComponent(djCode)}?day=all`;
    const j = await fetchJson(url, { headers: { Referer: 'https://danjuanfunds.com/djmodule/value-center' } });
    const data = (j && j.data) || {};
    const arr = data[`index_eva_${metric}_growths`] || [];
    const points = arr
        .filter(p => p && p.ts && Number.isFinite(Number(p[metric])))
        .map(p => ({ date: tsToBjDate(p.ts), value: Number(p[metric]) }));
    let bands = null;
    if (Array.isArray(data.horizontal_lines) && data.horizontal_lines.length) {
        const byType = {};
        for (const l of data.horizontal_lines) byType[l.line_type] = Number(l.line_value);
        bands = { p30: byType[1] ?? null, p50: byType[2] ?? null, p70: byType[3] ?? null };
    }
    return { points, bands };
}

// ───────────────────────── 中证官网 ─────────────────────────

/**
 * @returns {Promise<Array<{date, open, high, low, close, volume, amount, changePercent, changeAmount, pe}>>}
 */
async function fetchCsindexPerf(code, startDate, endDate) {
    const url = `https://www.csindex.com.cn/csindex-home/perf/index-perf?indexCode=${encodeURIComponent(code)}&startDate=${ymd(startDate)}&endDate=${ymd(endDate)}`;
    const j = await fetchJson(url, { timeout: 20000, headers: { Referer: 'https://www.csindex.com.cn/' } });
    const arr = (j && Array.isArray(j.data)) ? j.data : [];
    return arr.map(r => ({
        date: dashed(r.tradeDate),
        open: r.open, high: r.high, low: r.low, close: r.close,
        volume: r.tradingVol || null, amount: r.tradingValue || null,
        changePercent: r.changePct, changeAmount: r.change,
        pe: r.peg,
    })).filter(r => r.date && r.close != null);
}

// ───────────────────────── 东财数据中心 ─────────────────────────

/**
 * 个股估值日线。recentOnly 时只取最近 pageSize 条（按日期倒序）。
 * @returns {Promise<Array<{date, pe, pb}>>}
 */
async function fetchEastmoneyStockValuation(code, { pageSize = 5000, recentOnly = false } = {}) {
    const out = [];
    let page = 1;
    let pages = 1;
    do {
        const url = 'https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_VALUEANALYSIS_DET'
            + '&columns=TRADE_DATE,SECURITY_CODE,PE_TTM,PB_MRQ'
            + `&filter=(SECURITY_CODE%3D%22${encodeURIComponent(code)}%22)`
            + `&pageNumber=${page}&pageSize=${pageSize}&sortColumns=TRADE_DATE&sortTypes=${recentOnly ? -1 : 1}&source=WEB&client=WEB`;
        const j = await fetchJson(url, { headers: { Referer: 'https://data.eastmoney.com/' } });
        if (!j || !j.success || !j.result) break;
        pages = recentOnly ? 1 : (j.result.pages || 1);
        for (const r of j.result.data || []) {
            out.push({ date: String(r.TRADE_DATE).slice(0, 10), pe: r.PE_TTM, pb: r.PB_MRQ });
        }
        page += 1;
        if (page <= pages) await sleep(500 + Math.random() * 800);
    } while (page <= pages);
    return out.sort((a, b) => a.date.localeCompare(b.date));
}

// ───────────────────────── 国证官网 ─────────────────────────

async function fetchCnindexKlines(code, startDate = '2000-01-01', endDate = null) {
    const end = endDate || new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
    const url = `https://hq.cnindex.com.cn/market/market/getIndexDailyDataWithDataFormat?indexCode=${encodeURIComponent(code)}&startDate=${dashed(startDate)}&endDate=${dashed(end)}&frequency=day`;
    const j = await fetchJson(url, { timeout: 20000, headers: { Referer: 'https://www.cnindex.com.cn/' } });
    const d = (j && j.data) || {};
    const items = d.item || [];
    const idx = (name) => items.indexOf(name);
    const iTs = idx('timestamp'); const iClose = idx('close'); const iOpen = idx('open');
    const iHigh = idx('high'); const iLow = idx('low'); const iChg = idx('chg'); const iPct = idx('percent');
    const iAmt = idx('amount'); const iVol = idx('volume');
    const rows = (d.data || []).map(r => ({
        date: String(r[iTs]).slice(0, 10),
        open: r[iOpen], high: r[iHigh], low: r[iLow], close: r[iClose],
        volume: r[iVol], amount: r[iAmt], changeAmount: r[iChg],
        changePercent: r[iPct] != null ? parseFloat(String(r[iPct]).replace('%', '')) : null,
    })).filter(r => r.date && r.close != null);
    return rows.sort((a, b) => a.date.localeCompare(b.date));
}

// ───────────────────────── 腾讯日 K（A 股个股 / ETF，不复权）─────────────────────────

/**
 * 按日期窗口分段拉取（单次上限约 640 条，按 2.5 年一段）
 * @param {string} code 6 位代码
 * @param {string} market SH / SZ
 */
async function fetchTencentKlines(code, market, startDate, endDate = null) {
    const tx = `${market === 'SZ' ? 'sz' : 'sh'}${code}`;
    const end = endDate || new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
    const out = new Map();
    let from = dashed(startDate);
    while (from <= end) {
        const d = new Date(`${from}T00:00:00Z`);
        d.setUTCMonth(d.getUTCMonth() + 30);
        const to = d.toISOString().slice(0, 10) < end ? d.toISOString().slice(0, 10) : end;
        const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${tx},day,${from},${to},640,`;
        const j = await fetchJson(url, { timeout: 10000 });
        const x = (j && j.data && j.data[tx]) || {};
        for (const r of x.day || x.qfqday || []) {
            out.set(r[0], { date: r[0], open: +r[1], close: +r[2], high: +r[3], low: +r[4], volume: +r[5] || null, amount: null });
        }
        const next = new Date(`${to}T00:00:00Z`);
        next.setUTCDate(next.getUTCDate() + 1);
        from = next.toISOString().slice(0, 10);
        if (from <= end) await sleep(300 + Math.random() * 500);
    }
    const rows = [...out.values()].sort((a, b) => a.date.localeCompare(b.date));
    // 补算涨跌幅（腾讯日 K 不含）
    for (let i = 1; i < rows.length; i++) {
        const prev = rows[i - 1].close;
        if (prev > 0) {
            rows[i].changeAmount = +(rows[i].close - prev).toFixed(4);
            rows[i].changePercent = +(((rows[i].close - prev) / prev) * 100).toFixed(2);
        }
    }
    return rows;
}

module.exports = {
    fetchJson, sleep, tsToBjDate,
    fetchDanjuanHistory, fetchCsindexPerf, fetchEastmoneyStockValuation, fetchCnindexKlines, fetchTencentKlines,
};
