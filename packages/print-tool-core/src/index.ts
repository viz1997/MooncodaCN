/**
 * `@mooncoda/print-tool-core` —— 打印服务的**引擎**
 *
 * 这一包是「模型检测 / 克重 / 报价」三件事的**纯计算**部分:
 *
 * | 目录 | 干什么 |
 * |---|---|
 * | `parse/` | OBJ 解析 + 编码嗅探(UTF-8 / UTF-16) |
 * | `mesh/` | 焊接 / 拓扑分析 / 自检摘要 / 支撑外壳 / WJP 报告 |
 * | `weight/` | 耗材克重 / 模型单位判定 / 几何估算 |
 * | `pricing/` | 定价引擎 / 浮雕档位 / 智能摆盘 / 姿态对比 / 支撑缓存键 |
 * | `quote/` | 报价引擎 / 定价设置 / 交期档位 / 取整 / 优惠基数 |
 *
 * ## 边界
 *
 * **这个包里没有**:React 组件、three.js 视口、next-intl 文案、数据库、
 * 支付、模型上传。**只有纯计算**。
 *
 * ⇒ 同一个包能在**浏览器**、**Node**、**Web Worker**里跑(零 `node:` import)。
 *
 * ## 用法
 *
 * ```ts
 * import { computePrintQuote } from "@mooncoda/print-tool-core/quote";
 * import { weldAndAnalyzeTopology } from "@mooncoda/print-tool-core/mesh";
 * import { parseObj } from "@mooncoda/print-tool-core/parse";
 * ```
 *
 * 细路径也认:`@mooncoda/print-tool-core/mesh/weld`。
 *
 * ## 两条口径(改之前先读)
 *
 * 1. **金额一律「分」,一律向上取整** —— 见 `quote/rounding.ts`。
 * 2. **服务端不信客户端带来的价** —— `computePrintQuote()` 只吃**几何**,
 *    价格永远由服务端那一份 `settings` 算出来。
 */

export * from "./mesh";
export * from "./parse";
export * from "./pricing";
export * from "./quote";
export * from "./weight";
