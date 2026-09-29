/**
 * 大乐罗盘 - 个人投资分析罗盘
 * Express 服务端
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const {
    fetchAllIndexData, fetchYZYXIndexDetail, fetchYZYXThermometer, resetYZYXCache, fetchDanjuanEvaluation,
    FULL_INDEX_POOL, DEFAULT_SELECTED_CODES, POOL_MAP, INDEX_ICON_PRESETS,
    searchIndex, readIndexWatchlist, writeIndexWatchlist, fetchIndexQuotesForWatchlist,
    getKlineSourceHealthSnapshot, startKlineSourceHealthMonitor,
    fetchIndexHistory,
} = require('./services/dataFetcher');
const {
    fetchAllStockData, readWatchlist, writeWatchlist, ensureWatchlist, isTradingHours,
    searchStock, generateStockIcon, guessStockSector,
} = require('./services/stockFetcher');
const { fetchAllActiveFundData, readFundWatchlist, writeFundWatchlist, ICON_PRESETS, searchFunds, classifyFundCategory } = require('./services/fundFetcher');
const {
    fetchAllETFData, readEtfWatchlist, writeEtfWatchlist, searchETF,
    ETF_ICON_PRESETS, fetchETFMinuteData, fetchETFKlinesForRange,
} = require('./services/etfFetcher');

const compression = require('compression');

const app = express();
const PORT = process.env.PORT || 3200;

// Gzip/Deflate 压缩（JSON 数据压缩率约 90-95%）
app.use(compression({ level: 6, threshold: 1024 }));

// JSON body parser
app.use(express.json());

// ============================================================
// 站点访问统计
// ============================================================
const STATS_FILE = path.join(__dirname, 'data', 'site-stats.json');

function readStats() {
    try {
        if (fs.existsSync(STATS_FILE)) {
            return JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
        }
    } catch (e) { /* ignore */ }
    return { totalPV: 0, totalUV: 0, daily: {}, pages: {}, devices: {}, hours: {}, visitors: {} };
}

function writeStats(stats) {
    const dir = path.dirname(STATS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2), 'utf8');
}

// 内存中的统计数据（减少磁盘IO）
const _stats = readStats();
let _statsDirty = false;

// 定期持久化（每 30 秒写一次磁盘）
setInterval(() => {
    if (_statsDirty) {
        writeStats(_stats);
        _statsDirty = false;
    }
}, 30000);

// 提取访客指纹（IP + UA 的简易 hash）
function visitorFingerprint(req) {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
    const ua = req.headers['user-agent'] || '';
    return crypto.createHash('md5').update(ip + '|' + ua).digest('hex').slice(0, 12);
}

// 解析设备类型
function parseDevice(ua) {
    if (!ua) return 'unknown';
    if (/mobile|android|iphone|ipad|ipod/i.test(ua)) return 'mobile';
    if (/tablet|ipad/i.test(ua)) return 'tablet';
    return 'desktop';
}

// 访问统计中间件（只统计页面和 API 请求，排除静态资源）
app.use((req, res, next) => {
    const url = req.path;
    // 跳过静态资源
    if (/\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|map)$/i.test(url)) {
        return next();
    }

    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const hour = new Date().getHours();
    const fp = visitorFingerprint(req);
    const device = parseDevice(req.headers['user-agent'] || '');
    const isPage = !url.startsWith('/api/');

    // PV
    _stats.totalPV = (_stats.totalPV || 0) + 1;

    // 日统计
    if (!_stats.daily[today]) {
        _stats.daily[today] = { pv: 0, uv: 0, visitors: {} };
    }
    _stats.daily[today].pv += 1;

    // UV（每日去重）
    if (!_stats.daily[today].visitors[fp]) {
        _stats.daily[today].visitors[fp] = true;
        _stats.daily[today].uv += 1;
    }

    // 全局 UV
    if (!_stats.visitors) _stats.visitors = {};
    if (!_stats.visitors[fp]) {
        _stats.visitors[fp] = today;
        _stats.totalUV = (_stats.totalUV || 0) + 1;
    }

    // 页面统计（只统计非 API 请求）
    if (isPage) {
        if (!_stats.pages) _stats.pages = {};
        const pageKey = url === '/' ? '/' : url.replace(/\/$/, '');
        _stats.pages[pageKey] = (_stats.pages[pageKey] || 0) + 1;
    }

    // 设备统计
    if (!_stats.devices) _stats.devices = {};
    _stats.devices[device] = (_stats.devices[device] || 0) + 1;

    // 小时分布
    if (!_stats.hours) _stats.hours = {};
    const hourKey = String(hour).padStart(2, '0');
    _stats.hours[hourKey] = (_stats.hours[hourKey] || 0) + 1;

    _statsDirty = true;
    next();
});

// 访问统计 API
app.get('/api/stats', (req, res) => {
    // 整理最近 30 天的日数据
    const dailyEntries = Object.entries(_stats.daily || {})
        .sort(([a], [b]) => b.localeCompare(a))
        .slice(0, 30)
        .map(([date, d]) => ({ date, pv: d.pv, uv: d.uv }));

    // 今日数据
    const today = new Date().toISOString().slice(0, 10);
    const todayData = _stats.daily[today] || { pv: 0, uv: 0 };

    // 昨日数据
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const yesterdayData = _stats.daily[yesterday] || { pv: 0, uv: 0 };

    // 近7天合计
    const last7days = dailyEntries.slice(0, 7);
    const week = { pv: last7days.reduce((s, d) => s + d.pv, 0), uv: last7days.reduce((s, d) => s + d.uv, 0) };

    // 小时分布（补齐24小时）
    const hourDist = [];
    for (let h = 0; h < 24; h++) {
        const key = String(h).padStart(2, '0');
        hourDist.push({ hour: key, count: (_stats.hours || {})[key] || 0 });
    }

    // 热门页面 top10
    const topPages = Object.entries(_stats.pages || {})
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10)
        .map(([page, count]) => ({ page, count }));

    // 设备占比
    const devices = _stats.devices || {};
    const deviceTotal = Object.values(devices).reduce((s, v) => s + v, 0) || 1;

    res.json({
        success: true,
        data: {
            overview: {
                totalPV: _stats.totalPV || 0,
                totalUV: _stats.totalUV || 0,
                todayPV: todayData.pv,
                todayUV: todayData.uv,
                yesterdayPV: yesterdayData.pv,
                yesterdayUV: yesterdayData.uv,
                weekPV: week.pv,
                weekUV: week.uv,
            },
            daily: dailyEntries.reverse(), // 时间正序
            hourDistribution: hourDist,
            topPages,
            devices: {
                desktop: { count: devices.desktop || 0, pct: ((devices.desktop || 0) / deviceTotal * 100).toFixed(1) },
                mobile: { count: devices.mobile || 0, pct: ((devices.mobile || 0) / deviceTotal * 100).toFixed(1) },
                tablet: { count: devices.tablet || 0, pct: ((devices.tablet || 0) / deviceTotal * 100).toFixed(1) },
                unknown: { count: devices.unknown || 0, pct: ((devices.unknown || 0) / deviceTotal * 100).toFixed(1) },
            },
            startDate: dailyEntries.length > 0 ? dailyEntries[0].date : today,
        },
    });
});

// ============================================================
// 数据源配置持久化（JSON 文件）
// ============================================================
const DS_CONFIG_FILE = path.join(__dirname, 'data', 'datasource-config.json');

