/**
 * 股票实时行情服务 - 从东方财富获取个股实时价格
 * 支持用户自定义关注股票列表，每次请求获取最新行情
 */
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const iconv = require('iconv-lite');

// ============================================================
// 默认关注股票列表
// ============================================================
const DEFAULT_WATCHLIST = [
    {
        name: '隆基绿能', code: '601012', market: 'SH', secid: '1.601012',
        icon: '隆基', iconBg: 'linear-gradient(135deg, #48bb78, #2f855a)', iconColor: '#fff',
        sector: '光伏',
    },
    {
        name: '宝信软件', code: '600845', market: 'SH', secid: '1.600845',
        icon: '宝信', iconBg: 'linear-gradient(135deg, #63b3ed, #3182ce)', iconColor: '#fff',
        sector: '软件',
    },
    {
        name: '国电南瑞', code: '600406', market: 'SH', secid: '1.600406',
        icon: '南瑞', iconBg: 'linear-gradient(135deg, #f6ad55, #dd6b20)', iconColor: '#fff',
        sector: '电力设备',
    },
    {
        name: '先导智能', code: '300450', market: 'SZ', secid: '0.300450',
        icon: '先导', iconBg: 'linear-gradient(135deg, #b794f4, #805ad5)', iconColor: '#fff',
        sector: '锂电设备',
    },
];

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Referer': 'https://quote.eastmoney.com/',
};

// ============================================================
// 关注列表持久化
// ============================================================
const WATCHLIST_FILE = path.join(__dirname, '..', 'data', 'stock-watchlist.json');

function readWatchlist() {
    try {
        if (fs.existsSync(WATCHLIST_FILE)) {
            const raw = fs.readFileSync(WATCHLIST_FILE, 'utf8');
            const cfg = JSON.parse(raw);
            if (Array.isArray(cfg.stocks) && cfg.stocks.length > 0) {
                return cfg.stocks;
            }
        }
    } catch (err) {
        console.warn('[股票] 读取关注列表失败:', err.message);
    }
    return DEFAULT_WATCHLIST;
}

function writeWatchlist(stocks) {
    const dir = path.dirname(WATCHLIST_FILE);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(WATCHLIST_FILE, JSON.stringify({ stocks }, null, 2), 'utf8');
}

// 初始化：如果没有配置文件，写入默认列表
function ensureWatchlist() {
    if (!fs.existsSync(WATCHLIST_FILE)) {
        writeWatchlist(DEFAULT_WATCHLIST);
    }
}

// ============================================================
// 通用 fetch 带重试
// ============================================================
async function safeFetch(url, options = {}, retries = 2) {
    for (let i = 0; i <= retries; i++) {
        try {
            const res = await fetch(url, { timeout: 10000, ...options });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res;
        } catch (err) {
            if (i === retries) throw err;
            await new Promise(r => setTimeout(r, 600 * (i + 1)));
        }
    }
}

const STOCK_KLINE_SOURCE_CACHE_TTL = {
    eastmoney: 12 * 60 * 60 * 1000,
    tencent: 20 * 60 * 1000,
};
const STOCK_KLINE_FAILURE_COOLDOWN = 10 * 60 * 1000;
const STOCK_KLINE_CONCURRENCY = 2;
const _stockKlineCache = new Map();
let _eastmoneyStockKlineCooldownUntil = 0;

function getFreshStockKlineEntry(cacheKey) {
    const hit = _stockKlineCache.get(cacheKey);
    if (!hit || !Array.isArray(hit.klines) || hit.klines.length === 0) {
        return null;
    }
    const ttl = STOCK_KLINE_SOURCE_CACHE_TTL[hit.source] || STOCK_KLINE_SOURCE_CACHE_TTL.tencent;
    return (Date.now() - hit.time) < ttl ? hit : null;
}

function getStaleStockKlineEntry(cacheKey) {
    const hit = _stockKlineCache.get(cacheKey);
    return hit && Array.isArray(hit.klines) && hit.klines.length > 0 ? hit : null;
}

function setCachedStockKlines(cacheKey, klines, source) {
    if (!Array.isArray(klines) || klines.length === 0) {
        return;
    }
    _stockKlineCache.set(cacheKey, {
        klines,
        source,
        time: Date.now(),
    });
}

