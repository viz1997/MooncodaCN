"use client";

import {
  AlertCircle,
  Beaker,
  Box,
  Calculator,
  Compass,
  Download,
  FileArchive,
  ListChecks,
  Package,
  Pencil,
  RotateCcw,
  Scale,
  UploadCloud,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
/**
 * 移植自 wjp-source-code/src/app/page.tsx —— 3D 打印克重计算器主组件。
 *
 * ## 边界
 *
 * **只算不存**：所有解析 / 摆盘 / 克重计算都在浏览器本地完成，模型文件不上传服务器，
 * 计算结果不写数据库。
 *
 * **材料参数跟随后台，访客改不了**（2026-11-06）：密度 / 支撑几何由工作室在
 * `/admin/print-pricing` 配好，页面的 RSC 读出来当 `clientConfig` prop 传下来。
 * 原来那条「密码解锁 → 改密度」的路（`/api/image-gen/pricing/materials-auth`）
 * 整个退役了 —— 访客改密度只会让「工具页看到的克重」跟「打印单上的价」对不上。
 *
 * **只展示克重**：页面对外只呈现体积 / 表面积 / 本体克重 / 支撑克重 / 摆盘角度，
 * 不呈现任何价格。计价相关状态（`unitPrice` 等）仍保留在底层 `pricing-engine.ts`
 * 里 —— `calculatePrice()` 是克重的唯一来源，`unitPrice` 非法会让它返回 null，
 * 连克重一起消失，所以这些 state 绝不删，只是不再渲染。
 *
 * ## 与源实现的差异
 *
 *  - 「模型设置」从弹窗改成**页面内的一张卡**（`ModelSettingsPanel`，见该文件
 *    说明）：结果卡与模型设置卡合并成同一张 —— 头部是文件身份 + 几何标签，
 *    左栏 3D 预览，右栏克重 + 摆盘结果 + 尺寸调节；
 *  - 材料参数密码校验改为服务端环境变量（源实现把哈希硬编码在客户端），
 *    2026-11-06 起进一步改成**后台统一配置**、访客只读；
 *  - 文案全部改为 t() 调用（i18n）。
 */
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { BatchModeSection } from "@/features/pricing/components/batch-mode-section";
import {
  type DimMode,
  type LoadStatus,
  type ModelGeometry,
  ModelSettingsPanel,
  type WorkspaceTab,
} from "@/features/pricing/components/model-settings-panel";
import { ObjThumbnail } from "@/features/pricing/components/obj-thumbnail";
import type { PricingModelPayload } from "@/features/pricing/components/pricing-calculator-types";
import {
  type InfoDialogKind,
  PricingInfoDialogs,
} from "@/features/pricing/components/pricing-info-dialogs";
import {
  DimInput,
  fmt,
  PRODUCT_TYPES,
  SOLID_PRESETS,
  scaleGeometryXYZ,
} from "@/features/pricing/components/shared";
import { TextureDiagnosticNote } from "@/features/pricing/components/texture-diagnostic";
import {
  type OptimalAngle,
  resolveSupportDensity,
  type SupportParams,
  type SupportPoseResult,
} from "@/features/pricing/lib/angle-optimizer";
import { AngleOptimizerClient } from "@/features/pricing/lib/angle-optimizer-client";
import {
  type BatchItem,
  type BatchOptions,
  initBatch,
  processBatch,
} from "@/features/pricing/lib/batch-processor";
import {
  detectModelUnitScale,
  type ModelUnitCheck,
} from "@/features/pricing/lib/model-units";
import {
  downloadModelZip,
  downloadObjFile,
  exportRotatedObj,
} from "@/features/pricing/lib/obj-exporter";
import {
  comparePoseSupport,
  describePose,
  weightPanelNumbers,
} from "@/features/pricing/lib/pose-comparison";
import {
  calculatePrice,
  DEFAULT_CONFIG,
  estimateEnvelopeGeometry,
  type PricingConfig,
  type PricingInput,
  type RepairMode,
} from "@/features/pricing/lib/pricing-engine";
import {
  extractModelZip,
  type ModelFile,
  revokeModelTextureUrls,
} from "@/features/pricing/lib/zip-extractor";
import type { ClientPrintConfig } from "@/features/print-quote/lib/pricing-settings";
import type { PrintQuoteInput } from "@/features/print-quote/lib/quote-types";
import { useDropZone } from "@/features/shared/hooks/use-drop-zone";
import {
  MeshCheckBadge,
  MeshCheckIssues,
} from "@/features/tools/components/mesh-check-badge";
import type { MeshCheckSummary } from "@/features/tools/lib/mesh/summary";
import {
  SUPPORT_BASE_MARGIN_MM,
  SUPPORT_LIFT_MM,
} from "@/features/tools/lib/mesh/support-shell";

type Mode = "upload" | "manual" | "batch";

/**
 * 模型载荷的类型定义在 `pricing-calculator-types.ts` —— 从这里再导出一次,
 * 免得每个调用方都要知道它住在哪个文件。
 */
export type { PricingModelPayload };

const yieldToUI = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

export function PricingCalculator({
  showChrome = true,
  onQuoteInput,
  quoteSlot,
  onModelChange,
  clientConfig,
}: {
  /**
   * 是否渲染工具自带的页头 / 页脚。
   *
   * true  —— 独立成页（源项目的形态），自带 header + footer。
   * false —— 挂在站点自己的 layout 里（公开页 `/tools/workbench`）：页头 / 页脚 /
   *         标题块 / 工具按钮一律不渲染，避免双 Header 双 Footer 和页面里
   *         重复出现一遍标题。
   */
  showChrome?: boolean;

  /**
   * 几何变化回调 —— 把「几何 + 支撑」抛给父组件。
   *
   * 传 null 表示「当前没有模型」。父组件拿它去拼打印服务的规格
   * （`printSpec`：体积 / 表面积 / 尺寸 / 支撑克重）—— 服务端按这组数
   * 重算报价。
   *
   * **这里只抛输入,不抛价格** —— 价格必须服务端算(客户端能改)。
   */
  onQuoteInput?: (input: PrintQuoteInput | null) => void;

  /**
   * 右栏插槽 —— 渲染在右栏克重面板下方。
   *
   * `/tools/workbench` 放的是「加入打印单」卡片 —— 工具里不显示价格,只给一个
   * 把模型加进打印单的出口。
   *
   * 传了才渲染,不传就是空的。
   */
  quoteSlot?: ReactNode;

  /**
   * 模型就绪回调 —— 父组件要用模型文件本体时用它。
   *
   * 下单时要按用户调过的尺寸重新打包模型上传,不带 `scales` 的话
   * 工作室拿到的文件尺寸和报价单上的尺寸对不上。
   */
  onModelChange?: (payload: PricingModelPayload | null) => void;

  /**
   * 后台配的材料参数 —— **只读**,访客改不了
   *
   * 密度、支撑几何都跟随后台(`/admin/print-pricing`),RSC 读好当 prop
   * 传下来。不传就用引擎的默认值(组件单独用的时候)。
   *
   * 这里只有**几何和密度**,没有价格 —— 价格是服务端算的。
   */
  clientConfig?: ClientPrintConfig;
}) {
  const t = useTranslations("MaterialPricing");

  const [mode, setMode] = useState<Mode>("upload");
  const [infoDialog, setInfoDialog] = useState<InfoDialogKind>(null);
  /**
   * 工作台视角 —— 检查 / 克重 / 摆盘
   *
   * 三个视角看的是**同一个**模型。默认落在「克重」上 —— 工作室的主路径是
   * 「量克重 → 加进打印单」,检查是可选的一步。
   */
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>("weight");

  // ---- 模型 ----
  const [model, setModel] = useState<ModelFile | null>(null);
  const [loadStatus, setLoadStatus] = useState<LoadStatus>("idle");
  const [loadProgress, setLoadProgress] = useState("");
  const [loadPercent, setLoadPercent] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  /** 正在解析的文件名 —— 解析完成前 `model` 还是 null，头部要靠它显示文件名 */
  const [fileName, setFileName] = useState<string | null>(null);
  /**
   * 网格自检摘要 —— **焊接的时候顺手算出来的**
   *
   * 摆盘 Worker 焊接模型时本来就要建完整拓扑,摘要吃的就是那份拓扑 ——
   * 不多焊一次。头部那枚「打印前检查」徽标吃它。
   */
  const [meshSummary, setMeshSummary] = useState<MeshCheckSummary | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ---- 手动模式尺寸 ----
  const [length, setLength] = useState(68.3);
  const [width, setWidth] = useState(80);
  const [height, setHeight] = useState(43.6);

  // ---- 尺寸调节（页面内直接改，改完即生效）----
  const [dimMode, setDimMode] = useState<DimMode>("original");
  const [uniformScale, setUniformScale] = useState(true);
  const [scaleFactor, setScaleFactor] = useState(1);
  const [scaleX, setScaleX] = useState(1);
  const [scaleY, setScaleY] = useState(1);
  const [scaleZ, setScaleZ] = useState(1);
  /**
   * 单位判定结果 —— 文件坐标不是毫米时才有值
   *
   * 判出来的横幅要在尺寸面板上摆出来(「这个文件的坐标不是毫米」),
   * 用户得知道工具替他把尺寸换算过了。
   */
  const [unitCheck, setUnitCheck] = useState<ModelUnitCheck | null>(null);

  // ---- 计算参数 ----
  const [solidRatio, setSolidRatio] = useState(30);
  const [coverage, setCoverage] = useState(50);
  const [repairMode, setRepairMode] = useState<RepairMode>("none");
  const [repairPrice, setRepairPrice] = useState(0);
  const repairEnabled = repairMode !== "none";
  /**
   * 材料密度 —— **跟随后台,访客改不了**
   *
   * `clientConfig` 是 RSC 从 `/admin/print-pricing` 读出来的生效设置。
   * 访客侧的「材料参数」弹窗是只读的 —— 密度改了,支撑克重就是假的,
   * 而服务端报价按自己那份密度算,两边对不上。
   */
  const materialDensity =
    clientConfig?.modelDensity ?? DEFAULT_CONFIG.materialDensity;
  /**
   * 支撑材料密度 (g/cm³) —— 支撑跟模型**不是**一种材料
   *
   * 工作室用的是水溶性支撑(PVA/BVOH,约 1.13~1.30 g/cm³),模型是光敏树脂。
   * 所以支撑克重按**支撑密度**算,不能拿模型密度乘:
   *
   *   耗材克重 = 模型体积 × 模型密度
   *   支撑克重 = 支撑体积 × 支撑密度
   *   总克重   = 耗材克重 + 支撑克重
   */
  const supportDensity =
    clientConfig?.supportDensity ?? DEFAULT_CONFIG.supportDensity;
  // ↓↓↓ 价格相关常量：UI 不展示，但**绝不能删** ↓↓↓
  // `calculatePrice()` 是 `materialWeight`（克重）的唯一来源，它在
  // `unitPrice` 非法时返回 null —— 一旦 null，整个克重界面连同体积一起消失。
  // 所以这些值保持合法且恒为默认，只是不渲染。
  const unitPrice = DEFAULT_CONFIG.unitPrice;
  const varnishEnabled = true;
  const varnishFee = DEFAULT_CONFIG.varnishFee;
  const supportThreshold = DEFAULT_CONFIG.supportThreshold;
  const supportEnabled = false;
  const [productId, setProductId] = useState("pet");

  // ---- 支撑计算参数 ----
  /**
   * 支撑克重 = 支撑体积 × **支撑密度**(支撑是另一种材料,水溶性支撑)
   *
   * 体积还是那个几何算出来的包裹支撑体积(跟检测工具同一块);
   * 密度是支撑材料自己的 —— 模型密度只用来算耗材克重。
   *
   * 托底高度 / 底板留边也跟随后台 —— 几何参数变了,支撑克重跟着变,
   * 3D 预览画的那层托底用的是同一组数(画面跟报价对得上)。
   */
  const supportParams = useMemo<SupportParams>(
    () => ({
      modelDensity: materialDensity,
      supportDensity,
      liftMm: clientConfig?.supportLiftMm,
      baseMarginMm: clientConfig?.supportBaseMarginMm,
    }),
    [
      materialDensity,
      supportDensity,
      clientConfig?.supportLiftMm,
      clientConfig?.supportBaseMarginMm,
    ]
  );

  // ---- 智能摆盘 ----
  const [optimalAngle, setOptimalAngle] = useState<OptimalAngle | null>(null);
  const [angleOptimizing, setAngleOptimizing] = useState(false);
  const [angleProgress, setAngleProgress] = useState(0);
  /**
   * **当前角度**的包裹支撑数据 —— 摆盘之前也有(初始角度就是 0°,0°)。
   *
   * 以前支撑克重只在跑完智能摆盘之后才有,没摆盘时页面上是「—」;
   * 现在模型一进来就算初始角度的支撑:改尺寸 / 拖角度
   * 都只改这一个姿态,数字始终对得上当前画面。
   */
  const [poseSupport, setPoseSupport] = useState<SupportPoseResult | null>(
    null
  );
  /**
   * 模型已经进了摆盘客户端(可以开始算姿态了)
   *
   * 不管是进了 Worker 还是退回主线程算的,都算「就绪」——
   * 支撑克重不能因为 Worker 掉链子就永远是「—」。
   */
  const [supportModelReady, setSupportModelReady] = useState(false);
  /** 支撑算不出来时的原因(页面上一行小字提示,别让用户对着「—」猜) */
  const [supportError, setSupportError] = useState<string | null>(null);
  const [showSupport, setShowSupport] = useState(true);
  /**
   * 3D 预览是否显示模型自带的贴图 —— 与检测工具的「显示贴图」开关同一套行为。
   * 关掉就是纯色(MTL 的 `Kd` 本色)视图,方便看模型本体形状。
   */
  const [showTexture, setShowTexture] = useState(true);
  const [viewerRotX, setViewerRotX] = useState(0);
  const [viewerRotY, setViewerRotY] = useState(0);
  const [viewerRotZ, setViewerRotZ] = useState(0);
  const [manualRotX, setManualRotX] = useState(0);
  const [manualRotY, setManualRotY] = useState(0);
  const [manualRotZ, setManualRotZ] = useState(0);
  /**
   * 摆盘 Worker 客户端 —— 焊接 + 625 个候选姿态的支撑搜索都在 Worker 里跑,
   * 主线程只发指令收结果(摆盘期间页面照样能点能拖)。
   */
  const angleClientRef = useRef<AngleOptimizerClient | null>(null);
  useEffect(() => {
    const client = new AngleOptimizerClient();
    angleClientRef.current = client;
    return () => {
      client.dispose();
      angleClientRef.current = null;
    };
  }, []);
  /** 原始姿态(0°,0°)的支撑克重缓存 —— 只跟尺寸 / 材料密度有关,跟当前角度无关 */
  const originalSupportRef = useRef<{ key: string; weight: number }>({
    key: "",
    weight: 0,
  });

  // ---- 批量 ----
  const [batchItems, setBatchItems] = useState<BatchItem[]>([]);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchConcurrency, setBatchConcurrency] = useState(4);
  const [batchApplyAngle, setBatchApplyAngle] = useState(true);
  const batchFileInputRef = useRef<HTMLInputElement>(null);
  const batchAbortRef = useRef<AbortController | null>(null);

  const pricingConfig: PricingConfig = useMemo(
    () => ({
      ...DEFAULT_CONFIG,
      materialDensity,
      supportDensity,
      unitPrice,
      varnishFee,
      varnishEnabled,
      repairMode,
      productId,
      supportThreshold,
      supportEnabled,
    }),
    [
      materialDensity,
      supportDensity,
      unitPrice,
      varnishFee,
      repairMode,
      productId,
      supportThreshold,
    ]
  );

  /** 当前已应用的缩放因子（XYZ） */
  const appliedScales = useMemo((): [number, number, number] => {
    if (dimMode !== "custom") return [1, 1, 1];
    if (uniformScale) return [scaleFactor, scaleFactor, scaleFactor];
    return [scaleX, scaleY, scaleZ];
  }, [dimMode, uniformScale, scaleFactor, scaleX, scaleY, scaleZ]);

  /**
   * 最新生效的缩放因子 —— 摆盘是异步的(好几秒),完成时要用「此刻」的尺寸,
   * 不然摆出来的支撑克重跟页面上显示的尺寸对不上。
   */
  const scalesRef = useRef(appliedScales);
  useEffect(() => {
    scalesRef.current = appliedScales;
  }, [appliedScales]);

  /**
   * 模型进页面 → 把几何交给摆盘 Worker(焊接 + 拓扑在 Worker 里做,主线程不卡)
   *
   * 几何是解析阶段就带出来的(`parseResult.positions`),不用再解析一遍 OBJ。
   */
  useEffect(() => {
    const client = angleClientRef.current;
    const positions = model?.parseResult.positions;
    if (!client || !positions) {
      setSupportModelReady(false);
      setPoseSupport(null);
      return;
    }
    let cancelled = false;
    setSupportModelReady(false);
    // 换模型 → 旧模型的支撑数据作废
    setPoseSupport(null);
    setSupportError(null);
    // 换模型 → 旧模型的自检结论作废(新模型还没焊)
    setMeshSummary(null);
    originalSupportRef.current = { key: "", weight: 0 };
    client
      .load("main", positions, fileName ?? undefined)
      .then((summary) => {
        if (cancelled) return;
        setSupportModelReady(true);
        // 焊接时顺带算出来的自检摘要 —— 头部那枚徽标吃它
        setMeshSummary(summary);
      })
      .catch((err) => {
        console.error("摆盘 Worker 加载模型失败:", err);
        if (!cancelled) {
          setSupportError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [model, fileName]);

  /**
   * 支撑克重重算 —— **唯一**的支撑计算入口
   *
   * 尺寸改了 / 角度改了,都走这里,保证「支撑克重」永远跟
   * 「当前尺寸 + 当前姿态」一致。之前每条路各算一次,漏了
   * 「改尺寸」那条 —— 改完尺寸模型克重更新了,支撑克重还停在旧尺寸上,
   * 支撑比例和报价全是错的。
   *
   * 算的是**缩放后**的真实几何:缩放只挪顶点(拓扑不变),不用重新焊接。
   *
   * 计算在 Worker 里跑(主线程只发一条指令),所以拖滑块 / 改尺寸时
   * 页面不会卡 —— 姿态算完再回填数字。
   *
   * 没有智能摆盘结果时也要算:**初始角度**(0°,0°)的支撑一开始就显示,
   * 不用先摆一次盘才知道要多少支撑。
   */
  useEffect(() => {
    const client = angleClientRef.current;
    if (!client || !supportModelReady || !model) return;
    const [sx, sy, sz] = appliedScales;
    const modelWeightG =
      model.parseResult.volumeCM3 * sx * sy * sz * materialDensity;
    // 原始姿态(摆盘对比用):只跟尺寸 / 支撑密度有关,没变就沿用缓存
    const originalKey = `${sx}|${sy}|${sz}|${resolveSupportDensity(
      supportParams
    )}`;
    const needOriginal = originalSupportRef.current.key !== originalKey;
    let cancelled = false;
    void (async () => {
      try {
        const [pose, originalPose] = await Promise.all([
          client.pose("main", {
            rotX: manualRotX,
            rotY: manualRotY,
            rotZ: manualRotZ,
            scales: [sx, sy, sz],
            params: supportParams,
            // 顺带回传**画出来的**那块支撑几何 —— 3D 预览画的那圈支撑
            // 必须跟算克重的是同一块(外壳在算体积的同一次调用里建出来)。
            withShell: true,
          }),
          needOriginal
            ? client.pose("main", {
                rotX: 0,
                rotY: 0,
                rotZ: 0,
                scales: [sx, sy, sz],
                params: supportParams,
              })
            : Promise.resolve(null),
        ]);
        if (cancelled) return;
        const supportRatio =
          modelWeightG > 0 ? pose.supportWeightG / modelWeightG : 0;
        let originalWeight = originalSupportRef.current.weight;
        if (originalPose) {
          originalWeight = originalPose.supportWeightG;
          originalSupportRef.current = {
            key: originalKey,
            weight: originalWeight,
          };
        }
        setPoseSupport(pose);
        setSupportError(null);
        setOptimalAngle((prev) => {
          if (!prev) return prev;
          const next = {
            ...prev,
            rotX: manualRotX,
            rotY: manualRotY,
            selfSupportRatio: supportRatio,
            totalSupportRatio: supportRatio,
            totalSupportWeight: pose.supportWeightG,
            selfSupportArea: pose.supportAreaMM2,
            supportVolume: pose.supportVolumeMM3,
            wrapVolume: pose.wrapVolumeMM3,
            wrapArea: pose.wrapAreaMM2,
            overhangArea: pose.overhangAreaMM2,
            coloredDownArea: pose.coloredWrapAreaMM2,
            rotatedHeight: pose.rotatedHeightMM,
            originalWeight,
            originalRatio:
              pose.supportWeightG > 0
                ? originalWeight / pose.supportWeightG
                : 1,
          };
          // 值没变就别 setState(否则这个 effect 会因为 optimalAngle 变化再跑一遍)
          if (
            prev.totalSupportWeight === next.totalSupportWeight &&
            prev.selfSupportRatio === next.selfSupportRatio &&
            prev.rotatedHeight === next.rotatedHeight &&
            prev.originalWeight === next.originalWeight &&
            prev.rotX === next.rotX &&
            prev.rotY === next.rotY
          ) {
            return prev;
          }
          return next;
        });
      } catch (err) {
        console.error("支撑重算失败:", err);
        if (!cancelled) {
          setSupportError(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    appliedScales,
    manualRotX,
    manualRotY,
    manualRotZ,
    supportParams,
    materialDensity,
    model,
    supportModelReady,
  ]);

  const geometry = useMemo((): ModelGeometry | null => {
    if (mode === "upload") {
      if (!model) return null;
      const r = model.parseResult;
      // 坐标系约定：X=长, Y=宽, Z=高（与 OBJ 原始坐标一致）
      const origDims: [number, number, number] = [
        r.boundingBox.size.x,
        r.boundingBox.size.y,
        r.boundingBox.size.z,
      ];
      const [sx, sy, sz] = appliedScales;
      const scaled = scaleGeometryXYZ(
        r.volumeCM3,
        r.surfaceAreaCM2,
        origDims,
        sx,
        sy,
        sz
      );
      return {
        volumeCM3: scaled.volumeCM3,
        surfaceAreaCM2: scaled.surfaceAreaCM2,
        dims: scaled.dims,
        originalDims: origDims,
      };
    }
    const env = estimateEnvelopeGeometry(length, width, height, solidRatio);
    return {
      volumeCM3: env.volumeCM3,
      surfaceAreaCM2: env.surfaceAreaCM2,
      dims: env.dims,
      originalDims: [length, width, height] as [number, number, number],
    };
  }, [mode, model, length, width, height, solidRatio, appliedScales]);

  /**
   * 当前角度的支撑克重 + 支撑比例(支撑克重 / 模型克重)
   *
   * 支撑数据来自 Worker 算出来的当前姿态 —— 没跑智能摆盘时就是初始角度
   * (0°,0°)的支撑,所以模型一进来就有数。
   */
  const supportStats = useMemo(() => {
    if (!poseSupport || !model) return { weightG: 0, ratio: 0 };
    const [sx, sy, sz] = appliedScales;
    const modelWeightG =
      model.parseResult.volumeCM3 * sx * sy * sz * materialDensity;
    return {
      weightG: poseSupport.supportWeightG,
      ratio: modelWeightG > 0 ? poseSupport.supportWeightG / modelWeightG : 0,
    };
  }, [poseSupport, model, appliedScales, materialDensity]);

  const calc = useMemo(() => {
    if (!geometry) return null;
    const input: PricingInput = {
      volumeCM3: geometry.volumeCM3,
      surfaceAreaCM2: geometry.surfaceAreaCM2,
      mode: mode === "batch" ? "upload" : mode,
      solidRatio,
      dims: geometry.dims,
      // 支撑克重跟**当前角度**走(没摆盘时就是初始角度的支撑)
      supportWeight: supportEnabled ? Math.ceil(supportStats.weightG) : 0,
      selfSupportRatio: supportEnabled ? supportStats.ratio : 0,
    };
    const result = calculatePrice(pricingConfig, input);
    if (!result) return null;
    const fee = repairEnabled ? repairPrice : 0;
    return {
      ...result,
      repairFee: fee,
      totalPrice: result.totalPrice + fee,
      coveredArea: geometry.surfaceAreaCM2 * (coverage / 100),
    };
  }, [
    geometry,
    pricingConfig,
    mode,
    solidRatio,
    coverage,
    repairEnabled,
    repairPrice,
    supportStats,
  ]);

  // ---- 把几何交给父组件 ----
  //
  // 只抛**输入**（几何 + 支撑），不抛价格 —— 价格必须服务端算，客户端
  // 算的价不能信（见 print-quote/lib/quote-server.ts 的说明）。
  //
  // 回调放进 ref：父组件每次渲染都会新建这个函数，直接进依赖数组会让
  // 这个 effect 每渲染一次就跑一次，父组件 setState → 再渲染 → 死循环。
  const onQuoteInputRef = useRef(onQuoteInput);
  useEffect(() => {
    onQuoteInputRef.current = onQuoteInput;
  }, [onQuoteInput]);

  useEffect(() => {
    const notify = onQuoteInputRef.current;
    if (!notify) return;
    if (!geometry) {
      notify(null);
      return;
    }
    notify({
      volumeCM3: geometry.volumeCM3,
      surfaceAreaCM2: geometry.surfaceAreaCM2,
      dims: geometry.dims,
      // 支撑数据跟当前角度走 —— 没跑智能摆盘时就是初始角度的支撑
      supportWeightG: poseSupport
        ? Math.ceil(poseSupport.supportWeightG)
        : null,
      selfSupportRatio: poseSupport ? supportStats.ratio : null,
    });
  }, [geometry, poseSupport, supportStats]);

  // 模型本体也要抛给父组件 —— 下单时要把文件打包上传到 R2
  const onModelChangeRef = useRef(onModelChange);
  useEffect(() => {
    onModelChangeRef.current = onModelChange;
  }, [onModelChange]);

  useEffect(() => {
    const notify = onModelChangeRef.current;
    if (!notify) return;
    notify(model ? { model, scales: appliedScales } : null);
  }, [model, appliedScales]);

  // ---- 文件上传 ----
  /**
   * 载入一个模型文件 —— 拖拽 / 选择文件 / **从检查工具接力过来**都走这里
   *
   * 单独抽出来是因为接力:模型检查工具把文件递过来时,这边要能直接
   * `loadFile(file)`,不用伪造一个 `change` 事件。
   */
  const loadFile = useCallback(
    async (file: File) => {
      setUploadError(null);
      setFileName(file.name);
      setLoadPercent(0);
      setDimMode("original");
      setScaleFactor(1);
      setUniformScale(true);
      setScaleX(1);
      setScaleY(1);
      setScaleZ(1);
      setOptimalAngle(null);
      setViewerRotX(0);
      setViewerRotY(0);
      setViewerRotZ(0);
      setManualRotX(0);
      setManualRotY(0);
      setManualRotZ(0);
      // 换模型 → 支撑数据作废(新模型要重新焊接 + 重算)
      setPoseSupport(null);
      // 换模型 → 自检结论作废(新模型还没焊)
      setMeshSummary(null);
      // 换模型 → 贴图开关复位(新模型可能压根没有贴图)
      setShowTexture(true);
      setLoadStatus("uploading");
      setLoadProgress(t("upload.reading"));
      await yieldToUI();
      try {
        setLoadStatus("parsing");
        setLoadProgress(t("upload.parsing"));
        setLoadPercent(10);
        await yieldToUI();
        const result = await extractModelZip(file, (p) => {
          setLoadProgress(
            p.phase === "unzip"
              ? t("upload.extracting")
              : `${t("upload.parsingProgress")} ${p.percent}%`
          );
          setLoadPercent(p.percent);
        });
        if (result.error) {
          setUploadError(result.error);
          // 解析失败也要把上一个模型的贴图 URL 回收掉(否则 blob 一直占着)
          revokeModelTextureUrls(model);
          setModel(null);
          setLoadStatus("error");
          setLoadProgress("");
          setLoadPercent(0);
        } else if (result.model) {
          revokeModelTextureUrls(model);
          setModel(result.model);
          setLoadStatus("loading-3d");
          setLoadProgress(t("upload.rendering"));
          setLoadPercent(95);

          /**
           * 单位判定 —— 文件坐标不是毫米(AI 生成 / Blender 默认导出)就自动归一化
           *
           * 归一化走的是「自选尺寸」那条**已有的**路:缩放因子一填,几何、支撑
           * 几何、3D 预览一起进毫米空间重算(托底 5mm 也就落在正确的位置)。
           *
           * 不这么做的话,平台会被拉到模型下面 5 个**单位**(托底是固定毫米值),
           * 支撑比模型本身还高 3.5 倍,支撑比例算出来是几万倍 —— 报价全错。
           * 详见 `model-units.ts` 的文件头。
           */
          const check = detectModelUnitScale(
            result.model.parseResult.boundingBox.size
          );
          setUnitCheck(check.normalized ? check : null);
          if (check.normalized) {
            setDimMode("custom");
            setUniformScale(true);
            setScaleFactor(check.scale);
          }
        }
      } catch (err) {
        setUploadError(
          `${t("upload.failed")}${err instanceof Error ? err.message : String(err)}`
        );
        setLoadStatus("error");
        setLoadProgress("");
        setLoadPercent(0);
      }
    },
    [model, t]
  );

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    void loadFile(file);
    // 同一个文件再选一次也要能重新触发 change
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  /**
   * 拖文件进上传卡 —— **用共享的那一套**
   *
   * 以前这里是 `onDragOver` → true / `onDragLeave` → false:指针从卡上移到
   * 里面的图标上时 `dragleave` 会冒上来,边框颜色跟着闪一下。
   * 计数版的口径见 `features/shared/hooks/use-drop-zone.ts`。
   */
  const handleDroppedFiles = useCallback(
    (files: File[]) => {
      const file = files[0];
      if (file) void loadFile(file);
    },
    [loadFile]
  );
  const { isDragOver, dropHandlers } =
    useDropZone<HTMLDivElement>(handleDroppedFiles);

  /**
   * 「在检查工具里看详情」—— **切到「检查」视角**,不跳页
   *
   * 2026-11-07:模型检查工具并进了这个页面(两个工具页合成一个工作台),
   * 所以这里不用再跳 —— 直接把视角切过去,模型是**同一个**,不用再拖一次、
   * 也不用再解压一次。
   */
  const openModelCheck = useCallback(() => {
    setWorkspaceTab("check");
  }, []);

  /**
   * 切换工作台视角
   *
   * 三个视角**共用一个展示区域**(同一个 `ModelViewport`,永远挂在左栏),
   * 切视角只换喂进去的数据 —— 视口不卸载,相机不动。
   *
   * 「检查」那一栏的视口数据由分析器回话才有 —— 切过去时预览的「就绪」
   * 状态要照旧置上,否则「导出模型」那几颗按钮会一直灰着。
   */
  const handleTabChange = useCallback(
    (next: WorkspaceTab) => {
      setWorkspaceTab(next);
      if (next === "check" && loadStatus === "loading-3d") {
        setLoadStatus("ready");
        setLoadPercent(100);
      }
    },
    [loadStatus]
  );

  const clearModel = () => {
    revokeModelTextureUrls(model);
    setModel(null);
    setUploadError(null);
    setFileName(null);
    setLoadStatus("idle");
    setLoadProgress("");
    setLoadPercent(0);
    setDimMode("original");
    setScaleFactor(1);
    setUniformScale(true);
    setScaleX(1);
    setScaleY(1);
    setScaleZ(1);
    setUnitCheck(null);
    setOptimalAngle(null);
    setPoseSupport(null);
    // 换模型 → 自检结论作废(新模型还没焊)
    setMeshSummary(null);
    // 换模型 → 回到「克重」视角(检查面板要重新分析新模型)
    setWorkspaceTab("weight");
  };

  /**
   * 「改回原始尺寸」—— 用户坚持把文件里的数字当毫米
   *
   * 工具替人换算过尺寸,得给人一个反悔的机会(万一这个文件本来就是毫米,
   * 只是特别小)。点了就回到「原始尺寸」,横幅也撤掉。
   */
  const revertToOriginalUnits = () => {
    setUnitCheck(null);
    setDimMode("original");
    setUniformScale(true);
    setScaleFactor(1);
    setScaleX(1);
    setScaleY(1);
    setScaleZ(1);
  };

  const applyProduct = (id: string) => {
    const p = PRODUCT_TYPES.find((x) => x.id === id);
    if (!p) return;
    setProductId(p.id);
    setSolidRatio(p.solidRatio);
    setCoverage(p.coverage);
  };

  // ---- 智能摆盘 ----
  /**
   * 智能摆盘 —— 搜索支撑克重最小的姿态
   *
   * 搜索跑在 Worker 里(625 个候选姿态 × 支撑体积),主线程只发一条指令 ——
   * 摆盘那几秒页面照样能点能拖,不会卡死。
   */
  const optimizeAngle = async (_pendingScales: [number, number, number]) => {
    const client = angleClientRef.current;
    if (!model || !client) return;
    setAngleOptimizing(true);
    setAngleProgress(0);
    await yieldToUI();
    try {
      // 摆盘要跑好几秒,期间用户可能又改了尺寸 —— 用**完成时**的尺寸算,
      // 免得摆出来的支撑克重跟页面上显示的尺寸对不上
      const [sx, sy, sz] = scalesRef.current;
      const modelVolumeCM3 = model.parseResult.volumeCM3 * sx * sy * sz;
      const modelWeightG = modelVolumeCM3 * materialDensity;
      const result = await client.search(
        "main",
        {
          scales: [sx, sy, sz],
          maxHeightMM: 50,
          modelWeightG,
          params: supportParams,
        },
        (p) => setAngleProgress(p)
      );
      setOptimalAngle(result);
      setViewerRotX(result.rotX);
      setViewerRotY(result.rotY);
      setViewerRotZ(0);
      setManualRotX(result.rotX);
      setManualRotY(result.rotY);
      setManualRotZ(0);
    } catch (err) {
      console.error("Angle optimization failed:", err);
    } finally {
      setAngleOptimizing(false);
    }
  };

  const resetAngle = () => {
    setOptimalAngle(null);
    setViewerRotX(0);
    setViewerRotY(0);
    setViewerRotZ(0);
    setManualRotX(0);
    setManualRotY(0);
    setManualRotZ(0);
  };

  /**
   * 手动调整角度 —— 支撑克重由下面的 effect 重算(角度变了 → 重算)
   */
  const handleManualAngleChange = (
    axis: "X" | "Y" | "Z",
    value: number,
    _scales: [number, number, number]
  ) => {
    if (!model) return;
    if (axis === "X") {
      setManualRotX(value);
      setViewerRotX(value);
    } else if (axis === "Y") {
      setManualRotY(value);
      setViewerRotY(value);
    } else {
      setManualRotZ(value);
      setViewerRotZ(value);
    }
  };

  // ---- 导出 ----
  const exportRotatedModel = (scales: [number, number, number]) => {
    if (!model) return;
    const [sx, sy, sz] = scales;
    const useRotX = viewerRotX;
    const useRotY = viewerRotY;
    const useRotZ = viewerRotZ;
    const isUniform = sx === sy && sy === sz;
    const hasRotation = useRotX !== 0 || useRotY !== 0 || useRotZ !== 0;
    const hasMtlOrTextures =
      !!model.mtlText || (model.textureBlobs && model.textureBlobs.length > 0);

    const objText = exportRotatedObj(
      model.objText,
      { rotX: useRotX, rotY: useRotY, rotZ: useRotZ },
      {
        scaleX: sx,
        scaleY: sy,
        scaleZ: sz,
        comment: `WJP${hasRotation ? " laid-out" : ""} export · ${model.name} · X=${useRotX}° Y=${useRotY}° Z=${useRotZ}° · ${isUniform ? `scale=${sx.toFixed(3)}` : `scaleX=${sx.toFixed(3)} Y=${sy.toFixed(3)} Z=${sz.toFixed(3)}`}`,
      }
    );
    const scaleSuffix = isUniform
      ? Math.abs(sx - 1) > 0.001
        ? `_s${sx.toFixed(3)}`
        : ""
      : `_sX${sx.toFixed(2)}_Y${sy.toFixed(2)}_Z${sz.toFixed(2)}`;
    const zSuffix = useRotZ !== 0 ? `_Z${useRotZ}` : "";
    const rotSuffix = hasRotation
      ? `_rotated_X${useRotX}_Y${useRotY}${zSuffix}`
      : "";
    const baseName = `${model.name}${rotSuffix}${scaleSuffix}`;

    if (hasMtlOrTextures) {
      downloadModelZip(
        objText,
        model.mtlText,
        model.textureBlobs,
        model.objFileName,
        model.mtlFileName,
        baseName
      );
    } else {
      downloadObjFile(objText, baseName);
    }
  };

  // ---- 批量 ----
  const handleBatchFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const arr = Array.from(files);
    setBatchItems((prev) => [...prev, ...initBatch(arr)]);
    if (batchFileInputRef.current) batchFileInputRef.current.value = "";
  };

  const runBatch = async () => {
    const pending = batchItems.filter(
      (i) => i.status === "pending" || i.status === "error"
    );
    if (pending.length === 0) return;
    setBatchItems((prev) =>
      prev.map((i) =>
        i.status === "error"
          ? {
              ...i,
              status: "pending",
              progress: 0,
              error: undefined,
              message: undefined,
              result: undefined,
            }
          : i
      )
    );

    const controller = new AbortController();
    batchAbortRef.current = controller;
    setBatchRunning(true);

    const options: BatchOptions = {
      concurrency: batchConcurrency,
      pricingConfig,
      // 几何参数跟随后台 —— 批量跟单件同一口径
      supportLiftMm: clientConfig?.supportLiftMm,
      supportBaseMarginMm: clientConfig?.supportBaseMarginMm,
      solidRatio,
      repairEnabled,
      repairPrice,
      optimizeAngle: batchApplyAngle,
      onItemUpdate: (id, patch) => {
        setBatchItems((prev) =>
          prev.map((it) => (it.id === id ? { ...it, ...patch } : it))
        );
      },
      signal: controller.signal,
    };

    const snapshot = batchItems.filter(
      (i) => i.status === "pending" || i.status === "error"
    );
    await processBatch(snapshot, options);
    setBatchRunning(false);
    batchAbortRef.current = null;
  };

  const cancelBatch = () => {
    batchAbortRef.current?.abort();
    setBatchRunning(false);
  };

  const clearBatch = () => {
    if (batchRunning) cancelBatch();
    setBatchItems([]);
  };

  const removeBatchItem = (id: string) => {
    setBatchItems((prev) => prev.filter((it) => it.id !== id));
  };

  const exportBatchItem = (item: BatchItem) => {
    if (!item.result) return;
    const angle = item.result.optimalAngle;
    if (!angle) return;
    const objText = exportRotatedObj(
      item.result.objText,
      { rotX: angle.rotX, rotY: angle.rotY },
      {
        comment: `WJP batch export · ${item.name} · X=${angle.rotX}° Y=${angle.rotY}°`,
      }
    );
    downloadObjFile(
      objText,
      `${item.name}_rotated_X${angle.rotX}_Y${angle.rotY}.obj`
    );
  };

  const reset = () => {
    clearModel();
    setLength(68.3);
    setWidth(80);
    setHeight(43.6);
    setSolidRatio(30);
    setCoverage(50);
    setRepairMode("none");
    setRepairPrice(0);
    setProductId("pet");
    setShowTexture(true);
    setMode("upload");
    setDimMode("original");
    setScaleFactor(1);
    setUniformScale(true);
    setScaleX(1);
    setScaleY(1);
    setScaleZ(1);
    setInfoDialog(null);
    setBatchItems([]);
  };

  // 组件卸载时回收 blob URL(缩略图 + 各材质贴图)
  // 依赖 [model] —— 换模型时旧模型的 URL 也会被这一轮的 cleanup 回收掉
  useEffect(() => {
    return () => {
      revokeModelTextureUrls(model);
    };
  }, [model]);

  const titleBlock = (
    <div className="flex items-center gap-3">
      <div className="size-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-sm">
        <Scale className="size-5 text-white" />
      </div>
      <div>
        <h1 className="text-base sm:text-lg font-semibold tracking-tight">
          {t("header.title")}
        </h1>
        <p className="text-xs text-stone-500">{t("header.subtitle")}</p>
      </div>
    </div>
  );

  const toolbar = (
    <div className="flex items-center gap-1.5">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setInfoDialog("algorithm")}
            className="size-8 text-stone-500 hover:text-amber-600"
            title={t("info.algorithm.title")}
          >
            <Calculator className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("info.algorithm.title")}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setInfoDialog("products")}
            className="size-8 text-stone-500 hover:text-amber-600"
            title={t("info.products.title")}
          >
            <Box className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("info.products.title")}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setInfoDialog("materials")}
            className="size-8 text-stone-500 hover:text-amber-600"
            title={t("info.materials.title")}
          >
            <Beaker className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("info.materials.title")}</TooltipContent>
      </Tooltip>
      <Button
        variant="ghost"
        size="sm"
        onClick={reset}
        className="text-stone-600 hover:text-stone-900"
      >
        <RotateCcw className="size-4" />
        <span className="hidden sm:inline">{t("common.reset")}</span>
      </Button>
    </div>
  );

  /**
   * 卡片头部 —— 文件身份（缩略图 / 名称 / 几何标签）+ 操作按钮。
   *
   * 这是整页唯一的「模型身份」出口：体积 / 表面积 / 顶点 / 三角面 四个数
   * 以**标签**形式各出现一次，别的面板不再重复。
   */
  const modelHeader = (
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-start gap-3 flex-1 min-w-0">
        {model && <ObjThumbnail objText={model.objText} size={80} />}
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-stone-800 flex items-center gap-2">
            <Box className="size-4 text-amber-600 shrink-0" />
            <span className="truncate">{model?.name ?? fileName ?? ""}</span>
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
            {geometry && (
              <Badge variant="outline" className="font-mono">
                {fmt(geometry.dims[0], 1)} × {fmt(geometry.dims[1], 1)} ×{" "}
                {fmt(geometry.dims[2], 1)} mm
              </Badge>
            )}
            {geometry && (
              <Badge variant="outline" className="font-mono">
                {t("stats.realVolume")} {fmt(geometry.volumeCM3, 2)} cm³
              </Badge>
            )}
            {geometry && (
              <Badge variant="outline" className="font-mono">
                {t("stats.surfaceArea")} {fmt(geometry.surfaceAreaCM2, 2)} cm²
              </Badge>
            )}
            {model && (
              <Badge variant="outline" className="font-mono">
                {t("stats.vertexCount")}{" "}
                {model.parseResult.vertexCount.toLocaleString()}
              </Badge>
            )}
            {model && (
              <Badge variant="outline" className="font-mono">
                {t("stats.triangleCount")}{" "}
                {model.parseResult.triangleCount.toLocaleString()}
              </Badge>
            )}
            {dimMode === "custom" && (
              <Badge
                variant="outline"
                className="font-mono border-amber-300 text-amber-700 bg-amber-50"
              >
                {t("upload.scaledBy", { k: fmt(scaleFactor, 3) })}
              </Badge>
            )}
            {/* 打印前检查 —— 焊接时顺手算出来的,跟检查工具同一套判定 */}
            <MeshCheckBadge summary={meshSummary} />
          </div>
          {/* 有问题才渲染 —— 摆结论 + 一个「去检查工具看详情」入口 */}
          <MeshCheckIssues summary={meshSummary} onInspect={openModelCheck} />
          {/* 贴图没解析出来时,把断点摆出来(全正常时不渲染) */}
          <TextureDiagnosticNote diagnostics={model?.textureDiagnostics} />
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {loadStatus === "ready" && optimalAngle && (
          <Button
            variant="outline"
            size="sm"
            onClick={resetAngle}
            className="text-violet-600 hover:text-violet-700 border-violet-300 hover:bg-violet-50"
          >
            <RotateCcw className="size-3.5" />
            {t("angle.resetAngle")}
          </Button>
        )}
        {loadStatus === "ready" && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportRotatedModel(appliedScales)}
            className="text-emerald-700 hover:text-emerald-800 border-emerald-300 hover:bg-emerald-50"
            title={
              optimalAngle
                ? t("dialog.exportRotatedTitle")
                : t("dialog.exportPlainTitle")
            }
          >
            <Download className="size-3.5" />
            {optimalAngle ? t("dialog.exportRotated") : t("dialog.exportModel")}
          </Button>
        )}
        {model && (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              className="text-stone-500 hover:text-stone-700"
            >
              <UploadCloud className="size-3.5" />
              <span className="hidden sm:inline">{t("upload.reupload")}</span>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={clearModel}
              className="text-stone-400 hover:text-red-600 hover:bg-red-50"
              title={t("upload.removeModel")}
            >
              <X className="size-4" />
            </Button>
          </>
        )}
      </div>
    </div>
  );

  /**
   * 摆盘结果里的对比:初始角度 (0°,0°) vs 当前姿态
   *
   * `originalWeight` 是**初始角度 (0°,0°)** 的支撑克重(只跟尺寸 / 材料
   * 密度有关,跟当前角度无关),`totalSupportWeight` 是当前姿态的。
   * 省得不多(<1%)就不显示「省 X%」徽标 —— 省 0% 没意义;但两个克重
   * 数字一直摆出来(见下面的对比行)。
   */
  const poseCompare = optimalAngle
    ? comparePoseSupport(
        optimalAngle.originalWeight,
        optimalAngle.totalSupportWeight
      )
    : null;
  const savingPct = poseCompare?.savingPct ?? 0;

  /**
   * 当前姿态 —— 支撑克重标的是**这个姿态**的数
   *
   * 只看姿态本身是不是 (0°,0°,0°),不看跑没跑过智能摆盘:手动拖了角度
   * 之后摆盘结果还是空的,但姿态已经不是初始角度了,标错的话用户会以为
   * 支撑克重跟角度没关系。
   */
  const poseLabel = describePose(manualRotX, manualRotY, manualRotZ);

  /**
   * 克重栏的三个数 —— 必须能对上
   *
   * 各自向上取整(0.4 g 也显示 1 g,别显示 0 g),总克重用**两个显示值相加**,
   * 而不是 `ceil(耗材 + 支撑)` —— 后者会出现「43 + 53 = 96,总克重却写 95」
   * 这种对不上的情况,用户一算就觉得错。
   */
  const weights = weightPanelNumbers(
    calc?.materialWeight ?? 0,
    poseSupport?.supportWeightG ?? 0
  );
  const materialWeightG = weights.material;
  const supportWeightG = weights.support;

  /**
   * 右栏「克重」视角 —— 三个数(耗材 / 支撑 / 总)。
   *
   * 克重是这一页的主角:耗材克重大字号,支撑克重次一级。
   * 其余数字(体积 / 表面积 / 顶点 / 三角面)都在头部以标签出现,这里不重复。
   *
   * 2026-11-01:从右栏顶部挪到底部。克重是尺寸调的**结论**,尺寸是**输入** ——
   * 放在上面时,读者先看到两个大数字,再往下找才能改尺寸,真正要操作的
   * 输入被压在视线之外。现在顺序是「调尺寸 → 看克重」。
   *
   * 2026-11-07:摆盘结果挪到「摆盘」视角(`posePanel`)—— 两个问题分两栏看。
   */
  const weightReadout = calc ? (
    <>
      {/*
        三个数排成**一格一格**的(格子之间有分隔线),不是三个 flex 块
        挤在一起 —— 挤在一起时,支撑克重底下多一行「初始角度 0°,0°」,
        三个数字的**基线就错开了**(耗材 15 g 沉底、支撑 21 g 浮在上面、
        总克重 36 g 又落到中间),看着像没对齐。

        所以:标签一行、数一行(固定高度 + 底对齐)、注解一行(固定高度),
        三格结构完全一样 → 数字必然对齐。注解行留空也是占位,
        高度不变,三个数字不会因为谁多一行注解而错位。
      */}
      <div className="rounded-lg border border-stone-200 bg-stone-50/60 overflow-hidden">
        <div className="grid grid-cols-3 divide-x divide-stone-200">
          <div className="px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-[11px] text-stone-500">
              <Scale className="size-3.5 shrink-0" />
              <span className="truncate">{t("stats.materialWeight")}</span>
            </div>
            <div className="mt-1 flex h-9 items-end">
              <span className="font-mono text-3xl font-semibold leading-none tracking-tight text-amber-700">
                {materialWeightG} g
              </span>
            </div>
            {/* 体积 × 材料密度 —— 把这个数是怎么来的摆出来 */}
            <div className="mt-1 h-4 truncate font-mono text-[10px] text-stone-400">
              {fmt(calc.volumeCM3, 2)} cm³ × {fmt(materialDensity, 2)}
            </div>
          </div>

          <div className="px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-[11px] text-stone-500">
              <Compass className="size-3.5 shrink-0" />
              <span className="truncate">{t("stats.supportWeight")}</span>
            </div>
            <div className="mt-1 flex h-9 items-end">
              <span className="font-mono text-2xl font-semibold leading-none tracking-tight text-stone-700">
                {poseSupport ? `${supportWeightG} g` : "—"}
              </span>
            </div>
            {/*
              这个数对应的是**哪个姿态** —— 初始角度 (0°,0°) 还是当前姿态。
              不标出来的话,用户会以为支撑克重跟角度没关系(其实改角度就改
              这个数)。跑没跑过摆盘不算数,只看姿态本身。
            */}
            <div className="mt-1 h-4 truncate text-[10px] text-stone-400">
              {poseSupport
                ? poseLabel.isInitial
                  ? t("stats.poseInitial")
                  : t("stats.poseCurrent", {
                      x: poseLabel.x,
                      y: poseLabel.y,
                      z: poseLabel.z,
                    })
                : null}
            </div>
          </div>

          {/* 总克重 = 耗材克重 + 支撑克重 —— 打印出来还没洗支撑时，整块的重量 */}
          <div className="bg-stone-100/70 px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-[11px] text-stone-500">
              <Package className="size-3.5 shrink-0" />
              <span className="truncate">{t("stats.totalWeight")}</span>
            </div>
            <div className="mt-1 flex h-9 items-end">
              <span className="font-mono text-2xl font-semibold leading-none tracking-tight text-stone-900">
                {poseSupport ? `${weights.total} g` : "—"}
              </span>
            </div>
            <div className="mt-1 h-4 truncate text-[10px] text-stone-400">
              {poseSupport ? t("stats.totalWeightNote") : null}
            </div>
          </div>
        </div>
      </div>

      {supportError && (
        <p className="mt-1 text-[11px] text-red-500">
          {t("stats.supportWeightError", { reason: supportError })}
        </p>
      )}
    </>
  ) : null;

  /**
   * 右栏「摆盘」视角 —— 智能摆盘结果
   *
   * 跑过摆盘才摆得出「最佳姿态 / 省了多少料」;没跑过就摆**当前姿态**
   * (初始角度 0°,0°)的样子 + 一句提示 —— 这一栏空着的话,用户会以为
   * 「摆盘」视角坏了。
   */
  const posePanel = (
    <>
      {optimalAngle ? (
        <div className="rounded-lg border border-violet-200 bg-violet-50/50 p-2.5">
          <div className="flex items-center gap-2 flex-wrap">
            <Compass className="size-3.5 text-violet-600" />
            <span className="text-xs text-stone-600">
              {t("angle.best", {
                x: viewerRotX,
                y: viewerRotY,
                z: viewerRotZ,
              })}
            </span>
            <Badge
              variant="outline"
              className="text-[10px] font-mono border-violet-300 text-violet-700 bg-violet-50"
            >
              {t("angle.selfSupport", {
                ratio: fmt(optimalAngle.selfSupportRatio * 100, 0),
              })}
            </Badge>
            <Badge
              variant="outline"
              className="text-[10px] font-mono border-stone-300 text-stone-600"
            >
              {t("angle.supportWeight", {
                weight: Math.ceil(optimalAngle.totalSupportWeight),
              })}
            </Badge>
            <Badge
              variant="outline"
              className="text-[10px] font-mono border-stone-300 text-stone-600"
            >
              {t("angle.height", {
                h: fmt(optimalAngle.rotatedHeight, 0),
              })}
            </Badge>
            {optimalAngle.laidFlat && (
              <Badge className="text-[10px] bg-amber-100 text-amber-700 hover:bg-amber-100">
                {t("angle.laidFlat")}
              </Badge>
            )}
            {savingPct >= 1 && (
              <Badge
                variant="outline"
                className="text-[10px] font-mono border-emerald-300 text-emerald-700 bg-emerald-50"
                title={t("angle.savingTitle", {
                  before: Math.ceil(optimalAngle.originalWeight ?? 0),
                  after: Math.ceil(optimalAngle.totalSupportWeight),
                  pct: savingPct,
                })}
              >
                {t("angle.savingBadge", { pct: savingPct })}
              </Badge>
            )}
          </div>

          {/*
            初始角度 vs 当前姿态 —— 把两个克重直接摆出来。
            「省 X%」徽标只在省得明显(≥1%)时出现,这里始终给数字:
            省得不多的时候,用户还是要知道原本要多少支撑。
          */}
          {poseCompare && poseCompare.initialWeightG !== null && (
            <div className="mt-1 text-[10px] text-stone-500">
              {t("angle.compareSupport", {
                initial: Math.ceil(poseCompare.initialWeightG),
                current: Math.ceil(poseCompare.currentWeightG),
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-stone-200 bg-stone-50/60 p-2.5">
          <div className="flex items-center gap-2 text-xs text-stone-600">
            <Compass className="size-3.5 text-violet-600" />
            {t("angle.currentPose", {
              x: poseLabel.x,
              y: poseLabel.y,
              z: poseLabel.z,
            })}
          </div>
          {poseSupport && (
            <p className="mt-1 font-mono text-[11px] text-stone-500">
              {t("angle.currentSupport", {
                weight: Math.ceil(poseSupport.supportWeightG),
                ratio: fmt(supportStats.ratio * 100, 0),
              })}
            </p>
          )}
          <p className="mt-1 text-[11px] text-stone-500">
            {t("angle.noResultHint")}
          </p>
        </div>
      )}
    </>
  );

  return (
    <TooltipProvider delayDuration={200}>
      <div className="text-stone-900">
        {/* ---------- 顶部工具条 ---------- */}
        {showChrome && (
          <header className="border-b border-stone-200/80 bg-white/70 backdrop-blur sticky top-0 z-10">
            <div className="max-w-[1280px] mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-4">
              {titleBlock}
              {toolbar}
            </div>
          </header>
        )}

        <main className="flex-1 max-w-[1280px] w-full mx-auto px-4 sm:px-6 py-6 sm:py-10">
          {/* ---------- 介绍 ---------- */}
          <section className="mb-6">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
              {t("intro.title")}
            </h2>
            <p className="mt-2 text-sm text-stone-600 max-w-3xl leading-relaxed">
              {t.rich("intro.body", {
                strong: (chunks) => (
                  <strong className="text-stone-800">{chunks}</strong>
                ),
              })}
            </p>
          </section>

          {/* ---------- 模式切换 ---------- */}
          <section className="mb-6">
            <div className="inline-flex rounded-lg border border-stone-200 bg-white p-1 shadow-sm">
              <button
                type="button"
                onClick={() => setMode("upload")}
                className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${mode === "upload" ? "bg-amber-500 text-white shadow-sm" : "text-stone-600 hover:text-stone-900 hover:bg-stone-50"}`}
              >
                <UploadCloud className="size-4" />
                {t("modes.upload")}
              </button>
              <button
                type="button"
                onClick={() => setMode("manual")}
                className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${mode === "manual" ? "bg-amber-500 text-white shadow-sm" : "text-stone-600 hover:text-stone-900 hover:bg-stone-50"}`}
              >
                <Pencil className="size-4" />
                {t("modes.manual")}
              </button>
              <button
                type="button"
                onClick={() => setMode("batch")}
                className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${mode === "batch" ? "bg-amber-500 text-white shadow-sm" : "text-stone-600 hover:text-stone-900 hover:bg-stone-50"}`}
              >
                <ListChecks className="size-4" />
                {t("modes.batch")}
              </button>
            </div>
          </section>

          {/* ---------- 上传模式 ---------- */}
          {mode === "upload" && (
            <section className="mb-6">
              {!model && loadStatus === "idle" ? (
                <Card
                  className={`border-2 border-dashed transition-colors cursor-pointer bg-stone-50/40 ${isDragOver ? "border-amber-500 bg-amber-50/60 ring-2 ring-amber-200" : "border-stone-300 hover:border-amber-400"}`}
                  onClick={() => fileInputRef.current?.click()}
                  {...dropHandlers}
                >
                  <CardContent className="p-10 flex flex-col items-center text-center">
                    <div
                      className={`size-16 rounded-full flex items-center justify-center mb-4 transition-colors ${isDragOver ? "bg-amber-200" : "bg-amber-100"}`}
                    >
                      <UploadCloud
                        className={`size-8 ${isDragOver ? "text-amber-700" : "text-amber-600"}`}
                      />
                    </div>
                    <h3 className="text-base font-semibold text-stone-800 mb-1">
                      {isDragOver ? t("upload.dropNow") : t("upload.dropTitle")}
                    </h3>
                    <p className="text-sm text-stone-500 max-w-md">
                      {isDragOver ? t("upload.dropSoon") : t("upload.dropHint")}
                    </p>
                    {uploadError && (
                      <div className="mt-3 flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 px-3 py-2 rounded-md">
                        <AlertCircle className="size-4 shrink-0" />
                        <span>{uploadError}</span>
                      </div>
                    )}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".zip,.rar,.7z,.obj,.stl,.ply,.glb,.gltf"
                      onChange={handleFileChange}
                      className="hidden"
                    />
                    {!isDragOver && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="mt-4 border-amber-300 text-amber-700 hover:bg-amber-50"
                        onClick={(e) => {
                          e.stopPropagation();
                          fileInputRef.current?.click();
                        }}
                      >
                        <FileArchive className="size-4" />
                        {t("upload.pickFile")}
                      </Button>
                    )}
                  </CardContent>
                </Card>
              ) : (
                <>
                  <ModelSettingsPanel
                    model={model}
                    loadStatus={loadStatus}
                    loadProgress={loadProgress}
                    loadPercent={loadPercent}
                    uploadError={uploadError}
                    header={modelHeader}
                    weight={weightReadout}
                    pose={posePanel}
                    tab={workspaceTab}
                    onTabChange={handleTabChange}
                    quote={quoteSlot}
                    dimMode={dimMode}
                    uniformScale={uniformScale}
                    scaleFactor={scaleFactor}
                    scaleX={scaleX}
                    scaleY={scaleY}
                    scaleZ={scaleZ}
                    onDimModeChange={setDimMode}
                    onUniformScaleChange={setUniformScale}
                    onScaleFactorChange={setScaleFactor}
                    onScaleXChange={setScaleX}
                    onScaleYChange={setScaleY}
                    onScaleZChange={setScaleZ}
                    unitCheck={unitCheck}
                    onRevertUnitScale={revertToOriginalUnits}
                    geometry={geometry}
                    poseSupport={poseSupport}
                    supportRatio={supportStats.ratio}
                    viewerRotX={viewerRotX}
                    viewerRotY={viewerRotY}
                    viewerRotZ={viewerRotZ}
                    manualRotX={manualRotX}
                    manualRotY={manualRotY}
                    manualRotZ={manualRotZ}
                    onManualAngleChange={handleManualAngleChange}
                    onResetAngle={resetAngle}
                    onOptimizeAngle={optimizeAngle}
                    angleOptimizing={angleOptimizing}
                    angleProgress={angleProgress}
                    angleReady={supportModelReady}
                    showSupport={showSupport}
                    onToggleSupport={() => setShowSupport((s) => !s)}
                    supportLiftMm={clientConfig?.supportLiftMm}
                    supportBaseMarginMm={clientConfig?.supportBaseMarginMm}
                    showTexture={showTexture}
                    onToggleTexture={() => setShowTexture((s) => !s)}
                    onFiles={handleDroppedFiles}
                    onClearModel={clearModel}
                    onViewerReady={() => {
                      setLoadStatus("ready");
                      setLoadPercent(100);
                    }}
                  />
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".zip,.rar,.7z,.obj,.stl,.ply,.glb,.gltf"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                </>
              )}
            </section>
          )}

          {/* ---------- 手动模式 ---------- */}
          {mode === "manual" && (
            <Card className="border-stone-200 shadow-sm">
              <CardContent className="pt-5 space-y-4">
                <div className="space-y-2">
                  <Label className="text-xs font-medium text-stone-600">
                    {t("manual.dimsLabel")}
                  </Label>
                  <div className="grid grid-cols-3 gap-2">
                    <DimInput
                      label={t("axis.lengthFull")}
                      value={length}
                      onChange={setLength}
                    />
                    <DimInput
                      label={t("axis.widthFull")}
                      value={width}
                      onChange={setWidth}
                    />
                    <DimInput
                      label={t("axis.heightFull")}
                      value={height}
                      onChange={setHeight}
                    />
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-medium text-stone-600">
                      {t("manual.solidRatio")}
                    </Label>
                    <span className="text-xs font-mono font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                      {solidRatio}%
                    </span>
                  </div>
                  <Slider
                    value={[solidRatio]}
                    min={1}
                    max={100}
                    step={1}
                    onValueChange={(v) => setSolidRatio(v[0] ?? 30)}
                    className="[&_[data-slot=slider-range]]:bg-amber-500 [&_[data-slot=slider-thumb]]:border-amber-500"
                  />
                  <div className="flex flex-wrap gap-1.5">
                    {SOLID_PRESETS.map((p) => (
                      <button
                        key={p.labelKey}
                        type="button"
                        onClick={() => setSolidRatio(p.ratio)}
                        className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors ${solidRatio === p.ratio ? "bg-amber-500 text-white border-amber-500" : "bg-white text-stone-500 border-stone-200 hover:border-amber-400"}`}
                      >
                        {t(p.labelKey)} {p.ratio}%
                      </button>
                    ))}
                  </div>
                </div>

                {/* 支撑克重 —— 手动模式没有模型，支撑要上传模型后由智能摆盘算出 */}
                <div className="flex items-center justify-between rounded-lg border border-stone-200 bg-stone-50 p-2.5">
                  <div className="flex items-center gap-2">
                    <Compass className="size-3.5 text-stone-400" />
                    <span className="text-sm text-stone-800">
                      {t("stats.supportWeight")}
                    </span>
                    <span className="text-xs text-stone-400">
                      {t("stats.supportNeedsModel")}
                    </span>
                  </div>
                </div>

                {/* 预估克重 —— 手动模式原本只显示总价，去掉价格后改为只给克重 */}
                {calc && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-stone-700">
                        {t("manual.weightTitle")}
                      </span>
                      <span className="text-3xl font-bold tracking-tight text-amber-700 font-mono">
                        {Math.ceil(calc.materialWeight)} g
                      </span>
                    </div>
                    {/* 次要数据 —— 体积 / 表面积 收成一行小字 */}
                    <p className="text-[11px] text-stone-400">
                      {t("stats.realVolume")} {fmt(calc.volumeCM3, 2)} cm³ ·{" "}
                      {t("stats.surfaceArea")} {fmt(calc.surfaceAreaCM2, 2)} cm²
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* ---------- 批量模式 ---------- */}
          {mode === "batch" && (
            <BatchModeSection
              batchItems={batchItems}
              batchRunning={batchRunning}
              batchConcurrency={batchConcurrency}
              batchApplyAngle={batchApplyAngle}
              batchFileInputRef={batchFileInputRef}
              onPickFiles={() => batchFileInputRef.current?.click()}
              onFilesChange={handleBatchFiles}
              onRun={runBatch}
              onCancel={cancelBatch}
              onClear={clearBatch}
              onRemoveItem={removeBatchItem}
              onExportItem={exportBatchItem}
              onConcurrencyChange={setBatchConcurrency}
              onApplyAngleChange={setBatchApplyAngle}
              onDropFiles={(files) => {
                setBatchItems((prev) => [...prev, ...initBatch(files)]);
              }}
              solidRatio={solidRatio}
              materialDensity={materialDensity}
              supportDensity={supportDensity}
            />
          )}
        </main>

        {/* ---------- 说明弹窗 ---------- */}
        <PricingInfoDialogs
          infoDialog={infoDialog}
          onInfoDialogChange={setInfoDialog}
          materialDensity={materialDensity}
          supportDensity={supportDensity}
          supportLiftMm={clientConfig?.supportLiftMm ?? SUPPORT_LIFT_MM}
          supportBaseMarginMm={
            clientConfig?.supportBaseMarginMm ?? SUPPORT_BASE_MARGIN_MM
          }
          onApplyProduct={applyProduct}
        />

        {showChrome && (
          <footer className="border-t border-stone-200 bg-white/60 backdrop-blur mt-auto">
            <div className="max-w-[1280px] mx-auto px-4 sm:px-6 py-5 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-stone-500">
              <span>{t("footer.tagline")}</span>
              <span className="font-mono">{t("footer.version")}</span>
            </div>
          </footer>
        )}
      </div>
    </TooltipProvider>
  );
}
