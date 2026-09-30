/**
 * sql.js（SQLite WASM）加载与落盘
 *
 * - 可写库：仅采集进程使用。整库常驻内存，任务完成后 save() 原子导出到 market.db
 * - 只读库：网站进程使用，从文件字节加载（见 readModel.js）
 */
const fs = require('fs');
const path = require('path');
const paths = require('./paths');
const { migrate } = require('./schema');
const { writeFileAtomic } = require('./atomicWrite');

let _sqlPromise = null;

/** 初始化 sql.js 运行时（进程内只初始化一次） */
function getSQL() {
    if (!_sqlPromise) {
        const initSqlJs = require('sql.js');
        _sqlPromise = initSqlJs();
    }
    return _sqlPromise;
}

/**
 * 校验库文件可用
 * - 轻量（网站重新加载时）：能打开、结构版本表可读，约 1ms
 * - 完整（采集进程启动时）：额外执行 quick_check，10MB 库约 200ms
 */
function _validate(db, full = false) {
    db.exec('SELECT count(*) FROM sqlite_master');
    db.exec('SELECT version FROM schema_version LIMIT 1');
    if (!full) return;
    const ok = db.exec('PRAGMA quick_check');
    const res = ok[0] && ok[0].values[0] && ok[0].values[0][0];
    if (res !== 'ok') throw new Error(`quick_check: ${res}`);
}

function listBackups() {
    if (!fs.existsSync(paths.BACKUP_DIR)) return [];
    return fs.readdirSync(paths.BACKUP_DIR)
        .filter(f => /^market-\d{8}\.db$/.test(f))
        .sort()
        .reverse()
        .map(f => path.join(paths.BACKUP_DIR, f));
}

/**
 * 打开可写库（采集进程）
 * 优先加载 market.db；损坏时依次尝试最新备份；都不可用则新建空库。
 * @returns {Promise<{db, save: Function, source: string}>}
 */
async function openWritable(log = console) {
    const SQL = await getSQL();
    let db = null;
    let source = 'new';

    const candidates = [paths.MARKET_DB, ...listBackups()];
    for (const file of candidates) {
        if (!fs.existsSync(file)) continue;
        try {
            const candidate = new SQL.Database(fs.readFileSync(file));
            _validate(candidate, true);
            db = candidate;
            source = file;
            break;
        } catch (err) {
            log.warn(`[DB] 库文件不可用，跳过: ${file} (${err.message})`);
        }
    }
    if (db && source !== paths.MARKET_DB) {
        log.warn(`[DB] ⚠️ market.db 不可用，已从备份恢复: ${source}`);
    }
    if (!db) db = new SQL.Database();

    const version = migrate(db);
    log.log(`[DB] 可写库就绪（来源: ${source === 'new' ? '新建' : path.basename(source)}，结构版本 v${version}）`);

    let lastSaveMs = 0;
    const save = () => {
        const t0 = Date.now();
        const bytes = db.export();
        writeFileAtomic(paths.MARKET_DB, Buffer.from(bytes));
        lastSaveMs = Date.now() - t0;
        return { bytes: bytes.length, ms: lastSaveMs };
    };
    // 新建或从备份恢复时立即落盘，保证网站能读到完整文件
    if (source !== paths.MARKET_DB) save();

    return { db, save, source, getLastSaveMs: () => lastSaveMs };
}

/** 从字节加载只读库 */
async function openFromBytes(bytes) {
    const SQL = await getSQL();
    const db = new SQL.Database(bytes);
    _validate(db);
    return db;
}

module.exports = { getSQL, openWritable, openFromBytes, listBackups };
