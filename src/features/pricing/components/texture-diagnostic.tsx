"use client";

import { AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";

import type { TextureDiagnostic } from "@/features/pricing/lib/obj-materials";

/**
 * 贴图诊断 —— 白模时把「断在哪一步」直接摆出来。
 *
 * ## 为什么要有这个
 *
 * 贴图没解析出来时,画面上只有一个白模,看不出是哪一步断的:
 * 材质名对不上?MTL 里压根没写 `map_Kd`?还是压缩包里根本没有那张图?
 * 用户只能把文件拆开自己找。这里把断点直接列出来。
 *
 * 全部材质都正常时不渲染任何东西 —— 不添乱。
 */
export function TextureDiagnosticNote({
  diagnostics,
}: {
  diagnostics: TextureDiagnostic[] | null | undefined;
}) {
  const t = useTranslations("TextureDiagnostic");

  if (!diagnostics || diagnostics.length === 0) return null;

  const failed = diagnostics.filter((d) => d.status !== "ok");
  if (failed.length === 0) return null;

  return (
    <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-amber-900">
      <div className="flex items-center gap-1.5 text-xs font-medium">
        <AlertTriangle className="size-3.5 shrink-0" />
        {t("failedTitle", { failed: failed.length, total: diagnostics.length })}
      </div>
      <ul className="mt-1 space-y-0.5 pl-5 font-mono text-[11px] leading-relaxed">
        {failed.map((d) => (
          <li key={d.material}>
            {d.material} — {t(`status.${d.status}`)}
            {d.textureName ? ` (${d.textureName})` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}
