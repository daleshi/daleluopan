/**
 * 主动基金数据采集服务
 * 数据源优先级:
 *   1. 东方财富 pingzhongdata — 完整基金数据（主源）
 *   2. 天天基金 fundmobapi — 净值/收益率（备用源）
 *   3. 蛋卷基金 djapi — 持仓详情
 * 
 * 高可用策略:
 *   - 主源失败 → 自动切换天天基金备用源
 *   - 所有源失败 → 回退上一轮缓存数据（带 stale 标记）
 *   - 10 分钟缓存 TTL，过期后仍可作为 stale 缓存回退
 */
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
};

// ============================================================
// 关注的主动基金列表（持久化到 JSON 文件）
// ============================================================
const FUND_WATCHLIST_FILE = path.join(__dirname, '..', 'data', 'fund-watchlist.json');

const DEFAULT_FUND_LIST = [
    { code: '163415', name: '兴全商业模式混合(LOF)A', shortName: '兴全商业模式', icon: '兴全', iconBg: 'linear-gradient(135deg, #63b3ed, #3182ce)', iconColor: '#fff' },
    { code: '008269', name: '大成睿享混合A', shortName: '大成睿享', icon: '大成', iconBg: 'linear-gradient(135deg, #f6ad55, #dd6b20)', iconColor: '#fff' },
];

// 预设图标配色池（新增基金时轮换使用）
const ICON_PRESETS = [
    { iconBg: 'linear-gradient(135deg, #63b3ed, #3182ce)', iconColor: '#fff' },
    { iconBg: 'linear-gradient(135deg, #f6ad55, #dd6b20)', iconColor: '#fff' },
    { iconBg: 'linear-gradient(135deg, #48bb78, #2f855a)', iconColor: '#fff' },
    { iconBg: 'linear-gradient(135deg, #b794f4, #805ad5)', iconColor: '#fff' },
    { iconBg: 'linear-gradient(135deg, #fc8181, #c53030)', iconColor: '#fff' },
    { iconBg: 'linear-gradient(135deg, #f6c343, #d69e2e)', iconColor: '#fff' },
    { iconBg: 'linear-gradient(135deg, #4fd1c5, #319795)', iconColor: '#fff' },
    { iconBg: 'linear-gradient(135deg, #f687b3, #b83280)', iconColor: '#fff' },
];

