import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { db, user } from "@/db";
import { SettingsProfileView } from "@/features/settings/components";
import { getServerSession } from "@/lib/auth/server";

/**
 * 设置页面元数据
 */
export const metadata = {
  title: "Settings | Mooncoda",
  description: "管理您的账户设置和偏好",
};

/**
 * 用户设置页面
 *
 * Server Component - 在服务端获取用户数据
 * 直接查 DB 拿 phoneNumber / phoneNumberVerified —— 2026-09-16 避免依赖 BA session
 * 是否暴露这两个字段（plugin 默认暴露但保险起见走 DB）。
 *
 * 将数据传递给客户端 SettingsProfileView 组件
 */
export default async function SettingsPage() {
  const session = await getServerSession();

  if (!session?.user) {
    redirect("/sign-in");
  }

  // 取 phoneNumber / phoneNumberVerified（settings UI 需要）
  const me = await db.query.user.findFirst({
    where: eq(user.id, session.user.id),
    columns: {
      phoneNumber: true,
      phoneNumberVerified: true,
      emailVerified: true,
    },
  });

  return (
    <SettingsProfileView
      user={{
        id: session.user.id,
        name: session.user.name || "",
        email: session.user.email || "",
        emailVerified: me?.emailVerified ?? false,
        image: session.user.image,
        phoneNumber: me?.phoneNumber ?? null,
        phoneNumberVerified: me?.phoneNumberVerified ?? false,
      }}
    />
  );
}
