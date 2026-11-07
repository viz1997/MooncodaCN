"use client";

import {
  AlertCircle,
  Boxes,
  Compass,
  Info,
  Loader2,
  Palette,
  RotateCcw,
  Scale,
  Shell,
  ShieldCheck,
} from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
/**
 * Mooncoda 克重计算器的「模型设置」面板 —— 也就是**整页唯一那张卡片**,
 * 同时是打印前工作台(`/tools/workbench`)的**框架**。
 *
 * 2026-11-01 的三次改版:
 *  1. 原先是 `ModelSettingsDialog` 弹窗（Radix Dialog）。改成**页面内直接
 *     处理** —— 尺寸调节不再弹窗，改完即时生效。
 *  2. 去掉「待应用 / 已应用」两套状态。尺寸状态只有一份，由父组件持有，
 *     面板直接改（`onScale*Change` 一类回调）。
 *  3. **和结果卡合并成一张卡**。之前是「上面一张结果卡 + 下面一张模型设置
 *     卡」，同一个模型被劈成两个区域，文件名、体积、摆盘结果各出现两遍。
 *     现在这一张卡就是全部：头部是文件身份 + 几何标签（`header` 插槽，
 *     父组件渲染），右边 3D 预览，左栏克重 + 摆盘结果（`weight` 插槽，
 *     父组件渲染）+ 尺寸调节。
 *
 * ## 共用一个展示区域(2026-11-07)
 *
 * 工作室的原话:**「共用一个展示区域，切换只是切换不同数据而已」**。
 *
 * 以前「检查」那一栏**整块替换**两栏布局,自己挂一个深色视口 —— 切一次
 * 视角,视口就卸载重挂一遍,相机、模型、支撑全得重来。
 *
 * 现在**只有一个 `ModelViewport`**,永远挂在右栏:
 *
 * | 视角 | 喂进去的数据 |
 * |---|---|
 * | `check` | 分析结果(问题着色 / 问题边线)+ 图层开关 + 聚焦请求 |
 * | `weight` | 支撑外壳(摆盘 Worker 算的那块)+ 当前姿态 |
 * | `pose` | 同上 |
 *
 * 切视角 = 换几行 prop。**视口不卸载**,相机不动,模型不重建。
 *
 * ## 统一用「以前那个检查工具」的深色设计(2026-11-07)
 *
 * 工作室的原话:**「就是统一用检查那个设计，左边信息栏可以显示克重、检查、
 * 摆盘」**。
 *
 * 合并之后有两处跟旧检查工具对不上:
 *
 * 1. **外观** —— 检查那一栏是深色,克重 / 摆盘是浅色,切一次视角整块换脸
 * 2. **排布** —— 旧检查工具是「侧栏左 + 视口右」,`md`(768px)就并排;
 *    工作台当时是「视口上 + 面板下」,`lg`(1024px)才并排 —— 768~1023px
 *    那段窗口还摆着老克重工具的方向
 *
 * 现在**整块是一个深色应用**:头部(文件身份)→ 视角切换条 → 左边信息栏 +
 * 右边 3D 视口。三个视角换的是**左边那一栏的内容**,整块外观不变。
 *
 * - **并排断点跟旧检查工具一样(`md`)** —— 侧栏 `md:order-1`、视口
 *   `md:order-2`(手机上视口还在上面,所以 DOM 里它在前面)
 * - **两个侧栏同宽(`md:w-[400px]`)** —— 不然切一次视角视口宽度就变,
 *   相机的取景会跑偏
 * - **「加入打印单」那张卡在深色应用外面** —— 它是页面里的一张浅色卡
 *   (工作室的下单按钮),不是 3D 应用的一部分
 *
 * ## 模型角度是**模型**的旋转,不是**视角**的旋转
 *
 * 工作室的原话:**「模型需要支持旋转角度而不是视角旋转」**。
 *
 * 摆着看(转相机)跟摆着印(转模型)是两件事 —— 后者决定支撑克重。所以
 * 姿态走**姿态组**(`rotation.order = "ZYX"`,跟摆盘算法 / OBJ 导出同
 * 一套口径),三个视角**都**能转,角度条常驻在展示区上方。
 *
 * 几何由父组件算好后传进来（`geometry`）—— 面板不自己重算一遍，
 * 拆成两处只会各自漂移。
 *
 * i18n 沿用 `MaterialPricing.dialog.*` 命名空间（文案与旧弹窗一致），只是
 * 调用位置从弹窗换成了面板 —— 整个命名空间的重命名留给单独的清理。
 */
import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  AngleInput,
  DimDisplay,
  DimEditor,
  fmt,
} from "@/features/pricing/components/shared";
import type { SupportPoseResult } from "@/features/pricing/lib/angle-optimizer";
import {
  type ModelUnitCheck,
  scalePositionsXYZ,
} from "@/features/pricing/lib/model-units";
import type { ModelFile } from "@/features/pricing/lib/zip-extractor";
import {
  type MeshTextureInfo,
  ModelViewport,
} from "@/features/shared/components/model-viewport";
import { useDropZone } from "@/features/shared/hooks/use-drop-zone";
import { ModelCheckSidePanel } from "@/features/tools/components/model-check/model-check-panel";
import { useCheckView } from "@/features/tools/components/model-check/use-check-view";
import { ISSUE_LABEL_KEYS } from "@/features/tools/lib/mesh/types";

