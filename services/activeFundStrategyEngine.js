/**
 * 主动基金定投策略 — 规则引擎
 *
 * 输入: 策略配置 + 当前指数估值 + 基金净值序列
 * 输出: 每只基金当前命中的档位 + 推荐金额 + 触发依据 + 完整规则扫描
 *
 * 设计原则:
 *   - 防御优先，命中即停: 数组顺序应保证 pause → half → double → normal
 *   - 数据缺失时降级: 引用缺失指标的 condition 视为不命中，不抛错
 *   - 兜底兜住: 空 conditions 永远命中（normal 档作为安全网）
 */

const { fetchDanjuanEvaluation } = require('./dataFetcher');
const { fetchEastmoneyFundData, fetchTiantianFundData } = require('./fundFetcher');

// ============================================================
// 白名单常量（供引擎内部 + server.js POST 接口校验复用）
// ============================================================

/** 允许在 condition.field 中引用的指标字段 */
const ALLOWED_FIELDS = [
    'indexPePercentile', // 基准指数 PE 分位（%, 0~100）
    'indexPbPercentile', // 基准指数 PB 分位（%, 0~100）
    'fundDrawdownAbs',   // 基金当前回撤绝对值（%, 正数；从历史最高净值起算）
    'fundGain3M',        // 基金近3月涨幅（%, 可正可负）
    'fundGain6M',        // 基金近6月涨幅（%, 可正可负）
    'fundGain1Y',        // 基金近1年涨幅（%, 可正可负；v2 新增）
    'fundDistanceToYearHighPct', // 基金当前净值距近1年最高净值的回撤绝对值（%, 正数；v2 新增）
    'fundPricePercentile5Y', // 基金净值的近5年价格分位（%, 0~100；黄金策略专用）
    'fundDrawdown1Y',        // 基金从近1年最高净值的回撤绝对值（%, 正数；黄金策略专用）
];

/** 允许在 condition.op 中使用的比较运算符 */
const ALLOWED_OPS = ['>=', '>', '<=', '<', '=='];

/** field → 中文显示名（用于触发依据文案） */
const FIELD_LABELS = {
    indexPePercentile: 'PE 分位',
    indexPbPercentile: 'PB 分位',
    fundDrawdownAbs:   '基金回撤',
    fundGain3M:        '近3月涨幅',
    fundGain6M:        '近6月涨幅',
    fundGain1Y:        '近1年涨幅',
    fundDistanceToYearHighPct: '距近1年新高',
    fundPricePercentile5Y: '近5年价格分位',
    fundDrawdown1Y:        '近1年回撤',
};

/** field 单位后缀 */
const FIELD_UNITS = {
    indexPePercentile: '%',
    indexPbPercentile: '%',
    fundDrawdownAbs:   '%',
    fundGain3M:        '%',
    fundGain6M:        '%',
    fundGain1Y:        '%',
    fundDistanceToYearHighPct: '%',
    fundPricePercentile5Y: '%',
    fundDrawdown1Y:        '%',
};

// ============================================================
// 衍生指标计算
// ============================================================

/**
 * 基于净值序列计算主动基金定投决策所需的衍生指标
 *
 * @param {Array<{date: number, nav: number}>} navTrend
 *        数组中每项需包含 date(ms 时间戳) 和 nav(单位净值)
 * @returns {{
 *   drawdownAbs: number|null,  // 当前回撤的绝对值，正数；从历史最高净值起算
 *   gain3m: number|null,       // 近3月涨幅
 *   gain6m: number|null,       // 近6月涨幅
 *   gain1y: number|null,       // 近1年涨幅（v2 新增）
 *   distanceToYearHighPct: number|null, // 距近1年最高净值的回撤绝对值（v2 新增）
 *   peakNav1Y: number|null,    // 近1年最高净值（v2 新增）
 *   peakDate1Y: string|null,   // 近1年最高净值日期（v2 新增）
 *   latestNavDate: string|null,
 *   latestNav: number|null,
 *   peakNav: number|null,
 *   peakDate: string|null,
 * }}
 */
