# NextDevTpl · mp 直传 + 服务端输入图归一化(v1.4.0)

> **Mooncoda · 小梦定制馆**
> 状态:方案稿 · 2026-10-15 起草
> 目标读者:技术负责人 / 后端 / SDK 维护方 / mp 集成方

---

## 〇、问题陈述

### 0.1 现状(v1.3.1)

```
mp 端 (Taro 4 + 微信小程序)
 │
 ├─ Taro.chooseImage({ sizeType: ['original'] })
 │     └─ iOS 用户拿到 HEIC filePath
 │
 ├─ publicUploadDirectFromMp(filePath)         ← SDK 内部
 │     ├─ Taro.compressImage(HEIC → JPG)
 │     ├─ getFileSystemManager().readFile()    ← SDK 卡死点
 │     │     └─ res.data 是 Uint8Array (Taro base lib 3.17.3+)
 │     │     └─ image-utils.ts:90 instanceof ArrayBuffer 判失败
 │     │     └─ reject(new Error("readFile 返回类型非 ArrayBuffer/string"))
 │     └─ publicUploadDirect(blob, "image/jpeg") → R2
 │
 └─ submitGenerate(imageUrls: [r2Url])
       └─ proxyImageInputsToR2
             └─ isR2Url(r2Url) === true
             └─ result[idx] = raw    ← skip,直接用 mp 上传的 URL
                                       (BFF 永远不碰字节,apimart 拿 HEIC 报错)
```

**两处硬伤**:
1. **SDK `image-utils.ts:90` `Uint8Array` reject** —— mp 端 readFile 100% 失败
2. **服务端 `proxyImageInputsToR2` R2 skip** —— 即使 mp 端绕过 SDK 直接 PUT HEIC 到 R2,
   submit 时 server 跳过归一化,apimart 拿 HEIC 报错

### 0.2 目标(v1.4.0)

| 维度 | 目标 |
|---|---|
| mp 端格式归一化 | **不做**。mp 端零依赖 Taro.compression,零 SDK 内部压缩逻辑 |
| mp 端 readFile | 接受 `Uint8Array / ArrayBuffer / base64`,不再 reject |
| BFF `/api/public/upload-url` 白名单 | 放宽到所有 `image/*`,trust-on-declare + verify-on-sniff |
| `proxyImageInputsToR2` R2 skip | **取消 skip**,改为 HEAD metadata fast-path |
| 服务端归一化能力 | HEIC 仍 mp 端处理(`sizeType: ['compressed']`);SVG/BMP/TIFF/GIF/AVIF 全部 server 处理 |
| HEIC 边界 | server 解不开 HEIC(jimp 不支持,装 sharp 违反 CLAUDE.md 约束),由 mp 端 iOS native 处理 |

---

## 一、目标架构

```
┌──────────────────────────┐
│  mp 端 (Taro 4 + 微信)    │
│                          │
│  Taro.chooseImage({      │
│    sizeType: ['compressed']│  ← iOS mp 用户用 'compressed',微信内置 HEIC→JPG
│  })                       │
│      │                   │
│      ▼                   │
│  readTaroFile(filePath)  │  ← 修复 readFile 类型兼容
│      │                   │
│      ▼                   │
│  publicUploadDirect(     │
│    blob, "image/jpeg"  │
│  )                       │
└──────────┬───────────────┘
           │
           │ PUT raw bytes (任意 mime)
           ▼
       ┌──────┐
       │  R2  │  ← objectKey 沿用 public-uploads/{date}/{ts}-{nanoid}.{ext}
       └──────┘
           │
           │ publicUrl
           ▼
┌──────────────────────────────────────────────────────┐
│  NextDevTpl BFF                                       │
│                                                       │
│  POST /api/image-gen/submit                            │
│      │                                                       │
│      ▼                                                       │
│  proxyImageInputsToR2(imageUrls, traceHint)             │
│      │                                                       │
│      ├─ isR2Url?                                            │
│      │   ├─ HeadObject 读 x-moon-normalized metadata        │
│      │   ├─ "true"  → fast-path skip (无收件归一化)         │
│      │   └─ 其他 / 不存在 →   ├─ fetch(R2 URL)             │
│      │                          ├─ sniff (image-type)       │
│      │                          ├─ 白名单内 → 写 metadata  │
│      │                          │   x-moon-normalized=true │
│      │                          │   return 原 URL (fast path) │
│      │                          └─ 白名单外 → resvg-js(jimp)  │
│      │                              → putObject 到 image-gen/ │
│      │                                  input/{traceHint}/   │
│      │                              → return 新 R2 URL       │
│      ▼                                                       │
│  adapters → apimart / gpt-image / gemini         │
│      └─ fetch(归一化后 R2 URL) → 永远合规        │
└──────────────────────────────────────────────────────┘
```

