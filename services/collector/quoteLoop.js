/**
 * 盘中行情采集循环（每类一个实例，互相独立）
 *
 *   正常：下次间隔 = random(5s, 10s)
 *   失败：10s → 20s → 40s → 80s → 120s（上限），成功后恢复随机区间
 *   连续 6 次数据未变：间隔逐次翻倍，上限 60s；数据变化即恢复
 *   不在采集时段：停止请求，睡到下一个开盘时间（最多睡 10 分钟后复查）
 *   从开盘进入收盘：额外补采一次（收盘后 90 秒），拿到收盘价
 */
const { isCollectWindow, nextCollectOpenAt } = require('../marketHours');

const MIN_MS = 5000;
const MAX_MS = 10000;
const FAIL_BASE_MS = 10000;
const FAIL_MAX_MS = 120000;
const UNCHANGED_THRESHOLD = 6;
const UNCHANGED_MAX_MS = 60000;
const MAX_SLEEP_MS = 10 * 60 * 1000;
const POST_CLOSE_DELAY_MS = 90 * 1000;

const randomInterval = () => MIN_MS + Math.floor(Math.random() * (MAX_MS - MIN_MS + 1));

/**
 * @param {object} opts
 * @param {string} opts.name               指数 / 股票 / ETF
 * @param {() => string[]} opts.markets    当前关注标的涉及的市场（CN/HK/US）
 * @param {() => Promise<string>} opts.run 执行一次采集，返回数据签名（用于判断是否变化）
 * @param {(state) => void} opts.onState   状态回调（写入 latest.json）
 */
function createQuoteLoop({ name, markets, run, onState, log = console }) {
    const st = {
        name,
        running: false,
        stopped: false,
        timer: null,
        failCount: 0,
        unchangedCount: 0,
        intervalMs: randomInterval(),
        lastSignature: null,
        lastRunAt: null,
        lastOkAt: null,
        lastError: null,
        wasOpen: false,
        phase: 'idle',
        intervals: [], // 最近 20 次实际间隔（用于验证）
    };

    const emit = () => {
        if (onState) {
            onState({
                phase: st.phase, failCount: st.failCount, unchangedCount: st.unchangedCount,
                intervalMs: st.intervalMs, lastRunAt: st.lastRunAt, lastOkAt: st.lastOkAt, lastError: st.lastError,
                recentIntervals: st.intervals.slice(-20),
            });
        }
    };

    const anyOpen = () => (markets() || []).some(m => isCollectWindow(m));

    function schedule(ms) {
        if (st.stopped) return;
        clearTimeout(st.timer);
        st.timer = setTimeout(tick, ms);
    }

    async function runOnce(reason = '') {
        if (st.running) return false;
        st.running = true;
        const startedAt = Date.now();
        if (st.lastRunAt) st.intervals.push(startedAt - new Date(st.lastRunAt).getTime());
        if (st.intervals.length > 50) st.intervals.shift();
        st.lastRunAt = new Date(startedAt).toISOString();
        try {
            const sig = await run();
            st.failCount = 0;
            st.lastOkAt = new Date().toISOString();
            st.lastError = null;
            if (sig && sig === st.lastSignature) st.unchangedCount += 1;
            else st.unchangedCount = 0;
            st.lastSignature = sig || null;
            if (reason) log.log(`[采集] ${name} ${reason}完成（${Date.now() - startedAt}ms）`);
            return true;
        } catch (err) {
            st.failCount += 1;
            st.lastError = err.message;
            log.warn(`[采集] ${name} 采集失败（连续 ${st.failCount} 次）: ${err.message}`);
            return false;
        } finally {
            st.running = false;
        }
    }

    function nextInterval(ok) {
        if (!ok) return Math.min(FAIL_MAX_MS, FAIL_BASE_MS * 2 ** (st.failCount - 1));
        if (st.unchangedCount >= UNCHANGED_THRESHOLD) {
            const steps = st.unchangedCount - UNCHANGED_THRESHOLD + 1;
            return Math.min(UNCHANGED_MAX_MS, randomInterval() * 2 ** steps);
        }
        return randomInterval();
    }

    async function tick() {
        if (st.stopped) return;
        if (!anyOpen()) {
            if (st.wasOpen) {
                st.wasOpen = false;
                st.phase = 'post-close';
                emit();
                schedule(POST_CLOSE_DELAY_MS);
                st._postClosePending = true;
                return;
            }
            if (st._postClosePending) {
                st._postClosePending = false;
                await runOnce('收盘补采');
            }
            const next = Math.min(...(markets() || ['CN']).map(m => nextCollectOpenAt(m)));
            const sleep = Math.max(1000, Math.min(MAX_SLEEP_MS, next - Date.now()));
            st.phase = 'closed';
            st.unchangedCount = 0;
            emit();
            schedule(sleep);
            return;
        }
        st.wasOpen = true;
        st.phase = 'open';
        const ok = await runOnce();
        st.intervalMs = nextInterval(ok);
        emit();
        schedule(st.intervalMs);
    }

    return {
        state: st,
        start() {
            st.stopped = false;
            schedule(0);
        },
        stop() {
            st.stopped = true;
            clearTimeout(st.timer);
        },
        /** 立即采集一次（不受时段限制），用于启动与关注清单变化 */
        async kick(reason = '即时采集') {
            const ok = await runOnce(reason);
            emit();
            return ok;
        },
        /** 供测试：计算下一次间隔 */
        _nextInterval: nextInterval,
    };
}

module.exports = { createQuoteLoop, randomInterval, MIN_MS, MAX_MS, FAIL_MAX_MS, UNCHANGED_MAX_MS };
