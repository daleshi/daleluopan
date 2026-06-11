/**
 * 数据采集服务 - 从多个公开金融数据源获取指数数据
 * 数据源:
 *   1. 雪球基金 / 蛋卷基金 (danjuanfunds.com) — PE/PB/百分位/股息率/ROE（Wind）
 *   2. 动态估值来源池（按实时可用性筛选） — 天天基金 / ETF.run / 亿牛网 等
 *   3. 东方财富 push2 / push2his            — 实时行情与历史K线
 *   4. 知有行                               — 指数温度计
 */
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const iconv = require('iconv-lite');

// ============================================================
// 完整的 A股 + 港股 宽基指数候选池
//   secid    : 东方财富行情接口用的代码 (市场.代码)
//   djCode   : 蛋卷基金估值接口中的 index_code
//   csCode   : 中证指数官网用的代码
//   altSecids: 东方财富 secid 的备选编码
//   category : 分类标签 (broad-cn / broad-hk / industry)
// ============================================================
const FULL_INDEX_POOL = [
    // ── A股宽基指数 ──
    {
        name: '上证指数', code: '000001', secid: '1.000001', market: 'SH',
        djCode: 'SH000001', csCode: '000001',
        icon: '上证', iconBg: 'linear-gradient(135deg, #7f9cf5, #4c51bf)', iconColor: '#fff',
        category: 'broad-cn', desc: '上证综合指数，代表沪市整体',
    },
    {
        name: '沪深300', code: '000300', secid: '1.000300', market: 'SH',
        djCode: 'SH000300', csCode: '000300',
        etfRunPath: '/index/SSE/000300', eniuPath: '/gu/sz399300',
        icon: '300', iconBg: 'linear-gradient(135deg, #63b3ed, #3182ce)', iconColor: '#fff',
        category: 'broad-cn', desc: '沪深两市市值最大的300只股票',
    },
    {
        name: '中证500', code: '000905', secid: '1.000905', market: 'SH',
        djCode: 'SH000905', csCode: '000905',
        etfRunPath: '/index/SSE/000905', eniuPath: '/gu/sh000905',
        icon: '500', iconBg: 'linear-gradient(135deg, #b794f4, #805ad5)', iconColor: '#fff',
        category: 'broad-cn', desc: '中盘股代表，沪深300之后的500只',
    },
    {
        name: '中证1000', code: '000852', secid: '1.000852', market: 'SH',
        djCode: 'SH000852', csCode: '000852',
        etfRunPath: '/index/SSE/000852',
        icon: '1K', iconBg: 'linear-gradient(135deg, #9f7aea, #6b46c1)', iconColor: '#fff',
        category: 'broad-cn', desc: '小盘股代表，中证500之后的1000只',
    },
    {
        name: '中证A500', code: '000510', secid: '1.000510', market: 'SH',
        djCode: 'SH000510', csCode: '000510',
        icon: 'A5', iconBg: 'linear-gradient(135deg, #76e4f7, #0bc5ea)', iconColor: '#fff',
        category: 'broad-cn', desc: '中证A500指数，覆盖各行业龙头',
    },
    {
        name: '上证50', code: '000016', secid: '1.000016', market: 'SH',
        djCode: 'SH000016', csCode: '000016',
        etfRunPath: '/index/SSE/000016', eniuPath: '/gu/sh000016',
        icon: '50', iconBg: 'linear-gradient(135deg, #f687b3, #d53f8c)', iconColor: '#fff',
        category: 'broad-cn', desc: '上交所市值最大、流动性最好的50只',
    },
    {
        name: '创业板指', code: '399006', secid: '0.399006', market: 'SZ',
        djCode: 'SZ399006', csCode: '399006',
        etfRunPath: '/index/SZSE/399006', eniuPath: '/gu/sz399006',
        icon: '创', iconBg: 'linear-gradient(135deg, #fc8181, #e53e3e)', iconColor: '#fff',
        category: 'broad-cn', desc: '创业板市场代表性指数',
    },
    {
        name: '科创50', code: '000688', secid: '1.000688', market: 'SH',
        djCode: 'SH000688', csCode: '000688',
        etfRunPath: '/index/SSE/000688',
        icon: '科', iconBg: 'linear-gradient(135deg, #fbd38d, #ed8936)', iconColor: '#fff',
        category: 'broad-cn', desc: '科创板最具代表性的50只证券',
    },
    {
        name: '中证红利', code: '000922', secid: '1.000922', market: 'SH',
        djCode: 'SH000922', csCode: '000922',
        etfRunPath: '/index/CSI/000922',
        icon: '红利', iconBg: 'linear-gradient(135deg, #fc8181, #e53e3e)', iconColor: '#fff',
        category: 'broad-cn', desc: '高股息策略代表指数',
    },
    {
        name: '中证红利低波', code: 'H30269', secid: '2.H30269', market: 'CSI',
        djCode: 'CSIH30269', csCode: 'H30269',
        etfRunPath: '/index/CSI/H30269',
        icon: '低波', iconBg: 'linear-gradient(135deg, #f6ad55, #dd6b20)', iconColor: '#fff',
        altSecids: ['1.H30269', '0.930955'],
        category: 'broad-cn', desc: '红利低波动策略指数',
    },
    {
        name: '中证消费', code: '000932', secid: '1.000932', market: 'SH',
        djCode: 'SH000932', csCode: '000932',
        etfRunPath: '/index/SSE/000932',
        icon: '消费', iconBg: 'linear-gradient(135deg, #68d391, #38a169)', iconColor: '#fff',
        category: 'broad-cn', desc: '消费行业代表性指数',
    },
    {
        name: '深证成指', code: '399001', secid: '0.399001', market: 'SZ',
        djCode: 'SZ399001', csCode: '399001',
        eniuPath: '/gu/sz399001',
        icon: '深成', iconBg: 'linear-gradient(135deg, #90cdf4, #4299e1)', iconColor: '#fff',
        category: 'broad-cn', desc: '深圳交易所核心指数',
    },
    {
        name: '中证全指', code: '000985', secid: '1.000985', market: 'SH',
        djCode: 'SH000985', csCode: '000985',
        icon: '全A', iconBg: 'linear-gradient(135deg, #a0aec0, #718096)', iconColor: '#fff',
        category: 'broad-cn', desc: '全市场A股综合指数',
    },
    {
        name: '中证800', code: '000906', secid: '1.000906', market: 'SH',
        djCode: 'SH000906', csCode: '000906',
        icon: '800', iconBg: 'linear-gradient(135deg, #c4b5fd, #8b5cf6)', iconColor: '#fff',
        category: 'broad-cn', desc: '沪深300+中证500合并，大中盘',
    },
    {
        name: 'MSCI中国A50', code: '930050', secid: '1.930050', market: 'SH',
        djCode: 'SH930050', csCode: '930050',
        icon: 'A50', iconBg: 'linear-gradient(135deg, #fcd34d, #f59e0b)', iconColor: '#fff',
        category: 'broad-cn', desc: 'MSCI中国A50互联互通指数',
    },
    {
        name: '国证2000', code: '399303', secid: '0.399303', market: 'SZ',
        djCode: 'SZ399303', csCode: '399303',
        icon: '2K', iconBg: 'linear-gradient(135deg, #c084fc, #a855f7)', iconColor: '#fff',
        category: 'broad-cn', desc: '超小盘指数，代表微盘股',
    },
    // ── 港股宽基指数 ──
    {
        name: '恒生指数', code: 'HSI', secid: '100.HSI', market: 'HI',
        djCode: 'HKHSI', csCode: 'HSI',
        icon: '恒指', iconBg: 'linear-gradient(135deg, #ed8936, #c05621)', iconColor: '#fff',
        altSecids: ['124.HSI'],
        category: 'broad-hk', desc: '香港蓝筹股代表，港股旗舰指数',
    },
    {
        name: '恒生科技', code: 'HSTECH', secid: '100.HSTECH', market: 'HI',
        djCode: 'HKHSTECH', csCode: 'HSTECH',
        icon: '科技', iconBg: 'linear-gradient(135deg, #4fd1c5, #319795)', iconColor: '#fff',
        altSecids: ['128.HSTECH', '124.HSTECH'],
        category: 'broad-hk', desc: '港股科技龙头30只',
    },
    {
        name: '恒生中国企业', code: 'HSCEI', secid: '100.HSCEI', market: 'HI',
        djCode: 'HKHSCEI', csCode: 'HSCEI',
        icon: 'H股', iconBg: 'linear-gradient(135deg, #f6ad55, #dd6b20)', iconColor: '#fff',
        altSecids: ['124.HSCEI'],
        category: 'broad-hk', desc: '国企指数，在港上市中国企业',
    },
    {
        name: '恒生国企精明', code: 'HSSCNE', secid: '100.HSSCNE', market: 'HI',
        djCode: 'HKHSSCNE', csCode: 'HSSCNE',
        icon: '国企', iconBg: 'linear-gradient(135deg, #90cdf4, #3182ce)', iconColor: '#fff',
        altSecids: ['124.HSSCNE'],
        category: 'broad-hk', desc: '恒生中国内地企业高股息低波动',
    },
    // ── 美股宽基指数 ──
    {
        name: '标普500', code: 'SPX', secid: '100.SPX', market: 'US',
        djCode: null, csCode: null,
        txCode: 'usINX', txKlineCode: 'us.INX', sinaCode: 'gb_$inx',
        yahooCode: '^GSPC',
        icon: 'S&P', iconBg: 'linear-gradient(135deg, #667eea, #764ba2)', iconColor: '#fff',
        // 美股估值参考基准（基于历史数据，定期人工更新）
        // Shiller PE 历史中位数 ~17, 长期均值 ~17; 传统PE均值 ~20
        usValuation: {
            peHistoricalMedian: 20, peHistoricalMean: 22,
            shillerPeMedian: 17, shillerPeMean: 17,
        },
        category: 'broad-us', desc: '美国500家大型上市公司',
    },
    {
        name: '纳斯达克100', code: 'NDX', secid: '100.NDX', market: 'US',
        djCode: null, csCode: null,
        txCode: 'usNDX', txKlineCode: 'us.NDX', sinaCode: 'gb_$ndx',
        yahooCode: '^NDX',
        icon: 'NDX', iconBg: 'linear-gradient(135deg, #00d2ff, #3a7bd5)', iconColor: '#fff',
        usValuation: {
            peHistoricalMedian: 28, peHistoricalMean: 30,
            shillerPeMedian: 25, shillerPeMean: 27,
        },
        category: 'broad-us', desc: '纳斯达克市场100家最大非金融公司',
    },
];

// ============================================================
// 默认选中的核心指数代码 (code.market) — 新用户首次访问时的选择
// ============================================================
const DEFAULT_SELECTED_CODES = [
    '000300.SH',   // 沪深300
    '000905.SH',   // 中证500
    '000922.SH',   // 中证红利
    'H30269.CSI',  // 中证红利低波
    '000932.SH',   // 中证消费
    'HSTECH.HI',   // 恒生科技
];

// 仅在 Dashboard 总览页额外显示行情（不参与估值分析）
const DASHBOARD_ONLY_CODES = ['000001.SH'];

// ============================================================
// 构建候选池快速索引 (code.market → config)
// ============================================================
const POOL_MAP = {};
for (const cfg of FULL_INDEX_POOL) {
    POOL_MAP[`${cfg.code}.${cfg.market}`] = cfg;
}

// ============================================================
// 根据用户选中的 code.market 列表，生成对应的 CONFIG 数组
// ============================================================
function buildIndexConfig(selectedCodes) {
    const codes = Array.isArray(selectedCodes) && selectedCodes.length > 0
        ? selectedCodes
        : DEFAULT_SELECTED_CODES;
    return codes.map(key => POOL_MAP[key]).filter(Boolean);
}

function buildDashboardOnlyConfig(selectedCodes) {
    const coreSet = new Set(selectedCodes || DEFAULT_SELECTED_CODES);
    return DASHBOARD_ONLY_CODES
        .filter(key => !coreSet.has(key) && POOL_MAP[key])
        .map(key => ({ ...POOL_MAP[key], dashboardOnly: true }));
}

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
};

const DS_CONFIG_FILE = path.join(__dirname, '..', 'data', 'datasource-config.json');
const DATA_SOURCE_DEFAULTS = {
    'danjuan-wind': true,
    eastmoney: true,
    youzhiyouxing: true,
    tiantian: true,
    etfrun: true,
    eniu: true,
    csindex: true,
    tencent: true,
    tushare: false,
    akshare: false,
};

function readEnabledDataSources() {
    try {
        if (fs.existsSync(DS_CONFIG_FILE)) {
            const raw = fs.readFileSync(DS_CONFIG_FILE, 'utf8');
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed.enabled === 'object') {
                const normalized = {};
                for (const [key, value] of Object.entries(parsed.enabled)) {
                    normalized[key] = !!value;
                }
                return { ...DATA_SOURCE_DEFAULTS, ...normalized };
            }
        }
    } catch (err) {
        console.warn('  [数据源配置] 读取失败，使用默认配置:', err.message);
    }
    return { ...DATA_SOURCE_DEFAULTS };
}

const KLINE_SOURCE_CACHE_TTL = {
    eastmoney: 12 * 60 * 60 * 1000,
    tencent: 20 * 60 * 1000,
};
const KLINE_FAILURE_COOLDOWN = 10 * 60 * 1000;
const _klineCache = new Map();
let _eastmoneyKlineCooldownUntil = 0;

function getFreshKlinesEntry(cacheKey) {
    const hit = _klineCache.get(cacheKey);
    if (!hit || !Array.isArray(hit.klines) || hit.klines.length === 0) {
        return null;
    }
    const ttl = KLINE_SOURCE_CACHE_TTL[hit.source] || KLINE_SOURCE_CACHE_TTL.tencent;
    return (Date.now() - hit.time) < ttl ? hit : null;
}

function getFreshKlines(cacheKey) {
    return getFreshKlinesEntry(cacheKey)?.klines || null;
}

function getStaleKlinesEntry(cacheKey) {
    const hit = _klineCache.get(cacheKey);
    return hit && Array.isArray(hit.klines) && hit.klines.length > 0 ? hit : null;
}

function getStaleKlines(cacheKey) {
    return getStaleKlinesEntry(cacheKey)?.klines || null;
}

function setCachedKlines(cacheKey, klines, source) {
    if (!Array.isArray(klines) || klines.length === 0) {
        return;
    }
    _klineCache.set(cacheKey, {
        klines,
        source,
        time: Date.now(),
    });
}

function eastmoneyKlineInCooldown() {
    return Date.now() < _eastmoneyKlineCooldownUntil;
}

function markEastmoneyKlineCooldown(reason) {
    const nextUntil = Date.now() + KLINE_FAILURE_COOLDOWN;
    if (nextUntil > _eastmoneyKlineCooldownUntil) {
        _eastmoneyKlineCooldownUntil = nextUntil;
        console.warn(`  [K线] 东方财富历史K线进入 ${Math.round(KLINE_FAILURE_COOLDOWN / 60000)} 分钟冷却: ${reason}`);
    }
}