function ensureDataDir() {
    const dir = path.dirname(FUND_WATCHLIST_FILE);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function readFundWatchlist() {
    try {
        ensureDataDir();
        if (fs.existsSync(FUND_WATCHLIST_FILE)) {
            const raw = fs.readFileSync(FUND_WATCHLIST_FILE, 'utf8');
            const data = JSON.parse(raw);
            if (Array.isArray(data.funds) && data.funds.length > 0) {
                return data.funds;
            }
        }
    } catch (err) {
        console.warn('[主动基金] 读取关注列表失败:', err.message);
    }
    // 首次使用，写入默认列表
    writeFundWatchlist(DEFAULT_FUND_LIST);
    return DEFAULT_FUND_LIST;
}

function writeFundWatchlist(funds) {
    ensureDataDir();
    fs.writeFileSync(FUND_WATCHLIST_FILE, JSON.stringify({ funds }, null, 2), 'utf8');
}

function getActiveFundList() {
    return readFundWatchlist();
}

// 搜索基金（通过东方财富 API）
// 使用 FundSearchAPI（非 PageAPI，后者已对大量基金代码返回空结果）
async function searchFunds(keyword) {
    if (!keyword || keyword.trim().length === 0) return [];
    const kw = keyword.trim();

    // 主源: FundSearchAPI — 支持代码/名称/拼音搜索，覆盖全量基金
    const url = `https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx?m=1&key=${encodeURIComponent(kw)}&pageindex=1&pagesize=20&_=${Date.now()}`;
    try {
        const res = await safeFetch(url, {
            headers: { ...HEADERS, Referer: 'https://fund.eastmoney.com/' },
        }, 1);
        const text = await res.text();
        let data;
        try {
            data = JSON.parse(text);
        } catch (e) {
            const match = text.match(/\((.+)\)/s);
            if (match) data = JSON.parse(match[1]);
        }
        if (!data?.Datas || data.Datas.length === 0) {
            // 兜底: 尝试旧版 PageAPI
            return await searchFundsFallback(kw);
        }
        // FundSearchAPI 返回结构: Datas[].CODE, Datas[].NAME, Datas[].FundBaseInfo.SHORTNAME / FTYPE
        return data.Datas.filter(d => {
            const name = d.NAME || '';
            const cat = (d.CATEGORYDESC || '').toUpperCase();
            // 只保留「基金」类别（排除股票等其他证券类型）
            if (cat && cat !== '基金') return false;
            // 排除货币基金和理财基金
            const ftype = (d.FundBaseInfo?.FTYPE || '').toLowerCase();
            if (ftype.includes('货币') || ftype.includes('理财')) return false;
            return true;
        }).slice(0, 10).map(d => {
            const fullName = d.FundBaseInfo?.SHORTNAME || d.NAME || '';
            const ftype = d.FundBaseInfo?.FTYPE || '';
            const typeStr = ftype || guessFundType(fullName);
            return {
                code: d.CODE || '',
                name: fullName,
                shortName: fullName.replace(/[（(].+[）)].*$/, '').slice(0, 15),
                type: typeStr,
                category: classifyFundCategory(fullName, typeStr),
            };
        });
    } catch (err) {
        console.warn('[主动基金] 搜索基金失败:', err.message);
        return await searchFundsFallback(kw);
    }
}

// 备用搜索: 旧版 FundSearchPageAPI（部分场景下可能仍有效）
async function searchFundsFallback(kw) {
    const url = `https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchPageAPI.ashx?m=1&key=${encodeURIComponent(kw)}&pageindex=1&pagesize=15`;
    try {
        const res = await safeFetch(url, {
            headers: { ...HEADERS, Referer: 'https://fund.eastmoney.com/' },
        }, 1);
        const text = await res.text();
        let data;
        try {
            data = JSON.parse(text);
        } catch (e) {
            const match = text.match(/\((.+)\)/s);
            if (match) data = JSON.parse(match[1]);
        }
        if (!data?.Datas || data.Datas.length === 0) return [];
        return data.Datas.slice(0, 10).map(d => ({
            code: d.CODE || '',
            name: d.NAME || '',
            shortName: (d.NAME || '').replace(/[（(].+[）)].*$/, '').slice(0, 15),
            type: guessFundType(d.NAME || ''),
        }));
    } catch (err) {
        console.warn('[主动基金] 备用搜索也失败:', err.message);
        return [];
    }
}

function guessFundType(name) {
    if (name.includes('混合')) return '混合型';
    if (name.includes('股票') || name.includes('精选') || name.includes('成长')) return '股票型';
    if (name.includes('债券') || name.includes('信用')) return '债券型';
    if (name.includes('ETF') || name.includes('指数')) return '指数型';
    if (name.includes('货币') || name.includes('理财')) return '货币型';
    if (name.includes('灵活')) return '灵活配置';
    return '基金';
}

/**
 * 判断基金类别：index（指数基金）或 active（主动基金）
 * 规则：名称/类型含 ETF、指数、联接、LOF指数、增强 → 指数基金；否则为主动基金
 */
function classifyFundCategory(name, ftype) {
    const n = (name || '').toLowerCase();
    const t = (ftype || '').toLowerCase();
    if (n.includes('etf') || n.includes('指数') || n.includes('联接')
        || t.includes('指数') || t.includes('etf') || t.includes('联接')
        || n.includes('增强') || t.includes('增强')) {
        return 'index';
    }
    return 'active';
}

/**
 * 根据基金名称、类型、持仓特征自动生成风格标签
 * 标签示例: ['价值', '大盘', 'QDII', '红利', '消费', '科技', '增强', 'LOF']
 */
function generateStyleTags(fund) {
    const tags = [];
    const n = (fund.name || '').toLowerCase();
    const cat = fund.category;

    // 投资风格
    if (n.includes('价值') || n.includes('红利') || n.includes('低波')) tags.push('价值');
    else if (n.includes('成长') || n.includes('创新') || n.includes('科技') || n.includes('新兴')) tags.push('成长');
    else if (n.includes('均衡') || n.includes('灵活')) tags.push('均衡');

    // 市值风格（从名称推断）
    if (n.includes('沪深300') || n.includes('上证50') || n.includes('a50') || n.includes('标普500') || n.includes('纳斯达克')) tags.push('大盘');
    else if (n.includes('中证500') || n.includes('中证800')) tags.push('中盘');
    else if (n.includes('1000') || n.includes('2000') || n.includes('科创50') || n.includes('创业板')) tags.push('中小盘');

    // 跨境/QDII
    if (n.includes('qdii') || n.includes('标普') || n.includes('纳斯达克') || n.includes('恒生') || n.includes('港股') || n.includes('美国') || n.includes('全球')) tags.push('QDII');

    // 行业/主题
    if (n.includes('消费') || n.includes('食品') || n.includes('白酒')) tags.push('消费');
    if (n.includes('科技') || n.includes('互联网') || n.includes('信息') || n.includes('芯片') || n.includes('半导体')) tags.push('科技');
    if (n.includes('医药') || n.includes('医疗') || n.includes('健康')) tags.push('医药');
    if (n.includes('新能源') || n.includes('光伏') || n.includes('碳中和')) tags.push('新能源');
    if (n.includes('红利') || n.includes('股息')) tags.push('红利');
    if (n.includes('军工') || n.includes('国防')) tags.push('军工');

    // 产品类型
    if (cat === 'index') {
        if (n.includes('增强')) tags.push('增强');
        else if (n.includes('lof')) tags.push('LOF');
        else if (n.includes('etf联接') || n.includes('etf 联接')) tags.push('联接');
        else if (n.includes('etf')) tags.push('ETF');
        else tags.push('被动指数');
    } else {
        if (n.includes('混合')) tags.push('混合');
        else if (n.includes('股票')) tags.push('股票');
        else if (n.includes('债')) tags.push('债券');
        tags.push('主动管理');
    }

    return [...new Set(tags)].slice(0, 5); // 最多 5 个标签
}

/**
 * 估算基金风险等级（R1~R5），参考基金类型和股票仓位
 */
function estimateRiskLevel(fund) {
    const n = (fund.name || '').toLowerCase();
    const stockPct = fund.stockPosition || fund.stockPercent || 0;
    const cat = fund.category;

    // 货币/短债 → R1
    if (n.includes('货币') || n.includes('理财') || n.includes('短债')) return { level: 'R1', label: '低风险', color: '#48bb78' };
    // 纯债（非混合） → R2
    if ((n.includes('债') && !n.includes('混') && !n.includes('转')) || (stockPct < 10 && cat !== 'index')) return { level: 'R2', label: '中低风险', color: '#68d391' };
    // 指数基金（含联接、ETF、增强）都是高仓位 → R4/R5
    if (cat === 'index') {
        if (n.includes('qdii') || n.includes('恒生') || n.includes('标普') || n.includes('纳斯达克')) return { level: 'R5', label: '高风险', color: '#e53e3e' };
        return { level: 'R4', label: '中高风险', color: '#ed8936' };
    }
    // 混合偏债 / 灵活配置（仓位低） → R3
    if (n.includes('灵活') || (n.includes('混合') && stockPct < 60) || (stockPct > 0 && stockPct < 50)) return { level: 'R3', label: '中风险', color: '#f6c343' };
    // 混合偏股 / 普通股票型 → R4
    if (n.includes('混合') || (stockPct >= 50 && stockPct < 85)) return { level: 'R4', label: '中高风险', color: '#ed8936' };
    // 高仓位股票型 / 行业主题 → R5
    return { level: 'R5', label: '高风险', color: '#e53e3e' };
}

// 缓存（分为 fresh 和 stale 两层）
let _fundCache = {};        // code → merged data
let _fundCacheTime = {};    // code → timestamp
const FUND_CACHE_TTL = 10 * 60 * 1000; // 10分钟 fresh TTL

// 通用安全 fetch
async function safeFetch(url, options = {}, retries = 2) {
    for (let i = 0; i <= retries; i++) {
        try {
            const res = await fetch(url, { timeout: 15000, ...options });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res;
        } catch (err) {
            if (i === retries) throw err;
            await new Promise(r => setTimeout(r, 800 * (i + 1)));
        }
    }
}

// ============================================================
// 1. 东方财富 pingzhongdata — 完整基金数据（主源）
// ============================================================
async function fetchEastmoneyFundData(code) {
    const url = `https://fund.eastmoney.com/pingzhongdata/${code}.js`;
    const res = await safeFetch(url, {
        headers: { ...HEADERS, Referer: 'https://fund.eastmoney.com/' },
    }, 1);
    const text = await res.text();

    const result = {};

    // 基金基本信息
    result.name = extractVar(text, 'fS_name');
    result.code = extractVar(text, 'fS_code');

    // 收益率
    result.syl_1y = parseFloat(extractVar(text, 'syl_1y')) || null;   // 近1月
    result.syl_3y = parseFloat(extractVar(text, 'syl_3y')) || null;   // 近3月
    result.syl_6y = parseFloat(extractVar(text, 'syl_6y')) || null;   // 近6月
    result.syl_1n = parseFloat(extractVar(text, 'syl_1n')) || null;   // 近1年

    // 费率
    result.sourceRate = extractVar(text, 'fund_sourceRate');
    result.rate = extractVar(text, 'fund_Rate');
    result.minBuy = extractVar(text, 'fund_minsg');

    // 持仓股票代码
    result.stockCodes = extractJsonVar(text, 'stockCodesNew') || [];

    // 净值走势（保留全量，按1年/3年/5年/全部分片）
    const netWorthAll = extractJsonVar(text, 'Data_netWorthTrend') || [];
    const mapNW = item => ({ date: item.x, nav: item.y, returnRate: item.equityReturn });
    const now = Date.now();
    const y1ago = now - 365 * 24 * 3600 * 1000;
    const y3ago = now - 3 * 365 * 24 * 3600 * 1000;
    const y5ago = now - 5 * 365 * 24 * 3600 * 1000;
    result.netWorthTrend = {
        '1y': netWorthAll.filter(i => i.x >= y1ago).map(mapNW),
        '3y': netWorthAll.filter(i => i.x >= y3ago).map(mapNW),
        '5y': netWorthAll.filter(i => i.x >= y5ago).map(mapNW),
        'all': netWorthAll.map(mapNW),
    };
    // 最新净值
    if (netWorthAll.length > 0) {
        const latest = netWorthAll[netWorthAll.length - 1];
        result.latestNav = latest.y;
        result.latestNavDate = new Date(latest.x).toISOString().split('T')[0];
        // 日涨跌
        if (netWorthAll.length >= 2) {
            const prev = netWorthAll[netWorthAll.length - 2];
            result.dayChange = ((latest.y - prev.y) / prev.y * 100).toFixed(2);
        }
    }

    // 累计净值走势
    const acWorthAll = extractJsonVar(text, 'Data_ACWorthTrend') || [];
    if (acWorthAll.length > 0) {
        result.totalNav = acWorthAll[acWorthAll.length - 1][1];
    }

    // 同类排名走势（全量）
    const rankAll = extractJsonVar(text, 'Data_rateInSimilarType') || [];
    result.rankTrend = rankAll.map(item => ({
        date: item.x,
        rank: item.y,
        total: parseInt(item.sc) || null,
    }));

    // 同类排名百分位（全量）
    const pctAll = extractJsonVar(text, 'Data_rateInSimilarPersent') || [];
    result.rankPercentTrend = pctAll.map(item => ({
        date: item[0],
        percent: item[1],
    }));

    // 基金规模变动
    result.scaleHistory = extractJsonVar(text, 'Data_fluctuationScale') || {};

    // 持有人结构
    result.holderStructure = extractJsonVar(text, 'Data_holderStructure') || {};

    // 资产配置
    result.assetAllocation = extractJsonVar(text, 'Data_assetAllocation') || {};

    // 业绩评价（五维雷达图）
    result.performanceEval = extractJsonVar(text, 'Data_performanceEvaluation') || {};

    // 当前基金经理
    result.managers = extractJsonVar(text, 'Data_currentFundManager') || [];

    // 申赎数据
    result.buyRedemption = extractJsonVar(text, 'Data_buySedemption') || {};

    // 股票仓位测算
    const positions = extractJsonVar(text, 'Data_fundSharesPositions') || [];
    if (positions.length > 0) {
        result.stockPosition = positions[positions.length - 1][1];
    }

    // 阶段收益对比
    result.grandTotal = extractJsonVar(text, 'Data_grandTotal') || [];

    // 基金成立时间（从净值走势的最早一条推算）
    if (netWorthAll.length > 0) {
        result.inceptionDate = new Date(netWorthAll[0].x).toISOString().split('T')[0];
    }

    // 近2年/3年/5年收益率（从净值走势推算）
    const calcPeriodReturn = (msAgo) => {
        const target = netWorthAll.filter(i => i.x >= (now - msAgo));
        if (target.length >= 2) {
            const first = target[0].y;
            const last = target[target.length - 1].y;
            return first > 0 ? parseFloat(((last - first) / first * 100).toFixed(2)) : null;
        }
        return null;
    };
    result.syl_2n = calcPeriodReturn(2 * 365 * 24 * 3600 * 1000);  // 近2年
    result.syl_3n = calcPeriodReturn(3 * 365 * 24 * 3600 * 1000);  // 近3年
    result.syl_5n = calcPeriodReturn(5 * 365 * 24 * 3600 * 1000);  // 近5年

    // 成立以来年化收益
    if (netWorthAll.length > 0 && result.totalNav) {
        const inceptionMs = now - netWorthAll[0].x;
        const years = inceptionMs / (365.25 * 24 * 3600 * 1000);
        if (years > 0.5) {
            result.annualizedReturn = parseFloat(((Math.pow(result.totalNav, 1 / years) - 1) * 100).toFixed(2));
        }
    }

    // 最大回撤（近3年）
    const recentNW = netWorthAll.filter(i => i.x >= y3ago);
    if (recentNW.length > 10) {
        let peak = recentNW[0].y;
        let maxDrawdown = 0;
        for (const item of recentNW) {
            if (item.y > peak) peak = item.y;
            const dd = (peak - item.y) / peak * 100;
            if (dd > maxDrawdown) maxDrawdown = dd;
        }
        result.maxDrawdown3y = parseFloat(maxDrawdown.toFixed(2));
    }

    // 同类排名最新值
    if (result.rankTrend.length > 0) {
        const lastRank = result.rankTrend[result.rankTrend.length - 1];
        result.latestRank = lastRank.rank;
        result.latestRankTotal = lastRank.total;
    }

    result._source = 'eastmoney';
    console.log(`  [主动基金] ${result.name || code}: 净值=${result.latestNav}, 近1年=${result.syl_1n}%, 基金经理=${result.managers?.[0]?.name || 'N/A'} (东方财富)`);
    return result;
}

// ============================================================
// 1b. 天天基金 — 净值/收益率/基本信息（备用源）
//     接口: fundmobapi.eastmoney.com/FundMNewApi/FundMNFInfo
//     另一个: fund.eastmoney.com/f10/jbgk_XXX.html (HTML解析)
// ============================================================
async function fetchTiantianFundData(code) {
    // 天天基金移动端 API — 基金概况 + 净值
    const url = `https://fundmobapi.eastmoney.com/FundMNewApi/FundMNFInfo?plat=Android&appType=ttjj&product=EFund&Version=1&deviceid=1&Fcodes=${code}`;
    const res = await safeFetch(url, {
        headers: {
            ...HEADERS,
            Referer: 'https://mpservice.com/',
        },
    }, 1);
    const data = await res.json();

    if (!data?.Datas || data.Datas.length === 0) {
        throw new Error('天天基金接口无数据');
    }

    const d = data.Datas[0];
    const result = {
        name: d.SHORTNAME || d.FCODE || code,
        code: d.FCODE || code,
        latestNav: parseFloat(d.NAV) || null,
        totalNav: parseFloat(d.ACCNAV) || null,
        latestNavDate: d.PDATE || null,
        dayChange: parseFloat(d.NAVCHGRT) || null,
        syl_1y: parseFloat(d.SYL_M) || null,    // 近1月
        syl_3y: parseFloat(d.SYL_3Y) || null,    // 近3月
        syl_6y: parseFloat(d.SYL_6Y) || null,    // 近6月
        syl_1n: parseFloat(d.SYL_1N) || null,    // 近1年
        // 天天基金没有详细的走势/持仓等数据，只有核心指标
        netWorthTrend: [],
        rankTrend: [],
        rankPercentTrend: [],
        scaleHistory: {},
        holderStructure: {},
        assetAllocation: {},
        performanceEval: {},
        managers: [],
        buyRedemption: {},
        grandTotal: [],
        stockCodes: [],
        _source: 'tiantian',
    };

    console.log(`  [主动基金] ${result.name}: 净值=${result.latestNav}, 近1年=${result.syl_1n}% (天天基金备用)`);
    return result;
}

// ============================================================
// 1c. 带自动 failover 的基金数据获取
//     东方财富 → 天天基金 → 上一轮缓存
// ============================================================
async function fetchFundDataWithFailover(code) {
    // 第一级：东方财富主源
    try {
        const data = await fetchEastmoneyFundData(code);
        if (data && data.latestNav) {
            return data;
        }
    } catch (err) {
        console.warn(`  [主动基金] ${code} 东方财富数据获取失败:`, err.message);
    }

    // 第二级：天天基金备用源
    try {
        const data = await fetchTiantianFundData(code);
        if (data && data.latestNav) {
            console.log(`  [主动基金] ${code} 已切换天天基金备用源`);
            return data;
        }
    } catch (err) {
        console.warn(`  [主动基金] ${code} 天天基金备用源也失败:`, err.message);
    }

    // 第三级：回退上一轮缓存（带 stale 标记）
    if (_fundCache[code]) {
        console.warn(`  [主动基金] ${code} 所有源失败，回退上一轮缓存数据`);
        return { ..._fundCache[code], _source: 'stale-cache', _stale: true };
    }

    console.error(`  [主动基金] ${code} 所有数据源均失败，且无缓存可回退`);
    return null;
}

// ============================================================
// 2. 蛋卷基金 — 持仓详情（带 failover）
// ============================================================
async function fetchDanjuanFundDetail(code) {
    const url = `https://danjuanfunds.com/djapi/fund/detail/${code}`;
    try {
        const res = await safeFetch(url, {
            headers: {
                ...HEADERS,
                Referer: 'https://danjuanfunds.com/',
                Host: 'danjuanfunds.com',
            },
        }, 1);
        const data = await res.json();
        if (data?.result_code === 0 && data?.data) {
            const d = data.data;
            return {
                fundCompany: (d.fund_company || '').trim().slice(0, 100),
                position: d.fund_position || null,
                managerList: d.manager_list || [],
            };
        }
    } catch (err) {
        console.warn(`  [主动基金] ${code} 蛋卷基金详情获取失败:`, err.message);
    }
    return null;
}

// ============================================================
// 组装：获取所有主动基金数据（带高可用容灾）
// ============================================================
async function fetchAllActiveFundData(forceRefresh = false) {
    const ACTIVE_FUND_LIST = getActiveFundList();
    const now = Date.now();
    // 检查缓存
    if (!forceRefresh) {
        const allCached = ACTIVE_FUND_LIST.every(f => _fundCache[f.code] && (now - (_fundCacheTime[f.code] || 0)) < FUND_CACHE_TTL);
        if (allCached) {
            return {
                funds: ACTIVE_FUND_LIST.map(f => _fundCache[f.code]),
                updateTime: new Date().toISOString(),
                cached: true,
            };
        }
    }

    console.log('[主动基金] ===== 开始获取主动基金数据 =====');
    const startTime = Date.now();

    const results = await Promise.all(ACTIVE_FUND_LIST.map(async (fundCfg) => {
        const [emData, djData] = await Promise.all([
            fetchFundDataWithFailover(fundCfg.code),
            fetchDanjuanFundDetail(fundCfg.code),
        ]);

        const isStale = !!(emData?._stale);
        const dataSource = emData?._source || 'none';

        const merged = {
            ...fundCfg,
            ...(emData || {}),
            name: emData?.name || fundCfg.name,
            code: fundCfg.code,
            // 基金分类（指数/主动）：优先用 watchlist 中的分类，否则自动判断
            category: fundCfg.category || classifyFundCategory(emData?.name || fundCfg.name, ''),
            // 蛋卷基金持仓信息
            topStocks: djData?.position?.stock_list?.slice(0, 10) || (emData?.topStocks || []),
            stockPercent: djData?.position?.stock_percent || emData?.assetAllocation?.series?.[0]?.data?.slice(-1)[0] || (emData?.stockPercent || null),
            bondPercent: djData?.position?.bond_percent || (emData?.bondPercent || null),
            cashPercent: djData?.position?.cash_percent || (emData?.cashPercent || null),
            totalAsset: djData?.position?.asset_tot || (emData?.totalAsset || null),
            fundCompany: djData?.fundCompany || (emData?.fundCompany || null),
            // 数据源状态
            dataStatus: {
                source: dataSource,
                stale: isStale,
                label: isStale ? '已回退缓存' : (dataSource === 'tiantian' ? '天天基金备用' : '东方财富'),
            },
        };

        // ---- 衍生字段：风格标签 ----
        merged.styleTags = generateStyleTags(merged);

        // ---- 衍生字段：风险等级（R1~R5）----
        merged.riskLevel = estimateRiskLevel(merged);

        // 删除内部标记
        delete merged._source;
        delete merged._stale;

        // 缓存（仅非 stale 数据才更新缓存时间）
        _fundCache[fundCfg.code] = merged;
        if (!isStale) {
            _fundCacheTime[fundCfg.code] = Date.now();
        }

        return merged;
    }));

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[主动基金] ===== 完成, 耗时 ${elapsed}s =====`);

    // 汇总数据源状态
    const sourceStats = {
        eastmoney: results.filter(r => r.dataStatus?.source === 'eastmoney').length,
        tiantian: results.filter(r => r.dataStatus?.source === 'tiantian').length,
        staleCache: results.filter(r => r.dataStatus?.stale).length,
        failed: results.filter(r => !r.dataStatus || r.dataStatus.source === 'none').length,
    };
    const degraded = sourceStats.tiantian > 0 || sourceStats.staleCache > 0 || sourceStats.failed > 0;
    const summaryParts = [];
    if (sourceStats.tiantian > 0) summaryParts.push(`天天基金备用 ${sourceStats.tiantian} 只`);
    if (sourceStats.staleCache > 0) summaryParts.push(`缓存回退 ${sourceStats.staleCache} 只`);
    if (sourceStats.failed > 0) summaryParts.push(`获取失败 ${sourceStats.failed} 只`);

    return {
        funds: results,
        updateTime: new Date().toISOString(),
        fetchTime: elapsed + 's',
        cached: false,
        meta: {
            sourceStats,
            degraded,
            summaryText: summaryParts.length > 0 ? summaryParts.join(' · ') : '东方财富主源稳定',
        },
    };
}

// ============================================================
// 工具函数：从 JS 文本中提取变量
// ============================================================
function extractVar(text, varName) {
    const regex = new RegExp(`var\\s+${varName}\\s*=\\s*"([^"]*)"`, 's');
    const m = text.match(regex);
    return m ? m[1] : null;
}

