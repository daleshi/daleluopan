/**
 * ETF 等比对称网格交易策略计算引擎
 *
 * 核心数学：
 *   网格价位表：P_n = basePrice × (1 + gridStep)^n
 *     - n > 0：上侧卖出网线
 *     - n = 0：中线（底仓）
 *     - n < 0：下侧买入网线
 *
 *   单轮闭环净利率：((1 + gridStep)^2 - 1) - 2 × feeRate
 *     - 一"轮"完整闭环 = 买 -n 后卖 +n，跨越 2 网
 *     - 扣双边手续费
 *
 * 纯计算，不依赖 fs/网络，便于单元测试。
 */

'use strict';

const DEFAULT_FEE_RATE = 0.0015; // 0.15% 单边

/**
 * 四舍五入到指定小数位
 */
function round(v, decimals) {
    if (v == null || !Number.isFinite(v)) return null;
    const factor = Math.pow(10, decimals);
    return Math.round(v * factor) / factor;
}

/**
 * 计算网格价位表
 * @param {Object} cfg
 * @param {number} cfg.basePrice 中线价格
 * @param {number} cfg.gridStep 每格步长（如 0.05 = 5%）
 * @param {number} cfg.gridLevels 单侧网数（正整数）
 * @returns {Array<{level:number,targetPrice:number,action:'buy'|'sell'|'base'}>}
 *   数组按 level 从高到低排列（+N 在前、-N 在后），便于前端表格渲染
 */
function buildGridTable({ basePrice, gridStep, gridLevels }) {
    if (!Number.isFinite(basePrice) || basePrice <= 0) return [];
    if (!Number.isFinite(gridStep) || gridStep <= 0) return [];
    if (!Number.isInteger(gridLevels) || gridLevels < 1) return [];

    const table = [];
    // 上侧：+gridLevels .. +1（卖出）
    for (let n = gridLevels; n >= 1; n--) {
        table.push({
            level: n,
            targetPrice: round(basePrice * Math.pow(1 + gridStep, n), 4),
            action: 'sell',
        });
    }
    // 中线
    table.push({ level: 0, targetPrice: round(basePrice, 4), action: 'base' });
    // 下侧：-1 .. -gridLevels（买入）
    for (let n = 1; n <= gridLevels; n++) {
        table.push({
            level: -n,
            targetPrice: round(basePrice * Math.pow(1 + gridStep, -n), 4),
            action: 'buy',
        });
    }
    return table;
}

/**
 * 单轮闭环预期净利率（%，保留 2 位小数）
 * @param {number} gridStep 如 0.05
 * @param {number} [feeRate=0.0015]
 * @returns {number} 如 9.95 表示 9.95%
 */
function expectedNetPct(gridStep, feeRate = DEFAULT_FEE_RATE) {
    if (!Number.isFinite(gridStep) || gridStep <= 0) return null;
    const grossPct = Math.pow(1 + gridStep, 2) - 1;
    const netPct = grossPct - 2 * feeRate;
    return round(netPct * 100, 2);
}

/**
 * 计算当前价距中线百分比（保留 1 位小数）
 */
function computeDistanceToBasePct(currentPrice, basePrice) {
    if (!Number.isFinite(currentPrice) || currentPrice <= 0) return null;
    if (!Number.isFinite(basePrice) || basePrice <= 0) return null;
    return round((currentPrice - basePrice) / basePrice * 100, 1);
}

/**
 * 寻找距当前价最近的、**未触发**网线
 * @param {number} currentPrice
 * @param {Array} gridTable 由 buildGridTable 返回
 * @param {Set<number>} filledLevels 已触发的 level 集合（不包括 0）
 * @returns {{level, price, action}|null}
 */
function computeNearestGrid(currentPrice, gridTable, filledLevels) {
    if (!Number.isFinite(currentPrice) || currentPrice <= 0) return null;
    if (!Array.isArray(gridTable) || gridTable.length === 0) return null;

    const filled = filledLevels instanceof Set ? filledLevels : new Set(filledLevels || []);

    // 排除已触发 & 中线
    const candidates = gridTable.filter(g => g.level !== 0 && !filled.has(g.level));
    if (candidates.length === 0) return null;

    // 找价格距 currentPrice 最近的
    let best = null;
    let bestDistance = Infinity;
    for (const g of candidates) {
        const d = Math.abs(g.targetPrice - currentPrice);
        if (d < bestDistance) {
            bestDistance = d;
            best = g;
        }
    }
    return best ? { level: best.level, price: best.targetPrice, action: best.action } : null;
}