export type LoadStatus =
  | "idle"
  | "uploading"
  | "parsing"
  | "loading-3d"
  | "ready"
  | "error";

export type DimMode = "original" | "custom";

/**
 * 工作台视角 —— 同一个模型的三种看法
 *
 * 2026-11-07 起,模型检查工具**并进**克重工具:两个工具页合成一个工作台,
 * 模型只载入一次,里面用这三个视角看**同一个**模型。
 *
 * | 视角 | 看什么 |
 * |---|---|
 * | `check` | 打印前自检(反转法向 / 坏边破面 / 壳体封闭性)—— 左栏换成检查侧栏 |
 * | `weight` | 克重(耗材 / 支撑 / 总克重)+ 尺寸调节 |
 * | `pose` | 摆盘(最优姿态 + 省了多少料) |
 *
 * 三个视角**共用右栏那一个展示区域**(同一个 `ModelViewport`)——
 * 切视角只换喂进去的数据。
 */
export type WorkspaceTab = "check" | "weight" | "pose";

/** 视角切换条上的三个按钮 —— 顺序就是工作室的流程:先看能不能印,再算料,最后摆盘 */
const WORKSPACE_TABS: {
  id: WorkspaceTab;
  icon: typeof ShieldCheck;
}[] = [
  { id: "check", icon: ShieldCheck },
  { id: "weight", icon: Scale },
  { id: "pose", icon: Compass },
];

/** 几何数据（父组件算好 —— 面板不再自己算一份） */
export type ModelGeometry = {
  volumeCM3: number;
  surfaceAreaCM2: number;
  dims: [number, number, number];
  originalDims: [number, number, number];
};

export type ModelSettingsPanelProps = {
  model: ModelFile | null;
  loadStatus: LoadStatus;
  loadProgress: string;
  loadPercent: number;
  uploadError: string | null;

  /**
   * 卡片头部 —— 文件身份（缩略图 / 名称 / 几何标签）+ 操作按钮。
   * 由父组件渲染：这个面板是**整页唯一一张卡片**，头部要放什么由外面决定。
   */
  header?: ReactNode;

  /**
   * 左栏顶部的内容 —— 克重 + 摆盘结果。
   * 由父组件渲染（它持有 `calc` / `optimalAngle`）。
   *
   * **只在「克重」视角显示** —— 摆盘结果挪到 `pose` 插槽了。
   */
  weight?: ReactNode;

  /**
   * 左栏的「摆盘」视角内容 —— 智能摆盘结果。
   *
   * 跟 `weight` 分开是因为它们回答的是两个问题:**要多少料** vs **怎么摆**。
   * 摆在同一栏里,用户得在一堆数字里找哪个是结论。
   */
  pose?: ReactNode;

  /** 当前视角 —— 父组件持有(切换视角要重算东西,不能只改显示) */
  tab: WorkspaceTab;
  onTabChange: (tab: WorkspaceTab) => void;

  /**
   * 卡片最下面的内容 —— 报价条（价格明细 + 合计 + 下单入口）。
   *
   * 2026-11-01 新增:打印服务报价页要把价格接在克重下面,所以这里开了个
   * 插槽。**工具模式不传这个 prop** —— 克重工具仍然只显示克重,不显示
   * 任何价格(见 pricing-calculator.tsx 的边界说明)。
   */
  quote?: ReactNode;

  /** 尺寸调节状态 —— 父组件持有，改动即时生效 */
  dimMode: DimMode;
  uniformScale: boolean;
  scaleFactor: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  onDimModeChange: (mode: DimMode) => void;
  onUniformScaleChange: (checked: boolean) => void;
  onScaleFactorChange: (value: number) => void;
  onScaleXChange: (value: number) => void;
  onScaleYChange: (value: number) => void;
  onScaleZChange: (value: number) => void;

  /**
   * 单位判定结果 —— 文件坐标**不是毫米**时才有值
   *
   * 工具已经按「最大边 100mm」替用户归一化过了,面板上要挂一条横幅把这件事
   * 摆出来 —— 用户得知道尺寸被换算过,否则横幅没了就没人知道为什么。
   */
  unitCheck?: ModelUnitCheck | null;
  /** 「改回原始尺寸」—— 用户坚持把文件里的数字当毫米 */
  onRevertUnitScale?: () => void;

  /** 父组件算好的几何 */
  geometry: ModelGeometry | null;

  /**
   * **当前姿态**的包裹支撑数据 —— 没跑智能摆盘时就是初始角度 (0°,0°)。
   *
   * 之前这个徽标只认 `optimalAngle`,所以模型刚进来时显示「运行智能摆盘后
   * 显示支撑比例」;现在初始角度的支撑一开始就有,徽标直接显示当前姿态的
   * 支撑比例 + 克重。
   */
  poseSupport: SupportPoseResult | null;
  /** 当前姿态的支撑比例(支撑克重 / 模型克重)—— 面板自己算不了(要模型克重) */
  supportRatio: number;
  /**
   * **模型**的当前角度 —— 视口按它转模型(不是转相机)
   *
   * 三个视角共用 —— 在「检查」那一栏转了模型,切到「克重」还是这个姿态。
   */
  viewerRotX: number;
  viewerRotY: number;
  viewerRotZ: number;
  /** 角度条上那几个输入框的值 —— 跟上面那三个一样(摆盘跑完会写进来) */
  manualRotX: number;
  manualRotY: number;
  manualRotZ: number;
  /** 手动微调角度；第三个参数是当前生效的缩放因子（克重要按它算） */
  onManualAngleChange: (
    axis: "X" | "Y" | "Z",
    value: number,
    scales: [number, number, number]
  ) => void;
  /** 角度归零(顺带把摆盘结果也清掉) */
  onResetAngle?: () => void;
  /** 触发智能摆盘；传入当前生效的缩放因子 */
  onOptimizeAngle: (scales: [number, number, number]) => void;
  angleOptimizing: boolean;
  angleProgress: number;
  /**
   * 模型是否已经进了摆盘客户端 —— 没进去之前点「智能摆盘」只会报错,
   * 按钮直接置灰。
   */
  angleReady: boolean;
  showSupport: boolean;
  onToggleSupport: () => void;
  /**
   * 托底高度 (mm) —— 3D 预览里模型悬在平台上方多远
   *
   * 不传 = `SUPPORT_LIFT_MM`(5mm)。**2026-11-06 起跟随后台**
   * (`/admin/print-pricing`)—— 画面跟报价必须用同一个值。
   */
  supportLiftMm?: number | undefined;
  /**
   * 底板留边 (mm) —— 跟随后台
   *
   * 检查视角画的底板跟克重那一栏算的支撑克重必须是同一个几何(那一圈边
   * 也是实心支撑,算进克重)。
   */
  supportBaseMarginMm?: number | undefined;
  /**
   * 是否显示模型自带的贴图 —— 与检测工具的「显示贴图」开关同一套行为:
   * 关掉就是纯色(MTL 的 `Kd` 本色)视图。
   */
  showTexture: boolean;
  onToggleTexture: () => void;

  /** 拖文件进展示区 —— 交给上层那个上传管线 */
  onFiles?: ((files: File[]) => void) | undefined;

  onClearModel: () => void;
  onViewerReady: () => void;
};

