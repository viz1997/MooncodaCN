/**
 * 产品效果种子数据（2026-09-10 重写）
 *
 * 替换原 10 条 MASK_001/002/003/004/005/006/007/293/301/617 老 seed：
 * - id 命名改为业务化（MASK_LB_PIN_3D 等），跟 6 条 productLine 一一对应
 * - productLineIds 引用 pl_xxx 新 id（PL_001..PL_004 老 mock id 不再使用）
 * - 每条挂 promptTemplateId 引用 promptTemplate 表的 tpl_xxx_v1
 * - prompt 短而精（80-160 字），含「材质 + 工艺 + 颜色 + 视角 + 背景 + 光照」六要素
 *
 * 由 src/scripts/seed-product-effects.ts 调用 createEffectInDb 落库。
 *
 * 设计原则：
 * - 保留原 schema：scene enum（generate_2d / generate_3d / translate / stylize / enhance / custom）
 * - 保留原 config: { style, color?, material? }
 * - productTypeCode 选 gpt-image PRODUCT_TYPES 字典里有的（皮革徽章=LB；其它默认 null）
 * - 不预设 allowedCapabilities / allowedColors，让 admin 在表单里按需配
 */

import type { ProductEffect } from "./product-effect-types";

export const SEED_PRODUCT_EFFECTS: ProductEffect[] = [
  {
    maskId: "MASK_LB_PIN_3D",
    name: "3D 浮雕吧唧",
    category: "badge",
    description:
      "3D 立体吧唧效果图：圆形/方形吧唧上照片主体浮雕化，金属/马口铁质感，金属徽章边缘高光。",
    previewUrl: "https://picsum.photos/seed/lb-pin-3d/400/400",
    prompt: `将上传照片转换为 3D 立体吧唧效果图：圆形/方形金属徽章，主体人物浮雕化凸起，背景纯色（白/品牌色可选）。金属马口铁质感，徽章边缘高光反射，自然阴影投射。4K 产品级摄影，正面视角，柔和均匀打光。`,
    variables: [
      {
        key: "shape",
        label: "徽章形状",
        defaultValue: "circle",
        required: false,
        options: ["circle", "square", "rounded-square"],
      },
      {
        key: "bg_color",
        label: "背景颜色",
        defaultValue: "white",
        required: false,
        options: ["white", "brand", "black"],
      },
    ],
    scene: "generate_2d",
    model: "doubao",
    versions: [
      {
        version: "v1.0.0",
        content: "初始版本",
        createdAt: "2026-09-10T00:00:00Z",
        note: "吧唧 3D 浮雕首发",
      },
    ],
    config: { style: "relief", material: "metal" },
    price: 99,
    status: "active",
    usageCount: 0,
    successRate: 0,
    avgDuration: 0,
    createdAt: "2026-09-10T00:00:00Z",
    updatedAt: "2026-09-10T00:00:00Z",
    author: "admin",
    productLineIds: ["pl_pin_3d"],
    productTypeCode: null,
    promptTemplateId: "tpl_pin_3d_v1",
  },
  {
    maskId: "MASK_LB_LEATHER_BADGE",
    name: "皮革徽章",
    category: "leather_badge",
    description:
      "真皮皮革徽章效果图：头层牛皮激光雕刻，主体清晰，可外露/PVC 保护/烫金/刻字，皮革纹理真实。",
    previewUrl: "https://picsum.photos/seed/lb-leather/400/400",
    prompt: `将上传照片转换为头层牛皮激光雕刻徽章效果图：主体以浅浮雕激光雕刻效果呈现，边缘保留皮革自然毛边质感，可选择外露皮革原色或 PVC 透明保护层覆盖。支持烫金、刻字细节。皮革纤维纹理清晰可见，自然弯曲弧度，柔和顶光。4K 产品级摄影，白底正面。`,
    variables: [
      {
        key: "protection",
        label: "保护工艺",
        defaultValue: "pvc",
        required: false,
        options: ["pvc", "exposed", "none"],
      },
      {
        key: "leather_color",
        label: "皮革颜色",
        defaultValue: "tan",
        required: false,
        options: ["tan", "brown", "black", "cognac"],
      },
    ],
    scene: "generate_2d",
    model: "doubao",
    versions: [
      {
        version: "v1.0.0",
        content: "初始版本",
        createdAt: "2026-09-10T00:00:00Z",
        note: "皮革徽章首发",
      },
    ],
    config: { style: "engraving", material: "leather" },
    price: 129,
    status: "active",
    usageCount: 0,
    successRate: 0,
    avgDuration: 0,
    createdAt: "2026-09-10T00:00:00Z",
    updatedAt: "2026-09-10T00:00:00Z",
    author: "admin",
    productLineIds: ["pl_leather_badge"],
    productTypeCode: "LB",
    promptTemplateId: "tpl_leather_badge_v1",
  },
  {
    maskId: "MASK_LB_KEYCHAIN_3D",
    name: "3D 钥匙扣",
    category: "keychain",
    description:
      "3D 立体钥匙扣效果图：PVC/亚克力立体造型，双面图案+金属环，色彩鲜艳。",
    previewUrl: "https://picsum.photos/seed/lb-keychain/400/400",
    prompt: `将上传照片转换为 3D 立体 PVC/亚克力钥匙扣效果图：主体立体浮雕呈现，双面图案（可同/异），顶部金属环扣（亚克力立体款可免金属环用树脂一体环）。色彩饱和鲜艳，PVC 软胶质感或亚克力透明填充光泽。4K 产品级摄影，白底正面，均匀打光。`,
    variables: [
      {
        key: "material_type",
        label: "材质",
        defaultValue: "pvc",
        required: false,
        options: ["pvc", "acrylic", "zinc-alloy"],
      },
      {
        key: "sidedness",
        label: "图案面",
        defaultValue: "double",
        required: false,
        options: ["double", "single"],
      },
    ],
    scene: "generate_2d",
    model: "nano_banana2",
    versions: [
      {
        version: "v1.0.0",
        content: "初始版本",
        createdAt: "2026-09-10T00:00:00Z",
        note: "钥匙扣首发",
      },
    ],
    config: { style: "3d-figurine", material: "pvc" },
    price: 89,
    status: "active",
    usageCount: 0,
    successRate: 0,
    avgDuration: 0,
    createdAt: "2026-09-10T00:00:00Z",
    updatedAt: "2026-09-10T00:00:00Z",
    author: "admin",
    productLineIds: ["pl_keychain_3d"],
    productTypeCode: null,
    promptTemplateId: "tpl_keychain_3d_v1",
  },
  {
    maskId: "MASK_LB_ACRYLIC_STAND",
    name: "亚克力立牌",
    category: "acrylic_stand",
    description:
      "亚克力人形立牌效果图：透明/磨砂亚克力人形，带底座，UV 印刷图案清晰。",
    previewUrl: "https://picsum.photos/seed/lb-acrylic/400/400",
    prompt: `将上传照片转换为亚克力人形立牌效果图：透明或磨砂亚克力按主体轮廓激光切割成型，UV 印刷图案清晰，底部一体卡槽或独立底座。亚克力边缘透光带高光，色彩饱和。4K 产品级摄影，白底正面，柔和打光。`,
    variables: [
      {
        key: "finish",
        label: "亚克力类型",
        defaultValue: "transparent",
        required: false,
        options: ["transparent", "frosted", "colored"],
      },
      {
        key: "base",
        label: "底座",
        defaultValue: "with-base",
        required: false,
        options: ["with-base", "slot-only"],
      },
    ],
    scene: "generate_2d",
    model: "doubao",
    versions: [
      {
        version: "v1.0.0",
        content: "初始版本",
        createdAt: "2026-09-10T00:00:00Z",
        note: "亚克力立牌首发",
      },
    ],
    config: { style: "uv-print", material: "acrylic" },
    price: 159,
    status: "active",
    usageCount: 0,
    successRate: 0,
    avgDuration: 0,
    createdAt: "2026-09-10T00:00:00Z",
    updatedAt: "2026-09-10T00:00:00Z",
    author: "admin",
    productLineIds: ["pl_acrylic_stand"],
    productTypeCode: null,
    promptTemplateId: "tpl_acrylic_stand_v1",
  },
  {
    maskId: "MASK_LB_RESIN_PENDANT",
    name: "树脂挂件",
    category: "pendant",
    description:
      "UV 树脂挂件效果图：异形/半透/实色多种工艺，顶部挂孔一体，色彩晶莹。",
    previewUrl: "https://picsum.photos/seed/lb-resin/400/400",
    prompt: `将上传照片转换为 UV 树脂挂件效果图：异形轮廓（圆/星/心/水滴等可选），主体嵌入半透或实色 UV 树脂中，顶部一体挂孔可穿绳。树脂晶莹剔透或实色饱满，光影通透。4K 产品级摄影，白底正面，顶光透射。`,
    variables: [
      {
        key: "shape",
        label: "外形",
        defaultValue: "circle",
        required: false,
        options: ["circle", "star", "heart", "drop", "irregular"],
      },
      {
        key: "finish",
        label: "树脂效果",
        defaultValue: "semi-transparent",
        required: false,
        options: ["semi-transparent", "solid", "glow", "glitter"],
      },
    ],
    scene: "generate_2d",
    model: "nano_banana2",
    versions: [
      {
        version: "v1.0.0",
        content: "初始版本",
        createdAt: "2026-09-10T00:00:00Z",
        note: "树脂挂件首发",
      },
    ],
    config: { style: "crystal", material: "resin" },
    price: 79,
    status: "active",
    usageCount: 0,
    successRate: 0,
    avgDuration: 0,
    createdAt: "2026-09-10T00:00:00Z",
    updatedAt: "2026-09-10T00:00:00Z",
    author: "admin",
    productLineIds: ["pl_resin_pendant"],
    productTypeCode: null,
    promptTemplateId: "tpl_resin_pendant_v1",
  },
  {
    maskId: "MASK_LB_FRIDGE_MAGNET",
    name: "PVC 冰箱贴",
    category: "fridge_magnet",
    description:
      "PVC 立体冰箱贴效果图：软磁/硬磁 PVC，3D 浮雕造型，可吸合冰箱门。",
    previewUrl: "https://picsum.photos/seed/lb-magnet/400/400",
    prompt: `将上传照片转换为 PVC 立体冰箱贴效果图：主体 3D 浮雕呈现，软磁或硬磁 PVC 材质，色彩鲜艳饱满，背面磁条（不展示）。边缘圆润无锐角，可吸合在冰箱门上（环境道具可不展示）。4K 产品级摄影，白底正面，平视角度。`,
    variables: [
      {
        key: "magnet_type",
        label: "磁条类型",
        defaultValue: "soft",
        required: false,
        options: ["soft", "hard"],
      },
      {
        key: "finish",
        label: "工艺",
        defaultValue: "3d-relief",
        required: false,
        options: ["3d-relief", "flat", "glow"],
      },
    ],
    scene: "generate_2d",
    model: "doubao",
    versions: [
      {
        version: "v1.0.0",
        content: "初始版本",
        createdAt: "2026-09-10T00:00:00Z",
        note: "冰箱贴首发",
      },
    ],
    config: { style: "relief", material: "pvc" },
    price: 59,
    status: "active",
    usageCount: 0,
    successRate: 0,
    avgDuration: 0,
    createdAt: "2026-09-10T00:00:00Z",
    updatedAt: "2026-09-10T00:00:00Z",
    author: "admin",
    productLineIds: ["pl_fridge_magnet"],
    productTypeCode: null,
    promptTemplateId: "tpl_fridge_magnet_v1",
  },
];
