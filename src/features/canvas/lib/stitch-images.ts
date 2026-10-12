// @ts-nocheck
/**
 * 把 N 张候选图拼成 √N × √N 宫格大图 —— 给生图工作台 V1 / V2 共享。
 *
 * 触发条件（调用方负责）：
 * - 用户在设置里勾选「自动拼接宫格图」
 * - 一次提交返 N ≥ 2 张候选（count > 1）
 * - 不是模板自带的宫格拼接（candidateCount=4/9，模型本来就返 1 张大图）
 *
 * 实现：HTMLCanvasElement drawImage + object-fit: cover 语义。
 * 每张图按等比裁切到 cell 大小，居中绘制，避免拉伸变形。
 *
 * 失败语义：任何一张图加载失败（fetch 非 2xx / 解码失败 / canvas drawImage 抛错）
 * 就 throw —— 让调用方 catch 后回退到原 resultUrls，不阻塞用户的生成结果。
 *
 * 2026-08-27：CORS 修复 —— 不再给 <img> 设 crossOrigin="anonymous"。
 * R2 公网 URL 没带 Access-Control-Allow-Origin，浏览器直接 onerror；
 * 改为同源代理 /api/image-gen/thumbnail → blob URL 加载（详见 loadImage）。
 *
 * 输出：PNG dataURL（无压缩损、无 alpha 通道损失），base64 字符串。data URL
 * 不是持久 URL（blob URL 跨页面失效），但工作台单次会话内用足够；落库场景由
 * 调用方决定是否再传 R2。
 */

const TILE_PX = 512; // 每格像素 —— 越大越清晰，dataURL 也越大

export async function stitchToGrid(urls: string[]): Promise<string> {
  if (urls.length < 2) {
    throw new Error("stitchToGrid 需要至少 2 张图");
  }

  // √N × √N 宫格：2~3 张用 2×2，4 张用 2×2，5~9 用 3×3，10~16 用 4×4
  const cols = Math.ceil(Math.sqrt(urls.length));
  const rows = Math.ceil(urls.length / cols);

  const canvas = document.createElement("canvas");
  canvas.width = cols * TILE_PX;
  canvas.height = rows * TILE_PX;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建 canvas 2d context");

  // 浅色背景：万一原图有透明像素，网格之间不会透出黑色（用户报告的视觉突兀）
  ctx.fillStyle = "#f5f5f5";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const loaded = await Promise.all(urls.map(loadImage));
  loaded.forEach((img, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    drawCover(ctx, img, col * TILE_PX, row * TILE_PX, TILE_PX, TILE_PX);
  });

  return canvas.toDataURL("image/png");
}

/**
 * 把图按 object-fit: cover 语义绘制到 (x, y, w, h) 矩形内，居中裁切。
 * 与 SubmissionNode / ResultImageCard 的视觉一致 —— 用户看到的是方形预览，
 * 不是变形拉伸。
 */
function drawCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number
) {
  const imgRatio = img.naturalWidth / Math.max(1, img.naturalHeight);
  const boxRatio = w / h;
  let sx = 0;
  let sy = 0;
  let sw = img.naturalWidth;
  let sh = img.naturalHeight;
  if (imgRatio > boxRatio) {
    // 图更宽 → 按高度裁左右
    sw = img.naturalHeight * boxRatio;
    sx = (img.naturalWidth - sw) / 2;
  } else {
    // 图更高 → 按宽度裁上下
    sh = img.naturalWidth / boxRatio;
    sy = (img.naturalHeight - sh) / 2;
  }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

/**
 * 加载图片并保证 canvas 不被污染 —— 关键：远程 URL 不能直接走
 * `<img crossOrigin="anonymous">`，因为 R2 公网 URL（pub-*.r2.dev）默认没
 * `Access-Control-Allow-Origin` 响应头，浏览器直接 onerror；不走
 * crossOrigin 又会让 canvas 被污染（不同源 drawImage），toDataURL 抛
 * SecurityError。两条路在 R2 这种"不配 CORS 的对象存储"上都走不通。
 *
 * 唯一可行的方案：远程 URL 走同源代理 `/api/image-gen/thumbnail`（已存在，
 * 复用 gpt-image 缩略图逻辑）→ 同源 fetch 拿到字节 → Blob →
 * URL.createObjectURL → img.src。blob URL 与文档同源，画到 canvas 不算污染，
 * toDataURL 通过。
 *
 * data: URL 是 base64 内联，本身就同源，直接 img.src。
 *
 * 失败语义：fetch 非 2xx / 图片解码失败 / canvas drawImage 抛错 → reject，
 * 调用方 catch 后回退到原 N 张独立卡，不阻塞用户。
 *
 * 2026-08-27：CORS 修复 —— 之前的 crossOrigin="anonymous" 在 R2 上直接
 * onerror，原因如上。改为同源代理。代理已用 immutable 1 年缓存，二次拼接
 * 几乎免费。
 */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    let objectUrl: string | null = null;
    const cleanup = () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    };
    img.onload = () => {
      cleanup();
      resolve(img);
    };
    img.onerror = () => {
      cleanup();
      reject(new Error(`图片加载失败：${truncate(url)}`));
    };
    if (url.startsWith("data:")) {
      img.src = url;
      return;
    }
    // 远程 URL 走同源代理：浏览器 fetch 到同源不需要 CORS，response 的字节
    // 创建成 blob URL 后画图，blob URL 也与文档同源 —— 双向同源，无污染。
    const proxiedUrl = `/api/image-gen/thumbnail?url=${encodeURIComponent(url)}&w=2048`;
    fetch(proxiedUrl)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.blob();
      })
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        img.src = objectUrl;
      })
      .catch((err) => {
        cleanup();
        reject(
          new Error(`图片拉取失败：${(err as Error).message ?? String(err)}`)
        );
      });
  });
}

function truncate(url: string, max = 80): string {
  return url.length > max ? `${url.slice(0, max)}…` : url;
}
