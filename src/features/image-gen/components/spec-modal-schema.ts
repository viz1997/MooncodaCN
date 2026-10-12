/**
 * SpecModal zod schema —— 与 components/spec-modal.tsx 同目录
 *
 * 2026-09-12：从 SpecModal 内部抽出。react-hook-form + zodResolver 共用同一 schema，
 * 把跨字段校验（订单号必须有 platform / 皮革外露 ⇄ PVC 互斥）集中到这里，免去
 * useState + 手写互斥逻辑。
 *
 * 2026-09-12：去掉 engravingExposed 字段 —— 用户反馈「SpecModal 不需要外露开关」，
 * 刻字一律默认内刻；DB 列 / 其他路径（/p/[token] / admin）保留该字段不删，
 * 仅 SpecModal 不再写它。
 *
 * 字段对照 SpecSelection（actions/submit-image-gen-demo.ts 入参）：
 * - productSize / accessoryCode：字符串，"" 视为 null
 * - engravingText / remarks / platformOrderNo：free text，受 max 限制
 * - leatherExposed / pvcProtection：boolean
 * - leatherColor / platform：字典 code，"" 视为未选
 */

import { z } from "zod";

import {
  LEATHER_COLORS,
  PLATFORMS,
} from "@/features/gpt-image/lib/product-catalog";

const leatherColorEnum = z
  .string()
  .refine((v) => v === "" || LEATHER_COLORS.some((c) => c.code === v), {
    message: "未知的皮革颜色",
  });

const platformEnum = z
  .string()
  .refine((v) => v === "" || PLATFORMS.some((p) => p.code === v), {
    message: "未知的订单来源平台",
  });

export const specModalSchema = z
  .object({
    productSize: z.string(),
    accessoryCode: z.string(),
    engravingText: z.string().max(40),
    leatherColor: leatherColorEnum,
    leatherExposed: z.boolean(),
    pvcProtection: z.boolean(),
    remarks: z.string().max(500),
    platform: platformEnum,
    platformOrderNo: z.string().max(64),
  })
  // 渠道订单号要求已选 platform（与 submit-image-gen-demo server 端校验对齐）
  .refine((v) => !v.platformOrderNo.trim() || v.platform !== "", {
    message: "请先选择订单来源平台",
    path: ["platform"],
  })
  // 皮革外露 ⇄ PVC 保护互斥（二选一）
  .refine((v) => !(v.leatherExposed && v.pvcProtection), {
    message: "皮革外露 与 PVC 保护 不能同时勾选",
    path: ["pvcProtection"],
  });

export type SpecModalFormValues = z.infer<typeof specModalSchema>;