function ensureDataDir() {
    const dir = path.dirname(DS_CONFIG_FILE);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

// 数据源配置 — 读写
function readDSConfig() {
    try {
        ensureDataDir();
        if (fs.existsSync(DS_CONFIG_FILE)) {
            const raw = fs.readFileSync(DS_CONFIG_FILE, 'utf8');
            return JSON.parse(raw);
        }
    } catch (err) {
        console.warn('[配置] 读取数据源配置失败:', err.message);
    }
    return { enabled: {} };
}

function writeDSConfig(cfg) {
    ensureDataDir();
    fs.writeFileSync(DS_CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
}

// ============================================================
// 智能缓存层：磁盘持久化 + 交易时段感知 + 并发去重
// ============================================================
const CACHE_DIR = path.join(__dirname, 'data', 'cache');
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

// 交易时段感知的缓存 TTL
const CACHE_TTL_TRADING = 5 * 60 * 1000;   // 交易时段: 5分钟
const CACHE_TTL_CLOSED  = 4 * 60 * 60 * 1000; // 休市时段: 4小时
const CACHE_TTL_INDEX_QUOTES_TRADING = 30 * 1000; // 指数行情交易时段: 30秒
const CACHE_TTL_INDEX_QUOTES_CLOSED  = 30 * 60 * 1000; // 指数行情休市: 30分钟

/**
 * 推断指数 watchlist 涉及的市场集合（用于 index-quotes TTL 动态判定）
 * 返回 ['CN' | 'HK' | 'US'] 子集；异常时兜底 ['CN']
 */
function _detectIndexWatchlistMarkets() {
    try {
        const w = readIndexWatchlist();
        const set = new Set();
        for (const i of w) {
            if (i.market === 'SH' || i.market === 'SZ' || i.market === 'CSI') set.add('CN');
            else if (i.market === 'HI' || i.market === 'HK') set.add('HK');
            else if (i.market === 'US') set.add('US');
        }
        return set.size > 0 ? [...set] : ['CN'];
    } catch (e) {
        return ['CN'];
    }
}

function getCacheTTL(key) {
    // index-quotes 单独按 watchlist 涉及的市场动态判定（任一市场开盘 → 短 TTL）
    if (key === 'index-quotes') {
        const trading = isTradingHours(_detectIndexWatchlistMarkets());
        return trading ? CACHE_TTL_INDEX_QUOTES_TRADING : CACHE_TTL_INDEX_QUOTES_CLOSED;
    }
    // 其他 cache key 沿用 A 股交易时段（向后兼容）
    const trading = isTradingHours();
    if (key === 'stocks' || key === 'etfs') return trading ? 15 * 1000 : 30 * 60 * 1000;
    if (key === 'active-funds') return trading ? 10 * 60 * 1000 : 60 * 60 * 1000;
    if (key === 'daily-eval') return 30 * 60 * 1000; // 每日估值：30分钟
    return trading ? CACHE_TTL_TRADING : CACHE_TTL_CLOSED;
}

// 通用磁盘缓存：读/写
function readDiskCache(key) {
    try {
        const filePath = path.join(CACHE_DIR, `${key}.json`);
        if (fs.existsSync(filePath)) {
            const raw = fs.readFileSync(filePath, 'utf8');
            const wrapper = JSON.parse(raw);
            if (wrapper && wrapper.data && wrapper.time) {
                return wrapper;
            }
        }
    } catch (e) { /* ignore */ }
    return null;
}

function writeDiskCache(key, data) {
    try {
        const filePath = path.join(CACHE_DIR, `${key}.json`);
        const wrapper = { data, time: Date.now(), date: new Date().toISOString() };
        fs.writeFileSync(filePath, JSON.stringify(wrapper), 'utf8');
    } catch (e) {
        console.warn(`[缓存] 写入磁盘缓存失败(${key}):`, e.message);
    }
}

// 统一缓存层：内存 + 磁盘
const _smartCache = {};  // key → { data, time }
const _smartFetchPromises = {};  // key → Promise (并发去重)

/**
 * 智能缓存获取
 * @param {string} key 缓存键
 * @param {Function} fetcher 数据获取函数
 * @param {boolean} forceRefresh 强制刷新
 * @returns {Promise<any>} 缓存数据
 */
async function smartCacheGet(key, fetcher, forceRefresh = false) {
    const now = Date.now();
    const ttl = getCacheTTL(key);

    // 1. 内存缓存命中
    if (!forceRefresh && _smartCache[key] && (now - _smartCache[key].time) < ttl) {
        return _smartCache[key].data;
    }

    // 2. 并发去重：如果正在获取中，等待已有请求
    // forceRefresh 时跳过：在途请求可能基于旧状态（如 watchlist 变更前）发起，等待它会返回过期数据
    if (!forceRefresh && _smartFetchPromises[key]) {
        try {
            return await _smartFetchPromises[key];
        } catch (err) {
            // 获取失败，尝试返回内存或磁盘缓存
            if (_smartCache[key]) return _smartCache[key].data;
            const disk = readDiskCache(key);
            if (disk) { _smartCache[key] = disk; return disk.data; }
            throw err;
        }
    }

    // 3. 内存缓存过期但磁盘缓存在 TTL 内
    if (!forceRefresh && !_smartCache[key]) {
        const disk = readDiskCache(key);
        if (disk && (now - disk.time) < ttl) {
            _smartCache[key] = disk;
            return disk.data;
        }
        // 磁盘缓存过期但存在 → 先返回旧数据，后台刷新
        if (disk) {
            _smartCache[key] = disk;
            // 异步后台刷新（不阻塞当前请求）
            _smartFetchPromises[key] = (async () => {
                try {
                    const fresh = await fetcher();
                    _smartCache[key] = { data: fresh, time: Date.now() };
                    writeDiskCache(key, fresh);
                    return fresh;
                } catch (err) {
                    console.warn(`[缓存] 后台刷新失败(${key}):`, err.message);
                    return disk.data;
                } finally {
                    delete _smartFetchPromises[key];
                }
            })();
            return disk.data; // 立即返回旧缓存
        }
    }

    // 4. 全新获取（阻塞等待）
    _smartFetchPromises[key] = (async () => {
        try {
            const startTime = Date.now();
            const fresh = await fetcher();
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(`[缓存] ${key} 数据获取完成，耗时 ${elapsed}s`);
            _smartCache[key] = { data: fresh, time: Date.now() };
            writeDiskCache(key, fresh);
            return fresh;
        } catch (err) {
            console.error(`[缓存] ${key} 获取失败:`, err.message);
            // 回退：内存 → 磁盘
            if (_smartCache[key]) return _smartCache[key].data;
            const disk = readDiskCache(key);
            if (disk) { _smartCache[key] = disk; return disk.data; }
            throw err;
        } finally {
            delete _smartFetchPromises[key];
        }
    })();

    return _smartFetchPromises[key];
}

// ============================================================
// 指数完整数据缓存（兼容原有逻辑）
// ============================================================
let cachedData = null;
let lastFetchTime = 0;
let lastSelectedCodesHash = '';

function hashCodes(codes) {
    return (codes || []).slice().sort().join(',');
}

function getSelectedCodesFromWatchlist() {
    const indices = readIndexWatchlist();
    return indices.map(i => `${i.code}.${i.market}`);
}

async function getCachedData(forceRefresh = false) {
    const selectedCodes = getSelectedCodesFromWatchlist();
    const currentHash = hashCodes(selectedCodes);
    const configChanged = currentHash !== lastSelectedCodesHash;
    if (configChanged) forceRefresh = true;

    // forceRefresh=true 时同步透传给温度计抓取，避免内存 TTL 拦截
    const data = await smartCacheGet(
        'indices',
        () => fetchAllIndexData(selectedCodes, { forceRefreshThermometer: !!forceRefresh }),
        forceRefresh,
    );
    cachedData = data;
    lastFetchTime = Date.now();
    lastSelectedCodesHash = currentHash;
    return data;
}

// 指数行情独立缓存（高频刷新场景）
const _indexQuotesCache = null;
const _indexQuotesCacheTime = 0;

async function getCachedIndexQuotes(forceRefresh = false) {
    return smartCacheGet('index-quotes', () => fetchIndexQuotesForWatchlist(), forceRefresh);
}

// 每日估值缓存
async function getCachedDailyEval(forceRefresh = false) {
    return smartCacheGet('daily-eval', async () => {
        const { fetchDanjuanEvaluation } = require('./services/dataFetcher');
        const evaMap = await fetchDanjuanEvaluation();
        if (!evaMap || Object.keys(evaMap).length === 0) {
            throw new Error('估值数据暂不可用');
        }
        const evaOrder = { low: 0, mid: 1, high: 2 };
        const items = Object.entries(evaMap).map(([code, v]) => ({
            code,
            name: v.name || code,
            pe: v.pe, pb: v.pb,
            pePercentile: v.pePercentile, pbPercentile: v.pbPercentile,
            roe: v.roe, dividend: v.dividend,
            evaType: v.evaType, peg: v.peg, pbFlag: v.pbFlag, date: v.date,
        })).sort((a, b) => {
            const oa = evaOrder[a.evaType] ?? 1;
            const ob = evaOrder[b.evaType] ?? 1;
            if (oa !== ob) return oa - ob;
            return (a.pePercentile ?? 50) - (b.pePercentile ?? 50);
        });
        return { items, updateDate: items[0]?.date || null, total: items.length, source: '蛋卷基金(Wind)' };
    }, forceRefresh);
}

// ============================================================
// 用户认证系统
// ============================================================
const USERS_FILE = path.join(__dirname, 'data', 'users.json');
const sessions = new Map(); // token -> { username, role, createdAt }
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000; // 7天

function hashPassword(password, salt) {
    if (!salt) salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
    return { salt, hash };
}

function verifyPassword(password, salt, storedHash) {
    const { hash } = hashPassword(password, salt);
    return hash === storedHash;
}

function readUsers() {
    try {
        ensureDataDir();
        if (fs.existsSync(USERS_FILE)) {
            const raw = fs.readFileSync(USERS_FILE, 'utf8');
            const data = JSON.parse(raw);
            if (Array.isArray(data.users)) return data.users;
        }
    } catch (err) {
        console.warn('[用户] 读取用户数据失败:', err.message);
    }
    return [];
}

function writeUsers(users) {
    ensureDataDir();
    fs.writeFileSync(USERS_FILE, JSON.stringify({ users }, null, 2), 'utf8');
}

function ensureDefaultAdmin() {
    const users = readUsers();
    if (users.length === 0) {
        const { salt, hash } = hashPassword('admin123');
        users.push({
            username: 'admin',
            passwordHash: hash,
            salt,
            role: 'admin',
            nickname: '管理员',
            createdAt: new Date().toISOString(),
        });
        writeUsers(users);
        console.log('[用户] 已创建默认管理员账户 admin / admin123');
    }
}

function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

function cleanExpiredSessions() {
    const now = Date.now();
    for (const [token, session] of sessions) {
        if (now - session.createdAt > SESSION_TTL) {
            sessions.delete(token);
        }
    }
}

// 从请求中提取 token（cookie 或 header）
function extractToken(req) {
    // 优先从 cookie 中读取
    const cookieHeader = req.headers.cookie || '';
    const match = cookieHeader.match(/(?:^|;\s*)ic_token=([^;]+)/);
    if (match) return match[1];
    // 其次从 Authorization header
    const auth = req.headers.authorization || '';
    if (auth.startsWith('Bearer ')) return auth.slice(7);
    return null;
}

// 中间件：解析当前用户（不强制登录）
function optionalAuth(req, res, next) {
    const token = extractToken(req);
    if (token && sessions.has(token)) {
        const session = sessions.get(token);
        if (Date.now() - session.createdAt < SESSION_TTL) {
            req.user = { username: session.username, role: session.role };
        } else {
            sessions.delete(token);
        }
    }
    next();
}

// 中间件：必须登录
function requireAuth(req, res, next) {
    optionalAuth(req, res, () => {
        if (!req.user) {
            return res.status(401).json({ success: false, error: '请先登录' });
        }
        next();
    });
}

// 中间件：必须管理员
function requireAdmin(req, res, next) {
    requireAuth(req, res, () => {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ success: false, error: '需要管理员权限' });
        }
        next();
    });
}