// ============================================================
// K 线源健康监控（重启清零，无持久化）
// ============================================================
const KLINE_HEALTH_RECENT_FAILURE_LIMIT = 50;
const KLINE_HEALTH_CHECK_INTERVAL_MS = 30 * 60 * 1000;
const KLINE_HEALTH_ALERT_WINDOW_MS = 60 * 60 * 1000;
const KLINE_HEALTH_ALERT_MIN_AFFECTED_CODES = 3;

const _klineSourceHealth = {
    eastmoney: { success: 0, failure: 0, lastSuccessAt: null, lastFailureAt: null, recentFailures: [] },
    tencent:   { success: 0, failure: 0, lastSuccessAt: null, lastFailureAt: null, recentFailures: [] },
    yahoo:     { success: 0, failure: 0, lastSuccessAt: null, lastFailureAt: null, recentFailures: [] },
};

function recordKlineSourceSuccess(source, code) {
    const h = _klineSourceHealth[source];
    if (!h) return;
    h.success++;
    h.lastSuccessAt = Date.now();
}

function recordKlineSourceFailure(source, code, errMsg) {
    const h = _klineSourceHealth[source];
    if (!h) return;
    h.failure++;
    h.lastFailureAt = Date.now();
    h.recentFailures.push({ code: String(code || ''), time: Date.now(), err: String(errMsg || '').slice(0, 200) });
    if (h.recentFailures.length > KLINE_HEALTH_RECENT_FAILURE_LIMIT) {
        h.recentFailures.shift();
    }
}

function getKlineSourceHealthSnapshot() {
    const out = {};
    for (const [src, h] of Object.entries(_klineSourceHealth)) {
        const total = h.success + h.failure;
        out[src] = {
            success: h.success,
            failure: h.failure,
            successRate: total > 0 ? parseFloat((h.success / total).toFixed(4)) : null,
            lastSuccessAt: h.lastSuccessAt ? new Date(h.lastSuccessAt).toISOString() : null,
            lastFailureAt: h.lastFailureAt ? new Date(h.lastFailureAt).toISOString() : null,
            recentFailures: h.recentFailures.map(f => ({
                code: f.code,
                time: new Date(f.time).toISOString(),
                err: f.err,
            })),
        };
    }
    return out;
}

function checkKlineSourceHealth() {
    const cutoff = Date.now() - KLINE_HEALTH_ALERT_WINDOW_MS;
    for (const [src, h] of Object.entries(_klineSourceHealth)) {
        const recent = h.recentFailures.filter(f => f.time > cutoff);
        if (recent.length === 0) continue;
        const codes = [...new Set(recent.map(f => f.code).filter(Boolean))];
        if (codes.length >= KLINE_HEALTH_ALERT_MIN_AFFECTED_CODES) {
            console.warn(`[K线健康] ${src} 最近 1 小时失败 ${recent.length} 次，影响 ${codes.length} 个指数: ${codes.join(',')}`);
        }
    }
}

let _klineHealthMonitorTimer = null;
function startKlineSourceHealthMonitor() {
    if (_klineHealthMonitorTimer) return _klineHealthMonitorTimer;
    _klineHealthMonitorTimer = setInterval(checkKlineSourceHealth, KLINE_HEALTH_CHECK_INTERVAL_MS);
    if (_klineHealthMonitorTimer.unref) _klineHealthMonitorTimer.unref(); // 不阻止进程退出
    return _klineHealthMonitorTimer;
}

function stopKlineSourceHealthMonitor() {
    if (_klineHealthMonitorTimer) {
        clearInterval(_klineHealthMonitorTimer);
        _klineHealthMonitorTimer = null;
    }
}

function isEastmoneyKlineTransientError(err) {
    const message = String(err?.message || '');
    return /socket hang up|ECONNRESET|ETIMEDOUT|timeout|network|HTTP 429|HTTP 403|HTTP 5\d\d/i.test(message);
}

function uniqueValues(values) {
    return [...new Set((values || []).filter(Boolean))];
}

function isSpecialCSIIndex(cfg) {
    return cfg?.market === 'CSI' && /[A-Za-z]/.test(String(cfg?.code || ''));
}

function buildIndexKlineProfile(cfg) {
    const specialCSI = isSpecialCSIIndex(cfg);
    const secids = uniqueValues([
        specialCSI ? `2.${cfg.code}` : null,
        cfg.secid,
        ...(cfg.altSecids || []),
    ]);
    return {
        primarySecid: secids[0] || cfg.secid,
        altSecids: secids.slice(1),
        bypassGlobalCooldown: specialCSI,
        allowTencentFallback: !specialCSI,
        specialCSI,
    };
}

function createKlineRefreshStatus(partial = {}) {
    return {
        state: partial.state || 'primary-live',
        label: partial.label || '主源直连',
        source: partial.source || 'eastmoney',
        usedStaleCache: !!partial.usedStaleCache,
        inCooldown: !!partial.inCooldown,
        fallbackActive: !!partial.fallbackActive,
        specialSource: !!partial.specialSource,
        sourceSecid: partial.sourceSecid || null,
    };
}

function summarizeKlineRefreshStatuses(statuses = []) {
    const list = statuses.filter(Boolean);
    const staleCacheCount = list.filter(item => item.usedStaleCache).length;
    const cooldownCount = list.filter(item => item.inCooldown).length;
    const fallbackCount = list.filter(item => item.fallbackActive).length;
    const specialSourceCount = list.filter(item => item.specialSource).length;
    const details = [];
    if (staleCacheCount > 0) details.push(`已回退缓存 ${staleCacheCount} 项`);
    if (cooldownCount > 0) details.push(`主源冷却中 ${cooldownCount} 项`);
    if (fallbackCount > 0) details.push(`备用源生效中 ${fallbackCount} 项`);
    if (specialSourceCount > 0) details.push(`特殊指数专用源 ${specialSourceCount} 项`);

    return {
        staleCacheCount,
        cooldownCount,
        fallbackCount,
        specialSourceCount,
        summaryText: details.length > 0 ? details.join(' · ') : '主源直连稳定',
        degraded: staleCacheCount > 0 || cooldownCount > 0 || fallbackCount > 0,
    };
}

// 通用安全 fetch，带自动重试
async function safeFetch(url, options = {}, retries = 2) {
    for (let i = 0; i <= retries; i++) {
        try {
            const res = await fetch(url, { timeout: 15000, ...options });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res;
        } catch (err) {
            if (i === retries) throw err;
            // socket hang up / ECONNRESET 时等更长时间
            const isConnectionReset = /socket hang up|ECONNRESET|ETIMEDOUT/i.test(err.message);
            await new Promise(r => setTimeout(r, isConnectionReset ? 2000 * (i + 1) : 600 * (i + 1)));
        }
    }
}

// ============================================================
// 1. 蛋卷基金（雪球基金）指数估值 API
//    数据来源: Wind — 最权威的金融数据
//    返回: PE/PB/PE百分位/PB百分位/ROE/股息率/估值状态
// ============================================================
let _djEvaCache = null;
let _djEvaCacheTime = 0;

async function fetchDanjuanEvaluation() {
    // 缓存 3 分钟
    if (_djEvaCache && Date.now() - _djEvaCacheTime < 180000) {
        return _djEvaCache;
    }

    const url = 'https://danjuanfunds.com/djapi/index_eva/dj';
    try {
        const res = await safeFetch(url, {
            headers: {
                ...HEADERS,
                'Referer': 'https://danjuanfunds.com/djmodule/value-center',
                'Host': 'danjuanfunds.com',
            },
        });
        const data = await res.json();
        if (data?.data?.items?.length > 0) {
            const map = {};
            for (const item of data.data.items) {
                map[item.index_code] = {
                    name: item.name || null,
                    pe: item.pe || null,
                    pb: item.pb || null,
                    pePercentile: item.pe_percentile != null ? parseFloat((item.pe_percentile * 100).toFixed(2)) : null,
                    pbPercentile: item.pb_percentile != null ? parseFloat((item.pb_percentile * 100).toFixed(2)) : null,
                    roe: item.roe != null ? parseFloat((item.roe * 100).toFixed(2)) : null,
                    dividend: item.yeild != null ? parseFloat((item.yeild * 100).toFixed(2)) : null,
                    evaType: item.eva_type,  // low / mid / high
                    peg: item.peg || null,
                    peOverHistory: item.pe_over_history,  // PE超过历史多少比例
                    pbOverHistory: item.pb_over_history,
                    pbFlag: item.pb_flag,  // 是否应该用PB估值
                    date: item.date,
                    source: 'danjuan-wind',
                };
            }
            console.log(`  [蛋卷基金] 获取 ${Object.keys(map).length} 个指数估值数据`);
            _djEvaCache = map;
            _djEvaCacheTime = Date.now();
            return map;
        }
    } catch (err) {
        console.warn('  [蛋卷基金] 估值接口失败:', err.message);
    }
    return {};
}

function parseMaybeNumber(value) {
    if (value == null) return null;
    const n = parseFloat(String(value).replace(/,/g, '').trim());
    return Number.isFinite(n) ? n : null;
}

function hasValuationPayload(item) {
    return !!(item && (
        item.pe != null ||
        item.pb != null ||
        item.pePercentile != null ||
        item.pbPercentile != null ||
        item.dividend != null ||
        item.roe != null
    ));
}

async function fetchETFRunValuation(cfg) {
    if (!cfg.etfRunPath) return null;
    const url = `https://www.etf.run${cfg.etfRunPath}`;
    try {
        const res = await safeFetch(url, {
            headers: {
                ...HEADERS,
                Referer: 'https://www.etf.run/',
                Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Encoding': 'gzip, deflate, br',
            },
        }, 1);
        const html = await res.text();
        const metaMatch = html.match(/<meta\s+name="description"\s+content="([^"]+)"/i);
        const desc = metaMatch ? metaMatch[1] : '';
        const pe = parseMaybeNumber((desc.match(/当前PE：([\d.]+)倍/i) || [])[1]);
        const pb = parseMaybeNumber((desc.match(/PB：([\d.]+)倍/i) || [])[1]);
        const updateDate = (desc.match(/更新时间：([0-9-]+)/i) || [])[1] || null;
        if (pe == null && pb == null) return null;
        return {
            pe,
            pb,
            updateDate,
            source: 'ETF.run',
            sourceUrl: url,
        };
    } catch (err) {
        console.warn(`  [ETF.run] ${cfg.name} 获取失败:`, err.message);
        return null;
    }
}

async function fetchEniuValuation(cfg) {
    if (!cfg.eniuPath) return null;
    const url = `https://eniu.com${cfg.eniuPath}`;
    try {
        const res = await safeFetch(url, {
            headers: {
                ...HEADERS,
                Referer: 'https://eniu.com/',
                Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            },
        }, 1);
        const html = await res.text();
        if (/未收录此股票（基金）|未收录此股票/i.test(html)) {
            return null;
        }
        const pe = parseMaybeNumber((html.match(/市盈率：<a[^>]*>([\d.]+)<\/a>/i) || [])[1]);
        const dividend = parseMaybeNumber((html.match(/股息率：<a[^>]*>([\d.]+)<\/a>/i) || [])[1]);
        const pePercentile = parseMaybeNumber((html.match(/近10年：([\d.]+)%<\/p>/i) || [])[1]);
        if (pe == null && pePercentile == null) return null;
        return {
            pe,
            dividend,
            pePercentile,
            source: '亿牛网',
            sourceUrl: url,
        };
    } catch (err) {
        console.warn(`  [亿牛网] ${cfg.name} 获取失败:`, err.message);
        return null;
    }
}

let _ttEvaCache = null;
let _ttEvaCacheTime = 0;
let _ttEvaLastFailureTime = 0;

async function fetchTiantianValuationMap() {
    const now = Date.now();
    const cacheAge = now - _ttEvaCacheTime;
    if (_ttEvaCache && cacheAge < 5 * 60 * 1000) {
        return _ttEvaCache;
    }

    if (_ttEvaLastFailureTime && (now - _ttEvaLastFailureTime) < 5 * 60 * 1000) {
        if (_ttEvaCache) {
            console.log('  [天天基金] 最近波动较大，继续使用上次成功缓存');
            return _ttEvaCache;
        }
        console.log('  [天天基金] 最近连续失败，暂时跳过重试');
        return {};
    }

    const url = 'https://fundmobapi.eastmoney.com/FundMNewApi/FundMNIndexValuationList?pageIndex=1&pageSize=100';
    try {
        const res = await safeFetch(url, {
            headers: {
                ...HEADERS,
                Referer: 'https://unitmob.1234567.com.cn/zsgz/index.html',
                Origin: 'https://unitmob.1234567.com.cn',
                Accept: 'application/json, text/plain, */*',
            },
        }, 1);
        const data = await res.json();
        if (!data?.Success || !Array.isArray(data.Datas)) {
            throw new Error(data?.ErrMsg || '接口返回失败');
        }
        const map = {};
        for (const item of data.Datas) {
            const code = String(item.IndexCode || item.INDEXCODE || item.ZSCode || item.Code || item.code || '').trim().toUpperCase();
            if (!code) continue;
            map[code] = {
                name: item.IndexName || item.NAME || item.Name || item.ZSName || null,
                pe: parseMaybeNumber(item.PE ?? item.pe ?? item.PERatio ?? item.peValue),
                pb: parseMaybeNumber(item.PB ?? item.pb ?? item.PBRatio ?? item.pbValue),
                pePercentile: parseMaybeNumber(item.PEPercentile ?? item.pePercentile ?? item.PERank ?? item.peRank),
                pbPercentile: parseMaybeNumber(item.PBPercentile ?? item.pbPercentile ?? item.PBRank ?? item.pbRank),
                source: '天天基金',
                sourceUrl: 'https://unitmob.1234567.com.cn/zsgz/index.html',
            };
        }
        _ttEvaCache = map;
        _ttEvaCacheTime = Date.now();
        _ttEvaLastFailureTime = 0;
        return map;
    } catch (err) {
        _ttEvaLastFailureTime = Date.now();
        console.warn('  [天天基金] 估值接口失败:', err.message);
        if (_ttEvaCache) {
            console.warn('  [天天基金] 已降级为上次成功缓存结果');
            return _ttEvaCache;
        }
        return {};
    }
}

