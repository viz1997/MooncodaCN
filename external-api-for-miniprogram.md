# 外部生图 API 接入文档（小程序 / 第三方集成）

> 2026-10-12 起 `/api/public/generate` 默认强制 API Key 校验。集成方（小程序、合作伙伴、自动化脚本等）必须先在 admin 后台拿到 `mk_pub_` 前缀的 key 才能调用。

## 0. 概念：API Key = 身份 + 权限范围

每个 `mk_pub_` key 同时承担**两个职责**：

1. **身份凭证** —— 鉴权（缺 key / 错 key / 停用 key 会被拒）
2. **权限范围** —— admin 给该 key 配的 `allowedMasks` 决定这个 key 能用哪些产品效果

**完整调用流程**：

```
┌─────────────┐                ┌─────────────┐                ┌─────────────┐
│   Admin     │                │   集成方     │                │  MoonCoda   │
│   后台      │                │   (小程序)   │                │  Server     │
└──────┬──────┘                └──────┬──────┘                └──────┬──────┘
       │                              │                              │
       │ 1. 配 key + 配白名单          │                              │
       │   allowedMasks=[A,B,C]       │                              │
       │                              │                              │
       │   ──── 发 mk_pub_xxxx ──────▶│                              │
       │                              │ 2. GET /api/public/generate   │
       │                              │    x-api-key: mk_pub_xxxx    │
       │                              │ ────────────────────────────▶│
       │                              │                              │
       │                              │ ◀── masks=[A,B,C] 过滤后 ──│
       │                              │                              │
       │                              │ 3. POST /api/public/generate │
       │                              │    x-api-key: mk_pub_xxxx    │
       │                              │    body: {maskId: "B", ...}  │
       │                              │ ────────────────────────────▶│
       │                              │                              │
       │                              │ ◀── taskId, monthlyCalls++   │
       │                              │                              │
       │ 4. 看到 monthlyCalls=1        │                              │
       │ ◀────────────────────────────│                              │
```

**关键点**：

- 集成方**只能看到自己有权限的 mask**（GET 响应按 key 白名单过滤；调用 POST 传白名单外的 maskId 返 403）
- 集成方**只能消耗自己的配额**（月配额 = 该 key 独立计数，与其他 key 互不影响）
- admin 可以随时**调整**某个 key 的 `allowedMasks` 或停用 key，下次 GET 即时生效

---

## 1. 获取 API Key

联系 MoonCoda 平台管理员，在 admin 后台「外部生图服务」tab 点「新建 API Key」，系统会一次性显示明文（仅此一次），请立刻保存到密码管理器。后续只能看到脱敏形式 (`mk_pub_abcd****wxyz`)。

管理员会同步告知：

| 字段 | 含义 | 示例 |
|---|---|---|
| `apiKey` | 明文 key，调用时使用 | `mk_pub_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` |
| `name` | 客户标识（用于审计） | `某某小程序` |
| `monthlyQuota` | 月调用上限，`-1` = 不限 | `1000` |
| `allowedMasks` | 允许的 maskId 白名单；`[]` = 不限 | `["MASK_LANYARD_01"]` |

> **`allowedMasks` 是核心**：决定集成方**能看到、能用哪些产品效果**。详见 §0 与 §8.2。

## 2. 基础信息

- **Base URL**：`https://<your-domain>`（如 `https://mooncoda.example.com`）
- **协议**：HTTPS only；HTTP 会被 308 跳转到 HTTPS
- **路径**：`/api/public/generate`
- **时区**：所有时间戳为 UTC ISO8601
- **超时建议**：生成接口最长 `120s`（apimart/gpt_image_2/nano_banana2 都走异步轮询），前端兜底 `150s`

## 3. 鉴权（每次必带）

任选其一：

