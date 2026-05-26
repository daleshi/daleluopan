/**
 * 黄金定投策略 — 规则引擎扩展模块
 *
 * 职责:
 *   - 计算黄金专用衍生指标（fundPricePercentile5Y / fundDrawdown1Y）
 *   - 汇总持仓记录（buy/sell 事件流 → 累计成本/份额/市值/收益率）
 *   - 评估止盈档位状态（triggered / actionable / pending）
 *   - 调用 active-fund 引擎的 matchStrategy 完成买入档位匹配
 *
 * 设计原则:
 *   - 规则引擎完全复用 activeFundStrategyEngine（无重复）
 *   - 衍生指标计算与持仓汇总在本模块内独立完成
 *   - 数据缺失时降级（指标 null → 规则视为不命中 → 兜底 normal 档）
 */

const {
    matchStrategy,
    buildTriggerReason,
} = require('./activeFundStrategyEngine');
const { fetchEastmoneyFundData } = require('./fundFetcher');

// ============================================================
// 衍生指标计算（黄金专用）
// ============================================================

/**
 * 基于净值序列计算黄金策略所需的衍生指标。
 *
 * @param {Array<{date: number, nav: number}>} navTrend  按时间升序的净值序列
 * @param {number} priceWindow    价格分位窗口（交易日数，默认 1250 ≈ 5年）
 * @param {number} drawdownWindow 回撤窗口（交易日数，默认 250 ≈ 1年）
 * @returns {{
 *   fundPricePercentile5Y: number|null,
 *   fundDrawdown1Y: number|null,
 *   latestNav: number|null,
 *   latestNavDate: string|null,
 * }}
 */
function computeGoldIndicators(navTrend, priceWindow = 1250, drawdownWindow = 250) {
    const empty = {
        fundPricePercentile5Y: null,
        fundDrawdown1Y: null,
        latestNav: null,
        latestNavDate: null,
    };
    if (!Array.isArray(navTrend)) return empty;

    // 过滤、按时间升序
    const points = navTrend
        .filter(p => p && p.date != null && p.nav != null && !isNaN(p.nav))
        .map(p => ({ date: Number(p.date), nav: Number(p.nav) }))
        .sort((a, b) => a.date - b.date);

    if (points.length < 60) return empty; // 数据不足，降级

    const latest = points[points.length - 1];
    const latestNav = latest.nav;
    const latestNavDate = (() => {
        try { return new Date(latest.date).toISOString().split('T')[0]; }
        catch (e) { return null; }
    })();

    // 价格分位窗口：如果数据不足 priceWindow，使用全量数据（降级）
    const windowSize = Math.min(priceWindow, points.length);
    const recentPrice = points.slice(-windowSize).map(p => p.nav);
    const sorted = [...recentPrice].sort((a, b) => a - b);
    const rank = sorted.filter(v => v <= latestNav).length;
    const fundPricePercentile5Y = parseFloat((rank / windowSize * 100).toFixed(2));

    // 1年回撤窗口（同样降级）
    const ddWindow = Math.min(drawdownWindow, points.length);
    const recentDd = points.slice(-ddWindow).map(p => p.nav);
    const peak = Math.max(...recentDd);
    const fundDrawdown1Y = peak > 0
        ? parseFloat(((peak - latestNav) / peak * 100).toFixed(2))
        : null;

    return {
        fundPricePercentile5Y,
        fundDrawdown1Y,
        latestNav: parseFloat(latestNav.toFixed(4)),
        latestNavDate,
    };
}

// ============================================================
// 持仓汇总
// ============================================================

/**
 * 汇总单只基金的持仓事件流。
 *
 * 口径说明:
 *   - totalCost  = Σ(buy.amount) − Σ(sell.amount) 卖出视为成本回收
 *   - totalShares = Σ(buy.shares) − Σ(sell.shares)
 *   - marketValue = totalShares × 最新 NAV
 *   - totalReturnPct = (marketValue − totalCost) / totalCost × 100
 *     · totalCost ≤ 0 时返回 null（避免分母为 0 / 负数语义不清）
 *
 * @param {Array} records      所有持仓记录（不限基金）
 * @param {string} fundCode    要汇总的基金代码
 * @param {number|null} latestNav 最新单位净值
 * @returns {{
 *   totalCost: number,
 *   totalShares: number,
 *   marketValue: number|null,
 *   totalReturnPct: number|null,
 *   buyCount: number,
 *   sellCount: number,
 * }}
 */
function summarizeHoldings(records, fundCode, latestNav) {
    const recs = Array.isArray(records) ? records.filter(r => r && r.fundCode === fundCode) : [];
    let totalCost = 0;
    let totalShares = 0;
    let buyCount = 0;
    let sellCount = 0;

    for (const r of recs) {
        const amt = Number(r.amount) || 0;
        const sh  = Number(r.shares) || 0;
        if (r.type === 'buy') {
            totalCost += amt;
            totalShares += sh;
            buyCount++;
        } else if (r.type === 'sell') {
            totalCost -= amt;
            totalShares -= sh;
            sellCount++;
        }
    }

    totalCost = parseFloat(totalCost.toFixed(2));
    totalShares = parseFloat(totalShares.toFixed(4));

    let marketValue = null;
    let totalReturnPct = null;
    if (latestNav != null && !isNaN(latestNav)) {
        marketValue = parseFloat((totalShares * latestNav).toFixed(2));
        if (totalCost > 0) {
            totalReturnPct = parseFloat(((marketValue - totalCost) / totalCost * 100).toFixed(2));
        }
    }

    return { totalCost, totalShares, marketValue, totalReturnPct, buyCount, sellCount };
}

// ============================================================
// 止盈档评估
// ============================================================

