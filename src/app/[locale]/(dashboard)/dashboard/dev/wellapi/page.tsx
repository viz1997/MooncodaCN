/**
 * Dev only - 简单 wellapi gpt-image-2 编辑接口测试页
 * /dashboard/dev/wellapi
 *
 * 用途：手动上传图、调提示词，看 wellapi 返回什么。便于在 /p/[token]
 * 之外隔离调模型，不消耗积分、不写库。
 *
 * 鉴权：dashboard 布局已强制 session，存在即视为通过。
 */

import { WellapiTestForm } from "./wellapi-test-form";

export default function WellapiTestPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold flex items-center gap-2">
          🧪 wellapi gpt-image-2 测试
        </h1>
        <p className="text-xs text-muted-foreground mt-1">
          直接调 wellapi /v1/images/edits，不走积分 / 模板 /
          异步队列，方便排查模型端问题。
        </p>
      </div>

      <WellapiTestForm />
    </div>
  );
}
