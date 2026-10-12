/**
 * external_api_key.name 字段的"防误粘 rawKey"校验 —— 客户端 + 服务端共用
 *
 * 2026-10-12 真实事故：admin 复制上一条 API Key 的 rawKey 后点新建，
 * 误把 mk_pub_xxxx + 64 字符 SHA-256 哈希一起粘到了「客户名称」字段。
 * rawKey 前缀 mk_pub_ 撞 customer name 长度 80 仍合法，混进 DB 后
 * 显示/查询都错位，触发 42P01 时排查极困难。
 *
 * 经验：
 *   - 客户名是给人读的，通常是中文/英文/数字/+-_· 空格，不该出现 hex 串
 *   - rawKey 是 mk_pub_ 前缀 + 32 字母数字 + 末尾 ****（脱敏态）
 *   - SHA-256(rawKey) 落库是 64 字符 hex
 *
 * 规则：
 *   - 含 mk_pub_ 前缀 → 拒绝
 *   - 含连续 32+ 字符 [0-9a-f] 子串 → 拒绝（覆盖 SHA-256 前/后 32 截断 + 64 全段）
 *
 * 同时被两处引用：
 *   - 客户端：src/features/image-gen/admin/components/external-api-keys-admin-view.tsx
 *     在 antd Form.Item rules 里用，UI 立刻给出具体原因
 *   - 服务端：src/features/image-gen/admin/actions.ts
 *     Zod schema 内 superRefine 兜底，挡住脚本直调 / 绕过 form 的请求
 */

const SUSPICIOUS_NAME_MESSAGE =
  "客户名中检测到 API Key 片段（mk_pub_ 前缀或 32+ 字符 hex），看起来是误粘了 Key / 哈希，请重新输入";

/** 检测 name 是否夹带了 rawKey / 哈希片段 */
export function isSuspiciousCustomerName(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return false;
  // 整段是 mk_pub_ 前缀 → 显然是粘了 key
  if (/^mk_pub_/i.test(trimmed)) return true;
  // 任意位置出现 mk_pub_ 前缀（也含脱敏后的 mk_pub_****abcd）
  if (/mk_pub_/i.test(trimmed)) return true;
  // 连续 32 字符 [0-9a-f]（覆盖 SHA-256 前 32 / 后 32 截断，也覆盖 64 全段）
  if (/[0-9a-f]{32,}/i.test(trimmed)) return true;
  return false;
}

/** 客户端 antd Form.Item validator 用的 message 文案 */
export const SUSPICIOUS_CUSTOMER_NAME_MESSAGE = SUSPICIOUS_NAME_MESSAGE;

/** 服务端 Zod superRefine 用的 message 文案（可独立调整，但通常一致） */
export const SUSPICIOUS_CUSTOMER_NAME_MESSAGE_SERVER = SUSPICIOUS_NAME_MESSAGE;
