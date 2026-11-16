/**
 * /admin/showcases 案例展示后台(2026-11-16)
 *
 * RSC:仅渲染客户端组件 <ShowcasesAdminView />。
 *
 * RBAC:由父 layout `src/app/[locale]/(admin)/admin/layout.tsx` 的 `checkAdmin()`
 * 守卫;非 admin 自动 redirect 到 `/`。本页不重复校验。
 *
 * ## 这一页管什么
 *
 * **真实打印成品**的展示位 —— 工作室把实拍图传上来,自己排、自己上下架。
 *
 * 以前前台那两块(首页 `CraftGallery` 的下半、作品集页 `CommunityWall`)摆的是
 * `wjp-store-data.ts` 里四条 Unsplash 图库链接,配着编出来的顾客昵称和点赞数
 * —— 那是**别人的宠物照片**,摆在「真实照片。真实礼物。」底下比不摆更糟。
 *
 * 数据不在 RSC 里取:后台要能「改完立刻看到生效值」,所以由客户端组件自己
 * 去调 admin action 拉,保存后原地刷新。
 */

import { ShowcasesAdminView } from "@/features/showcase/admin/components/showcases-admin-view";

export default function AdminShowcasesPage() {
  return <ShowcasesAdminView />;
}
