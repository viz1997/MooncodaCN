import { redirect } from "next/navigation";

/**
 * 根路径重定向
 *
 * 默认跳转到中文首页 /zh
 */
export default function RootPage() {
  redirect("/zh");
}
