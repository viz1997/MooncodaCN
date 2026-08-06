"use client";

import { Box, CheckCircle2, Clock, Wand2, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  IMAGE_MODEL_LIST,
  IMAGE_MODELS,
} from "@/features/image-gen/lib/image-models/types";
import { cn } from "@/lib/utils";

export function ModelsManagerView() {
  return (
    <div className="space-y-6">
      <Card className="bg-amber-500/5 border-amber-500/20">
        <CardContent className="py-6">
          <div className="flex items-start gap-4">
            <Box className="h-8 w-8 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-amber-800 dark:text-amber-300">
                3D 模型生成即将上线
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                当前页面展示可用的 2D 生图模型。3D 模型生成能力正在接入 Tripo3D
                / Meshy / 混元3D 等引擎。
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {IMAGE_MODEL_LIST.map((model) => {
          const cfg = IMAGE_MODELS[model.id];
          const StatusIcon =
            model.status === "active"
              ? CheckCircle2
              : model.status === "maintenance"
                ? Clock
                : XCircle;
          return (
            <Card
              key={model.id}
              className="overflow-hidden hover:shadow-md transition-all"
            >
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className="h-4 w-4 rounded-full"
                      style={{ backgroundColor: model.color }}
                    />
                    <span className="font-medium">{model.name}</span>
                  </div>
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[10px]",
                      model.status === "active" &&
                        "text-emerald-600 border-emerald-200",
                      model.status === "maintenance" &&
                        "text-amber-600 border-amber-200",
                      model.status === "deprecated" &&
                        "text-slate-600 border-slate-200"
                    )}
                  >
                    <StatusIcon className="h-3 w-3 mr-1" />
                    {model.status === "active"
                      ? "可用"
                      : model.status === "maintenance"
                        ? "维护"
                        : "弃用"}
                  </Badge>
                </div>

                <p className="text-xs text-muted-foreground">
                  {model.description}
                </p>

                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="secondary" className="text-[10px]">
                    <Wand2 className="h-2.5 w-2.5 mr-1" />
                    {model.currency === "CNY" ? "¥" : "$"}
                    {model.pricePerImage}/张
                  </Badge>
                  <Badge variant="secondary" className="text-[10px]">
                    {(model.avgDuration / 1000).toFixed(1)}s
                  </Badge>
                  {model.isDomestic && (
                    <Badge variant="secondary" className="text-[10px]">
                      国产
                    </Badge>
                  )}
                </div>

                <div className="text-[10px] text-muted-foreground space-y-1 pt-2 border-t">
                  <p>
                    支持尺寸: {cfg.capabilities.sizes.slice(0, 4).join(", ")}
                  </p>
                  <p>最大批量: {cfg.capabilities.maxBatchSize} 张</p>
                  <p>
                    特性:{" "}
                    {cfg.capabilities.supportsNegativePrompt && "反向提示词 "}
                    {cfg.capabilities.supportsSeed && "种子 "}
                    {cfg.capabilities.supportsGuidance && "CFG "}
                  </p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
