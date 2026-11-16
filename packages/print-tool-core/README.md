# @mooncoda/print-tool-core

打印服务的**引擎** —— 模型检测 / 克重 / 报价三件事的**纯计算**部分。

纯 TypeScript、**零依赖**、**零 `node:` import** ⇒ 同一个包能在**浏览器**、
**Node**、**Web Worker**里跑。

## 里面有什么

| 目录 | 干什么 |
|---|---|
| `parse/` | OBJ 解析 + 编码嗅探(UTF-8 / UTF-16 LE·BE) |
| `mesh/` | 焊接 / 拓扑分析 / 自检摘要 / 支撑外壳 / WJP 报告 |
| `weight/` | 耗材克重 / 模型单位判定 / 几何估算 |
| `pricing/` | 定价引擎 / 浮雕档位 / 智能摆盘 / 姿态对比 / 支撑缓存键 |
| `quote/` | 报价引擎 / 定价设置 / 交期档位 / 取整 / 优惠基数 |

## 里面**没有**什么

**React 组件、three.js 视口、next-intl 文案、数据库、支付、模型上传** ——
一个都没有。这个包**只有纯计算**。

⇒ 想在别的项目里复用「模型检测 / 克重 / 报价」的**算法**,装这个包就够;
想连**界面**一起复用,那是应用层的事,各项目自己做。

## 两条口径(改之前先读)

1. **金额一律「分」,一律向上取整** —— 见 `quote/rounding.ts`。
   `ceilCents()` / `yuanToCentsCeil()` 是唯一的两个入口(浮点误差用
   `1e-9` 的 epsilon 挡掉,`-0` 归一化成 `+0`)。
2. **服务端不信客户端带来的价** —— `computePrintQuote()` **只吃几何**
   (体积 / 表面积 / 尺寸 / 支撑克重),价格永远由服务端那一份 `settings`
   算出来。客户端报的单价一律不认。

## 装

### ① 同一个仓库里(本仓库自己)

`pnpm-workspace.yaml` 已经登记了这个包。**不需要** `pnpm install` 产生
symlink —— 解析走 `tsconfig.json` 的 `paths`:

```jsonc
// tsconfig.json
{
  "compilerOptions": {
    "paths": {
      "@mooncoda/print-tool-core": ["./packages/print-tool-core/src/index.ts"],
      "@mooncoda/print-tool-core/*": ["./packages/print-tool-core/src/*"]
    }
  }
}
```

> **`paths` 优先于 `node_modules`** —— Next.js(Turbopack / webpack)和
> Vite 都是这样。⇒ 用 `paths` 解析**不会有「双模块实例」问题**,
> 而且解析到的文件走宿主项目自己的 SWC 管线 ⇒ **不需要 `transpilePackages`**。

Vitest 那边加一行 alias(同一个键):

```ts
// vitest.config.ts
resolve: {
  alias: {
    "@mooncoda/print-tool-core": resolve(__dirname, "./packages/print-tool-core/src"),
  },
}
```

### ② 从磁盘引(别的项目用)

```bash
pnpm add file:../MooncodaCN-main/packages/print-tool-core
```

**指向包目录**(不是仓库根)。这样 `exports` 里的路径才对得上。

### ③ 编译产物(要发给别人 / 要装进 npm)

```bash
pnpm --filter @mooncoda/print-tool-core build
```

产出 `dist/`(CommonJS + `.d.ts` + sourcemap)。⚠️ **`dist/` 不进仓库**
(`.gitignore` 已经挡了)。

> `main` / `types` 指的是 **`./src/index.ts`**(source-first)——
> 免得「改了代码忘了重新 build」这种坑。宿主项目直接吃 TS 源码,
> 类型和实现永远一致。

## 用

```ts
// 按目录引
import { computePrintQuote } from "@mooncoda/print-tool-core/quote";
import { weldAndAnalyzeTopology } from "@mooncoda/print-tool-core/mesh";
import { parseObj } from "@mooncoda/print-tool-core/parse";
import { detectModelUnitScale } from "@mooncoda/print-tool-core/weight";
import { findOptimalAngle } from "@mooncoda/print-tool-core/pricing";

// 细路径也认
import { supportCacheKey } from "@mooncoda/print-tool-core/pricing/support-cache-key";

// 根入口(全量)
import { computePrintQuote, weldAndAnalyzeTopology } from "@mooncoda/print-tool-core";
```

### 一个完整的算价例子

```ts
import { computePrintQuote } from "@mooncoda/print-tool-core/quote";
import { getPrintPricingSettings } from "./pricing-store"; // 你自己的那一份

const quote = computePrintQuote(settings, {
  volumeCM3: 6.92,
  surfaceAreaCM2: 24.1,
  dims: [40, 40, 30],
  materialWeightG: 8.3,
  supportWeightG: 6.7,
  deliveryTier: "standard",
});

quote.totalPriceCents; // 整数分
quote.weightFeeCents;
quote.supportFeeBands; // 每一档都带单价 —— **内部口径,别发给客户端**
```

## 几个容易踩的坑

- **`supportWeightG` 一定要算出来再提交** —— 服务端按
  `input.supportWeightG ?? 0` 算支撑费,少了它支撑费算成 **0**(少收钱)。
- **浮雕档位是钱的口径,不是显示细节** —— 浮雕 1mm 托底、手办 5mm 托底,
  托底**算进支撑体积** ⇒ 算进支撑克重 ⇒ 算进支撑加价。
  判定在 `pricing/relief-detect.ts`(纯几何)。
- **模型单位要先判** —— AI 导出的模型坐标常常是**归一化的**(±1),不是毫米。
  `detectModelUnitScale()` 看**最大边**判(≥10mm 当毫米),归一化到
  最大边 100mm。详见 `weight/model-units.ts`。
- **支撑外壳是「某个姿态下的一次结果」** —— 姿态变了手里那块就作废,
  得按新姿态重算。`SupportShellData.pose` 带着算它时的姿态。

## 许可

MIT
