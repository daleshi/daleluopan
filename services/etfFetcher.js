/**
 * ETF 实时行情服务
 * 数据源:
 *   1. 东方财富 push2 — ETF 实时行情（主源）
 *   2. 腾讯行情 — 备用源
 *   3. 东方财富 K线 — 日K走势（主源）
 *   4. 腾讯 K线 — 走势备用源
 *   5. 东方财富搜索 — ETF 搜索
 *
 * 高可用策略: 行情双源 failover，K线双源 + stale 缓存回退
 */
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const iconv = require('iconv-lite');

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Referer': 'https://quote.eastmoney.com/',
};

// ============================================================
// 默认 ETF 关注列表
// ============================================================
const DEFAULT_ETF_LIST = [
    {
        name: '沪深300ETF', code: '510300', market: 'SH', secid: '1.510300',
        icon: '300', iconBg: 'linear-gradient(135deg, #63b3ed, #3182ce)', iconColor: '#fff',
        category: '宽基',
    },
    {
        name: '中证500ETF', code: '510500', market: 'SH', secid: '1.510500',
        icon: '500', iconBg: 'linear-gradient(135deg, #b794f4, #805ad5)', iconColor: '#fff',
        category: '宽基',
    },
    {
        name: '创业板ETF', code: '159915', market: 'SZ', secid: '0.159915',
        icon: '创', iconBg: 'linear-gradient(135deg, #fc8181, #e53e3e)', iconColor: '#fff',
        category: '宽基',
    },
    {
        name: '科创50ETF', code: '588000', market: 'SH', secid: '1.588000',
        icon: '科', iconBg: 'linear-gradient(135deg, #fbd38d, #ed8936)', iconColor: '#fff',
        category: '宽基',
    },
];

// 预设图标配色池
const ETF_ICON_PRESETS = [
    { iconBg: 'linear-gradient(135deg, #63b3ed, #3182ce)', iconColor: '#fff' },
    { iconBg: 'linear-gradient(135deg, #f6ad55, #dd6b20)', iconColor: '#fff' },
    { iconBg: 'linear-gradient(135deg, #48bb78, #2f855a)', iconColor: '#fff' },
    { iconBg: 'linear-gradient(135deg, #b794f4, #805ad5)', iconColor: '#fff' },
    { iconBg: 'linear-gradient(135deg, #fc8181, #c53030)', iconColor: '#fff' },
    { iconBg: 'linear-gradient(135deg, #f6c343, #d69e2e)', iconColor: '#fff' },
    { iconBg: 'linear-gradient(135deg, #4fd1c5, #319795)', iconColor: '#fff' },
    { iconBg: 'linear-gradient(135deg, #f687b3, #b83280)', iconColor: '#fff' },
    { iconBg: 'linear-gradient(135deg, #90cdf4, #4299e1)', iconColor: '#fff' },
    { iconBg: 'linear-gradient(135deg, #68d391, #38a169)', iconColor: '#fff' },
];

// ============================================================
// 关注列表持久化
// ============================================================
const ETF_WATCHLIST_FILE = path.join(__dirname, '..', 'data', 'etf-watchlist.json');

