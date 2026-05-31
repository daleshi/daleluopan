## Context

**当前现状（实测代码定位）：**

```
public/index.html:9906  loadIndexQuotes(forceRefresh = false) {
public/index.html:9913    const res = await fetch('/api/indices/quotes');  ← 参数被吞掉 ❌
public/index.html:10253 removeIndexFromPanel() → loadIndexQuotes(true)
                                                  实际 fetch 不带 ?refresh=1
                                                  → 命中后端缓存 → 旧数据返回

services/stockFetcher.js:665 isTradingHours() {
  // 仅判断 A 股 9:15-15:05，无视港股/美股
}

server.js:248 getCacheTTL('index-quotes') {
  return trading ? 30s : 30min;  ← trading 仅看 A 股
}

server.js:999  POST /api/indices/reorder  ← 后端早就实现 ✅
public/index.html:initCardDnD(grid, 'etf'|'stock')  ← 拖拽框架已就绪 ✅
public/index.html:initFundDnD()                     ← 基金拖拽实现 ✅
public/index.html:.drag-handle / .card-dragging / .card-drag-over  ← CSS 已存在 ✅
但指数面板：完全没接通 ❌
```

**约束：**
- 不能修改 watchlist 数据结构（每条仍是 `{name, code, market, secid, icon, iconBg, iconColor, category}`）
- 不能新增 cache 键
- 不能修改其他业务的 `isTradingHours()` 调用语义（保持向后兼容）
- 不能引入新依赖（拖拽继续用原生 HTML5 DnD API）

## Goals / Non-Goals

**Goals:**
- 删除指数后 UI 立即生效（< 100ms）
- 美股 / 港股开盘时段 index-quotes TTL = 30 秒（与 A 股一致）
- 指数卡片可通过拖拽调整顺序，顺序持久化到 watchlist
- 复用现有 DnD 与 CSS 基础设施，零新增视觉资产

**Non-Goals:**
- 不实现"专门的排序管理列表页"（用户问"列表 vs 拖拽"，明确选择拖拽）
- 不修改其他业务 Tab（基金/ETF/股票/策略 Tab）的拖拽行为
- 不实现"按涨跌幅 / 名称排序"等自动排序功能（与拖拽冲突）
- 不实现拖拽顺序的"撤销"功能（每次拖拽都直接持久化）
- 不实现夜间美股盘前盘后的精确时段（21:30-05:00 已涵盖正常盘 + 缓冲）
- 不重写 `loadIndexQuotes` / `renderIndexQuotesGrid` 的整体架构（仅打补丁）

## Decisions

### 决策 1：删除问题用"乐观更新 + 后端缓存失效"双保险

**选择**：

```js
async function removeIndexFromPanel(code, name) {
    if (!authUser) return;
    if (!confirm(...)) return;
    try {
        const res = await fetch('/api/indices/remove', {...});
        const json = await res.json();
        if (!json.success) throw new Error(json.error);

        // ① 乐观更新：立即从本地状态移除
        indexQuotesData = indexQuotesData.filter(i => i.code !== code);
        renderIndexQuotesGrid({ indices: indexQuotesData, updateTime: _lastIndexUpdateTime });

        // ② 后台强刷（不 await）
        loadIndexQuotes(true);
    } catch (err) { alert('移除失败: ' + err.message); }
}
```

加上后端缓存失效：

```js
// server.js POST /api/indices/remove 路由
removeIndexFromWatchlist(code);
delete _smartCache['index-quotes'];   // ← 新增：失效内存缓存
res.json({ success: true });
```

**否决方案 A**：仅修 `loadIndexQuotes` 传 `?refresh=1` → 后端 forceRefresh 已实现，但仍要等网络往返；用户感知"卡顿"
**否决方案 B**：仅做乐观更新 → 若用户切 Tab 再切回来，可能重新读到旧缓存 → 必须配合后端缓存失效

**为什么需要后端 `delete _smartCache`**：watchlist 文件改了但内存缓存没动，`smartCacheGet` 返回缓存中的旧 indices.length

### 决策 2：扩展 isTradingHours 为多市场感知 — 向后兼容

**选择**：