export function ModelSettingsPanel({
  model,
  loadStatus,
  loadProgress,
  loadPercent,
  uploadError,
  header,
  weight,
  pose,
  tab,
  onTabChange,
  quote,
  dimMode,
  uniformScale,
  scaleFactor,
  scaleX,
  scaleY,
  scaleZ,
  onDimModeChange,
  onUniformScaleChange,
  onScaleFactorChange,
  onScaleXChange,
  onScaleYChange,
  onScaleZChange,
  unitCheck,
  onRevertUnitScale,
  geometry,
  poseSupport,
  supportRatio,
  viewerRotX,
  viewerRotY,
  viewerRotZ,
  manualRotX,
  manualRotY,
  manualRotZ,
  onManualAngleChange,
  onResetAngle,
  onOptimizeAngle,
  angleOptimizing,
  angleProgress,
  angleReady,
  showSupport,
  onToggleSupport,
  supportLiftMm,
  supportBaseMarginMm,
  showTexture,
  onToggleTexture,
  onFiles,
  onClearModel,
  onViewerReady,
}: ModelSettingsPanelProps) {
  const t = useTranslations("MaterialPricing");
  const tInspect = useTranslations("ModelInspector");

  /** 重置视角的信号 —— 视口每次看见新信号就把相机摆回默认位置 */
  const [fitSignal, setFitSignal] = useState(0);

  /** 当前生效的缩放因子（XYZ）—— 由父组件持有的尺寸状态推导 */
  const scales = useMemo((): [number, number, number] => {
    if (dimMode !== "custom") return [1, 1, 1];
    if (uniformScale) return [scaleFactor, scaleFactor, scaleFactor];
    return [scaleX, scaleY, scaleZ];
  }, [dimMode, uniformScale, scaleFactor, scaleX, scaleY, scaleZ]);

  /**
   * 缩放后的几何 —— 3D 预览画的就是这一份
   *
   * 跟算支撑克重用的是**同一个** `scalePositionsXYZ`(检查视角也是它)——
   * 画面上的模型跟左栏那个克重是同一个尺寸。
   */
  const scaledPositions = useMemo((): Float32Array | null => {
    const raw = model?.parseResult.positions;
    if (!raw) return null;
    return scalePositionsXYZ(raw, scales);
  }, [model, scales]);

  /** 贴图与材质分组 —— 全部来自同一个 `ModelFile`（不用再解析一遍 OBJ） */
  const textures = useMemo((): MeshTextureInfo | null => {
    if (!model) return null;
    const r = model.parseResult;
    return {
      uvs: r.uvs ?? null,
      materialNames: r.materialNames ?? [],
      materialIndex: r.materialIndex ?? null,
      mtlText: model.mtlText ?? null,
      textureUrls: model.textureUrls ?? null,
    };
  }, [model]);

  /**
   * 「检查」视角的状态 —— **住在视口的上一层**
   *
   * 视口要吃分析结果(问题着色)、图层开关、聚焦请求 —— 视角切换时换的
   * 就是这几样。分析器只在切到「检查」那一栏才启动。
   */
  const check = useCheckView({
    positions: scaledPositions,
    fileName: model?.objFileName || model?.name || "",
    liftMm: supportLiftMm,
    baseMarginMm: supportBaseMarginMm,
    active: tab === "check",
  });

  /**
   * 拖文件进展示区 —— **用共享的那一套**
   *
   * 计数版的口径见 `features/shared/hooks/use-drop-zone.ts`。
   */
  const handleDroppedFiles = useCallback(
    (files: File[]) => {
      onFiles?.(files);
    },
    [onFiles]
  );
  const { isDragOver: dragOver, dropHandlers } =
    useDropZone<HTMLDivElement>(handleDroppedFiles);

  /** 切换「统一缩放」：开时取 XYZ 缩放的几何平均，关时把三轴拉到同一值 */
  const toggleUniformScale = (checked: boolean) => {
    onUniformScaleChange(checked);
    if (checked) {
      onScaleFactorChange(Math.cbrt(scaleX * scaleY * scaleZ));
    } else {
      onScaleXChange(scaleFactor);
      onScaleYChange(scaleFactor);
      onScaleZChange(scaleFactor);
    }
  };

  /** 手动改某个轴的尺寸(mm) → 换算成该轴的缩放因子写回父组件 */
  const handleDimChange = (axis: 0 | 1 | 2, newValue: number) => {
    if (!model) return;
    const original = model.parseResult.boundingBox.size;
    const origVals = [original.x, original.y, original.z];
    const orig = origVals[axis]!;
    if (orig === 0 || !Number.isFinite(newValue) || newValue <= 0) return;
    const k = newValue / orig;
    if (uniformScale) {
      onScaleFactorChange(k);
    } else if (axis === 0) {
      onScaleXChange(k);
    } else if (axis === 1) {
      onScaleYChange(k);
    } else {
      onScaleZChange(k);
    }
  };

  const showViewer =
    model !== null &&
    geometry !== null &&
    (loadStatus === "loading-3d" || loadStatus === "ready");

  /**
   * 模型有没有贴图可显示 —— 没有贴图就不给「显示贴图」开关。
   *
   * `textureUrls` 里**每个材质都有一项**(哪怕是空的),所以要看的是
   * 「有没有哪个材质真的解析出了 base color 贴图」。
   */
  const hasTexture = Object.values(model?.textureUrls ?? {}).some((u) =>
    Boolean(u?.map)
  );

  // 没有模型、也没在加载 —— 什么都不渲染（页面上只有上传卡片）
  if (!model && loadStatus === "idle") return null;

  return (
    <div className="space-y-4">
      {/* ---------- 深色 3D 应用 ----------
          **统一用「以前那个检查工具」的设计** —— 一整块深色应用:
          头部(文件身份)→ 视角切换条 → 左边信息栏 + 右边 3D 视口。
          克重 / 检查 / 摆盘三个视角换的是**左边那一栏的内容**,
          整块外观不变。 */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-950 text-zinc-100 shadow-sm overflow-hidden">
        {/* ---------- 卡片头部（文件身份 + 操作）—— 由父组件渲染 ---------- */}
        {header !== undefined ? (
          <div className="px-4 py-3 border-b border-zinc-800 bg-zinc-900/60">
            {header}
          </div>
        ) : (
          <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-zinc-800 bg-zinc-900/60">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                <Boxes className="size-4 text-amber-400 shrink-0" />
                <span className="truncate">
                  {model
                    ? t("dialog.title", { name: model.name })
                    : t("dialog.titlePlain")}
                </span>
              </h3>
              <p className="text-xs text-zinc-400 mt-0.5">
                {t("dialog.description")}
              </p>
            </div>
          </div>
        )}

        {/* ---------- 解析中 ---------- */}
        {(loadStatus === "uploading" || loadStatus === "parsing") && (
          <div className="py-12 flex flex-col items-center text-center">
            <div className="size-16 rounded-full bg-amber-500/15 flex items-center justify-center mb-4">
              <Loader2 className="size-8 text-amber-400 animate-spin" />
            </div>
            <h3 className="text-base font-semibold text-zinc-100 mb-1">
              {loadStatus === "uploading"
                ? t("dialog.readingFile")
                : t("dialog.parsingObj")}
            </h3>
            <p className="text-sm text-zinc-400 max-w-md">
              {loadProgress || t("dialog.pleaseWait")}
            </p>
            <div className="mt-4 w-full max-w-xs">
              <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-amber-500 rounded-full transition-all duration-300"
                  style={{ width: `${Math.max(5, loadPercent)}%` }}
                />
              </div>
              <div className="mt-1 text-[10px] text-zinc-500 font-mono text-right">
                {loadPercent}%
              </div>
            </div>
          </div>
        )}

        {/* ---------- 解析失败 ---------- */}
        {loadStatus === "error" && uploadError && (
          <div className="py-12 flex flex-col items-center text-center">
            <div className="size-16 rounded-full bg-red-500/15 flex items-center justify-center mb-4">
              <AlertCircle className="size-8 text-red-400" />
            </div>
            <h3 className="text-base font-semibold text-zinc-100 mb-1">
              {t("dialog.loadFailed")}
            </h3>
            <p className="text-sm text-red-400 max-w-md mb-4">{uploadError}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={onClearModel}
              className="border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800 hover:text-zinc-100"
            >
              {t("dialog.reselectFile")}
            </Button>
          </div>
        )}

        {/* ---------- 共用的展示区域 + 左侧栏 ---------- */}
        {showViewer && model && geometry && (
          <>
            {/* ---------- 视角切换（检查 / 克重 / 摆盘）----------
              三个视角看的是**同一个**模型 —— 模型只载入一次,切换不重新解析。
              下面那一个 3D 视口也是**共用的**:切视角只换喂进去的数据。 */}
            <div className="flex items-center gap-1 border-b border-zinc-800 bg-zinc-900/60 px-3 py-2">
              {WORKSPACE_TABS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={tab === item.id}
                  onClick={() => onTabChange(item.id)}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    tab === item.id
                      ? "bg-amber-500 text-white shadow-sm"
                      : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                  }`}
                >
                  <item.icon className="size-3.5" />
                  {t(`tabs.${item.id}`)}
                </button>
              ))}
            </div>

            {/* ---------- 侧栏 + 共用的展示区域 ----------
              **侧栏在左,3D 视口在右** —— 跟以前那个模型检查工具一个方向
              (那边是「侧栏左 + 视口右」)。切视角只换**侧栏**的内容,
              视口不卸载、相机不动、模型不重建。

              断点跟旧检查工具一样是 `md`(768px 就并排)—— 以前那个工具
              在 768px 上就是「侧栏左 + 视口右」,等 1024px 的话这段窗口
              里还摆着老克重工具的方向(视口在上、面板在下)。 */}
            <div className="flex flex-col md:flex-row md:h-[560px]">
              {/* ---------- 右：共用的展示区域 ----------
                **只有一个 `ModelViewport`** —— 切视角不卸载它,
                相机不动、模型不重建,只是喂进去的数据换了。

                这一整列是**深色的**(顶栏 + 角度条 + 视口)—— 它就是那个
                3D 应用本身,跟以前检查工具的深色视口区是同一块地。 */}
              <div className="order-1 md:order-2 flex flex-col md:flex-1 min-w-0">
                <div className="flex items-center justify-between bg-zinc-950 px-3 py-2 border-b border-zinc-800">
                  <span className="text-xs font-medium text-zinc-400 flex items-center gap-1.5">
                    <Boxes className="size-3.5 text-amber-500" />
                    {t("dialog.preview3d")}
                  </span>
                  <div className="flex items-center gap-2">
                    {loadStatus === "loading-3d" && (
                      <span className="text-[10px] text-amber-400 font-mono flex items-center gap-1">
                        <Loader2 className="size-3 animate-spin" />
                        {loadPercent}%
                      </span>
                    )}
                    {loadStatus === "ready" && (
                      <button
                        type="button"
                        onClick={() => onOptimizeAngle(scales)}
                        disabled={angleOptimizing || !angleReady}
                        className="text-[10px] text-violet-300 hover:text-violet-200 flex items-center gap-1 px-2 py-0.5 rounded border border-violet-400/40 bg-white/10 hover:bg-white/20 disabled:opacity-50"
                      >
                        {angleOptimizing ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <Compass className="size-3" />
                        )}
                        {angleOptimizing
                          ? `${angleProgress}%`
                          : t("angle.optimize")}
                      </button>
                    )}
                  </div>
                </div>

                {/* ---------- 模型角度条 ----------
                  **转的是模型,不是相机** —— 摆着印(转模型)决定支撑克重,
                  摆着看(转相机)决定看得清看不清,是两件事。
                  三个视角都能转:在「检查」那一栏转了模型,切到「克重」
                  还是这个姿态。 */}
                {loadStatus === "ready" && (
                  <div className="px-3 py-2 border-b border-zinc-800 bg-zinc-900">
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] font-medium text-violet-300 shrink-0">
                        {t("angle.modelAngle")}
                      </span>
                      <div className="flex items-center gap-2 flex-1">
                        <AngleInput
                          label="X"
                          value={manualRotX}
                          onChange={(v) => onManualAngleChange("X", v, scales)}
                          color="#ef4444"
                          tone="dark"
                        />
                        <AngleInput
                          label="Y"
                          value={manualRotY}
                          onChange={(v) => onManualAngleChange("Y", v, scales)}
                          color="#22c55e"
                          tone="dark"
                        />
                        <AngleInput
                          label="Z"
                          value={manualRotZ}
                          onChange={(v) => onManualAngleChange("Z", v, scales)}
                          color="#3b82f6"
                          tone="dark"
                        />
                      </div>
                      {onResetAngle && (
                        <button
                          type="button"
                          onClick={onResetAngle}
                          title={t("angle.resetAngle")}
                          className="text-[10px] text-violet-300 hover:text-violet-200 flex items-center gap-1 px-2 py-0.5 rounded border border-violet-400/40 bg-white/10 hover:bg-white/20"
                        >
                          <RotateCcw className="size-3" />
                          {t("angle.resetAngle")}
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* ---------- 展示区 ----------
                  底色跟「检查」那一栏一样是深色 —— 同一个视口组件,
                  三处必须长得一样。 */}
                <div
                  className="relative h-[300px] sm:h-[360px] md:h-auto md:flex-1 md:min-h-[300px] bg-[#111418]"
                  {...dropHandlers}
                >
                  <ModelViewport
                    /* 「检查」那一栏喂分析结果(问题着色 / 问题边线),
                     别的视角喂 null —— 问题着色那一层压根不画。 */
                    result={tab === "check" ? check.result : null}
                    meshPositions={scaledPositions}
                    textures={textures}
                    showTexture={showTexture}
                    visibility={check.visibility}
                    showSupport={showSupport}
                    /* 支撑几何永远是摆盘 Worker 算的那块 —— 算克重的是它,
                     画出来的也得是它(否则转个角度画面就跟数字对不上)。 */
                    supportShell={poseSupport?.shell ?? null}
                    /* 模型姿态 —— 三个视角共用同一个角度 */
                    pose={{
                      rotX: viewerRotX,
                      rotY: viewerRotY,
                      rotZ: viewerRotZ,
                    }}
                    supportLiftMm={supportLiftMm}
                    focusRequest={tab === "check" ? check.focusRequest : null}
                    fitSignal={fitSignal}
                    onReady={onViewerReady}
                  />

                  {loadStatus === "loading-3d" && (
                    <div className="absolute inset-0 bg-[#111418]/85 backdrop-blur-sm flex flex-col items-center justify-center text-xs text-zinc-400 pointer-events-none">
                      <div className="size-10 rounded-full bg-amber-500/15 flex items-center justify-center mb-2">
                        <Loader2 className="size-5 text-amber-400 animate-spin" />
                      </div>
                      <span>{loadProgress || t("dialog.loadingPreview")}</span>
                      <div className="mt-2 w-32 h-1 bg-zinc-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-amber-500 rounded-full transition-all duration-300"
                          style={{ width: `${Math.max(5, loadPercent)}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* ---------- 分析进度(「检查」那一栏) ---------- */}
                  {tab === "check" && check.busy && (
                    <output className="absolute left-1/2 top-3 z-10 block w-64 -translate-x-1/2 rounded-lg border border-zinc-700 bg-zinc-900/95 px-3 py-2 shadow-xl">
                      <div className="mb-1.5 flex items-center gap-2 text-xs text-zinc-300">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        {check.stage
                          ? tInspect(`phases.${check.stage}`)
                          : tInspect("app.analyzing")}
                        <span className="ml-auto font-mono text-zinc-500">
                          {Math.round(check.pct)}%
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
                        <div
                          className="h-full rounded-full bg-emerald-500 transition-[width] duration-200"
                          style={{ width: `${check.pct}%` }}
                        />
                      </div>
                    </output>
                  )}

                  {/* ---------- 拖拽遮罩 ----------
                    `pointer-events-none` —— **必须**
                    遮罩盖在指针下面,它就成了拖放的事件目标:浏览器把
                    「进入遮罩」算成一次 dragenter、把「离开容器」算成一次
                    dragleave,容器跟着撤遮罩 → 遮罩没了 → 又 dragover ……
                    一直闪。遮罩只是给人看的,不吃事件。 */}
                  {dragOver && (
                    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center border-2 border-dashed border-emerald-500/60 bg-emerald-500/10 backdrop-blur-sm">
                      <p className="rounded-lg bg-zinc-900/90 px-4 py-2 text-sm text-emerald-300">
                        {tInspect("upload.dropOverlay")}
                      </p>
                    </div>
                  )}

                  {/* ---------- 浮层控制条 ----------
                    三个视角共用一条:问题图层开关(只有「检查」那一栏有)
                    + 显示贴图 / 包裹支撑 / 重置视角 + 支撑比例。 */}
                  {loadStatus === "ready" && (
                    <div className="pointer-events-auto absolute bottom-3 left-1/2 z-10 flex max-w-[95%] -translate-x-1/2 flex-wrap items-center justify-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/90 px-2.5 py-1.5 shadow-xl backdrop-blur">
                      {tab === "check" &&
                        check.activeLegend.map((item) => {
                          const on = check.visibility[item.key];
                          return (
                            <button
                              key={item.key}
                              type="button"
                              aria-pressed={on}
                              onClick={() =>
                                check.setVisibility((v) => ({
                                  ...v,
                                  [item.key]: !v[item.key],
                                }))
                              }
                              className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors ${on ? "bg-zinc-800/80 text-zinc-200" : "text-zinc-500 hover:text-zinc-300"}`}
                            >
                              <span
                                className="inline-block h-2.5 w-2.5 rounded-full transition-opacity"
                                style={{
                                  background: item.color,
                                  opacity: on ? 1 : 0.25,
                                }}
                              />
                              {tInspect(`legend.${ISSUE_LABEL_KEYS[item.key]}`)}
                            </button>
                          );
                        })}
                      {tab === "check" &&
                        check.result &&
                        check.activeLegend.length === 0 && (
                          <span className="flex items-center gap-1.5 rounded-md bg-emerald-500/10 px-2 py-1 text-xs text-emerald-300">
                            {tInspect("legend.clean")}
                          </span>
                        )}
                      {tab === "check" && check.activeLegend.length > 0 && (
                        <span
                          className="mx-0.5 hidden h-4 w-px bg-zinc-700 sm:block"
                          aria-hidden
                        />
                      )}
                      {hasTexture && (
                        <button
                          type="button"
                          aria-pressed={showTexture}
                          title={t("preview.textureTitle")}
                          onClick={onToggleTexture}
                          className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors ${
                            showTexture
                              ? "bg-amber-500/15 text-amber-300"
                              : "text-zinc-500 hover:text-zinc-300"
                          }`}
                        >
                          <Palette className="size-3.5" />
                          {t("preview.texture")}
                        </button>
                      )}
                      <button
                        type="button"
                        aria-pressed={showSupport}
                        title={t("preview.supportTitle")}
                        onClick={onToggleSupport}
                        className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors ${
                          showSupport
                            ? "bg-amber-500/15 text-amber-300"
                            : "text-zinc-500 hover:text-zinc-300"
                        }`}
                      >
                        <Shell className="size-3.5" />
                        {t("preview.support")}
                      </button>
                      {/* 重置视角 —— 把**相机**摆回默认位置(不是模型角度) */}
                      <button
                        type="button"
                        title={t("preview.resetViewTitle")}
                        onClick={() => setFitSignal((v) => v + 1)}
                        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-zinc-500 transition-colors hover:text-zinc-300"
                      >
                        <RotateCcw className="size-3.5" />
                        {t("preview.resetView")}
                      </button>
                      {poseSupport ? (
                        <span className="font-mono text-[10px] text-zinc-500">
                          {t("preview.supportInfo", {
                            ratio: Math.round(supportRatio * 100),
                            weight: Math.ceil(poseSupport.supportWeightG),
                          })}
                        </span>
                      ) : (
                        <span className="text-[10px] text-zinc-400">
                          {t("preview.supportPending")}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* ---------- 左:信息栏,按视角换内容 ----------
                展示区域(3D 视口)是共用的,左边这一栏按视角换 ——
                「检查」摆检查结论,「克重」摆尺寸调节 + 三个克重,
                「摆盘」摆智能摆盘结果。

                **三个视角共用同一个外壳、同一个深色设计** —— 跟以前那个
                检查工具一个方向(那边就是「侧栏左 + 视口右」)。 */}
              {tab === "check" ? (
                <aside className="order-2 md:order-1 md:w-[400px] md:shrink-0 p-3 md:overflow-y-auto border-t md:border-t-0 md:border-r border-zinc-800">
                  <h2 className="mb-3 flex items-center gap-2 text-sm font-bold tracking-tight text-zinc-100">
                    <ShieldCheck className="size-4 text-emerald-400" />
                    {tInspect("app.title")}
                  </h2>
                  <ModelCheckSidePanel
                    result={check.result}
                    busy={check.busy}
                    error={check.error}
                    unitCheck={unitCheck}
                    onFocusCluster={check.focusCluster}
                    onFocusPoint={check.focusPoint}
                  />
                </aside>
              ) : (
                <aside className="order-2 md:order-1 md:w-[400px] md:shrink-0 p-3 flex flex-col gap-3 md:overflow-y-auto border-t md:border-t-0 md:border-r border-zinc-800">
                  <h2 className="flex items-center gap-2 text-sm font-bold tracking-tight text-zinc-100">
                    {tab === "pose" ? (
                      <Compass className="size-4 text-violet-400" />
                    ) : (
                      <Scale className="size-4 text-amber-400" />
                    )}
                    {tab === "pose" ? t("tabs.pose") : t("tabs.weight")}
                  </h2>
                  <div className="rounded-lg border border-zinc-800 overflow-hidden">
                    <div className="flex items-center justify-between bg-zinc-900 px-3 py-2 border-b border-zinc-800">
                      <span className="text-xs font-medium text-zinc-400">
                        {t("dialog.dimensionAdjust")}
                      </span>
                      <div className="inline-flex rounded-md border border-zinc-700 bg-zinc-900 p-0.5">
                        <button
                          type="button"
                          onClick={() => onDimModeChange("original")}
                          className={`px-3 py-1 text-xs rounded transition-colors ${dimMode === "original" ? "bg-zinc-700 text-zinc-100" : "text-zinc-400 hover:text-zinc-100"}`}
                        >
                          {t("dialog.originalSize")}
                        </button>
                        <button
                          type="button"
                          onClick={() => onDimModeChange("custom")}
                          className={`px-3 py-1 text-xs rounded transition-colors ${dimMode === "custom" ? "bg-amber-500 text-white" : "text-zinc-400 hover:text-zinc-100"}`}
                        >
                          {t("dialog.customSize")}
                        </button>
                      </div>
                    </div>

                    <div className="p-3 space-y-3">
                      {/* ---------- 单位横幅 ----------
                    文件坐标不是毫米(AI 生成 / Blender 默认导出都是归一化的),
                    工具已经按「最大边 100mm」替用户归一化过了 —— 这件事必须
                    摆出来,否则用户看到的尺寸跟他想的不是一个东西。

                    托底 5mm 是固定毫米值,不跟着模型缩放:不归一化的话平台会
                    被拉到模型下面 5 个「单位」,支撑比模型本身还高,支撑比例是
                    万倍量级(见 `lib/model-units.ts`)。 */}
                      {unitCheck?.normalized && (
                        <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2">
                          <AlertCircle className="size-3.5 shrink-0 mt-px text-amber-400" />
                          <div className="min-w-0 flex-1 text-[11px] leading-relaxed">
                            <p className="font-medium text-amber-200">
                              {t("dialog.unitNotice", {
                                extent: fmt(unitCheck.originalMaxExtent, 2),
                              })}
                            </p>
                            <p className="text-amber-300/80">
                              {dimMode === "custom"
                                ? t("dialog.unitNoticeHandled", {
                                    size: unitCheck.assumedMaxExtentMm,
                                  })
                                : t("dialog.unitNoticeUnhandled")}
                            </p>
                          </div>
                          {/* 「改回原始尺寸」只在归一化还生效时给 —— 已经回到原始
                        尺寸的话,这个按钮按下去什么都不会变。 */}
                          {dimMode === "custom" && onRevertUnitScale && (
                            <button
                              type="button"
                              onClick={onRevertUnitScale}
                              className="shrink-0 text-[11px] font-medium text-amber-300 hover:text-amber-200 underline underline-offset-2 whitespace-nowrap"
                            >
                              {t("dialog.revertOriginalUnits")}
                            </button>
                          )}
                        </div>
                      )}

                      <div className="space-y-2 min-h-[124px] flex flex-col justify-start">
                        <div className="grid grid-cols-3 gap-2">
                          {dimMode === "original" ? (
                            <>
                              <DimDisplay
                                axis="X"
                                axisColor="#ef4444"
                                label={t("axis.length")}
                                value={geometry.originalDims[0]}
                              />
                              <DimDisplay
                                axis="Y"
                                axisColor="#22c55e"
                                label={t("axis.width")}
                                value={geometry.originalDims[1]}
                              />
                              <DimDisplay
                                axis="Z"
                                axisColor="#3b82f6"
                                label={t("axis.height")}
                                value={geometry.originalDims[2]}
                              />
                            </>
                          ) : (
                            <>
                              <DimEditor
                                axis="X"
                                axisColor="#ef4444"
                                label={t("axis.length")}
                                value={geometry.dims[0]}
                                onChange={(v) => handleDimChange(0, v)}
                              />
                              <DimEditor
                                axis="Y"
                                axisColor="#22c55e"
                                label={t("axis.width")}
                                value={geometry.dims[1]}
                                onChange={(v) => handleDimChange(1, v)}
                              />
                              <DimEditor
                                axis="Z"
                                axisColor="#3b82f6"
                                label={t("axis.height")}
                                value={geometry.dims[2]}
                                onChange={(v) => handleDimChange(2, v)}
                              />
                            </>
                          )}
                        </div>

                        <div className="flex items-center justify-between text-xs h-5">
                          {dimMode === "original" ? (
                            <span className="text-zinc-400 flex items-center gap-1">
                              <Info className="size-3" />
                              {t("dialog.switchToCustom")}
                            </span>
                          ) : (
                            <>
                              <span className="text-zinc-400 flex items-center gap-1">
                                <Info className="size-3" />
                                {uniformScale
                                  ? t("dialog.linkedScale")
                                  : t("dialog.independentScale")}
                              </span>
                              <div className="flex items-center gap-2">
                                {/* Radix Switch 渲染的是 button 而不是 input，
                              用 <label> 包它会被 a11y 规则判为「无关联控件的 label」，
                              这里改成可点击的按钮 + Switch。 */}
                                <div className="flex items-center gap-1 text-[11px] text-zinc-400">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      toggleUniformScale(!uniformScale)
                                    }
                                    className="cursor-pointer hover:text-zinc-200"
                                  >
                                    {t("dialog.uniformScale")}
                                  </button>
                                  <Switch
                                    checked={uniformScale}
                                    onCheckedChange={toggleUniformScale}
                                    className="scale-75"
                                  />
                                </div>
                                <button
                                  type="button"
                                  onClick={() => {
                                    onScaleFactorChange(1);
                                    onScaleXChange(1);
                                    onScaleYChange(1);
                                    onScaleZChange(1);
                                  }}
                                  className="text-amber-400 hover:text-amber-300 font-medium flex items-center gap-1"
                                >
                                  <RotateCcw className="size-3" />
                                  {t("dialog.restoreOriginal")}
                                </button>
                              </div>
                            </>
                          )}
                        </div>

                        <div className="text-[11px] h-6 flex items-center gap-1.5">
                          {dimMode === "custom" &&
                            (() => {
                              const [sx, sy, sz] = scales;
                              const isUniform = sx === sy && sy === sz;
                              const k = isUniform
                                ? sx
                                : Math.cbrt(sx * sy * sz);
                              if (Math.abs(k - 1) < 0.001) return null;
                              return (
                                <span className="text-zinc-300 bg-amber-500/10 border border-amber-500/30 rounded px-2 py-1 flex items-center gap-1.5 w-full">
                                  <AlertCircle className="size-3 text-amber-400 shrink-0" />
                                  {isUniform
                                    ? t("dialog.scaleSummaryUniform", {
                                        s: fmt(sx, 3),
                                        v: fmt(sx ** 3, 3),
                                        a: fmt(sx ** 2, 3),
                                      })
                                    : t("dialog.scaleSummaryAxis", {
                                        sx: fmt(sx, 3),
                                        sy: fmt(sy, 3),
                                        sz: fmt(sz, 3),
                                        v: fmt(sx * sy * sz, 3),
                                      })}
                                </span>
                              );
                            })()}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* 克重 —— 尺寸调完之后的结果，放最后。
                mt-auto:侧栏比右边视口矮/高的差都让出来,克重贴着栏底,
                跟视口的底边对齐(挤在中间会像没排完)。

                「摆盘」视角换成摆盘结果 —— 两个问题分两栏看,不挤在一块。 */}
                  <div className="mt-auto">
                    {tab === "pose" ? pose : weight}
                  </div>
                </aside>
              )}
            </div>
          </>
        )}
      </div>

      {/* ---------- 下单出口 ----------
          在**每一个**视角都在 —— 检查完就该能下单,不该再跳回
          「克重」那一栏找按钮。

          **在深色应用外面** —— 它是页面里的一张浅色卡(工作室的
          「加入打印单」按钮),不是 3D 应用的一部分。 */}
      {showViewer && model && geometry && quote}
    </div>
  );
}