function ensureDataDir() {
    const dir = path.dirname(ETF_WATCHLIST_FILE);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function readEtfWatchlist() {
    try {
        ensureDataDir();
        if (fs.existsSync(ETF_WATCHLIST_FILE)) {
            const raw = fs.readFileSync(ETF_WATCHLIST_FILE, 'utf8');
            const data = JSON.parse(raw);
            if (Array.isArray(data.etfs) && data.etfs.length > 0) {
                return data.etfs;
            }
        }
    } catch (err) {
        console.warn('[ETF] 读取关注列表失败:', err.message);
    }
    // 首次使用，写入默认列表
    writeEtfWatchlist(DEFAULT_ETF_LIST);
    return DEFAULT_ETF_LIST;
}

function writeEtfWatchlist(etfs) {
    ensureDataDir();
    fs.writeFileSync(ETF_WATCHLIST_FILE, JSON.stringify({ etfs }, null, 2), 'utf8');
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

// ============================================================
// 搜索 ETF（通过东方财富 API）
// ============================================================
async function searchETF(keyword) {
    if (!keyword || keyword.trim().length === 0) return [];
    const kw = keyword.trim();
    // 东方财富搜索接口
    const url = `https://searchapi.eastmoney.com/api/suggest/get?input=${encodeURIComponent(kw)}&type=14&token=D43BF722C8E33BDC906FB84D85E326E8&count=20`;
    try {
        const res = await safeFetch(url, {
            headers: { ...HEADERS, Referer: 'https://so.eastmoney.com/' },
        }, 1);
        const data = await res.json();
        if (!data?.QuotationCodeTable?.Data) return [];
        const filtered = data.QuotationCodeTable.Data
            .filter(d => {
                const code = d.Code || '';
                const name = (d.Name || '').toUpperCase();
                const classify = (d.Classify || '').toUpperCase();
                // 6位数字代码
                if (!/^\d{6}$/.test(code)) return false;
                // 排除场外基金（OTCFUND）
                if (classify === 'OTCFUND') return false;
                // 名称包含 ETF 或 LOF 或分类为 Fund
                if (name.includes('ETF') || name.includes('LOF')) return true;
                if (classify === 'FUND') return true;
                // MktNum 为 0（深交所）或 1（上交所）的基金类产品
                const mkt = String(d.MktNum || '');
                const secType = String(d.SecurityType || '');
                return (mkt === '0' || mkt === '1') && secType === '8';
            });
        // 按代码去重，保留第一个（场内优先）
        const seen = new Set();
        return filtered
            .filter(d => {
                if (seen.has(d.Code)) return false;
                seen.add(d.Code);
                return true;
            })
            .slice(0, 15)
            .map(d => {
                const code = d.Code;
                const market = d.MktNum === '0' ? 'SZ' : 'SH';
                const secid = `${d.MktNum === '0' ? '0' : '1'}.${code}`;
                const name = d.Name || '';
                return {
                    code,
                    name,
                    shortName: name.replace(/ETF$/i, 'ETF').replace(/LOF$/i, 'LOF').slice(0, 18),
                    market,
                    secid,
                    category: guessETFCategory(name),
                };
            });
    } catch (err) {
        console.warn('[ETF] 搜索失败:', err.message);
        // fallback: 尝试东方财富基金搜索
        try {
            const url2 = `https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchPageAPI.ashx?m=1&key=${encodeURIComponent(kw)}&pageindex=1&pagesize=20`;
            const res2 = await safeFetch(url2, {
                headers: { ...HEADERS, Referer: 'https://fund.eastmoney.com/' },
            }, 1);
            const text = await res2.text();
            let data2;
            try { data2 = JSON.parse(text); } catch (e) {
                const match = text.match(/\((.+)\)/s);
                if (match) data2 = JSON.parse(match[1]);
            }
            if (!data2?.Datas) return [];
            return data2.Datas
                .filter(d => {
                    const n = (d.NAME || '').toUpperCase();
                    return n.includes('ETF') || n.includes('LOF');
                })
                .slice(0, 15)
                .map(d => {
                    const code = d.CODE || '';
                    // 判断市场：5/1开头为SH，0/3开头为SZ
                    const market = /^[015]/.test(code) ? 'SH' : 'SZ';
                    const secid = `${market === 'SZ' ? '0' : '1'}.${code}`;
                    const name = d.NAME || '';
                    return {
                        code,
                        name,
                        shortName: name.replace(/ETF$/i, 'ETF').replace(/LOF$/i, 'LOF').slice(0, 18),
                        market,
                        secid,
                        category: guessETFCategory(name),
                    };
                });
        } catch (err2) {
            console.warn('[ETF] 备用搜索也失败:', err2.message);
            return [];
        }
    }
}

function guessETFCategory(name) {
    if (/沪深300|中证500|中证1000|上证50|创业板|科创|A500|中证800|全指|2000/i.test(name)) return '宽基';
    if (/消费|白酒|食品/i.test(name)) return '消费';
    if (/医药|医疗|生物|健康/i.test(name)) return '医药';
    if (/科技|芯片|半导体|通信|5G|人工智能|AI|机器人|计算机/i.test(name)) return '科技';
    if (/新能源|光伏|锂电|碳中和|电力/i.test(name)) return '新能源';
    if (/银行|证券|保险|金融|券商/i.test(name)) return '金融';
    if (/红利|股息|价值/i.test(name)) return '红利';
    if (/军工|国防/i.test(name)) return '军工';
    if (/恒生|港股|H股|纳斯达克|标普|美国|海外/i.test(name)) return '跨境';
    if (/债|利率|国债/i.test(name)) return '债券';
    if (/商品|黄金|石油|有色/i.test(name)) return '商品';
    if (/LOF/i.test(name)) return 'LOF';
    if (/混合|灵活|平衡|成长|商业模式/i.test(name)) return '混合';
    return 'ETF';
}

// ============================================================
// 东方财富 push2 批量 ETF 行情
// ============================================================
async function fetchETFQuotesEastmoney(etfs) {
    const secids = etfs.map(e => e.secid).join(',');
    // f184 = IOPV 当日实时单位净值；f185 = 折溢价率(%)
    const fields = 'f2,f3,f4,f5,f6,f7,f8,f9,f12,f14,f15,f16,f17,f18,f20,f21,f23,f115,f128,f140,f141,f152,f184,f185';
    const url = `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=${fields}&secids=${secids}`;

    const res = await safeFetch(url, { headers: HEADERS });
    const data = await res.json();
    if (data?.data?.diff) {
        const quotes = {};
        data.data.diff.forEach(item => {
            if (item.f2 !== '-' && item.f12) {
                // IOPV / 折溢价率：东财对部分品种返回 '-' 或负数（语义不明），需识别为 null
                const iopvRaw = item.f184;
                const premRaw = item.f185;
                let iopv = (iopvRaw == null || iopvRaw === '-' || iopvRaw === '') ? null : parseFloat(iopvRaw);
                if (iopv == null || isNaN(iopv) || iopv <= 0) iopv = null; // IOPV 必须为正数才有效
                let premiumPct = (premRaw == null || premRaw === '-' || premRaw === '') ? null : parseFloat(premRaw);
                if (premiumPct != null && isNaN(premiumPct)) premiumPct = null;
                quotes[item.f12] = {
                    price: parseFloat(item.f2) || 0,
                    changePercent: parseFloat(item.f3) || 0,
                    changeAmount: parseFloat(item.f4) || 0,
                    volume: parseFloat(item.f5) || 0,           // 成交量(手)
                    amount: parseFloat(item.f6) || 0,           // 成交额
                    amplitude: parseFloat(item.f7) || 0,        // 振幅
                    turnoverRate: parseFloat(item.f8) || 0,     // 换手率
                    peDynamic: parseFloat(item.f9) || null,     // 市盈率(动)
                    name: item.f14 || '',
                    high: parseFloat(item.f15) || 0,
                    low: parseFloat(item.f16) || 0,
                    open: parseFloat(item.f17) || 0,
                    prevClose: parseFloat(item.f18) || 0,
                    marketCap: parseFloat(item.f20) || 0,       // 总市值
                    floatCap: parseFloat(item.f21) || 0,        // 流通市值
                    pbRatio: parseFloat(item.f23) || null,      // 市净率
                    peTTM: parseFloat(item.f115) || null,       // 市盈率(TTM)
                    iopv,                                       // IOPV 实时净值估值
                    premiumPct,                                 // 折溢价率 (%)，正=溢价 / 负=折价
                };
            }
        });
        console.log(`  [ETF行情] 东方财富批量接口获取 ${Object.keys(quotes).length} 条`);
        return quotes;
    }
    return {};
}

/**
 * 按 secid 拉取单只 ETF 的实时价 + IOPV + 折溢价率。
 * 用于 sp500-dca-strategy 的溢价闸门评估。
 *
 * @param {string} secid 形如 "1.513500" / "0.159949"
 * @returns {Promise<{ price: number, iopv: number|null, premiumPct: number|null, name: string } | null>}
 *          失败返回 null；IOPV / 折溢价率字段缺失时分别为 null（保持 caller 的降级链）
 */
async function fetchETFIopvBySecid(secid) {
    if (!secid) return null;
    const code = String(secid).split('.')[1] || String(secid);
    try {
        const quotes = await fetchETFQuotesEastmoney([{ secid }]);
        const q = quotes[code];
        if (!q) return null;
        return {
            price: q.price,
            iopv: q.iopv != null ? q.iopv : null,
            premiumPct: q.premiumPct != null ? q.premiumPct : null,
            name: q.name || '',
        };
    } catch (err) {
        console.warn(`  [ETF行情] fetchETFIopvBySecid(${secid}) 失败:`, err.message);
        return null;
    }
}

// ============================================================
// 腾讯行情备用源
// ============================================================
async function fetchETFQuotesTencent(etfs) {
    const codes = etfs.map(e => {
        const prefix = e.market === 'SZ' ? 'sz' : 'sh';
        return `${prefix}${e.code}`;
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

    const lines = text.split('\n').filter(l => l.includes('~'));
    for (const line of lines) {
        const match = line.match(/v_\w+="(.+)"/);
        if (!match) continue;
        const fields = match[1].split('~');
        const code = fields[2];
        if (!code) continue;

        const price = parseFloat(fields[3]) || 0;
        const prevClose = parseFloat(fields[4]) || 0;
        if (price > 0) {
            quotes[code] = {
                price,
                changePercent: parseFloat(fields[32]) || 0,
                changeAmount: parseFloat(fields[31]) || 0,
                volume: parseFloat(fields[6]) || 0,
                amount: (parseFloat(fields[37]) || 0) * 10000,
                turnoverRate: parseFloat(fields[38]) || 0,
                peDynamic: parseFloat(fields[39]) || null,
                pbRatio: parseFloat(fields[46]) || null,
                name: fields[1] || '',
                high: parseFloat(fields[33]) || 0,
                low: parseFloat(fields[34]) || 0,
                open: parseFloat(fields[5]) || 0,
                prevClose,
                marketCap: (parseFloat(fields[45]) || 0) * 100000000,
                floatCap: (parseFloat(fields[44]) || 0) * 100000000,
            };
        }
    }
    console.log(`  [ETF行情] 腾讯备用源获取 ${Object.keys(quotes).length} 条`);
    return quotes;
}

// 带自动 failover 的行情获取
async function fetchETFQuotes(etfs) {
    try {
        const quotes = await fetchETFQuotesEastmoney(etfs);
        if (Object.keys(quotes).length > 0) {
            return { quotes, source: 'eastmoney' };
        }
    } catch (err) {
        console.warn('  [ETF行情] 东方财富批量接口失败:', err.message);
    }
    try {
        const quotes = await fetchETFQuotesTencent(etfs);
        if (Object.keys(quotes).length > 0) {
            console.log('  [ETF行情] 已切换腾讯备用源');
            return { quotes, source: 'tencent' };
        }
    } catch (err) {
        console.warn('  [ETF行情] 腾讯备用源也失败:', err.message);
    }
    return { quotes: {}, source: 'none' };
}

// ============================================================
// K线数据（60日走势图）
// ============================================================
const _etfKlineCache = new Map();
const ETF_KLINE_CACHE_TTL = 10 * 60 * 1000; // 10分钟缓存

async function fetchETFKlinesEastmoney(secid, limit = 60) {
    const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&fqt=1&end=20500101&lmt=${limit}`;
    try {
        const res = await safeFetch(url, { timeout: 5000, headers: HEADERS }, 1);
        const data = await res.json();
        if (data?.data?.klines?.length > 0) {
            return data.data.klines.map(line => {
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
            });
        }
    } catch (err) {
        console.warn(`  [ETF K线] ${secid} 东方财富获取失败:`, err.message);
    }
    return [];
}

async function fetchETFKlinesTencent(code, market, limit = 60) {
    const txCode = market === 'SZ' ? `sz${code}` : `sh${code}`;
    const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${txCode},day,,,${Math.max(limit, 120)},qfq`;
    try {
        const res = await safeFetch(url, { timeout: 5000 }, 1);
        const data = await res.json();
        const days = data?.data?.[txCode]?.qfqday || data?.data?.[txCode]?.day || [];
        if (days.length > 0) {
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
        console.warn(`  [ETF K线] ${txCode} 腾讯获取失败:`, err.message);
    }
    return [];
}

async function fetchETFKlines(etf, limit = 60) {
    const cacheKey = `${etf.code}.${etf.market}`;
    const cached = _etfKlineCache.get(cacheKey);
    if (cached && (Date.now() - cached.time) < ETF_KLINE_CACHE_TTL) {
        return cached.klines;
    }

    // 东方财富主源
    let klines = await fetchETFKlinesEastmoney(etf.secid, limit);
    if (klines.length > 0) {
        _etfKlineCache.set(cacheKey, { klines, time: Date.now() });
        return klines;
    }

    // 腾讯备用
    klines = await fetchETFKlinesTencent(etf.code, etf.market, limit);
    if (klines.length > 0) {
        _etfKlineCache.set(cacheKey, { klines, time: Date.now() });
        return klines;
    }

    // stale 缓存回退
    if (cached) return cached.klines;
    return [];
}

// ============================================================
// 按时间范围获取 K 线（用于详情弹窗趋势图）
// ============================================================
const ETF_RANGE_DAYS = { '1y': 250, '3y': 750, '5y': 1250 };

async function fetchETFKlinesForRange(secid, code, market, range = '1y') {
    const limit = ETF_RANGE_DAYS[range] || 250;
    // 东方财富主源
    let klines = await fetchETFKlinesEastmoney(secid, limit);
    if (klines.length === 0) {
        klines = await fetchETFKlinesTencent(code, market, limit);
    }
    return klines; // [{date, open, close, high, low, volume, amount, changePercent}]
}

// ============================================================
// 分时数据（当日分钟级）
// ============================================================
async function fetchETFMinuteData(secid) {
    const url = `https://push2.eastmoney.com/api/qt/stock/trends2/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13&fields2=f51,f52,f53,f54,f55,f56,f57,f58&iscr=0&ndays=1`;
    try {
        const res = await safeFetch(url, { timeout: 5000, headers: HEADERS }, 1);
        const data = await res.json();
        if (data?.data?.trends?.length > 0) {
            return {
                preClose: data.data.preClose || 0,
                trends: data.data.trends.map(line => {
                    const p = line.split(',');
                    return {
                        time: p[0],
                        price: +p[2],
                        avgPrice: +p[7],
                        volume: +p[5],
                        amount: +p[6],
                    };
                }),
            };
        }
    } catch (err) {
        console.warn(`  [ETF分时] ${secid} 获取失败:`, err.message);
    }
    return null;
}

// ============================================================
// 组装完整 ETF 数据
// ============================================================
let _etfCache = null;
let _etfCacheTime = 0;
const ETF_CACHE_TTL = 8 * 1000; // 8秒缓存

async function fetchAllETFData(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && _etfCache && (now - _etfCacheTime) < ETF_CACHE_TTL) {
        return _etfCache;
    }

    console.log('[ETF] ===== 获取关注 ETF 行情 =====');
    const startTime = Date.now();
    const etfs = readEtfWatchlist();

    // 获取实时行情（快速，单次批量请求）
    const { quotes, source: quoteSource } = await fetchETFQuotes(etfs);
    const prevMap = new Map((_etfCache?.etfs || []).map(item => [item.code, item]));

    // 全部 ETF 并发获取 K 线（提高并发从 2 到 6，大幅加速）
    const CONCURRENCY = 6;
    const results = [];
    for (let i = 0; i < etfs.length; i += CONCURRENCY) {
        const batch = etfs.slice(i, i + CONCURRENCY);
        const batchResults = await Promise.all(batch.map(async (etf) => {
            const prev = prevMap.get(`${etf.code}.${etf.market}`);
            const hasLiveQuote = !!quotes[etf.code];
            const quote = quotes[etf.code] || {
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
                marketCap: prev?.marketCap,
                floatCap: prev?.floatCap,
                peDynamic: prev?.peDynamic,
                peTTM: prev?.peTTM,
                pbRatio: prev?.pbRatio,
            };

            // 优先使用缓存的 K 线，避免每次都请求
            let klines;
            try {
                klines = await fetchETFKlines(etf, 60);
            } catch (e) {
                klines = prev?.sparkData ? prev.sparkData.map(p => ({ close: p })) : [];
            }
            const sparkData = klines.map(k => k.close);

            let high52w = null, low52w = null;
            if (klines.length > 0) {
                high52w = Math.max(...klines.map(k => Number.isFinite(k.high) ? k.high : k.close));
                low52w = Math.min(...klines.map(k => Number.isFinite(k.low) ? k.low : k.close));
            }

            return {
                name: quote.name || etf.name,
                code: `${etf.code}.${etf.market}`,
                shortCode: etf.code,
                market: etf.market || 'SH',
                secid: etf.secid,
                icon: etf.icon,
                iconBg: etf.iconBg,
                iconColor: etf.iconColor,
                category: etf.category || 'ETF',
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
                amplitude: quote.amplitude || 0,
                turnoverRate: quote.turnoverRate || 0,
                // 估值
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
                quoteFallback: !hasLiveQuote && !!prev,
            };
        }));
        results.push(...batchResults);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[ETF] ===== 完成，耗时 ${elapsed}s =====`);

    const result = {
        updateTime: new Date().toISOString(),
        etfs: results,
        meta: {
            fetchTime: elapsed + 's',
            count: results.length,
            source: quoteSource === 'tencent' ? '腾讯备用行情' : '东方财富实时行情',
        },
    };

    _etfCache = result;
    _etfCacheTime = Date.now();
    return result;
}

// 判断交易时间
function isTradingHours() {
    const now = new Date();
    const day = now.getDay();
    if (day === 0 || day === 6) return false;
    const h = now.getHours();
    const m = now.getMinutes();
    const time = h * 60 + m;
    return time >= 9 * 60 + 15 && time <= 15 * 60 + 5;
}

module.exports = {
    DEFAULT_ETF_LIST,
    ETF_ICON_PRESETS,
    readEtfWatchlist,
    writeEtfWatchlist,
    searchETF,
    fetchAllETFData,
    fetchETFMinuteData,
    fetchETFKlinesForRange,
    fetchETFQuotes,
    fetchETFIopvBySecid,
    isTradingHours,
};
