/**
 * /admin/files 后台文件管理页（2026-11-08）
 *
 * RSC：仅渲染客户端组件 <FilesAdminView />。
 *
 * RBAC：由父 layout `src/app/[locale]/(admin)/admin/layout.tsx` 的 `checkAdmin()`
 * 守卫；非 admin 自动 redirect 到 `/`。本页不重复校验。
 *
 * 这一页看的是 **R2 桶**（`R2_*` 环境变量）—— 打印模型、生图结果、画布产物、
 * 上传件都在里面。不是 `features/storage/providers/s3.ts` 那个头像桶
 * （`STORAGE_*`）。
 */

import { FilesAdminView } from "@/features/storage/admin/components/files-admin-view";

export default function AdminFilesPage() {
  return <FilesAdminView />;
}