function eastmoneyStockKlineInCooldown() {
    return Date.now() < _eastmoneyStockKlineCooldownUntil;
}

function markEastmoneyStockKlineCooldown(reason) {
    const nextUntil = Date.now() + STOCK_KLINE_FAILURE_COOLDOWN;
    if (nextUntil > _eastmoneyStockKlineCooldownUntil) {
        _eastmoneyStockKlineCooldownUntil = nextUntil;
        console.warn(`  [股票K线] 东方财富进入 ${Math.round(STOCK_KLINE_FAILURE_COOLDOWN / 60000)} 分钟冷却: ${reason}`);
    }
}

function isEastmoneyKlineTransientError(err) {
    const message = String(err?.message || '');
    return /socket hang up|ECONNRESET|ETIMEDOUT|timeout|network|HTTP 429|HTTP 403|HTTP 5\d\d/i.test(message);
}

function createStockRefreshStatus(partial = {}) {
    return {
        state: partial.state || 'primary-live',
        label: partial.label || '主源直连',
        source: partial.source || 'eastmoney',
        usedStaleCache: !!partial.usedStaleCache,
        inCooldown: !!partial.inCooldown,
        fallbackActive: !!partial.fallbackActive,
    };
}

function summarizeStockRefreshStatus(statuses = [], quoteFallbackCount = 0) {
    const list = statuses.filter(Boolean);
    const staleCacheCount = list.filter(item => item.usedStaleCache).length;
    const cooldownCount = list.filter(item => item.inCooldown).length;
    const fallbackCount = list.filter(item => item.fallbackActive).length;
    const details = [];
    if (staleCacheCount > 0) details.push(`已回退缓存 ${staleCacheCount} 只`);
    if (cooldownCount > 0) details.push(`主源冷却中 ${cooldownCount} 只`);
    if (fallbackCount > 0) details.push(`备用源生效中 ${fallbackCount} 只`);
    if (quoteFallbackCount > 0) details.push(`行情沿用上一轮 ${quoteFallbackCount} 只`);

    return {
        staleCacheCount,
        cooldownCount,
        fallbackCount,
        quoteFallbackCount,
        summaryText: details.length > 0 ? details.join(' · ') : '主源直连稳定',
        degraded: staleCacheCount > 0 || cooldownCount > 0 || fallbackCount > 0 || quoteFallbackCount > 0,
    };
}

async function mapWithConcurrency(items, limit, worker) {
    const results = new Array(items.length);
    let currentIndex = 0;

    async function runWorker() {
        while (currentIndex < items.length) {
            const index = currentIndex;
            currentIndex += 1;
            results[index] = await worker(items[index], index);
        }
    }

    const workerCount = Math.max(1, Math.min(limit, items.length));
    await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
    return results;
}

// ============================================================
// 东方财富 push2 批量个股行情
// 字段说明:
//   f2=最新价 f3=涨跌幅 f4=涨跌额 f5=成交量(手) f6=成交额
//   f12=代码 f14=名称 f15=最高 f16=最低 f17=今开 f18=昨收
//   f8=换手率 f9=市盈率(动) f23=市净率 f20=总市值 f21=流通市值
//   f115=市盈率(TTM)
// ============================================================
async function fetchStockQuotesEastmoney(stocks) {
    const secids = stocks.map(s => s.secid).join(',');
    const fields = 'f2,f3,f4,f5,f6,f8,f9,f12,f14,f15,f16,f17,f18,f20,f21,f23,f115';
    const url = `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=${fields}&secids=${secids}`;

    const res = await safeFetch(url, { headers: HEADERS });
    const data = await res.json();
    if (data?.data?.diff) {
        const quotes = {};
        data.data.diff.forEach(item => {
            if (item.f2 !== '-' && item.f12) {
                quotes[item.f12] = {
                    price: parseFloat(item.f2) || 0,
                    changePercent: parseFloat(item.f3) || 0,
                    changeAmount: parseFloat(item.f4) || 0,
                    volume: parseFloat(item.f5) || 0,           // 成交量(手)
                    amount: parseFloat(item.f6) || 0,           // 成交额
                    turnoverRate: parseFloat(item.f8) || 0,     // 换手率
                    peDynamic: parseFloat(item.f9) || null,     // 市盈率(动)
                    peTTM: parseFloat(item.f115) || null,       // 市盈率(TTM)
                    pbRatio: parseFloat(item.f23) || null,      // 市净率
                    name: item.f14 || '',
                    high: parseFloat(item.f15) || 0,
                    low: parseFloat(item.f16) || 0,
                    open: parseFloat(item.f17) || 0,
                    prevClose: parseFloat(item.f18) || 0,
                    marketCap: parseFloat(item.f20) || 0,       // 总市值
                    floatCap: parseFloat(item.f21) || 0,        // 流通市值
                };
            }
        });
        console.log(`  [股票行情] 东方财富批量接口获取 ${Object.keys(quotes).length} 条`);
        return quotes;
    }
    return {};
}

