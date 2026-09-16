-- 0041_phone_auth.sql（2026-09-16）
--
-- 背景：Mooncoda 增加手机号 + 密码登录（Better Auth phoneNumber 插件）。
-- Better Auth plugin 强制要求 user 表有 phone_number + phone_number_verified 列
-- （详见 node_modules/better-auth/dist/plugins/phone-number/schema.d.mts）。
--
-- 设计要点：
--   - phone_number 用 E.164 格式（+8613800138000），text + UNIQUE nullable。
--     PG unique 索引允许多个 NULL，所以老 email/password 用户不受影响。
--   - phone_number_verified 默认 false；OTP verify 后由插件自动置 true。
--   - 不重建 account 表 —— phone 与 email 共用 providerId="credential" 的同一 account 行。
--
-- 复用：src/lib/auth/index.ts phoneNumber plugin + src/features/sms/* 阿里云短信
-- 已 inline 到 scripts/apply-all-missing-migrations.ts，重复跑安全。

ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "phone_number" text;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "phone_number_verified" boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS "user_phone_number_key" ON "user" ("phone_number");
