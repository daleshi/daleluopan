/**
 * 数据库相关文件路径（均位于 data/ 下，部署时不被覆盖）
 * 可通过环境变量 DALE_DB_DIR 覆盖（测试用）
 */
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DB_DIR = process.env.DALE_DB_DIR || path.join(DATA_DIR, 'db');

module.exports = {
    DATA_DIR,
    DB_DIR,
    MARKET_DB: path.join(DB_DIR, 'market.db'),
    LATEST_JSON: path.join(DB_DIR, 'latest.json'),
    SNAP_DIR: path.join(DB_DIR, 'snap'),
    BACKUP_DIR: process.env.DALE_BACKUP_DIR || path.join(DATA_DIR, 'backup'),
    LEGACY_CACHE_DIR: path.join(DATA_DIR, 'cache'),
    WATCHLIST_FILES: {
        index: path.join(DATA_DIR, 'index-watchlist.json'),
        stock: path.join(DATA_DIR, 'stock-watchlist.json'),
        etf: path.join(DATA_DIR, 'etf-watchlist.json'),
        fund: path.join(DATA_DIR, 'fund-watchlist.json'),
    },
    snapFile(key) {
        return path.join(this.SNAP_DIR, `${key}.json`);
    },
};