function computeFundIndicators(navTrend) {
    const empty = {
        drawdownAbs: null,
        gain3m: null,
        gain6m: null,
        gain1y: null,
        distanceToYearHighPct: null,
        peakNav1Y: null,
        peakDate1Y: null,
        latestNavDate: null,
        latestNav: null,
        peakNav: null,
        peakDate: null,
    };
    if (!Array.isArray(navTrend) || navTrend.length === 0) return empty;

    // 仅保留有效记录并按时间升序
    const points = navTrend
        .filter(p => p && p.date != null && p.nav != null && !isNaN(p.nav))
        .map(p => ({ date: Number(p.date), nav: Number(p.nav) }))
        .sort((a, b) => a.date - b.date);
    if (points.length === 0) return empty;

    const latest = points[points.length - 1];
    const latestTs = latest.date;
    const latestNav = latest.nav;

    // 历史最高净值（从基金成立至今）
    let peak = points[0];
    for (const p of points) {
        if (p.nav > peak.nav) peak = p;
    }
    const drawdownAbs = peak.nav > 0
        ? parseFloat(((peak.nav - latestNav) / peak.nav * 100).toFixed(2))
        : null;

    // 找到最接近 N 天前的净值（取该天之前的最后一个点）
    const navAtDaysAgo = (days) => {
        const target = latestTs - days * 24 * 3600 * 1000;
        let v = null;
        for (const p of points) {
            if (p.date <= target) v = p.nav;
            else break;
        }
        return v;
    };

    const nav3m = navAtDaysAgo(90);
    const nav6m = navAtDaysAgo(180);
    const nav1y = navAtDaysAgo(365);
    const gain3m = nav3m && nav3m > 0
        ? parseFloat(((latestNav - nav3m) / nav3m * 100).toFixed(2))
        : null;
    const gain6m = nav6m && nav6m > 0
        ? parseFloat(((latestNav - nav6m) / nav6m * 100).toFixed(2))
        : null;
    const gain1y = nav1y && nav1y > 0
        ? parseFloat(((latestNav - nav1y) / nav1y * 100).toFixed(2))
        : null;

    // 近1年最高净值与距高点回撤（窗口数据不足 60 天则降级为 null）
    const oneYearAgo = latestTs - 365 * 24 * 3600 * 1000;
    const lastYearPoints = points.filter(p => p.date >= oneYearAgo);
    let peakNav1Y = null;
    let peakDate1Y = null;
    let distanceToYearHighPct = null;
    if (lastYearPoints.length >= 60) {
        let peak1y = lastYearPoints[0];
        for (const p of lastYearPoints) {
            if (p.nav > peak1y.nav) peak1y = p;
        }
        peakNav1Y = parseFloat(peak1y.nav.toFixed(4));
        peakDate1Y = (() => {
            try { return new Date(peak1y.date).toISOString().split('T')[0]; }
            catch (e) { return null; }
        })();
        if (peak1y.nav > 0) {
            distanceToYearHighPct = parseFloat(((peak1y.nav - latestNav) / peak1y.nav * 100).toFixed(2));
            // 当前即新高时给 0 而非负数
            if (distanceToYearHighPct < 0) distanceToYearHighPct = 0;
        }
    }

    const fmt = (ts) => {
        try { return new Date(ts).toISOString().split('T')[0]; }
        catch (e) { return null; }
    };

    return {
        drawdownAbs,
        gain3m,
        gain6m,
        gain1y,
        distanceToYearHighPct,
        peakNav1Y,
        peakDate1Y,
        latestNavDate: fmt(latestTs),
        latestNav: parseFloat(latestNav.toFixed(4)),
        peakNav: parseFloat(peak.nav.toFixed(4)),
        peakDate: fmt(peak.date),
    };
}

// ============================================================
// 规则评估
// ============================================================

/**
 * 单个 condition 是否命中。
 * 缺失指标（null/undefined）视为不命中，但不抛错（保证降级安全）。
 *
 * @returns {boolean|null} true=命中 / false=未命中 / null=指标缺失（视为不命中）
 */
function evaluateCondition(condition, indicators) {
    if (!condition || !indicators) return null;
    const { field, op, value } = condition;
    if (!ALLOWED_FIELDS.includes(field)) return false;
    if (!ALLOWED_OPS.includes(op)) return false;

    const actual = indicators[field];
    if (actual == null || isNaN(actual)) return null; // 数据缺失

    const v = Number(value);
    if (isNaN(v)) return false;

    switch (op) {
        case '>=': return actual >= v;
        case '>':  return actual >  v;
        case '<=': return actual <= v;
        case '<':  return actual <  v;
        case '==': return actual === v;
        default:   return false;
    }
}

/**
 * 整条规则是否命中。
 *
 * 规则:
 *   - 空 conditions 数组 → 永远命中（兜底档使用）
 *   - logic === 'OR' : 任一条件命中即整体命中
 *   - logic === 'AND'（默认）: 所有条件均需命中（条件评估为 null 视为不命中）
 *
 * @returns {boolean}
 */
