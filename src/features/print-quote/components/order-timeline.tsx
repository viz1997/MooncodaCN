"use client";

/**
 * 工单时间线 —— 用户详情页和后台弹窗共用
 *
 * ## 一条事件长什么样
 *
 * 库里存的是 `(from_status, to_status, actor, note)` —— **不存句子**。
 * 「工作室把工单从待确认改成了已确认」这句话由这里按 i18n 现场拼出来。
 *
 * 为什么不落库:句子要翻译。落库的话用户中途切语言,老事件就还是旧语言的
 * 句子,时间线读起来像两段话拼的。
 *
 * ## viewer 是干什么的
 *
 * 同一件事,用户看和工作室看,主语不一样:
 *   - 用户看「用户」事件 → 「你」;工作室看 → 「客户」
 *   - 用户看「工作室」事件 → 「工作室」;工作室看 → 「工作室」
 *
 * `viewer` 决定用哪套主语。
 *
 * (prop 不叫 `role` —— 那是 JSX 的保留属性名,Biome 的 a11y 规则会把它当
 * 成 ARIA role 检查,报「invalid ARIA role」。)
 */

import { useFormatter, useTranslations } from "next-intl";

import type {
  PrintOrderEventActor,
  PrintOrderEventView,
} from "@/features/print-quote/lib/quote-types";

/** 看这条时间线的人是谁 */
export type OrderTimelineViewer = "user" | "admin";

/**
 * 取某个 actor 的主语
 *
 * actor 是「自己」就用 self,是「别人」就用 other。
 */
function actorLabel(
  t: (key: string) => string,
  actor: PrintOrderEventActor,
  viewer: OrderTimelineViewer
): string {
  const key = `timeline.actor${actor.charAt(0).toUpperCase()}${actor.slice(1)}
  }`;
  const suffix =
    actor === "system" ? "self" : viewer === actor ? "self" : "other";
  return t(`${key}.${suffix}`);
}

export function OrderTimeline({
  events,
  viewer,
}: {
  events: PrintOrderEventView[];
  /** 看这条时间线的人是谁 —— 决定主语是「你」还是「客户」 */
  viewer: OrderTimelineViewer;
}) {
  const t = useTranslations("PrintQuote");
  const format = useFormatter();

  if (events.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">{t("timeline.empty")}</p>
    );
  }

  return (
    <ol className="space-y-0">
      {events.map((event, index) => {
        const isLast = index === events.length - 1;
        const sentence =
          event.fromStatus === null
            ? t("timeline.created")
            : t("timeline.transition", {
                actor: actorLabel(t, event.actor, viewer),
                from: t(`status.${event.fromStatus}`),
                to: t(`status.${event.toStatus}`),
              });

        return (
          <li key={event.id} className="relative flex gap-3 pb-4 last:pb-0">
            {/* 竖线 + 圆点 */}
            <div className="flex flex-col items-center">
              <span
                className={`mt-1 size-2.5 shrink-0 rounded-full ${
                  event.actor === "admin"
                    ? "bg-sky-500"
                    : event.actor === "system"
                      ? "bg-muted-foreground"
                      : "bg-amber-500"
                }`}
              />
              {!isLast ? <span className="mt-1 w-px flex-1 bg-border" /> : null}
            </div>

            <div className="min-w-0 flex-1">
              <p className="text-sm text-foreground">{sentence}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {format.dateTime(new Date(event.createdAt), {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </p>
              {event.note ? (
                <div className="mt-2 rounded-md border border-border bg-muted/40 px-3 py-2">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {t("timeline.noteLabel")}
                  </p>
                  <p className="mt-0.5 whitespace-pre-line text-xs text-foreground">
                    {event.note}
                  </p>
                </div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