async function fetchComparisonSources(coreConfigs, djEvaMap) {
    const fullCode = cfg => `${cfg.code}.${cfg.market}`;
    const dsEnabled = readEnabledDataSources();
    const candidateDefs = [
        {
            id: 'danjuan',
            configKey: 'danjuan-wind',
            name: '雪球基金(Wind)',
            website: 'https://danjuanfunds.com/djmodule/value-center',
            color: '#63b3ed',
            metricText: 'PE / PB / 百分位 / ROE / 股息率',
            priority: 100,
            fetchMap: async () => {
                const map = {};
                for (const cfg of coreConfigs) {
                    const dj = cfg.djCode ? djEvaMap[cfg.djCode] : null;
                    if (hasValuationPayload(dj)) {
                        map[fullCode(cfg)] = {
                            pe: dj.pe,
                            pb: dj.pb,
                            pePercentile: dj.pePercentile,
                            pbPercentile: dj.pbPercentile,
                            roe: dj.roe,
                            dividend: dj.dividend,
                            evaType: dj.evaType,
                            updateDate: dj.date || null,
                            sourceUrl: 'https://danjuanfunds.com/djmodule/value-center',
                        };
                    }
                }
                return map;
            },
        },
        {
            id: 'tiantian',
            configKey: 'tiantian',
            name: '天天基金',
            website: 'https://unitmob.1234567.com.cn/zsgz/index.html',
            color: '#ed8936',
            metricText: 'PE / PB / 百分位',
            priority: 80,
            fetchMap: async () => {
                const raw = await fetchTiantianValuationMap();
                const map = {};
                for (const cfg of coreConfigs) {
                    const keysToTry = [cfg.code, cfg.csCode, cfg.djCode].filter(Boolean).map(v => String(v).toUpperCase());
                    const hit = keysToTry.map(key => raw[key]).find(Boolean);
                    if (hasValuationPayload(hit)) {
                        map[fullCode(cfg)] = hit;
                    }
                }
                return map;
            },
        },
        {
            id: 'etfrun',
            configKey: 'etfrun',
            name: 'ETF.run',
            website: 'https://www.etf.run',
            color: '#68d391',
            metricText: 'PE / PB',
            priority: 70,
            fetchMap: async () => {
                const pairs = await Promise.all(coreConfigs.map(async cfg => [fullCode(cfg), await fetchETFRunValuation(cfg)]));
                return Object.fromEntries(pairs.filter(([, value]) => hasValuationPayload(value)));
            },
        },
        {
            id: 'eniu',
            configKey: 'eniu',
            name: '亿牛网',
            website: 'https://eniu.com',
            color: '#b794f4',
            metricText: 'PE / 近10年百分位 / 股息率',
            priority: 60,
            fetchMap: async () => {
                const pairs = await Promise.all(coreConfigs.map(async cfg => [fullCode(cfg), await fetchEniuValuation(cfg)]));
                return Object.fromEntries(pairs.filter(([, value]) => hasValuationPayload(value)));
            },
        },
    ].filter(def => dsEnabled[def.configKey] !== false);

    const candidates = await Promise.all(candidateDefs.map(async def => {
        const items = await def.fetchMap();
        const successCount = Object.values(items).filter(hasValuationPayload).length;
        return { ...def, items, successCount };
    }));

    return candidates
        .filter(item => item.successCount > 0)
        .sort((a, b) => (b.successCount - a.successCount) || (b.priority - a.priority))
        .slice(0, 3);
}

// ============================================================
// 2. 中证指数官网估值数据
//    尝试从官网的数据页获取最新 PE/PB
// ============================================================
async function fetchCSIndexValuation(csCode) {
    // 中证指数官网的指数详情API
    const urls = [
        `https://www.csindex.com.cn/csindex-home/perf/index-perf?indexCode=${csCode}&startDate=&endDate=`,
        `https://www.csindex.com.cn/csindex-home/fundamental/index-fundamental?indexCode=${csCode}`,
    ];
    for (const url of urls) {
        try {
            const res = await safeFetch(url, {
                headers: {
                    ...HEADERS,
                    'Referer': 'https://www.csindex.com.cn/',
                    'Origin': 'https://www.csindex.com.cn',
                },
            }, 1);
            const data = await res.json();
            // 尝试解析不同格式的返回
            if (data?.data) {
                const d = Array.isArray(data.data) ? data.data[data.data.length - 1] : data.data;
                const pe = d.pe || d.peTTM || d.pe_ttm || d.PE || null;
                const pb = d.pb || d.pbMRQ || d.pb_mrq || d.PB || null;
                if (pe && pe > 0) {
                    console.log(`  [中证官网] ${csCode} PE=${pe}, PB=${pb}`);
                    return { pe: parseFloat(pe), pb: pb ? parseFloat(pb) : null, source: 'csindex' };
                }
            }
        } catch (e) {
            // try next
        }
    }
    return null;
}

// ============================================================
// 3a. 东方财富 push2 实时行情（批量）
// ============================================================
async function fetchRealtimeQuotesEastmoney(allConfigs) {
    const secids = allConfigs.map(c => buildIndexKlineProfile(c).primarySecid || c.secid).join(',');
    const url = `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=f2,f3,f4,f12,f14,f15,f16,f17,f18&secids=${secids}`;

    const res = await safeFetch(url, { headers: { ...HEADERS, 'Referer': 'https://quote.eastmoney.com/' } });
    const data = await res.json();
    if (data?.data?.diff) {
        const quotes = {};
        data.data.diff.forEach(item => {
            if (item.f2 !== '-') {
                quotes[item.f12] = {
                    price: parseFloat(item.f2),
                    changePercent: parseFloat(item.f3),
                    changeAmount: parseFloat(item.f4),
                    high: parseFloat(item.f15),
                    low: parseFloat(item.f16),
                    open: parseFloat(item.f17),
                    prevClose: parseFloat(item.f18),
                    name: item.f14,
                };
            }
        });
        console.log(`  [行情] 东方财富批量接口获取 ${Object.keys(quotes).length} 条`);
        return quotes;
    }
    return {};
}

// ============================================================
// 3b. 腾讯行情备用源（指数版本）
//     A股指数: sh000300, sz399006 等
//     港股指数: hkHSI, hkHSTECH 等
//     美股指数: usINX, usNDX, usDJI 等
//     字段索引: 3=最新价 4=昨收 5=今开 31=涨跌额 32=涨跌幅 33=最高 34=最低
// ============================================================
async function fetchRealtimeQuotesTencent(allConfigs) {
    // 构造腾讯代码映射
    const codeMap = {}; // txCode → cfg
    const txCodes = [];
    for (const cfg of allConfigs) {
        // 优先使用 POOL 中预配置的腾讯代码
        let txCode = cfg.txCode || null;
        if (!txCode) {
            if (cfg.market === 'SZ') txCode = `sz${cfg.code}`;
            else if (cfg.market === 'SH') txCode = `sh${cfg.code}`;
            else if (cfg.market === 'HI' || cfg.market === 'HK') txCode = `hk${cfg.code}`;
            else if (cfg.market === 'US') txCode = `us${cfg.code}`;
            else if (cfg.market === 'CSI') txCode = `sh${cfg.code}`;
        }
        if (txCode) {
            txCodes.push(txCode);
            codeMap[txCode] = cfg;
        }
    }
    if (txCodes.length === 0) return {};

    const url = `https://qt.gtimg.cn/q=${txCodes.join(',')}`;
    const res = await safeFetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            'Referer': 'https://finance.qq.com/',
        },
    });
    const buf = await res.buffer();
    const text = iconv.decode(buf, 'gbk');
    const quotes = {};

    const lines = text.split('\n').filter(l => l.includes('~'));
    for (const line of lines) {
        const match = line.match(/v_(\w+)="(.+)"/);
        if (!match) continue;
        const txCode = match[1];
        const fields = match[2].split('~');
        const cfg = codeMap[txCode];
        if (!cfg) continue;

        const price = parseFloat(fields[3]) || 0;
        const prevClose = parseFloat(fields[4]) || 0;
        const open = parseFloat(fields[5]) || 0;
        const high = parseFloat(fields[33]) || 0;
        const low = parseFloat(fields[34]) || 0;
        const changePercent = parseFloat(fields[32]) || 0;
        const changeAmount = parseFloat(fields[31]) || 0;

        if (price > 0) {
            const quoteData = {
                price,
                changePercent,
                changeAmount,
                high,
                low,
                open,
                prevClose,
                name: fields[1] || cfg.name,
            };
            // 腾讯扩展字段：52周高低（字段48=52周高, 49=52周低）
            const high52w = parseFloat(fields[48]) || 0;
            const low52w = parseFloat(fields[49]) || 0;
            if (high52w > 0) quoteData.high52w = high52w;
            if (low52w > 0) quoteData.low52w = low52w;
            // 涨幅区间（字段54=近1月, 55=近3月, 59=近1年等，部分指数可用）
            const chg1m = parseFloat(fields[54]);
            const chg3m = parseFloat(fields[55]);
            if (!isNaN(chg1m)) quoteData.changeMonth = chg1m;
            if (!isNaN(chg3m)) quoteData.change3Month = chg3m;
            quotes[cfg.code] = quoteData;
        }
    }
    console.log(`  [行情] 腾讯备用源获取 ${Object.keys(quotes).length} 条`);
    return quotes;
}

// ============================================================
// 3c. 新浪行情备用源（第三道防线）
//     适用于腾讯也挂了的极端场景
// ============================================================
async function fetchRealtimeQuotesSina(allConfigs) {
    // 构造新浪代码
    const sinaCodes = [];
    const codeMap = {}; // sinaCode → cfg
    for (const cfg of allConfigs) {
        // 优先使用 POOL 中预配置的新浪代码
        let sinaCode = cfg.sinaCode || null;
        if (!sinaCode) {
            if (cfg.market === 'SZ') sinaCode = `sz${cfg.code}`;
            else if (cfg.market === 'SH') sinaCode = `sh${cfg.code}`;
            else if (cfg.market === 'HI' || cfg.market === 'HK') sinaCode = `rt_hk${cfg.code}`;
            else if (cfg.market === 'US') sinaCode = `gb_$${cfg.code.toLowerCase()}`;
            else if (cfg.market === 'CSI') sinaCode = `sh${cfg.code}`;
        }
        if (sinaCode) {
            sinaCodes.push(sinaCode);
            codeMap[sinaCode] = cfg;
        }
    }
    if (sinaCodes.length === 0) return {};

    const url = `https://hq.sinajs.cn/list=${sinaCodes.join(',')}`;
    const res = await safeFetch(url, {
        headers: {
            ...HEADERS,
            'Referer': 'https://finance.sina.com.cn/',
        },
    }, 1);
    const text = await res.text();
    const quotes = {};

    const lines = text.split('\n').filter(l => l.includes('='));
    for (const line of lines) {
        // 匹配美股 gb_$xxx 和其他代码格式
        const codeMatch = line.match(/hq_str_([\w$]+)="(.+)"/);
        if (!codeMatch) continue;
        const sinaCode = codeMatch[1];
        const cfg = codeMap[sinaCode];
        if (!cfg) continue;

        const parts = codeMatch[2].split(',');
        // 新浪美股格式: 0=名称 1=最新价 2=涨跌幅% 3=日期 4=涨跌额 5=今开 6=最高 7=最低
        if (cfg.market === 'US') {
            if (parts.length > 7 && parts[1]) {
                const price = parseFloat(parts[1]);
                const prevClose = parseFloat(parts[26]) || 0; // 字段26为昨收
                if (price > 0) {
                    quotes[cfg.code] = {
                        price,
                        changePercent: parseFloat(parts[2]) || 0,
                        changeAmount: parseFloat(parts[4]) || 0,
                        high: parseFloat(parts[6]) || 0,
                        low: parseFloat(parts[7]) || 0,
                        open: parseFloat(parts[5]) || 0,
                        prevClose: prevClose || (price - (parseFloat(parts[4]) || 0)),
                        name: parts[0] || cfg.name,
                    };
                }
            }
            continue;
        }
        // 新浪港股格式: 0=英文名 1=中文名 2=今开 3=昨收 4=最高 5=最低 6=最新 7=涨跌额 8=涨跌幅 ...
        if (cfg.market === 'HI' || cfg.market === 'HK') {
            if (parts.length > 8 && parts[6]) {
                const price = parseFloat(parts[6]);
                const prevClose = parseFloat(parts[3]);
                if (price > 0) {
                    quotes[cfg.code] = {
                        price,
                        changePercent: parseFloat(parts[8]) || (prevClose > 0 ? parseFloat(((price - prevClose) / prevClose * 100).toFixed(2)) : 0),
                        changeAmount: parseFloat(parts[7]) || parseFloat((price - prevClose).toFixed(2)),
                        high: parseFloat(parts[4]) || 0,
                        low: parseFloat(parts[5]) || 0,
                        open: parseFloat(parts[2]) || 0,
                        prevClose,
                        name: parts[1] || cfg.name,
                    };
                }
            }
            continue;
        }
        // 新浪A股格式: 0=名称 1=今开 2=昨收 3=最新 4=最高 5=最低
        if (parts.length > 6 && parts[3]) {
            const price = parseFloat(parts[3]);
            const prevClose = parseFloat(parts[2]);
            if (price > 0) {
                quotes[cfg.code] = {
                    price,
                    changePercent: prevClose > 0 ? parseFloat(((price - prevClose) / prevClose * 100).toFixed(2)) : 0,
                    changeAmount: parseFloat((price - prevClose).toFixed(2)),
                    high: parseFloat(parts[4]) || 0,
                    low: parseFloat(parts[5]) || 0,
                    open: parseFloat(parts[1]) || 0,
                    prevClose,
                    name: parts[0] || cfg.name,
                };
            }
        }
    }
    console.log(`  [行情] 新浪备用源获取 ${Object.keys(quotes).length} 条`);
    return quotes;
}

// ============================================================
// 3d. 新浪非A股单独行情（补漏专用，支持港股和美股）
// ============================================================
async function fetchSingleQuoteSina(cfg) {
    // 构造新浪代码
    let sinaCode = cfg.sinaCode || null;
    if (!sinaCode) {
        if (cfg.market === 'HI' || cfg.market === 'HK') sinaCode = `rt_hk${cfg.code}`;
        else if (cfg.market === 'US') sinaCode = `gb_$${cfg.code.toLowerCase()}`;
        else return null;
    }
    const url = `https://hq.sinajs.cn/list=${sinaCode}`;
    try {
        const res = await safeFetch(url, {
            headers: { ...HEADERS, 'Referer': 'https://finance.sina.com.cn/' },
            timeout: 5000,
        }, 1);
        const text = await res.text();
        const match = text.match(/"(.+)"/);
        if (!match) return null;
        const parts = match[1].split(',');

        // 美股格式: 0=名称 1=最新价 2=涨跌幅% 3=日期 4=涨跌额 5=今开 6=最高 7=最低
        if (cfg.market === 'US') {
            if (parts.length > 7 && parts[1]) {
                const price = parseFloat(parts[1]);
                if (price > 0) {
                    return {
                        price,
                        changePercent: parseFloat(parts[2]) || 0,
                        changeAmount: parseFloat(parts[4]) || 0,
                        high: parseFloat(parts[6]) || 0,
                        low: parseFloat(parts[7]) || 0,
                        open: parseFloat(parts[5]) || 0,
                        prevClose: (price - (parseFloat(parts[4]) || 0)),
                        name: parts[0] || cfg.name,
                    };
                }
            }
            return null;
        }

        // 港股格式: 0=英文名 1=中文名 2=今开 3=昨收 4=最高 5=最低 6=最新 7=涨跌额 8=涨跌幅
        if (parts.length > 8 && parts[6]) {
            const price = parseFloat(parts[6]);
            const prevClose = parseFloat(parts[3]);
            if (price > 0) {
                return {
                    price,
                    changePercent: parseFloat(parts[8]) || (prevClose > 0 ? parseFloat(((price - prevClose) / prevClose * 100).toFixed(2)) : 0),
                    changeAmount: parseFloat(parts[7]) || parseFloat((price - prevClose).toFixed(2)),
                    high: parseFloat(parts[4]) || 0,
                    low: parseFloat(parts[5]) || 0,
                    open: parseFloat(parts[2]) || 0,
                    prevClose,
                    name: parts[1] || cfg.name,
                };
            }
        }
    } catch (e) {
        // skip
    }
    return null;
}