```js
// services/stockFetcher.js
function isTradingHours(markets) {
    // 向后兼容：无参数 → 仅判断 A 股（保留旧语义）
    if (markets === undefined) return _isCNTrading();

    // 新增：传入市场数组 → 任一市场开盘则返回 true
    if (Array.isArray(markets)) {
        if (markets.includes('CN') && _isCNTrading()) return true;
        if (markets.includes('HK') && _isHKTrading()) return true;
        if (markets.includes('US') && _isUSTrading()) return true;
        return false;
    }
    // 单字符串：仅检查该市场
    if (typeof markets === 'string') return isTradingHours([markets]);
    return false;
}

function _isCNTrading() { /* 周一~周五 09:15-15:05 */ }
function _isHKTrading() { /* 周一~周五 09:30-12:00 + 13:00-16:10 */ }
function _isUSTrading() {
    // 简化：北京时间周一~周六 21:30-次日 05:00
    // 涵盖夏令时(21:30-04:00) + 冬令时(22:30-05:00) + 30min 缓冲
}
```

**为什么用"北京时间窗口"而非 IANA 时区计算**：
- 项目无新依赖政策；用 `Date.getDay/getHours` 即可
- 30min 缓冲对短 TTL（30s）影响微小（缓存最多多刷新几次）
- 夏令时切换每年仅 2 次，简化方案足够稳健

**`getCacheTTL('index-quotes')` 改造**：

```js
function getCacheTTL(key) {
    if (key === 'index-quotes') {
        // 基于当前 watchlist 包含的市场动态判定
        const markets = _detectIndexWatchlistMarkets();
        const trading = isTradingHours(markets);
        return trading ? CACHE_TTL_INDEX_QUOTES_TRADING : CACHE_TTL_INDEX_QUOTES_CLOSED;
    }
    // ... 其他保持现状
}

function _detectIndexWatchlistMarkets() {
    try {
        const w = readIndexWatchlist();
        const set = new Set();
        for (const i of w) {
            if (i.market === 'SH' || i.market === 'SZ' || i.market === 'CSI') set.add('CN');
            else if (i.market === 'HI' || i.market === 'HK') set.add('HK');
            else if (i.market === 'US') set.add('US');
        }
        return [...set];
    } catch { return ['CN']; } // 兜底
}
```

**否决方案**：硬编码 `markets = ['CN','HK','US']` 始终全开盘检查 → 用户若仅关注 A 股，夜间美股盘中也会高频刷新 → 浪费请求

### 决策 3：拖拽实现 — 复用 initCardDnD + 新增 'index' 分支

**选择**：直接修改现有 `initCardDnD(grid, type)`：

```js
const endpointMap = {
    etf:   '/api/etfs/reorder',
    stock: '/api/stocks/reorder',
    index: '/api/indices/reorder',  // ← 新增
};
const codeAttrMap = {
    etf:   'etfCode',
    stock: 'stockCode',
    index: 'code',  // ← 新增（注意：不是 indexCode，因为 buildIndexQuoteCard 已用 data-code）
};
```

**关键**：`buildIndexQuoteCard` 已经使用 `data-code="${idx.code}"`（行 10054 附近），无需改动。只需在管理员登录时加 `draggable="true"`。

**为什么不新建 `initIndexDnD`**：与 ETF/股票完全同构，复用 = 减少重复代码。

**注意 `code` 在 watchlist 内不带后缀（"NDX" 而非 "NDX.US"）**：第 11934 行有 `raw.replace(/\.(SH|SZ|BJ)$/i, '')` 兜底剥离，对指数无副作用。

### 决策 4：拖拽属性 — 仅管理员可见 + 仅管理员可拖

**选择**：

```js
function buildIndexQuoteCard(idx) {
    const isAdmin = authUser && authUser.role === 'admin';
    const draggableAttr = isAdmin ? 'draggable="true"' : '';
    const dragHandle = isAdmin ? '<div class="drag-handle" title="拖拽排序">⠿</div>' : '';
    const fullCode = idx.code + '.' + idx.market;
    let html = `<div class="idx-summary-card ${cardClass}" data-code="${idx.code}" ${draggableAttr} onclick="openIdxDetailModal('${fullCode}')">
        ${dragHandle}
        <div class="idx-card-basic">
            ...
        </div>
    </div>`;
}
```

CSS 已自带 `body.role-admin .drag-handle { display: flex; }` 控制可见性，但保险起见，HTML 层也判断（避免 admin 角色切换时 stale DOM）。

### 决策 5：拖拽与轮询的协调

**问题**：`renderIndexQuotesGrid` 增量 diff 路径在轮询时会基于 `indexQuotesData` 顺序重排 DOM。如果拖拽刚改了 DOM 顺序但 `indexQuotesData` 未同步，下次轮询会"还原"。

**解决**：拖拽 drop 事件中**同步更新 `indexQuotesData`**：

```js
grid.addEventListener('drop', e => {
    // ... 重排 DOM
    // 关键：同时更新 indexQuotesData 顺序
    const newOrder = Array.from(grid.children)
        .map(el => el.dataset.code)
        .filter(Boolean);
    const codeMap = new Map(indexQuotesData.map(i => [i.code, i]));
    indexQuotesData = newOrder.map(c => codeMap.get(c)).filter(Boolean);
    // ... 调用 reorder API
});
```