```http
# 方式 A（推荐）
x-api-key: mk_pub_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# 方式 B
Authorization: Bearer mk_pub_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

错误码统一以 JSON `code` 字段返回，便于客户端精确判断：

| HTTP | code | 含义 | 建议处理 |
|---|---|---|---|
| 401 | `API_KEY_MISSING` | 没传 key | 检查 header |
| 401 | `API_KEY_MALFORMED` | 格式错误（无 `mk_pub_` 前缀） | 检查拷贝 |
| 401 | `API_KEY_NOT_FOUND` | hash 查不到（key 不存在或被删） | 联系 admin 重新发 |
| 403 | `API_KEY_DISABLED` | key 被 admin 停用 | 联系 admin |
| 429 | `API_KEY_QUOTA_EXCEEDED` | 月配额用尽 | UI 提示「下月 1 号重置」 |

## 4. 列出可用效果（GET）

```http
GET /api/public/generate
x-api-key: mk_pub_xxx
```

**带 API key 调用**，返回 active 状态的效果模板（含价格、产品线分组、规格选项等）。**响应不返回 model / prompt / cost 等内部字段**——这是有意为之，集成方不需要知道。

**2026-10-12 起：响应按调用 key 的 `allowedMasks` 白名单过滤**：

- key 的 `allowedMasks = []`（不限）：返所有 active 模板
- key 的 `allowedMasks = ["MASK_A","MASK_B"]`：只返白名单内的模板，productLines 也按可见模板重算 maskCount，可见模板数为 0 的 productLine 不出现在响应里

```json
{
  "success": true,
  "keyScope": {
    "keyName": "某某小程序",
    "allowedMasks": ["MASK_LANYARD_01"]
  },
  "masks": [
    {
      "maskId": "MASK_LANYARD_01",
      "name": "校园风钥匙扣",
      "previewUrl": "https://cdn.example.com/mask/MASK_LANYARD_01.jpg",
      "productTypeCode": "keychain",
      "price": 29.9,
      "description": "...",
      "model": "apimart_gpt_image",
      "allowedSizes": ["40mm", "50mm"],
      "allowedAccessories": ["ring", "lobster-claw"],
      "allowedCapabilities": { "engraving": true },
      "allowedColors": ["navy", "crimson"],
      "promptTemplateId": "pt_8x9a",
      "productLineIds": ["line_lanyard"],
      "candidateCount": 4,
      "outputMode": "grid"
    }
  ],
  "productLines": [
    { "productLineId": "line_lanyard", "name": "钥匙扣", "coverUrl": "...", "sortOrder": 1, "maskCount": 1 }
  ]
}
```

新增字段 `keyScope` 告诉客户端当前 key 的可见范围（用于 UI 提示「您当前可使用 N 个效果」），不传 key（dev 模式）时为 `null`。

字段说明：

- `productTypeCode` → 对应 `keychain` / `pendant` / `fridge-magnet` / `acrylic-stand` 等产品类型字典
- `candidateCount` + `outputMode` → 前端选择器用（如 4 张候选图宫格 vs 单图）
- `productLines` → 左侧产品线分组

## 5. 生成图片（POST）

### 5.1 两种调用模式

| 场景 | 必传 | 选填 |
|---|---|---|
| 走效果模板（推荐） | `maskId` | `prompt`（追加用户意图）、`params`（模板变量）、`imageUrls`/`imageUrl`（参考图） |
| 完全自由生成 | `prompt` | `imageUrls`/`imageUrl`、`size` |

`maskId` 模式下 `prompt` 会拼到模板 prompt 末尾（`模板\n\n用户`），方便「选风格 + 加自己修改」。

### 5.2 请求体

```jsonc
{
  // ===== 必选其一 =====
  "maskId": "MASK_LANYARD_01",
  // 或
  "prompt": "赛博朋克风，霓虹街道，猫咪侦探",

  // ===== 选填 =====
  "imageUrl": "https://...",              // 单张参考图（兼容旧字段）
  "imageUrls": ["https://...", "https://..."],  // 多张参考图（最多 10）
  "size": "1024x1024",                    // 默认 1024x1024；可传 "2048x2048" 等
  "params": { "color": "navy" }           // 模板变量取值（覆盖 defaultValue）
}
```

### 5.3 响应：异步任务

多数模型（apimart / gpt_image_2 / nano_banana2）走异步，返回 `taskStatus: "processing"`，**实际图片通过 web 轮询或回调获取**（见 §6）。

```json
{
  "success": true,
  "image": null,
  "maskName": "校园风钥匙扣",
  "taskId": "imgjob_xxxxxxxx",
  "taskStatus": "processing"
}
```

### 5.4 响应：同步完成

部分轻量场景直接返回图：

```json
{
  "success": true,
  "image": "https://r2.example.com/candidates/imgjob_xxxx_0.png",
  "maskName": "校园风钥匙扣",
  "taskId": "imgjob_xxxxxxxx",
  "taskStatus": "completed"
}
```

### 5.5 错误响应（业务层）

| HTTP | code | 含义 |
|---|---|---|
| 400 | `INVALID_MASK` | maskId 不存在或已下架 |
| 400 | `MISSING_PARAM` | 模板必填变量没填且无 defaultValue |
| 400 | `MISSING_INPUT` | maskId 和 prompt 都没传 |
| 403 | `MASK_NOT_ALLOWED` | 当前 API key 不在 maskId 的白名单内（见 §8） |
| 403 | `MODEL_NOT_ALLOWED` | 模型不在公共白名单（4 个：apimart/qwen/gpt_image_2/nano_banana2） |
| 500 | `MASK_TEMPLATE_NOT_BOUND` | mask 没绑 prompt 模板（联系 admin 修复） |
| 500 | `PROMPT_TEMPLATE_MISSING` | 模板 prompt 为空（联系 admin 修复） |
| 500 | `INTERNAL_ERROR` | 服务端异常 |
| 503 | `MODEL_MAINTENANCE` | 模型维护中 |

## 6. 任务轮询 / 回调

### 6.1 前端轮询（推荐，已登录用户）

返回 `taskId` 后，调用 `/api/image-jobs/<taskId>` 查状态：

```http
GET /api/image-jobs/imgjob_xxxxxxxx
```

返回 `status` ∈ `processing` / `completed` / `failed`，`completed` 时含 `images[]`（R2 URL 数组）。

### 6.2 服务端回调（可选，集成方后端自行实现）

目前没有 webhook 接口，集成方需要自己起个轮询 worker（每 3 秒一次，单 task 最长 180s）。后续会开放 webhook。

## 7. 限流

`/api/public/generate` 默认 3 次/分钟/IP（`strict` 等级）。响应头会有：

```
X-RateLimit-Limit: 3
X-RateLimit-Remaining: 2
X-RateLimit-Reset: 1730000000
```

超限返 429 `code: RATE_LIMIT_EXCEEDED`——UI 应友好降级（如「操作太频繁，请稍后再试」）。

## 8. 配额与白名单

### 8.1 月配额

- `monthlyQuota > 0`：每月 1 号 0 点 UTC 自动重置（按需触发，不需要 cron）
- `monthlyQuota = -1`：不限制调用次数
- 配额用尽返 429 `code: API_KEY_QUOTA_EXCEEDED`

### 8.2 mask 白名单

- `allowedMasks = []`（空数组）：**不绑白名单**，可调所有 active 模板
- `allowedMasks = ["MASK_001", "MASK_002"]`：只能调白名单内的 maskId
  - **GET 列表只返白名单内的 mask**（连同 productLines 一起过滤）
  - POST 调白名单外的 maskId 返 403 `code: MASK_NOT_ALLOWED`

白名单是 admin 在后台创建 key 时配置，后续改 key 的 `allowedMasks` 也即时生效（无需重新发 key），下次 GET 自动按新范围返。

## 9. 完整 Taro 4 示例

```typescript
// src/services/mooncoda.ts
import Taro from "@tarojs/taro";

