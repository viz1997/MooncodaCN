"use server";

/**
 * /admin/files 后台文件管理 —— server actions(2026-11-08)
 *
 * ## 这一页管的是哪个桶
 *
 * **R2 桶**(`R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` /
 * `R2_BUCKET`),也就是工作室所有文件的落脚点:
 *
 * - `print-orders/<用户分区>/<日期>/…` —— 3D 打印模型(zip)
 * - `gpt-image/…` —— 生图结果
 * - `canvas/results/…` —— 画布产物
 * - `image-gen/input/…` —— 生图输入图
 * - `user-uploads/…` / `public-uploads/…` / `orders/…` —— 上传件
 *
 * **不是** `features/storage/providers/s3.ts` 那个头像桶(`STORAGE_*` 环境变量)——
 * 那是另一套,跟这一页没关系。
 *
 * ## 权限
 *
 * 走 `adminAction` 这一层:确认调用者是 admin。页面本身在 `(admin)` 路由组里,
 * 父 layout 的 `checkAdmin()` 已经守了一道 —— 这里再守一道,是因为 server
 * action **不经过** layout。
 *
 * ## 约定
 *
 * - **读**操作返数据对象,**写**操作返 `{ok:true}` / `{ok:false, code}`。
 *   预期内的失败**不 throw** —— throw 会被 next-safe-action 糊成「服务器错误」,
 *   用户就看到一句没用的提示。
 * - 原始报错只进 `console.error`,响应体只给一个稳定的码。
 *
 * ## ⚠️ 这个文件不许 re-export 类型
 *
 * `"use server"` 文件的每个导出都会被注册成 server action。re-export 一个类型
 * → 运行时引用一个不存在的类型绑定 → `ReferenceError` → 整页 500。
 * 仓库里有单测扫这个(`src/test/repo/pure/use-server-exports.test.ts`)。
 * 类型全在 `./types.ts`。
 */

import { z } from "zod";

import {
  deleteObject,
  getPublicUrl,
  hasPublicBase,
  isR2Configured,
  listObjects,
  presignDownload,
} from "@/features/image-gen/lib/r2";
import { adminAction } from "@/lib/safe-action";

import { classifyDeleteError, classifyDownloadError } from "./lib/errors";
import { resolveFileOwner } from "./lib/owner-map";
import { getOwnerIndex } from "./lib/owner-store";
import {
  fileExt,
  fileName,
  folderName,
  isImageKey,
  normalizeObjectKey,
  normalizePrefix,
} from "./lib/paths";
import type {
  AdminDeleteFileResult,
  AdminFileDownloadResult,
  AdminListFilesResult,
} from "./types";

const withAdminFilesAction = (name: string) =>
  adminAction.metadata({ action: `admin.files.${name}` });

/** 一页最多几个条目(目录 + 文件合起来) */
const PAGE_SIZE = 200;

/** 前缀最长多少字符 —— 够用了,又不至于让人塞一整本书进来 */
const MAX_PREFIX_LENGTH = 512;

/** 对象键最长多少字符 */
const MAX_KEY_LENGTH = 1024;

/**
 * 列目录
 *
 * ## delimiter 是这一页的核心
 *
 * 传 `Delimiter: "/"` → R2 在「这一层」停下,返回:
 *
 * - `CommonPrefixes` = 这一层的**子目录**
 * - `Contents` = 这一层**直接放着**的文件
 *
 * 这正好是文件管理页要的「文件夹 + 文件」两层视图。
 *
 * ## 翻页
 *
 * `continuationToken` 是 R2 给的**不透明游标**,只能原样传回去。
 * 客户端要自己记着「当前前缀 + 当前游标」这一对 —— 换了前缀,旧游标就作废了。
 */
const listSchema = z.object({
  /** 当前所在的前缀(根是 `""`) */
  prefix: z.string().max(MAX_PREFIX_LENGTH).optional(),
  /** 上一页给的游标 */
  continuationToken: z.string().max(4096).optional(),
});

