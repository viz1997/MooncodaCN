# 链接订单页 `/p/[token]` — 功能文档

> 范围：ToC 用户从分享链接进入的定制订单页（区别于免登录 `/image-gen`）。
> 本文档面向**维护者**：状态机、组件职责、数据流、API 边界、关键交互。

---

## 1. 入口与场景

| 项 | 值 |
|---|---|
| 路由 | `/p/[token]` |
| 服务方生成 token | `prompt_order.token`（nanoid）|
| 用户身份 | **不需要登录**（链接即身份；token 是不透明凭证）|
| 主要场景 | 服务方线下/微信分享链接，用户在浏览器内完成"上传 → 选图 → 提交" |

页面顶部 sticky header 展示 `templateName / orderNo / recipientName` ——`recipientName` 是服务方创建订单时填的"收件人称呼"，与登录态无关。

---

## 2. 状态机

```
        ┌──────────┐  upload       ┌────────────┐
        │ PENDING  │ ────────────▶ │ GENERATING │
        └──────────┘               └────────────┘
              ▲                          │
              │ FAILED 重传               │ poll 完成
              │                          ▼
              │                  ┌──────────────────┐
              │                  │ CANDIDATES_READY │
              │                  └──────────────────┘
              │                          │
              │                          │ select
              │                          ▼
              │                  ┌──────────┐
              │ 任何阶段 cancel   │ SELECTED │  (终态)
              │ ────────────▶    └──────────┘
              │                  ┌──────────┐
              │ 任何阶段 stop    │ FAILED   │  (可重试)
              │ ────────────▶   └──────────┘
              │
       ┌──────────┐
       │CANCELLED │  (终态)
       └──────────┘
```

### 2.1 终态

| 状态 | 含义 | UI |
|---|---|---|
| `SELECTED` | 用户提交了选择，服务方已锁定结果 | ResultStage + "已提交，结果不可修改"提示条 |
| `CANCELLED` | 用户主动取消订单 | CancelledPanel（"联系服务方重开"） |
| `FAILED` | 生成失败，可重试 | FailureNotice + UploadStage（按位置覆盖语义） |

### 2.2 关键状态转移规则

| 转移 | 触发 | API |
|---|---|---|
| PENDING → GENERATING | 上传原图 | `POST /api/orders/[token]/upload` |
| FAILED → GENERATING | 重传图片（**按位置覆盖**，不是 append） | 同上 |
| GENERATING → CANDIDATES_READY | 全部原图生成成功（由 `/poll` 检测 `candidates` 已填齐） | `POST /api/orders/[token]/poll` |
| 任何 → FAILED | Lingting 上游失败 / 用户点"停止这一轮" | `POST /api/orders/[token]/stop-generation` |
| 任何 → CANCELLED | header 右上角"取消订单"（终态不可逆） | `POST /api/orders/[token]/cancel` |
| CANDIDATES_READY → SELECTED | 全部原图都已选，提交 | `POST /api/orders/[token]/select` |
| CANDIDATES_READY → GENERATING | 单图"重新生成" | `POST /api/orders/[token]/regenerate` |

### 2.3 "停止生成" vs "取消订单" — 必须区分

| | 停止生成 | 取消订单 |
|---|---|---|
| 终态？ | 否（保留订单） | 是（终态） |
| API | `/stop-generation` | `/cancel` |
| 已完成的候选图 | 保留 | 全部丢弃 |
| 按钮位置 | GeneratingStage 顶部右上 | OrderHeader 右上 |
| 文案 | "停止这一轮" | "取消订单" |

记忆文件 `gpt-image-cancel-vs-cancel-generation.md` 记录了这两条路径之前的混淆，必须保持现状。

---

## 3. 单图模式（核心约束）

**默认情况下，每张原图独立走完"上传 → 选图 → 提交"流程**。多张订单（`uploadCount > 1`）通过串行切换实现：

```
第 1 张：上传 → 生成 → 选图
第 2 张：上传 → 生成 → 选图
...
第 N 张：上传 → 生成 → 选图
全部选完 → 提交（status = SELECTED）
```

UI 表现为：

- **UploadStage**：每次只接受 1 张（单图预览，单图确认）
- **SelectStage**：以"原图 1 / 原图 2 / ..." 为单位切换；切完一张后自动跳到下一张未选原图
- **ResultStage**：按原图顺序展示每张的成品

候选图（candidates）始终是**宫格拼图**：1 张图 = 1 张 N 宫格 PNG（CSS crop 显示每个宫格）。`candidateCount` 仅支持 1 / 2 / 4 / 9（其他值 SelectStage 会 fallback 提示"请联系服务方"）。

---

## 4. 组件地图

### 4.1 Orchestrator

**`user-order-view.tsx`** —— 路由分发：
- 根据 `order.status` 决定渲染哪个 stage
- 派生 `allowReupload = !isSelected && !isCancelled && !isGenerating` 单一布尔，下游所有 stage 判断都从这里派生
- 持有 AlertDialog（取消订单二次确认）
- PENDING 时不展示 OrderTimeline（"无事件可看"）；其余状态都展示

### 4.2 Stage 组件