// ============================================================
// 3. 带三级 failover 的指数行情获取
//    东方财富(批量) → 腾讯 → 新浪
// ============================================================
let _lastQuoteSource = 'eastmoney';

async function fetchRealtimeQuotes(allConfigs) {
    let quotes = {};

    // 第一级：东方财富批量
    try {
        quotes = await fetchRealtimeQuotesEastmoney(allConfigs);
        if (Object.keys(quotes).length > 0) {
            _lastQuoteSource = 'eastmoney';
        }
    } catch (err) {
        console.warn('  [行情] 东方财富批量接口失败:', err.message);
    }

    // 补漏：检查是否有缺失的指数（东方财富批量接口不支持港股 secid 100.x，港股必定丢失）
    const missingConfigs = allConfigs.filter(cfg => !quotes[cfg.code]);
    if (missingConfigs.length > 0 && Object.keys(quotes).length > 0) {
        console.log(`  [行情] 东方财富缺失 ${missingConfigs.length} 个指数(${missingConfigs.map(c => c.code).join(',')}), 用腾讯补漏`);
        try {
            const patchQuotes = await fetchRealtimeQuotesTencent(missingConfigs);
            Object.assign(quotes, patchQuotes);
            if (Object.keys(patchQuotes).length > 0) {
                console.log(`  [行情] 腾讯补漏成功: ${Object.keys(patchQuotes).join(',')}`);
            }
        } catch (err) {
            console.warn('  [行情] 腾讯补漏失败:', err.message);
        }
        // 二次补漏：腾讯也拿不到的，用新浪港股单独请求
        const stillMissing = missingConfigs.filter(cfg => !quotes[cfg.code]);
        if (stillMissing.length > 0) {
            for (const cfg of stillMissing) {
                try {
                    const q = await fetchSingleQuoteSina(cfg);
                    if (q) {
                        quotes[cfg.code] = q;
                        console.log(`  [行情] 新浪港股补漏成功: ${cfg.code}`);
                    }
                } catch (e) {
                    // skip
                }
            }
        }
    }

    if (Object.keys(quotes).length > 0) {
        return quotes;
    }

    // 完全降级：东方财富完全没有数据时，整体切腾讯
    try {
        quotes = await fetchRealtimeQuotesTencent(allConfigs);
        if (Object.keys(quotes).length > 0) {
            console.log('  [行情] 已切换腾讯备用源');
            _lastQuoteSource = 'tencent';
            return quotes;
        }
    } catch (err) {
        console.warn('  [行情] 腾讯备用源也失败:', err.message);
    }

    // 第三级：新浪备用源
    try {
        quotes = await fetchRealtimeQuotesSina(allConfigs);
        if (Object.keys(quotes).length > 0) {
            console.log('  [行情] 已切换新浪备用源');
            _lastQuoteSource = 'sina';
            return quotes;
        }
    } catch (err) {
        console.warn('  [行情] 新浪备用源也失败:', err.message);
    }

    _lastQuoteSource = 'none';
    return {};
}

// ============================================================
// 4. 东方财富历史K线（多secid尝试 + 自动降级lmt）
// ============================================================
async function fetchHistoryKlinesDetailed(secid, limit = 2520, altSecids = [], options = {}) {
    const secidsToTry = [secid, ...(altSecids || [])].filter(Boolean);
    const limitsToTry = limit > 300 ? [limit, 300] : [limit];
    const timeout = options.timeout ?? 3500;
    const retries = options.retries ?? 0;
    let lastError = null;
    let lastErrorMessage = '';

    // 先尝试完整 limit，如果所有 secid 都失败，再用较小的 limit 重试一轮
    for (const lmt of limitsToTry) {
        for (const sid of secidsToTry) {
            const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${sid}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&fqt=0&end=20500101&lmt=${lmt}`;
            try {
                const res = await safeFetch(url, {
                    timeout,
                    headers: { ...HEADERS, 'Referer': 'https://quote.eastmoney.com/' },
                }, retries);
                const data = await res.json();
                if (data?.data?.klines?.length > 0) {
                    console.log(`  [K线] ${sid} 获取成功, ${data.data.klines.length} 条 (lmt=${lmt})`);
                    recordKlineSourceSuccess('eastmoney', sid);
                    return {
                        klines: data.data.klines.map(line => {
                            const p = line.split(',');
                            return {
                                date: p[0], open: +p[1], close: +p[2], high: +p[3], low: +p[4],
                                volume: +p[5], amount: +p[6], changePercent: +p[8], changeAmount: +p[9],
                            };
                        }),
                        sourceSecid: sid,
                        limitUsed: lmt,
                        errorMessage: null,
                        shouldCooldown: false,
                    };
                }
                lastErrorMessage = data?.message || data?.msg || '接口未返回K线数据';
            } catch (err) {
                lastError = err;
                lastErrorMessage = err.message;
            }
        }
        // 降级前短暂休眠，让接口冷却
        if (lmt !== limitsToTry[limitsToTry.length - 1]) await new Promise(r => setTimeout(r, 300));
    }

    console.warn(`  [K线] ${secid} 所有secid均失败${lastErrorMessage ? `: ${lastErrorMessage}` : ''}`);
    recordKlineSourceFailure('eastmoney', secid, lastErrorMessage);
    return {
        klines: [],
        sourceSecid: null,
        limitUsed: null,
        errorMessage: lastErrorMessage || null,
        shouldCooldown: isEastmoneyKlineTransientError(lastError),
    };
}

/**
 * 根据 range 参数切片 K 线数据
 * @param {Array} klines - 完整 K 线数据
 * @param {string} range - 时间范围（1y/3y/5y/10y）
 * @returns {Array} 切片后的 K 线数据
 */
function sliceByRange(klines, range) {
    if (!Array.isArray(klines) || klines.length === 0) return klines;
    const sizeMap = { '1y': 252, '3y': 756, '5y': 1260, '10y': 2520 };
    const targetSize = sizeMap[range] || sizeMap['1y'];
    return klines.slice(-Math.min(targetSize, klines.length));
}

async function fetchHistoryKlines(secid, limit = 2520, altSecids = [], options = {}) {
    const result = await fetchHistoryKlinesDetailed(secid, limit, altSecids, options);
    return result.klines;
}

async function fetchIndexHistory(cfg, options = {}) {
    const cacheKey = `${cfg.code}.${cfg.market}`;
    const profile = buildIndexKlineProfile(cfg);
    const freshEntry = getFreshKlinesEntry(cacheKey);
    if (freshEntry) {
        // 支持 range 参数切片
        const klines = sliceByRange(freshEntry.klines, options.range);
        return {
            klines,
            status: createKlineRefreshStatus({
                state: 'fresh-cache',
                label: freshEntry.source === 'eastmoney' ? '主源缓存命中' : '备用缓存命中',
                source: freshEntry.source,
                specialSource: profile.specialCSI && freshEntry.source === 'eastmoney',
            }),
        };
    }

    const staleEntry = getStaleKlinesEntry(cacheKey);
    const cooldownActive = eastmoneyKlineInCooldown() && !profile.bypassGlobalCooldown;

    if (cooldownActive) {
        if (staleEntry) {
            console.log(`  [K线] 东方财富冷却中，${cfg.name} 直接复用${staleEntry.source === 'eastmoney' ? '主源缓存' : '备用缓存'}`);
            const klines = sliceByRange(staleEntry.klines, options?.range);
            return {
                klines,
                status: createKlineRefreshStatus({
                    state: 'cooldown-cache',
                    label: '主源冷却中 · 已回退缓存',
                    source: staleEntry.source,
                    usedStaleCache: true,
                    inCooldown: true,
                    specialSource: profile.specialCSI && staleEntry.source === 'eastmoney',
                }),
            };
        }
        console.log(`  [K线] 东方财富冷却中，${cfg.name} 直接使用腾讯备用源`);
    } else {
        const eastmoneyResult = await fetchHistoryKlinesDetailed(profile.primarySecid, 2520, profile.altSecids, {
            timeout: 2500,
            retries: 0,
        });
        if (eastmoneyResult.klines.length > 0) {
            setCachedKlines(cacheKey, eastmoneyResult.klines, 'eastmoney');
            const klines = sliceByRange(eastmoneyResult.klines, options?.range);
            return {
                klines,
                status: createKlineRefreshStatus({
                    state: profile.specialCSI ? 'special-primary-live' : 'primary-live',
                    label: profile.specialCSI ? '特殊指数专用主源' : '主源直连',
                    source: 'eastmoney',
                    specialSource: profile.specialCSI,
                    sourceSecid: eastmoneyResult.sourceSecid,
                }),
            };
        }
        if (eastmoneyResult.shouldCooldown && !profile.bypassGlobalCooldown) {
            markEastmoneyKlineCooldown(`${cfg.name} 主源请求失败，优先回退缓存/腾讯备用源`);
        }
        if (staleEntry) {
            console.warn(`  [K线] ${cfg.name} 主源失败，回退历史缓存避免刷新抖动`);
            return {
                klines: staleEntry.klines,
                status: createKlineRefreshStatus({
                    state: 'stale-cache',
                    label: '已回退缓存',
                    source: staleEntry.source,
                    usedStaleCache: true,
                    specialSource: profile.specialCSI && staleEntry.source === 'eastmoney',
                }),
            };
        }
    }

    if (profile.allowTencentFallback) {
        const tencentKlines = await fetchTencentKlines(cfg.code, cfg.market, cfg);
        if (tencentKlines.length > 0) {
            setCachedKlines(cacheKey, tencentKlines, 'tencent');
            const klines = sliceByRange(tencentKlines, options?.range);
            return {
                klines,
                status: createKlineRefreshStatus({
                    state: cooldownActive ? 'cooldown-tencent' : 'tencent-fallback',
                    label: cooldownActive ? '主源冷却中 · 备用源生效中' : '备用源生效中',
                    source: 'tencent',
                    inCooldown: cooldownActive,
                    fallbackActive: true,
                }),
            };
        }
    }

    // 美股专用兜底：Yahoo Finance K线（10年数据）
    if (cfg.yahooCode) {
        const yahooKlines = await fetchYahooKlines(cfg);
        if (yahooKlines.length > 0) {
            setCachedKlines(cacheKey, yahooKlines, 'yahoo');
            const klines = sliceByRange(yahooKlines, options?.range);
            return {
                klines,
                status: createKlineRefreshStatus({
                    state: 'yahoo-fallback',
                    label: 'Yahoo Finance 数据',
                    source: 'yahoo',
                    fallbackActive: true,
                }),
            };
        }
    }

    if (staleEntry) {
        console.warn(`  [K线] ${cfg.name} 返回历史缓存，避免页面刷新空白`);
        const klines = sliceByRange(staleEntry.klines, options?.range);
        return {
            klines,
            status: createKlineRefreshStatus({
                state: 'stale-cache-final',
                label: cooldownActive ? '主源冷却中 · 已回退缓存' : '已回退缓存',
                source: staleEntry.source,
                usedStaleCache: true,
                inCooldown: cooldownActive,
                specialSource: profile.specialCSI && staleEntry.source === 'eastmoney',
            }),
        };
    }

    return {
        klines: [],
        status: createKlineRefreshStatus({
            state: 'unavailable',
            label: profile.allowTencentFallback ? 'K线暂不可用' : '专用主源暂不可用',
            source: 'none',
            inCooldown: cooldownActive,
        }),
    };
}

// ============================================================
// 5. 东方财富 push2 动态 PE 字段（作为对照）
// ============================================================
async function fetchEMPushPE(secid) {
    try {
        const url = `https://push2.eastmoney.com/api/qt/stock/get?invt=2&fltt=2&fields=f162,f163,f164,f167,f168,f135&secid=${secid}`;
        const res = await safeFetch(url, { headers: { ...HEADERS, 'Referer': 'https://quote.eastmoney.com/' } }, 1);
        const data = await res.json();
        if (data?.data) {
            const pe = parseFloat(data.data.f162);
            const pb = parseFloat(data.data.f167);
            if (!isNaN(pe) && pe > 0) {
                return { pe, pb: isNaN(pb) ? null : pb, source: 'eastmoney-push2' };
            }
        }
    } catch (e) { /* skip */ }
    return null;
}

// ============================================================
// 4b. 腾讯财经K线（作为东方财富K线的 fallback）
//     实测支持最多约2000条日K，足够覆盖8年+趋势
// ============================================================
async function fetchTencentKlines(code, market, cfg) {
    // 腾讯财经代码映射（K线用 txKlineCode，行情用 txCode）
    let txCode = cfg?.txKlineCode || cfg?.txCode || null;
    if (!txCode) {
        if (market === 'SZ') txCode = `sz${code}`;
        else if (market === 'SH') txCode = `sh${code}`;
        else if (market === 'HI') txCode = `hk${code}`;
        else if (market === 'US') txCode = `us.${code}`;
    }
    // CSI 系列指数（如 H30269）先尝试 sh 前缀
    const txCodesToTry = txCode ? [txCode] : [];
    if (market === 'CSI') {
        txCodesToTry.push(`sh${code}`, `sz${code}`);
    }
    for (const tc of txCodesToTry) {
        const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${tc},day,,,2000,qfq`;
        try {
            const res = await safeFetch(url, {}, 1);
            const data = await res.json();
            const days = data?.data?.[tc]?.day || data?.data?.[tc]?.qfqday || [];
            if (days.length > 0) {
                console.log(`  [K线-腾讯] ${tc} fallback成功, ${days.length} 条`);
                recordKlineSourceSuccess('tencent', tc);
                return days.map(d => ({
                    date: d[0],
                    open: +d[1],
                    close: +d[2],
                    high: +d[3],
                    low: +d[4],
                    volume: +d[5] || 0,
                    amount: 0,
                    changePercent: 0,
                    changeAmount: 0,
                }));
            }
        } catch (e) {
            // try next
        }
    }
    if (txCodesToTry.length > 0) {
        console.warn(`  [K线-腾讯] ${txCodesToTry.join('/')} 均失败`);
        recordKlineSourceFailure('tencent', txCodesToTry[0], '所有候选 txCode 均无数据');
    }
    return [];
}

// ============================================================
// 4c. Yahoo Finance K线（美股专用兜底，支持10年日K）
//     免费接口，无需认证，但只适用于美股指数
// ============================================================
async function fetchYahooKlines(cfg) {
    const yahooCode = cfg?.yahooCode;
    if (!yahooCode) return [];
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooCode)}?interval=1d&range=10y`;
    try {
        const res = await safeFetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
            timeout: 15000,
        }, 1);
        const data = await res.json();
        const result = data?.chart?.result?.[0];
        if (!result) return [];
        const timestamps = result.timestamp || [];
        const quote = result.indicators?.quote?.[0] || {};
        const opens = quote.open || [];
        const closes = quote.close || [];
        const highs = quote.high || [];
        const lows = quote.low || [];
        const volumes = quote.volume || [];
        const klines = [];
        for (let i = 0; i < timestamps.length; i++) {
            if (closes[i] == null) continue;
            const d = new Date(timestamps[i] * 1000);
            const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            klines.push({
                date: dateStr,
                open: +(opens[i] || 0).toFixed(2),
                close: +closes[i].toFixed(2),
                high: +(highs[i] || 0).toFixed(2),
                low: +(lows[i] || 0).toFixed(2),
                volume: volumes[i] || 0,
                amount: 0,
                changePercent: i > 0 && closes[i - 1] ? +((closes[i] - closes[i - 1]) / closes[i - 1] * 100).toFixed(2) : 0,
                changeAmount: i > 0 && closes[i - 1] ? +(closes[i] - closes[i - 1]).toFixed(2) : 0,
            });
        }
        if (klines.length > 0) {
            console.log(`  [K线-Yahoo] ${yahooCode} 获取成功, ${klines.length} 条`);
            recordKlineSourceSuccess('yahoo', yahooCode);
        } else {
            recordKlineSourceFailure('yahoo', yahooCode, '接口返回空 K 线');
        }
        return klines;
    } catch (err) {
        console.warn(`  [K线-Yahoo] ${yahooCode} 失败:`, err.message);
        recordKlineSourceFailure('yahoo', yahooCode, err.message);
        return [];
    }
}

