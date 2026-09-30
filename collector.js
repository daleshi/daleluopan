/**
 * 大乐罗盘 · 后台采集进程（PM2 应用 dale-collector）
 *
 * 行情数据的唯一写入者：
 *   - data/db/latest.json      最新行情快照（盘中 5～10 秒随机间隔）
 *   - data/db/snap/*.json      指数完整数据 / 严选基金（分钟级）
 *   - data/db/market.db        日 K、基金净值、估值、温度历史（每日任务后落盘）
 * 网站进程只读这些文件；本进程崩溃不影响网站，网站崩溃不影响采集。
 */
const fs = require('fs');
const path = require('path');
const paths = require('./services/db/paths');
const { cleanupTempFiles } = require('./services/db/atomicWrite');
const { openWritable } = require('./services/db/sqlite');
const repo = require('./services/db/repo');
const { Store } = require('./services/collector/store');
const { createJobs } = require('./services/collector/jobs');
const { createQuoteLoop } = require('./services/collector/quoteLoop');
const { createScheduler } = require('./services/collector/scheduler');
const { isCollectWindow } = require('./services/marketHours');
const df = require('./services/dataFetcher');

const LOCK_FILE = path.join(paths.DB_DIR, 'collector.lock');
const log = console;

// ───────────────────────── 单实例锁 ─────────────────────────

function acquireLock() {
    fs.mkdirSync(paths.DB_DIR, { recursive: true });
    if (fs.existsSync(LOCK_FILE)) {
        const pid = parseInt(fs.readFileSync(LOCK_FILE, 'utf8'), 10);
        if (pid && pid !== process.pid) {
            try {
                process.kill(pid, 0);
                log.error(`[采集] 已有采集进程在运行（pid ${pid}），本进程退出`);
                process.exit(0);
            } catch (e) {
                log.warn(`[采集] 清理失效锁（pid ${pid} 已不存在）`);
            }
        }
    }
    fs.writeFileSync(LOCK_FILE, String(process.pid));
}

function releaseLock() {
    try {
        if (fs.existsSync(LOCK_FILE) && fs.readFileSync(LOCK_FILE, 'utf8').trim() === String(process.pid)) fs.unlinkSync(LOCK_FILE);
    } catch (e) { /* ignore */ }
}

// ───────────────────────── 主流程 ─────────────────────────

