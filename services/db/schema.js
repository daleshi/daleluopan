/**
 * 数据库结构与版本化迁移
 *
 * 新增结构变更时：在 MIGRATIONS 末尾追加一项，不修改已有项。
 */

const MIGRATIONS = [
    // v1：初始结构
    `
    CREATE TABLE IF NOT EXISTS meta (
        key   TEXT PRIMARY KEY,
        value TEXT
    );

    -- 关注清单镜像（由采集进程根据 watchlist 文件维护）
    CREATE TABLE IF NOT EXISTS instruments (
        id                     INTEGER PRIMARY KEY AUTOINCREMENT,
        type                   TEXT NOT NULL,              -- index / stock / etf / fund
        code                   TEXT NOT NULL,
        market                 TEXT NOT NULL DEFAULT '',
        secid                  TEXT,
        name                   TEXT,
        dj_code                TEXT,                       -- 蛋卷指数代码（估值来源）
        cs_code                TEXT,                       -- 中证指数代码
        tracking_instrument_id INTEGER,                    -- ETF → 跟踪指数
        valuation_source       TEXT,                       -- danjuan / csindex / eastmoney_dc / none
        kline_source           TEXT,                       -- eastmoney / cnindex
        status                 TEXT NOT NULL DEFAULT 'active', -- active / deleted / hidden
        created_at             TEXT,
        deleted_at             TEXT,
        extra                  TEXT,
        UNIQUE(type, code, market)
    );

    CREATE TABLE IF NOT EXISTS kline_daily (
        instrument_id INTEGER NOT NULL,
        trade_date    TEXT NOT NULL,
        open REAL, high REAL, low REAL, close REAL,
        volume REAL, amount REAL,
        change_pct REAL, change_amt REAL,
        source TEXT,
        PRIMARY KEY (instrument_id, trade_date)
    ) WITHOUT ROWID;

    CREATE TABLE IF NOT EXISTS fund_nav_daily (
        instrument_id INTEGER NOT NULL,
        nav_date      TEXT NOT NULL,
        nav REAL, acc_nav REAL, daily_return REAL,
        source TEXT,
        PRIMARY KEY (instrument_id, nav_date)
    ) WITHOUT ROWID;

    -- 估值快照（永久保存）
    CREATE TABLE IF NOT EXISTS valuation_daily (
        instrument_id      INTEGER NOT NULL,
        trade_date         TEXT NOT NULL,
        pe REAL, pb REAL, pe_pct REAL, pb_pct REAL,
        roe REAL, dividend REAL, eva_type TEXT,
        temperature REAL,
        source             TEXT,                -- PE/PB 来源
        temperature_source TEXT,
        granularity        TEXT,                -- daily / weekly
        is_fallback        INTEGER NOT NULL DEFAULT 0,   -- PE/PB 为盘中兜底值
        temp_is_fallback   INTEGER NOT NULL DEFAULT 0,   -- 温度为盘中兜底值
        fetched_at         TEXT,
        PRIMARY KEY (instrument_id, trade_date)
    ) WITHOUT ROWID;

    CREATE TABLE IF NOT EXISTS valuation_bands (
        instrument_id INTEGER NOT NULL,
        metric        TEXT NOT NULL,            -- pe / pb
        p30 REAL, p50 REAL, p70 REAL,
        source TEXT, updated_at TEXT,
        PRIMARY KEY (instrument_id, metric)
    ) WITHOUT ROWID;

    CREATE TABLE IF NOT EXISTS collector_runs (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        job         TEXT NOT NULL,
        market      TEXT,
        started_at  TEXT,
        finished_at TEXT,
        status      TEXT,
        ok_count    INTEGER DEFAULT 0,
        fail_count  INTEGER DEFAULT 0,
        error       TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_runs_job ON collector_runs(job, started_at);
    `,
];

function currentVersion(db) {
    db.run('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
    const r = db.exec('SELECT version FROM schema_version LIMIT 1');
    if (!r.length || !r[0].values.length) {
        db.run('INSERT INTO schema_version(version) VALUES (0)');
        return 0;
    }
    return r[0].values[0][0];
}

/** 执行未应用的迁移，返回迁移后的版本号 */
function migrate(db) {
    let v = currentVersion(db);
    while (v < MIGRATIONS.length) {
        db.run('BEGIN');
        try {
            db.exec(MIGRATIONS[v]);
            db.run('UPDATE schema_version SET version = ?', [v + 1]);
            db.run('COMMIT');
        } catch (err) {
            db.run('ROLLBACK');
            throw new Error(`数据库迁移 v${v + 1} 失败: ${err.message}`);
        }
        v += 1;
    }
    return v;
}

module.exports = { MIGRATIONS, migrate, currentVersion, LATEST_VERSION: MIGRATIONS.length };
