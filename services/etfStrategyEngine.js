/**
 * ETF 定投策略 — 规则引擎模块
 *
 * 职责:
 *   - 计算 ETF 月度涨跌幅等衍生指标
 *   - 按 5 档价格区间匹配当前入场档位
 *   - 评估 3 档止盈状态（用户确认型，与黄金一致）
 *   - 评估 3 级暴跌信号（基于月度涨跌幅）
 *
 * 设计原则:
 *   - 持仓汇总复用 goldStrategyEngine.summarizeHoldings（结构完全一致）
 *   - 价格档位匹配：区间右开 [priceMin, priceMax)，按数组顺序首匹即停
 *   - 数据缺失时降级（指标 null → 该档可能命中 null state，不抛错）
 */

const { summarizeHoldings } = require('./goldStrategyEngine');

// ============================================================
// 衍生指标计算
// ============================================================

/**
 * 基于当前价格 + 日 K 线计算 ETF 决策所需的衍生指标。
 *
 * @param {number|null} currentPrice 实时价格
 * @param {Array<{date, close}>} dailyKline 日 K 线（升序）
 * @returns {{
 *   monthChangePct: number|null,   // 近 22 日涨跌幅（%）
 *   refPrice22dAgo: number|null,
 *   refDate22dAgo: string|null,
 * }}
 */
function computeEtfIndicators(currentPrice, dailyKline) {
    const empty = {
        monthChangePct: null,
        refPrice22dAgo: null,
        refDate22dAgo: null,
    };
    if (currentPrice == null || isNaN(currentPrice)) return empty;
    if (!Array.isArray(dailyKline) || dailyKline.length < 22) return empty;

    // K 线按时间升序，取倒数第 22 个（即 22 个交易日前的收盘）
    // dailyKline[length-1] 是最新一天；length-22 是 22 个交易日前
    const idx = dailyKline.length - 22;
    const refItem = dailyKline[idx];
    if (!refItem || refItem.close == null || refItem.close <= 0) return empty;

    const monthChangePct = parseFloat(
        ((currentPrice - refItem.close) / refItem.close * 100).toFixed(2)
    );

    return {
        monthChangePct,
        refPrice22dAgo: parseFloat(Number(refItem.close).toFixed(4)),
        refDate22dAgo: refItem.date || null,
    };
}

// ============================================================
// 价格档位匹配
// ============================================================

/**
 * 按 5 档价格区间匹配当前所在档位。
 *
 * 区间约定（右开）:
 *   - priceMin = null  → 下限无界（最低档）
 *   - priceMax = null  → 上限无界（最高档）
 *   - 匹配规则：priceMin ≤ price < priceMax
 *
 * @param {number|null} price 当前价格
 * @param {Array} priceTiers 档位配置数组
 * @returns {{
 *   hitTier: Object|null,
 *   tierScans: Array<{id, label, color, hit, summary}>,
 * }}
 */
function matchEtfPriceTier(price, priceTiers) {
    const tiers = Array.isArray(priceTiers) ? priceTiers : [];
    if (price == null || isNaN(price) || tiers.length === 0) {
        return {
            hitTier: null,
            tierScans: tiers.map(t => ({
                id: t.id,
                label: t.label,
                color: t.color,
                priceMin: t.priceMin,
                priceMax: t.priceMax,
                monthlyAmount: t.monthlyAmount,
                hit: false,
                summary: price == null ? '价格数据不可用' : '未匹配',
            })),
        };
    }

    let hitTier = null;
    const tierScans = tiers.map(t => {
        const inRange = isPriceInTier(price, t);
        if (inRange && !hitTier) hitTier = t;
        return {
            id: t.id,
            label: t.label,
            color: t.color,
            priceMin: t.priceMin,
            priceMax: t.priceMax,
            monthlyAmount: t.monthlyAmount,
            hit: inRange,
            summary: buildTierSummary(t, price, inRange),
        };
    });

    // 若没有任何档命中（如所有档都有界，且当前价超出），保持 hitTier=null
    // 但 UI 上会显示"未匹配"
    return { hitTier, tierScans };
}

/**
 * 判断价格是否落在档位区间内。
 * 区间右开：[priceMin, priceMax)
 *   - priceMin = null  → 视为 -Infinity
 *   - priceMax = null  → 视为 +Infinity
 */
function isPriceInTier(price, tier) {
    const min = tier.priceMin == null ? -Infinity : Number(tier.priceMin);
    const max = tier.priceMax == null ? Infinity : Number(tier.priceMax);
    return price >= min && price < max;
}

/**
 * 生成档位扫描行的简要文案。
 */
