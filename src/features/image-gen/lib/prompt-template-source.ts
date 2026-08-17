/**
 * image-gen 模块读取 promptTemplate 的薄封装层
 *
 * 为什么要这层：
 * - image-gen 工作台 /dashboard/generate 在 RSC 里直接拉"已启用模板"
 * - gpt-image 的 admin-services.listActiveTemplatesForOrderCreate() 已经返回完整 view
 * - 但 image-gen 不应反向依赖 gpt-image 的内部模块路径（feature 之间不该互相 import）
 *
 * 做法：本文件作为 image-gen 自己的数据源出口，调用层（pages / 组件）只从这里 import。
 * 真实 DB 查询仍走 gpt-image 的 admin-services —— image-gen 与 gpt-image 共享同一张
 * prompt_template 表，模型一致。
 *
 * Phase D 删除 ProductEffect 时，记得把 image-gen 内部的 getActiveEffects 引用全部替换为
 * 本文件的 getActivePromptTemplates。
 */

import { listActivePromptTemplatesForWorkbench } from "@/features/gpt-image/lib/admin-services";
import type { PromptTemplateView } from "@/features/gpt-image/lib/types";

/**
 * 工作台用：返回所有启用的模板（含 prompt + variables + model + price）。
 * 命中缓存层（unstable_cache tag=templates），新模板最多延迟 60s 可见。
 *
 * 注意：这里故意不复用 listActiveTemplatesForOrderCreate —— 那个函数按设计不返回 prompt
 * （给 /api/templates 公开端点用，避免提示词泄漏给非管理员）；image-gen 工作台 RSC
 * 要求登录但不限管理员角色，前端必读 prompt 才能做 {{变量}} 替换，所以走专门的
 * listActivePromptTemplatesForWorkbench()。
 */
export async function getActivePromptTemplates(): Promise<
  PromptTemplateView[]
> {
  return listActivePromptTemplatesForWorkbench();
}
