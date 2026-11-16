/**
 * 网格拓扑 —— 焊接 / 分析 / 摘要 / 支撑外壳 / WJP 报告
 *
 * 这一层是**纯几何**:输入顶点与三角形,输出拓扑结论和支撑几何。
 * 不碰 DB、不碰网络、不碰 DOM ⇒ 浏览器 / Node / Worker 都能跑。
 */

export * from "./analyze";
export * from "./summary";
export * from "./support-shell";
export * from "./types";
export * from "./weld";
export * from "./wjp";
