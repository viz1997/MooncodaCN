-- 0042 · 2026-09-16：微信小程序登录 + Medusa customer 关联
-- 给 user 表加 wechat_openid / wechat_unionid / medusa_customer_id / last_login_at 四列，
-- 以及三个辅助索引。
--
-- 注意 IF NOT EXISTS 幂等：重复跑不报错。

ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "wechat_openid" text;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "wechat_unionid" text;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "medusa_customer_id" text;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "last_login_at" timestamp;

CREATE UNIQUE INDEX IF NOT EXISTS "user_wechat_openid_key" ON "user" ("wechat_openid");
CREATE INDEX IF NOT EXISTS "user_wechat_unionid_idx" ON "user" ("wechat_unionid");
CREATE INDEX IF NOT EXISTS "user_medusa_customer_id_idx" ON "user" ("medusa_customer_id");