// === 认证 API ===

/**
 * POST /api/auth/register - 新用户注册（只能注册为普通用户）
 * Body: { username, password, nickname? }
 */
app.post('/api/auth/register', (req, res) => {
    try {
        const { username, password, nickname } = req.body || {};
        if (!username || typeof username !== 'string' || username.trim().length < 2 || username.trim().length > 20) {
            return res.status(400).json({ success: false, error: '账号长度需要2-20个字符' });
        }
        if (!/^[a-zA-Z0-9_\u4e00-\u9fa5]+$/.test(username.trim())) {
            return res.status(400).json({ success: false, error: '账号只能包含字母、数字、下划线或中文' });
        }
        if (!password || typeof password !== 'string' || password.length < 6 || password.length > 50) {
            return res.status(400).json({ success: false, error: '密码长度需要6-50个字符' });
        }
        const users = readUsers();
        if (users.find(u => u.username === username.trim())) {
            return res.status(400).json({ success: false, error: '该账号已被注册' });
        }
        if (users.length >= 100) {
            return res.status(400).json({ success: false, error: '用户数量已达上限' });
        }
        const { salt, hash } = hashPassword(password);
        const newUser = {
            username: username.trim(),
            passwordHash: hash,
            salt,
            role: 'user', // 注册只能是普通用户
            nickname: (nickname || username).trim().slice(0, 20),
            createdAt: new Date().toISOString(),
        };
        users.push(newUser);
        writeUsers(users);
        // 注册后自动登录
        const token = generateToken();
        sessions.set(token, { username: newUser.username, role: newUser.role, createdAt: Date.now() });
        res.setHeader('Set-Cookie', `ic_token=${token}; Path=/; HttpOnly; Max-Age=${SESSION_TTL / 1000}; SameSite=Lax`);
        console.log(`[用户] 新用户注册: ${newUser.username}`);
        res.json({
            success: true,
            data: { username: newUser.username, role: newUser.role, nickname: newUser.nickname },
        });
    } catch (err) {
        console.error('[API] /api/auth/register 错误:', err.message);
        res.status(500).json({ success: false, error: '注册失败: ' + err.message });
    }
});

/**
 * POST /api/auth/login - 登录
 * Body: { username, password }
 */
app.post('/api/auth/login', (req, res) => {
    try {
        const { username, password } = req.body || {};
        if (!username || !password) {
            return res.status(400).json({ success: false, error: '请输入账号和密码' });
        }
        const users = readUsers();
        const user = users.find(u => u.username === username.trim());
        if (!user) {
            return res.status(401).json({ success: false, error: '账号或密码错误' });
        }
        if (!verifyPassword(password, user.salt, user.passwordHash)) {
            return res.status(401).json({ success: false, error: '账号或密码错误' });
        }
        cleanExpiredSessions();
        const token = generateToken();
        sessions.set(token, { username: user.username, role: user.role, createdAt: Date.now() });
        res.setHeader('Set-Cookie', `ic_token=${token}; Path=/; HttpOnly; Max-Age=${SESSION_TTL / 1000}; SameSite=Lax`);
        console.log(`[用户] 登录成功: ${user.username} (${user.role})`);
        res.json({
            success: true,
            data: {
                username: user.username,
                role: user.role,
                nickname: user.nickname,
                // 供非浏览器客户端（微信小程序等）使用：Cookie 为 HttpOnly，前端无法读取
                token,
                expiresAt: Date.now() + SESSION_TTL,
            },
        });
    } catch (err) {
        console.error('[API] /api/auth/login 错误:', err.message);
        res.status(500).json({ success: false, error: '登录失败: ' + err.message });
    }
});

/**
 * POST /api/auth/logout - 登出
 */
app.post('/api/auth/logout', (req, res) => {
    const token = extractToken(req);
    if (token) sessions.delete(token);
    res.setHeader('Set-Cookie', 'ic_token=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax');
    res.json({ success: true });
});

/**
 * GET /api/auth/me - 获取当前登录用户信息
 */
app.get('/api/auth/me', optionalAuth, (req, res) => {
    if (!req.user) {
        return res.json({ success: true, data: null }); // 未登录
    }
    const users = readUsers();
    const user = users.find(u => u.username === req.user.username);
    res.json({
        success: true,
        data: user ? { username: user.username, role: user.role, nickname: user.nickname } : null,
    });
});

// === 用户管理 API（仅管理员） ===

/**
 * GET /api/admin/users - 获取所有用户列表
 */
app.get('/api/admin/users', requireAdmin, (req, res) => {
    const users = readUsers();
    const safeUsers = users.map(u => ({
        username: u.username,
        role: u.role,
        nickname: u.nickname,
        createdAt: u.createdAt,
    }));
    res.json({ success: true, data: { users: safeUsers } });
});

/**
 * POST /api/admin/users - 管理员添加用户
 * Body: { username, password, role, nickname? }
 */
app.post('/api/admin/users', requireAdmin, (req, res) => {
    try {
        const { username, password, role, nickname } = req.body || {};
        if (!username || typeof username !== 'string' || username.trim().length < 2 || username.trim().length > 20) {
            return res.status(400).json({ success: false, error: '账号长度需要2-20个字符' });
        }
        if (!/^[a-zA-Z0-9_\u4e00-\u9fa5]+$/.test(username.trim())) {
            return res.status(400).json({ success: false, error: '账号只能包含字母、数字、下划线或中文' });
        }
        if (!password || typeof password !== 'string' || password.length < 6 || password.length > 50) {
            return res.status(400).json({ success: false, error: '密码长度需要6-50个字符' });
        }
        if (!['admin', 'user'].includes(role)) {
            return res.status(400).json({ success: false, error: '角色只能是 admin 或 user' });
        }
        const users = readUsers();
        if (users.find(u => u.username === username.trim())) {
            return res.status(400).json({ success: false, error: '该账号已存在' });
        }
        const { salt, hash } = hashPassword(password);
        users.push({
            username: username.trim(),
            passwordHash: hash,
            salt,
            role,
            nickname: (nickname || username).trim().slice(0, 20),
            createdAt: new Date().toISOString(),
        });
        writeUsers(users);
        console.log(`[用户] 管理员添加用户: ${username.trim()} (${role})`);
        res.json({ success: true, data: { users: users.map(u => ({ username: u.username, role: u.role, nickname: u.nickname, createdAt: u.createdAt })) } });
    } catch (err) {
        console.error('[API] /api/admin/users POST 错误:', err.message);
        res.status(500).json({ success: false, error: '添加用户失败: ' + err.message });
    }
});

/**
 * POST /api/admin/users/update - 管理员修改用户信息
 * Body: { username, role?, nickname?, password? }
 */
app.post('/api/admin/users/update', requireAdmin, (req, res) => {
    try {
        const { username, role, nickname, password } = req.body || {};
        if (!username) return res.status(400).json({ success: false, error: '缺少用户名' });
        const users = readUsers();
        const user = users.find(u => u.username === username);
        if (!user) return res.status(404).json({ success: false, error: '用户不存在' });

        // 不允许修改最后一个管理员的角色为普通用户
        if (role === 'user' && user.role === 'admin') {
            const adminCount = users.filter(u => u.role === 'admin').length;
            if (adminCount <= 1) {
                return res.status(400).json({ success: false, error: '系统至少需要保留一个管理员' });
            }
        }

        if (role && ['admin', 'user'].includes(role)) user.role = role;
        if (nickname && typeof nickname === 'string') user.nickname = nickname.trim().slice(0, 20);
        if (password && typeof password === 'string' && password.length >= 6) {
            const { salt, hash } = hashPassword(password);
            user.salt = salt;
            user.passwordHash = hash;
        }
        writeUsers(users);
        // 如果修改了角色，需要更新该用户的 session
        for (const [token, session] of sessions) {
            if (session.username === username) {
                session.role = user.role;
            }
        }
        console.log(`[用户] 管理员更新用户: ${username}`);
        res.json({ success: true, data: { users: users.map(u => ({ username: u.username, role: u.role, nickname: u.nickname, createdAt: u.createdAt })) } });
    } catch (err) {
        console.error('[API] /api/admin/users/update 错误:', err.message);
        res.status(500).json({ success: false, error: '修改用户失败: ' + err.message });
    }
});

