/**
 * 数据访问层（sql.js Database 之上的薄封装）
 *
 * 写入函数仅供采集进程调用；查询函数两个进程通用。
 * 所有历史写入以（标的、日期）为主键 UPSERT，任务可安全重跑。
 */
const fs = require('fs');
const paths = require('./paths');

// ───────────────────────── 基础工具 ─────────────────────────

function all(db, sql, params = []) {
    const st = db.prepare(sql);
    try {
        st.bind(params);
        const rows = [];
        while (st.step()) rows.push(st.getAsObject());
        return rows;
    } finally {
        st.free();
    }
}

function get(db, sql, params = []) {
    return all(db, sql, params)[0] || null;
}

function run(db, sql, params = []) {
    db.run(sql, params);
}

/** 批量执行同一条语句（单事务） */
function batch(db, sql, rowsParams) {
    if (!rowsParams.length) return 0;
    db.run('BEGIN');
    const st = db.prepare(sql);
    try {
        for (const p of rowsParams) st.run(p);
        st.free();
        db.run('COMMIT');
    } catch (err) {
        try { st.free(); } catch (e) { /* ignore */ }
        db.run('ROLLBACK');
        throw err;
    }
    return rowsParams.length;
}

const nowIso = () => new Date().toISOString();
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v))) ? null : Number(v);

function parseExtra(row) {
    if (!row) return {};
    try { return row.extra ? JSON.parse(row.extra) : {}; } catch (e) { return {}; }
}

// ───────────────────────── meta ─────────────────────────

function getMeta(db, key) {
    const r = get(db, 'SELECT value FROM meta WHERE key = ?', [key]);
    return r ? r.value : null;
}