const API_BASE = "https://mooncoda.example.com";
const API_KEY = process.env.MOONCODA_API_KEY; // mk_pub_xxx

interface PublicGenerateResponse {
  success: boolean;
  image?: string | null;
  maskName?: string;
  taskId?: string;
  taskStatus?: "processing" | "completed" | "failed";
  error?: string;
  code?: string;
}

export async function generateImage(input: {
  maskId?: string;
  prompt?: string;
  imageUrls?: string[];
  size?: string;
  params?: Record<string, string>;
}): Promise<PublicGenerateResponse> {
  const res = await Taro.request({
    url: `${API_BASE}/api/public/generate`,
    method: "POST",
    header: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY, // 鉴权
    },
    data: input,
    timeout: 150_000, // 兜底 150s
  });

  const body = res.data as PublicGenerateResponse;
  if (res.statusCode === 401) {
    throw new Error("API Key 无效，请联系管理员");
  }
  if (res.statusCode === 403 && body.code === "API_KEY_DISABLED") {
    throw new Error("API Key 已停用，请联系管理员");
  }
  if (res.statusCode === 429) {
    if (body.code === "API_KEY_QUOTA_EXCEEDED") {
      throw new Error("本月配额已用尽，下月 1 号重置");
    }
    throw new Error("操作太频繁，请稍后再试");
  }
  if (res.statusCode >= 400) {
    throw new Error(body.error ?? `请求失败 ${res.statusCode}`);
  }
  return body;
}

