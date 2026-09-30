/**
 * 交易时段统一模块（A 股 / 港股 / 美股）
 *
 * 所有时间判断都显式按交易所时区计算，不依赖服务器本地时区：
 *   - CN：Asia/Shanghai    09:30–11:30、13:00–15:00
 *   - HK：Asia/Hong_Kong   09:30–12:00、13:00–16:10（含收市竞价）
 *   - US：America/New_York 09:30–16:00（夏令时/冬令时由时区规则自动处理）
 *
 * 节假日不在此处判断（不维护节假日表）：休市日由采集层根据"最新日 K 日期是否变化"识别。
 */

const MARKET_TZ = {
    CN: 'Asia/Shanghai',
    HK: 'Asia/Hong_Kong',
    US: 'America/New_York',
};

// 精确交易时段（交易所当地时间，分钟数）
const SESSIONS = {
    CN: [[9 * 60 + 30, 11 * 60 + 30], [13 * 60, 15 * 60]],
    HK: [[9 * 60 + 30, 12 * 60], [13 * 60, 16 * 60 + 10]],
    US: [[9 * 60 + 30, 16 * 60]],
};

// 采集时段：A 股从 09:25 开始（集合竞价结果已出），其余与交易时段一致
const COLLECT_SESSIONS = {
    CN: [[9 * 60 + 25, 11 * 60 + 30], [13 * 60, 15 * 60]],
    HK: SESSIONS.HK,
    US: SESSIONS.US,
};

// 旧版 isTradingHours 的宽松窗口（用于缓存 TTL，保持原有行为）
const LEGACY_WINDOWS = {
    CN: [[9 * 60 + 15, 15 * 60 + 5]],
    HK: [[9 * 60 + 30, 12 * 60], [13 * 60, 16 * 60 + 10]],
    US: [[9 * 60, 16 * 60 + 30]],
};

const WEEKDAY_MAP = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const _fmtCache = {};

function _formatter(tz) {
    if (!_fmtCache[tz]) {
        _fmtCache[tz] = new Intl.DateTimeFormat('en-US', {
            timeZone: tz, hour12: false, weekday: 'short',
            year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
        });
    }
    return _fmtCache[tz];
}

/** 取某时刻在指定时区的日期时间分量 */
function zonedParts(date, tz) {
    const parts = {};
    for (const p of _formatter(tz).formatToParts(date)) parts[p.type] = p.value;
    const hour = parts.hour === '24' ? 0 : parseInt(parts.hour, 10);
    return {
        year: parseInt(parts.year, 10),
        month: parseInt(parts.month, 10),
        day: parseInt(parts.day, 10),
        hour,
        minute: parseInt(parts.minute, 10),
        weekday: WEEKDAY_MAP[parts.weekday],
        minutes: hour * 60 + parseInt(parts.minute, 10),
        date: `${parts.year}-${parts.month}-${parts.day}`,
    };
}

/** 把各种市场写法归一为 CN / HK / US */
function normalizeMarket(market) {
    const m = String(market || '').toUpperCase();
    if (m === 'US') return 'US';
    if (m === 'HK' || m === 'HI') return 'HK';
    return 'CN';
}

function _inWindows(minutes, windows) {
    return windows.some(([s, e]) => minutes >= s && minutes < e);
}

/** 交易所当地日期 YYYY-MM-DD（美股按美东日期归属） */
function exchangeDate(market, date = new Date()) {
    const mk = normalizeMarket(market);
    return zonedParts(date, MARKET_TZ[mk]).date;
}

function _isWeekday(p) {
    return p.weekday >= 1 && p.weekday <= 5;
}

/** 是否处于精确交易时段 */
function isSessionOpen(market, date = new Date()) {
    const mk = normalizeMarket(market);
    const p = zonedParts(date, MARKET_TZ[mk]);
    return _isWeekday(p) && _inWindows(p.minutes, SESSIONS[mk]);
}

/** 是否处于采集时段（A 股从 09:25 起） */
function isCollectWindow(market, date = new Date()) {
    const mk = normalizeMarket(market);
    const p = zonedParts(date, MARKET_TZ[mk]);
    return _isWeekday(p) && _inWindows(p.minutes, COLLECT_SESSIONS[mk]);
}

/**
 * 市场阶段：open 交易中 / break 午休 / pre 盘前 / closed 已收盘 / weekend 周末
 */
function marketPhase(market, date = new Date()) {
    const mk = normalizeMarket(market);
    const p = zonedParts(date, MARKET_TZ[mk]);
    if (!_isWeekday(p)) return 'weekend';
    const sessions = SESSIONS[mk];
    if (_inWindows(p.minutes, sessions)) return 'open';
    if (p.minutes < sessions[0][0]) return 'pre';
    if (p.minutes >= sessions[sessions.length - 1][1]) return 'closed';
    return 'break';
}

/** 当日收盘时刻（交易所当地分钟数） */
function closeMinutes(market) {
    const s = SESSIONS[normalizeMarket(market)];
    return s[s.length - 1][1];
}

/**
 * 下一次进入采集时段的时间（毫秒时间戳）。当前已在采集时段内则返回当前时间。
 * 以 5 分钟步长向前查找（所有时段边界都是 5 分钟整数倍），最多 5 天。
 */
function nextCollectOpenAt(market, from = new Date()) {
    if (isCollectWindow(market, from)) return from.getTime();
    const step = 5 * 60 * 1000;
    let t = Math.ceil(from.getTime() / step) * step;
    const limit = from.getTime() + 5 * 24 * 3600 * 1000;
    while (t < limit) {
        if (isCollectWindow(market, new Date(t))) return t;
        t += step;
    }
    return limit;
}

/**
 * 兼容旧接口：是否处于交易时段（宽松窗口，用于缓存 TTL）
 * @param {string|string[]|undefined} markets 'CN' | 'HK' | 'US'；undefined 时只看 A 股
 */
function isTradingHours(markets) {
    const list = markets === undefined ? ['CN'] : (Array.isArray(markets) ? markets : [markets]);
    const now = new Date();
    return list.some(m => {
        const mk = normalizeMarket(m);
        const p = zonedParts(now, MARKET_TZ[mk]);
        return _isWeekday(p) && _inWindows(p.minutes, LEGACY_WINDOWS[mk]);
    });
}

/** 市场状态快照（供前端读取） */
function getMarketStatus(date = new Date()) {
    const out = { serverTime: date.toISOString() };
    for (const mk of ['CN', 'HK', 'US']) {
        const p = zonedParts(date, MARKET_TZ[mk]);
        out[mk] = {
            open: isSessionOpen(mk, date),
            phase: marketPhase(mk, date),
            tradeDate: p.date,
            localTime: `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`,
            timeZone: MARKET_TZ[mk],
        };
    }
    out.anyOpen = out.CN.open || out.HK.open || out.US.open;
    return out;
}

module.exports = {
    MARKET_TZ,
    SESSIONS,
    zonedParts,
    normalizeMarket,
    exchangeDate,
    isSessionOpen,
    isCollectWindow,
    marketPhase,
    closeMinutes,
    nextCollectOpenAt,
    isTradingHours,
    getMarketStatus,
};
