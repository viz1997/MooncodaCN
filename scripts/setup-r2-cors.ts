/**
 * 一次性脚本：给 R2 bucket 配置 CORS Policy
 *
 * 用法：
 *   pnpm tsx scripts/setup-r2-cors.ts
 *
 * 已配置允许的来源（按需修改下方 ALLOWED_ORIGINS）：
 *   - http://localhost:3000  本地 Next dev
 *   - http://127.0.0.1:3000  本地 Next dev（备用）
 */

import {
  type CORSConfiguration,
  GetBucketCorsCommand,
  PutBucketCorsCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local", quiet: true });

const ALLOWED_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"];

const corsConfig: CORSConfiguration = {
  CORSRules: [
    {
      AllowedOrigins: ALLOWED_ORIGINS,
      AllowedMethods: ["PUT", "GET", "HEAD"],
      AllowedHeaders: ["*"],
      ExposeHeaders: ["ETag"],
      MaxAgeSeconds: 3000,
    },
  ],
};

async function main() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET ?? "mooncada-public";

  if (!accountId || !accessKeyId || !secretAccessKey) {
    console.error(
      "缺少 R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY"
    );
    process.exit(1);
  }

  const client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });

  try {
    // 先读一下当前 CORS，便于对比
    try {
      const current = await client.send(
        new GetBucketCorsCommand({ Bucket: bucket })
      );
      console.log("📋 当前 CORS 配置：");
      console.log(JSON.stringify(current.CORSRules, null, 2));
    } catch (err) {
      console.log("ℹ️  当前桶无 CORS 配置或读不到（首次配置属正常）");
    }

    await client.send(
      new PutBucketCorsCommand({
        Bucket: bucket,
        CORSConfiguration: corsConfig,
      })
    );
    console.log(`\n✅ 已写入 CORS：`);
    console.log(JSON.stringify(corsConfig, null, 2));
    console.log(
      "\n⏳ 等待 1-2 分钟让 Cloudflare 同步，然后浏览器 Disable cache 重试"
    );
  } catch (err) {
    console.error("❌ 配置 CORS 失败：", err);
    process.exit(1);
  }
}

main();