function evaluateRule(rule, indicators) {
    if (!rule) return false;
    const conds = Array.isArray(rule.conditions) ? rule.conditions : [];
    if (conds.length === 0) return true; // 兜底：空条件永真

    const logic = (rule.logic || 'AND').toUpperCase();
    if (logic === 'OR') {
        return conds.some(c => evaluateCondition(c, indicators) === true);
    }
    // 默认 AND
    return conds.every(c => evaluateCondition(c, indicators) === true);
}

/**
 * 根据规则对单只基金进行匹配，按数组顺序"命中即停"。
 *
 * @param {Object} strategy 策略配置（含 rules 数组）
 * @param {Object} indicators 已经准备好的指标对象（混合了指数和基金的指标）
 * @returns {{
 *   hitRule: Object|null,
 *   ruleScans: Array<{id, label, color, multiplier, hit, summary}>
 * }}
 */
function matchStrategy(strategy, indicators) {
    const rules = Array.isArray(strategy?.rules) ? strategy.rules : [];
    let hitRule = null;
    const ruleScans = [];

    for (const rule of rules) {
        if (hitRule) {
            // 已经命中过前置规则，剩余规则统一标记未触发
            ruleScans.push({
                id: rule.id,
                label: rule.label,
                color: rule.color,
                multiplier: rule.multiplier,
                hit: false,
                summary: '已被前置规则命中',
            });
            continue;
        }
        const hit = evaluateRule(rule, indicators);
        ruleScans.push({
            id: rule.id,
            label: rule.label,
            color: rule.color,
            multiplier: rule.multiplier,
            hit,
            summary: buildRuleSummary(rule, indicators, hit),
        });
        if (hit) hitRule = rule;
    }

    return { hitRule, ruleScans };
}

/**
 * 生成规则扫描行的简要文本。
 * 命中时：列出导致命中的关键 condition（OR 取首条满足，AND 取首条不满足？此处取首条）。
 * 未命中时：列出导致未命中的关键 condition。
 */
function buildRuleSummary(rule, indicators, hit) {
    const conds = Array.isArray(rule.conditions) ? rule.conditions : [];
    if (conds.length === 0) {
        return hit ? '兜底档（任意状态均触发）' : '兜底档';
    }

    const logic = (rule.logic || 'AND').toUpperCase();
    if (hit) {
        // OR：找首个命中的条件；AND：所有都命中，列出全部（截断显示）
        if (logic === 'OR') {
            const c = conds.find(c => evaluateCondition(c, indicators) === true);
            if (c) return formatConditionWithActual(c, indicators);
        }
        return conds.map(c => formatConditionWithActual(c, indicators)).join(' 且 ');
    }
    // 未命中：找首个未命中或缺失的条件
    const failing = conds.find(c => evaluateCondition(c, indicators) !== true);
    if (failing) {
        const actualVal = indicators[failing.field];
        if (actualVal == null) {
            return `${FIELD_LABELS[failing.field] || failing.field} 数据不可用`;
        }
        return `${FIELD_LABELS[failing.field] || failing.field} ${formatNumber(actualVal)}${FIELD_UNITS[failing.field] || ''} 不满足 ${failing.op} ${failing.value}${FIELD_UNITS[failing.field] || ''}`;
    }
    return '未触发';
}

function formatConditionWithActual(condition, indicators) {
    const label = FIELD_LABELS[condition.field] || condition.field;
    const unit = FIELD_UNITS[condition.field] || '';
    const actual = indicators[condition.field];
    if (actual == null) {
        return `${label} 数据不可用`;
    }
    return `${label} ${formatNumber(actual)}${unit} ${condition.op} ${condition.value}${unit}`;
}

function formatNumber(v) {
    if (v == null || isNaN(v)) return 'N/A';
    return Number(v).toFixed(2);
}

/**
 * 生成可读的中文触发依据：基于命中规则与指标。
 */
