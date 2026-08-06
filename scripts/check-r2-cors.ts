/**
 * 只读脚本：查看 R2 bucket 当前 CORS 配置
 *
 * 用法：pnpm tsx scripts/check-r2-cors.ts
 */

import { GetBucketCorsCommand, S3Client } from "@aws-sdk/client-s3";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local", quiet: true });

async function main() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET ?? "mooncada-public";

  if (!accountId || !accessKeyId || !secretAccessKey) {
    console.error("缺少 R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY");
    process.exit(1);
  }

  const client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });

  try {
    const out = await client.send(
      new GetBucketCorsCommand({ Bucket: bucket })
    );
    console.log(`✅ bucket "${bucket}" 当前 CORS：`);
    console.log(JSON.stringify(out.CORSRules, null, 2));
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message.includes("NoSuchCORSConfiguration") ||
        err.message.includes("AccessDenied"))
    ) {
      console.log(`❌ bucket "${bucket}" 没有 CORS 配置或无权读取`);
      console.log("   错误：", err.message);
    } else {
      console.error("读取失败：", err);
    }
    process.exit(1);
  }
}

main();