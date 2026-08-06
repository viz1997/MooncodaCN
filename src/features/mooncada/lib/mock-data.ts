// Mooncada 3D 打印系统 - Mock 数据（演示用）
import type {
  DashboardStats,
  DesignerStats,
  Effect2D,
  Model3D,
  Order,
  Photo,
  PlatformUser,
  ProductEffect,
  ProductLine,
  ProxyInfo,
  ProxyWithdrawal,
  SysLog,
  Task,
  User,
  UserRole,
  Withdrawal,
} from "./types";

// ============ 确定性伪随机生成器（避免 SSR/CSR Hydration 不一致） ============
// 使用 LCG (Linear Congruential Generator) 算法，保证服务端和客户端生成相同序列
function createSeededRandom(seed: number) {
  let state = seed;
  return () => {
    // LCG 参数（glibc 选用值）
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}
// 全局种子随机实例（模块级单例，服务端/客户端都会以相同种子初始化）
const seededRandom = createSeededRandom(42);

// ============ 当前登录用户（用于角色切换演示） ============
export const CURRENT_USERS: Record<UserRole, User> = {
  admin: {
    userId: "U_ADMIN_001",
    username: "admin",
    email: "admin@mooncada.com",
    phone: "13800000001",
    role: "admin",
    createdAt: "2025-01-01T00:00:00Z",
    lastLoginAt: "2026-07-10T03:20:00Z",
    status: "active",
  },
  agent: {
    userId: "U_AGENT_001",
    username: "agent_li",
    email: "agent@mooncada.com",
    phone: "13800000002",
    role: "agent",
    proxyId: "P_001",
    balance: 8520.5,
    createdAt: "2025-03-15T08:00:00Z",
    lastLoginAt: "2026-07-09T22:15:00Z",
    status: "active",
  },
  designer: {
    userId: "U_DES_001",
    username: "designer_wang",
    email: "wang@mooncada.com",
    phone: "13800000003",
    role: "designer",
    balance: 12680.0,
    createdAt: "2025-02-20T10:00:00Z",
    lastLoginAt: "2026-07-10T01:45:00Z",
    status: "active",
  },
  operator: {
    userId: "U_OP_001",
    username: "operator_zhang",
    email: "zhang@mooncada.com",
    phone: "13800000004",
    role: "operator",
    createdAt: "2025-04-10T09:00:00Z",
    lastLoginAt: "2026-07-10T02:30:00Z",
    status: "active",
  },
  user: {
    userId: "U_USER_001",
    username: "customer_chen",
    email: "chen@example.com",
    phone: "13800000005",
    role: "user",
    proxyId: "P_001",
    createdAt: "2025-05-22T14:30:00Z",
    lastLoginAt: "2026-07-09T18:20:00Z",
    status: "active",
  },
};

// ============ 图片库 ============
const PHOTO_SEEDS = [
  { name: "portrait_01.jpg", w: 1080, h: 1350 },
  { name: "family_photo.png", w: 1920, h: 1280 },
  { name: "couple_2025.jpg", w: 1200, h: 1200 },
  { name: "baby_first.png", w: 1024, h: 1024 },
  { name: "wedding_shot.jpg", w: 2048, h: 1536 },
  { name: "graduation.jpg", w: 1080, h: 1440 },
  { name: "pet_dog.jpg", w: 1280, h: 1280 },
  { name: "team_photo.png", w: 1600, h: 900 },
];

export const MOCK_PHOTOS: Photo[] = PHOTO_SEEDS.map((p, i) => ({
  photoId: `PH_${String(i + 1).padStart(4, "0")}`,
  userId: "U_USER_001",
  fileName: p.name,
  fileSize: Math.floor(2.5 * 1024 * 1024 * (i + 1) * 0.3),
  fileUrl: `https://picsum.photos/seed/mooncada${i + 1}/800/800`,
  thumbnailUrl: `https://picsum.photos/seed/mooncada${i + 1}/200/200`,
  md5: `a3f5b8c9${String(i).padStart(8, "0")}d2e1f0a${String(i + 5).padStart(4, "0")}`,
  width: p.w,
  height: p.h,
  format: p.name.split(".").pop() as "jpg" | "png",
  uploadedAt: `2026-07-${String(10 - Math.floor(i / 2)).padStart(2, "0")}T${10 + i}:2${i}:00Z`,
}));

// ============ 产品效果（模版） ============
export const MOCK_PRODUCT_EFFECTS: ProductEffect[] = [
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
];

// ============ 2D 效果图历史 ============
const EFFECT_IMAGE_MODELS = [
  "doubao",
  "dalle3",
  "sd3",
  "flux1",
  "doubao",
  "midjourney",
  "wanx",
  "gpt_image_2",
  "nano_banana2",
  "ernie",
] as const;
const EFFECT_IMAGE_MODEL_NAMES: Record<string, string> = {
  dalle3: "DALL·E 3",
  sd3: "SD 3",
  flux1: "Flux.1",
  midjourney: "Midjourney",
  doubao: "即梦",
  wanx: "通义万相",
  ernie: "文心一格",
  cogview: "CogView",
  gpt_image_2: "GPT-Image-2",
  nano_banana2: "Nano Banana 2",
};
const EFFECT_DURATIONS = [
  4500, 12000, 8000, 5500, 4500, 35000, 6500, 9000, 3500, 8000,
];
const EFFECT_COSTS = [
  0.24, 0.04, 0.12, 0.05, 0.24, 0.4, 0.64, 0.04, 0.025, 0.24,
];
const EFFECT_CURRENCIES = [
  "CNY",
  "USD",
  "USD",
  "USD",
  "CNY",
  "USD",
  "CNY",
  "USD",
  "USD",
  "CNY",
];

export const MOCK_EFFECTS: Effect2D[] = Array.from({ length: 10 }, (_, i) => {
  const mask = MOCK_PRODUCT_EFFECTS[i % MOCK_PRODUCT_EFFECTS.length];
  const photo = MOCK_PHOTOS[i % MOCK_PHOTOS.length];
  const statuses: Effect2D["status"][] = [
    "completed",
    "completed",
    "completed",
    "processing",
    "completed",
    "failed",
    "completed",
    "completed",
    "pending",
    "completed",
  ];
  const imageModel = EFFECT_IMAGE_MODELS[i];
  // 将 prompt 中的变量替换为默认值
  let renderedPrompt = mask.prompt;
  mask.variables.forEach((v) => {
    renderedPrompt = renderedPrompt.replace(
      new RegExp(`\\{\\{${v.key}\\}\\}`, "g"),
      v.defaultValue
    );
  });
  return {
    effectId: `EF_${String(i + 1).padStart(4, "0")}`,
    userId: "U_USER_001",
    photoId: photo.photoId,
    photoUrl: photo.thumbnailUrl,
    maskId: mask.maskId,
    maskName: mask.name,
    status: statuses[i],
    resultUrls:
      statuses[i] === "completed"
        ? [
            `https://picsum.photos/seed/effect${i}a/400/400`,
            `https://picsum.photos/seed/effect${i}b/400/400`,
            `https://picsum.photos/seed/effect${i}c/400/400`,
          ]
        : [],
    prompt: renderedPrompt,
    createdAt: `2026-07-${String(10 - Math.floor(i / 2)).padStart(2, "0")}T${12 + i}:00:00Z`,
    completedAt:
      statuses[i] === "completed"
        ? `2026-07-${String(10 - Math.floor(i / 2)).padStart(2, "0")}T${12 + i}:15:00Z`
        : undefined,
    errorMsg: statuses[i] === "failed" ? "AI 服务超时，请重试" : undefined,
    // 生图模型字段
    imageModel,
    imageModelName: EFFECT_IMAGE_MODEL_NAMES[imageModel],
    mode: "image_to_image",
    generateDuration: EFFECT_DURATIONS[i],
    cost: EFFECT_COSTS[i],
    currency: EFFECT_CURRENCIES[i],
    revisedPrompt:
      imageModel === "dalle3"
        ? `Enhanced: ${renderedPrompt.slice(0, 80)}...`
        : undefined,
    seed: 1000000 + i * 12345,
  };
});

// ============ 3D 模型 ============
const MODEL_PROVIDERS = [
  "meshy",
  "tripo3d",
  "hunyuan3d",
  "hyper3d",
  "hitem3d",
  "meshy",
] as const;
const MODEL_PROVIDER_NAMES: Record<string, string> = {
  meshy: "Meshy",
  tripo3d: "Tripo3D",
  hunyuan3d: "混元3D",
  hyper3d: "Hyper3D",
  hitem3d: "Hitem3D",
  triverse3d: "Triverse3D",
};
const MODEL_PROMPTS = [
  "3D relief sculpture, preserve facial features",
  "chibi figurine, big head small body",
  "realistic human statue, 1:6 scale",
  "crystal internal engraving, point cloud",
  "anime character, vibrant colors",
  "wedding photo relief, romantic",
];
const MODEL_DURATIONS = [18500, 25000, 32000, 42000, 15000, 18500];

export const MOCK_MODELS: Model3D[] = Array.from({ length: 6 }, (_, i) => {
  const eff = MOCK_EFFECTS[i];
  const date = new Date(2026, 6, 8 - i);
  const dateStr = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
  const orderId = `ORD${String(1000 + i).padStart(6, "0")}`;
  const downloadCount = Math.floor(seededRandom() * 12);
  const provider = MODEL_PROVIDERS[i];
  return {
    modelId: `MD_${String(i + 1).padStart(4, "0")}`,
    effectId: eff.effectId,
    userId: "U_USER_001",
    orderId,
    taskNum: i + 1,
    status: "completed",
    originalFileUrl: "#",
    printFileUrl: "#",
    previewUrl: `https://picsum.photos/seed/model3d${i}/400/400`,
    downloadCount,
    suggestedFileName: `${dateStr}_${orderId}_TASK${i + 1}.zip`,
    createdAt: `2026-07-${String(8 - i).padStart(2, "0")}T${14 + i}:00:00Z`,
    warning:
      downloadCount > 10
        ? "下载次数过多，请确认文件版本"
        : downloadCount > 5
          ? "请确认使用最新版本"
          : undefined,
    // 3D 引擎扩展字段
    provider,
    providerName: MODEL_PROVIDER_NAMES[provider],
    generateDuration: MODEL_DURATIONS[i],
    polyCount: 50000 + Math.floor(seededRandom() * 60000),
    textureResolution: i % 2 === 0 ? 4096 : 2048,
    cost:
      provider === "hunyuan3d" || provider === "hitem3d"
        ? 2.5 - i * 0.3
        : 1.2 - i * 0.1,
    currency:
      provider === "hunyuan3d" || provider === "hitem3d" ? "CNY" : "USD",
    inputType: "image" as const,
    prompt: MODEL_PROMPTS[i] ?? eff.prompt,
  };
});

// ============ 订单 ============
export const MOCK_ORDERS: Order[] = Array.from({ length: 8 }, (_, i) => {
  const model = MOCK_MODELS[i % MOCK_MODELS.length];
  const statuses: Order["status"][] = [
    "completed",
    "shipped",
    "producing",
    "paid",
    "paid",
    "pending",
    "completed",
    "shipped",
  ];
  const status = statuses[i];
  const date = new Date(2026, 6, 8 - i);
  const orderDate = date.toISOString();
  return {
    orderId: `ORD${String(1000 + i).padStart(6, "0")}`,
    userId: "U_USER_001",
    username: "customer_chen",
    proxyId: i % 3 === 0 ? "P_001" : undefined,
    items: [
      {
        itemId: `IT_${i}_1`,
        modelId: model.modelId,
        name: model.effectId
          ? `${MOCK_EFFECTS.find((e) => e.effectId === model.effectId)?.maskName ?? "3D模型"}定制`
          : "3D模型定制",
        quantity: 1,
        price: model.taskNum ? 99 + model.taskNum * 30 : 99,
        previewUrl: model.previewUrl,
      },
    ],
    totalAmount: model.taskNum ? 99 + model.taskNum * 30 : 99,
    currency: "CNY",
    status,
    shippingAddress: {
      name: "陈先生",
      phone: "138****0005",
      address: "科技园路88号5栋602",
      city: "深圳市",
      country: "中国",
      zipCode: "518057",
    },
    trackingNumber:
      status === "shipped" || status === "completed"
        ? `SF${String(1024 + i * 53).padStart(12, "0")}`
        : undefined,
    createdAt: orderDate,
    paidAt:
      status !== "pending"
        ? new Date(date.getTime() + 600000).toISOString()
        : undefined,
    shippedAt:
      status === "shipped" || status === "completed"
        ? new Date(date.getTime() + 86400000 * 2).toISOString()
        : undefined,
    completedAt:
      status === "completed"
        ? new Date(date.getTime() + 86400000 * 5).toISOString()
        : undefined,
  };
});

// ============ 任务 ============
export const MOCK_TASKS: Task[] = Array.from({ length: 10 }, (_, i) => {
  const statuses: Task["status"][] = [
    "completed",
    "completed",
    "in_progress",
    "pending_produce",
    "pending_modify",
    "completed",
    "in_progress",
    "pending_produce",
    "completed",
    "pending_modify",
  ];
  const priorities: Task["priority"][] = [
    "high",
    "medium",
    "high",
    "medium",
    "low",
    "medium",
    "high",
    "low",
    "medium",
    "high",
  ];
  const status = statuses[i];
  const date = new Date(2026, 6, 8 - Math.floor(i / 2));
  return {
    taskId: `TK_${String(i + 1).padStart(4, "0")}`,
    orderId: `ORD${String(1000 + i).padStart(6, "0")}`,
    userId: "U_USER_001",
    designerId: i % 4 === 0 ? "U_DES_002" : "U_DES_001",
    operatorId:
      status === "in_progress" || status === "completed"
        ? "U_OP_001"
        : undefined,
    modelId: `MD_${String(i + 1).padStart(4, "0")}`,
    status,
    priority: priorities[i],
    originalFileUrl: status !== "pending_modify" ? "#" : undefined,
    modifiedFileUrl:
      status === "in_progress" || status === "completed" ? "#" : undefined,
    remark:
      status === "pending_modify"
        ? "客户要求调整发型细节"
        : status === "in_progress"
          ? "正在打印第3层"
          : undefined,
    createdAt: date.toISOString(),
    updatedAt: new Date(date.getTime() + 86400000).toISOString(),
    deadline: new Date(date.getTime() + 86400000 * 3).toISOString(),
  };
});

// ============ 设计师统计 ============
export const MOCK_DESIGNER_STATS: DesignerStats = {
  completedCount: 156,
  pendingCount: 4,
  inProgressCount: 3,
  totalEarnings: 46800.5,
  availableBalance: 12680.0,
  frozenBalance: 1850.0,
  monthlyEarnings: 8420.0,
};

// ============ 设计师提现历史 ============
export const MOCK_WITHDRAWALS: Withdrawal[] = [
  {
    withdrawalId: "WD_001",
    designerId: "U_DES_001",
    amount: 5000,
    status: "completed",
    method: "alipay",
    account: "wang***@163.com",
    createdAt: "2026-06-15T10:00:00Z",
    processedAt: "2026-06-16T14:30:00Z",
  },
  {
    withdrawalId: "WD_002",
    designerId: "U_DES_001",
    amount: 3000,
    status: "completed",
    method: "bank",
    account: "6222****1234",
    createdAt: "2026-05-20T09:00:00Z",
    processedAt: "2026-05-21T11:00:00Z",
  },
  {
    withdrawalId: "WD_003",
    designerId: "U_DES_001",
    amount: 2000,
    status: "pending",
    method: "wechat",
    account: "wx_wang****",
    createdAt: "2026-07-09T16:00:00Z",
  },
  {
    withdrawalId: "WD_004",
    designerId: "U_DES_001",
    amount: 1500,
    status: "rejected",
    method: "alipay",
    account: "wang***@163.com",
    remark: "账户信息不匹配，请重新提交",
    createdAt: "2026-07-05T14:00:00Z",
    processedAt: "2026-07-06T10:00:00Z",
  },
];

// ============ 代理商信息 ============
export const MOCK_PROXY_INFO: ProxyInfo = {
  proxyId: "P_001",
  userId: "U_AGENT_001",
  name: "李代理",
  referralCode: "MOONCADA_LI2025",
  referralUrl: "https://mooncada.com/r/MOONCADA_LI2025",
  qrcodeUrl:
    "https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=mooncada-referral-P001",
  totalCommission: 28560.8,
  availableBalance: 8520.5,
  frozenBalance: 1200.0,
  referredUsers: 48,
  monthlyCommission: 4280.5,
};

// ============ 代理商提现历史 ============
export const MOCK_PROXY_WITHDRAWALS: ProxyWithdrawal[] = [
  {
    withdrawalId: "PWD_001",
    proxyId: "P_001",
    amount: 5000,
    status: "completed",
    method: "bank",
    account: "6222****5678",
    createdAt: "2026-06-25T10:00:00Z",
    processedAt: "2026-06-26T15:00:00Z",
  },
  {
    withdrawalId: "PWD_002",
    proxyId: "P_001",
    amount: 3000,
    status: "pending",
    method: "alipay",
    account: "li***@163.com",
    createdAt: "2026-07-08T14:00:00Z",
  },
];

// ============ 平台用户 ============
export const MOCK_PLATFORM_USERS: PlatformUser[] = [
  {
    userId: "U_ADMIN_001",
    username: "admin",
    email: "admin@mooncada.com",
    role: "admin",
    permission: ["all"],
    status: "active",
    createdAt: "2025-01-01T00:00:00Z",
    lastLoginAt: "2026-07-10T03:20:00Z",
  },
  {
    userId: "U_AGENT_001",
    username: "agent_li",
    email: "agent@mooncada.com",
    role: "agent",
    permission: ["proxy:view", "proxy:withdrawal"],
    status: "active",
    createdAt: "2025-03-15T08:00:00Z",
    lastLoginAt: "2026-07-09T22:15:00Z",
  },
  {
    userId: "U_DES_001",
    username: "designer_wang",
    email: "wang@mooncada.com",
    role: "designer",
    permission: ["task:view", "task:upload", "designer:withdrawal"],
    status: "active",
    createdAt: "2025-02-20T10:00:00Z",
    lastLoginAt: "2026-07-10T01:45:00Z",
  },
  {
    userId: "U_DES_002",
    username: "designer_zhao",
    email: "zhao@mooncada.com",
    role: "designer",
    permission: ["task:view", "task:upload", "designer:withdrawal"],
    status: "active",
    createdAt: "2025-03-01T09:00:00Z",
    lastLoginAt: "2026-07-09T19:30:00Z",
  },
  {
    userId: "U_OP_001",
    username: "operator_zhang",
    email: "zhang@mooncada.com",
    role: "operator",
    permission: ["task:view", "task:update", "model:download"],
    status: "active",
    createdAt: "2025-04-10T09:00:00Z",
    lastLoginAt: "2026-07-10T02:30:00Z",
  },
  {
    userId: "U_OP_002",
    username: "operator_lin",
    email: "lin@mooncada.com",
    role: "operator",
    permission: ["task:view", "task:update"],
    status: "disabled",
    createdAt: "2025-05-05T09:00:00Z",
    lastLoginAt: "2026-06-28T10:00:00Z",
  },
];

// ============ 系统日志 ============
export const MOCK_SYS_LOGS: SysLog[] = [
  {
    logId: "LOG_001",
    logType: "auth",
    level: "info",
    message: "管理员 admin 登录系统",
    userId: "U_ADMIN_001",
    ip: "192.168.1.100",
    createdAt: "2026-07-10T03:20:00Z",
  },
  {
    logId: "LOG_002",
    logType: "business",
    level: "info",
    message: "用户 customer_chen 创建订单 ORD001005",
    userId: "U_USER_001",
    ip: "203.45.67.89",
    createdAt: "2026-07-10T02:45:00Z",
  },
  {
    logId: "LOG_003",
    logType: "api",
    level: "warn",
    message: "2D效果生成接口响应时间过长 (3.2s)",
    ip: "10.0.0.5",
    createdAt: "2026-07-10T02:30:00Z",
    details: { endpoint: "/api/v2/effect/generate", duration: 3200 },
  },
  {
    logId: "LOG_004",
    logType: "business",
    level: "info",
    message: "设计师 designer_wang 上传修改版模型 MD_0003",
    userId: "U_DES_001",
    ip: "192.168.1.105",
    createdAt: "2026-07-10T01:50:00Z",
  },
  {
    logId: "LOG_005",
    logType: "auth",
    level: "error",
    message: "登录失败：密码错误 (用户 designer_zhao)",
    userId: "U_DES_002",
    ip: "203.45.67.100",
    createdAt: "2026-07-10T01:30:00Z",
  },
  {
    logId: "LOG_006",
    logType: "system",
    level: "info",
    message: "Redis 缓存清理任务执行完成",
    ip: "127.0.0.1",
    createdAt: "2026-07-10T00:00:00Z",
  },
  {
    logId: "LOG_007",
    logType: "business",
    level: "info",
    message: "代理商 agent_li 申请提现 ¥3000",
    userId: "U_AGENT_001",
    ip: "203.45.67.50",
    createdAt: "2026-07-09T22:15:00Z",
  },
  {
    logId: "LOG_008",
    logType: "api",
    level: "error",
    message: "3D模型生成失败：Meshy API 超时",
    ip: "10.0.0.5",
    createdAt: "2026-07-09T20:00:00Z",
    details: { endpoint: "/api/v1/model3d/generate", modelId: "MD_0007" },
  },
  {
    logId: "LOG_009",
    logType: "business",
    level: "info",
    message: "操作员 operator_zhang 更新任务 TK_0003 状态为 制作中",
    userId: "U_OP_001",
    ip: "192.168.1.110",
    createdAt: "2026-07-09T18:00:00Z",
  },
  {
    logId: "LOG_010",
    logType: "system",
    level: "warn",
    message: "MongoDB 连接池使用率 85%",
    ip: "127.0.0.1",
    createdAt: "2026-07-09T15:00:00Z",
  },
];

// ============ 产品线（物理商品形态） ============
export const MOCK_PRODUCT_LINES: ProductLine[] = [
  // 1. 浮雕吧唧徽章
  {
    productLineId: "PL_001",
    name: "浮雕吧唧徽章",
    category: "badge",
    description:
      "精美浮雕吧唧徽章，可定制任意图案，适合动漫周边、活动纪念、粉丝应援。马口铁底盘+亚克力面+浮雕层，质感细腻。",
    previewUrl: "https://picsum.photos/seed/badge1/500/500",
    spec: {
      size: "直径 58mm",
      sizeOptions: ["直径 44mm", "直径 58mm", "直径 75mm"],
      material: "马口铁 + 亚克力",
      materialOptions: ["马口铁+亚克力", "全亚克力", "金属烤漆"],
      thickness: "3mm（含浮雕层）",
      weight: "约 15g",
      process: "UV彩印 + 3D浮雕层 + 亚克力封装",
    },
    designSpec: {
      supportedRatio: ["1:1"],
      minResolution: "512x512",
      maxResolution: "4096x4096",
      printDPI: 300,
      safeMargin: 3,
      bleedArea: 2,
      colorMode: "RGB",
      notes:
        "建议使用高对比度图片，浅色背景浮雕效果更佳；文字最小 6pt；圆形构图优先。",
    },
    pricing: {
      basePrice: 12,
      bulkPrice: 6.5,
      moq: 1,
      currency: "CNY",
      tieredPricing: [
        { quantity: 1, price: 12 },
        { quantity: 10, price: 10 },
        { quantity: 50, price: 8.5 },
        { quantity: 100, price: 6.5 },
        { quantity: 500, price: 5.2 },
      ],
    },
    production: {
      productionTime: "3-5个工作日",
      dailyCapacity: 2000,
      factory: "深圳·浮雕车间A",
      shippingMethod: "顺丰快递 / 圆通",
      packaging: "OPP袋独立包装，100个/大袋",
    },
    compatibleMaskIds: ["MASK_001", "MASK_002", "MASK_005"],
    status: "active",
    totalSold: 15680,
    monthlySold: 1820,
    rating: 4.8,
    createdAt: "2025-03-01T00:00:00Z",
    updatedAt: "2026-07-01T10:00:00Z",
    tags: ["徽章", "吧唧", "浮雕", "动漫周边", "应援"],
  },
  // 2. 带孔浮雕钥匙扣
  {
    productLineId: "PL_002",
    name: "带孔浮雕钥匙扣",
    category: "keychain",
    description:
      "金属带孔浮雕钥匙扣，坚固耐用，可定制人像、宠物、Logo。孔径适配标准钥匙环，浮雕细节清晰可见。",
    previewUrl: "https://picsum.photos/seed/keychain1/500/500",
    spec: {
      size: "45×60mm（椭圆孔）",
      sizeOptions: ["圆形 Ø40mm", "椭圆 45×60mm", "长方形 50×35mm", "异形定制"],
      material: "锌合金",
      materialOptions: ["锌合金", "不锈钢", "亚克力+金属"],
      thickness: "3.5mm",
      weight: "约 28g",
      process: "压铸成型 + 3D浮雕 + 电镀抛光",
    },
    designSpec: {
      supportedRatio: ["1:1", "3:4", "4:3"],
      minResolution: "600x600",
      maxResolution: "4096x4096",
      printDPI: 350,
      safeMargin: 4,
      bleedArea: 2,
      colorMode: "CMYK",
      notes:
        "需预留孔位区域（顶部 6mm），避免主体内容被孔位遮挡；金属色建议选银/金电镀；浅色文字可能不清晰。",
    },
    pricing: {
      basePrice: 25,
      bulkPrice: 14,
      moq: 1,
      currency: "CNY",
      tieredPricing: [
        { quantity: 1, price: 25 },
        { quantity: 10, price: 22 },
        { quantity: 50, price: 18 },
        { quantity: 100, price: 14 },
        { quantity: 500, price: 11 },
      ],
    },
    production: {
      productionTime: "5-7个工作日",
      dailyCapacity: 800,
      factory: "东莞·金属车间B",
      shippingMethod: "顺丰快递",
      packaging: "绒布袋独立包装，可配礼盒",
    },
    compatibleMaskIds: ["MASK_001", "MASK_002", "MASK_005"],
    status: "active",
    totalSold: 8920,
    monthlySold: 960,
    rating: 4.7,
    createdAt: "2025-03-15T00:00:00Z",
    updatedAt: "2026-06-25T14:00:00Z",
    tags: ["钥匙扣", "带孔", "金属", "浮雕", "礼品"],
  },
  // 3. 浮雕冰箱贴
  {
    productLineId: "PL_003",
    name: "浮雕冰箱贴",
    category: "magnet",
    description:
      "亚克力浮雕冰箱贴，背面强磁铁，可贴冰箱、办公柜。浮雕图案立体感强，色彩鲜艳，是家居装饰与纪念伴手礼首选。",
    previewUrl: "https://picsum.photos/seed/magnet1/500/500",
    spec: {
      size: "60×60mm 方形",
      sizeOptions: ["圆形 Ø55mm", "方形 60×60mm", "长方形 80×55mm", "异形定制"],
      material: "亚克力 + 软磁",
      materialOptions: ["亚克力+软磁", "水晶滴胶+磁铁", "木质+磁铁"],
      thickness: "5mm",
      weight: "约 22g",
      process: "UV彩印 + 3D浮雕 + 软磁背胶",
    },
    designSpec: {
      supportedRatio: ["1:1", "4:3", "3:4"],
      minResolution: "600x600",
      maxResolution: "4096x4096",
      printDPI: 300,
      safeMargin: 3,
      bleedArea: 2,
      colorMode: "RGB",
      notes:
        "推荐使用饱和度高的图片，深色背景浮雕层次更丰富；渐变色效果优秀；方形构图保留边角内容。",
    },
    pricing: {
      basePrice: 18,
      bulkPrice: 9,
      moq: 1,
      currency: "CNY",
      tieredPricing: [
        { quantity: 1, price: 18 },
        { quantity: 10, price: 15 },
        { quantity: 50, price: 12 },
        { quantity: 100, price: 9 },
        { quantity: 500, price: 7.5 },
      ],
    },
    production: {
      productionTime: "2-4个工作日",
      dailyCapacity: 3000,
      factory: "深圳·亚克力车间C",
      shippingMethod: "中通快递 / 顺丰",
      packaging: "OPP袋+泡棉保护，50个/盒",
    },
    compatibleMaskIds: ["MASK_001", "MASK_002", "MASK_005", "MASK_006"],
    status: "active",
    totalSold: 22450,
    monthlySold: 2850,
    rating: 4.9,
    createdAt: "2025-02-10T00:00:00Z",
    updatedAt: "2026-07-05T09:00:00Z",
    tags: ["冰箱贴", "亚克力", "浮雕", "家居", "伴手礼"],
  },
  // 4. 浮雕桌面画框
  {
    productLineId: "PL_004",
    name: "浮雕桌面画框",
    category: "frame",
    description:
      "实木浮雕桌面画框，立体浮雕画面搭配精致木框，适合婚纱照、全家福、纪念照。桌面摆件与壁挂两用，彰显品质。",
    previewUrl: "https://picsum.photos/seed/frame1/500/500",
    spec: {
      size: "6寸 (15.2×20.3cm)",
      sizeOptions: [
        "5寸 13×18cm",
        "6寸 15×20cm",
        "7寸 18×23cm",
        "8寸 20×25cm",
        "A4 21×29.7cm",
      ],
      material: "实木框 + 树脂浮雕",
      materialOptions: ["实木框+树脂", "胡桃木框+树脂", "亚克力框+树脂"],
      thickness: "25mm（含框）",
      weight: "约 380g",
      process: "树脂3D浮雕 + 实木边框 + 玻璃面板",
    },
    designSpec: {
      supportedRatio: ["1:1", "3:4", "4:3", "2:3", "3:2"],
      minResolution: "1200x1200",
      maxResolution: "8192x8192",
      printDPI: 600,
      safeMargin: 8,
      bleedArea: 5,
      colorMode: "CMYK",
      notes:
        "推荐高分辨率照片（≥1200px）；人像照建议面部居中；婚纱照推荐使用婚纱浮雕效果；边框颜色可选原木/胡桃木/白色。",
    },
    pricing: {
      basePrice: 158,
      bulkPrice: 98,
      moq: 1,
      currency: "CNY",
      tieredPricing: [
        { quantity: 1, price: 158 },
        { quantity: 5, price: 138 },
        { quantity: 20, price: 118 },
        { quantity: 50, price: 98 },
        { quantity: 100, price: 85 },
      ],
    },
    production: {
      productionTime: "7-10个工作日",
      dailyCapacity: 200,
      factory: "东莞·木艺车间D",
      shippingMethod: "顺丰快递（加泡棉防震包装）",
      packaging: "礼盒包装，含支架与挂墙配件",
    },
    compatibleMaskIds: ["MASK_001", "MASK_003", "MASK_006"],
    status: "active",
    totalSold: 3280,
    monthlySold: 420,
    rating: 4.9,
    createdAt: "2025-04-20T00:00:00Z",
    updatedAt: "2026-06-30T16:00:00Z",
    tags: ["画框", "桌面", "实木", "浮雕", "婚纱", "纪念品"],
  },
];

// ============ 仪表盘统计 ============
const generateTrend = (base: number, days: number, variance: number) => {
  const data = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(2026, 6, 10 - i);
    data.push({
      date: `${date.getMonth() + 1}/${date.getDate()}`,
      value: Math.round(base + (seededRandom() - 0.3) * variance),
    });
  }
  return data;
};

export const MOCK_DASHBOARD_STATS: DashboardStats = {
  totalUsers: 1286,
  totalOrders: 4520,
  totalRevenue: 856320,
  totalModels: 3128,
  pendingTasks: 18,
  completedTasks: 2856,
  activeDesigners: 24,
  totalPhotos: 8920,
  revenueTrend: generateTrend(12000, 14, 8000),
  orderTrend: generateTrend(60, 14, 40),
  orderStatusDist: [
    { status: "pending", label: "待付款", count: 48 },
    { status: "paid", label: "已付款", count: 86 },
    { status: "producing", label: "生产中", count: 124 },
    { status: "shipped", label: "已发货", count: 92 },
    { status: "completed", label: "已完成", count: 4120 },
    { status: "cancelled", label: "已取消", count: 50 },
  ],
  taskStatusDist: [
    { status: "pending_modify", label: "等待修改", count: 8 },
    { status: "pending_produce", label: "等待生产", count: 6 },
    { status: "in_progress", label: "制作中", count: 4 },
    { status: "completed", label: "已完成", count: 2856 },
  ],
};