// ============================================================
// 腾讯行情备用源 (qt.gtimg.cn)
// 格式: v_{market}{code}="字段1~字段2~...~字段N"
// 关键字段索引: 3=最新价 4=昨收 5=今开 6=成交量(手) 7=外盘 8=内盘
//   31=最高 32=最低 33=涨跌幅(%) 37=成交额(万) 38=换手率(%)
//   39=市盈率 44=流通市值(亿) 45=总市值(亿) 46=市净率
// ============================================================
async function fetchStockQuotesTencent(stocks) {
    const codes = stocks.map(s => {
        const prefix = s.market === 'SZ' ? 'sz' : 'sh';
        return `${prefix}${s.code}`;
    }).join(',');
    const url = `https://qt.gtimg.cn/q=${codes}`;

    const res = await safeFetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            'Referer': 'https://finance.qq.com/',
        },
    });
    const buf = await res.buffer();
    const text = iconv.decode(buf, 'gbk');
    const quotes = {};

    // 解析每一行 v_xxNNNNNN="field1~field2~..."
    const lines = text.split('\n').filter(l => l.includes('~'));
    for (const line of lines) {
        const match = line.match(/v_\w+="(.+)"/);
        if (!match) continue;
        const fields = match[1].split('~');
        const code = fields[2]; // 股票代码
        if (!code) continue;

        const price = parseFloat(fields[3]) || 0;
        const prevClose = parseFloat(fields[4]) || 0;
        const open = parseFloat(fields[5]) || 0;
        const volume = parseFloat(fields[6]) || 0;
        const high = parseFloat(fields[33]) || 0;
        const low = parseFloat(fields[34]) || 0;
        const changePercent = parseFloat(fields[32]) || 0;
        const changeAmount = parseFloat(fields[31]) || 0;
        const turnoverRate = parseFloat(fields[38]) || 0;
        const peDynamic = parseFloat(fields[39]) || null;
        const pbRatio = parseFloat(fields[46]) || null;
        const totalCapStr = fields[45]; // 总市值(亿)
        const floatCapStr = fields[44]; // 流通市值(亿)
        const amountStr = fields[37]; // 成交额(万)

        const totalCap = parseFloat(totalCapStr) || 0;
        const floatCap = parseFloat(floatCapStr) || 0;
        const amount = parseFloat(amountStr) || 0;

        if (price > 0) {
            quotes[code] = {
                price,
                changePercent,
                changeAmount,
                volume,
                amount: amount * 10000,        // 万 → 元
                turnoverRate,
                peDynamic,
                peTTM: peDynamic,               // 腾讯源没有单独 TTM，先用动态PE
                pbRatio,
                name: fields[1] || '',
                high,
                low,
                open,
                prevClose,
                marketCap: totalCap * 100000000, // 亿 → 元
                floatCap: floatCap * 100000000,
            };
        }
    }
    console.log(`  [股票行情] 腾讯备用源获取 ${Object.keys(quotes).length} 条`);
    return quotes;
}