function extractJsonVar(text, varName) {
    // 找到 var varName = ...; 的位置
    const startMarker = `var ${varName} =`;
    const idx = text.indexOf(startMarker);
    if (idx === -1) return null;

    const startPos = idx + startMarker.length;
    // 找到该变量声明的结束分号（在下一个 var 或 /* 之前）
    let depth = 0;
    let inString = false;
    let stringChar = '';
    let endPos = startPos;

    for (let i = startPos; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
            if (ch === '\\') { i++; continue; }
            if (ch === stringChar) inString = false;
            continue;
        }
        if (ch === '"' || ch === "'") {
            inString = true;
            stringChar = ch;
            continue;
        }
        if (ch === '[' || ch === '{') depth++;
        if (ch === ']' || ch === '}') depth--;
        if (depth === 0 && (ch === ';' || (ch === '\n' && text.substr(i + 1, 4) === 'var ') || (ch === '\n' && text.substr(i + 1, 2) === '/*'))) {
            endPos = i;
            break;
        }
    }

    const jsonStr = text.slice(startPos, endPos).trim();
    try {
        return JSON.parse(jsonStr);
    } catch (e) {
        // 尝试修复常见问题
        try {
            return JSON.parse(jsonStr.replace(/'/g, '"'));
        } catch (e2) {
            return null;
        }
    }
}

module.exports = {
    getActiveFundList,
    readFundWatchlist,
    writeFundWatchlist,
    ICON_PRESETS,
    fetchAllActiveFundData,
    fetchEastmoneyFundData,
    fetchTiantianFundData,
    fetchDanjuanFundDetail,
    searchFunds,
    classifyFundCategory,
};
