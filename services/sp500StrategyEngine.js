/**
 * 标普 500 投资策略 — 规则引擎 (sp500-dca-strategy)
 *
 * 单一策略对象（非数组），包含场外定投 + 场内加仓双子配置。
 * 共享指标：drawdownFromPeak5Y (距 5Y 高点回撤 %)
 *
 * 设计原则：
 *   - 防御优先 + 命中即停
 *   - 三层独立降级（指数 K 线 / 场外净值 / 场内 IOPV）
 *   - IOPV 缺失时溢价闸门"全额放行 + stale"（不误拦截）
 */

const { fetchHistoryKlines, fetchIndexHistory, POOL_MAP } = require('./dataFetcher');
const { fetchEastmoneyFundData } = require('./fundFetcher');
const { fetchETFIopvBySecid } = require('./etfFetcher');

// ============================================================
// 1. 共享衍生指标 — 距 5Y 高点回撤
// ============================================================

/**
 * 基于指数日线 K 线计算"距近 5 年高点回撤"指标。
 *
 * @param {Array<{date: string, close: number}>} klines  按时间升序的日线（date 形如 "2024-05-29"）
 * @returns {{
 *   drawdownFromPeak5Y: number|null,  // 正数百分比（0 = 当前即新高）
 *   peakClose5Y: number|null,
 *   peakDate5Y: string|null,           // YYYY-MM-DD
 *   latestClose: number|null,
 *   latestDate: string|null,
 * }}
 */
function computePriceDrawdown5Y(klines) {
    const empty = {
        drawdownFromPeak5Y: null,
        peakClose5Y: null,
        peakDate5Y: null,
        latestClose: null,
        latestDate: null,
    };
    if (!Array.isArray(klines) || klines.length === 0) return empty;

    // 仅保留有效记录并按日期升序（K 线本身通常已排好，再保险一次）
    const points = klines
        .filter(p => p && p.date && p.close != null && !isNaN(p.close) && Number(p.close) > 0)
        .map(p => ({ date: String(p.date), close: Number(p.close) }))
        .sort((a, b) => a.date.localeCompare(b.date));
    if (points.length < 60) return empty; // 数据不足 60 个交易日 → 全降级

    const latest = points[points.length - 1];
    // 取近 5 年（≈ 1260 个交易日）窗口
    const window = points.length > 1260 ? points.slice(points.length - 1260) : points;

    let peak = window[0];
    for (const p of window) {
        if (p.close > peak.close) peak = p;
    }

    const drawdown = peak.close > 0
        ? parseFloat(((peak.close - latest.close) / peak.close * 100).toFixed(2))
        : null;
    // 当前即新高时给 0（避免负数）
    const drawdownFromPeak5Y = drawdown != null && drawdown < 0 ? 0 : drawdown;

    return {
        drawdownFromPeak5Y,
        peakClose5Y: parseFloat(peak.close.toFixed(4)),
        peakDate5Y: peak.date,
        latestClose: parseFloat(latest.close.toFixed(4)),
        latestDate: latest.date,
    };
}

// ============================================================
// 2. 场外档位匹配 — 4 档（命中即停）
// ============================================================

/**
 * 根据回撤值匹配场外定投档位（pause / half / normal / double）。
 * 命中条件：drawdownLt == null （兜底） 或 drawdown < drawdownLt
 *
 * @param {number|null} drawdown
 * @param {Array} tiers
 * @returns {{ hitTier, tierScans }}
 */
function matchOffsiteTier(drawdown, tiers) {
    const arr = Array.isArray(tiers) ? tiers : [];
    let hitTier = null;
    const tierScans = [];

    for (const tier of arr) {
        if (hitTier) {
            tierScans.push({
                id: tier.id,
                label: tier.label,
                color: tier.color,
                multiplier: tier.multiplier,
                hit: false,
                summary: '已被前置规则命中',
            });
            continue;
        }
        const isMatch = evaluateTierMatch(drawdown, tier);
        tierScans.push({
            id: tier.id,
            label: tier.label,
            color: tier.color,
            multiplier: tier.multiplier,
            hit: isMatch,
            summary: buildTierSummary(drawdown, tier, isMatch),
        });
        if (isMatch) hitTier = tier;
    }
    return { hitTier, tierScans };
}

/**
 * 单档命中判定。drawdown 缺失（null）时仅兜底档（drawdownLt == null）命中。
 */
function evaluateTierMatch(drawdown, tier) {
    if (!tier) return false;
    // 兜底档：drawdownLt == null → 永真（前提是其它档未命中）
    if (tier.drawdownLt == null) return true;
    if (drawdown == null) return false;          // 数据缺失 → 非兜底档全部不命中
    const lt = Number(tier.drawdownLt);
    if (isNaN(lt)) return false;
    return Number(drawdown) < lt;
}