这样下次轮询用 `indexQuotesData` 重渲染时顺序保持。

### 决策 6：拖拽 + Tab 分类的协同

**思考**：`index-quotes-market-tabs` change 已实现"全部 / A股 / 港股 / 美股" Tab 过滤。在"A股 Tab"下拖拽两个卡片 → 应该只影响这两个的相对顺序，不能让美股指数顺序错乱。

**选择**：

```js
// 拖拽完成时，只重排"当前可见"集合（即过滤后的 visible 子集）
// 然后用新的子集顺序，回写到完整 indexQuotesData：
//   保持其他市场指数的相对位置不变，仅替换"当前 Tab 内"指数的顺序

const visibleNew = Array.from(grid.children).map(el => el.dataset.code);
const visibleSet = new Set(visibleNew);
// 在原 indexQuotesData 中按"原顺序"找出第一个 visible 元素的位置
let insertIdx = 0;
const result = [];
for (const item of indexQuotesData) {
    if (visibleSet.has(item.code)) {
        // 跳过：稍后按 visibleNew 顺序插入
    } else {
        result.push(item);
    }
}
// 把 visibleNew 顺序的元素插入第一个原 visible 元素的位置
const firstVisibleOrigIdx = indexQuotesData.findIndex(i => visibleSet.has(i.code));
const codeMap = new Map(indexQuotesData.map(i => [i.code, i]));
const insertItems = visibleNew.map(c => codeMap.get(c)).filter(Boolean);
result.splice(firstVisibleOrigIdx, 0, ...insertItems);
indexQuotesData = result;
```

**否决方案**：拖拽全部基于全集 → Tab 过滤后用户只能看到本市场卡片，但拖拽影响隐藏的其他市场顺序，反直觉。

### 决策 7：避免重复绑定

`renderIndexQuotesGrid` 在每次轮询都被调用，不能每次都 `addEventListener`，否则导致同一事件被多次触发。

**选择**：

```js
let _indexDnDInitialized = false;
function setupIndexDnDOnce() {
    if (_indexDnDInitialized) return;
    const grid = document.getElementById('indexSummaryGrid');
    if (!grid) return;
    initCardDnD(grid, 'index');
    _indexDnDInitialized = true;
}
// 在 renderIndexQuotesGrid 末尾调用 setupIndexDnDOnce()
```

`initCardDnD` 用事件委托（addEventListener 在 grid 上），即使后续卡片被增量重渲染，事件仍能正常触发。

## Risks / Trade-offs

- **[Risk] 美股 21:30-05:00 缓冲窗口与真实开盘前后差异** → 真实开盘前 30 分钟也会按 30s TTL 刷新
  → **Mitigation**：30s 内浪费请求 = 30 次 / 半小时 = 60 次/天，对外部源压力可忽略；换取夏令时切换不踩坑

- **[Risk] 删除指数时若用户网络慢，乐观 UI 已移除但 API 失败** → UI 与服务器不一致
  → **Mitigation**：API 失败时 `alert` + 重新 `loadIndexQuotes(true)` 强刷恢复正确状态

- **[Risk] 拖拽 + 轮询并发：用户拖拽中正好轮询返回** → 卡片位置闪跳
  → **Mitigation**：现有代码已有 `isDraggingCard` 标志，在拖拽中时增量 diff 跳过位置调整（**这是已有逻辑**，无需新增）

- **[Risk] Tab 切换时 grid 内容变化，绑定的事件委托是否还工作** → 已用 grid 作为委托宿主，children 增删不影响

- **[Risk] CSS `.drag-handle` 现有定位是 `position: absolute; top: 8px; left: 8px;`，可能与指数卡片右上角的 × 删除按钮冲突**
  → 已确认：删除按钮在 `top: 6px; right: 6px;`，drag-handle 在左上角，无视觉冲突

- **[Trade-off] 拖拽完成后立即调用 reorder API，无 debounce**
  → 接受：低频操作（用户不会快速连续拖拽 10 次），无优化必要

## Open Questions

- **Q：移动端是否需要长按拖拽？**
  → 暂不实现；HTML5 DnD 在移动端体验差，且管理员通常用桌面端调整顺序
  → 如未来强需要可单开 change 引入 `Pointer Events` + 长按检测

- **Q：是否要在「关于本站」或「设置」页加一个"重置指数顺序"按钮？**
  → 暂不做；用户通过拖拽即可调整，删除指数也会自然影响顺序