**核心设计原则**:**信任归一化责任后移**。mp 端只负责直传,服务端在 submitGenerate 阶段统一处理格式,所有 upstream(无论 apimart / gpt-image / gemini)拿到的永远都是白名单内的 R2 URL。

---

## 二、三个改动点(按 PR 顺序)

### PR 1 · SDK `image-utils.ts` readFile 类型修复(独立可发)

**位置**:`src/clients/miniprogram-sdk/image-utils.ts:80-118`

**改动**:`taroReadFileAsArrayBuffer` 的 `res.data instanceof ArrayBuffer` 单分支检查,扩展为 `ArrayBuffer | ArrayBufferView | base64` 三分支。

```ts
// image-utils.ts success 回调体
success: (res) => {
  // 1. ArrayBuffer 直通(Taro 老版本 base lib)
  if (res.data instanceof ArrayBuffer) {
    resolve(res.data);
    return;
  }
  // 2. typed array(Taro base lib 3.17.3+ 返 Uint8Array 等)
  //    必须 .slice() 出独立副本,否则 shared underlying buffer 可能被回收
  if (ArrayBuffer.isView(res.data)) {
    const view = res.data;
    resolve(
      view.buffer.slice(
        view.byteOffset,
        view.byteOffset + view.byteLength,
      ) as ArrayBuffer
    );
    return;
  }
  // 3. base64 string(Taro RN 偶尔返,encoding 被外部设过)
  if (typeof res.data === "string") {
    /* atob decode ... 不变 */
    return;
  }
  reject(new Error("readFile 返回类型非 ArrayBuffer/ArrayBufferView/string"));
},
```

**兼容性**:接受范围扩大,无破坏性变更。所有 v1.3.0 / v1.3.1 调用方升级后自动受益。

**diff**:~6 行,纯增。

---

### PR 2 · BFF 端上传白名单放宽 + R2 metadata fast-path(核心)

#### 2.1 `/api/public/upload-url` 白名单放宽

**位置**:`src/app/api/public/upload-url/route.ts:44-49`

**当前:**`new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"])`

**改为:**接受所有 `image/*` mime(具体子类型仍写入 objectKey.ext,但不预判兼容性):

```ts
// 弱校验:必须是 image/* 头,具体子类型交给 server 端 sniff
function isImageMime(mime: string): boolean {
  return /^image\//i.test(mime);
}
```

**trade-off**:
- ✅ mp 端可以传 HEIC / BMP / TIFF / GIF / SVG(原本会被 presign 拒)
- ✅ mp 端不需要先做格式归一化,链路更短
- ⚠️ R2 存的 Content-Type 可能是 mp 误声明的(但 server 端 sniff 永远以 buffer 为准,不影响下游)
- ⚠️ `text/*` / `application/*` 伪装图攻击:5MB cap + 后端 sniff 已经能挡住,不再前端硬卡

#### 2.2 `proxyImageInputsToR2` R2 skip 改造