/**
 * POST /api/admin/users/delete - 管理员删除用户
 * Body: { username }
 */
app.post('/api/admin/users/delete', requireAdmin, (req, res) => {
    try {
        const { username } = req.body || {};
        if (!username) return res.status(400).json({ success: false, error: '缺少用户名' });
        // 不能删除自己
        if (username === req.user.username) {
            return res.status(400).json({ success: false, error: '不能删除自己的账号' });
        }
        let users = readUsers();
        const target = users.find(u => u.username === username);
        if (!target) return res.status(404).json({ success: false, error: '用户不存在' });
        // 不允许删除最后一个管理员
        if (target.role === 'admin') {
            const adminCount = users.filter(u => u.role === 'admin').length;
            if (adminCount <= 1) {
                return res.status(400).json({ success: false, error: '系统至少需要保留一个管理员' });
            }
        }
        users = users.filter(u => u.username !== username);
        writeUsers(users);
        // 清除该用户的 session
        for (const [token, session] of sessions) {
            if (session.username === username) sessions.delete(token);
        }
        console.log(`[用户] 管理员删除用户: ${username}`);
        res.json({ success: true, data: { users: users.map(u => ({ username: u.username, role: u.role, nickname: u.nickname, createdAt: u.createdAt })) } });
    } catch (err) {
        console.error('[API] /api/admin/users/delete 错误:', err.message);
        res.status(500).json({ success: false, error: '删除用户失败: ' + err.message });
    }
});

// ============================================================
// 静态文件
// ============================================================
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// API 路由（全部加 optionalAuth 以识别用户角色）
// ============================================================

/**
 * GET /api/indices - 获取全部指数数据
 * 参数: ?refresh=1 强制刷新缓存
 *        ?detail=1 返回完整数据（含10年K线historySeries）
 *        默认精简模式：不含 historySeries，响应体从 ~4.6MB → ~200KB
 */
app.get('/api/indices', async (req, res) => {
    try {
        const forceRefresh = req.query.refresh === '1';
        const detail = req.query.detail === '1';
        const data = await getCachedData(forceRefresh);
        if (!data) {
            return res.status(503).json({ error: '数据获取中，请稍后重试' });
        }
        // 精简模式：裁剪大体积字段
        let responseData = data;
        if (!detail) {
            responseData = {
                ...data,
                indices: (data.indices || []).map(idx => {
                    const { historySeries, ...rest } = idx;
                    return rest;
                }),
                dashboardIndices: (data.dashboardIndices || []).map(idx => {
                    const { historySeries, ...rest } = idx;
                    return rest;
                }),
            };
        }
        res.json({
            success: true,
            data: responseData,
            trading: isTradingHours(),
        });
    } catch (err) {
        console.error('[API] /api/indices 错误:', err.message);
        res.status(500).json({
            success: false,
            error: '数据获取失败: ' + err.message,
        });
    }
});

/**
 * GET /api/health - 健康检查
 */
app.get('/api/health', (req, res) => {
    const cacheStatus = {};
    for (const key of ['indices', 'index-quotes', 'active-funds', 'stocks', 'etfs', 'daily-eval']) {
        const c = _smartCache[key];
        cacheStatus[key] = c ? {
            age: Math.round((Date.now() - c.time) / 1000) + 's',
            ttl: Math.round(getCacheTTL(key) / 1000) + 's',
            fresh: (Date.now() - c.time) < getCacheTTL(key),
        } : 'empty';
    }
    res.json({
        status: 'ok',
        cached: !!cachedData,
        lastFetch: cachedData ? new Date(lastFetchTime).toISOString() : null,
        uptime: process.uptime().toFixed(0) + 's',
        trading: isTradingHours(),
        cache: cacheStatus,
    });
});

/**
 * GET /api/health/kline-sources - K 线源健康度快照（公开）
 * 返回 eastmoney / tencent / yahoo 三源的成功率、最近失败次数、最后成功/失败时间
 */
app.get('/api/health/kline-sources', (req, res) => {
    try {
        const snapshot = (typeof getKlineSourceHealthSnapshot === 'function')
            ? getKlineSourceHealthSnapshot()
            : null;
        res.json({
            success: true,
            snapshot,
            timestamp: new Date().toISOString(),
        });
    } catch (err) {
        res.status(500).json({ success: false, error: 'K 线源健康快照获取失败: ' + err.message });
    }
});

// ============================================================
// 指数 Watchlist API（搜索、添加、删除、实时行情）
// ============================================================

/**
 * GET /api/indices/quotes - 获取 watchlist 中指数的实时行情
 */
app.get('/api/indices/quotes', async (req, res) => {
    try {
        const data = await getCachedIndexQuotes(req.query.refresh === '1');
        res.json({
            success: true,
            data,
            trading: isTradingHours(),
        });
    } catch (err) {
        console.error('[API] /api/indices/quotes 错误:', err.message);
        res.status(500).json({ success: false, error: '获取指数行情失败: ' + err.message });
    }
});

/**
 * GET /api/indices/:code/klines - 按完整 code（含市场后缀）查询单个指数的 K 线
 *   - 路径参数 code：形如 'SPX.US' / '000300.SH' / 'HSTECH.HI'
 *   - 复用 fetchIndexHistory failover 链（东财 → 腾讯 → Yahoo）
 *   - 内存缓存命中时 <50ms 返回
 *   - 候选池外指数也支持（从 watchlist 动态构造 cfg）
 */
app.get('/api/indices/:code/klines', async (req, res) => {
    const fullCode = String(req.params.code || '').trim();
    if (!fullCode || !/^[A-Za-z0-9._-]{2,20}$/.test(fullCode)) {
        return res.status(400).json({ success: false, error: '非法 code 参数' });
    }
    try {
        // 1) 优先查 POOL_MAP（候选池内有完整 cfg）
        let cfg = POOL_MAP[fullCode];
        // 2) 否则从 watchlist 动态构造（用户搜索添加的非主流指数）
        if (!cfg) {
            const watchlist = readIndexWatchlist();
            const item = watchlist.find(i => `${i.code}.${i.market}` === fullCode);
            if (item) {
                cfg = {
                    name: item.name,
                    code: item.code,
                    market: item.market,
                    secid: item.secid,
                };
            }
        }
        if (!cfg) {
            // ─── 市场后缀模糊匹配：尝试常见后缀，取第一个成功返回 K 线的 ───
            const candidates = ['US', 'SH', 'SZ', 'HI', 'CSI'];
            const baseCode = fullCode.replace(/\.[A-Z]{2,5}$/, ''); // 去掉可能存在的后缀
            let fuzzyCfg = null;
            let fuzzyDetail = '';
            for (const mkt of candidates) {
                const tryFull = `${baseCode}.${mkt}`;
                if (POOL_MAP[tryFull]) {
                    fuzzyCfg = POOL_MAP[tryFull];
                    fuzzyDetail = `已匹配到预置指数池: ${tryFull}`;
                    console.log(`  [K线] 模糊匹配: ${fullCode} → ${tryFull}`);
                    break;
                }
            }
            // 同时尝试在 watchlist 中拼接后缀查找
            if (!fuzzyCfg) {
                const watchlist = readIndexWatchlist();
                for (const mkt of candidates) {
                    const tryFull = `${baseCode}.${mkt}`;
                    const item = watchlist.find(i => `${i.code}.${i.market}` === tryFull);
                    if (item) {
                        fuzzyCfg = {
                            name: item.name,
                            code: item.code,
                            market: item.market,
                            secid: item.secid,
                        };
                        fuzzyDetail = `已匹配到关注列表: ${item.name}(${tryFull})`;
                        console.log(`  [K线] watchlist 模糊匹配: ${fullCode} → ${tryFull}`);
                        break;
                    }
                }
            }
            if (fuzzyCfg) {
                cfg = fuzzyCfg;
            } else {
                return res.status(404).json({
                    success: false,
                    error: '指数不存在或不在关注列表',
                    detail: `无法匹配代码「${fullCode}」，请检查代码格式是否正确（如 SPX.US、000300.SH），或先将该指数添加到关注列表。`,
                });
            }
        }
        // 3) 调用 failover 链（支持 range 参数）
        const range = req.query.range || '1y';
        const result = await fetchIndexHistory(cfg, { range });
        const klines = result?.klines || [];
        const status = result?.status || {};

        if (klines.length === 0) {
            // 三方源全部失败 → 200 + success:false 让前端走 error 态
            const statusDetail = status?.label ? `（${status.label}）` : '（所有数据源均失败）';
            return res.json({
                success: false,
                error: 'K线数据暂时无法获取，请稍后重试',
                detail: `指数 ${fullCode} 的K线数据${statusDetail}。可能原因：数据源维护中、网络连接问题、或该指数无历史数据。`,
                data: { code: fullCode, source: 'none', status: status?.label || 'unknown' },
            });
        }

        return res.json({
            success: true,
            data: {
                code: fullCode,
                historySeries: klines,
                source: status.source || 'unknown',
                sourceLabel: status.label || '',
                stale: !!status.usedStaleCache,
                fetchedAt: new Date().toISOString(),
            },
        });
    } catch (err) {
        console.error(`[API] /api/indices/${fullCode}/klines 错误:`, err.message);
        res.status(500).json({ success: false, error: '获取K线失败: ' + err.message });
    }
});

