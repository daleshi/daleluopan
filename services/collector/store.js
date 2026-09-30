/**
 * 采集进程的写入端：latest.json、重量快照、market.db 落盘
 *
 * 本进程是这些文件的唯一写入者，所有写入都经由原子落盘。
 */
const fs = require('fs');
const paths = require('../db/paths');
const { writeJsonAtomic } = require('../db/atomicWrite');

class Store {
    constructor({ db, save, log = console }) {
        this.db = db;
        this._save = save;
        this.log = log;
        this.dirty = false;
        this.lastSaveAt = null;
        this.latest = this._loadLatest();
        this.latest.collector = { pid: process.pid, startedAt: new Date().toISOString(), heartbeatAt: new Date().toISOString() };
        this.latest.status = this.latest.status || {};
    }

    _loadLatest() {
        try {
            if (fs.existsSync(paths.LATEST_JSON)) {
                const obj = JSON.parse(fs.readFileSync(paths.LATEST_JSON, 'utf8'));
                if (obj && typeof obj === 'object') return { version: 1, snapshots: {}, ...obj };
            }
        } catch (e) {
            this.log.warn('[采集] latest.json 读取失败，重新生成:', e.message);
        }
        return { version: 1, updatedAt: null, snapshots: {}, status: {} };
    }

    // ───────── latest.json ─────────

    setSnapshot(key, data) {
        this.latest.snapshots[key] = { data, time: Date.now() };
        this.flushLatest();
    }

    getSnapshot(key) {
        return this.latest.snapshots[key] || null;
    }

    setStatus(name, status) {
        this.latest.status[name] = { ...(this.latest.status[name] || {}), ...status };
    }

    heartbeat() {
        const m = process.memoryUsage();
        const mb = (v) => Math.round(v / 1048576);
        this.latest.collector.heartbeatAt = new Date().toISOString();
        this.latest.collector.memory = { rss: mb(m.rss), heapUsed: mb(m.heapUsed), heapTotal: mb(m.heapTotal), external: mb(m.external), arrayBuffers: mb(m.arrayBuffers) };
        this.flushLatest();
    }

    flushLatest() {
        this.latest.updatedAt = new Date().toISOString();
        try {
            writeJsonAtomic(paths.LATEST_JSON, this.latest);
        } catch (err) {
            this.log.error('[采集] latest.json 写入失败:', err.message);
        }
    }

    // ───────── 重量快照（indices / active-funds）─────────

    writeSnap(key, data) {
        const wrapper = { data, time: Date.now(), date: new Date().toISOString() };
        writeJsonAtomic(paths.snapFile(key), wrapper);
        return wrapper;
    }

    readSnap(key) {
        try {
            const f = paths.snapFile(key);
            if (!fs.existsSync(f)) return null;
            const w = JSON.parse(fs.readFileSync(f, 'utf8'));
            return w && w.data ? w : null;
        } catch (e) {
            return null;
        }
    }

    // ───────── market.db ─────────

    markDirty() {
        this.dirty = true;
    }

    /** 有改动时导出库文件（原子落盘） */
    saveDb(reason = '') {
        if (!this.dirty) return null;
        try {
            const r = this._save();
            this.dirty = false;
            this.lastSaveAt = new Date().toISOString();
            this.setStatus('db', { lastSaveAt: this.lastSaveAt, bytes: r.bytes, saveMs: r.ms });
            this.log.log(`[采集] market.db 已落盘${reason ? `（${reason}）` : ''}：${(r.bytes / 1048576).toFixed(1)}MB，${r.ms}ms`);
            return r;
        } catch (err) {
            this.log.error('[采集] market.db 落盘失败:', err.message);
            return null;
        }
    }
}

module.exports = { Store };
