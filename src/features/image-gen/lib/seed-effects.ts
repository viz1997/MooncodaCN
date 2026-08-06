// 产品效果种子数据（演示用）
// 首次启动时由 effects-store 写入 data/product-effects.json，后续以文件为准
import type { ProductEffect } from "./product-effect-types";

export const SEED_PRODUCT_EFFECTS: ProductEffect[] = [
  {
    maskId: "MASK_001",
    name: "3D立体浮雕",
    category: "浮雕",
    description:
      "将照片转换为立体浮雕效果，适合人像、风景。保留面部特征与发型轮廓。",
    previewUrl: "https://picsum.photos/seed/mask1/400/400",
    prompt: `Convert the uploaded photo into a 2D relief-style illustration with the following requirements:
- Style: {{style}} (default: realistic relief)
- Material: {{material}} (default: resin)
- Preserve facial features: {{preserve_face}} (default: true)
- Background: {{background}} (default: solid color)

Ensure high fidelity to the original photo while applying the relief artistic style. The result should be suitable for 3D printing conversion.`,
    variables: [
      {
        key: "style",
        label: "艺术风格",
        defaultValue: "realistic relief",
        required: false,
        description: "realistic relief / cartoon / chibi",
      },
      {
        key: "material",
        label: "材质",
        defaultValue: "resin",
        required: false,
      },
      {
        key: "preserve_face",
        label: "保留面部",
        defaultValue: "true",
        required: true,
      },
      {
        key: "background",
        label: "背景处理",
        defaultValue: "solid color",
        required: false,
      },
    ],
    scene: "generate_2d",
    model: "doubao",
    versions: [
      {
        version: "v1.2.0",
        content: "...v1.2 增加背景变量",
        createdAt: "2026-06-15T08:00:00Z",
        note: "支持自定义背景",
      },
      {
        version: "v1.1.0",
        content: "...v1.1 增加材质选项",
        createdAt: "2026-03-10T10:00:00Z",
      },
      {
        version: "v1.0.0",
        content: "...初始版本",
        createdAt: "2025-06-01T00:00:00Z",
        note: "初始发布",
      },
    ],
    config: { style: "relief", material: "resin" },
    price: 99,
    status: "active",
    usageCount: 1280,
    successRate: 96,
    avgDuration: 3200,
    createdAt: "2025-06-01T00:00:00Z",
    updatedAt: "2026-06-15T08:00:00Z",
    author: "admin",
    productLineIds: ["PL_001", "PL_002", "PL_003", "PL_004"],
  },
  {
    maskId: "MASK_002",
    name: "Q版手办",
    category: "手办",
    description: "生成Q版卡通手办风格效果图，大头小身比例，适合3D打印手办。",
    previewUrl: "https://picsum.photos/seed/mask2/400/400",
    prompt: `Transform the photo into a chibi (Q-version) figurine style illustration:
- Head-to-body ratio: {{ratio}} (default: 1:2.5)
- Expression: {{expression}} (default: cheerful)
- Outfit: {{outfit}} (default: casual)
- Color palette: {{palette}} (default: vibrant)

The result should have exaggerated cute features suitable for 3D figurine printing.`,
    variables: [
      { key: "ratio", label: "头身比", defaultValue: "1:2.5", required: false },
      {
        key: "expression",
        label: "表情",
        defaultValue: "cheerful",
        required: false,
      },
      { key: "outfit", label: "服装", defaultValue: "casual", required: false },
      {
        key: "palette",
        label: "配色",
        defaultValue: "vibrant",
        required: false,
      },
    ],
    scene: "generate_2d",
    model: "doubao",
    versions: [
      {
        version: "v1.1.0",
        content: "...增加服装选项",
        createdAt: "2026-05-20T14:00:00Z",
      },
      {
        version: "v1.0.0",
        content: "...初始版本",
        createdAt: "2025-06-05T00:00:00Z",
      },
    ],
    config: { style: "chibi", color: "fullcolor" },
    price: 159,
    status: "active",
    usageCount: 2456,
    successRate: 94,
    avgDuration: 2800,
    createdAt: "2025-06-05T00:00:00Z",
    updatedAt: "2026-05-20T14:00:00Z",
    author: "admin",
    productLineIds: ["PL_001", "PL_002", "PL_003"],
  },
  {
    maskId: "MASK_003",
    name: "水晶内雕",
    category: "水晶",
    description: "水晶内部3D点阵雕刻效果图，纪念礼品首选。",
    previewUrl: "https://picsum.photos/seed/mask3/400/400",
    prompt: `Generate a crystal internal 3D engraving effect from the photo:
- Point density: {{density}} (default: high)
- Crystal shape: {{crystal_shape}} (default: rectangular)
- Brightness: {{brightness}} (default: 80%)

The effect should simulate subsurface laser engraving in transparent crystal.`,
    variables: [
      {
        key: "density",
        label: "点云密度",
        defaultValue: "high",
        required: false,
      },
      {
        key: "crystal_shape",
        label: "水晶形状",
        defaultValue: "rectangular",
        required: false,
      },
      {
        key: "brightness",
        label: "亮度",
        defaultValue: "80%",
        required: false,
      },
    ],
    scene: "generate_3d",
    model: "gpt_image_2",
    versions: [
      {
        version: "v1.0.0",
        content: "...初始版本",
        createdAt: "2025-06-10T00:00:00Z",
      },
    ],
    config: { style: "crystal", material: "glass" },
    price: 199,
    status: "active",
    usageCount: 856,
    successRate: 93,
    avgDuration: 22000,
    createdAt: "2025-06-10T00:00:00Z",
    updatedAt: "2025-06-10T00:00:00Z",
    author: "admin",
    productLineIds: ["PL_004"],
  },
  {
    maskId: "MASK_004",
    name: "真人雕像",
    category: "雕像",
    description: "1:6真人比例雕像效果图，超高还原度。",
    previewUrl: "https://picsum.photos/seed/mask4/400/400",
    prompt: `Create a realistic human statue effect with 1:6 scale preservation:
- Detail level: {{detail_level}} (default: ultra)
- Pose: {{pose}} (default: standing)
- Skin texture: {{skin_texture}} (default: realistic)

The result should look like a museum-grade collectible statue.`,
    variables: [
      {
        key: "detail_level",
        label: "细节级别",
        defaultValue: "ultra",
        required: false,
      },
      { key: "pose", label: "姿势", defaultValue: "standing", required: false },
      {
        key: "skin_texture",
        label: "皮肤纹理",
        defaultValue: "realistic",
        required: false,
      },
    ],
    scene: "generate_3d",
    model: "flux1",
    versions: [
      {
        version: "v1.0.0",
        content: "...初始版本",
        createdAt: "2025-06-15T00:00:00Z",
      },
    ],
    config: { style: "realistic", material: "resin" },
    price: 599,
    status: "active",
    usageCount: 432,
    successRate: 89,
    avgDuration: 42000,
    createdAt: "2025-06-15T00:00:00Z",
    updatedAt: "2025-06-15T00:00:00Z",
    author: "admin",
  },
  {
    maskId: "MASK_005",
    name: "动漫手办",
    category: "手办",
    description: "日漫风格手办效果图，二次元角色定制。",
    previewUrl: "https://picsum.photos/seed/mask5/400/400",
    prompt: `Transform the portrait into a Japanese anime-style character:
- Anime style: {{anime_style}} (default: shonen)
- Eye style: {{eye_style}} (default: large_sparkly)
- Hair style: {{hair_style}} (default: exaggerated)
- Color palette: {{palette}} (default: vibrant_anime)

The result should look like a frame from a Japanese animation.`,
    variables: [
      {
        key: "anime_style",
        label: "动漫风格",
        defaultValue: "shonen",
        required: false,
      },
      {
        key: "eye_style",
        label: "眼睛风格",
        defaultValue: "large_sparkly",
        required: false,
      },
      {
        key: "hair_style",
        label: "发型风格",
        defaultValue: "exaggerated",
        required: false,
      },
      {
        key: "palette",
        label: "配色",
        defaultValue: "vibrant_anime",
        required: false,
      },
    ],
    scene: "generate_2d",
    model: "nano_banana2",
    versions: [
      {
        version: "v1.2.0",
        content: "...增加发型选项",
        createdAt: "2026-06-18T15:00:00Z",
      },
      {
        version: "v1.0.0",
        content: "...初始版本",
        createdAt: "2025-06-20T00:00:00Z",
      },
    ],
    config: { style: "anime", color: "fullcolor" },
    price: 199,
    status: "active",
    usageCount: 1820,
    successRate: 92,
    avgDuration: 3500,
    createdAt: "2025-06-20T00:00:00Z",
    updatedAt: "2026-06-18T15:00:00Z",
    author: "designer_zhao",
    productLineIds: ["PL_001", "PL_002", "PL_003"],
  },
  {
    maskId: "MASK_006",
    name: "婚纱浮雕",
    category: "浮雕",
    description: "婚纱照专属浮雕效果图，浪漫永恒。",
    previewUrl: "https://picsum.photos/seed/mask6/400/400",
    prompt: `Apply a romantic wedding-themed relief to the photo:
- Style preset: {{preset}} (default: eternal_romance)
- Color tone: {{color_tone}} (default: warm pastel)
- Soft focus: {{soft_focus}} (default: 30%)
- Flower overlay: {{flowers}} (default: roses)

The result should evoke an eternal, dreamy wedding atmosphere.`,
    variables: [
      {
        key: "preset",
        label: "风格预设",
        defaultValue: "eternal_romance",
        required: false,
      },
      {
        key: "color_tone",
        label: "色调",
        defaultValue: "warm pastel",
        required: false,
      },
      {
        key: "soft_focus",
        label: "柔焦强度",
        defaultValue: "30%",
        required: false,
      },
      {
        key: "flowers",
        label: "花卉装饰",
        defaultValue: "roses",
        required: false,
      },
    ],
    scene: "stylize",
    model: "doubao",
    versions: [
      {
        version: "v1.0.0",
        content: "...初始版本",
        createdAt: "2025-06-25T00:00:00Z",
      },
    ],
    config: { style: "wedding", material: "resin" },
    price: 299,
    status: "inactive",
    usageCount: 268,
    successRate: 88,
    avgDuration: 4100,
    createdAt: "2025-06-25T00:00:00Z",
    updatedAt: "2026-04-10T11:00:00Z",
    author: "designer_wang",
    productLineIds: ["PL_003", "PL_004"],
  },
  {
    maskId: "MASK_007",
    name: "Q版宠物树脂浮雕挂件",
    category: "浮雕",
    description:
      "Q版宠物树脂浮雕挂件效果图：严格按上传照片还原宠物身份与配饰，2.5D 浅浮雕，单块实心树脂含顶部穿绳孔，适合定制宠物周边。",
    previewUrl: "https://picsum.photos/seed/mask7/400/400",
    prompt: `{{grid_layout}} of {{design_count}} premium chibi 3D resin pet bas-relief charms. Strictly match uploaded photo: identity ({{pet_identity}}), accessories ({{original_accessories}}), no species/color changes. Art: {{art_style}}, 2.5D shallow relief (not flat/figurine). Pet fills {{pet_proportion}}. Designs: {{shape_and_theme_list}}. Single solid resin piece, no metal/chain, built-in top resin hole. Thick, smooth, no fragile parts, simplified fur. {{material_type}}, pastel colors. 4K studio photo, white bg, front view, soft lighting.`,
    variables: [
      {
        key: "grid_layout",
        label: "布局排版",
        defaultValue: "grid 2x2",
        required: false,
        description: "grid 2x2 / grid 3x3 / single",
        options: ["grid 2x2", "grid 3x3", "single"],
      },
      {
        key: "design_count",
        label: "设计数量",
        defaultValue: "4",
        required: false,
        options: ["1", "2", "4", "6", "9"],
      },
      {
        key: "pet_identity",
        label: "宠物身份",
        defaultValue: "",
        required: true,
        description: "宠物品种/特征描述",
      },
      {
        key: "original_accessories",
        label: "原配饰",
        defaultValue: "as-is",
        required: false,
        description: "项圈/挂件等，保持原样",
      },
      {
        key: "art_style",
        label: "艺术风格",
        defaultValue: "chibi",
        required: false,
        options: ["chibi", "realistic", "cartoon"],
      },
      {
        key: "pet_proportion",
        label: "宠物占比",
        defaultValue: "80%",
        required: false,
        options: ["60%", "80%", "90%"],
      },
      {
        key: "shape_and_theme_list",
        label: "形状与主题列表",
        defaultValue: "heart, star, bone, paw",
        required: false,
        description: "多款形状/主题，逗号分隔",
      },
      {
        key: "material_type",
        label: "材质类型",
        defaultValue: "pastel resin",
        required: false,
        options: ["pastel resin", "clear resin", "matte resin"],
      },
    ],
    scene: "generate_2d",
    model: "doubao",
    versions: [
      {
        version: "v1.0.0",
        content: "...初始版本",
        createdAt: "2026-07-18T00:00:00Z",
        note: "Q版宠物树脂浮雕挂件首发",
      },
    ],
    config: { style: "chibi", material: "resin" },
    price: 129,
    status: "active",
    usageCount: 0,
    successRate: 0,
    avgDuration: 0,
    createdAt: "2026-07-18T00:00:00Z",
    updatedAt: "2026-07-18T00:00:00Z",
    author: "admin",
    productLineIds: ["PL_001", "PL_002", "PL_003"],
  },

  // ===== 以下条目从 mooncada-source/data/product-effects.json 导入 =====
  {
    maskId: "MASK_301",
    name: "测试",
    category: "浮雕",
    description: "测试效果",
    previewUrl: "https://picsum.photos/seed/newmask1784511475301/400/400",
    prompt: `
A single image containing a perfectly aligned 3×3 contact-sheet grid with uniform white gutters between cells. Each cell is a self-contained premium chibi-style 3D resin pet relief hanging charm. All 9 charms share identical pet identity, style, lighting, and material. White seamless background across the entire grid.

═══════════════════════════════════════════════════════
CHARACTER LOCK — IDENTICAL ACROSS ALL 9 CELLS:
═══════════════════════════════════════════════════════
[UPLOAD YOUR PET REFERENCE IMAGE AS CHARACTER REFERENCE]

Same pet in every cell: [describe your pet precisely here — species, breed, colors, markings, eye color, nose shape, ear type, expression, any accessories with exact colors and positions]

═══════════════════════════════════════════════════════
GRID LAYOUT — 3 ROWS × 3 COLUMNS, LEFT→RIGHT, TOP→BOTTOM:
═══════════════════════════════════════════════════════

CELL 1 — CIRCULAR shape:
Cozy home scene. The chibi pet sits inside a round resin frame shaped like a fluffy cushion. Built-in resin hanging hole at top center, thick rounded loop growing from the circle edge. Pet occupies 80% of charm. 2.5D bas-relief, smooth rounded edges.

CELL 2 — ROUNDED SQUARE shape:
Sleeping scene. The chibi pet curled up asleep on a soft pillow background. Rounded-square resin frame with built-in hanging hole at top center. Pet occupies 80% of charm. 2.5D bas-relief, smooth rounded edges.

CELL 3 — ORGANIC BLOB shape:
Playful toy scene. The chibi pet playing with a small ball. Organic flowing blob-shaped resin frame with built-in hanging hole at top center. Pet occupies 80% of charm. 2.5D bas-relief, smooth rounded edges.

CELL 4 — FLOWER shape:
Flower garden scene. The chibi pet surrounded by stylized flower petals. Flower-shaped resin frame (5 rounded petals) with built-in hanging hole at top center of top petal. Pet occupies 80% of charm. 2.5D bas-relief, smooth rounded edges.

CELL 5 — CLOUD shape:
Fantasy cloud scene. The chibi pet floating on a soft cloud. Cloud-shaped puffy resin frame with built-in hanging hole at top center. Pet occupies 80% of charm. 2.5D bas-relief, smooth rounded edges.

CELL 6 — HEART shape:
Seasonal holiday scene. The chibi pet inside a heart frame with tiny stars. Heart-shaped resin frame with built-in hanging hole at top center of heart curve. Pet occupies 80% of charm. 2.5D bas-relief, smooth rounded edges.

CELL 7 — HOUSE shape:
Outdoor adventure scene. The chibi pet peeking out of a tiny house frame. House-shaped resin frame with rounded roof and built-in hanging hole at top center of roof peak. Pet occupies 80% of charm. 2.5D bas-relief, smooth rounded edges.

CELL 8 — ROUNDED RECTANGLE shape:
Cute food theme. The chibi pet with a small food item (bowl/treat). Rounded-rectangle resin frame with built-in hanging hole at top center. Pet occupies 80% of charm. 2.5D bas-relief, smooth rounded edges.

CELL 9 — CREATIVE IRREGULAR SILHOUETTE:
Dreamy cartoon environment. The chibi pet in a whimsical abstract frame with stars and swirls. Creative irregular rounded silhouette with built-in hanging hole at top center. Pet occupies 80% of charm. 2.5D bas-relief, smooth rounded edges.

═══════════════════════════════════════════════════════
UNIFIED STYLE ACROSS ALL CELLS:
═══════════════════════════════════════════════════════

Style: Cute realistic chibi fusion — oversized cute head, compact rounded body, short stable neck, cute expressive eyes, soft rounded facial features, realistic breed identity preserved.

Product: Premium 3D resin bas-relief hanging charm. Single integrated resin piece, no metal, no chain, no external ring. Built-in resin hanging hole at top, directly connected, centered, rounded and thick, same material as charm.

Relief: 2.5D shallow bas-relief sculpture. Pet smoothly emerges from background. Not flat illustration, not full-body toy figure.

Manufacturing-friendly: Large simple sculpted forms, smooth rounded edges, no fragile thin parts, no floating geometry, no deep undercuts, no sharp edges, all elements merged into one solid resin piece.

Fur/feathers/scales: Broad sculpted masses, simplified flowing shapes, no individual hair strands.
Whiskers: No separate geometry, subtle engraved lines only if needed.

Material: Premium painted resin collectible. Handcrafted resin texture, semi-matte satin finish, subtle glossy highlights, vibrant pastel colors, high quality collectible appearance.

Presentation: Professional 4K studio product photography. White background, front view, clean arrangement, soft even lighting, high detail. No packaging, no display stand.

═══════════════════════════════════════════════════════
GRID TECHNICAL SPECIFICATIONS:
═══════════════════════════════════════════════════════

- One single image, 3×3 grid layout
- Equal cell sizes, perfectly aligned rows and columns
- Thin uniform white gutters/borders between all cells
- Each cell is a complete standalone charm design
- No content bleeds across cell boundaries
- Each charm centered within its cell with generous margin
- Consistent scale: all pets rendered at same relative size
- Front-facing view for all charms
- Identical lighting direction across all cells

═══════════════════════════════════════════════════════
NEGATIVE:
═══════════════════════════════════════════════════════

wrong animal species, wrong breed, changed markings, changed face, different accessory, missing original accessory, metal keychain, metal ring, chain, plastic toy, anime style, cartoon exaggeration, flat illustration, transparent resin, glass effect, thin fragile details, individual fur strands, floating parts, base, stand, frame, text, logo, watermark, cropped charm, incomplete design, uneven grid, misaligned cells, content bleeding across cells, different scale per cell, different lighting per cell, background clutter, dark background, shadow cast on grid
`,
    variables: [],
    scene: "generate_2d",
    model: "nano_banana2",
    versions: [
      {
        version: "v1.0.0",
        content: `
A single image containing a perfectly aligned 3×3 contact-sheet grid with uniform white gutters between cells. Each cell is a self-contained premium chibi-style 3D resin pet relief hanging charm. All 9 charms share identical pet identity, style, lighting, and material. White seamless background across the entire grid.

═══════════════════════════════════════════════════════
CHARACTER LOCK — IDENTICAL ACROSS ALL 9 CELLS:
═══════════════════════════════════════════════════════
[UPLOAD YOUR PET REFERENCE IMAGE AS CHARACTER REFERENCE]

Same pet in every cell: [describe your pet precisely here — species, breed, colors, markings, eye color, nose shape, ear type, expression, any accessories with exact colors and positions]

═══════════════════════════════════════════════════════
GRID LAYOUT — 3 ROWS × 3 COLUMNS, LEFT→RIGHT, TOP→BOTTOM:
═══════════════════════════════════════════════════════

CELL 1 — CIRCULAR shape:
Cozy home scene. The chibi pet sits inside a round resin frame shaped like a fluffy cushion. Built-in resin hanging hole at top center, thick rounded loop growing from the circle edge. Pet occupies 80% of charm. 2.5D bas-relief, smooth rounded edges.

CELL 2 — ROUNDED SQUARE shape:
Sleeping scene. The chibi pet curled up asleep on a soft pillow background. Rounded-square resin frame with built-in hanging hole at top center. Pet occupies 80% of charm. 2.5D bas-relief, smooth rounded edges.

CELL 3 — ORGANIC BLOB shape:
Playful toy scene. The chibi pet playing with a small ball. Organic flowing blob-shaped resin frame with built-in hanging hole at top center. Pet occupies 80% of charm. 2.5D bas-relief, smooth rounded edges.

CELL 4 — FLOWER shape:
Flower garden scene. The chibi pet surrounded by stylized flower petals. Flower-shaped resin frame (5 rounded petals) with built-in hanging hole at top center of top petal. Pet occupies 80% of charm. 2.5D bas-relief, smooth rounded edges.

CELL 5 — CLOUD shape:
Fantasy cloud scene. The chibi pet floating on a soft cloud. Cloud-shaped puffy resin frame with built-in hanging hole at top center. Pet occupies 80% of charm. 2.5D bas-relief, smooth rounded edges.

CELL 6 — HEART shape:
Seasonal holiday scene. The chibi pet inside a heart frame with tiny stars. Heart-shaped resin frame with built-in hanging hole at top center of heart curve. Pet occupies 80% of charm. 2.5D bas-relief, smooth rounded edges.

CELL 7 — HOUSE shape:
Outdoor adventure scene. The chibi pet peeking out of a tiny house frame. House-shaped resin frame with rounded roof and built-in hanging hole at top center of roof peak. Pet occupies 80% of charm. 2.5D bas-relief, smooth rounded edges.

CELL 8 — ROUNDED RECTANGLE shape:
Cute food theme. The chibi pet with a small food item (bowl/treat). Rounded-rectangle resin frame with built-in hanging hole at top center. Pet occupies 80% of charm. 2.5D bas-relief, smooth rounded edges.

CELL 9 — CREATIVE IRREGULAR SILHOUETTE:
Dreamy cartoon environment. The chibi pet in a whimsical abstract frame with stars and swirls. Creative irregular rounded silhouette with built-in hanging hole at top center. Pet occupies 80% of charm. 2.5D bas-relief, smooth rounded edges.

═══════════════════════════════════════════════════════
UNIFIED STYLE ACROSS ALL CELLS:
═══════════════════════════════════════════════════════

Style: Cute realistic chibi fusion — oversized cute head, compact rounded body, short stable neck, cute expressive eyes, soft rounded facial features, realistic breed identity preserved.

Product: Premium 3D resin bas-relief hanging charm. Single integrated resin piece, no metal, no chain, no external ring. Built-in resin hanging hole at top, directly connected, centered, rounded and thick, same material as charm.

Relief: 2.5D shallow bas-relief sculpture. Pet smoothly emerges from background. Not flat illustration, not full-body toy figure.

Manufacturing-friendly: Large simple sculpted forms, smooth rounded edges, no fragile thin parts, no floating geometry, no deep undercuts, no sharp edges, all elements merged into one solid resin piece.

Fur/feathers/scales: Broad sculpted masses, simplified flowing shapes, no individual hair strands.
Whiskers: No separate geometry, subtle engraved lines only if needed.

Material: Premium painted resin collectible. Handcrafted resin texture, semi-matte satin finish, subtle glossy highlights, vibrant pastel colors, high quality collectible appearance.

Presentation: Professional 4K studio product photography. White background, front view, clean arrangement, soft even lighting, high detail. No packaging, no display stand.

═══════════════════════════════════════════════════════
GRID TECHNICAL SPECIFICATIONS:
═══════════════════════════════════════════════════════

- One single image, 3×3 grid layout
- Equal cell sizes, perfectly aligned rows and columns
- Thin uniform white gutters/borders between all cells
- Each cell is a complete standalone charm design
- No content bleeds across cell boundaries
- Each charm centered within its cell with generous margin
- Consistent scale: all pets rendered at same relative size
- Front-facing view for all charms
- Identical lighting direction across all cells

═══════════════════════════════════════════════════════
NEGATIVE:
═══════════════════════════════════════════════════════

wrong animal species, wrong breed, changed markings, changed face, different accessory, missing original accessory, metal keychain, metal ring, chain, plastic toy, anime style, cartoon exaggeration, flat illustration, transparent resin, glass effect, thin fragile details, individual fur strands, floating parts, base, stand, frame, text, logo, watermark, cropped charm, incomplete design, uneven grid, misaligned cells, content bleeding across cells, different scale per cell, different lighting per cell, background clutter, dark background, shadow cast on grid
`,
        createdAt: "2026-07-20T01:37:55.301Z",
        note: "初始版本",
      },
    ],
    config: {
      style: "custom",
    },
    price: 99,
    status: "active",
    usageCount: 0,
    successRate: 0,
    avgDuration: 0,
    createdAt: "2026-07-20T01:37:55.301Z",
    updatedAt: "2026-07-20T01:37:55.301Z",
    author: "admin",
    productLineIds: ["PL_001", "PL_002", "PL_003"],
  },
  {
    maskId: "MASK_293",
    name: "Q版宠物树脂浮雕挂件",
    category: "浮雕",
    description:
      "Q版宠物树脂浮雕挂件效果图：严格按上传照片还原宠物身份与配饰，2.5D 浅浮雕，单块实心树脂含顶部穿绳孔，适合定制宠物周边。",
    previewUrl: "https://picsum.photos/seed/newmask1784353018293/400/400",
    prompt: `
{{grid_layout}} of {{design_count}} premium chibi 3D resin pet bas-relief charms. Strictly match uploaded photo: identity ({{pet_identity}}), accessories ({{original_accessories}}), no species/color changes. Art: {{art_style}}, 2.5D shallow relief (not flat/figurine). Pet fills {{pet_proportion}}. Designs: {{shape_and_theme_list}}. Single solid resin piece, no metal/chain, built-in top resin hole. Thick, smooth, no fragile parts, simplified fur. {{material_type}}, pastel colors. 4K studio photo, white bg, front view, soft lighting.
`,
    variables: [
      {
        key: "grid_layout",
        label: "布局排版",
        defaultValue: "grid 3x3",
        required: false,
        description: "grid 2x2 / grid 3x3 / single",
        options: ["grid 2x2", "grid 3x3", "single"],
      },
      {
        key: "design_count",
        label: "设计数量",
        defaultValue: "9",
        required: false,
        options: ["1", "2", "4", "6", "9"],
      },
      {
        key: "pet_identity",
        label: "宠物身份",
        defaultValue: "",
        required: false,
        description: "宠物品种/特征描述",
      },
      {
        key: "original_accessories",
        label: "原配饰",
        defaultValue: "as-is",
        required: false,
        description: "项圈/挂件等，保持原样",
      },
      {
        key: "art_style",
        label: "艺术风格",
        defaultValue: "chibi",
        required: false,
        options: ["chibi", "realistic", "cartoon"],
      },
      {
        key: "pet_proportion",
        label: "宠物占比",
        defaultValue: "80%",
        required: false,
        options: ["60%", "80%", "90%"],
      },
      {
        key: "shape_and_theme_list",
        label: "形状与主题列表",
        defaultValue: "heart, star, bone, paw",
        required: false,
        description: "多款形状/主题，逗号分隔",
      },
      {
        key: "material_type",
        label: "材质类型",
        defaultValue: "pastel resin",
        required: false,
        options: ["pastel resin", "clear resin", "matte resin"],
      },
    ],
    scene: "generate_2d",
    model: "nano_banana2",
    versions: [
      {
        version: "v1.0.0",
        content: `
{{grid_layout}} of {{design_count}} premium chibi 3D resin pet bas-relief charms. Strictly match uploaded photo: identity ({{pet_identity}}), accessories ({{original_accessories}}), no species/color changes. Art: {{art_style}}, 2.5D shallow relief (not flat/figurine). Pet fills {{pet_proportion}}. Designs: {{shape_and_theme_list}}. Single solid resin piece, no metal/chain, built-in top resin hole. Thick, smooth, no fragile parts, simplified fur. {{material_type}}, pastel colors. 4K studio photo, white bg, front view, soft lighting.
`,
        createdAt: "2026-07-18T05:36:58.293Z",
        note: "初始版本",
      },
    ],
    config: {
      style: "chibi",
      material: "resin",
    },
    price: 99,
    status: "active",
    usageCount: 0,
    successRate: 0,
    avgDuration: 0,
    createdAt: "2026-07-18T05:36:58.293Z",
    updatedAt: "2026-07-18T05:38:54.935Z",
    author: "admin",
    productLineIds: ["PL_002"],
  },
  {
    maskId: "MASK_617",
    name: "浮雕钥匙扣",
    category: "浮雕",
    description: "浮雕钥匙扣效果",
    previewUrl: "https://picsum.photos/seed/newmask1784283775617/400/400",
    prompt: `
Create a 3×3 grid of premium chibi-style 3D resin pet relief hanging charms based on the uploaded pet reference image.

THE UPLOADED PET PHOTO IS THE ABSOLUTE REFERENCE.

Strictly preserve the original pet's identity:
- exact species
- breed characteristics
- body proportions
- face shape
- eye shape and color
- nose shape
- ears or unique features
- fur, feathers, scales or skin colors
- markings and patterns
- original expression
- unique personality

DO NOT redesign the pet.
DO NOT change the species.
DO NOT turn the pet into another animal.
DO NOT invent new colors or markings.

ORIGINAL ACCESSORIES PRESERVATION:
Any accessories, clothing, hats, scarves, towels, collars, costumes or decorations visible in the reference image are part of the pet's identity.

Accurately preserve:
- original shape
- position
- color
- material appearance
- recognizable design features

Do not replace the original accessory with a different style.

STYLE:
Cute realistic chibi fusion style.

Transform the pet into a premium collectible chibi resin sculpture:
- oversized cute head
- compact rounded body
- short stable neck
- cute expressive eyes
- soft rounded facial features
- realistic breed identity preserved

PRODUCT TYPE:
Premium 3D resin bas-relief hanging charm collection.

Create 9 different creative designs arranged in a clean 3×3 grid.

Each design must be:
- a single integrated resin piece
- no metal keychain
- no chain
- no external ring
- no separate hardware

HANGING HOLE DESIGN:
Create a built-in resin hanging hole at the top.

The hole must:
- be directly connected to the charm body
- grow naturally from the silhouette
- centered at the top
- rounded and thick enough for manufacturing
- same resin material as the charm

Do NOT add metal accessories.

SHAPE VARIATIONS:
Create different charm silhouettes:

1. circular shape
2. rounded square shape
3. organic blob shape
4. flower shape
5. cloud shape
6. heart shape
7. house shape
8. rounded rectangle shape
9. creative irregular silhouette

CREATIVE THEMES:
Keep the pet as the main focus and create cute collectible scenes:

- cozy home scene
- sleeping scene
- playful toy scene
- flower garden scene
- seasonal holiday scene
- fantasy cloud scene
- outdoor adventure scene
- cute food theme
- dreamy cartoon environment

PET PROPORTION:
The pet occupies approximately 70–85% of each charm.

RELIEF STYLE:
2.5D shallow bas-relief sculpture.

Not a flat illustration.
Not a full-body toy figure.

The pet should smoothly emerge from the background.

MANUFACTURING FRIENDLY DESIGN:
Designed for resin 3D printing and silicone mold casting:

- large simple sculpted forms
- smooth rounded edges
- no fragile thin parts
- no floating geometry
- no deep undercuts
- no sharp edges
- all elements merged into one solid resin piece

DETAIL RULES:
Fur / feathers / scales:
- represented by broad sculpted masses
- simplified flowing shapes
- no individual hair strands

Whiskers:
- no separate whisker geometry
- use subtle engraved lines only if needed

MATERIAL:
Premium painted resin collectible.

Surface:
- handcrafted resin texture
- semi-matte satin finish
- subtle glossy highlights
- vibrant pastel colors
- high quality collectible appearance

PRODUCT PRESENTATION:
Professional 4K studio product photography.

White background.
Front view.
Clean arrangement.
Soft even lighting.
High detail.
No packaging.
No display stand.

NEGATIVE PROMPT:

wrong animal species,
wrong breed,
changed markings,
changed face,
different accessory,
missing original accessory,
metal keychain,
metal ring,
chain,
plastic toy,
anime style,
cartoon exaggeration,
flat illustration,
transparent resin,
glass effect,
thin fragile details,
individual fur strands,
floating parts,
base,
stand,
frame,
text,
logo,
watermark.
`,
    variables: [],
    scene: "generate_2d",
    model: "nano_banana2",
    versions: [
      {
        version: "v1.0.0",
        content: `
Create a 3×3 grid of premium chibi-style 3D resin pet relief hanging charms based on the uploaded pet reference image.

THE UPLOADED PET PHOTO IS THE ABSOLUTE REFERENCE.

Strictly preserve the original pet's identity:
- exact species
- breed characteristics
- body proportions
- face shape
- eye shape and color
- nose shape
- ears or unique features
- fur, feathers, scales or skin colors
- markings and patterns
- original expression
- unique personality

DO NOT redesign the pet.
DO NOT change the species.
DO NOT turn the pet into another animal.
DO NOT invent new colors or markings.

ORIGINAL ACCESSORIES PRESERVATION:
Any accessories, clothing, hats, scarves, towels, collars, costumes or decorations visible in the reference image are part of the pet's identity.

Accurately preserve:
- original shape
- position
- color
- material appearance
- recognizable design features

Do not replace the original accessory with a different style.

STYLE:
Cute realistic chibi fusion style.

Transform the pet into a premium collectible chibi resin sculpture:
- oversized cute head
- compact rounded body
- short stable neck
- cute expressive eyes
- soft rounded facial features
- realistic breed identity preserved

PRODUCT TYPE:
Premium 3D resin bas-relief hanging charm collection.

Create 9 different creative designs arranged in a clean 3×3 grid.

Each design must be:
- a single integrated resin piece
- no metal keychain
- no chain
- no external ring
- no separate hardware

HANGING HOLE DESIGN:
Create a built-in resin hanging hole at the top.

The hole must:
- be directly connected to the charm body
- grow naturally from the silhouette
- centered at the top
- rounded and thick enough for manufacturing
- same resin material as the charm

Do NOT add metal accessories.

SHAPE VARIATIONS:
Create different charm silhouettes:

1. circular shape
2. rounded square shape
3. organic blob shape
4. flower shape
5. cloud shape
6. heart shape
7. house shape
8. rounded rectangle shape
9. creative irregular silhouette

CREATIVE THEMES:
Keep the pet as the main focus and create cute collectible scenes:

- cozy home scene
- sleeping scene
- playful toy scene
- flower garden scene
- seasonal holiday scene
- fantasy cloud scene
- outdoor adventure scene
- cute food theme
- dreamy cartoon environment

PET PROPORTION:
The pet occupies approximately 70–85% of each charm.

RELIEF STYLE:
2.5D shallow bas-relief sculpture.

Not a flat illustration.
Not a full-body toy figure.

The pet should smoothly emerge from the background.

MANUFACTURING FRIENDLY DESIGN:
Designed for resin 3D printing and silicone mold casting:

- large simple sculpted forms
- smooth rounded edges
- no fragile thin parts
- no floating geometry
- no deep undercuts
- no sharp edges
- all elements merged into one solid resin piece

DETAIL RULES:
Fur / feathers / scales:
- represented by broad sculpted masses
- simplified flowing shapes
- no individual hair strands

Whiskers:
- no separate whisker geometry
- use subtle engraved lines only if needed

MATERIAL:
Premium painted resin collectible.

Surface:
- handcrafted resin texture
- semi-matte satin finish
- subtle glossy highlights
- vibrant pastel colors
- high quality collectible appearance

PRODUCT PRESENTATION:
Professional 4K studio product photography.

White background.
Front view.
Clean arrangement.
Soft even lighting.
High detail.
No packaging.
No display stand.

NEGATIVE PROMPT:

wrong animal species,
wrong breed,
changed markings,
changed face,
different accessory,
missing original accessory,
metal keychain,
metal ring,
chain,
plastic toy,
anime style,
cartoon exaggeration,
flat illustration,
transparent resin,
glass effect,
thin fragile details,
individual fur strands,
floating parts,
base,
stand,
frame,
text,
logo,
watermark.
`,
        createdAt: "2026-07-17T10:22:55.617Z",
        note: "初始版本",
      },
    ],
    config: {
      style: "custom",
    },
    price: 99,
    status: "active",
    usageCount: 0,
    successRate: 0,
    avgDuration: 0,
    createdAt: "2026-07-17T10:22:55.617Z",
    updatedAt: "2026-07-17T13:17:02.871Z",
    author: "admin",
  },
];