function setMeta(db, key, value) {
    run(db, 'INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, String(value)]);
}

// ───────────────────────── 关注清单镜像 ─────────────────────────

// ETF → 跟踪指数（watchlist 条目可用 trackIndex 字段覆盖，如 "399006.SZ"）
const KNOWN_ETF_TRACKING = {
    '159915': '399006.SZ',   // 创业板ETF → 创业板指
    '588000': '000688.SH',   // 科创50ETF → 科创50
    '510310': '000300.SH',   // 沪深300ETF易方达 → 沪深300
    '510300': '000300.SH',
    '513180': 'HSTECH.HI',   // 恒生科技ETF华夏 → 恒生科技
    '510500': '000905.SH',
    '159920': 'HSI.HI',
};

// 国证官网提供完整日 K 的指数（东财历史不完整）
const CNINDEX_KLINE_CODES = new Set(['399673', '980092']);

// 美股指数的蛋卷代码
const US_DANJUAN_CODES = { SPX: 'SP500', NDX: 'NDX' };

/** 读取 watchlist 原始条目；文件不存在返回 []，解析失败返回 null（调用方跳过本轮） */
function readWatchlistRaw(type) {
    const file = paths.WATCHLIST_FILES[type];
    try {
        if (!fs.existsSync(file)) return [];
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        const key = { index: 'indices', stock: 'stocks', etf: 'etfs', fund: 'funds' }[type];
        const list = Array.isArray(data[key]) ? data[key] : [];
        return list.map(x => (typeof x === 'string' ? { code: x } : x)).filter(x => x && x.code);
    } catch (err) {
        return null;
    }
}

function instrumentKey(type, code, market) {
    return `${type}:${code}${market ? '.' + market : ''}`;
}

function normalizeItem(type, item) {
    const code = String(item.code).trim();
    const market = type === 'fund' ? '' : String(item.market || '').trim();
    return { type, code, market, secid: item.secid || null, name: item.name || item.shortName || code, raw: item };
}

/** 推断估值来源的初始值（回补时会实际探测并修正） */
function guessValuationSource(type, code, market, item, poolCfg) {
    if (type === 'index') {
        if (code === '931787') return { valuation_source: 'csindex', dj_code: null, cs_code: code };
        const prefix = { SH: 'SH', SZ: 'SZ', CSI: 'CSI', HI: 'HK' }[market];
        const dj = (poolCfg && poolCfg.djCode) || item.djCode
            || (market === 'US' ? (US_DANJUAN_CODES[code] || null) : (prefix ? prefix + code : null));
        return { valuation_source: dj ? 'danjuan' : 'none', dj_code: dj || null, cs_code: (poolCfg && poolCfg.csCode) || null };
    }
    if (type === 'stock') {
        return { valuation_source: (market === 'SH' || market === 'SZ') ? 'eastmoney_dc' : 'none', dj_code: null, cs_code: null };
    }
    return { valuation_source: 'none', dj_code: null, cs_code: null };
}

function getInstrument(db, type, code, market = '') {
    return get(db, 'SELECT * FROM instruments WHERE type = ? AND code = ? AND market = ?', [type, code, market]);
}

function getInstrumentById(db, id) {
    return get(db, 'SELECT * FROM instruments WHERE id = ?', [id]);
}

/** 按 "000300.SH" 这种完整代码查指数（含隐藏标的） */
function findByFullCode(db, type, fullCode) {
    const m = String(fullCode || '').match(/^(.+?)(?:\.([A-Za-z]+))?$/);
    if (!m) return null;
    const code = m[1];
    const market = m[2] || '';
    return getInstrument(db, type, code, type === 'fund' ? '' : market);
}

function listInstruments(db, { type = null, status = null } = {}) {
    const where = [];
    const params = [];
    if (type) { where.push('type = ?'); params.push(type); }
    if (status) {
        const list = Array.isArray(status) ? status : [status];
        where.push(`status IN (${list.map(() => '?').join(',')})`);
        params.push(...list);
    }
    return all(db, `SELECT * FROM instruments ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id`, params);
}

function updateInstrument(db, id, fields) {
    const keys = Object.keys(fields);
    if (!keys.length) return;
    run(db, `UPDATE instruments SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`, [...keys.map(k => fields[k]), id]);
}

function patchInstrumentExtra(db, id, patch) {
    const row = getInstrumentById(db, id);
    const extra = { ...parseExtra(row), ...patch };
    updateInstrument(db, id, { extra: JSON.stringify(extra) });
    return extra;
}

/** 确保某个指数存在（ETF 跟踪指数不在关注清单时以 hidden 状态创建） */
function ensureHiddenIndex(db, fullCode, poolMap = {}) {
    const [code, market] = fullCode.split('.');
    const row = getInstrument(db, 'index', code, market);
    if (row) return row;
    const pool = poolMap[fullCode] || {};
    const vs = guessValuationSource('index', code, market, {}, pool);
    run(db, `INSERT INTO instruments(type, code, market, secid, name, dj_code, cs_code, valuation_source, kline_source, status, created_at, extra)
             VALUES ('index', ?, ?, ?, ?, ?, ?, ?, ?, 'hidden', ?, '{}')`,
    [code, market, pool.secid || null, pool.name || fullCode, vs.dj_code, vs.cs_code, vs.valuation_source,
        CNINDEX_KLINE_CODES.has(code) ? 'cnindex' : 'eastmoney', nowIso()]);
    return getInstrument(db, 'index', code, market);
}

/**
 * 同步某一类 watchlist 到 instruments 镜像
 * - 新出现：插入 active
 * - 重新出现（此前 deleted/hidden）：恢复为 active，历史自动接续
 * - 从文件消失：标记 deleted，保留历史
 * @returns {{added: Object[], restored: Object[], deleted: Object[], skipped: boolean}}
 */
function syncWatchlist(db, type, items, poolMap = {}) {
    const result = { added: [], restored: [], deleted: [], skipped: false };
    if (!Array.isArray(items)) { result.skipped = true; return result; }

    const now = nowIso();
    const seen = new Set();
    for (const raw of items) {
        const it = normalizeItem(type, raw);
        // 候选池内指数的 secid 经过人工校准（如纳指100 必须是 100.NDX100，100.NDX 是纳斯达克综合指数），
        // 优先于 watchlist 中可能存错的值，避免把别的指数的 K 线写进库
        const pooled = type === 'index' ? poolMap[`${it.code}.${it.market}`] : null;
        if (pooled && pooled.secid) it.secid = pooled.secid;
        const key = instrumentKey(type, it.code, it.market);
        if (seen.has(key)) continue;
        seen.add(key);
        const existing = getInstrument(db, type, it.code, it.market);
        if (!existing) {
            const pool = type === 'index' ? (poolMap[`${it.code}.${it.market}`] || {}) : {};
            const vs = guessValuationSource(type, it.code, it.market, raw, pool);
            run(db, `INSERT INTO instruments(type, code, market, secid, name, dj_code, cs_code, valuation_source, kline_source, status, created_at, extra)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, '{}')`,
            [type, it.code, it.market, it.secid, it.name, vs.dj_code, vs.cs_code, vs.valuation_source,
                type === 'fund' ? null : (CNINDEX_KLINE_CODES.has(it.code) ? 'cnindex' : 'eastmoney'), now]);
            result.added.push(getInstrument(db, type, it.code, it.market));
        } else {
            const fields = {};
            if (existing.status !== 'active') { fields.status = 'active'; fields.deleted_at = null; }
            if (it.secid && it.secid !== existing.secid) fields.secid = it.secid;
            if (it.name && it.name !== existing.name) fields.name = it.name;
            if (Object.keys(fields).length) updateInstrument(db, existing.id, fields);
            if (existing.status === 'deleted') result.restored.push(getInstrumentById(db, existing.id));
        }
    }

    for (const row of listInstruments(db, { type, status: 'active' })) {
        if (!seen.has(instrumentKey(type, row.code, row.market))) {
            updateInstrument(db, row.id, { status: 'deleted', deleted_at: now });
            result.deleted.push(row);
        }
    }

    // ETF：维护跟踪指数关系
    if (type === 'etf') {
        for (const raw of items) {
            const it = normalizeItem('etf', raw);
            const row = getInstrument(db, 'etf', it.code, it.market);
            const target = raw.trackIndex || KNOWN_ETF_TRACKING[it.code] || null;
            if (!row) continue;
            if (!target) {
                if (row.tracking_instrument_id) updateInstrument(db, row.id, { tracking_instrument_id: null });
                continue;
            }
            const idx = ensureHiddenIndex(db, target, poolMap);
            if (idx && row.tracking_instrument_id !== idx.id) updateInstrument(db, row.id, { tracking_instrument_id: idx.id });
        }
    }
    reconcileHiddenIndices(db);
    return result;
}

/**
 * 被在关注 ETF 跟踪的指数：不在关注清单时保持 hidden（继续采集估值、页面不显示）；
 * 不再被任何 ETF 跟踪的 hidden 指数转为 deleted。
 */
function reconcileHiddenIndices(db) {
    run(db, `UPDATE instruments SET status = 'hidden'
             WHERE type = 'index' AND status = 'deleted'
               AND id IN (SELECT tracking_instrument_id FROM instruments WHERE type = 'etf' AND status = 'active' AND tracking_instrument_id IS NOT NULL)`);
    run(db, `UPDATE instruments SET status = 'deleted', deleted_at = ?
             WHERE type = 'index' AND status = 'hidden'
               AND id NOT IN (SELECT tracking_instrument_id FROM instruments WHERE type = 'etf' AND status = 'active' AND tracking_instrument_id IS NOT NULL)`, [nowIso()]);
}

// ───────────────────────── 历史写入 ─────────────────────────

/** 日 K：rows = [{date, open, high, low, close, volume, amount, changePercent, changeAmount}] */
function upsertKlines(db, instrumentId, rows, source) {
    const params = [];
    for (const k of rows || []) {
        if (!k || !k.date || num(k.close) === null) continue;
        params.push([instrumentId, String(k.date).slice(0, 10), num(k.open), num(k.high), num(k.low), num(k.close),
            num(k.volume), num(k.amount), num(k.changePercent), num(k.changeAmount), source]);
    }
    return batch(db, `INSERT INTO kline_daily(instrument_id, trade_date, open, high, low, close, volume, amount, change_pct, change_amt, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(instrument_id, trade_date) DO UPDATE SET
            open = COALESCE(excluded.open, open), high = COALESCE(excluded.high, high), low = COALESCE(excluded.low, low),
            close = excluded.close, volume = COALESCE(excluded.volume, volume), amount = COALESCE(excluded.amount, amount),
            change_pct = COALESCE(excluded.change_pct, change_pct), change_amt = COALESCE(excluded.change_amt, change_amt),
            source = excluded.source`, params);
}

/** 基金净值：rows = [{date, nav, accNav, dailyReturn}] */
function upsertNav(db, instrumentId, rows, source) {
    const params = [];
    for (const r of rows || []) {
        if (!r || !r.date || num(r.nav) === null) continue;
        params.push([instrumentId, String(r.date).slice(0, 10), num(r.nav), num(r.accNav), num(r.dailyReturn), source]);
    }
    return batch(db, `INSERT INTO fund_nav_daily(instrument_id, nav_date, nav, acc_nav, daily_return, source)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(instrument_id, nav_date) DO UPDATE SET
            nav = excluded.nav, acc_nav = COALESCE(excluded.acc_nav, acc_nav),
            daily_return = COALESCE(excluded.daily_return, daily_return), source = excluded.source`, params);
}

/**
 * 估值（PE/PB 及相关字段）：rows = [{date, pe, pb, pePct, pbPct, roe, dividend, evaType, granularity, isFallback}]
 * 以下两种情况保留已有记录不变，其余情况用新值覆盖：
 *   - 新值是兜底值，而已有记录是正常值
 *   - 新值是周线，而已有记录是正常日线值
 * 温度列不受影响（单独写入）
 */
function upsertValuations(db, instrumentId, rows, source) {
    const now = nowIso();
    const params = [];
    for (const r of rows || []) {
        if (!r || !r.date) continue;
        if (num(r.pe) === null && num(r.pb) === null) continue;
        params.push([instrumentId, String(r.date).slice(0, 10), num(r.pe), num(r.pb), num(r.pePct), num(r.pbPct),
            num(r.roe), num(r.dividend), r.evaType || null, source, r.granularity || 'daily', r.isFallback ? 1 : 0, now]);
    }
    const V = 'valuation_daily';
    const HAS_REAL = `(${V}.is_fallback = 0 AND (${V}.pe IS NOT NULL OR ${V}.pb IS NOT NULL))`;
    const KEEP = `((excluded.is_fallback = 1 AND ${HAS_REAL}) OR (excluded.granularity = 'weekly' AND ${V}.granularity = 'daily' AND ${HAS_REAL}))`;
    const pick = (col, coalesce = true) => `${col} = CASE WHEN ${KEEP} THEN ${V}.${col} ELSE ${coalesce ? `COALESCE(excluded.${col}, ${V}.${col})` : `excluded.${col}`} END`;
    return batch(db, `INSERT INTO valuation_daily(instrument_id, trade_date, pe, pb, pe_pct, pb_pct, roe, dividend, eva_type, source, granularity, is_fallback, fetched_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(instrument_id, trade_date) DO UPDATE SET
            ${pick('pe')}, ${pick('pb')}, ${pick('pe_pct')}, ${pick('pb_pct')},
            ${pick('roe')}, ${pick('dividend')}, ${pick('eva_type')},
            ${pick('source', false)}, ${pick('granularity', false)}, ${pick('is_fallback', false)},
            fetched_at = excluded.fetched_at`, params);
}

/** 温度：rows = [{date, temperature, isFallback}] */
function upsertTemperatures(db, instrumentId, rows, source) {
    const now = nowIso();
    const params = [];
    for (const r of rows || []) {
        if (!r || !r.date || num(r.temperature) === null) continue;
        params.push([instrumentId, String(r.date).slice(0, 10), num(r.temperature), source, r.isFallback ? 1 : 0, now]);
    }
    return batch(db, `INSERT INTO valuation_daily(instrument_id, trade_date, temperature, temperature_source, granularity, temp_is_fallback, fetched_at)
        VALUES (?, ?, ?, ?, 'daily', ?, ?)
        ON CONFLICT(instrument_id, trade_date) DO UPDATE SET
            temperature = CASE WHEN excluded.temp_is_fallback = 1 AND valuation_daily.temperature IS NOT NULL AND valuation_daily.temp_is_fallback = 0
                               THEN valuation_daily.temperature ELSE excluded.temperature END,
            temp_is_fallback = CASE WHEN excluded.temp_is_fallback = 1 AND valuation_daily.temperature IS NOT NULL AND valuation_daily.temp_is_fallback = 0
                               THEN 0 ELSE excluded.temp_is_fallback END,
            temperature_source = CASE WHEN excluded.temp_is_fallback = 1 AND valuation_daily.temperature IS NOT NULL AND valuation_daily.temp_is_fallback = 0
                               THEN valuation_daily.temperature_source ELSE excluded.temperature_source END,
            fetched_at = excluded.fetched_at`, params);
}

function upsertBands(db, instrumentId, metric, bands, source) {
    if (!bands) return 0;
    run(db, `INSERT INTO valuation_bands(instrument_id, metric, p30, p50, p70, source, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(instrument_id, metric) DO UPDATE SET p30 = excluded.p30, p50 = excluded.p50, p70 = excluded.p70,
            source = excluded.source, updated_at = excluded.updated_at`,
    [instrumentId, metric, num(bands.p30), num(bands.p50), num(bands.p70), source, nowIso()]);
    return 1;
}

// ───────────────────────── 查询 ─────────────────────────

function lastDate(db, table, instrumentId, column = 'trade_date', where = '') {
    const r = get(db, `SELECT MAX(${column}) AS d FROM ${table} WHERE instrument_id = ? ${where}`, [instrumentId]);
    return r ? r.d : null;
}

function countRows(db, table, instrumentId, where = '') {
    const r = get(db, `SELECT COUNT(*) AS n FROM ${table} WHERE instrument_id = ? ${where}`, [instrumentId]);
    return r ? r.n : 0;
}

function klineRange(db, instrumentId, fromDate = '0000-00-00') {
    return all(db, `SELECT trade_date AS date, open, high, low, close, volume, amount,
                           change_pct AS changePercent, change_amt AS changeAmount, source
                    FROM kline_daily WHERE instrument_id = ? AND trade_date >= ? ORDER BY trade_date`, [instrumentId, fromDate]);
}

function navRange(db, instrumentId, fromDate = '0000-00-00') {
    return all(db, `SELECT nav_date AS date, nav, acc_nav AS accNav, daily_return AS dailyReturn, source
                    FROM fund_nav_daily WHERE instrument_id = ? AND nav_date >= ? ORDER BY nav_date`, [instrumentId, fromDate]);
}

/** metric: pe / pb / temperature */
function valuationRange(db, instrumentId, metric, fromDate = '0000-00-00') {
    const col = { pe: 'pe', pb: 'pb', temperature: 'temperature' }[metric];
    if (!col) throw new Error('invalid metric');
    const srcCol = metric === 'temperature' ? 'temperature_source' : 'source';
    const fbCol = metric === 'temperature' ? 'temp_is_fallback' : 'is_fallback';
    return all(db, `SELECT trade_date AS date, ${col} AS value, granularity, ${fbCol} AS isFallback, ${srcCol} AS source
                    FROM valuation_daily WHERE instrument_id = ? AND ${col} IS NOT NULL AND trade_date >= ?
                    ORDER BY trade_date`, [instrumentId, fromDate]);
}

function getBands(db, instrumentId, metric) {
    return get(db, 'SELECT p30, p50, p70, source, updated_at AS updatedAt FROM valuation_bands WHERE instrument_id = ? AND metric = ?', [instrumentId, metric]);
}

// ───────────────────────── 运行日志 ─────────────────────────

function startRun(db, job, market = null) {
    run(db, "INSERT INTO collector_runs(job, market, started_at, status) VALUES (?, ?, ?, 'running')", [job, market, nowIso()]);
    return get(db, 'SELECT last_insert_rowid() AS id').id;
}

function finishRun(db, id, { status = 'ok', ok = 0, fail = 0, error = null } = {}) {
    run(db, 'UPDATE collector_runs SET finished_at = ?, status = ?, ok_count = ?, fail_count = ?, error = ? WHERE id = ?',
        [nowIso(), status, ok, fail, error ? String(error).slice(0, 500) : null, id]);
}

function recentRuns(db, limit = 30) {
    return all(db, 'SELECT * FROM collector_runs ORDER BY id DESC LIMIT ?', [limit]);
}

/** 清理 90 天前的运行日志 */
function pruneRuns(db, days = 90) {
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    run(db, 'DELETE FROM collector_runs WHERE started_at < ?', [cutoff]);
}

module.exports = {
    all, get, run, batch, num, parseExtra,
    getMeta, setMeta,
    KNOWN_ETF_TRACKING, CNINDEX_KLINE_CODES, US_DANJUAN_CODES,
    readWatchlistRaw, instrumentKey, syncWatchlist, ensureHiddenIndex,
    getInstrument, getInstrumentById, findByFullCode, listInstruments, updateInstrument, patchInstrumentExtra,
    upsertKlines, upsertNav, upsertValuations, upsertTemperatures, upsertBands,
    lastDate, countRows, klineRange, navRange, valuationRange, getBands,
    startRun, finishRun, recentRuns, pruneRuns,
};
