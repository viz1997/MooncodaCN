import { TemplatesAdminView } from "@/features/gpt-image/admin/components/templates-admin-view";

export const dynamic = "force-dynamic";

/**
 * 管理端 - 提示词模板管理
 *
 * 受 (admin)/admin/layout.tsx 的 checkAdmin() 自动保护
 */
export default function PromptTemplatesPage() {
  return (
    <div className="space-y-6">
      <TemplatesAdminView />
    </div>
  );
}
