# 小程序 SDK(参考实现)

NextDevTpl 暴露给小程序的 TypeScript SDK 参考实现。把本目录(`src/clients/miniprogram-sdk/`)整体复制到小程序仓库 `src/api/sdk/` 即可使用。

> ⚠️ **本 SDK 只覆盖 NextDevTpl AI SaaS 后端的 API。Commerce(商品 / 购物车 / 订单 / 支付)走独立部署的 Medusa,详见 [`MEDUSA_INTEGRATION.md`](./MEDUSA_INTEGRATION.md)。**

## 文件清单

| 文件 | 职责 |
|---|---|
| `types.ts` | 全量请求/响应类型(零依赖) |
| `request.ts` | fetch 内核:Bearer 自动加 + 401 回调 + 超时 + multipart |
| `auth.ts` | WeChat 登录 |
| `upload.ts` | 公共桶 / 订单桶上传(formData + presigned PUT) |
| `image-gen.ts` | 提交生图 + 轮询 + 模板 + 我的资产 |
| `orders.ts` | `/orders/[token]/**` 公共预览流(12 端点) |
| `index.ts` | 统一出口 |
| `MEDUSA_INTEGRATION.md` | **小程序 commerce 走真 Medusa 的接入指南** |

## 集成步骤

### 1. 复制 SDK 到小程序

```bash
cp -r src/clients/miniprogramgram-sdk/ <miniprogram>/src/api/sdk/
```

### 2. App 入口初始化

```ts
// src/app.ts
import { setupSdk } from "@/api/sdk";

setupSdk({
  baseUrl: process.env.TARO_APP_API_BASE_URL ?? "https://api.mooncoda.com",
  timeoutMs: 30_000,
  onUnauthorized: () => {
    // 业务层跳登录页(token 失效 / 7 天过期)
    Taro.navigateTo({ url: "/pages/login/index" });
  },
});
```

### 3. 登录

```ts
import Taro from "@tarojs/taro";
import { loginWithWechat } from "@/api/sdk";

async function handleLogin() {
  // 1. wx.login 拿 code
  const { code } = await Taro.login();

  // 2. 用户点「授权手机号」按钮 → 拿 encryptedData/iv
  // 注意:getPhoneNumber 必须 Taro 按钮 + open-type="getPhoneNumber"
  // 然后在 onGetPhoneNumber 事件回调里调用下面的 loginWithWechat
  return { code };
}

async function onGetPhoneNumber(e) {
  if (!e.detail.encryptedData) return; // 用户拒绝授权
  const { code } = await Taro.login();
  const { user } = await loginWithWechat({
    code,
    encryptedData: e.detail.encryptedData,
    iv: e.detail.iv,
  });
  Taro.setStorageSync("mp_user", user);
}
```

### 4. 提交生图

```ts
import {
  publicUpload,
  submitGenerate,
  pollImageTask,
  proxyImageUrl,
} from "@/api/sdk";

// 4.1 上传参考图
const file = await chooseImageFile(); // Taro.chooseImage + file
const { url } = await publicUpload(file);

// 4.2 提交生图(可选 maskId 从 listTemplates 拉)
const { taskId, costCredits } = await submitGenerate({
  maskId: "R-cute-001",
  imageUrls: [url],
  size: 6,
  count: 1,
});

// 4.3 轮询(递减间隔)
const schedule = [15, 12, 10, 8, 6, 5, 4, 3];
for (const s of schedule) {
  await new Promise((r) => setTimeout(r, s * 1000));
  const status = await pollImageTask(taskId);
  if (status.status === "completed") {
    status.candidates.forEach((c) => console.log("候选:", proxyImageUrl(c)));
    break;
  }
  if (status.status === "failed") throw new Error(status.errorMessage);
}
```

### 5. 6 步工作台(代理商 demo / 客户预览)

```ts
import {
  createOrder,
  configureOrder,
  orderUpload,
  pollOrder,
  selectCandidate,
  guestConfirmOrder,
} from "@/api/sdk";

// 5.1 建订单
const { token } = await createOrder({
  productTypeCode: "R",
  channel: "miniprogram",
  spec: { sizeCm: 6, accessoryCode: "leather", quantity: 1 },
});

// 5.2 上传参考图
const { url: refUrl } = await orderUpload(token, file);

// 5.3 调 generate(走 image-gen 模块,但 candidate 入订单由服务端后台驱动)
// 实际业务可直接走 submitGenerate({ maskId, imageUrls: [refUrl] })
// 拿到 taskId 后,服务端推进订单 generationTask

// 5.4 轮询订单状态
while (true) {
  const { status } = await pollOrder(token);
  if (status === "COMPLETED") break;
  if (status === "FAILED") throw new Error("生成失败");
  await new Promise((r) => setTimeout(r, 3000));
}

// 5.5 选候选
await selectCandidate(token, 0, 0);

// 5.6 客户确认(代理商 demo)
await guestConfirmOrder(token);
```

### 6. 错误处理

```ts
import { SdkRequestError } from "@/api/sdk";

try {
  await submitGenerate({ imageUrls: [url] });
} catch (err) {
  if (err instanceof SdkRequestError) {
    // err.status / err.code / err.message 可用
    if (err.code === "INSUFFICIENT_CREDITS") {
      Taro.showToast({ title: "积分不足", icon: "none" });
    } else if (err.status === 401) {
      // onUnauthorized 已触发,这里通常不需要再处理
    } else {
      Taro.showToast({ title: err.message, icon: "none" });
    }
  } else {
    throw err;
  }
}
```

### 7. 取消轮询(进入后台 / 切换页面)

```ts
const controller = new AbortController();
pollImageTask(taskId, { signal: controller.signal }).catch(() => {
  /* 取消时 SDK 自动 throw SdkRequestError("TIMEOUT"|"ABORTED") */
});

// 用户切后台时调:
controller.abort();
```

## 鉴权矩阵

| 端点 | 鉴权 |
|---|---|
| `/api/auth/wechat-phone-login` | 免登录 |
| `/api/public/upload` `/api/public/generate` `/api/image/task/[id]` | 免登录(taskId 不可猜测) |
| `/api/image-gen/prompt-templates` `/api/image-gen/photos/list` `/api/image-gen/jobs/[id]/poll` | **Bearer** |
| `/api/orders/[token]/**` | 免登录(token 即凭证) |
| `/api/image-gen/thumbnail` `/api/image-gen/download` | 免登录(代理不分子) |
| `/api/store/**` | ❌ **不在本 SDK —— commerce 走真 Medusa** |

## 已知限制 / TODO

- **credits 端点(`/api/credits/balance`, `/api/credits/daily-claim`, `/api/credits/ledger`)**:docs 有、代码未实现。Phase P1 上线后会在此 SDK 增补 `credits.ts` 模块。
- **微信支付(`/api/pay/wechat/*`)**:Phase P2。会增补 `payment.ts` 模块。
- **Token 刷新**:BA session 7 天过期,SDK 不自动 refresh —— 业务层在 onUnauthorized 跳登录页重走 loginWithWechat 即可。

## 版本同步

- NextDevTpl 端:`src/clients/miniprogram-sdk/`
- 变更后发 PR 到小程序仓库,README.md 顶部加 Changelog 段落。
- 类型不同步 = 运行时崩,优先 lint 校验。