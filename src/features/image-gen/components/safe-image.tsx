/**
 * 安全图片组件
 *
 * 用于展示外部动态 URL 图片（R2/AI 生成结果）。
 * 由于 URL 来自运行时且无法提前写入 next.config，使用原生 img。
 */

interface SafeImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  alt: string;
}

export function SafeImage({ alt, ...props }: SafeImageProps) {
  // biome-ignore lint/performance/noImgElement: 外部动态图片，无法使用 Next Image
  return <img alt={alt} {...props} />;
}
