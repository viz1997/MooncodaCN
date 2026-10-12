import { ExternalApiKeysAdminView } from "@/features/image-gen/admin/components/external-api-keys-admin-view";

/**
 * 外部生图服务 - API Key 管理
 *
 * 仿 mooncada-source/public-image-gen 设计，为第三方合作伙伴提供：
 * - 专属 API Key
 * - 月度配额
 * - 允许效果列表
 * - 成本与调用统计
 *
 * 数据使用前端 mock（MOCK_EXTERNAL_API_KEYS），后端接入留后续阶段
 */
export default function ExternalApiKeysAdminPage() {
  return (
    <div className="space-y-6">
      <ExternalApiKeysAdminView />
    </div>
  );
}
