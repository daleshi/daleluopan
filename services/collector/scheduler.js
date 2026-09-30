/**
 * 每日任务调度（按交易所当地时间）
 *
 * 两类任务：
 *   - retry：从 start 开始执行，未完成则每 retryMin 分钟重试，直到 start + windowMin
 *   - slots：在固定的若干时刻各执行一次
 * 状态按"任务 + 当地日期"记录在 meta 表，进程重启不会重复执行已完成的部分。
 */
const repo = require('../db/repo');
const { zonedParts, MARKET_TZ, normalizeMarket } = require('../marketHours');

const TICK_MS = 30 * 1000;
const hm = (h, m = 0) => h * 60 + m;

function createScheduler({ store, jobs, log = console }) {
    const db = store.db;
    let timer = null;
    let busy = false;

    const TASKS = [
        // 收盘日 K：收盘 +5 分钟起，每 5 分钟重试一次，最长 2 小时；连续 3 次无当日 K 线判定休市
        { id: 'kline_close:CN', market: 'CN', weekdays: true, start: hm(15, 5), retryMin: 5, windowMin: 120, run: (s) => jobs.closeKlinesJob('CN', s.attempts + 1) },
        { id: 'kline_close:HK', market: 'HK', weekdays: true, start: hm(16, 15), retryMin: 5, windowMin: 120, run: (s) => jobs.closeKlinesJob('HK', s.attempts + 1) },
        { id: 'kline_close:US', market: 'US', weekdays: true, start: hm(16, 5), retryMin: 5, windowMin: 120, run: (s) => jobs.closeKlinesJob('US', s.attempts + 1) },
        // 估值与温度：各源在收盘后到晚间陆续公布，按源自身日期写入；23:00 那次对缺失标的兜底
        {
            id: 'valuation', market: 'CN', weekdays: false,
            slots: [hm(9, 0), hm(16, 30), hm(19, 30), hm(21, 30), hm(23, 0)],
            run: (s, slot) => {
                const cn = getState('kline_close:CN', s.date);
                const cnTradingDay = cn.done && !cn.holiday ? s.date : null;
                // 顺带重试之前失败的回补（如数据源临时故障）
                const pending = jobs.enqueueAllPending();
                if (pending) log.log(`[回补] 重试 ${pending} 个未完成的标的`);
                return jobs.valuationJob({ fallback: slot === hm(23, 0), cnTradingDay });
            },
        },
        // 基金净值：20:00 起每 30 分钟一次，拿到当日净值即停，23:30 截止
        {
            id: 'fund_nav', market: 'CN', weekdays: true, start: hm(20, 0), retryMin: 30, windowMin: 210,
            skipIf: (s) => getState('kline_close:CN', s.date).holiday,
            run: () => jobs.fundNavJob(),
        },
        // 每日备份
        { id: 'backup', market: 'CN', weekdays: true, slots: [hm(23, 45)], run: () => jobs.backupJob() },
    ];

    function stateKey(id, date) {
        return `sched:${id}:${date}`;
    }

    function getState(id, date) {
        const raw = repo.getMeta(db, stateKey(id, date));
        let s = null;
        try { s = raw ? JSON.parse(raw) : null; } catch (e) { s = null; }
        return s || { date, attempts: 0, lastAt: null, done: false, holiday: false, slotsDone: [] };
    }

    function setState(id, s) {
        repo.setMeta(db, stateKey(id, s.date), JSON.stringify(s));
        store.markDirty();
    }

    /** 返回本次应执行的 {task, slot}（每次 tick 最多执行一个任务） */
    function dueTask(now = new Date()) {
        for (const t of TASKS) {
            const p = zonedParts(now, MARKET_TZ[normalizeMarket(t.market)]);
            if (t.weekdays && (p.weekday === 0 || p.weekday === 6)) continue;
            const s = getState(t.id, p.date);
            if (s.done || s.holiday) continue;
            if (t.skipIf && t.skipIf(s)) continue;
            if (t.slots) {
                const pending = t.slots.filter(x => p.minutes >= x && !s.slotsDone.includes(x));
                if (!pending.length) continue;
                return { task: t, state: s, slot: pending[pending.length - 1], allPassed: pending };
            }
            if (p.minutes < t.start) continue;
            const end = t.start + t.windowMin;
            if (p.minutes >= end && s.attempts > 0) continue; // 窗口已过且已尝试过
            if (s.lastAt && (now - new Date(s.lastAt)) < t.retryMin * 60000) continue;
            return { task: t, state: s };
        }
        return null;
    }

    async function tick() {
        if (busy) return;
        const due = dueTask();
        if (!due) return;
        busy = true;
        const { task, state, slot, allPassed } = due;
        try {
            log.log(`[调度] 执行 ${task.id}${slot !== undefined ? ` @${String(Math.floor(slot / 60)).padStart(2, '0')}:${String(slot % 60).padStart(2, '0')}` : `（第 ${state.attempts + 1} 次）`}`);
            const r = (await task.run(state, slot)) || {};
            const s = getState(task.id, state.date);
            s.attempts += 1;
            s.lastAt = new Date().toISOString();
            if (task.slots) {
                // 错过的多个时刻只补一次
                s.slotsDone = [...new Set([...s.slotsDone, ...allPassed])];
                if (s.slotsDone.length >= task.slots.length) s.done = true;
            } else {
                if (r.done) s.done = true;
                if (r.holiday) s.holiday = true;
            }
            s.last = { status: r.status || 'ok', ok: r.ok || 0, fail: r.fail || 0 };
            setState(task.id, s);
            store.setStatus(`job:${task.id}`, { date: s.date, attempts: s.attempts, done: s.done, holiday: s.holiday, lastAt: s.lastAt, last: s.last });
            store.saveDb();
            store.flushLatest();
        } catch (err) {
            log.warn(`[调度] ${task.id} 异常: ${err.message}`);
        } finally {
            busy = false;
        }
    }

    return {
        TASKS,
        start() {
            timer = setInterval(() => { tick().catch(() => {}); }, TICK_MS);
            setTimeout(() => { tick().catch(() => {}); }, 20 * 1000);
        },
        stop() { clearInterval(timer); },
        tick,
        dueTask,
        getState,
    };
}

module.exports = { createScheduler };
