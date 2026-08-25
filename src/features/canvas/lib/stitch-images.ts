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
 * 失败语义：任何一张图加载失败（解码失败 / CORS 拒绝 / cross-origin 不可读）
 * 就 throw —— 让调用方 catch 后回退到原 resultUrls，不阻塞用户的生成结果。
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

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`图片加载失败：${truncate(url)}`));
    img.src = url;
  });
}

function truncate(url: string, max = 80): string {
  return url.length > max ? `${url.slice(0, max)}…` : url;
}