function buildTriggerReason(hitRule, indicators, benchmarkName) {
    if (!hitRule) {
        return '未命中任何规则（兜底未生效）';
    }
    const conds = Array.isArray(hitRule.conditions) ? hitRule.conditions : [];
    if (conds.length === 0) {
        return '兜底档（其它规则均未触发）';
    }
    const parts = conds.map(c => {
        const label = FIELD_LABELS[c.field] || c.field;
        const unit = FIELD_UNITS[c.field] || '';
        const actual = indicators[c.field];
        const actualText = actual != null ? `${formatNumber(actual)}${unit}` : 'N/A';
        const indexPrefix = (c.field === 'indexPePercentile' || c.field === 'indexPbPercentile')
            ? `${benchmarkName || '基准指数'} `
            : '';
        return `${indexPrefix}${label} ${actualText} ${c.op} ${c.value}${unit}`;
    });
    const logic = (hitRule.logic || 'AND').toUpperCase();
    return parts.join(logic === 'OR' ? ' 或 ' : ' 且 ');
}

// ============================================================
// 数据获取适配
// ============================================================

/**
 * 从基金数据源拉取净值序列与基金经理信息（先东方财富、失败则天天基金）。
 * @returns {Promise<{ navTrend: Array<{date,nav}>, currentManager: string|null }>}
 *          navTrend 形态: [{ date: ms, nav: number }, ...] 按时间升序；获取失败为 []
 *          currentManager: 实时基金经理姓名；缺失为 null
 */
async function fetchFundNavTrend(code) {
    // 主源: 东方财富（含完整净值序列 + 基金经理）
    try {
        const data = await fetchEastmoneyFundData(code);
        if (data) {
            const all = (data.netWorthTrend && data.netWorthTrend.all) || [];
            const navTrend = all.length > 0
                ? all.map(p => ({ date: Number(p.date), nav: Number(p.nav) }))
                : [];
            const mgr = (Array.isArray(data.managers) && data.managers.length > 0)
                ? (data.managers[0]?.name || null)
                : null;
            const currentManager = (typeof mgr === 'string' && mgr.trim()) ? mgr.trim() : null;
            return { navTrend, currentManager };
        }
    } catch (err) {
        console.warn(`  [策略引擎] ${code} 东方财富净值拉取失败:`, err.message);
    }
    // 备用源: 天天基金（无完整序列，无法计算回撤/涨幅；也无法可靠拿到经理）
    return { navTrend: [], currentManager: null };
}

/**
 * 选择基准指数估值数据。
 * 蛋卷接口返回的 key 形如 "SH000300"，配置中只存数字代码 "000300"，需要兼容查找。
 */
function pickBenchmarkEvaluation(evaMap, benchmarkIndex) {
    if (!evaMap || !benchmarkIndex) return null;
    const candidates = [
        benchmarkIndex,
        `SH${benchmarkIndex}`,
        `SZ${benchmarkIndex}`,
        `HK${benchmarkIndex}`,
    ];
    for (const k of candidates) {
        if (evaMap[k]) return evaMap[k];
    }
    return null;
}

// ============================================================
// 主入口：批量计算所有策略的当前推荐
// ============================================================

/**
 * 计算所有策略基金的当前定投档位推荐。
 *
 * @param {Array} strategies 策略配置数组（来自 active-fund-strategy.json）
 * @returns {Promise<{
 *   calculatedAt: string,
 *   marketContext: { benchmarks: Object },
 *   recommendations: Array
 * }>}
 */