**位置**:`src/features/image-gen/lib/image-models/input-url-proxy.ts`

**当前:**`isR2Url(raw)` → 直接 skip(假设 R2 已合规)

**改为:**HEAD metadata 看 `x-moon-normalized` 标记:

```ts
// input-url-proxy.ts 新增
async function tryR2NormalizedSkip(url: string): Promise<boolean> {
  // R2 S3 HeadObject:取 user-defined metadata
  // x-moon-normalized === "true" → 已知合规,跳过 fetch
  // 其他 / 失败 → 返回 false,走 slow path
  try {
    const head = await headR2Object(url);
    return head?.metadata?.["x-moon-normalized"] === "true";
  } catch {
    return false;  // HEAD 失败保守走 slow path
  }
}

// proxyImageInputsToR2 调用点
if (isR2Url(raw)) {
  if (await tryR2NormalizedSkip(raw)) {
    result[idx] = raw;     // fast path
    return;
  }
  // slow path:fetch + sniff + normalize
  result[idx] = await persistHttpInputToR2(raw, traceHint, idx);
  return;
}
```

**配套**:`persistHttpInputToR2` 完成后写 metadata:

```ts
// persistHttpInputToR2 末尾
async function persistHttpInputToR2(
  url: string,
  traceHint: string,
  idx: number
): Promise<string> {
  /* ... 现有 fetch + normalize + putObject 逻辑 ... */

  const publicUrl = putObject({
    objectKey,
    body: normalized.buffer,
    contentType: normalized.mime,
    metadata: {
      "x-moon-normalized": "true",          // 标记后续 submit 可 fast-path skip
      "x-moon-source-mime": normalized.detectedMime ?? mimeFromHeader ?? "unknown",
      "x-moon-source-url": url.slice(0, 256), // 上游 URL 留痕(截断防爆)
    },
  });
  return publicUrl;
}
```

**trade-off**:
- ✅ 一次 HEAD(~10ms)避免重复 fetch + sniff,长期收益大
- ⚠️ 首次 submit 仍走 slow path(每个新 URL 多一次 fetch+sniff,后续 submit 才 fast-path)
- ⚠️ R2 metadata 单个 key 限 2KB,`x-moon-source-url` 必须截断

#### 2.3 HEIC 边界

**server 端 jimp v1 不支持 HEIC 解码**(`@jimp/heic` deprecated);`@resvg/resvg-js` 只能 SVG → 光栅**;装 sharp 违反 CLAUDE.md 约束(vercel libvips 装不稳)**。

**HEIC 必须在 mp 端处理**,方案:

```ts
// mp 端推荐 (SDK 不自动做)
const { tempFilePath } = await Taro.chooseImage({
  count: 1,
  sizeType: ['compressed'],   // ← 关键:iOS 微信内置 HEIC→JPG
});
```

`sizeType: ['compressed']` 是 iOS 微信原生能力,**不需要 SDK 任何压缩代码**,完全规避 `taroReadFileAsArrayBuffer` Uint8Array reject bug。

如果 mp 用户硬要用 `sizeType: ['original']` 拿 HEIC:
- SDK 直传 R2(mime 声明为 `image/heic`,R2 接受)
- submit 时 server fetch → sniff HEIC → jimp 失败 → 抛 `ImageFormatError("image/heic", "HEIC 暂不支持,请用 sizeType:'compressed'")`
- 调用方 catch 后翻译成用户可读提示

---

### PR 3 · SDK `publicUploadDirectFromMp` 删除 + 文档同步

**删除** `src/clients/miniprogram-sdk/upload.ts:160-168` 的 `publicUploadDirectFromMp`,v1.4.0 起 mp 端不再有 SDK 内部的归一化逻辑。

**README 同步**:
- Section 5 用法从 `publicUploadDirectFromMp` 换回 `publicUploadDirect`
- 加 `sizeType: ['compressed']` 推荐
- Changelog 加 v1.4.0 段落