async function main() {
    acquireLock();
    cleanupTempFiles(paths.DB_DIR);
    cleanupTempFiles(paths.SNAP_DIR);

    const { db, save } = await openWritable(log);
    const store = new Store({ db, save, log });
    const jobs = createJobs({ store, log });

    // fetchIndexQuotesForWatchlist 的 52 周 / 动量增强读取采集进程自己的指数快照
    df.setIndicesCacheFile(paths.snapFile('indices'));
    const seeded = jobs.seedSnapshots();
    if (seeded) log.log(`[采集] 从现有缓存初始化 ${seeded} 份快照`);

    // 关注清单镜像
    const syncType = (type) => {
        const items = repo.readWatchlistRaw(type);
        const r = repo.syncWatchlist(db, type, items, df.POOL_MAP);
        if (r.skipped) return r;
        if (r.added.length || r.restored.length || r.deleted.length) {
            store.markDirty();
            log.log(`[关注] ${type}: 新增 ${r.added.map(i => i.name).join('、') || '-'}；恢复 ${r.restored.map(i => i.name).join('、') || '-'}；删除 ${r.deleted.map(i => i.name).join('、') || '-'}`);
        }
        return r;
    };
    for (const t of ['index', 'stock', 'etf', 'fund']) syncType(t);
    await jobs.importLegacyJob();
    store.saveDb('启动');

    // 盘中采集循环
    const loops = {
        index: createQuoteLoop({ name: '指数', markets: () => jobs.watchlistMarkets('index'), run: jobs.runIndexQuotes, onState: s => store.setStatus('index', s), log }),
        stock: createQuoteLoop({ name: '股票', markets: () => jobs.watchlistMarkets('stock'), run: jobs.runStockQuotes, onState: s => store.setStatus('stock', s), log }),
        etf: createQuoteLoop({ name: 'ETF', markets: () => jobs.watchlistMarkets('etf'), run: jobs.runEtfQuotes, onState: s => store.setStatus('etf', s), log }),
    };

    // 重量快照：交易时段更频繁
    const periodic = [
        {
            key: 'indices',
            every: () => (jobs.watchlistMarkets('index').some(m => isCollectWindow(m)) ? 5 : 60) * 60000,
            run: async () => {
                await jobs.refreshIndicesSnapshot();
                // 行情快照的 52 周高低 / 动量取自指数快照；休市时盘中循环不运行，需要重算一次才能反映新快照
                if (!jobs.watchlistMarkets('index').some(m => isCollectWindow(m))) await loops.index.kick('指数快照更新');
            },
        },
        { key: 'active-funds', every: () => (isCollectWindow('CN') ? 15 : 180) * 60000, run: () => jobs.refreshActiveFundsSnapshot() },
        { key: 'daily-eval', every: () => 30 * 60000, run: () => jobs.refreshDailyEvalSnapshot() },
    ];
    const lastRun = { 'active-funds': Date.now(), indices: Date.now() }; // 这两项由启动后台任务首次刷新
    const running = {};
    const runPeriodic = async (p, force = false) => {
        if (running[p.key]) return;
        if (!force && lastRun[p.key] && Date.now() - lastRun[p.key] < p.every()) return;
        running[p.key] = true;
        lastRun[p.key] = Date.now();
        try {
            await p.run();
        } catch (err) {
            log.warn(`[采集] 快照 ${p.key} 刷新失败: ${err.message}`);
            lastRun[p.key] = Date.now() - p.every() + 2 * 60000; // 失败 2 分钟后重试
        } finally {
            running[p.key] = false;
        }
    };

    // 关注清单变化：轮询 mtime（3 秒）+ fs.watch（即时）
    const mtimes = {};
    for (const [t, f] of Object.entries(paths.WATCHLIST_FILES)) mtimes[t] = fs.existsSync(f) ? fs.statSync(f).mtimeMs : 0;
    const debounce = {};
    const onWatchlistChange = (type) => {
        clearTimeout(debounce[type]);
        debounce[type] = setTimeout(async () => {
            const r = syncType(type);
            if (r.skipped) { mtimes[type] = 0; return; } // 解析失败：下次轮询重试
            for (const inst of [...r.added, ...r.restored]) jobs.enqueueBackfill(repo.getInstrumentById(db, inst.id));
            store.saveDb(`关注清单 ${type}`);
            if (type === 'index') {
                await loops.index.kick('关注清单变化，即时采集');
                runPeriodic(periodic[0], true);
            } else if (type === 'stock') {
                await loops.stock.kick('关注清单变化，即时采集');
            } else if (type === 'etf') {
                await loops.etf.kick('关注清单变化，即时采集');
            } else if (type === 'fund') {
                runPeriodic(periodic[1], true);
            }
        }, 500);
    };
    const pollWatchlists = () => {
        for (const [t, f] of Object.entries(paths.WATCHLIST_FILES)) {
            const m = fs.existsSync(f) ? fs.statSync(f).mtimeMs : 0;
            if (m !== mtimes[t]) { mtimes[t] = m; onWatchlistChange(t); }
        }
    };
    try {
        fs.watch(paths.DATA_DIR, (evt, name) => { if (name && /-watchlist\.json$/.test(name)) pollWatchlists(); });
    } catch (e) {
        log.warn('[采集] fs.watch 不可用，仅使用轮询:', e.message);
    }

    // 启动：各类先采一次（不受时段限制），再进入各自循环
    log.log('[采集] 启动首轮采集...');
    await Promise.allSettled([
        loops.index.kick('启动首轮'),
        loops.stock.kick('启动首轮'),
        loops.etf.kick('启动首轮'),
        runPeriodic(periodic[2], true),
    ]);
    Object.values(loops).forEach(l => l.start());
    store.flushLatest();

    const scheduler = createScheduler({ store, jobs, log });

    // 后台：指数完整快照 → 缺口补齐 → 回补队列 → 基金快照（串行，避免请求集中）
    (async () => {
        await runPeriodic(periodic[0], true);
        await jobs.gapFillJob();
        const n = jobs.enqueueAllPending();
        if (n) log.log(`[回补] 待回补 ${n} 个标的`);
        const hadNav = repo.get(db, 'SELECT COUNT(*) AS n FROM fund_nav_daily').n > 0;
        running['active-funds'] = true;
        try { await jobs.refreshActiveFundsSnapshot({ ingestFull: !hadNav }); store.saveDb('基金快照'); } catch (e) { log.warn('[采集] 基金快照失败:', e.message); }
        running['active-funds'] = false;
        lastRun['active-funds'] = Date.now();
        scheduler.start();
    })().catch(err => log.error('[采集] 启动后台任务异常:', err.message));

    const timers = [
        setInterval(pollWatchlists, 3000),
        setInterval(() => periodic.forEach(p => runPeriodic(p)), 30000),
        setInterval(() => store.heartbeat(), 30000),
    ];

    const shutdown = (sig) => {
        log.log(`[采集] 收到 ${sig}，保存后退出`);
        timers.forEach(clearInterval);
        Object.values(loops).forEach(l => l.stop());
        scheduler.stop();
        try { store.saveDb('退出'); } catch (e) { /* ignore */ }
        releaseLock();
        process.exit(0);
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    log.log('[采集] 采集进程已就绪');
}

process.on('unhandledRejection', (err) => {
    log.error('[采集] 未处理的 Promise 异常:', err && err.message ? err.message : err);
});
process.on('uncaughtException', (err) => {
    log.error('[采集] 未捕获异常，退出由 PM2 重启:', err && err.stack ? err.stack : err);
    releaseLock();
    process.exit(1);
});

main().catch((err) => {
    log.error('[采集] 启动失败:', err && err.stack ? err.stack : err);
    releaseLock();
    process.exit(1);
});