export const adminListFilesAction = withAdminFilesAction("list")
  .schema(listSchema)
  .action(async ({ parsedInput }): Promise<AdminListFilesResult> => {
    if (!isR2Configured()) {
      return { ok: false, code: "R2_NOT_CONFIGURED" };
    }

    // 前缀是客户端带来的 —— 服务端自己归一化 + 校验
    const prefix = normalizePrefix(parsedInput.prefix ?? "");
    if (prefix === null) {
      return { ok: false, code: "INVALID_PREFIX" };
    }

    try {
      const [listing, ownerIndex] = await Promise.all([
        listObjects({
          prefix,
          delimiter: "/",
          ...(parsedInput.continuationToken
            ? { continuationToken: parsedInput.continuationToken }
            : {}),
          maxKeys: PAGE_SIZE,
        }),
        getOwnerIndex(),
      ]);

      return {
        ok: true,
        listing: {
          prefix,
          folders: listing.prefixes.map((p) => ({
            prefix: p,
            name: folderName(p),
            owner: resolveFileOwner(p, ownerIndex),
          })),
          files: listing.objects.map((o) => ({
            key: o.key,
            name: fileName(o.key),
            size: o.size,
            lastModified: o.lastModified,
            publicUrl: getPublicUrl(o.key),
            ext: fileExt(o.key),
            isImage: isImageKey(o.key),
            owner: resolveFileOwner(o.key, ownerIndex),
          })),
          nextContinuationToken: listing.nextContinuationToken,
          isTruncated: listing.isTruncated,
          publicBaseConfigured: hasPublicBase(),
        },
      };
    } catch (err) {
      console.error("[AdminFiles] 列目录失败", prefix, err);
      return { ok: false, code: "LIST_FAILED" };
    }
  });

/**
 * 删一个对象
 *
 * ## 大概率会失败 —— 而且失败是**预期内**的
 *
 * 这个桶的桶策略锁着对象(`ObjectLockedByBucketPolicy`,HTTP 409)。桶策略是在
 * Cloudflare 后台配的,**代码改不了**。
 *
 * 所以这里把那个错单独分出来(`R2_DELETE_BLOCKED`),界面摆「要去 Cloudflare
 * 后台改桶策略」—— 而不是一句「请稍后重试」(重试一万次也一样)。
 *
 * 哪天桶策略解锁了,这个按钮**不用改**就直接能删。
 */
const deleteSchema = z.object({
  key: z.string().min(1).max(MAX_KEY_LENGTH),
});

export const adminDeleteFileAction = withAdminFilesAction("delete")
  .schema(deleteSchema)
  .action(async ({ parsedInput }): Promise<AdminDeleteFileResult> => {
    if (!isR2Configured()) {
      return { ok: false, code: "R2_NOT_CONFIGURED" };
    }

    const key = normalizeObjectKey(parsedInput.key);
    if (key === null) {
      return { ok: false, code: "INVALID_KEY" };
    }

    try {
      await deleteObject(key);
      return { ok: true };
    } catch (err) {
      const code = classifyDeleteError(err);
      // 原始报错(含桶策略的具体说法)只进日志,不进响应体
      console.error("[AdminFiles] 删除失败", key, code, err);
      return { ok: false, code };
    }
  });

/**
 * 签一个下载用的临时 URL
 *
 * 不用公开链接下载 —— 公开链接长期有效(发到微信里就一直能用),签名 URL
 * 15 分钟就废。
 *
 * ## disposition
 *
 * - `inline`(默认)—— 浏览器直接打开(图片看图、pdf 看 pdf)
 * - `attachment` —— 浏览器把文件存下来(模型 zip 在浏览器里打开就是乱码)
 *
 * **文件名由服务端从对象键里取**,不收客户端带来的 —— 客户端能编一个
 * `../../etc/passwd` 之类的名字出来。
 */
const downloadSchema = z.object({
  key: z.string().min(1).max(MAX_KEY_LENGTH),
  disposition: z.enum(["inline", "attachment"]).optional(),
});

export const adminGetFileDownloadAction = withAdminFilesAction("download")
  .schema(downloadSchema)
  .action(async ({ parsedInput }): Promise<AdminFileDownloadResult> => {
    if (!isR2Configured()) {
      return { ok: false, code: "R2_NOT_CONFIGURED" };
    }

    const key = normalizeObjectKey(parsedInput.key);
    if (key === null) {
      return { ok: false, code: "INVALID_KEY" };
    }

    try {
      const url = await presignDownload(key, {
        ...(parsedInput.disposition === "attachment"
          ? { filename: fileName(key) }
          : {}),
      });
      return { ok: true, url };
    } catch (err) {
      const code = classifyDownloadError(err);
      console.error("[AdminFiles] 签下载链接失败", key, code, err);
      return { ok: false, code };
    }
  });