// ============================================================
// 组装完整的指数数据
// ============================================================
async function fetchAllIndexData(selectedCodes, options = {}) {
    console.log('[数据] ===== 开始获取所有指数数据 =====');
    const startTime = Date.now();
    const forceRefreshThermometer = !!(options && options.forceRefreshThermometer);

    // 根据用户选择构建动态配置
    const INDEX_CONFIG = buildIndexConfig(selectedCodes);
    const DASHBOARD_ONLY_INDEX_CONFIG = buildDashboardOnlyConfig(selectedCodes);
    const ALL_INDEX_CONFIG = [...INDEX_CONFIG, ...DASHBOARD_ONLY_INDEX_CONFIG];

    console.log(`  [配置] 核心指数: ${INDEX_CONFIG.map(c => c.name).join(', ')}`);
    console.log(`  [配置] Dashboard额外: ${DASHBOARD_ONLY_INDEX_CONFIG.map(c => c.name).join(', ') || '无'}`);

    // Step 1: 并行获取核心数据（含知有行温度计）
    const [quotes, djEvaMap, yzyxData] = await Promise.all([
        fetchRealtimeQuotes(ALL_INDEX_CONFIG),
        fetchDanjuanEvaluation(),
        fetchYZYXThermometer({ force: forceRefreshThermometer }),
    ]);

    // Step 2: 动态选择当前可用的 3 个估值对比来源
    const comparisonSources = await fetchComparisonSources(INDEX_CONFIG, djEvaMap);

    // Step 3: 限并发获取每个指数的K线和补充数据（每次最多3个，避免东方财富限流）
    async function processIndex(cfg) {
        console.log(`  [${cfg.name}] 开始获取数据...`);

        // 2a. 历史K线（优先主源，失败时快速降级并复用缓存）
        const historyResult = await fetchIndexHistory(cfg);
        const klines = historyResult.klines || [];
        const klineStatus = historyResult.status || createKlineRefreshStatus();

        // 2b. PE/PB 估值 — 多源获取
        let pe = null, pb = null, dividend = null, roe = null;
        let pePercentile = null, pbPercentile = null;
        let peSource = 'none';
        let evaType = null;
        let peg = null;
        let peOverHistory = null, pbOverHistory = null;

        // 来源1: 蛋卷基金（Wind数据，最权威）
        if (cfg.djCode && djEvaMap[cfg.djCode]) {
            const dj = djEvaMap[cfg.djCode];
            pe = dj.pe;
            pb = dj.pb;
            pePercentile = dj.pePercentile;
            pbPercentile = dj.pbPercentile;
            dividend = dj.dividend;
            roe = dj.roe;
            evaType = dj.evaType;
            peg = dj.peg;
            peOverHistory = dj.peOverHistory;
            pbOverHistory = dj.pbOverHistory;
            peSource = 'danjuan-wind';
            console.log(`  [${cfg.name}] 蛋卷基金: PE=${pe}, PE百分位=${pePercentile}%, 估值=${evaType}`);
        }

        // 美股指数估值参考占位（具体计算移到 const quote 定义之后，避免 TDZ 错误）
        let usValuationInfo = null;

        // 2c. 新浪财经行情（对港股备选）
        const quote = quotes[cfg.code] || {};

        // 来源1.5: 美股指数估值参考（使用历史中位数）—— 此处可安全使用 quote
        if (cfg.market === 'US' && !pe) {
            usValuationInfo = cfg.usValuation || null;
            if (usValuationInfo && usValuationInfo.peHistoricalMedian) {
                // 使用历史中位数作为参考PE（标注为参考值）
                pe = usValuationInfo.peHistoricalMedian;
                peSource = 'us-historical-median';
                // 尝试基于当前价格位置估算百分位（简化算法）
                if (quote.price && quote.high52w && quote.low52w && quote.high52w > quote.low52w) {
                    const range52w = quote.high52w - quote.low52w;
                    const position52w = ((quote.price - quote.low52w) / range52w) * 100;
                    pePercentile = parseFloat(position52w.toFixed(1));
                    if (position52w < 30) evaType = 'low';
                    else if (position52w < 70) evaType = 'mid';
                    else evaType = 'high';
                }
                console.log(`  [${cfg.name}] 美股估值参考: PE≈${pe} (历史中位数), PE百分位≈${pePercentile}%`);
            }
        }
        if (!quote.price && klines.length === 0) {
            try {
                const sinaCode = (cfg.market === 'HI' || cfg.market === 'HK') ? `rt_hk${cfg.code}` : `sh${cfg.code}`;
                const sinaUrl = `https://hq.sinajs.cn/list=${sinaCode}`;
                const sinaRes = await fetch(sinaUrl, {
                    headers: { ...HEADERS, 'Referer': 'https://finance.sina.com.cn/' },
                    timeout: 5000,
                });
                const sinaText = await sinaRes.text();
                const match = sinaText.match(/"(.+)"/);
                if (match) {
                    const parts = match[1].split(',');
                    if (parts.length > 6 && parts[6]) {
                        quote.price = parseFloat(parts[6]);
                        quote.changeAmount = parseFloat(parts[7]) || 0;
                        quote.changePercent = parseFloat(parts[8]) || 0;
                        console.log(`  [${cfg.name}] 新浪财经价格: ${quote.price}`);
                    }
                }
            } catch (e) {
                console.warn(`  [${cfg.name}] 新浪财经也失败: ${e.message}`);
            }
        }

        // 2d. K线统计
        let high10y = null, low10y = null, high52w = null, low52w = null;
        let recentPrices = [];
        let historySeries = [];

        if (klines.length > 0) {
            high10y = Math.max(...klines.map(k => k.high));
            low10y = Math.min(...klines.map(k => k.low));
            const last250 = klines.slice(-250);
            if (last250.length > 0) {
                high52w = Math.max(...last250.map(k => k.high));
                low52w = Math.min(...last250.map(k => k.low));
            }
            recentPrices = klines.slice(-30).map(k => k.close);
            historySeries = klines.slice(-2520).map(k => ({
                date: k.date,
                close: k.close,
                high: k.high,
                low: k.low,
                changePercent: k.changePercent,
                changeAmount: k.changeAmount,
            }));
        }

        // 匹配知有行温度数据（优先按代码精确匹配，其次按名称别名精确匹配）
        let yzyxTemp = null;
        if (yzyxData && yzyxData.indices) {
            const codeAliases = {
                '000932': ['000932'], // 中证消费在知有行中显示为 800消费，但代码仍为 000932.SH
                'HSTECH': ['H11136'], // 恒生科技 → 知有行的"中国互联网"(H11136.CSI)
            };
            const nameAliases = {
                '中证消费': ['中证消费', '800消费'],
                '恒生科技': ['恒生科技', '中国互联网'],
            };
            const cfgShortCode = String(cfg.code).split('.')[0].toUpperCase();
            const allowedCodes = codeAliases[cfgShortCode] || [cfgShortCode];
            yzyxTemp = yzyxData.indices.find(idx => {
                const idxShortCode = String(idx.shortCode || idx.code || '').split('.')[0].toUpperCase();
                return allowedCodes.includes(idxShortCode);
            });

            if (!yzyxTemp) {
                const aliases = (nameAliases[cfg.name] || [cfg.name]).map(name => name.trim());
                yzyxTemp = yzyxData.indices.find(idx => aliases.includes(String(idx.name || '').trim()));
            }
        }

        const resultCode = `${cfg.code}.${cfg.market}`;
        const comparisonMap = Object.fromEntries(
            comparisonSources
                .map(source => [source.id, source.items[resultCode]])
                .filter(([, value]) => hasValuationPayload(value))
        );

        // 全市场多周期动量（基于 historySeries，K 线不足时为 null）
        const momentum = calcMomentumSet(historySeries, quote.price);

        const result = {
            name: cfg.name,
            code: resultCode,
            market: cfg.market,
            icon: cfg.icon,
            iconBg: cfg.iconBg,
            iconColor: cfg.iconColor,
            dashboardOnly: !!cfg.dashboardOnly,
            // 行情
            price: quote.price || (klines.length > 0 ? klines[klines.length - 1].close : null),
            change: quote.changePercent || (klines.length >= 2 ? klines[klines.length - 1].changePercent : 0),
            changeAmt: quote.changeAmount || (klines.length >= 2 ? klines[klines.length - 1].changeAmount : 0),
            open: quote.open ?? (klines.length > 0 ? klines[klines.length - 1].open : null),
            prevClose: quote.prevClose ?? (klines.length >= 2 ? klines[klines.length - 2].close : null),
            dayHigh: quote.high ?? (klines.length > 0 ? klines[klines.length - 1].high : null),
            dayLow: quote.low ?? (klines.length > 0 ? klines[klines.length - 1].low : null),
            // 估值（蛋卷基金Wind数据）
            pe, pb, dividend, roe, peg,
            pePercentile,
            pbPercentile,
            evaType,  // low / mid / high
            peOverHistory,
            pbOverHistory,
            // 全市场多周期动量（红涨绿跌，单位 %）
            momentum1m: momentum.momentum1m,
            momentum3m: momentum.momentum3m,
            momentum6m: momentum.momentum6m,
            momentum1y: momentum.momentum1y,
            // 知有行温度
            temperature: yzyxTemp ? yzyxTemp.temperature : null,
            temperatureStatus: yzyxTemp ? getTemperatureStatus(yzyxTemp.temperature) : null,
            internalYield: yzyxTemp ? yzyxTemp.internalYield : null,
            // 美股估值参考
            usValuation: usValuationInfo,
            // 行情统计
            high52w, low52w, high10y, low10y,
            sparkData: recentPrices,
            historySeries,
            // 多源对照数据
            dataSources: {
                primary: peSource,
                danjuan: cfg.djCode && djEvaMap[cfg.djCode] ? {
                    pe: djEvaMap[cfg.djCode].pe,
                    pePercentile: djEvaMap[cfg.djCode].pePercentile,
                    pb: djEvaMap[cfg.djCode].pb,
                    pbPercentile: djEvaMap[cfg.djCode].pbPercentile,
                    evaType: djEvaMap[cfg.djCode].evaType,
                    source: '雪球基金(Wind)',
                } : null,
                comparison: comparisonMap,
                youzhiyouxing: yzyxTemp ? {
                    temperature: yzyxTemp.temperature,
                    internalYield: yzyxTemp.internalYield,
                    dividendYield: yzyxTemp.dividendYield,
                    source: '知有行',
                } : null,
                quoteAvailable: !!quote.price,
                klinesCount: klines.length,
                kline: klineStatus,
            },
        };

        console.log(`  [${cfg.name}] 完成: price=${result.price}, PE=${pe}, PE%=${pePercentile}%, temp=${yzyxTemp ? yzyxTemp.temperature + '°' : 'N/A'}, src=${peSource}`);
        return result;
    }

    // 限并发执行：每次最多6个，加速首次加载
    const CONCURRENCY = 6;
    const results = [];
    for (let i = 0; i < ALL_INDEX_CONFIG.length; i += CONCURRENCY) {
        const batch = ALL_INDEX_CONFIG.slice(i, i + CONCURRENCY);
        const batchResults = await Promise.all(batch.map(cfg => processIndex(cfg)));
        results.push(...batchResults);
        if (i + CONCURRENCY < ALL_INDEX_CONFIG.length) {
            await new Promise(r => setTimeout(r, 100)); // 批次间短暂休眠
        }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[数据] ===== 全部完成，耗时 ${elapsed}s =====`);

    const coreIndices = results.filter(item => !item.dashboardOnly);
    // 上证指数（dashboardOnly）置顶到估值总览第一位
    const dashboardOnly = results.filter(item => item.dashboardOnly);
    const dashboardCore = results.filter(item => !item.dashboardOnly);
    const dashboardIndices = [...dashboardOnly, ...dashboardCore];
    const klineStatusSummary = summarizeKlineRefreshStatuses(results.map(item => item.dataSources?.kline));

    // 温度计 meta（数据源 / fetchedAt / stale）
    const yzyxMeta = yzyxData && yzyxData._meta ? yzyxData._meta : null;
    const responseFetchedAt = new Date().toISOString();

    return {
        updateTime: responseFetchedAt,
        indices: coreIndices,
        dashboardIndices,
        thermometer: yzyxData ? {
            marketTemperature: yzyxData.marketTemperature,
            marketStatus: yzyxData.marketStatus,
            marketTrend: yzyxData.marketTrend,
            updateTime: yzyxData.updateTime,
            allIndices: yzyxData.indices,
            bands: yzyxData.bands,
            notes: yzyxData.notes,
            macro: yzyxData.macro,
            // 数据时效性透出（前端"更新于"与 stale 徽章使用）
            fetchedAt: yzyxMeta ? yzyxMeta.fetchedAt : null,
            source: yzyxMeta ? yzyxMeta.source : null,
            stale: yzyxMeta ? !!yzyxMeta.stale : false,
        } : null,
        meta: {
            fetchTime: elapsed + 's',
            quoteSource: _lastQuoteSource,
            sources: [
                ...comparisonSources.map(item => `${item.name} — ${item.metricText}`),
                _lastQuoteSource === 'tencent' ? '腾讯 — 实时行情(备用)' : _lastQuoteSource === 'sina' ? '新浪 — 实时行情(备用)' : '东方财富 — 实时行情',
                '东方财富/腾讯 — 历史K线',
                '知有行 — 指数温度计',
            ],
            comparisonSources: comparisonSources.map(item => ({
                id: item.id,
                name: item.name,
                website: item.website,
                color: item.color,
                metricText: item.metricText,
                successCount: item.successCount,
                // 时效性：成功抓取的数据源使用本次响应时间；successCount=0 标 stale=true
                fetchedAt: item.successCount > 0 ? responseFetchedAt : null,
                stale: item.successCount === 0,
            })),
            klineStatusSummary,
            selectedCodes: INDEX_CONFIG.map(c => `${c.code}.${c.market}`),
            indexCount: INDEX_CONFIG.length,
        },
    };
}

// ============================================================
// 6. 知有行温度计数据 (youzhiyouxing.cn)
//    通过网页抓取获取指数温度、内在收益率、股息率
// ============================================================
let _yzyxCache = null;
let _yzyxCacheTime = 0;
let _yzyxCacheSource = null; // 'youzhiyouxing-data' | 'youzhiyouxing-thermometer'

const THERMOMETER_MAX_TTL = 4 * 60 * 60 * 1000; // 4 小时强制刷新兜底

/**
 * 交易时段感知的温度计 TTL：
 * - A 股开盘（含港股 9:30-12:00 与 13:00 之后的重叠时段）→ 60 秒
 * - 仅港股 / 美股开盘 → 5 分钟
 * - 全市场休市 → 30 分钟
 */
function getThermometerTTL() {
    let isTradingHoursFn;
    try {
        // 延迟引入，避免 dataFetcher 与 stockFetcher 之间循环依赖
        ({ isTradingHours: isTradingHoursFn } = require('./stockFetcher'));
    } catch (e) {
        return 30 * 60 * 1000;
    }
    try {
        if (isTradingHoursFn(['CN'])) return 60 * 1000;
        if (isTradingHoursFn(['HK', 'US'])) return 5 * 60 * 1000;
    } catch (e) {
        // 任何异常退化为休市态
    }
    return 30 * 60 * 1000;
}

/**
 * 抓取知有行温度计。
 * @param {Object} [options]
 * @param {boolean} [options.force=false] 跳过 TTL 缓存，强制重新抓取（仍尊重失败时回退）
 */
async function fetchYZYXThermometer(options = {}) {
    const force = !!options.force;
    const ttl = getThermometerTTL();
    const age = Date.now() - _yzyxCacheTime;

    // 命中内存缓存（force=true 时跳过；超过 4h 兜底强制刷新）
    if (!force && _yzyxCache && age < ttl && age < THERMOMETER_MAX_TTL) {
        return _yzyxCache;
    }

    const tryFetch = async (path, sourceTag, retries) => {
        const url = `https://youzhiyouxing.cn${path}`;
        const res = await safeFetch(url, {
            headers: {
                ...HEADERS,
                'Referer': 'https://youzhiyouxing.cn/',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            },
        }, retries);
        const html = await res.text();
        const result = parseYZYXPage(html);
        if (result && result.indices && result.indices.length > 0) {
            // 成功路径：附挂时效性 meta 并写入内存缓存
            result._meta = {
                source: sourceTag,
                fetchedAt: new Date().toISOString(),
                stale: false,
            };
            _yzyxCache = result;
            _yzyxCacheTime = Date.now();
            _yzyxCacheSource = sourceTag;
            console.log(`  [知有行] (${path}) 获取 ${result.indices.length} 个指数温度数据, 全市场温度: ${result.marketTemperature}°`);
            return result;
        }
        return null;
    };

    // 主路径
    try {
        const r1 = await tryFetch('/data', 'youzhiyouxing-data', 2);
        if (r1) return r1;
    } catch (err) {
        console.warn('  [知有行] 温度计数据获取失败:', err.message);
    }

    // 备选路径
    try {
        const r2 = await tryFetch('/thermometer', 'youzhiyouxing-thermometer', 1);
        if (r2) return r2;
    } catch (err2) {
        console.warn('  [知有行] /thermometer 也失败:', err2.message);
    }

    // 注意：此处**不**更新 _yzyxCacheTime，下次请求会继续尝试 HTTP
    // 失败时回退到上次成功的缓存，并打 stale 标记
    if (_yzyxCache) {
        console.warn('  [知有行] 抓取失败，回退到上次缓存（stale）');
        return {
            ..._yzyxCache,
            _meta: {
                source: _yzyxCacheSource || 'stale-cache',
                fetchedAt: new Date(_yzyxCacheTime).toISOString(),
                stale: true,
            },
        };
    }
    return null;
}

