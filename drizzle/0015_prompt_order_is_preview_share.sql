-- prompt_order 加 is_preview_share 列（2026-09-13，迁移编号 0015）
--
-- 代理商 demo 流「分享给客户」场景：代理商在 /image-gen 生成预览图后点
-- 「分享给客户」→ 创建一条 status=CANDIDATES_READY + spec 已默认填好的
-- promptOrder 作 preview 凭证，通过 /p/[token] 发给客户免登录选 cell 提交。
-- 本列把这部分凭证与普通 promptOrder 区分开，让 /p/[token] 的 SelectStep /
-- ResultStep 按状态分支渲染：
--
--   is_preview_share=true  → 代理商分享凭证（客人免登录提交）
--   is_preview_share=false → 普通 promptOrder（demo 单 / ToC 下单单 / admin 工单）
--
-- 字段语义：
--   - boolean NOT NULL DEFAULT false：老数据全部 false，不影响现有查询
--   - 与 status=CANDIDATES_READY + regenerate_limit=0 + created_by=代理商 三项
--     组合判定预览凭证身份（任一不一致都按普通订单走）
--
-- 沿用 0012/0013 幂等兜底（IF NOT EXISTS），db:push 不会重跑但 psql bootstrap
-- 也能直接跑。

ALTER TABLE "prompt_order" ADD COLUMN IF NOT EXISTS "is_preview_share" boolean NOT NULL DEFAULT false;