function buildTierSummary(drawdown, tier, hit) {
    if (drawdown == null) {
        return tier.drawdownLt == null
            ? '兜底档（指数数据缺失，触发兜底）'
            : '回撤数据缺失';
    }
    const dwn = Number(drawdown).toFixed(2);
    if (tier.drawdownLt == null) {
        return hit ? `兜底档（回撤 ${dwn}% 不满足任何前置档）` : '兜底档';
    }
    const lt = Number(tier.drawdownLt).toFixed(2);
    if (hit) return `回撤 ${dwn}% < ${lt}%`;
    return `回撤 ${dwn}% 不满足 < ${lt}%`;
}

// ============================================================
// 3. 场内信号匹配 — 4 信号（与场外档共享回撤边界）
// ============================================================

/**
 * 根据回撤值匹配场内加仓信号（idle / watch / buy / strong）。
 *
 * @param {number|null} drawdown
 * @param {Array} signals
 * @returns {{ hitSignal, signalScans }}
 */
function matchOnsiteSignal(drawdown, signals) {
    const arr = Array.isArray(signals) ? signals : [];
    let hitSignal = null;
    const signalScans = [];

    for (const sig of arr) {
        if (hitSignal) {
            signalScans.push({
                id: sig.id,
                label: sig.label,
                color: sig.color,
                amount: sig.amount,
                hit: false,
                summary: '已被前置规则命中',
            });
            continue;
        }
        const isMatch = evaluateTierMatch(drawdown, sig);
        signalScans.push({
            id: sig.id,
            label: sig.label,
            color: sig.color,
            amount: sig.amount,
            hit: isMatch,
            summary: buildTierSummary(drawdown, sig, isMatch),
        });
        if (isMatch) hitSignal = sig;
    }
    return { hitSignal, signalScans };
}

// ============================================================
// 4. 阶梯溢价闸门
// ============================================================

/**
 * 评估场内 ETF 的阶梯溢价闸门，返回闸门状态 + 调整后金额。
 *
 * @param {number|null} premiumPct  实时折溢价率 (%)；缺失为 null
 * @param {{ fullPassMaxPct: number, halfPassMaxPct: number }} gate
 * @param {number} baseAmount       命中信号的基础建议金额
 * @returns {{
 *   value: number|null,
 *   status: "fullPass" | "halfPass" | "blocked" | "iopvUnavailable",
 *   factor: number,
 *   suggestedAmount: number,
 *   message: string,
 * }}
 */
function evaluatePremiumGate(premiumPct, gate, baseAmount) {
    const safeBase = Number(baseAmount) || 0;
    const fullMax = Number(gate?.fullPassMaxPct);
    const halfMax = Number(gate?.halfPassMaxPct);

    // IOPV 数据不可用 → 全额放行 + stale 提示（不误拦截）
    if (premiumPct == null || isNaN(premiumPct)) {
        return {
            value: null,
            status: 'iopvUnavailable',
            factor: 1.0,
            suggestedAmount: safeBase,
            message: 'IOPV 数据不可用，闸门暂停工作（按全额放行处理）',
        };
    }

    // 配置异常时按全额放行（避免误拦截）
    if (isNaN(fullMax) || isNaN(halfMax)) {
        return {
            value: parseFloat(Number(premiumPct).toFixed(2)),
            status: 'fullPass',
            factor: 1.0,
            suggestedAmount: safeBase,
            message: '溢价闸门未配置，按全额放行',
        };
    }

    const p = Number(premiumPct);
    const pStr = p.toFixed(2);
    if (p < fullMax) {
        return {
            value: parseFloat(pStr),
            status: 'fullPass',
            factor: 1.0,
            suggestedAmount: safeBase,
            message: `溢价 ${pStr}% < ${fullMax}%（全额放行）`,
        };
    }
    if (p < halfMax) {
        return {
            value: parseFloat(pStr),
            status: 'halfPass',
            factor: 0.5,
            suggestedAmount: Math.round(safeBase * 0.5),
            message: `溢价 ${pStr}% ∈ [${fullMax}%, ${halfMax}%)（半额放行）`,
        };
    }
    return {
        value: parseFloat(pStr),
        status: 'blocked',
        factor: 0,
        suggestedAmount: 0,
        message: `溢价 ${pStr}% ≥ ${halfMax}%，溢价过高，建议改买场外`,
    };
}

// ============================================================
// 5. 主入口 — 集成共享指标 / 场外档 / 场内信号 + 闸门
// ============================================================

/**
 * 计算标普 500 完整推荐。
 *
 * @param {Object} strategy 单一策略对象（来自 data/sp500-strategy.json）
 * @returns {Promise<Object>} 推荐响应（详见 specs/sp500-dca-strategy/spec.md）
 */