function buildTierSummary(tier, price, hit) {
    const range = formatTierRange(tier);
    if (hit) return `当前价 ${formatNumber(price)} 落入 ${range} 区间`;
    if (tier.priceMin == null) return `当前价 ${formatNumber(price)} ≥ ${formatNumber(tier.priceMax)}`;
    if (tier.priceMax == null) return `当前价 ${formatNumber(price)} < ${formatNumber(tier.priceMin)}`;
    return `当前价 ${formatNumber(price)} 不在 ${range}`;
}

function formatTierRange(tier) {
    if (tier.priceMin == null) return `< ${formatNumber(tier.priceMax)}`;
    if (tier.priceMax == null) return `≥ ${formatNumber(tier.priceMin)}`;
    return `[${formatNumber(tier.priceMin)}, ${formatNumber(tier.priceMax)})`;
}

function formatNumber(v) {
    if (v == null || isNaN(v)) return 'N/A';
    return Number(v).toFixed(3);
}

// ============================================================
// 暴跌信号评估
// ============================================================

/**
 * 按月度涨跌幅判定 3 级暴跌信号。
 * 命中优先级：从严到松（threshold 绝对值大的优先），命中即返回。
 *
 * @param {number|null} monthChangePct 月度涨跌幅（%）
 * @param {Array} crashTiers 暴跌档配置
 * @returns {{ signal: Object|null, text: string }}
 */
function evaluateCrashSignal(monthChangePct, crashTiers) {
    if (monthChangePct == null || isNaN(monthChangePct)) {
        return { signal: null, text: 'K 线数据不足，无法计算近 1 月涨跌幅' };
    }
    const tiers = Array.isArray(crashTiers) ? crashTiers : [];
    if (tiers.length === 0) {
        return { signal: null, text: `近 1 月涨跌 ${monthChangePct >= 0 ? '+' : ''}${monthChangePct}%，未配置暴跌档` };
    }

    // 按 threshold 升序排序（threshold 都是 ≤0 的数，升序即"最严格"在前）
    // 例：[-30, -20, -12] 升序后 → -30 在前
    const sorted = [...tiers].sort((a, b) => Number(a.threshold) - Number(b.threshold));

    // 找到第一个 monthChangePct ≤ threshold 的档（即跌幅超过阈值）
    for (const t of sorted) {
        if (monthChangePct <= Number(t.threshold)) {
            const sign = monthChangePct >= 0 ? '+' : '';
            return {
                signal: {
                    id: t.id,
                    label: t.label,
                    threshold: Number(t.threshold),
                    multiplier: t.multiplier == null ? null : Number(t.multiplier),
                    note: t.note || null,
                    executionHint: t.executionHint || null,
                },
                text: `近 1 月跌幅 ${sign}${monthChangePct}%，已触发 ${t.label}（阈值 ${t.threshold}%）`,
            };
        }
    }
    const sign = monthChangePct >= 0 ? '+' : '';
    return {
        signal: null,
        text: `近 1 月涨跌 ${sign}${monthChangePct}%，未触发暴跌档`,
    };
}

// ============================================================
// 通用止盈档评估（支持 condition 数组，v1 仅 fundReturnPct）
// ============================================================

/**
 * 评估止盈档当前状态（条件数组版）。
 *
 * 与 goldStrategyEngine 的 evaluateTakeProfitTiers 不同：
 *   - 黄金版：每档单一 thresholdReturn 数字阈值
 *   - 本版：每档 triggerConditions 数组（v1 仅支持单 condition 但结构通用）
 *
 * 状态规则:
 *   - triggered : tier.triggeredAt 不为 null
 *   - actionable: 所有 triggerConditions 命中
 *   - pending   : 任一 condition 不命中或数据缺失
 *
 * @param {Array} tiers
 * @param {Object} indicators 含 fundReturnPct 等
 * @param {number} totalShares
 * @param {number|null} latestPrice
 * @returns {Array}
 */
function evaluateGenericTakeProfitTiers(tiers, indicators, totalShares, latestPrice) {
    if (!Array.isArray(tiers)) return [];
    return tiers.map(t => {
        const out = {
            id: t.id,
            label: t.label,
            sellPct: Number(t.sellPct),
            triggeredAt: t.triggeredAt || null,
            displayHint: t.displayHint || null,
            triggerConditions: t.triggerConditions || [],
            state: 'pending',
        };

        if (t.triggeredAt) {
            out.state = 'triggered';
            return out;
        }

        // 评估所有 triggerConditions（AND 关系）
        const conds = out.triggerConditions;
        if (conds.length === 0) {
            // 无条件 → 永不命中（防御性，止盈档不应该有空条件）
            return out;
        }

        const allMet = conds.every(c => evaluateTakeProfitCondition(c, indicators));
        if (allMet) {
            out.state = 'actionable';
            const sellShares = parseFloat((Number(totalShares) * out.sellPct / 100).toFixed(4));
            const amountApprox = latestPrice != null
                ? parseFloat((sellShares * latestPrice).toFixed(2))
                : null;
            out.suggestion = { shares: sellShares, amountApprox };
        }
        return out;
    });
}