/**
 * 按 FIFO 配对成交记录，计算已实现网格利润与未平仓浮动
 *
 * FIFO 规则：
 *   - 所有 type='buy' 记录按 date 升序进入队列
 *   - 每条 type='sell' 记录从队列头取最早未配对的 buy，形成一"轮"闭环
 *   - realized += (sell.amount - buy.amount) - 双边手续费
 *   - 队列剩余 = 未平仓
 *
 * @param {Array} records 该 fundCode 的成交记录（不含 base 类型）
 * @param {number} currentPrice 当前价（用于浮动盈亏）
 * @param {number} feeRate 单边手续费率
 * @returns {{realized, unrealizedFloat, unrealizedShares, unrealizedCost}}
 */
function computeFifoGridPnl(records, currentPrice, feeRate = DEFAULT_FEE_RATE) {
    const buys = records
        .filter(r => r.type === 'buy')
        .slice()
        .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const sells = records
        .filter(r => r.type === 'sell')
        .slice()
        .sort((a, b) => String(a.date).localeCompare(String(b.date)));

    // FIFO 队列：每项 { remainingShares, avgPrice, ... }
    const queue = buys.map(b => ({
        date: b.date,
        remainingShares: Number(b.shares) || 0,
        avgPrice: Number(b.price) || 0,
        totalCost: Number(b.amount) || 0,
        originalShares: Number(b.shares) || 0,
    }));

    let realized = 0;
    for (const sell of sells) {
        let toSell = Number(sell.shares) || 0;
        const sellPrice = Number(sell.price) || 0;
        while (toSell > 0 && queue.length > 0) {
            const head = queue[0];
            const matched = Math.min(head.remainingShares, toSell);
            if (matched <= 0) {
                queue.shift();
                continue;
            }
            // 按份数比例分摊 buy 的成本
            const buyCostPortion = head.avgPrice * matched;
            const sellRevenuePortion = sellPrice * matched;
            const feeCost = (buyCostPortion + sellRevenuePortion) * feeRate;
            realized += sellRevenuePortion - buyCostPortion - feeCost;

            head.remainingShares -= matched;
            toSell -= matched;
            if (head.remainingShares <= 0.0001) queue.shift();
        }
    }

    // 未平仓浮动
    let unrealizedShares = 0;
    let unrealizedCost = 0;
    for (const q of queue) {
        unrealizedShares += q.remainingShares;
        unrealizedCost += q.avgPrice * q.remainingShares;
    }
    let unrealizedFloat = null;
    if (Number.isFinite(currentPrice) && currentPrice > 0 && unrealizedShares > 0) {
        unrealizedFloat = currentPrice * unrealizedShares - unrealizedCost;
    }

    return {
        realized: round(realized, 2),
        unrealizedFloat: unrealizedFloat != null ? round(unrealizedFloat, 2) : null,
        unrealizedShares: round(unrealizedShares, 4),
        unrealizedCost: round(unrealizedCost, 2),
    };
}

/**
 * 判定当前一轮内的成交记录
 * 规则：record.createdAt >= strategy.updatedAt 视为"本轮"
 */
function filterCurrentRoundRecords(strategy, records) {
    if (!strategy || !strategy.updatedAt) return records || [];
    const strategyTs = new Date(strategy.updatedAt).getTime();
    return (records || []).filter(r => {
        if (!r.createdAt) return true; // 无时间戳保守视为本轮
        const rTs = new Date(r.createdAt).getTime();
        return !isNaN(rTs) && !isNaN(strategyTs) && rTs >= strategyTs;
    });
}

/**
 * 综合聚合：底仓 + 网格已实现 + 网格浮动 + 总收益率
 */