// ============================================================
// 带自动 failover 的行情获取：东方财富 → 腾讯
// ============================================================
async function fetchStockQuotes(stocks) {
    // 先尝试东方财富主源
    try {
        const quotes = await fetchStockQuotesEastmoney(stocks);
        if (Object.keys(quotes).length > 0) {
            return { quotes, source: 'eastmoney' };
        }
    } catch (err) {
        console.warn('  [股票行情] 东方财富批量接口失败:', err.message);
    }

    // 主源失败，切换腾讯备用源
    try {
        const quotes = await fetchStockQuotesTencent(stocks);
        if (Object.keys(quotes).length > 0) {
            console.log('  [股票行情] 已切换腾讯备用源');
            return { quotes, source: 'tencent' };
        }
    } catch (err) {
        console.warn('  [股票行情] 腾讯备用源也失败:', err.message);
    }

    return { quotes: {}, source: 'none' };
}

// ============================================================
// 东方财富个股日K线（最近60个交易日，用于迷你走势图）
// ============================================================
async function fetchStockKlinesDetailed(secid, limit = 60, options = {}) {
    const timeout = options.timeout ?? 3500;
    const retries = options.retries ?? 0;
    const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&fqt=1&end=20500101&lmt=${limit}`;
    try {
        const res = await safeFetch(url, { timeout, headers: HEADERS }, retries);
        const data = await res.json();
        if (data?.data?.klines?.length > 0) {
            return {
                klines: data.data.klines.map(line => {
                    const p = line.split(',');
                    return {
                        date: p[0],
                        open: +p[1],
                        close: +p[2],
                        high: +p[3],
                        low: +p[4],
                        volume: +p[5],
                        amount: +p[6],
                        changePercent: +p[8],
                    };
                }),
                errorMessage: null,
                shouldCooldown: false,
            };
        }
        return {
            klines: [],
            errorMessage: data?.message || data?.msg || '接口未返回K线数据',
            shouldCooldown: false,
        };
    } catch (err) {
        return {
            klines: [],
            errorMessage: err.message,
            shouldCooldown: isEastmoneyKlineTransientError(err),
        };
    }
}

async function fetchStockKlines(secid, limit = 60, options = {}) {
    const result = await fetchStockKlinesDetailed(secid, limit, options);
    if (result.klines.length === 0 && result.errorMessage) {
        console.warn(`  [股票K线] ${secid} 获取失败: ${result.errorMessage}`);
    }
    return result.klines;
}

async function fetchTencentStockKlines(code, market, limit = 60) {
    const txCode = market === 'SZ'
        ? `sz${code}`
        : market === 'SH'
            ? `sh${code}`
            : (market === 'HI' || market === 'HK')
                ? `hk${code}`
                : null;
    if (!txCode) {
        return [];
    }

    const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${txCode},day,,,${Math.max(limit, 120)},qfq`;
    try {
        const res = await safeFetch(url, { timeout: 3500 }, 0);
        const data = await res.json();
        const days = data?.data?.[txCode]?.qfqday || data?.data?.[txCode]?.day || [];
        if (days.length > 0) {
            console.log(`  [股票K线-腾讯] ${txCode} fallback成功, ${days.length} 条`);
            return days.slice(-limit).map(d => ({
                date: d[0],
                open: +d[1],
                close: +d[2],
                high: +d[3],
                low: +d[4],
                volume: +d[5] || 0,
                amount: 0,
                changePercent: 0,
            }));
        }
    } catch (err) {
        console.warn(`  [股票K线-腾讯] ${txCode} 获取失败:`, err.message);
    }
    return [];
}