async function computeRecommendation(strategy) {
    const calculatedAt = new Date().toISOString();

    if (!strategy || typeof strategy !== 'object') {
        return {
            calculatedAt,
            error: '策略未配置',
            stale: true,
            drawdownFromPeak5Y: null,
            peakClose5Y: null,
            peakDate5Y: null,
            latestClose: null,
            offsite: null,
            onsite: null,
        };
    }

    // 1) 拉指数 K 线（标普 500）— 优先用 fetchIndexHistory（带缓存 + 多源 failover），
    // 失败时回退到 fetchHistoryKlines（用于 mock-friendly 单元测试）
    const indexCode = strategy.indexCode || 'SPX';
    const indexSecid = strategy.indexSecid || '100.SPX';
    let klines = [];
    try {
        // 优先：从 POOL_MAP 取完整 cfg，走 fetchIndexHistory（缓存 + altSecids + 冷却感知）
        const poolKey = `${indexCode}.US`;
        const cfg = (POOL_MAP && POOL_MAP[poolKey]) ? POOL_MAP[poolKey] : null;
        if (cfg && typeof fetchIndexHistory === 'function') {
            const histResult = await fetchIndexHistory(cfg);
            klines = (histResult && Array.isArray(histResult.klines)) ? histResult.klines : [];
        }
        // 兜底：直接调底层（适用于单测 mock 场景或 POOL_MAP 未命中时）
        if (!klines || klines.length === 0) {
            klines = await fetchHistoryKlines(indexSecid, 1260, [], { timeout: 5000 });
        }
    } catch (err) {
        console.warn('  [SP500策略] 指数 K 线获取失败:', err.message);
    }
    const indicators = computePriceDrawdown5Y(klines);
    const indexAvailable = indicators.drawdownFromPeak5Y != null;

    // 2) 场外子卡片
    const offsiteCfg = strategy.offsite || {};
    const offsiteRes = await computeOffsite(indicators, offsiteCfg, indexAvailable);

    // 3) 场内子卡片
    const onsiteCfg = strategy.onsite || {};
    const onsiteRes = await computeOnsite(indicators, onsiteCfg, indexAvailable);

    // 顶层 stale：仅当指数 K 线失败时为 true（场外/场内的 stale 各自独立）
    const stale = !indexAvailable;

    return {
        calculatedAt,
        drawdownFromPeak5Y: indicators.drawdownFromPeak5Y,
        peakClose5Y: indicators.peakClose5Y,
        peakDate5Y: indicators.peakDate5Y,
        latestClose: indicators.latestClose,
        latestDate: indicators.latestDate,
        offsite: offsiteRes,
        onsite: onsiteRes,
        stale,
    };
}

async function computeOffsite(indicators, cfg, indexAvailable) {
    const { drawdownFromPeak5Y } = indicators;
    const tiers = Array.isArray(cfg.tiers) ? cfg.tiers : [];

    // 场外子卡片自身 stale = 摩根净值是否可用（独立于指数 K 线）
    let fundStale = false;
    let latestNav = null;
    let navDate = null;
    if (cfg.fundCode) {
        try {
            const data = await fetchEastmoneyFundData(cfg.fundCode);
            if (data && data.latestNav != null) {
                latestNav = Number(data.latestNav) || null;
                navDate = data.latestNavDate || null;
            } else {
                fundStale = true;
            }
        } catch (err) {
            console.warn(`  [SP500策略] 摩根 ${cfg.fundCode} 净值获取失败:`, err.message);
            fundStale = true;
        }
    }

    // 指数 K 线失败时，场外档位强制兜底（"normal"，由 design.md "Decisions §6"）
    let hitTier;
    let tierScans;
    if (!indexAvailable) {
        const fallback = tiers.find(t => t && t.id === 'normal') || tiers.find(t => t && t.drawdownLt == null);
        hitTier = fallback || null;
        tierScans = tiers.map(t => ({
            id: t.id, label: t.label, color: t.color, multiplier: t.multiplier,
            hit: hitTier && t.id === hitTier.id,
            summary: hitTier && t.id === hitTier.id ? '指数 K 线不可用，兜底正常档' : '指数 K 线不可用',
        }));
    } else {
        const matched = matchOffsiteTier(drawdownFromPeak5Y, tiers);
        hitTier = matched.hitTier;
        tierScans = matched.tierScans;
    }

    const monthlyAmount = Number(cfg.monthlyAmount) || 0;
    const multiplier = hitTier ? Number(hitTier.multiplier) : 100;
    const actualAmount = Math.round(monthlyAmount * multiplier / 100);

    const triggerReason = !indexAvailable
        ? '指数 K 线不可用，建议手动判断（兜底正常档）'
        : buildOffsiteTriggerReason(drawdownFromPeak5Y, hitTier);

    return {
        fundCode: cfg.fundCode || null,
        fundName: cfg.fundName || null,
        latestNav,
        navDate,
        hitTier: hitTier ? {
            id: hitTier.id,
            label: hitTier.label,
            color: hitTier.color,
            multiplier: hitTier.multiplier,
        } : null,
        monthlyAmount,
        actualAmount,
        triggerReason,
        tierScans,
        stale: fundStale,
    };
}

