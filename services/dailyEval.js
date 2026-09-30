/**
 * 每日估值（/api/daily-eval）数据组装：网站进程与采集进程共用
 */
const { fetchDanjuanEvaluation } = require('./dataFetcher');

const EVA_ORDER = { low: 0, mid: 1, high: 2 };

function buildDailyEvalPayload(evaMap) {
    const items = Object.entries(evaMap).map(([code, v]) => ({
        code,
        name: v.name || code,
        pe: v.pe, pb: v.pb,
        pePercentile: v.pePercentile, pbPercentile: v.pbPercentile,
        roe: v.roe, dividend: v.dividend,
        evaType: v.evaType, peg: v.peg, pbFlag: v.pbFlag, date: v.date,
    })).sort((a, b) => {
        const oa = EVA_ORDER[a.evaType] ?? 1;
        const ob = EVA_ORDER[b.evaType] ?? 1;
        if (oa !== ob) return oa - ob;
        return (a.pePercentile ?? 50) - (b.pePercentile ?? 50);
    });
    return { items, updateDate: items[0]?.date || null, total: items.length, source: '蛋卷基金(Wind)' };
}

async function fetchDailyEval() {
    const evaMap = await fetchDanjuanEvaluation();
    if (!evaMap || Object.keys(evaMap).length === 0) {
        throw new Error('估值数据暂不可用');
    }
    return buildDailyEvalPayload(evaMap);
}

module.exports = { buildDailyEvalPayload, fetchDailyEval };