async function fetchResilientStockKlinesDetailed(stock, limit = 60) {
    const cacheKey = `${stock.code}.${stock.market}`;
    const freshEntry = getFreshStockKlineEntry(cacheKey);
    if (freshEntry) {
        return {
            klines: freshEntry.klines,
            status: createStockRefreshStatus({
                state: 'fresh-cache',
                label: freshEntry.source === 'eastmoney' ? '主源缓存命中' : '备用缓存命中',
                source: freshEntry.source,
            }),
        };
    }

    const staleEntry = getStaleStockKlineEntry(cacheKey);
    const cooldownActive = eastmoneyStockKlineInCooldown();

    if (cooldownActive) {
        if (staleEntry) {
            console.log(`  [股票K线] 东方财富冷却中，${stock.name} 直接复用${staleEntry.source === 'eastmoney' ? '主源缓存' : '备用缓存'}`);
            return {
                klines: staleEntry.klines,
                status: createStockRefreshStatus({
                    state: 'cooldown-cache',
                    label: '主源冷却中 · 已回退缓存',
                    source: staleEntry.source,
                    usedStaleCache: true,
                    inCooldown: true,
                }),
            };
        }
        console.log(`  [股票K线] 东方财富冷却中，${stock.name} 直接使用腾讯备用源`);
    } else {
        const eastmoneyResult = await fetchStockKlinesDetailed(stock.secid, limit, {
            timeout: 3500,
            retries: 0,
        });
        if (eastmoneyResult.klines.length > 0) {
            setCachedStockKlines(cacheKey, eastmoneyResult.klines, 'eastmoney');
            return {
                klines: eastmoneyResult.klines,
                status: createStockRefreshStatus({
                    state: 'primary-live',
                    label: '主源直连',
                    source: 'eastmoney',
                }),
            };
        }
        if (eastmoneyResult.shouldCooldown) {
            markEastmoneyStockKlineCooldown(`${stock.name} 主源请求失败，优先回退缓存/腾讯备用源`);
        }
        if (staleEntry) {
            console.warn(`  [股票K线] ${stock.name} 主源失败，回退历史缓存避免走势图空白`);
            return {
                klines: staleEntry.klines,
                status: createStockRefreshStatus({
                    state: 'stale-cache',
                    label: '已回退缓存',
                    source: staleEntry.source,
                    usedStaleCache: true,
                }),
            };
        }
        if (eastmoneyResult.errorMessage) {
            console.warn(`  [股票K线] ${stock.secid} 获取失败: ${eastmoneyResult.errorMessage}`);
        }
    }

    const tencentKlines = await fetchTencentStockKlines(stock.code, stock.market, limit);
    if (tencentKlines.length > 0) {
        setCachedStockKlines(cacheKey, tencentKlines, 'tencent');
        return {
            klines: tencentKlines,
            status: createStockRefreshStatus({
                state: cooldownActive ? 'cooldown-tencent' : 'tencent-fallback',
                label: cooldownActive ? '主源冷却中 · 备用源生效中' : '备用源生效中',
                source: 'tencent',
                inCooldown: cooldownActive,
                fallbackActive: true,
            }),
        };
    }

    if (staleEntry) {
        console.warn(`  [股票K线] ${stock.name} 返回历史缓存，避免刷新空白`);
        return {
            klines: staleEntry.klines,
            status: createStockRefreshStatus({
                state: 'stale-cache-final',
                label: cooldownActive ? '主源冷却中 · 已回退缓存' : '已回退缓存',
                source: staleEntry.source,
                usedStaleCache: true,
                inCooldown: cooldownActive,
            }),
        };
    }

    return {
        klines: [],
        status: createStockRefreshStatus({
            state: 'unavailable',
            label: 'K线暂不可用',
            source: 'none',
            inCooldown: cooldownActive,
        }),
    };
}

async function fetchResilientStockKlines(stock, limit = 60) {
    const result = await fetchResilientStockKlinesDetailed(stock, limit);
    return result.klines;
}

// ============================================================
// 组装完整的股票行情数据
// ============================================================
let _stockCache = null;
let _stockCacheTime = 0;
const STOCK_CACHE_TTL = 8 * 1000; // 8秒缓存（配合前端10秒刷新）