function computeHoldingsAndPnl(strategy, allRecords, currentPrice) {
    const feeRate = Number.isFinite(strategy.feeRate) ? strategy.feeRate : DEFAULT_FEE_RATE;

    // 分类
    const currentRoundRecords = filterCurrentRoundRecords(strategy, allRecords);
    const base = currentRoundRecords.find(r => r.type === 'base') || null;
    const gridBuys = currentRoundRecords.filter(r => r.type === 'buy');
    const gridSells = currentRoundRecords.filter(r => r.type === 'sell');

    // 底仓
    let baseFilled = null;
    if (base) {
        const cost = Number(base.amount) || 0;
        const shares = Number(base.shares) || 0;
        const avgPrice = shares > 0 ? cost / shares : Number(base.price) || 0;
        let marketValue = null, floatPnl = null, floatPnlPct = null;
        if (Number.isFinite(currentPrice) && currentPrice > 0 && shares > 0) {
            marketValue = round(currentPrice * shares, 2);
            floatPnl = round(marketValue - cost, 2);
            floatPnlPct = cost > 0 ? round((marketValue - cost) / cost * 100, 2) : null;
        }
        baseFilled = { cost: round(cost, 2), shares: round(shares, 4), avgPrice: round(avgPrice, 4), marketValue, floatPnl, floatPnlPct };
    }

    // 网格 FIFO 配对
    const gridPnl = computeFifoGridPnl(
        [...gridBuys, ...gridSells],
        currentPrice,
        feeRate
    );

    // 汇总
    const baseAmount = base ? (Number(base.amount) || 0) : 0;
    const gridBuysCost = gridBuys.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const gridSellsAmount = gridSells.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const totalCostBasis = baseAmount + gridBuysCost;
    const remainingBudget = Math.max(0, (Number(strategy.totalBudget) || 0) - baseAmount - gridBuysCost + gridSellsAmount);

    // 总收益 = 底仓浮盈 + 网格已实现 + 网格未平仓浮动
    const baseFloatPnl = baseFilled && baseFilled.floatPnl != null ? baseFilled.floatPnl : 0;
    const gridRealized = gridPnl.realized || 0;
    const gridUnrealized = gridPnl.unrealizedFloat || 0;
    const totalPnl = baseFloatPnl + gridRealized + gridUnrealized;
    let totalReturnPct = null;
    if (totalCostBasis > 0) {
        totalReturnPct = round(totalPnl / totalCostBasis * 100, 2);
    }

    return {
        holdings: {
            baseFilled,
            gridBuysFilledCount: gridBuys.length,
            gridSellsExecutedCount: gridSells.length,
            remainingBudget: round(remainingBudget, 2),
            totalCostBasis: round(totalCostBasis, 2),
        },
        pnl: {
            baseFloat: baseFilled && baseFilled.floatPnl != null ? baseFilled.floatPnl : null,
            realized: gridPnl.realized,
            unrealizedFloat: gridPnl.unrealizedFloat,
            totalPnl: round(totalPnl, 2),
            totalReturnPct,
        },
    };
}

/**
 * 已触发网格档位集合（本轮内）
 */
function computeFilledLevels(strategy, allRecords) {
    const currentRoundRecords = filterCurrentRoundRecords(strategy, allRecords);
    const filled = new Set();
    for (const r of currentRoundRecords) {
        if (r.type === 'buy' || r.type === 'sell') {
            if (Number.isFinite(r.gridLevel) && r.gridLevel !== 0) {
                filled.add(r.gridLevel);
            }
        }
    }
    return filled;
}

/**
 * 保护机制判定
 * @param {Object} strategy
 * @param {Array} allRecords
 * @param {number|null} marketTemperature 有知有行温度（可为 null）
 * @returns {{paused:boolean, reason:string|null}}
 */
function computeProtection(strategy, allRecords, marketTemperature) {
    // 若策略本身已 paused，直接返回
    if (strategy.status === 'paused') {
        return { paused: true, reason: '策略已手动暂停' };
    }

    // 温度阈值保护
    if (
        Number.isFinite(strategy.pauseWhenTempAbove) &&
        Number.isFinite(marketTemperature) &&
        marketTemperature > strategy.pauseWhenTempAbove
    ) {
        return {
            paused: true,
            reason: `市场温度 ${marketTemperature}° > 阈值 ${strategy.pauseWhenTempAbove}°，暂停买入`,
        };
    }

    // 连续买入冷却
    const cd = strategy.cooldownAfterConsecutiveBuys;
    if (cd && Number.isFinite(cd.n) && Number.isFinite(cd.days) && cd.n > 0 && cd.days > 0) {
        const currentRoundRecords = filterCurrentRoundRecords(strategy, allRecords);
        const now = Date.now();
        const daysMs = cd.days * 24 * 60 * 60 * 1000;
        const recentBuys = currentRoundRecords
            .filter(r => r.type === 'buy')
            .filter(r => {
                if (!r.date) return false;
                const ts = new Date(r.date + 'T00:00:00.000Z').getTime();
                return !isNaN(ts) && now - ts <= daysMs;
            });
        if (recentBuys.length >= cd.n) {
            return {
                paused: true,
                reason: `${cd.days} 天内已连续 ${recentBuys.length} 网买入 ≥ ${cd.n}，冷却中`,
            };
        }
    }

    return { paused: false, reason: null };
}