**diff 摘要**:
- `upload.ts`: -10 行
- `image-utils.ts`: -30 行(归一化 helper 不再被 SDK 内部调用,可保留作为 mp-side 工具,但默认不再导出)
- `README.md`:Section 5 / Changelog ~30 行改

---

## 三、HEIC 处理责任划分(2026-10-15 最终决策)

| 客户端 | 输入格式 | 处理责任 | 实现路径 |
|---|---|---|---|
| iOS 微信 mp | HEIC | **mp 端** | `Taro.chooseImage({ sizeType: ['compressed'] })` |
| iOS 微信 mp | HEIC(用 original) | **失败兜底** | server fetch → sniff → ImageFormatError → 用户提示用 compressed |
| Android 微信 mp | JPG/PNG/WebP | 直通 | 无 |
| Android 微信 mp | BMP/TIFF/HEIF | server 端 jimp 转 PNG | server `normalizeToSupported` |
| Web 浏览器 | JPG/PNG/WebP | 直通 | 无 |
| Web 浏览器 | HEIC(Browser 强制) | server 端 fetch → sniff → jimp 失败 → ImageFormatError | 用户提示换 Safari/Firefox 重新导出 |
| 任意 client | SVG | server 端 resvg-js 光栅化 | server `normalizeToSupported` |

**关键决策**:**不在 server 端装 HEIC 解码能力**。代价:
- iOS mp 必须 `sizeType: ['compressed']`
- 浏览器用户必须先导出 JPG/PNG/WebP

收益:
- 不引入 `sharp` / `heic-decode` 庞大依赖
- Vercel serverless 冷启动不破(libvips / WASM 加载慢)
- 攻击面更小(server CPU 不做 HEIC 解码这种贵操作)

如果未来 iOS mp 用户量起来,出现大量 `original` HEIC 场景,再回头加 `heic-decode` WASM(纯 JS,可装,不破 Vercel)。

---

## 四、回退矩阵

| 旧 SDK 版本 | 旧路径 | 新 SDK(v1.4.0) |
|---|---|---|
| `publicUploadDirectFromMp(path)` | 客户端 HEIC→JPG + 直传 | **删除**,改用 `publicUploadDirect(blob)` + `sizeType:['compressed']` |
| `publicUploadDirect(blob)` | 继续 | 不变 |
| `publicUpload(blob)` | BFF multer 中转 | 不变,保留兜底 |

BFF 端:
- `/api/public/upload-url` 白名单放宽:**向后兼容**(原 png/jpeg/webp 仍可用)
- `proxyImageInputsToR2`:`isR2Url` skip 改 HEAD fast-path。旧 R2 对象第一次仍走 fetch+sniff,
  验证后落 metadata,后续 submit fast-path。

---

## 五、实施顺序(三个独立 PR)

| PR | 内容 | 风险 | 预计 diff |
|---|---|---|---|
| **PR 1** | `image-utils.ts` readFile 类型修复 | 极低(纯增) | ~6 行 |
| **PR 2** | `/api/public/upload-url` 白名单放宽 + `proxyImageInputsToR2` HEAD fast-path + R2 metadata | 中(改关键路径) | ~50 行 |
| **PR 3** | 删 `publicUploadDirectFromMp` + README 更新 + Changelog v1.4.0 | 低 | ~40 行 |

**建议合并顺序**:PR 1 → PR 2 → PR 3。每个 PR 独立可发,出问题可单独回滚。

---

## 六、相关文件索引

- SDK:`src/clients/miniprogram-sdk/{image-utils,upload,index}.ts`
- BFF 上传:`src/app/api/public/upload-url/route.ts`
- BFF 归一化:`src/features/image-gen/lib/image-models/{input-url-proxy,image-normalize}.ts`
- R2 helper:`src/features/image-gen/lib/r2.ts`
- 历史方案:`architecture-miniprogram-as-client.md`(mp 身份定位)