function evaluateTakeProfitCondition(condition, indicators) {
    if (!condition || !indicators) return false;
    const { field, op, value } = condition;
    const actual = indicators[field];
    if (actual == null || isNaN(actual)) return false;
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

// ============================================================
// 主入口
// ============================================================

/**
 * 计算所有 ETF 策略的实时推荐。
 *
 * @param {Array} strategies   策略配置数组
 * @param {Array} allHoldings  持仓记录（ETF 独立的 etf-holdings.json）
 * @param {Object} etfQuotesByCode  ETF 实时行情 map: { fundCode → { latestPrice, ... } }
 * @param {Object} etfKlinesByCode  ETF 日 K 线 map: { fundCode → [{date, close}, ...] }
 * @returns {{ calculatedAt, recommendations }}
 */
function computeEtfRecommendations(strategies, allHoldings, etfQuotesByCode, etfKlinesByCode) {
    const calculatedAt = new Date().toISOString();

    if (!Array.isArray(strategies) || strategies.length === 0) {
        return { calculatedAt, recommendations: [] };
    }

    const recommendations = strategies.map(strategy => {
        const fundCode = strategy.fundCode;
        const quote = (etfQuotesByCode && etfQuotesByCode[fundCode]) || {};
        const kline = (etfKlinesByCode && etfKlinesByCode[fundCode]) || [];

        const currentPrice = quote.latestPrice != null ? Number(quote.latestPrice) : null;
        const dataAvailable = currentPrice != null && !isNaN(currentPrice);
        const navDate = quote.tradeDate || null;

        // 入场端：匹配价格档位
        const { hitTier, tierScans } = matchEtfPriceTier(currentPrice, strategy.priceTiers);

        const monthlyAmount = hitTier ? Number(hitTier.monthlyAmount) || 0 : 0;
        let triggerReason;
        if (!dataAvailable) {
            triggerReason = '行情数据不可用，建议手动判断';
        } else if (hitTier) {
            triggerReason = `当前价 ${currentPrice.toFixed(3)} → ${hitTier.label}（${formatTierRange(hitTier)}）`;
        } else {
            triggerReason = `当前价 ${currentPrice.toFixed(3)} 未匹配任何配置档位`;
        }

        // 持仓汇总（复用黄金引擎，用 nav 字段填入实时价）
        const holdings = summarizeHoldings(allHoldings, fundCode, currentPrice);

        // 止盈端：用通用条件版评估
        const indicatorsForTakeProfit = {
            fundReturnPct: holdings.totalReturnPct,
            // 未来可扩展 etfPe / etfPb
        };
        const takeProfitStatus = evaluateGenericTakeProfitTiers(
            strategy.takeProfitTiers || [],
            indicatorsForTakeProfit,
            holdings.totalShares,
            currentPrice
        );

        // 衍生指标 + 暴跌信号
        const indicators = computeEtfIndicators(currentPrice, kline);
        const crashEval = evaluateCrashSignal(indicators.monthChangePct, strategy.crashTiers || []);

        return {
            fundCode,
            fundName: strategy.fundName,
            shortName: strategy.shortName || null,
            secid: strategy.secid || null,
            allocationPct: strategy.allocationPct != null ? Number(strategy.allocationPct) : null,
            currentPrice,
            navDate,
            // 入场端
            hitTier: hitTier ? {
                id: hitTier.id,
                label: hitTier.label,
                color: hitTier.color,
                monthlyAmount: Number(hitTier.monthlyAmount) || 0,
                priceMin: hitTier.priceMin,
                priceMax: hitTier.priceMax,
                note: hitTier.note || null,
            } : null,
            monthlyAmount,
            triggerReason,
            tierScans,
            // 持有端
            holdings,
            takeProfitStatus,
            // 暴跌信号
            monthChangePct: indicators.monthChangePct,
            refPrice22dAgo: indicators.refPrice22dAgo,
            refDate22dAgo: indicators.refDate22dAgo,
            crashSignal: crashEval.signal,
            crashSignalText: crashEval.text,
            // 元数据
            stale: !dataAvailable,
        };
    });

    return { calculatedAt, recommendations };
}

module.exports = {
    computeEtfIndicators,
    matchEtfPriceTier,
    isPriceInTier,
    evaluateCrashSignal,
    evaluateGenericTakeProfitTiers,
    computeEtfRecommendations,
};