/**
 * 评估每个止盈档当前的状态。
 *
 * 状态规则:
 *   - triggered : tier.triggeredAt 不为 null
 *   - actionable: tier.triggeredAt 为 null 且 totalReturnPct ≥ thresholdReturn
 *   - pending   : tier.triggeredAt 为 null 且 totalReturnPct < thresholdReturn（或 null）
 *
 * @param {Array} tiers          止盈档配置
 * @param {number|null} totalReturnPct 当前累计收益率（%）
 * @param {number} totalShares   当前累计持仓份额（用于计算 suggestion.shares）
 * @param {number|null} latestNav 最新净值（用于计算 suggestion.amountApprox）
 * @returns {Array<{
 *   id, label, thresholdReturn, sellPct,
 *   state, triggeredAt, suggestion?
 * }>}
 */
function evaluateTakeProfitTiers(tiers, totalReturnPct, totalShares, latestNav) {
    if (!Array.isArray(tiers)) return [];

    return tiers.map(tier => {
        const out = {
            id: tier.id,
            label: tier.label,
            thresholdReturn: Number(tier.thresholdReturn),
            sellPct: Number(tier.sellPct),
            state: 'pending',
            triggeredAt: tier.triggeredAt || null,
        };

        if (tier.triggeredAt) {
            out.state = 'triggered';
            return out;
        }

        if (totalReturnPct != null && totalReturnPct >= out.thresholdReturn) {
            out.state = 'actionable';
            // 计算 suggestion: 卖出多少份额、对应多少金额
            const sellShares = parseFloat((totalShares * out.sellPct / 100).toFixed(4));
            const amountApprox = latestNav != null
                ? parseFloat((sellShares * latestNav).toFixed(2))
                : null;
            out.suggestion = { shares: sellShares, amountApprox };
        }

        return out;
    });
}

// ============================================================
// 数据获取适配
// ============================================================

/**
 * 拉取基金的净值序列（用于黄金策略）。
 * 失败返回空数组（不抛错）。
 */
async function fetchGoldFundNavTrend(code) {
    try {
        const data = await fetchEastmoneyFundData(code);
        if (data && data.netWorthTrend) {
            const all = data.netWorthTrend.all || [];
            if (all.length > 0) {
                return all.map(p => ({ date: Number(p.date), nav: Number(p.nav) }));
            }
        }
    } catch (err) {
        console.warn(`  [黄金策略] ${code} 净值拉取失败:`, err.message);
    }
    return [];
}

// ============================================================
// 主入口：批量计算所有黄金策略的当前推荐
// ============================================================

/**
 * 计算所有黄金策略的当前买入档位、推荐金额、持仓汇总、止盈状态。
 *
 * @param {Array} strategies   策略配置数组（data/gold-strategy.json）
 * @param {Array} allHoldings  所有持仓记录数组（data/gold-holdings.json）
 * @returns {Promise<{calculatedAt, recommendations}>}
 */
async function computeGoldRecommendations(strategies, allHoldings) {
    const calculatedAt = new Date().toISOString();

    if (!Array.isArray(strategies) || strategies.length === 0) {
        return { calculatedAt, recommendations: [] };
    }

    // 并行拉取每只基金的净值序列
    const navResults = await Promise.allSettled(
        strategies.map(s => fetchGoldFundNavTrend(s.fundCode))
    );

    const recommendations = strategies.map((strategy, i) => {
        const navTrend = navResults[i].status === 'fulfilled' ? navResults[i].value : [];
        const priceWindow = Number(strategy.priceWindow) || 1250;
        const drawdownWindow = Number(strategy.drawdownWindow) || 250;

        const indicators = computeGoldIndicators(navTrend, priceWindow, drawdownWindow);
        const dataAvailable = indicators.fundPricePercentile5Y != null;

        // 调用复用引擎匹配买入档位
        const indicatorsForEngine = {
            fundPricePercentile5Y: indicators.fundPricePercentile5Y,
            fundDrawdown1Y: indicators.fundDrawdown1Y,
        };
        const { hitRule, ruleScans } = matchStrategy(strategy, indicatorsForEngine);

        const monthlyAmount = Number(strategy.monthlyAmount) || 0;
        const multiplier = hitRule ? Number(hitRule.multiplier) : 100;
        const actualAmount = Math.round(monthlyAmount * multiplier / 100);

        const triggerReason = !dataAvailable
            ? '基金净值数据不可用，建议手动判断'
            : buildTriggerReason(hitRule, indicatorsForEngine, strategy.fundName || '黄金基金');

        // 持仓汇总
        const holdings = summarizeHoldings(allHoldings, strategy.fundCode, indicators.latestNav);

        // 止盈档评估
        const takeProfitStatus = evaluateTakeProfitTiers(
            strategy.takeProfitTiers || [],
            holdings.totalReturnPct,
            holdings.totalShares,
            indicators.latestNav
        );

        return {
            fundCode: strategy.fundCode,
            fundName: strategy.fundName,
            navDate: indicators.latestNavDate,
            latestNav: indicators.latestNav,
            monthlyAmount,
            indicators: {
                fundPricePercentile5Y: indicators.fundPricePercentile5Y,
                fundDrawdown1Y: indicators.fundDrawdown1Y,
            },
            // 买入端
            hitRule: hitRule ? {
                id: hitRule.id,
                label: hitRule.label,
                color: hitRule.color,
                multiplier: hitRule.multiplier,
            } : null,
            actualAmount,
            triggerReason,
            ruleScans,
            // 持有端
            holdings,
            takeProfitStatus,
            stale: !dataAvailable,
        };
    });

    return { calculatedAt, recommendations };
}

module.exports = {
    computeGoldIndicators,
    summarizeHoldings,
    evaluateTakeProfitTiers,
    fetchGoldFundNavTrend,
    computeGoldRecommendations,
};
