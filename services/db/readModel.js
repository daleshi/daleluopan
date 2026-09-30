/**
 * 网站进程的只读数据模型
 *
 * - latest.json：最新行情快照（小文件，mtime 变化时重读）
 * - snap/*.json：重量快照（indices / active-funds，含 K 线序列，mtime 变化时重读）
 * - market.db：历史库只读副本（mtime 变化时重新加载，失败保留旧副本）
 *
 * 文件 stat 结果缓存 1 秒，避免每个请求都访问磁盘。本模块从不写文件。
 */
const fs = require('fs');
const paths = require('./paths');
const { openFromBytes } = require('./sqlite');

const STAT_TTL_MS = 1000;

// 最新行情快照里包含的缓存键；其余键走 snap 文件
const LATEST_KEYS = new Set(['index-quotes', 'stocks', 'etfs', 'daily-eval']);
const SNAP_KEYS = new Set(['indices', 'active-funds']);

const _files = {}; // file → { checkedAt, mtimeMs, value, error }

function _statMtime(file) {
    try {
        return fs.statSync(file).mtimeMs;
    } catch (e) {
        return 0;
    }
}

/** 读取 JSON 文件（mtime 未变时直接返回内存副本） */
function _readJson(file) {
    const now = Date.now();
    const entry = _files[file] || (_files[file] = { checkedAt: 0, mtimeMs: -1, value: null, error: null });
    if (now - entry.checkedAt < STAT_TTL_MS) return entry.value;
    entry.checkedAt = now;
    const mtime = _statMtime(file);
    if (!mtime) return entry.value; // 文件暂不存在：保持已有副本
    if (mtime === entry.mtimeMs) return entry.value;
    try {
        entry.value = JSON.parse(fs.readFileSync(file, 'utf8'));
        entry.mtimeMs = mtime;
        entry.error = null;
    } catch (err) {
        // 原子写保证不会读到半截文件；这里仅防御意外损坏，继续使用旧副本
        entry.error = err.message;
        console.warn(`[读库] ${file} 读取失败，继续使用旧副本: ${err.message}`);
    }
    return entry.value;
}

function getLatest() {
    return _readJson(paths.LATEST_JSON);
}

/**
 * 取某个缓存键的快照：{ data, time } 或 null
 */
function getSnapshot(key) {
    if (LATEST_KEYS.has(key)) {
        const latest = getLatest();
        const snap = latest && latest.snapshots && latest.snapshots[key];
        return snap && snap.data ? snap : null;
    }
    if (SNAP_KEYS.has(key)) {
        const snap = _readJson(paths.snapFile(key));
        return snap && snap.data ? snap : null;
    }
    return null;
}

function hasKey(key) {
    return LATEST_KEYS.has(key) || SNAP_KEYS.has(key);
}

// ───────────────────────── 历史库只读副本 ─────────────────────────

const _db = { db: null, mtimeMs: -1, checkedAt: 0, loading: null, loadedAt: null, loadMs: null, error: null, bytes: 0 };

async function _reload(mtime) {
    const t0 = Date.now();
    try {
        const bytes = fs.readFileSync(paths.MARKET_DB);
        const next = await openFromBytes(bytes);
        const prev = _db.db;
        _db.db = next;
        _db.mtimeMs = mtime;
        _db.loadedAt = new Date().toISOString();
        _db.loadMs = Date.now() - t0;
        _db.bytes = bytes.length;
        _db.error = null;
        if (prev) {
            try { prev.close(); } catch (e) { /* ignore */ }
        }
        if (_db.loadMs > 500) console.warn(`[读库] market.db 加载耗时 ${_db.loadMs}ms，超过 500ms 阈值`);
    } catch (err) {
        _db.error = err.message;
        _db.mtimeMs = mtime; // 同一个坏文件不反复重试；采集进程下次落盘会产生新 mtime
        console.warn(`[读库] market.db 加载失败，继续使用旧副本: ${err.message}`);
    }
}

/**
 * 取历史库只读副本（可能为 null：库尚未生成）
 * 文件变化时等待重新加载完成后返回新库。
 */
async function getDb() {
    const now = Date.now();
    if (_db.loading) {
        await _db.loading;
        return _db.db;
    }
    if (now - _db.checkedAt >= STAT_TTL_MS) {
        _db.checkedAt = now;
        const mtime = _statMtime(paths.MARKET_DB);
        if (mtime && mtime !== _db.mtimeMs) {
            _db.loading = _reload(mtime).finally(() => { _db.loading = null; });
            await _db.loading;
        }
    }
    return _db.db;
}

function status() {
    const latest = getLatest();
    return {
        latest: latest ? {
            updatedAt: latest.updatedAt || null,
            keys: Object.keys(latest.snapshots || {}),
            status: latest.status || null,
            collector: latest.collector || null,
        } : null,
        marketDb: {
            loaded: !!_db.db,
            loadedAt: _db.loadedAt,
            loadMs: _db.loadMs,
            bytes: _db.bytes,
            error: _db.error,
        },
    };
}

module.exports = { getLatest, getSnapshot, hasKey, getDb, status, LATEST_KEYS, SNAP_KEYS };