/**
 * GET /api/indices/watchlist - 获取指数关注列表
 */
app.get('/api/indices/watchlist', (req, res) => {
    const indices = readIndexWatchlist();
    res.json({ success: true, data: { indices } });
});

/**
 * GET /api/indices/search?q=沪深300 - 搜索指数
 */
app.get('/api/indices/search', requireAuth, async (req, res) => {
    try {
        const keyword = typeof req.query.q === 'string' ? req.query.q.trim() : '';
        if (!keyword) return res.json({ success: true, data: { results: [] } });
        const results = await searchIndex(keyword);
        res.json({ success: true, data: { results } });
    } catch (err) {
        console.error('[API] /api/indices/search 错误:', err.message);
        res.status(500).json({ success: false, error: '搜索失败: ' + err.message });
    }
});

/**
 * POST /api/indices/add - 添加指数到关注列表
 * Body: { code, name, market, secid, category? }
 */
app.post('/api/indices/add', requireAuth, (req, res) => {
    try {
        const { code, name, market, secid, category } = req.body || {};
        if (!code || !name || !market || !secid) {
            return res.status(400).json({ success: false, error: '缺少必要参数（code, name, market, secid）' });
        }
        const indices = readIndexWatchlist();
        if (indices.find(idx => idx.code === code)) {
            return res.status(400).json({ success: false, error: `${name}(${code}) 已在关注列表中` });
        }
        if (indices.length >= 20) {
            return res.status(400).json({ success: false, error: '最多支持关注20个指数' });
        }
        // 从 POOL_MAP 获取图标信息，否则自动生成
        const poolKey = `${code}.${market}`;
        const poolCfg = POOL_MAP[poolKey];
        const preset = INDEX_ICON_PRESETS[indices.length % INDEX_ICON_PRESETS.length];
        const icon = poolCfg?.icon || name.replace(/[A-Za-z0-9\s指数]/g, '').slice(0, 2) || code.slice(0, 3);
        const newIndex = {
            name,
            code,
            market,
            secid,
            icon,
            iconBg: poolCfg?.iconBg || preset.bg,
            iconColor: poolCfg?.iconColor || preset.color,
            category: category || (market === 'US' ? 'broad-us' : market === 'HI' ? 'broad-hk' : 'broad-cn'),
        };
        indices.push(newIndex);
        writeIndexWatchlist(indices);
        // 失效 index-quotes 内存缓存，并异步强制刷新（磁盘缓存可能仍在 TTL 内，仅删内存会导致新增指数短期不可见）
        delete _smartCache['index-quotes'];
        getCachedIndexQuotes(true).catch(err => console.warn('[指数] 添加后行情缓存刷新失败:', err.message));
        console.log(`[指数] 添加关注: ${name}(${code})`);
        res.json({ success: true, data: { index: newIndex, total: indices.length } });
        // 异步预热新指数历史数据（fire-and-forget，不阻塞响应；失败由常规刷新周期自愈）
        fetchIndexHistory({ name, code, market, secid }, { range: '10y' })
            .then(r => console.log(`[指数] 新指数历史数据预热完成: ${name}(${code})，K线 ${r?.klines?.length || 0} 条`))
            .catch(err => console.warn(`[指数] 新指数历史数据预热失败: ${name}(${code}):`, err.message));
    } catch (err) {
        console.error('[API] /api/indices/add 错误:', err.message);
        res.status(500).json({ success: false, error: '添加失败: ' + err.message });
    }
});

/**
 * POST /api/indices/remove - 从关注列表移除指数
 * Body: { code }
 */
app.post('/api/indices/remove', requireAuth, (req, res) => {
    try {
        const { code } = req.body || {};
        if (!code) {
            return res.status(400).json({ success: false, error: '缺少指数代码' });
        }
        const indices = readIndexWatchlist();
        const idx = indices.findIndex(i => i.code === code);
        if (idx === -1) {
            return res.status(404).json({ success: false, error: '该指数不在关注列表中' });
        }
        const removed = indices.splice(idx, 1)[0];
        writeIndexWatchlist(indices);
        // 失效 index-quotes 内存缓存，并异步强制刷新（磁盘缓存可能仍在 TTL 内，仅删内存会导致被删指数短期残留）
        delete _smartCache['index-quotes'];
        getCachedIndexQuotes(true).catch(err => console.warn('[指数] 移除后行情缓存刷新失败:', err.message));
        console.log(`[指数] 移除关注: ${removed.name}(${code})`);
        res.json({ success: true, data: { removed: removed.name, total: indices.length } });
    } catch (err) {
        console.error('[API] /api/indices/remove 错误:', err.message);
        res.status(500).json({ success: false, error: '移除失败: ' + err.message });
    }
});

/**
 * POST /api/indices/reorder - 重排指数关注列表顺序（管理员）
 * Body: { codes: ['000001', '000300', ...] }
 */
app.post('/api/indices/reorder', requireAdmin, (req, res) => {
    try {
        const { codes } = req.body || {};
        if (!Array.isArray(codes)) {
            return res.status(400).json({ success: false, error: '缺少 codes 数组' });
        }
        const indices = readIndexWatchlist();
        const map = new Map(indices.map(i => [i.code, i]));
        const reordered = codes.map(c => map.get(c)).filter(Boolean);
        // 追加 codes 中未包含的项（防止遗漏）
        const codesSet = new Set(codes);
        indices.forEach(i => { if (!codesSet.has(i.code)) reordered.push(i); });
        writeIndexWatchlist(reordered);
        res.json({ success: true, data: { total: reordered.length } });
    } catch (err) {
        console.error('[API] /api/indices/reorder 错误:', err.message);
        res.status(500).json({ success: false, error: '排序失败: ' + err.message });
    }
});

// ============================================================
// 站点配置（登录开关等）
// ============================================================
const SITE_CONFIG_FILE = path.join(__dirname, 'data', 'site-config.json');
const SITE_CONFIG_DEFAULTS = { loginEnabled: true };

function readSiteConfig() {
    try {
        ensureDataDir();
        if (fs.existsSync(SITE_CONFIG_FILE)) {
            const raw = fs.readFileSync(SITE_CONFIG_FILE, 'utf8');
            return { ...SITE_CONFIG_DEFAULTS, ...JSON.parse(raw) };
        }
    } catch (err) {
        console.warn('[站点配置] 读取失败:', err.message);
    }
    return { ...SITE_CONFIG_DEFAULTS };
}