async function fetchAllStockData(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && _stockCache && (now - _stockCacheTime) < STOCK_CACHE_TTL) {
        return _stockCache;
    }

    console.log('[股票] ===== 获取关注股票行情 =====');
    const startTime = Date.now();
    const stocks = readWatchlist();

    // 获取实时行情（自动 failover：东方财富 → 腾讯）
    const { quotes, source: quoteSource } = await fetchStockQuotes(stocks);
    const prevStockMap = new Map((_stockCache?.stocks || []).map(item => [item.code, item]));

    const results = await mapWithConcurrency(stocks, STOCK_KLINE_CONCURRENCY, async (stock) => {
        const resultCode = `${stock.code}.${stock.market}`;
        const prev = prevStockMap.get(resultCode);
        const hasLiveQuote = !!quotes[stock.code];
        const quote = quotes[stock.code] || {
            name: prev?.name,
            price: prev?.price,
            changePercent: prev?.changePercent,
            changeAmount: prev?.changeAmount,
            open: prev?.open,
            prevClose: prev?.prevClose,
            high: prev?.high,
            low: prev?.low,
            volume: prev?.volume,
            amount: prev?.amount,
            turnoverRate: prev?.turnoverRate,
            peDynamic: prev?.peDynamic,
            peTTM: prev?.peTTM,
            pbRatio: prev?.pbRatio,
            marketCap: prev?.marketCap,
            floatCap: prev?.floatCap,
        };
        const quoteFallbackUsed = !hasLiveQuote && !!prev;

        const klineResult = await fetchResilientStockKlinesDetailed(stock, 60);
        const klines = klineResult.klines || [];
        const klineStatus = klineResult.status || createStockRefreshStatus();
        const sparkData = klines.map(k => k.close);

        // 52周高低（优先使用 K 线的高低点，避免只按收盘价计算偏差）
        let high52w = null, low52w = null;
        if (klines.length > 0) {
            high52w = Math.max(...klines.map(k => Number.isFinite(k.high) ? k.high : k.close));
            low52w = Math.min(...klines.map(k => Number.isFinite(k.low) ? k.low : k.close));
        }

        return {
            name: quote.name || stock.name,
            code: resultCode,
            shortCode: stock.code,
            icon: stock.icon,
            iconBg: stock.iconBg,
            iconColor: stock.iconColor,
            sector: stock.sector,
            // 实时行情
            price: quote.price || 0,
            changePercent: quote.changePercent || 0,
            changeAmount: quote.changeAmount || 0,
            open: quote.open || 0,
            prevClose: quote.prevClose || 0,
            high: quote.high || 0,
            low: quote.low || 0,
            volume: quote.volume || 0,
            amount: quote.amount || 0,
            turnoverRate: quote.turnoverRate || 0,
            // 估值指标
            peDynamic: quote.peDynamic,
            peTTM: quote.peTTM,
            pbRatio: quote.pbRatio,
            // 市值
            marketCap: quote.marketCap,
            floatCap: quote.floatCap,
            // 走势
            sparkData,
            high52w,
            low52w,
            dataStatus: {
                quote: quoteFallbackUsed ? 'previous-cache' : (hasLiveQuote ? 'eastmoney-live' : 'none'),
                quoteFallbackUsed,
                kline: klineStatus,
            },
        };
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[股票] ===== 完成，耗时 ${elapsed}s =====`);

    const refreshStatus = summarizeStockRefreshStatus(
        results.map(item => item.dataStatus?.kline),
        results.filter(item => item.dataStatus?.quoteFallbackUsed).length,
    );

    const result = {
        updateTime: new Date().toISOString(),
        stocks: results,
        meta: {
            fetchTime: elapsed + 's',
            count: results.length,
            source: quoteSource === 'tencent' ? '腾讯备用行情' : '东方财富实时行情',
            refreshStatus,
        },
    };

    _stockCache = result;
    _stockCacheTime = Date.now();
    return result;
}

// ============================================================
// 判断当前是否为交易时间（简化判断）
// ============================================================
function isTradingHours() {
    const now = new Date();
    const day = now.getDay();
    // 周末
    if (day === 0 || day === 6) return false;
    const h = now.getHours();
    const m = now.getMinutes();
    const time = h * 60 + m;
    // 9:15 - 15:05 视为交易相关时段
    return time >= 9 * 60 + 15 && time <= 15 * 60 + 5;
}

// ============================================================
// 股票搜索 — 东方财富搜索 API
// ============================================================
const STOCK_ICON_COLORS = [
    { bg: 'linear-gradient(135deg, #48bb78, #2f855a)', color: '#fff' },
    { bg: 'linear-gradient(135deg, #63b3ed, #3182ce)', color: '#fff' },
    { bg: 'linear-gradient(135deg, #f6ad55, #dd6b20)', color: '#fff' },
    { bg: 'linear-gradient(135deg, #b794f4, #805ad5)', color: '#fff' },
    { bg: 'linear-gradient(135deg, #fc8181, #c53030)', color: '#fff' },
    { bg: 'linear-gradient(135deg, #4fd1c5, #2c7a7b)', color: '#fff' },
    { bg: 'linear-gradient(135deg, #f687b3, #b83280)', color: '#fff' },
    { bg: 'linear-gradient(135deg, #90cdf4, #2b6cb0)', color: '#fff' },
    { bg: 'linear-gradient(135deg, #fbd38d, #b7791f)', color: '#fff' },
    { bg: 'linear-gradient(135deg, #9ae6b4, #276749)', color: '#fff' },
];

function generateStockIcon(name, code) {
    // 取名称前两个字作为图标文字
    const icon = (name || '').replace(/[A-Za-z0-9\s]/g, '').slice(0, 2) || code.slice(0, 2);
    // 用代码 hash 选颜色
    const hash = code.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
    const preset = STOCK_ICON_COLORS[hash % STOCK_ICON_COLORS.length];
    return { icon, iconBg: preset.bg, iconColor: preset.color };
}

function guessStockSector(name) {
    const rules = [
        [/银行/i, '银行'], [/保险/i, '保险'], [/证券|券商/i, '券商'],
        [/地产|房|置业/i, '地产'], [/医[药疗]|生物|制药|健康/i, '医药'],
        [/科技|软件|信息|计算机|芯片|半导体|电子/i, '科技'],
        [/电力|能源|新能|光伏|风电|核电/i, '能源'], [/汽车|车/i, '汽车'],
        [/食品|饮料|酒|乳|农/i, '消费'], [/钢铁|有色|矿|煤/i, '资源'],
        [/建筑|水泥|建材/i, '建筑'], [/通信|5G|物联/i, '通信'],
        [/传媒|影视|文化|游戏/i, '传媒'], [/军工|航空|航天|国防/i, '军工'],
        [/机械|装备|设备/i, '装备'], [/化[工学]|材料/i, '化工'],
        [/物流|运输|交通|港口|航运/i, '物流'], [/环保|水务/i, '环保'],
    ];
    for (const [re, sector] of rules) {
        if (re.test(name)) return sector;
    }
    return '';
}

async function searchStock(keyword) {
    if (!keyword || keyword.trim().length === 0) return [];
    const kw = keyword.trim();

    // 东方财富搜索接口（type=2 为股票类型）
    const url = `https://searchapi.eastmoney.com/api/suggest/get?input=${encodeURIComponent(kw)}&type=14&token=D43BF722C8E33BDC906FB84D85E326E8&count=30`;
    try {
        const res = await safeFetch(url, {
            headers: { ...HEADERS, Referer: 'https://so.eastmoney.com/' },
        }, 1);
        const data = await res.json();
        if (!data?.QuotationCodeTable?.Data) return [];

        return data.QuotationCodeTable.Data
            .filter(d => {
                const code = d.Code || '';
                const name = (d.Name || '').toUpperCase();
                // 过滤A股：代码6位数字，排除ETF/LOF/基金
                if (!/^\d{6}$/.test(code)) return false;
                if (name.includes('ETF') || name.includes('LOF')) return false;
                // 只要沪深市场（MktNum: 0=深证, 1=上证）
                const mkt = String(d.MktNum || '');
                return mkt === '0' || mkt === '1';
            })
            .slice(0, 15)
            .map(d => {
                const code = d.Code;
                const market = d.MktNum === '0' ? 'SZ' : 'SH';
                const secid = `${d.MktNum === '0' ? '0' : '1'}.${code}`;
                const name = d.Name || '';
                const iconInfo = generateStockIcon(name, code);
                return {
                    code,
                    name,
                    market,
                    secid,
                    sector: guessStockSector(name),
                    ...iconInfo,
                };
            });
    } catch (err) {
        console.warn('[股票] 搜索失败:', err.message);
        // 备用：用代码直接构造（如果输入是6位纯数字）
        if (/^\d{6}$/.test(kw)) {
            const market = /^[60]/.test(kw) ? 'SH' : 'SZ';
            const secid = `${market === 'SZ' ? '0' : '1'}.${kw}`;
            return [{
                code: kw,
                name: kw,
                market,
                secid,
                sector: '',
                ...generateStockIcon(kw, kw),
            }];
        }
        return [];
    }
}

module.exports = {
    DEFAULT_WATCHLIST,
    readWatchlist,
    writeWatchlist,
    ensureWatchlist,
    fetchAllStockData,
    searchStock,
    generateStockIcon,
    guessStockSector,
    isTradingHours,
};