| 组件 | 渲染条件 | 关键 props |
|---|---|---|
| `OrderHeader` | 永远 | status / canCancel / onCancelClick |
| `StepRail` | 非 CANCELLED | status |
| `FailureNotice` | isFailed | message (sanitized) / canRetry / onRetryAll |
| `UploadStage` | allowReupload && (PENDING \|\| FAILED \|\| 选满后可传下一张) | uploadCount / uploadedImageCount / hasFailure / onUpload |
| `GeneratingStage` | isGenerating | uploadedImageCount / readyGroups / uploadedAt / onStopClick |
| `SelectStage` | allowReupload && isReady && uploadedCount > 0 | imageCount / candidateCount / selections / onToggle / onSubmit / onRegenerate |
| `ResultStage` | isSelected | selections / onDownload |
| `CancelledPanel` | isCancelled | cancelledAt |
| `OrderTimeline` | 非 PENDING | createdAt / uploadedAt / generatedAt / selectedAt / cancelledAt / failed / errorMessage |

### 4.3 子组件

| 组件 | 父 | 用途 |
|---|---|---|
| `OriginalStrip` | SelectStage | 多图模式下的缩略图 tab 切换条 |
| `QuadrantGrid` | SelectStage | 宫格热区（1/2/4/9 通用）|
| `Lightbox` | SelectStage / ResultStage | 全屏放大、对比原图、键盘选择 |

### 4.4 Hooks

| Hook | 文件 | 职责 |
|---|---|---|
| `useOrder(token)` | `use-order.ts` | 拉取订单 + 轮询；返回 `{ order, loading, notFound, refresh }` |
| `useOrderActions({ token, refresh })` | `use-order-actions.ts` | 所有 mutation；返回 `{ upload, submit, cancel, stopGeneration, regenerate, retryAll, download, ... }` |
| `useSelections(order)` | `use-selections.ts` | 本地选择草稿；返回 `{ selections, selectedCount, allSelected, firstUnselectedIdx, toggle, toPayload }` |

### 4.5 共享工具

| 文件 | 用途 |
|---|---|
| `image-urls.ts` | `originalUrl / candidateUrl` 拼接 R2 公开 URL；`preloadImages` 预热浏览器缓存 |
| `lib/sanitize-error-message.ts` | 把服务端的 `errorMessage` 收敛成用户可读短句，过滤 HTML/Lingting/HTTP 噪音 |

---

## 5. 数据流

### 5.1 读取

```
useOrder(token)
  └─ fetch GET /api/orders/[token]
       └─ 每 2s 轮询（GENERATING / CANDIDATES_READY 时）
            └─ readyGroups 变化 → GeneratingStage 进度更新
            └─ status 变化 → user-order-view 切 stage
```

### 5.2 写入

```
useSelections(order)         ← 本地草稿（useState）
useOrderActions({ token, refresh })
  ├─ upload(files[])         → presign PUT 到 R2 → POST /upload 触发生成
  ├─ submit(selections)      → POST /select
  ├─ cancel()                → POST /cancel
  ├─ stopGeneration()        → POST /stop-generation
  ├─ regenerate(imageIdx)    → POST /regenerate
  ├─ retryAll()              → POST /regenerate（不传 imageIdx）
  └─ download(orderNo, i, c) → fetch /candidates/[i]/[c]（302 → blob → a.download）
```

### 5.3 选择草稿调和（`use-selections.ts`）

服务端 `selections` 只有 `/select` 一个写入方，本地草稿调和规则：

| 条件 | 行为 |
|---|---|
| 切换订单（`orderId` 变化） | 用服务端值初始化 |
| 进入 SELECTED 终态 | 服务端权威，重置草稿 |
| 原图数量变化（uploaded 多了） | 按新长度补齐草稿，新增位为 null |
| 其他轮询 / 重新生成 | **不覆盖草稿**（用户未提交的选图不会被服务端清掉） |

---

## 6. 关键交互

### 6.1 键盘快捷键（SelectStage + Lightbox）

| 键 | SelectStage | Lightbox |
|---|---|---|
| `1`–`9` | 选第 N 个候选 | — |
| `←` / `→` | 切换原图 | 切换候选 |
| `↑` / `↓` | — | 切换原图 |
| `Z` | 撤销上一张选择 | — |
| `Enter` | 全选完 → 提交 | 选择当前候选 |
| `Space` | — | 切换对比原图模式 |
| `?` | 打开键盘帮助 | — |
| `Esc` | — | 关闭 lightbox |

Lightbox 还支持触屏手势：左右滑切换、长按看原图。

### 6.2 FAILED 重传语义

与正常状态不同，FAILED 时新上传按**位置覆盖**而非 append：

```
本订单 uploadCount = 3，已上传 3 张，FAILED
用户重传 1 张 → slots[0] = 新图, slots[1] = 原图1, slots[2] = 原图2
旧 selections 清空（因为原图索引可能已变）
```

普通状态（CANDIDATES_READY 续传）：
```
本订单 uploadCount = 3，已上传 1 张
用户再传 1 张 → slots = [原1, 新1]
selections 补齐 [原选, null]
```