/**
 * 组装单个策略的完整推荐视图
 * @param {Object} strategy
 * @param {Array} allRecords 该策略 fundCode 下的所有成交记录
 * @param {number|null} currentPrice
 * @param {number|null} marketTemperature
 * @param {Object} [meta] { quoteSource, stale }
 */
function buildRecommendation(strategy, allRecords, currentPrice, marketTemperature, meta = {}) {
    const feeRate = Number.isFinite(strategy.feeRate) ? strategy.feeRate : DEFAULT_FEE_RATE;

    const gridTable = buildGridTable({
        basePrice: strategy.basePrice,
        gridStep: strategy.gridStep,
        gridLevels: strategy.gridLevels,
    });

    const filledLevels = computeFilledLevels(strategy, allRecords);
    const currentRoundRecords = filterCurrentRoundRecords(strategy, allRecords);

    // 每档状态与成本
    const gridTableEnriched = gridTable.map(g => {
        const filled = filledLevels.has(g.level);
        let filledCost = null, filledShares = null;
        if (filled) {
            const recs = currentRoundRecords.filter(r => r.gridLevel === g.level);
            filledCost = round(recs.reduce((s, r) => s + (Number(r.amount) || 0), 0), 2);
            filledShares = round(recs.reduce((s, r) => s + (Number(r.shares) || 0), 0), 4);
        }
        const expectedNet = expectedNetPct(strategy.gridStep, feeRate);
        return {
            level: g.level,
            targetPrice: g.targetPrice,
            action: g.action,
            status: g.level === 0 ? 'base' : (filled ? 'filled' : 'waiting'),
            filledCost,
            filledShares,
            expectedNetPct: g.action === 'buy' ? expectedNet : (g.action === 'sell' ? expectedNet : null),
        };
    });

    const nearest = computeNearestGrid(currentPrice, gridTable, filledLevels);
    const distancePct = computeDistanceToBasePct(currentPrice, strategy.basePrice);
    const holdingsAndPnl = computeHoldingsAndPnl(strategy, allRecords, currentPrice);
    const protection = computeProtection(strategy, allRecords, marketTemperature);

    // 保护生效时下侧买入档标记 paused
    if (protection.paused) {
        for (const row of gridTableEnriched) {
            if (row.action === 'buy' && row.status === 'waiting') {
                row.status = 'paused';
            }
        }
    }

    return {
        fundCode: strategy.fundCode,
        fundName: strategy.fundName,
        shortName: strategy.shortName || strategy.fundName,
        secid: strategy.secid,
        status: strategy.status || 'running',

        currentPrice: Number.isFinite(currentPrice) ? round(currentPrice, 4) : null,
        quoteSource: meta.quoteSource || null,
        stale: !!meta.stale,

        basePrice: strategy.basePrice,
        gridStep: strategy.gridStep,
        gridLevels: strategy.gridLevels,
        totalBudget: strategy.totalBudget,
        baseAmount: strategy.baseAmount,
        amountPerGrid: strategy.amountPerGrid,
        feeRate,

        distanceToBasePct: distancePct,
        nearestGrid: nearest,
        gridTable: gridTableEnriched,

        holdings: holdingsAndPnl.holdings,
        pnl: holdingsAndPnl.pnl,

        protection,

        pauseWhenTempAbove: strategy.pauseWhenTempAbove ?? null,
        cooldownAfterConsecutiveBuys: strategy.cooldownAfterConsecutiveBuys ?? null,

        createdAt: strategy.createdAt || null,
        updatedAt: strategy.updatedAt || null,
    };
}

module.exports = {
    DEFAULT_FEE_RATE,
    buildGridTable,
    expectedNetPct,
    computeDistanceToBasePct,
    computeNearestGrid,
    computeFifoGridPnl,
    computeHoldingsAndPnl,
    computeFilledLevels,
    computeProtection,
    filterCurrentRoundRecords,
    buildRecommendation,
};