async function computeRecommendations(strategies) {
    const calculatedAt = new Date().toISOString();

    if (!Array.isArray(strategies) || strategies.length === 0) {
        return { calculatedAt, marketContext: { benchmarks: {} }, recommendations: [] };
    }

    // 1) 拉取指数估值（一次拉取全量）
    let evaMap = {};
    try {
        evaMap = await fetchDanjuanEvaluation() || {};
    } catch (err) {
        console.warn('  [策略引擎] 指数估值获取失败:', err.message);
    }

    // 2) 收集所有用到的基准指数，构造 marketContext
    const usedBenchmarks = new Set(strategies.map(s => s.benchmarkIndex).filter(Boolean));
    const marketContext = { benchmarks: {} };
    for (const code of usedBenchmarks) {
        const eva = pickBenchmarkEvaluation(evaMap, code);
        if (eva) {
            marketContext.benchmarks[code] = {
                name: eva.name,
                pe: eva.pe,
                pb: eva.pb,
                pePercentile: eva.pePercentile,
                pbPercentile: eva.pbPercentile,
                date: eva.date,
                evaType: eva.evaType,
            };
        } else {
            marketContext.benchmarks[code] = { name: null, pe: null, pePercentile: null, date: null, _stale: true };
        }
    }

    // 3) 并行拉取每只基金净值序列与实时经理
    const navResults = await Promise.allSettled(
        strategies.map(s => fetchFundNavTrend(s.fundCode))
    );

    // 4) 逐个匹配规则
    const recommendations = strategies.map((strategy, i) => {
        const eva = pickBenchmarkEvaluation(evaMap, strategy.benchmarkIndex) || {};
        const fundFetched = navResults[i].status === 'fulfilled' ? navResults[i].value : { navTrend: [], currentManager: null };
        const navTrend = fundFetched.navTrend || [];
        const currentManager = fundFetched.currentManager || null;
        const fundIndicators = computeFundIndicators(navTrend);

        const indicators = {
            indexPePercentile: eva.pePercentile != null ? Number(eva.pePercentile) : null,
            indexPbPercentile: eva.pbPercentile != null ? Number(eva.pbPercentile) : null,
            fundDrawdownAbs:   fundIndicators.drawdownAbs,
            fundGain3M:        fundIndicators.gain3m,
            fundGain6M:        fundIndicators.gain6m,
            fundGain1Y:        fundIndicators.gain1y,
            fundDistanceToYearHighPct: fundIndicators.distanceToYearHighPct,
        };

        const indexAvailable = indicators.indexPePercentile != null;
        const fundAvailable = navTrend.length > 0;
        const stale = !indexAvailable || !fundAvailable;

        const benchmarkName = eva.name || strategy.benchmarkName || '基准指数';

        // 经理变更短路（最高优先级）：configManager 与 currentManager 均非空且不一致 → 暂停新增
        const configManager = (typeof strategy.managerName === 'string' && strategy.managerName.trim())
            ? strategy.managerName.trim() : null;
        const managerChanged = !!(configManager && currentManager && configManager !== currentManager);

        let hitRule = null;
        let ruleScans = [];
        let triggerReason;

        if (managerChanged) {
            // 短路：跳过 matchStrategy，构造合成档位
            hitRule = {
                id: 'managerChanged',
                label: '暂停新增',
                color: 'purple',
                multiplier: 0,
                logic: 'AND',
            };
            // 把原始规则数组生成"已被经理变更短路"的扫描记录，便于前端折叠区展示
            const rules = Array.isArray(strategy.rules) ? strategy.rules : [];
            ruleScans = rules.map(r => ({
                id: r.id,
                label: r.label,
                color: r.color,
                multiplier: r.multiplier,
                hit: false,
                summary: '已被经理变更短路',
            }));
            triggerReason = `基金经理已由 ${configManager} 变更为 ${currentManager}，请重新评估`;
        } else {
            const matchResult = matchStrategy(strategy, indicators);
            hitRule = matchResult.hitRule;
            ruleScans = matchResult.ruleScans;
            triggerReason = !indexAvailable
                ? `${benchmarkName} 数据不可用，建议手动判断`
                : buildTriggerReason(hitRule, indicators, benchmarkName);
        }

        const monthlyAmount = Number(strategy.monthlyAmount) || 0;
        const multiplier = hitRule ? Number(hitRule.multiplier) : 100;
        const actualAmount = Math.round(monthlyAmount * multiplier / 100);

        return {
            fundCode: strategy.fundCode,
            fundName: strategy.fundName,
            managerName: strategy.managerName || null,
            currentManager,
            managerChanged,
            benchmarkIndex: strategy.benchmarkIndex,
            benchmarkName,
            navDate: fundIndicators.latestNavDate,
            latestNav: fundIndicators.latestNav,
            peakNav: fundIndicators.peakNav,
            peakDate: fundIndicators.peakDate,
            peakNav1Y: fundIndicators.peakNav1Y,
            peakDate1Y: fundIndicators.peakDate1Y,
            indicators,
            hitRule: hitRule ? {
                id: hitRule.id,
                label: hitRule.label,
                color: hitRule.color,
                multiplier: hitRule.multiplier,
                logic: hitRule.logic || 'AND',
            } : null,
            monthlyAmount,
            actualAmount,
            triggerReason,
            ruleScans,
            stale,
        };
    });

    return { calculatedAt, marketContext, recommendations };
}

module.exports = {
    // 常量
    ALLOWED_FIELDS,
    ALLOWED_OPS,
    FIELD_LABELS,
    FIELD_UNITS,
    // 引擎核心
    computeFundIndicators,
    evaluateCondition,
    evaluateRule,
    matchStrategy,
    buildTriggerReason,
    computeRecommendations,
    // 测试钩子
    pickBenchmarkEvaluation,
    fetchFundNavTrend,
};