### 6.3 停止生成 vs 取消订单

详见 §2.3。

---

## 7. 错误信息收敛

`sanitizeErrorMessage()`（`lib/sanitize-error-message.ts`）在展示前过滤：

| 模式 | 行为 |
|---|---|
| 噪音（HTML / Lingting / HTTP / `next_error` / `at fn(` 等） | 返回 `null`，UI 走兜底文案 |
| 已知用户原因（图片过大 / 额度不足 / 超时 / 已停止 / 网络异常） | 返回定型短句 |
| 其他 | 截断到 80 字 |

DB 字段原值不动；管理端 `/admin` 仍能拿到完整原文排查。

---

## 8. 时间线（OrderTimeline）

事件从现有 order 字段**推导**，不加事件表：

| 事件 | 触发字段 |
|---|---|
| 订单已创建 | `createdAt` |
| 已上传原图 | `uploadedAt` |
| 已生成候选 | `generatedAt` + `candidateGroups` |
| 上次生成失败 | `failed` + `errorMessage` (sanitized) |
| 已选定提交 | `selectedAt` + `selectedCount` |
| 订单已取消 | `cancelledAt` |
| 正在生成… | `status === "GENERATING"`（占位）|

默认折叠，只显示最新一条；点击展开全部。

---

## 9. i18n / 可访问性

- **i18n**：当前硬编码中文（订单页）。`/admin` 是英文为主，结构上未来可走 next-intl，但订单页文案暂未抽 messages。
- **键盘导航**：SelectStage / Lightbox 完整键盘可达；ARIA roles：step-rail `<nav>`、quadrant-grid `role="radio"`、original-strip `role="tab"`。
- **SR 友好**：进度数字、ETA、step 位置都有 `aria-live` / `sr-only` 兜底。
- **safe-area**：移动端底栏 `pb-[max(env(safe-area-inset-bottom),0.75rem)]` 避开 iOS home indicator。

---

## 10. 已知约束 / 边界

| 项 | 说明 |
|---|---|
| `candidateCount` 仅支持 1/2/4/9 | QuadrantGrid 走 row-major 布局；其他值 SelectStage fallback 提示 |
| 单图模式 | 一次只接受 1 张图（选 → 预览 → 确认 → 上传 → 生成），多图串行 |
| FAILED 必须支持重传 | UI 不能锁死（除非终态 SELECTED / CANCELLED / GENERATING） |
| 重新生成某张图 | 仅清空那一张的 selection + candidates，其他原图不动 |
| 终态不可重选 | SELECTED / CANCELLED 后必须联系服务方重开 |
| 不支持的 `recipientName` 显示 | ToC 场景下若 `recipientName === 当前用户本人`，header 仍然会显示（不做特殊处理） |

---

## 11. 关键文件索引

| 路径 | 用途 |
|---|---|
| `src/app/[locale]/p/[token]/page.tsx` | 路由入口（thin wrapper）|
| `src/features/gpt-image/user/components/user-order-view.tsx` | Orchestrator |
| `src/features/gpt-image/user/components/{order-header,step-rail,upload-stage,generating-stage,select-stage,result-stage,order-timeline}.tsx` | 8 个核心 stage 组件 |
| `src/features/gpt-image/user/components/status-screens.tsx` | Loading / InvalidLink / Cancelled / FailureNotice |
| `src/features/gpt-image/user/components/{lightbox,quadrant-grid,original-strip}.tsx` | 子组件 |
| `src/features/gpt-image/user/components/{use-order,use-order-actions,use-selections}.ts` | Hooks |
| `src/features/gpt-image/user/components/image-urls.ts` | URL 工具 |
| `src/features/gpt-image/lib/sanitize-error-message.ts` | 错误收敛 |
| `src/features/gpt-image/lib/generation-service.ts` | 上游 Lingting 调用（admin 也能看到完整 `errorMessage`）|
| `src/app/api/orders/[token]/{upload,upload-url,select,regenerate,stop-generation,cancel,poll,image,candidates}/route.ts` | API |

---

## 12. 修改指南

| 想改... | 看哪 |
|---|---|
| 加一个新 status | `db/schema.ts` 加 enum + `lib/types.ts` 加 OrderStatus + 每个 stage 的判定 |
| 改上传流程 | `use-order-actions.ts:upload()` + `api/orders/[token]/upload/route.ts` |
| 改选择交互 | `use-selections.ts`（调和规则）+ `select-stage.tsx`（UI） |
| 加一种候选布局（如 3x3 不行时的 fallback） | `quadrant-grid.tsx` 的 `layoutOf` + `select-stage.tsx` 的 `isGridMode` |
| 改订单时间线事件 | `order-timeline.tsx` 的 `events = useMemo(...)` 块 |
| 改错误信息展示 | `sanitize-error-message.ts`（规则）+ `status-screens.tsx:FailureNotice`（UI） |
| 移动端适配 | 各 stage 的 sticky / 负 margin / `-mx-4` 都要复查 |
| 加键盘快捷键 | `select-stage.tsx` 的 `onKey` + `lightbox.tsx` 的 `onKey` + `select-stage.tsx` 的 helpOpen AlertDialog |