function writeSiteConfig(cfg) {
    ensureDataDir();
    fs.writeFileSync(SITE_CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
}

/**
 * GET /api/site-config - 获取站点公开配置（无需登录）
 */
app.get('/api/site-config', (req, res) => {
    const cfg = readSiteConfig();
    res.json({ success: true, data: { loginEnabled: cfg.loginEnabled } });
});

/**
 * POST /api/site-config - 更新站点配置（仅管理员）
 * Body: { loginEnabled: boolean }
 */
app.post('/api/site-config', requireAdmin, (req, res) => {
    try {
        const { loginEnabled } = req.body || {};
        const cfg = readSiteConfig();
        if (typeof loginEnabled === 'boolean') {
            cfg.loginEnabled = loginEnabled;
        }
        writeSiteConfig(cfg);
        console.log(`[站点配置] 登录功能: ${cfg.loginEnabled ? '开启' : '关闭'}`);
        res.json({ success: true, data: cfg });
    } catch (err) {
        console.error('[API] /api/site-config POST 错误:', err.message);
        res.status(500).json({ success: false, error: '保存配置失败: ' + err.message });
    }
});

/**
 * GET /api/datasources - 获取数据源配置
 */
app.get('/api/datasources', (req, res) => {
    const cfg = readDSConfig();
    res.json({
        success: true,
        data: cfg,
    });
});

/**
 * POST /api/datasources - 保存数据源配置
 * Body: { enabled: { "danjuan-wind": true, "tiantian": false, ... } }
 */
app.post('/api/datasources', requireAuth, (req, res) => {
    try {
        const { enabled } = req.body || {};
        if (!enabled || typeof enabled !== 'object') {
            return res.status(400).json({ success: false, error: '无效的数据源配置' });
        }
        // 校验: 只允许合法的 sourceId，值只能是 boolean
        const VALID_IDS = [
            'danjuan-wind', 'eastmoney', 'youzhiyouxing', 'tiantian',
            'etfrun', 'eniu', 'csindex', 'tencent',
        ];
        const sanitized = {};
        for (const id of VALID_IDS) {
            sanitized[id] = !!enabled[id];
        }
        // 内置数据源强制启用
        sanitized['danjuan-wind'] = true;
        sanitized['eastmoney'] = true;
        sanitized['youzhiyouxing'] = true;

        writeDSConfig({ enabled: sanitized });
        console.log(`[配置] 用户更新数据源配置: ${JSON.stringify(sanitized)}`);
        res.json({
            success: true,
            data: { enabled: sanitized },
        });
    } catch (err) {
        console.error('[API] /api/datasources POST 错误:', err.message);
        res.status(500).json({ success: false, error: '保存数据源配置失败: ' + err.message });
    }
});

/**
 * GET /api/daily-eval - 获取蛋卷基金(Wind)全量每日估值数据
 * 参数: ?refresh=1 强制刷新缓存
 */
app.get('/api/daily-eval', async (req, res) => {
    try {
        const forceRefresh = req.query.refresh === '1';
        const data = await getCachedDailyEval(forceRefresh);
        res.json({
            success: true,
            data,
        });
    } catch (err) {
        console.error('[API] /api/daily-eval 错误:', err.message);
        res.status(500).json({ success: false, error: '每日估值获取失败: ' + err.message });
    }
});

/**
 * POST /api/thermometer/refresh - 管理员强制刷新温度计缓存
 * 清空 _yzyxCache 与 _yzyxDetailCache 后立即重新抓取一次，
 * 返回最新 fetchedAt / 全市场温度 / 已更新的指数数量。
 */
app.post('/api/thermometer/refresh', requireAdmin, async (req, res) => {
    try {
        resetYZYXCache();
        const data = await fetchYZYXThermometer({ force: true });
        if (!data) {
            return res.status(502).json({
                success: false,
                error: '知有行温度计抓取失败，请稍后再试',
            });
        }
        return res.json({
            success: true,
            fetchedAt: data._meta?.fetchedAt || new Date().toISOString(),
            source: data._meta?.source || null,
            stale: !!data._meta?.stale,
            marketTemperature: data.marketTemperature ?? null,
            indexCount: Array.isArray(data.indices) ? data.indices.length : 0,
        });
    } catch (err) {
        console.error('[API] /api/thermometer/refresh 错误:', err.message);
        res.status(500).json({ success: false, error: '强制刷新失败: ' + err.message });
    }
});

/**
 * GET /api/thermometer/detail?code=000300.SH - 获取单个指数的温度详情
 */
app.get('/api/thermometer/detail', async (req, res) => {
    try {
        const rawCode = typeof req.query.code === 'string' ? req.query.code.trim().toUpperCase() : '';
        if (!/^[A-Z0-9.]{3,20}$/.test(rawCode)) {
            return res.status(400).json({
                success: false,
                error: '指数代码格式不合法',
            });
        }

        const detail = await fetchYZYXIndexDetail(rawCode);
        if (!detail) {
            // 知有行未覆盖的指数：返回 200 + 降级体，由前端展示"暂无温度数据"而非错误
            return res.json({
                success: true,
                data: {
                    supported: false,
                    code: rawCode,
                    message: '该指数暂无温度数据（数据源未覆盖）',
                },
            });
        }

        res.json({
            success: true,
            data: detail,
        });
    } catch (err) {
        console.error('[API] /api/thermometer/detail 错误:', err.message);
        res.status(500).json({
            success: false,
            error: '温度详情获取失败: ' + err.message,
        });
    }
});

// ============================================================
// 主动基金 API
// ============================================================

/**
 * GET /api/active-funds - 获取主动基金数据
 * 参数: ?refresh=1 强制刷新缓存
 */
/**
 * GET /api/active-funds - 获取主动基金数据
 * 参数: ?refresh=1 强制刷新缓存
 *        ?detail=1 返回完整数据（含全量净值走势）
 *        默认精简模式：不含 netWorthTrend/rankTrend/rankPercentTrend，响应体从 ~3.8MB → ~50KB
 */
app.get('/api/active-funds', async (req, res) => {
    try {
        const forceRefresh = req.query.refresh === '1';
        const detail = req.query.detail === '1';
        const data = await smartCacheGet('active-funds', () => fetchAllActiveFundData(forceRefresh), forceRefresh);
        if (!data) {
            return res.status(503).json({ error: '主动基金数据获取中，请稍后重试' });
        }
        let responseData = data;
        if (!detail && data.funds) {
            responseData = {
                ...data,
                funds: data.funds.map(fund => {
                    const { netWorthTrend, rankTrend, rankPercentTrend, grandTotal, scaleHistory, holderStructure, assetAllocation, buyRedemption, ...rest } = fund;
                    return rest;
                }),
            };
        }
        res.json({
            success: true,
            data: responseData,
        });
    } catch (err) {
        console.error('[API] /api/active-funds 错误:', err.message);
        res.status(500).json({
            success: false,
            error: '主动基金数据获取失败: ' + err.message,
        });
    }
});

/**
 * GET /api/active-funds/watchlist - 获取基金关注列表
 */
app.get('/api/active-funds/watchlist', (req, res) => {
    const funds = readFundWatchlist();
    res.json({ success: true, data: { funds } });
});

/**
 * POST /api/active-funds/add - 添加基金到关注列表
 * Body: { code: '163415', name: '兴全商业模式混合(LOF)A', shortName: '兴全商业模式' }
 */
app.post('/api/active-funds/add', requireAuth, (req, res) => {
    try {
        const { code, name, shortName, type, category } = req.body || {};
        if (!code || typeof code !== 'string' || !/^\d{6}$/.test(code.trim())) {
            return res.status(400).json({ success: false, error: '无效的基金代码（需为6位数字）' });
        }
        const funds = readFundWatchlist();
        if (funds.find(f => f.code === code.trim())) {
            return res.status(400).json({ success: false, error: '该基金已在关注列表中' });
        }
        if (funds.length >= 20) {
            return res.status(400).json({ success: false, error: '最多支持关注20只基金' });
        }
        const preset = ICON_PRESETS[funds.length % ICON_PRESETS.length];
        const sn = shortName || (name || '').replace(/[（(].+[）)]/, '').slice(0, 6) || code;
        // 自动分类：优先使用前端传入的 category，否则根据名称和类型自动判断
        const fundCategory = category || classifyFundCategory(name || '', type || '');
        funds.push({
            code: code.trim(),
            name: name || code.trim(),
            shortName: sn,
            icon: sn.slice(0, 2),
            iconBg: preset.iconBg,
            iconColor: preset.iconColor,
            category: fundCategory,
        });
        writeFundWatchlist(funds);
        console.log(`[严选基金] 添加关注: ${name || code} [${fundCategory === 'index' ? '指数' : '主动'}]`);
        res.json({ success: true, data: { funds } });
    } catch (err) {
        console.error('[API] /api/active-funds/add 错误:', err.message);
        res.status(500).json({ success: false, error: '添加基金失败: ' + err.message });
    }
});

/**
 * POST /api/active-funds/remove - 从关注列表删除基金
 * Body: { code: '163415' }
 */
app.post('/api/active-funds/remove', requireAuth, (req, res) => {
    try {
        const { code } = req.body || {};
        if (!code) {
            return res.status(400).json({ success: false, error: '缺少基金代码' });
        }
        let funds = readFundWatchlist();
        const before = funds.length;
        funds = funds.filter(f => f.code !== code.trim());
        if (funds.length === before) {
            return res.status(404).json({ success: false, error: '该基金不在关注列表中' });
        }
        writeFundWatchlist(funds);
        console.log(`[主动基金] 移除关注: ${code}`);
        res.json({ success: true, data: { funds } });
    } catch (err) {
        console.error('[API] /api/active-funds/remove 错误:', err.message);
        res.status(500).json({ success: false, error: '删除基金失败: ' + err.message });
    }
});

/**
 * POST /api/active-funds/reorder - 重排基金关注列表顺序（管理员）
 * Body: { codes: ['163415', ...] }
 */
app.post('/api/active-funds/reorder', requireAdmin, (req, res) => {
    try {
        const { codes } = req.body || {};
        if (!Array.isArray(codes)) {
            return res.status(400).json({ success: false, error: '缺少 codes 数组' });
        }
        const funds = readFundWatchlist();
        const map = new Map(funds.map(f => [f.code, f]));
        const reordered = codes.map(c => map.get(c)).filter(Boolean);
        const codesSet = new Set(codes);
        funds.forEach(f => { if (!codesSet.has(f.code)) reordered.push(f); });
        writeFundWatchlist(reordered);
        res.json({ success: true, data: { total: reordered.length } });
    } catch (err) {
        console.error('[API] /api/active-funds/reorder 错误:', err.message);
        res.status(500).json({ success: false, error: '排序失败: ' + err.message });
    }
});

/**
 * GET /api/active-funds/search?q=兴全 - 搜索基金
 */
app.get('/api/active-funds/search', requireAuth, async (req, res) => {
    try {
        const keyword = typeof req.query.q === 'string' ? req.query.q.trim() : '';
        if (!keyword) {
            return res.json({ success: true, data: { results: [] } });
        }
        const results = await searchFunds(keyword);
        res.json({ success: true, data: { results } });
    } catch (err) {
        console.error('[API] /api/active-funds/search 错误:', err.message);
        res.status(500).json({ success: false, error: '搜索失败: ' + err.message });
    }
});

// ============================================================
// 股票总览 API
// ============================================================

/**
 * GET /api/stocks - 获取关注股票实时行情
 * 参数: ?refresh=1 强制刷新缓存
 */
app.get('/api/stocks', async (req, res) => {
    try {
        const forceRefresh = req.query.refresh === '1';
        const data = await smartCacheGet('stocks', () => fetchAllStockData(forceRefresh), forceRefresh);
        if (!data) {
            return res.status(503).json({ error: '股票数据获取中，请稍后重试' });
        }
        res.json({
            success: true,
            data: data,
            trading: isTradingHours(),
        });
    } catch (err) {
        console.error('[API] /api/stocks 错误:', err.message);
        res.status(500).json({
            success: false,
            error: '股票数据获取失败: ' + err.message,
        });
    }
});

/**
 * GET /api/stocks/watchlist - 获取关注列表配置
 */
app.get('/api/stocks/watchlist', (req, res) => {
    const stocks = readWatchlist();
    res.json({
        success: true,
        data: { stocks },
    });
});

/**
 * POST /api/stocks/watchlist - 更新关注列表
 * Body: { stocks: [{ name, code, market, secid, icon, iconBg, iconColor, sector }] }
 */
app.post('/api/stocks/watchlist', requireAuth, (req, res) => {
    try {
        const { stocks } = req.body || {};
        if (!Array.isArray(stocks) || stocks.length === 0) {
            return res.status(400).json({ success: false, error: '至少需要关注一只股票' });
        }
        if (stocks.length > 20) {
            return res.status(400).json({ success: false, error: '最多支持关注20只股票' });
        }
        // 校验每只股票的必填字段
        const validStocks = stocks.filter(s =>
            s && typeof s.name === 'string' && typeof s.code === 'string' &&
            typeof s.market === 'string' && typeof s.secid === 'string'
        );
        if (validStocks.length === 0) {
            return res.status(400).json({ success: false, error: '没有有效的股票数据' });
        }
        writeWatchlist(validStocks);
        console.log(`[配置] 用户更新股票关注列表: ${validStocks.map(s => s.name).join(', ')}`);
        res.json({
            success: true,
            data: { stocks: validStocks },
        });
    } catch (err) {
        console.error('[API] /api/stocks/watchlist POST 错误:', err.message);
        res.status(500).json({ success: false, error: '保存关注列表失败: ' + err.message });
    }
});

/**
 * GET /api/stocks/search - 搜索股票
 * 参数: ?q=关键词
 */
app.get('/api/stocks/search', requireAuth, async (req, res) => {
    try {
        const q = (req.query.q || '').trim();
        if (!q) {
            return res.json({ success: true, data: { results: [] } });
        }
        const results = await searchStock(q);
        res.json({ success: true, data: { results } });
    } catch (err) {
        console.error('[API] /api/stocks/search 错误:', err.message);
        res.status(500).json({ success: false, error: '搜索失败: ' + err.message });
    }
});

/**
 * POST /api/stocks/add - 添加单只股票到关注列表
 * Body: { code, name, market, secid, sector? }
 */
app.post('/api/stocks/add', requireAuth, (req, res) => {
    try {
        const { code, name, market, secid, sector } = req.body || {};
        if (!code || !name || !market || !secid) {
            return res.status(400).json({ success: false, error: '缺少必要参数（code, name, market, secid）' });
        }
        if (!/^\d{6}$/.test(code)) {
            return res.status(400).json({ success: false, error: '无效的股票代码' });
        }
        const stocks = readWatchlist();
        if (stocks.find(s => s.code === code)) {
            return res.status(400).json({ success: false, error: `${name}(${code}) 已在关注列表中` });
        }
        if (stocks.length >= 20) {
            return res.status(400).json({ success: false, error: '最多支持关注20只股票' });
        }
        const iconInfo = generateStockIcon(name, code);
        const newStock = {
            name, code, market, secid,
            icon: iconInfo.icon, iconBg: iconInfo.iconBg, iconColor: iconInfo.iconColor,
            sector: sector || guessStockSector(name),
        };
        stocks.push(newStock);
        writeWatchlist(stocks);
        console.log(`[配置] 用户添加股票: ${name}(${code})`);
        res.json({ success: true, data: { stock: newStock, total: stocks.length } });
    } catch (err) {
        console.error('[API] /api/stocks/add 错误:', err.message);
        res.status(500).json({ success: false, error: '添加失败: ' + err.message });
    }
});

/**
 * POST /api/stocks/remove - 从关注列表移除股票
 * Body: { code }
 */
app.post('/api/stocks/remove', requireAuth, (req, res) => {
    try {
        const { code } = req.body || {};
        if (!code) {
            return res.status(400).json({ success: false, error: '缺少股票代码' });
        }
        const stocks = readWatchlist();
        const idx = stocks.findIndex(s => s.code === code);
        if (idx === -1) {
            return res.status(404).json({ success: false, error: '该股票不在关注列表中' });
        }
        const removed = stocks.splice(idx, 1)[0];
        writeWatchlist(stocks);
        console.log(`[配置] 用户移除股票: ${removed.name}(${code})`);
        res.json({ success: true, data: { removed: removed.name, total: stocks.length } });
    } catch (err) {
        console.error('[API] /api/stocks/remove 错误:', err.message);
        res.status(500).json({ success: false, error: '移除失败: ' + err.message });
    }
});

/**
 * POST /api/stocks/reorder - 重排股票关注列表顺序（管理员）
 * Body: { codes: ['600519', ...] }
 */
app.post('/api/stocks/reorder', requireAdmin, (req, res) => {
    try {
        const { codes } = req.body || {};
        if (!Array.isArray(codes)) {
            return res.status(400).json({ success: false, error: '缺少 codes 数组' });
        }
        const stocks = readWatchlist();
        const map = new Map(stocks.map(s => [s.code, s]));
        const reordered = codes.map(c => map.get(c)).filter(Boolean);
        const codesSet = new Set(codes);
        stocks.forEach(s => { if (!codesSet.has(s.code)) reordered.push(s); });
        writeWatchlist(reordered);
        res.json({ success: true, data: { total: reordered.length } });
    } catch (err) {
        console.error('[API] /api/stocks/reorder 错误:', err.message);
        res.status(500).json({ success: false, error: '排序失败: ' + err.message });
    }
});

// ============================================================
// ETF 总览 API
// ============================================================

/**
 * GET /api/etfs - 获取关注 ETF 实时行情
 * 参数: ?refresh=1 强制刷新缓存
 */
app.get('/api/etfs', async (req, res) => {
    try {
        const forceRefresh = req.query.refresh === '1';
        const data = await smartCacheGet('etfs', () => fetchAllETFData(forceRefresh), forceRefresh);
        if (!data) {
            return res.status(503).json({ error: 'ETF数据获取中，请稍后重试' });
        }
        res.json({
            success: true,
            data: data,
            trading: isTradingHours(),
        });
    } catch (err) {
        console.error('[API] /api/etfs 错误:', err.message);
        res.status(500).json({
            success: false,
            error: 'ETF数据获取失败: ' + err.message,
        });
    }
});

/**
 * GET /api/etfs/watchlist - 获取 ETF 关注列表
 */
app.get('/api/etfs/watchlist', (req, res) => {
    const etfs = readEtfWatchlist();
    res.json({ success: true, data: { etfs } });
});

/**
 * POST /api/etfs/add - 添加 ETF 到关注列表
 * Body: { code, name, market, secid, category }
 */
app.post('/api/etfs/add', requireAuth, (req, res) => {
    try {
        const { code, name, market, secid, category } = req.body || {};
        if (!code || typeof code !== 'string' || !/^\d{6}$/.test(code.trim())) {
            return res.status(400).json({ success: false, error: '无效的ETF代码（需为6位数字）' });
        }
        if (!market || !secid) {
            return res.status(400).json({ success: false, error: '缺少市场或secid信息' });
        }
        const etfs = readEtfWatchlist();
        if (etfs.find(e => e.code === code.trim())) {
            return res.status(400).json({ success: false, error: '该ETF已在关注列表中' });
        }
        if (etfs.length >= 20) {
            return res.status(400).json({ success: false, error: '最多支持关注20只ETF' });
        }
        const preset = ETF_ICON_PRESETS[etfs.length % ETF_ICON_PRESETS.length];
        const sn = (name || '').replace(/ETF$/i, '').replace(/[（(].+[）)]/, '').slice(0, 4) || code;
        etfs.push({
            code: code.trim(),
            name: name || code.trim(),
            market: market.trim(),
            secid: secid.trim(),
            icon: sn.slice(0, 2),
            iconBg: preset.iconBg,
            iconColor: preset.iconColor,
            category: category || 'ETF',
        });
        writeEtfWatchlist(etfs);
        console.log(`[ETF] 添加关注: ${name || code}`);
        res.json({ success: true, data: { etfs } });
    } catch (err) {
        console.error('[API] /api/etfs/add 错误:', err.message);
        res.status(500).json({ success: false, error: '添加ETF失败: ' + err.message });
    }
});

/**
 * POST /api/etfs/remove - 从关注列表删除 ETF
 * Body: { code }
 */
app.post('/api/etfs/remove', requireAuth, (req, res) => {
    try {
        const { code } = req.body || {};
        if (!code) {
            return res.status(400).json({ success: false, error: '缺少ETF代码' });
        }
        let etfs = readEtfWatchlist();
        const before = etfs.length;
        etfs = etfs.filter(e => e.code !== code.trim());
        if (etfs.length === before) {
            return res.status(404).json({ success: false, error: '该ETF不在关注列表中' });
        }
        writeEtfWatchlist(etfs);
        console.log(`[ETF] 移除关注: ${code}`);
        res.json({ success: true, data: { etfs } });
    } catch (err) {
        console.error('[API] /api/etfs/remove 错误:', err.message);
        res.status(500).json({ success: false, error: '删除ETF失败: ' + err.message });
    }
});

/**
 * POST /api/etfs/reorder - 重排ETF关注列表顺序（管理员）
 * Body: { codes: ['510300', ...] }
 */
app.post('/api/etfs/reorder', requireAdmin, (req, res) => {
    try {
        const { codes } = req.body || {};
        if (!Array.isArray(codes)) {
            return res.status(400).json({ success: false, error: '缺少 codes 数组' });
        }
        const etfs = readEtfWatchlist();
        const map = new Map(etfs.map(e => [e.code, e]));
        const reordered = codes.map(c => map.get(c)).filter(Boolean);
        const codesSet = new Set(codes);
        etfs.forEach(e => { if (!codesSet.has(e.code)) reordered.push(e); });
        writeEtfWatchlist(reordered);
        res.json({ success: true, data: { total: reordered.length } });
    } catch (err) {
        console.error('[API] /api/etfs/reorder 错误:', err.message);
        res.status(500).json({ success: false, error: '排序失败: ' + err.message });
    }
});

/**
 * GET /api/etfs/search?q=沪深300 - 搜索 ETF
 */
app.get('/api/etfs/search', requireAuth, async (req, res) => {
    try {
        const keyword = typeof req.query.q === 'string' ? req.query.q.trim() : '';
        if (!keyword) {
            return res.json({ success: true, data: { results: [] } });
        }
        const results = await searchETF(keyword);
        res.json({ success: true, data: { results } });
    } catch (err) {
        console.error('[API] /api/etfs/search 错误:', err.message);
        res.status(500).json({ success: false, error: '搜索失败: ' + err.message });
    }
});

/**
 * GET /api/etfs/minute?secid=1.510300 - 获取 ETF 分时数据
 */
app.get('/api/etfs/minute', async (req, res) => {
    try {
        const secid = typeof req.query.secid === 'string' ? req.query.secid.trim() : '';
        if (!/^\d\.\d{6}$/.test(secid)) {
            return res.status(400).json({ success: false, error: '无效的secid格式' });
        }
        const data = await fetchETFMinuteData(secid);
        res.json({ success: true, data });
    } catch (err) {
        console.error('[API] /api/etfs/minute 错误:', err.message);
        res.status(500).json({ success: false, error: '分时数据获取失败: ' + err.message });
    }
});

/**
 * GET /api/etfs/klines?secid=1.510300&code=510300&market=SH&range=1y
 */
app.get('/api/etfs/klines', async (req, res) => {
    try {
        const secid = typeof req.query.secid === 'string' ? req.query.secid.trim() : '';
        const code = typeof req.query.code === 'string' ? req.query.code.trim() : '';
        const market = typeof req.query.market === 'string' ? req.query.market.trim() : '';
        const range = typeof req.query.range === 'string' ? req.query.range.trim() : '1y';
        if (!/^\d\.\d{6}$/.test(secid)) {
            return res.status(400).json({ success: false, error: '无效的secid格式' });
        }
        if (!['1y', '3y', '5y'].includes(range)) {
            return res.status(400).json({ success: false, error: '无效的范围' });
        }
        const klines = await fetchETFKlinesForRange(secid, code, market, range);
        res.json({ success: true, data: { klines, range } });
    } catch (err) {
        console.error('[API] /api/etfs/klines 错误:', err.message);
        res.status(500).json({ success: false, error: 'K线数据获取失败: ' + err.message });
    }
});


// SPA fallback
app.get('*', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============================================================
// 启动服务器
// ============================================================
app.listen(PORT, () => {
    console.log('');
    console.log('  ╔══════════════════════════════════════════╗');
    console.log('  ║                                          ║');
    console.log('  ║     大乐罗盘 · Dale Compass              ║');
    console.log('  ║     个人投资分析罗盘                       ║');
    console.log('  ║                                          ║');
    console.log(`  ║     🌐 http://localhost:${PORT}              ║`);
    console.log('  ║                                          ║');
    console.log('  ╚══════════════════════════════════════════╝');
    console.log('');
    console.log('  数据源: 雪球基金(Wind) + 动态可用估值网站 + 东方财富行情 + 知有行');
    console.log('  指数: 配置保存于 data/index-watchlist.json，在指数行情页的指数实时行情面板管理');
    console.log('  股票: 支持关注个股实时行情，配置保存于 data/stock-watchlist.json');
    console.log('  缓存策略: 5分钟自动刷新，配置变更自动失效，支持手动强制刷新');
    console.log('');

    // 初始化股票关注列表
    ensureWatchlist();

    // 初始化默认管理员账户
    ensureDefaultAdmin();

    // ============================================================
    // 启动预加载：先加载磁盘缓存（秒开），再后台并行刷新所有数据
    // ============================================================
    const preloadStart = Date.now();
    let diskCacheHits = 0;

    // Phase 1: 加载磁盘缓存到内存（同步，毫秒级）
    const cacheKeys = ['indices', 'index-quotes', 'active-funds', 'stocks', 'etfs', 'daily-eval'];
    for (const key of cacheKeys) {
        const disk = readDiskCache(key);
        if (disk) {
            _smartCache[key] = disk;
            diskCacheHits++;
        }
    }
    if (_smartCache['indices']) {
        cachedData = _smartCache['indices'].data;
        lastFetchTime = _smartCache['indices'].time;
    }
    const phase1Time = Date.now() - preloadStart;
    console.log(`[启动] Phase 1: 加载磁盘缓存完成 (${phase1Time}ms)，命中 ${diskCacheHits}/${cacheKeys.length} 个缓存`);
    if (diskCacheHits > 0) {
        console.log('[启动] 服务已就绪（使用磁盘缓存秒开），后台刷新数据中...');
    }

    // Phase 2: 后台异步刷新（K 线优先 + 其他并发）
    (async () => {
        try {
            const refreshStart = Date.now();
            console.log('[启动] Phase 2: 开始后台数据刷新（K 线优先）...');

            // Phase 2a: 优先 await K 线（indices.json）刷新
            // 关键：fetchIndexQuotesForWatchlist 内部读 indices.json 计算美股动量/Sparkline，
            // 必须先确保 indices.json 是当日最新快照，避免冷启动窗口数据陈旧
            const phase2aStart = Date.now();
            try {
                await getCachedData(true);
                const phase2aTime = ((Date.now() - phase2aStart) / 1000).toFixed(1);
                console.log(`[启动] Phase 2a: K 线优先刷新完成 (${phase2aTime}s) ✅ 指数完整数据`);
            } catch (err) {
                console.warn(`[启动] Phase 2a: K 线刷新失败（继续 Phase 2b）:`, err.message);
            }

            // Phase 2b: 其他 5 类数据并发刷新
            const phase2bStart = Date.now();
            const results = await Promise.allSettled([
                getCachedIndexQuotes(true).then(() => console.log('  [预加载] ✅ 指数实时行情')),
                smartCacheGet('active-funds', () => fetchAllActiveFundData(true), true).then(() => console.log('  [预加载] ✅ 严选基金')),
                smartCacheGet('stocks', () => fetchAllStockData(true), true).then(() => console.log('  [预加载] ✅ 股票行情')),
                smartCacheGet('etfs', () => fetchAllETFData(true), true).then(() => console.log('  [预加载] ✅ ETF行情')),
                getCachedDailyEval(true).then(() => console.log('  [预加载] ✅ 每日估值')),
            ]);

            const succeeded = results.filter(r => r.status === 'fulfilled').length;
            const failed = results.filter(r => r.status === 'rejected');
            const phase2bTime = ((Date.now() - phase2bStart) / 1000).toFixed(1);
            const refreshTime = ((Date.now() - refreshStart) / 1000).toFixed(1);

            console.log(`[启动] Phase 2b: 其他数据并发刷新完成 (${phase2bTime}s)，成功 ${succeeded}/${results.length}`);
            console.log(`[启动] Phase 2 总耗时 ${refreshTime}s`);
            if (failed.length > 0) {
                failed.forEach(r => console.warn('  [预加载] ❌ 失败:', r.reason?.message || r.reason));
            }
        } catch (err) {
            console.warn('[启动] Phase 2: 后台刷新出错:', err.message);
        }
    })();

    // 启动 K 线源健康监控（每 30 分钟聚合检查一次）
    try {
        if (typeof startKlineSourceHealthMonitor === 'function') {
            startKlineSourceHealthMonitor();
            console.log('[启动] K 线源健康监控已启动（30 分钟检查间隔）');
        }
    } catch (e) {
        console.warn('[启动] K 线源健康监控启动失败:', e.message);
    }
});