// 2026-10-12：POST 收到 403 + MASK_NOT_ALLOWED 说明 admin 改了白名单
// 建议：UI 提示「效果已更新」并重新拉一次列表（同时刷新 keyScope）
function isMaskNotAllowed(body: PublicGenerateResponse): boolean {
  return body.code === "MASK_NOT_ALLOWED";
}

export async function listEffects() {
  const res = await Taro.request({
    url: `${API_BASE}/api/public/generate`,
    method: "GET",
    header: { "x-api-key": API_KEY },
  });
  return res.data as {
    success: boolean;
    /**
     * 2026-10-12 起：服务端把当前 key 的可见范围一起返回来
     * - keyScope=null：dev 模式（EXTERNAL_API_KEY_REQUIRED=false）或不要求 key
     * - keyScope.allowedMasks=[]：该 key 不限白名单（能看全部 active 模板）
     * - keyScope.allowedMasks=["A","B"]：只能看到这 N 个模板
     *
     * 用途：
     * 1. 顶部 banner 提示「您当前可使用 N 个效果」或「白名单变更提示」
     * 2. 在 POST 提交前对 maskId 做客户端预校验（虽然后端也会再校验一次）
     */
    keyScope: {
      keyName: string;
      allowedMasks: string[];
    } | null;
    masks: Array<{
      maskId: string;
      name: string;
      previewUrl: string;
      productTypeCode: string;
      price: number;
      candidateCount: number;
      outputMode: "grid" | "separate";
      productLineIds: string[];
    }>;
    productLines: Array<{
      productLineId: string;
      name: string;
      coverUrl: string;
      sortOrder: number;
      maskCount: number;
    }>;
  };
}

/**
 * 启动时调一次拉列表 + keyScope，缓存到 Pinia / Redux / 本地。
 * 每次 POST 失败码 MASK_NOT_ALLOWED 时 → 重新拉一次列表 + keyScope（admin 可能改了白名单）
 */
export async function bootstrap() {
  const { masks, productLines, keyScope } = await listEffects();
  if (keyScope) {
    console.log(
      `[mooncoda] key ${keyScope.keyName} 可见 ${masks.length} 个效果`
    );
  }
  return { masks, productLines, keyScope };
}
```

轮询示例（如果集成方不接已登录用户路径）：

```typescript
// 自己后端起 worker 轮询，3s 一次，最长 180s
async function pollImageJob(taskId: string): Promise<string[]> {
  const start = Date.now();
  while (Date.now() - start < 180_000) {
    await new Promise((r) => setTimeout(r, 3_000));
    const res = await Taro.request({
      url: `${API_BASE}/api/image-jobs/${taskId}`,
      method: "GET",
      header: { "x-api-key": API_KEY },
    });
    const data = res.data;
    if (data.status === "completed") return data.images as string[];
    if (data.status === "failed") throw new Error("生成失败");
  }
  throw new Error("生成超时");
}
```

## 10. 常见坑

1. **`maskId` 调了不在白名单** → 403 `MASK_NOT_ALLOWED`；先调 GET 拉白名单内的 mask 给用户选
2. **生成接口超时** → 用返回的 `taskId` 走轮询，不要同步等结果
3. **没存 `taskId`** → 用户刷新页面后再也找不到图；务必存到本地或自己后端
4. **月配额只算成功调用** → 拒绝/失败请求不消耗配额，不用担心 UI 多点几次扣光
5. **`allowedMasks` 改了** → 立即生效，不需要重新发 key
6. **HTTPS 必须** → 微信小程序必须配置 `request合法域名` 为你的 Mooncoda 域名
7. **`Content-Type` 必传** → 缺了会 400

## 11. 集成方 Checklist

- [ ] 拿到 `mk_pub_` 前缀 API Key（明文一次性）
- [ ] 与 admin 确认 `allowedMasks` 白名单（决定你能看到/用哪些 mask）
- [ ] 配置小程序后台 `request合法域名`
- [ ] `x-api-key` 头加到所有生图请求
- [ ] 启动时调 GET 拿 `masks` + `keyScope` 缓存到本地
- [ ] UI 用 `keyScope.allowedMasks.length` 显示「您当前可使用 N 个效果」
- [ ] POST 收到 `MASK_NOT_ALLOWED` → 重新拉列表 + 提示「效果已更新」
- [ ] 错误码 401/403/429 走 UI 友好提示，不要直接弹技术错误
- [ ] 拿到 `taskId` 后持久化到本地，后端轮询拿 R2 URL
- [ ] 集成完成通知 admin 调整 `allowedMasks` 白名单（如果需要扩范围）