/**
 * 清空温度计相关全部缓存（管理员强制刷新使用）
 */
function resetYZYXCache() {
    _yzyxCache = null;
    _yzyxCacheTime = 0;
    _yzyxCacheSource = null;
    for (const k of Object.keys(_yzyxDetailCache)) delete _yzyxDetailCache[k];
    for (const k of Object.keys(_yzyxDetailCacheTime)) delete _yzyxDetailCacheTime[k];
}

function stripHtmlContent(htmlFragment) {
    return String(htmlFragment || '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/\s+/g, ' ')
        .trim();
}

function parsePercentFromCell(cellHtml) {
    if (!cellHtml || /--/.test(cellHtml)) {
        return null;
    }
    const match = cellHtml.match(/([+-]?\d+(?:\.\d+)?)%/);
    return match ? parseFloat(match[1]) : null;
}

function decodeHtmlEntities(value) {
    return String(value || '')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>');
}

function parseNumericValue(value) {
    if (value == null) return null;
    const match = String(value).replace(/,/g, '').match(/([+-]?\d+(?:\.\d+)?)/);
    return match ? parseFloat(match[1]) : null;
}

function parseYZYXPage(html) {
    const result = {
        marketTemperature: null,
        marketStatus: null,
        marketTrend: null,
        updateTime: null,
        indices: [],
        bands: [],
        notes: [],
        macro: {},
    };

    try {
        // 1. 提取全市场温度区块
        const marketBlockMatch = html.match(/<div class="tw-text-\[40px\] tw-font-semibold">\s*(\d+)°\s*<\/div>[\s\S]{0,180}?<div class="tw-leading-normal">\s*([^<]+)\s*<\/div>[\s\S]{0,120}?<div class="tw-leading-normal">\s*([^<]+)\s*<\/div>/i);
        if (marketBlockMatch) {
            result.marketTemperature = parseInt(marketBlockMatch[1], 10);
            result.marketStatus = marketBlockMatch[2].trim();
            result.marketTrend = marketBlockMatch[3].trim();
        }

        // 2. 提取更新时间
        const updateMatch = html.match(/温度更新时间[:：]?\s*([0-9]{4}年\d{1,2}月\d{1,2}日\s*\d{1,2}:\d{2})/i)
            || html.match(/(\d{4}年\d{1,2}月\d{1,2}日)\s*([0-9]{1,2}:\d{2})/);
        if (updateMatch) {
            result.updateTime = updateMatch[1] + (updateMatch[2] ? ` ${updateMatch[2]}` : '');
        }

        // 3. 解析全市场温带表
        const bandTableMatch = html.match(/<table class="tw-mt-4 tw-min-w-full tw-whitespace-nowrap">[\s\S]*?<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
        if (bandTableMatch) {
            const bandRows = [...bandTableMatch[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
            result.bands = bandRows.map((rowMatch, index) => {
                const cells = [...rowMatch[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(cell => stripHtmlContent(cell[1]));
                const ranges = ['0°-30°', '30°-70°', '70°-100°'];
                return {
                    label: cells[0] || ['低估', '中估', '高估'][index] || '',
                    range: ranges[index] || '',
                    probability: cells[1] || null,
                    profitProbability: cells[2] || null,
                };
            }).filter(item => item.label);
        }

        // 4. 按列解析指数观察表，保留空值占位，避免数值错列
        const rowRegex = /<tr[^>]*data-event-params="idx_code:\s*([^"]+)"[\s\S]*?<\/tr>/gi;
        const rows = [...html.matchAll(rowRegex)];
        for (const rowMatch of rows) {
            const rowHtml = rowMatch[0];
            const code = rowMatch[1].trim();
            const cells = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(cell => cell[1]);
            if (cells.length < 4) {
                continue;
            }

            const nameCell = cells[0];
            const tempCell = cells[1];
            const internalYieldCell = cells[2];
            const dividendYieldCell = cells[3];

            const nameMatch = nameCell.match(/tw-block tw-text-t-normal tw-leading-snug">\s*([\s\S]*?)\s*<\/span>/i);
            const detailPathMatch = rowHtml.match(/href="(\/data\/indices\/[^"]+)"/i);
            const tempMatch = tempCell.match(/(\d+)°/);

            if (!nameMatch || !tempMatch) {
                continue;
            }

            result.indices.push({
                name: stripHtmlContent(nameMatch[1]),
                code,
                shortCode: code.split('.')[0].toUpperCase(),
                temperature: parseInt(tempMatch[1], 10),
                internalYield: parsePercentFromCell(internalYieldCell),
                dividendYield: parsePercentFromCell(dividendYieldCell),
                detailPath: detailPathMatch ? detailPathMatch[1] : null,
            });
        }

        // 5. 指数观察区说明
        const notesMatch = html.match(/<ul class="tw-text-12 tw-text-t-muted[^"]*">([\s\S]*?)<\/ul>/i);
        if (notesMatch) {
            result.notes = [...notesMatch[1].matchAll(/<li>([\s\S]*?)<\/li>/gi)]
                .map(match => stripHtmlContent(match[1]))
                .filter(Boolean);
        }

        // 6. 宏观数据
        const bondMatch = html.match(/债市温度[\s\S]{0,80}?(\d+)°/i);
        if (bondMatch) result.macro.bondTemperature = parseInt(bondMatch[1], 10);

        const treasuryMatch = html.match(/10年期国债到期收益率[\s\S]{0,120}?<span class="tw-text-red">([\d.]+)%<\/span>/i);
        if (treasuryMatch) result.macro.treasury10y = parseFloat(treasuryMatch[1]);
        const treasuryDateMatch = html.match(/10年期国债到期收益率[\s\S]{0,220}?<label class="tw-text-12 tw-text-t-muted">\s*([^<]+)\s*<\/label>/i);
        if (treasuryDateMatch) result.macro.treasury10yDate = treasuryDateMatch[1].trim();

        const gdpMatch = html.match(/GDP季度同比增速[\s\S]{0,120}?<span class="tw-text-red">([\d.]+)%<\/span>/i);
        if (gdpMatch) result.macro.gdpGrowth = parseFloat(gdpMatch[1]);
        const gdpDateMatch = html.match(/GDP季度同比增速[\s\S]{0,220}?<label class="tw-text-12 tw-text-t-muted">\s*([^<]+)\s*<\/label>/i);
        if (gdpDateMatch) result.macro.gdpDate = gdpDateMatch[1].trim();

        const cpiMatch = html.match(/CPI月度同比增速[\s\S]{0,120}?<span class="tw-text-red">([\d.]+)%<\/span>/i);
        if (cpiMatch) result.macro.cpiGrowth = parseFloat(cpiMatch[1]);
        const cpiDateMatch = html.match(/CPI月度同比增速[\s\S]{0,220}?<label class="tw-text-12 tw-text-t-muted">\s*([^<]+)\s*<\/label>/i);
        if (cpiDateMatch) result.macro.cpiDate = cpiDateMatch[1].trim();

    } catch (err) {
        console.warn('  [知有行] 页面解析错误:', err.message);
    }

    return result;
}

const _yzyxDetailCache = {};
const _yzyxDetailCacheTime = {};

function parseYZYXIndexDetailPage(html, fallback = {}) {
    const result = {
        name: fallback.name || null,
        code: fallback.code || null,
        detailPath: fallback.detailPath || null,
        temperature: fallback.temperature ?? null,
        internalYield: fallback.internalYield ?? null,
        dividendYield: fallback.dividendYield ?? null,
        temperatureLabel: null,
        tags: [],
        description: null,
        history: {
            date: null,
            close: null,
            source: 'Wind，知行研究',
        },
        growth: {
            period: null,
            netAssetGrowth: null,
            revenueGrowth: null,
            profitGrowth: null,
        },
        industries: [],
        riskNote: '以上数据均是历史回测业绩，不预示其未来表现。市场有风险，投资需谨慎。',
    };

    try {
        const headerSlice = html.slice(0, 40000);
        const nameMatch = headerSlice.match(/<h1[^>]*>\s*([^<]+)\s*<\/h1>/i) || headerSlice.match(/<title>\s*([^<]+?)\s*(?:指数观察|知行温度计)/i);
        if (nameMatch) {
            result.name = stripHtmlContent(nameMatch[1]);
        }

        result.tags = [...headerSlice.matchAll(/<span class="tw-text-10" style="[\s\S]*?">\s*([^<]+?)\s*<\/span>/gi)]
            .map(match => stripHtmlContent(match[1]))
            .filter(Boolean)
            .slice(0, 6);

        const tempBadgeMatch = headerSlice.match(/<span class="tw-font-medium" style="color:[^"]+">\s*(\d+)°\s*<\/span>[\s\S]{0,200}?<span class="tw-font-medium" style="color:[^"]+">\s*([^<]+)\s*<\/span>/i);
        if (tempBadgeMatch) {
            result.temperature = parseInt(tempBadgeMatch[1], 10);
            result.temperatureLabel = stripHtmlContent(tempBadgeMatch[2]);
        }

        const descMatch = headerSlice.match(/<p class="tw-py-5 tw-text-15 tw-text-t-medium">\s*([\s\S]*?)\s*<\/p>/i);
        if (descMatch) {
            result.description = stripHtmlContent(descMatch[1]);
        }

        const metricMatch = headerSlice.match(/内在收益率[\s\S]{0,220}?<span class="tw-text-t-normal">([^<]+)<\/span>[\s\S]{0,220}?股息率[\s\S]{0,220}?<span class="tw-text-t-normal">([^<]+)<\/span>/i);
        if (metricMatch) {
            result.internalYield = parseNumericValue(metricMatch[1]);
            result.dividendYield = parseNumericValue(metricMatch[2]);
        }

        const historyCardMatch = html.match(/指数历史温度[\s\S]*?<div class="tw-bg-bgd-area[^>]*">([\s\S]*?)<\/div>/i);
        if (historyCardMatch) {
            const historyBlock = historyCardMatch[1];
            const dateMatch = historyBlock.match(/(\d{4}年\d{1,2}月\d{1,2}日)/);
            if (dateMatch) result.history.date = dateMatch[1];
            const closeMatch = historyBlock.match(/：<span class="tw-font-medium">([\d,]+)<\/span>/);
            if (closeMatch) result.history.close = parseNumericValue(closeMatch[1]);
        }

        const sourceMatch = html.match(/截止日期：\s*([^<]+)<\/span>\s*<span class="tw-mx-2">\|<\/span>\s*数据来源：([^<]+)/i);
        if (sourceMatch) {
            result.history.date = result.history.date || stripHtmlContent(sourceMatch[1]);
            result.history.source = stripHtmlContent(sourceMatch[2]);
        }

        const growthMatch = html.match(/指数成长分析[\s\S]*?<div class="tw-bg-bgd-area[^>]*">([\s\S]*?)<\/div>/i);
        if (growthMatch) {
            const growthBlock = growthMatch[1];
            const periodMatch = growthBlock.match(/<p class="tw-mb-1\.5">\s*([^<]+)\s*<\/p>/i);
            if (periodMatch) result.growth.period = stripHtmlContent(periodMatch[1]);
            const growthValues = [...growthBlock.matchAll(/<span class="tw-text-red">([+-]?[\d.]+)%<\/span>/gi)].map(match => parseFloat(match[1]));
            result.growth.netAssetGrowth = growthValues[0] ?? null;
            result.growth.revenueGrowth = growthValues[1] ?? null;
            result.growth.profitGrowth = growthValues[2] ?? null;
        }

        const ingredientMatch = html.match(/data-indices-ingredient="([^"]+)"/i);
        if (ingredientMatch) {
            const decoded = decodeHtmlEntities(ingredientMatch[1]);
            const parsed = JSON.parse(decoded);
            if (Array.isArray(parsed)) {
                result.industries = parsed
                    .map(item => ({
                        name: stripHtmlContent(item.name),
                        weight: parseNumericValue(item.weight),
                    }))
                    .filter(item => item.name && item.weight != null);
            }
        }
    } catch (err) {
        console.warn('  [知有行] 详情页解析错误:', err.message);
    }

    return result;
}

async function fetchYZYXIndexDetail(code) {
    const normalizedCode = String(code || '').trim().toUpperCase();
    if (!normalizedCode) {
        return null;
    }

    const detailTTL = getThermometerTTL();
    const detailAge = Date.now() - (_yzyxDetailCacheTime[normalizedCode] || 0);
    if (_yzyxDetailCache[normalizedCode] && detailAge < detailTTL && detailAge < THERMOMETER_MAX_TTL) {
        return _yzyxDetailCache[normalizedCode];
    }

    const thermometer = await fetchYZYXThermometer();
    const normalizedShortCode = normalizedCode.split('.')[0];
    const target = thermometer?.indices?.find(item => {
        const itemCode = String(item.code || '').trim().toUpperCase();
        const itemShortCode = String(item.shortCode || item.code || '').split('.')[0].toUpperCase();
        return itemCode === normalizedCode || itemShortCode === normalizedShortCode;
    });
    if (!target || !target.detailPath) {
        return null;
    }

    try {
        const res = await safeFetch(`https://youzhiyouxing.cn${target.detailPath}`, {
            headers: {
                ...HEADERS,
                Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                Referer: 'https://youzhiyouxing.cn/data',
            },
        }, 1);
        const html = await res.text();
        const detail = parseYZYXIndexDetailPage(html, target);
        _yzyxDetailCache[normalizedCode] = detail;
        _yzyxDetailCacheTime[normalizedCode] = Date.now();
        return detail;
    } catch (err) {
        console.warn(`  [知有行] 指数详情获取失败(${normalizedCode}):`, err.message);
        return parseYZYXIndexDetailPage('', target);
    }
}

// 根据温度值获取估值状态文本
function getTemperatureStatus(temp) {
    if (temp == null) return { label: '暂无数据', level: 'unknown' };
    if (temp <= 10) return { label: '极度低估', level: 'extreme-low' };
    if (temp <= 30) return { label: '低估', level: 'low' };
    if (temp <= 50) return { label: '适中偏低', level: 'mid-low' };
    if (temp <= 70) return { label: '适中偏高', level: 'mid-high' };
    if (temp <= 85) return { label: '高估', level: 'high' };
    return { label: '极度高估', level: 'extreme-high' };
}

// ============================================================
// 指数 Watchlist 管理（用户自选指数，类似 Stock/ETF 模式）
// ============================================================
const INDEX_WATCHLIST_FILE = path.join(__dirname, '..', 'data', 'index-watchlist.json');

// 指数图标预设色板
const INDEX_ICON_PRESETS = [
    { bg: 'linear-gradient(135deg, #63b3ed, #3182ce)', color: '#fff' },
    { bg: 'linear-gradient(135deg, #b794f4, #805ad5)', color: '#fff' },
    { bg: 'linear-gradient(135deg, #fc8181, #e53e3e)', color: '#fff' },
    { bg: 'linear-gradient(135deg, #fbd38d, #ed8936)', color: '#fff' },
    { bg: 'linear-gradient(135deg, #68d391, #38a169)', color: '#fff' },
    { bg: 'linear-gradient(135deg, #f687b3, #d53f8c)', color: '#fff' },
    { bg: 'linear-gradient(135deg, #90cdf4, #4299e1)', color: '#fff' },
    { bg: 'linear-gradient(135deg, #4fd1c5, #319795)', color: '#fff' },
    { bg: 'linear-gradient(135deg, #f6ad55, #dd6b20)', color: '#fff' },
    { bg: 'linear-gradient(135deg, #9f7aea, #6b46c1)', color: '#fff' },
    { bg: 'linear-gradient(135deg, #a0aec0, #718096)', color: '#fff' },
    { bg: 'linear-gradient(135deg, #76e4f7, #0bc5ea)', color: '#fff' },
];

function ensureDataDir() {
    const dir = path.dirname(INDEX_WATCHLIST_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readIndexWatchlist() {
    try {
        ensureDataDir();
        if (fs.existsSync(INDEX_WATCHLIST_FILE)) {
            const raw = fs.readFileSync(INDEX_WATCHLIST_FILE, 'utf8');
            const data = JSON.parse(raw);
            if (Array.isArray(data.indices) && data.indices.length > 0) {
                return data.indices;
            }
        }
    } catch (err) {
        console.warn('[指数] 读取 watchlist 失败:', err.message);
    }
    // 默认：从 FULL_INDEX_POOL 的默认选中生成初始 watchlist（不含上证指数，已在市场风向标展示）
    const defaults = [...DEFAULT_SELECTED_CODES];
    const initial = defaults.map(key => POOL_MAP[key]).filter(Boolean).map(cfg => ({
        name: cfg.name,
        code: cfg.code,
        market: cfg.market,
        secid: cfg.secid,
        icon: cfg.icon,
        iconBg: cfg.iconBg,
        iconColor: cfg.iconColor,
        category: cfg.category || 'broad-cn',
    }));
    writeIndexWatchlist(initial);
    return initial;
}

function writeIndexWatchlist(indices) {
    ensureDataDir();
    fs.writeFileSync(INDEX_WATCHLIST_FILE, JSON.stringify({ indices }, null, 2), 'utf8');
}

// ============================================================
// 搜索指数（通过东方财富 API）
// ============================================================
async function searchIndex(keyword) {
    if (!keyword || keyword.trim().length === 0) return [];
    const kw = keyword.trim();

    // 东方财富搜索接口
    const url = `https://searchapi.eastmoney.com/api/suggest/get?input=${encodeURIComponent(kw)}&type=14&token=D43BF722C8E33BDC906FB84D85E326E8&count=30`;
    try {
        const res = await safeFetch(url, {
            headers: { ...HEADERS, Referer: 'https://so.eastmoney.com/' },
        }, 1);
        const data = await res.json();
        if (!data?.QuotationCodeTable?.Data) return [];

        const seen = new Set();
        return data.QuotationCodeTable.Data
            .filter(d => {
                const code = d.Code || '';
                const classify = (d.Classify || '').toUpperCase();
                const secType = String(d.SecurityType || '');
                // 指数类型：Classify=INDEX/UNIVERSALINDEX 或 SecurityType=5/11
                const isIndex = classify === 'INDEX' || classify === 'UNIVERSALINDEX' || secType === '5' || secType === '11';
                if (!isIndex) return false;
                // 去重
                if (seen.has(code)) return false;
                seen.add(code);
                return true;
            })
            .slice(0, 15)
            .map(d => {
                const code = d.Code;
                const mkt = String(d.MktNum || '');
                let market, secid;
                if (mkt === '0') { market = 'SZ'; secid = `0.${code}`; }
                else if (mkt === '1') { market = 'SH'; secid = `1.${code}`; }
                else if (mkt === '2' || mkt === '128') { market = 'HI'; secid = `100.${code}`; }
                else if (mkt === '100') {
                    // MktNum=100 可能是港股或美股，通过代码特征区分
                    if (/^(HSI|HSTE|HSCE|HSSC)/.test(code)) { market = 'HI'; secid = `100.${code}`; }
                    else if (/^(SPX|NDX|DJI|IXIC|INX)/.test(code)) { market = 'US'; secid = `100.${code}`; }
                    else { market = 'HI'; secid = `100.${code}`; } // 默认归为港股
                }
                else {
                    // 智能推断
                    if (/^39/.test(code)) { market = 'SZ'; secid = `0.${code}`; }
                    else if (/^(HSI|HSTE|HSCE|HSSC)/.test(code)) { market = 'HI'; secid = `100.${code}`; }
                    else if (/^(SPX|NDX|DJI|IXIC|INX)/.test(code)) { market = 'US'; secid = `100.${code}`; }
                    else if (/^H3/.test(code)) { market = 'CSI'; secid = `2.${code}`; }
                    else { market = 'SH'; secid = `1.${code}`; }
                }
                const name = d.Name || code;
                // 从 POOL_MAP 获取已知图标，否则自动生成
                const poolKey = `${code}.${market}`;
                const poolCfg = POOL_MAP[poolKey];
                const icon = poolCfg?.icon || name.replace(/[A-Za-z0-9\s指数]/g, '').slice(0, 2) || code.slice(0, 3);
                return {
                    code,
                    name,
                    market,
                    secid,
                    icon,
                    category: poolCfg?.category || (market === 'US' ? 'broad-us' : market === 'HI' ? 'broad-hk' : 'broad-cn'),
                };
            });
    } catch (err) {
        console.warn('[指数] 搜索失败:', err.message);
        // fallback: 从 FULL_INDEX_POOL 本地过滤
        return FULL_INDEX_POOL
            .filter(cfg => cfg.name.includes(kw) || cfg.code.includes(kw))
            .slice(0, 15)
            .map(cfg => ({
                code: cfg.code,
                name: cfg.name,
                market: cfg.market,
                secid: cfg.secid,
                icon: cfg.icon,
                category: cfg.category,
            }));
    }
}

// ============================================================
// 获取指数实时行情 + 估值数据（基于 watchlist）
// ============================================================

// 美股卡片增强：从 indices.json 合并 K 线衍生统计字段（高 52 周/低 52 周/动量/Sparkline）
const _INDICES_CACHE_FILE = path.join(__dirname, '..', 'data', 'cache', 'indices.json');

/**
 * 计算单一周期涨跌幅（%），基于交易日切片。
 * - 优先使用 currentPrice 作为 "now"，避免 historySeries 末尾陈旧
 * - 当 currentPrice 缺失时回退到 historySeries 末尾收盘价
 * @param {Array<{close:number}>} historySeries 升序 K 线
 * @param {number} days 交易日数（1月≈21、3月≈63、6月≈126、1年≈252）
 * @param {number|null} currentPrice 实时价
 * @returns {number|null} 涨跌幅 %（保留两位），数据不足返回 null
 */
function calcMomentum(historySeries, days, currentPrice = null) {
    if (!Array.isArray(historySeries) || historySeries.length === 0) return null;
    if (typeof days !== 'number' || days <= 0) return null;
    const tailClose = historySeries[historySeries.length - 1]?.close;
    const last = (currentPrice && currentPrice > 0) ? currentPrice : tailClose;
    if (!last || last <= 0) return null;
    // 当 last = currentPrice（今日 T+0），days 天前 = 末尾回退 days-1 个交易日
    const offsetFromTail = (currentPrice && currentPrice > 0) ? (days - 1) : days;
    const idx = historySeries.length - 1 - offsetFromTail;
    if (idx < 0) return null;
    const past = historySeries[idx]?.close;
    if (!past || past <= 0) return null;
    return parseFloat((((last - past) / past) * 100).toFixed(2));
}

/**
 * 一次性计算 1m/3m/6m/1y 四周期动量（基于交易日近似）
 * @returns {{momentum1m:number|null, momentum3m:number|null, momentum6m:number|null, momentum1y:number|null}}
 */
function calcMomentumSet(historySeries, currentPrice = null) {
    return {
        momentum1m: calcMomentum(historySeries, 21, currentPrice),
        momentum3m: calcMomentum(historySeries, 63, currentPrice),
        momentum6m: calcMomentum(historySeries, 126, currentPrice),
        momentum1y: calcMomentum(historySeries, 252, currentPrice),
    };
}

/**
 * 计算美股 K 线动量字段（基于交易日近似：1月≈21、3月≈63、6月≈126、1年≈252）
 * @param {Array} historySeries - 升序 K 线数组，每条至少含 close 字段
 * @param {number|null} currentPrice - 实时价（来自 quote）。若提供，优先用作"now"，避免 historySeries 末尾陈旧导致动量与回撤偏差
 * @param {number|null} quoteHigh52w - 实时 quote 提供的 52 周高点（如腾讯源）。若提供，参与回撤计算的 max 比较
 * @returns {Object} 动量字段对象（缺失时全为 null）
 */
function computeUSMomentum(historySeries, currentPrice = null, quoteHigh52w = null) {
    const NA = {
        changeMonth: null, change3Month: null, change6Month: null, changeYear: null,
        drawdownFromHigh52w: null,
    };
    if (!Array.isArray(historySeries) || historySeries.length === 0) return NA;
    const tailClose = historySeries[historySeries.length - 1]?.close;
    // 优先用实时价；若实时价缺失/异常则回退到 K 线末尾
    const last = (currentPrice && currentPrice > 0) ? currentPrice : tailClose;
    if (!last || last <= 0) return NA;

    // 复用统一的 calcMomentum 口径，保持与全市场 momentum 字段一致
    const set = calcMomentumSet(historySeries, currentPrice);
    const round2 = (v) => v == null ? null : parseFloat(v.toFixed(2));

    // 距 52 周收盘高点回撤（正数 %）
    // 关键：max 取自三方候选 —— historySeries 250 日 close + 当前实时价 + quote 提供的 high52w
    // 避免历史 K 线源滞后/缺失最新高点时回撤为 0 的假象
    const last250 = historySeries.slice(-250);
    const closes250 = last250.map(k => k?.close).filter(c => c && c > 0);
    if (currentPrice && currentPrice > 0) closes250.push(currentPrice);
    if (quoteHigh52w && quoteHigh52w > 0) closes250.push(quoteHigh52w);
    let drawdownFromHigh52w = null;
    if (closes250.length > 0) {
        const high = Math.max(...closes250);
        if (high > 0) {
            const dd = ((high - last) / high) * 100;
            drawdownFromHigh52w = round2(dd < 0 ? 0 : dd);
        }
    }

    return {
        changeMonth: set.momentum1m,
        change3Month: set.momentum3m,
        change6Month: set.momentum6m,
        changeYear: set.momentum1y,
        drawdownFromHigh52w,
    };
}

/**
 * 读取 data/cache/indices.json 并构造 Map<code, indexRecord>，code 含 .market 后缀（如 'SPX.US'）
 * @returns {{ map: Map<string, Object>, cacheTime: number }} 失败或文件不存在时返回空 Map + cacheTime=0
 */
function loadIndicesCacheMap() {
    try {
        if (!fs.existsSync(_INDICES_CACHE_FILE)) return { map: new Map(), cacheTime: 0 };
        const raw = fs.readFileSync(_INDICES_CACHE_FILE, 'utf8');
        const wrapper = JSON.parse(raw);
        const indices = wrapper?.data?.indices || wrapper?.indices || [];
        const cacheTime = typeof wrapper?.time === 'number' ? wrapper.time : 0;
        if (!Array.isArray(indices)) return { map: new Map(), cacheTime };
        return { map: new Map(indices.map(i => [i.code, i])), cacheTime };
    } catch (e) {
        console.warn('  [行情] 读取 indices.json 失败，跳过美股增强:', e.message);
        return { map: new Map(), cacheTime: 0 };
    }
}

// ============================================================
// 运行时节奏对齐：indices.json 陈旧时主动触发美股 K 线刷新
// ============================================================
const INDICES_CACHE_STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30 分钟
const LAZY_REFRESH_LIMIT_PER_BATCH = 2; // 每次主动刷新最多 N 个指数，避免外部源压力突增
let _indicesRefreshInProgress = false;

function triggerLazyUSKlineRefresh(usWatchlist) {
    if (_indicesRefreshInProgress) return; // 已有刷新进行中，跳过本次
    if (!Array.isArray(usWatchlist) || usWatchlist.length === 0) return;
    _indicesRefreshInProgress = true;
    setImmediate(async () => {
        try {
            const targets = usWatchlist.slice(0, LAZY_REFRESH_LIMIT_PER_BATCH);
            console.log(`  [行情] indices.json 陈旧，主动刷新 ${targets.length} 个美股指数 K 线: ${targets.map(t => t.code).join(',')}`);
            for (const idx of targets) {
                const poolKey = `${idx.code}.${idx.market}`;
                const cfg = POOL_MAP[poolKey] || {
                    name: idx.name, code: idx.code, secid: idx.secid, market: idx.market,
                };
                try {
                    await fetchIndexHistory(cfg);
                } catch (e) {
                    // 静默：不阻塞批次
                }
            }
        } finally {
            _indicesRefreshInProgress = false;
        }
    });
}

async function fetchIndexQuotesForWatchlist(forceRefresh = false) {
    const indices = readIndexWatchlist();
    if (!indices || indices.length === 0) return { indices: [], updateTime: new Date().toISOString() };

    // 构造 allConfigs 格式以复用 fetchRealtimeQuotes
    // 增强：确保 market 字段始终正确，避免前端 _inferMarket() 推断失败
    const configs = indices.map(idx => {
        const poolKey = `${idx.code}.${idx.market}`;
        const poolCfg = POOL_MAP[poolKey];
        if (poolCfg) return poolCfg;
        // 不在 POOL_MAP 中：尽量补全 market
        let inferredMarket = idx.market || '';
        // 从 secid 前缀推断
        if (!inferredMarket && idx.secid) {
            const sec = String(idx.secid);
            if (/^100\.|^us_/i.test(sec)) inferredMarket = 'US';
            else if (/^1\./.test(sec)) inferredMarket = 'SH';
            else if (/^0\./.test(sec)) inferredMarket = 'SZ';
            else if (/^2\./.test(sec)) inferredMarket = 'CSI';
        }
        // 从 code 正则推断
        if (!inferredMarket && idx.code) {
            if (/^(SPX|NDX|DJI|VIX|IXIC|US.*INDEX)$/i.test(idx.code)) inferredMarket = 'US';
            else if (/^(HSI|HSCEI|HSSTECH|HSSCNE)$/i.test(idx.code)) inferredMarket = 'HI';
        }
        // 兜底
        if (!inferredMarket) inferredMarket = 'SH';
        return {
            name: idx.name,
            code: idx.code,
            secid: idx.secid,
            market: inferredMarket,
        };
    });

    // 并行获取行情 + 蛋卷估值 + 知有行温度
    const [quotes, djEvaMap, yzyxData] = await Promise.all([
        fetchRealtimeQuotes(configs),
        fetchDanjuanEvaluation().catch(() => ({})),
        fetchYZYXThermometer().catch(() => null),
    ]);

    // 美股增强：加载 indices.json 缓存的 K 线衍生统计字段（仅在 results.map 内对美股启用）
    const { map: indicesByCode, cacheTime: indicesCacheTime } = loadIndicesCacheMap();

    // 节奏对齐：若 indices.json 陈旧（默认 30min）且 watchlist 含美股，异步触发 K 线刷新
    // 本次响应仍用旧数据返回（不阻塞），下次请求即可受益
    if (indicesCacheTime > 0 && (Date.now() - indicesCacheTime) > INDICES_CACHE_STALE_THRESHOLD_MS) {
        const usWatchlist = indices.filter(i => i.market === 'US');
        if (usWatchlist.length > 0) {
            triggerLazyUSKlineRefresh(usWatchlist);
        }
    }

    const results = indices.map(idx => {
        const q = quotes[idx.code] || {};
        const poolKey = `${idx.code}.${idx.market}`;
        const poolCfg = POOL_MAP[poolKey];

        // 蛋卷基金估值（通过 djCode 匹配）
        let pe = null, pb = null, pePercentile = null, pbPercentile = null;
        let roe = null, dividend = null, evaType = null;
        if (poolCfg && poolCfg.djCode && djEvaMap[poolCfg.djCode]) {
            const dj = djEvaMap[poolCfg.djCode];
            pe = dj.pe;
            pb = dj.pb;
            pePercentile = dj.pePercentile;
            pbPercentile = dj.pbPercentile;
            roe = dj.roe;
            dividend = dj.dividend;
            evaType = dj.evaType;
        }

        // 知有行温度
        let temperature = null;
        if (yzyxData && yzyxData.indices) {
            const cfgShortCode = String(idx.code).split('.')[0].toUpperCase();
            const codeAliases = {
                'HSTECH': ['H11136'], // 恒生科技 → 知有行的"中国互联网"
            };
            const nameAliases = {
                '中证消费': ['中证消费', '800消费'],
                '恒生科技': ['恒生科技', '中国互联网'],
            };
            const allowedCodes = codeAliases[cfgShortCode] || [cfgShortCode];
            let yzyxTemp = yzyxData.indices.find(yi => {
                const yiCode = String(yi.shortCode || yi.code || '').split('.')[0].toUpperCase();
                return allowedCodes.includes(yiCode);
            });
            if (!yzyxTemp) {
                const aliases = (nameAliases[idx.name] || [idx.name]).map(n => n.trim());
                yzyxTemp = yzyxData.indices.find(yi => aliases.includes(String(yi.name || '').trim()));
            }
            if (yzyxTemp) temperature = yzyxTemp.temperature;
        }

        // 美股卡片增强：从 indices.json 合并 K 线衍生字段（high52w/low52w/sparkData + 动量）
        // 必须放在 usValuationInfo 处理之前，使其使用增强后的 q.high52w/q.low52w 触发水位推导
        let usEnrich = null;
        if (idx.market === 'US') {
            const fullCode = `${idx.code}.${idx.market}`;
            const enriched = indicesByCode.get(fullCode);
            if (enriched) {
                // 用 indices.json 的 K 线统计覆盖（quotes 接口对美股一般拿不到这些字段）
                if (enriched.high52w && (!q.high52w || q.high52w <= 0)) q.high52w = enriched.high52w;
                if (enriched.low52w && (!q.low52w || q.low52w <= 0)) q.low52w = enriched.low52w;
                // 关键：动量计算优先用实时价 q.price 作为 last，避免 historySeries 末尾陈旧
                // （东财 K 线对美股可能滞后，但腾讯实时 quotes 一般是准确的）
                // q.high52w 也参与回撤的 max 比较，避免历史 K 线缺最新高点时 dd=0 的假象
                const momentum = computeUSMomentum(enriched.historySeries, q.price || null, q.high52w || null);
                // sparkData 末尾追加实时价（若不重复且实时价有效），让 sparkline 与卡片头部价格连续
                let sparkData = Array.isArray(enriched.sparkData) ? enriched.sparkData.slice() : null;
                if (sparkData && sparkData.length > 0 && q.price && q.price > 0) {
                    const lastSpark = sparkData[sparkData.length - 1];
                    if (Math.abs(lastSpark - q.price) > 0.01) {
                        sparkData.push(q.price);
                        if (sparkData.length > 31) sparkData = sparkData.slice(-31);
                    }
                }
                usEnrich = {
                    sparkData,
                    ...momentum,
                };
            }
        }

        // 全市场多周期动量（A 股 / 港股 / 美股 统一字段）
        // - 美股：复用 computeUSMomentum 的口径（已在 usEnrich 中算好）
        // - 其他市场：从 indices.json 缓存的 historySeries 计算；缓存中也已含 momentum1m/3m/6m/1y 可直接复用
        let momentumAll = { momentum1m: null, momentum3m: null, momentum6m: null, momentum1y: null };
        if (idx.market === 'US' && usEnrich) {
            momentumAll = {
                momentum1m: usEnrich.changeMonth ?? null,
                momentum3m: usEnrich.change3Month ?? null,
                momentum6m: usEnrich.change6Month ?? null,
                momentum1y: usEnrich.changeYear ?? null,
            };
        } else {
            const fullCodeForMomentum = `${idx.code}.${idx.market}`;
            const enrichedAny = indicesByCode.get(fullCodeForMomentum);
            if (enrichedAny) {
                if (enrichedAny.momentum1m != null || enrichedAny.momentum3m != null || enrichedAny.momentum6m != null || enrichedAny.momentum1y != null) {
                    momentumAll = {
                        momentum1m: enrichedAny.momentum1m ?? null,
                        momentum3m: enrichedAny.momentum3m ?? null,
                        momentum6m: enrichedAny.momentum6m ?? null,
                        momentum1y: enrichedAny.momentum1y ?? null,
                    };
                } else if (Array.isArray(enrichedAny.historySeries) && enrichedAny.historySeries.length > 0) {
                    // 兜底：旧版本 indices.json 还没写过 momentumXxx 字段时，现场算
                    momentumAll = calcMomentumSet(enrichedAny.historySeries, q.price || null);
                }
            }
        }

        // 美股指数特殊处理：公开数据源不提供PE/PB，从腾讯扩展字段和K线位置推算估值区间
        let usValuationInfo = null;
        if (idx.market === 'US' && poolCfg) {
            usValuationInfo = poolCfg.usValuation || null;
            // 基于价格在52周区间的位置估算简易「价格水位」（替代百分位概念）
            if (q.price && q.high52w && q.low52w && q.high52w > q.low52w) {
                const range52w = q.high52w - q.low52w;
                const position52w = ((q.price - q.low52w) / range52w * 100);
                pePercentile = parseFloat(position52w.toFixed(1)); // 作为「价格水位」展示
                if (position52w < 30) evaType = 'low';
                else if (position52w < 70) evaType = 'mid';
                else evaType = 'high';
            }
        }

        // 构造完整代码（含市场后缀），与 fetchAllIndexData() 返回的 code 格式保持一致
            const fullCode = `${idx.code}.${idx.market}`;
            return {
            name: idx.name,
            code: fullCode,
            market: idx.market,
            secid: idx.secid,
            icon: idx.icon,
            iconBg: idx.iconBg,
            iconColor: idx.iconColor,
            category: idx.category,
            // 行情
            price: q.price || null,
            changePercent: q.changePercent || 0,
            changeAmount: q.changeAmount || 0,
            high: q.high || null,
            low: q.low || null,
            open: q.open || null,
            prevClose: q.prevClose || null,
            // 52周高低（美股从腾讯扩展字段获取，兜底来自 indices.json K线统计）
            high52w: q.high52w || null,
            low52w: q.low52w || null,
            // 涨幅区间（美股专属，旧字段保留向后兼容）
            changeMonth: (usEnrich?.changeMonth ?? q.changeMonth) ?? null,
            change3Month: (usEnrich?.change3Month ?? q.change3Month) ?? null,
            change6Month: usEnrich?.change6Month ?? null,
            changeYear: usEnrich?.changeYear ?? null,
            drawdownFromHigh52w: usEnrich?.drawdownFromHigh52w ?? null,
            sparkData: usEnrich?.sparkData ?? null,
            // 全市场多周期动量（A股/港股/美股统一字段）
            momentum1m: momentumAll.momentum1m,
            momentum3m: momentumAll.momentum3m,
            momentum6m: momentumAll.momentum6m,
            momentum1y: momentumAll.momentum1y,
            // 估值
            pe, pb, pePercentile, pbPercentile,
            roe, dividend, evaType, temperature,
            // 美股估值参考
            usValuation: usValuationInfo,
        };
    });

    return {
        indices: results,
        updateTime: new Date().toISOString(),
    };
}

module.exports = {
    FULL_INDEX_POOL,
    DEFAULT_SELECTED_CODES,
    DASHBOARD_ONLY_CODES,
    POOL_MAP,
    INDEX_ICON_PRESETS,
    buildIndexConfig,
    buildDashboardOnlyConfig,
    fetchRealtimeQuotes,
    fetchHistoryKlines,
    fetchIndexHistory,
    fetchDanjuanEvaluation,
    fetchYZYXThermometer,
    fetchYZYXIndexDetail,
    resetYZYXCache,
    getTemperatureStatus,
    fetchAllIndexData,
    searchIndex,
    readIndexWatchlist,
    writeIndexWatchlist,
    fetchIndexQuotesForWatchlist,
    // 健康监控（K 线源）
    getKlineSourceHealthSnapshot,
    startKlineSourceHealthMonitor,
    stopKlineSourceHealthMonitor,
};
