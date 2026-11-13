/**
 * 商城公告条 —— 首页最上面那一行细条。
 *
 * ## 为什么要有这一行
 *
 * 商城的第一屏要回答三个问题:卖什么、多少钱、怎么买。这行条子把「怎么买」
 * 先说了:免运费门槛、一件也发货、工期、全彩树脂 + 手工精修。
 *
 * 之前首页第一屏只有一句 slogan 和一张生活照,读者完全不知道这家店是卖
 * 什么的、单价多少 —— 「不像商城」的根源就在这。
 *
 * 四条事实是从商品目录的真实参数推出来的,不是营销词:
 *  - 满 ¥99 免运费 —— 对齐 `use-cart.ts` 的 `FREE_SHIPPING_THRESHOLD_CENTS`
 *    (9900 分),别单独改这一行。
 *  - 一件定制 · 一件发货 —— 首页 hero 的核心卖点。
 *  - 14 天工期 —— `WJP_SERIES` 里手办系列的工期。
 *  - 全彩树脂 · 手工精修 —— 工艺段说的就是这两件事。
 */

export function ShopAnnouncement({ locale }: { locale: "zh" | "en" }) {
  const isZh = locale === "zh";

  const facts = isZh
    ? [
        "满 ¥99 免运费",
        "一件定制 · 一件发货",
        "14 天工期",
        "全彩树脂 · 手工精修",
      ]
    : [
        "Free shipping over ¥99",
        "One piece, one order",
        "14-day turnaround",
        "Full-colour resin, hand-finished",
      ];

  return (
    <div className="border-b border-border/60 bg-[var(--secondary)]/70">
      <div className="atelier-container flex flex-wrap items-center justify-center gap-x-7 gap-y-1 py-2.5 text-[11px] tracking-wide text-muted-foreground">
        {facts.map((fact) => (
          <span key={fact} className="flex items-center gap-2">
            <span className="size-1 shrink-0 rounded-full bg-[var(--accent)]" />
            {fact}
          </span>
        ))}
      </div>
    </div>
  );
}