async function computeOnsite(indicators, cfg, indexAvailable) {
    const { drawdownFromPeak5Y } = indicators;
    const signals = Array.isArray(cfg.signals) ? cfg.signals : [];
    const gate = cfg.premiumGate || {};

    // 拉 ETF 实时价 + IOPV
    let etfStale = false;
    let etfPrice = null;
    let iopv = null;
    let premiumPct = null;
    if (cfg.etfSecid) {
        const r = await fetchETFIopvBySecid(cfg.etfSecid);
        if (r) {
            etfPrice = r.price;
            iopv = r.iopv;
            premiumPct = r.premiumPct;
            // 自算降级链：服务端 f185 缺失但 f184 在
            if (premiumPct == null && iopv != null && etfPrice != null && iopv > 0) {
                premiumPct = parseFloat(((etfPrice - iopv) / iopv * 100).toFixed(2));
            }
            // 若仍 null（f184/f185 均缺）→ etfStale = true（IOPV 不可用）
            if (premiumPct == null) etfStale = true;
        } else {
            etfStale = true;
        }
    }

    // 信号匹配：指数 K 线失败时强制 idle 信号
    let hitSignal;
    let signalScans;
    if (!indexAvailable) {
        const fallback = signals.find(s => s && s.id === 'idle') || signals[0] || null;
        hitSignal = fallback;
        signalScans = signals.map(s => ({
            id: s.id, label: s.label, color: s.color, amount: s.amount,
            hit: hitSignal && s.id === hitSignal.id,
            summary: hitSignal && s.id === hitSignal.id ? '指数 K 线不可用，兜底未到时机' : '指数 K 线不可用',
        }));
    } else {
        const matched = matchOnsiteSignal(drawdownFromPeak5Y, signals);
        hitSignal = matched.hitSignal;
        signalScans = matched.signalScans;
    }

    const baseAmount = hitSignal ? (Number(hitSignal.amount) || 0) : 0;
    const premium = evaluatePremiumGate(premiumPct, gate, baseAmount);

    const triggerReason = !indexAvailable
        ? '指数 K 线不可用，未到加仓时机'
        : buildOnsiteTriggerReason(drawdownFromPeak5Y, hitSignal, premium);

    return {
        etfCode: cfg.etfCode || null,
        etfName: cfg.etfName || null,
        etfSecid: cfg.etfSecid || null,
        etfPrice,
        iopv,
        hitSignal: hitSignal ? {
            id: hitSignal.id,
            label: hitSignal.label,
            color: hitSignal.color,
            amount: hitSignal.amount,
        } : null,
        premium,
        baseAmount,
        suggestedAmount: premium.suggestedAmount,
        triggerReason,
        signalScans,
        stale: etfStale,
    };
}

function buildOffsiteTriggerReason(drawdown, hitTier) {
    if (!hitTier) return '未命中任何档位';
    if (drawdown == null) return '回撤数据缺失，触发兜底';
    const dwn = Number(drawdown).toFixed(2);
    if (hitTier.drawdownLt == null) {
        return `回撤 ${dwn}% — 兜底加倍档`;
    }
    return `距 5Y 高点回撤 ${dwn}% < ${Number(hitTier.drawdownLt).toFixed(2)}%（命中"${hitTier.label}"）`;
}

function buildOnsiteTriggerReason(drawdown, hitSignal, premium) {
    if (!hitSignal) return '未命中任何信号';
    if (drawdown == null) return '回撤数据缺失';
    const dwn = Number(drawdown).toFixed(2);
    const part1 = hitSignal.drawdownLt == null
        ? `回撤 ${dwn}% — 兜底强烈加仓`
        : `距 5Y 高点回撤 ${dwn}% < ${Number(hitSignal.drawdownLt).toFixed(2)}%（命中"${hitSignal.label}"）`;
    const part2 = premium && premium.message ? ` · ${premium.message}` : '';
    return part1 + part2;
}

module.exports = {
    computePriceDrawdown5Y,
    matchOffsiteTier,
    matchOnsiteSignal,
    evaluatePremiumGate,
    computeRecommendation,
};
