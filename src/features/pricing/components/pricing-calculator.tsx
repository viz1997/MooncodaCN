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
 * **预估报价不是这里算的**（2026-11-07）：「提交打印订单」那张卡上会摆一个
 * 预估报价 —— 那是**问服务端要的**（`POST /api/print-quote`），访客也能看
 * （后台 `/admin/print-pricing` 一个开关管着）。计算器自己依然不碰价格:
 * 客户端算的价不能信。
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
import type {
  EnsureSupportFn,
  PricingModelPayload,
} from "@/features/pricing/components/pricing-calculator-types";
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
import type {
  OptimalAngle,
  SupportParams,
  SupportPoseResult,
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
  onEnsureSupport,
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
   * 传 null 表示「当前没有模型」。父组件拿它去建打印工单(体积 / 表面积 /
   * 尺寸 / 支撑克重)—— 服务端按这组数重算报价。
   *
   * **这里只抛输入,不抛价格** —— 价格必须服务端算(客户端能改)。
   */
  onQuoteInput?: (input: PrintQuoteInput | null) => void;

  /**
   * 右栏插槽 —— 渲染在右栏克重面板下方。
   *
   * `/tools/workbench` 放的是「提交打印订单」卡片 —— 卡片上摆服务端算出来的
   * **预估报价**（2026-11-07 起，访客也能看，后台一个开关管着），出口还是
   * 把模型加进打印单。
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
   * 「按当前姿态把支撑算出来」的入口 —— 父组件拿它去补支撑克重
   *
   * 支撑**不跟随角度实时重算**(工作室 2026-11-07 的口径):用户把角度摆定
   * 之后点「包裹支撑」才算一次。但「提交打印订单」必须带上支撑克重 ——
   * 服务端按它重算报价,少了它支撑费会算成 0(收少了钱)。用户没点过那颗
   * 按钮时,这里现算一次。
   *
   * 回调收到的是那个函数本身,父组件把它存起来,在提交之前 await 一下。
   */
  onEnsureSupport?: (ensure: EnsureSupportFn) => void;

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
   * 工作台视角 —— 检查 / 克重
   *
   * 两个视角看的是**同一个**模型。默认落在「克重」上 —— 工作室的主路径是
   * 「量克重 → 加进打印单」,检查是可选的一步。
   *
   * 以前还有第三个「摆盘」视角 —— 2026-11-07 **并进克重栏**了(摆盘结果
   * 本来就跟克重是一件事,拆两栏要用户自己把两个数对上)。
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
   * **当前角度**的包裹支撑数据 —— 算出来才有
   *
   * 工作室的口径(2026-11-07):**支撑不跟随角度实时变化**。用户把角度摆定
   * 之后点浮层上那颗「包裹支撑」,这时才算一次 —— 支撑克重 + 总克重 + 画出来
   * 那圈支撑,三者来自**同一次**计算,数字跟画面必然对得上。
   *
   * 所以这个值有两个来源:
   * 1. 用户点「包裹支撑」→ 算一次(带外壳,画面上那圈就是它)
   * 2. 用户点「提交打印订单」而没点过那颗按钮 → 现算一次(**只要数**,不要
   *    外壳)—— 服务端重算报价要那个支撑克重,少了它支撑费会算成 0
   *
   * 角度一变 → 这个值被清空(见下面那个「作废」的 effect)。
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
  /**
   * 焊接(Worker 加载模型)的 promise —— 拿来**等**它
   *
   * 模型刚解析完的时候焊接还在跑(大模型好几秒)。用户要是这时候就点
   * 「提交打印订单」,算支撑得先等焊接完 —— 不然算不出支撑,单子就少了
   * 支撑费(服务端按 `supportWeightG ?? 0` 算)。
   */
  const supportLoadRef = useRef<Promise<unknown> | null>(null);
  /** 支撑算不出来时的原因(页面上一行小字提示,别让用户对着「—」猜) */
  const [supportError, setSupportError] = useState<string | null>(null);
  /**
   * 画不画那圈支撑 —— **默认不画**
   *
   * 这颗开关就是「算不算支撑」的开关:关着就一点支撑都不算(支撑克重、
   * 总克重、画面上那圈支撑全都没有),点了才按**当前角度**算一次。
   *
   * 支撑外壳是这一页最贵的一块几何(外壳 + 顶面 + 外壁 + 底板留边,一次
   * 姿态算下来要好几百毫秒)—— 转一下模型就重算一遍,页面卡、数字还在
   * 一直跳。所以默认关着,用户把角度摆定之后自己点。
   */
  const [showSupport, setShowSupport] = useState(false);
  /**
   * 「置于平面」的触发令牌 —— 逼着支撑**重算一遍**
   *
   * 「置于平面」要做的事是「按当前姿态落座 + 重算支撑」。光把 `showSupport`
   * 打开**不一定**会重算 —— 下面那个算支撑的 effect 只在依赖变了的时候才跑。
   * 这两种情况下依赖没变:
   * - 开关本来就开着(用户没转过模型)→ 已经在算了;
   * - 上一次算失败(Worker 报错)→ 用户想重试,但依赖也没变。
   *
   * 所以另备一个令牌:点一次 +1,effect 的依赖里带着它 —— **一定会重算**。
   */
  const [supportRecalcToken, setSupportRecalcToken] = useState(0);
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
   * 当前姿态 —— 给「现算一次支撑」的入口用
   *
   * 支撑**不跟随角度实时重算**(工作室 2026-11-07 的口径):用户把角度摆定
   * 之后点「包裹支撑」才算一次。所以「算支撑」这个动作发生在**事件回调**
   * 里(点按钮 / 提交),那会儿拿不到最新的 state —— 用这个 ref 兜住。
   *
   * 在渲染期同步(ref 就是「此刻的值」,不是「上一次渲染的值」)。
   */
  const manualRotRef = useRef({ x: 0, y: 0, z: 0 });
  manualRotRef.current = { x: manualRotX, y: manualRotY, z: manualRotZ };
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
  /**
   * 原始姿态(0°,0°)的支撑克重 —— **智能摆盘自己算好带回来**
   *
   * 摆盘的候选姿态里就包含原始姿态,所以「省 X%」那个对比不需要另算一次。
   */

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
      supportLoadRef.current = null;
      return;
    }
    let cancelled = false;
    setSupportModelReady(false);
    // 换模型 → 旧模型的支撑数据作废
    setPoseSupport(null);
    setSupportError(null);
    // 换模型 → 旧模型的自检结论作废(新模型还没焊)
    setMeshSummary(null);
    // 焊接的 promise 存一份 —— 「提交打印订单」那会儿模型可能**还没焊完**,
    // 那时算支撑得先等它(见下面 `ensureSupport`)
    const loading = client.load("main", positions, fileName ?? undefined);
    supportLoadRef.current = loading;
    loading
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
   * 支撑计算 —— **只在用户点「包裹支撑」之后才跑**
   *
   * 工作室的口径(2026-11-07):**支撑不跟随角度实时变化**。用户把角度摆定
   * 之后点浮层上那颗「包裹支撑」,这时才算一次 —— 支撑克重 + 总克重 + 画出来
   * 那圈支撑几何,三者来自**同一次**计算,数字跟画面必然对得上。
   *
   * 转模型(拖旋转控制器)**不触发**这个 effect —— 依赖数组里**没有角度**。
   * 角度变了 → 下面那个「作废」的 effect 把上一次的结果清掉 → 用户按新
   * 角度再点一次「包裹支撑」,重新算。
   *
   * 依赖里有 `showSupport`:那颗按钮就是开关 —— 关着就一点支撑都不算
   * (默认关着,模型刚进来时一个支撑都不算,用户不主动要就不替他算)。
   *
   * 依赖里还有 `supportRecalcToken`:「置于平面」每点一次 +1 —— **逼着这个
   * effect 重算一遍**。光打开 `showSupport` 不够(开关本来就开着、或者
   * 上一次算失败的时候,依赖没变,effect 不会跑)。
   *
   * 算的是**缩放后**的真实几何:缩放只挪顶点(拓扑不变),不用重新焊接。
   * 计算在 Worker 里跑(主线程只发一条指令),页面不会卡。
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: 依赖就是触发条件 —— 「置于平面」点一次令牌 +1 就重算,effect 体里不用读它
  useEffect(() => {
    // 没点「包裹支撑」 → 不算
    if (!showSupport) return;
    const client = angleClientRef.current;
    if (!client || !supportModelReady || !model) return;
    const [sx, sy, sz] = appliedScales;
    let cancelled = false;
    void (async () => {
      try {
        const pose = await client.pose("main", {
          rotX: manualRotRef.current.x,
          rotY: manualRotRef.current.y,
          rotZ: manualRotRef.current.z,
          scales: [sx, sy, sz],
          params: supportParams,
          // 顺带回传**画出来的**那块支撑几何 —— 3D 预览画的那圈支撑
          // 必须跟算克重的是同一块(外壳在算体积的同一次调用里建出来)。
          withShell: true,
        });
        if (cancelled) return;
        setPoseSupport(pose);
        setSupportError(null);
      } catch (err) {
        console.error("支撑计算失败:", err);
        if (!cancelled) {
          setSupportError(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    showSupport,
    appliedScales,
    supportParams,
    model,
    supportModelReady,
    supportRecalcToken,
  ]);

  /**
   * 角度变了 → 上一次算出来的支撑**作废**
   *
   * 支撑是「某个角度下的一次结果」—— 角度一变,那个数就是**旧角度**的数了。
   * 不清掉的话:画面上那圈支撑摆在旧角度上,支撑克重也是旧角度的,用户看着
   * 模型在新角度、数字却在说旧角度 —— 画面跟数字一起骗人。
   *
   * 所以角度一改:数字清空(回到「—」)、那圈支撑撤掉、按钮回到关的状态。
   * 用户按新角度再点一次「包裹支撑」,重新算。
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: 依赖就是触发条件 —— 角度一变就作废,effect 体里不用读这三个数
  useEffect(() => {
    setPoseSupport(null);
    setShowSupport(false);
  }, [manualRotX, manualRotY, manualRotZ]);

  /**
   * 「置于平面」—— 按当前姿态把模型放到打印平台上(工作室 2026-11-07)
   *
   * 一颗按钮把三件事串成**一步**:
   *
   * 1. **支撑按当前姿态重算一次** —— 走的就是上面那个 effect
   *    (`withShell: true`,画出来的那圈支撑跟算克重的是同一块几何);
   * 2. **平台平面按这个姿态重摆** —— 视口拿这块外壳自己的 `groundZ` 摆
   *    平台(姿态对不上才不认,见 `shellMatchesPose`),模型因此坐在托底上,
   *    **不会低过平面**;
   * 3. **支撑克重 / 总克重同时刷新** —— 三样东西来自**同一次**计算。
   *
   * 跟「包裹支撑」那颗的区别:那颗是**开关**(按一下算、再按一下不画),
   * 这颗是**动作**(永远算一次、永远把模型放在平台上)。用户转完模型点这颗
   * 就齐活了,不用先点「包裹支撑」。
   */
  const placeOnPlane = useCallback(() => {
    setShowSupport(true);
    setSupportRecalcToken((t) => t + 1);
  }, []);

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
   * 支撑数据来自 Worker 算出来的当前姿态 —— 用户点「包裹支撑」才有
   * (支撑不跟随角度实时变化,见上面那个 effect)。
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

  /**
   * 当前姿态的支撑结果 —— 给「现算一次」的入口判断用
   *
   * 它在**事件回调**里被调用,拿不到最新的 state,所以用 ref 兜住。
   */
  const poseSupportRef = useRef<SupportPoseResult | null>(null);
  poseSupportRef.current = poseSupport;
  /**
   * 最近一次抛给父组件的输入 —— 已经算过支撑时直接给出去,不用重算
   */
  const quoteInputRef = useRef<PrintQuoteInput | null>(null);

  /**
   * 「按当前姿态把支撑算出来」—— 外面(提交打印订单)要支撑克重时用它
   *
   * ## 为什么要有这个入口
   *
   * 支撑**不跟随角度实时重算**(工作室 2026-11-07 的口径):用户把角度摆定
   * 之后点浮层上那颗「包裹支撑」,才算一次(支撑克重 + 总克重 + 画出来那圈
   * 支撑,三者来自同一次计算)。
   *
   * 但「提交打印订单」**必须带上支撑克重** —— 服务端按这组数重算报价
   * (`quote-server.ts` 的 `input.supportWeightG ?? 0`),少了它支撑费会算成 0,
   * 收少了钱。用户没点过那颗按钮的时候,这里现算一次。
   *
   * ## 两点讲究
   *
   * 1. **算过了就不重算** —— `poseSupport` 有值就说明当前姿态已经算过
   *    (角度一变它就被清空了,见上面那个「作废」的 effect)。
   * 2. **只要数,不要几何** —— 提交要的是支撑克重,那块最贵的外壳不用建。
   */
  const ensureSupport =
    useCallback(async (): Promise<PrintQuoteInput | null> => {
      // 已经算过当前姿态的支撑 → 把现成的给出去,不重算
      if (poseSupportRef.current && quoteInputRef.current) {
        return quoteInputRef.current;
      }
      const client = angleClientRef.current;
      if (!client || !model || !geometry) return null;
      /**
       * 模型还没焊完 → **等它**
       *
       * 用户刚拖进模型就点「提交打印订单」是常事,而焊接大模型要好几秒。
       * 这时候算支撑得先等焊接完 —— 不然算不出来,提交那一条就带着
       * `supportWeightG` 缺失过去,服务端的 `input.supportWeightG ?? 0` 会把
       * 支撑费算成 0(收少了钱)。
       */
      if (!supportModelReady) {
        const loading = supportLoadRef.current;
        if (!loading) return null;
        try {
          await loading;
        } catch (err) {
          console.error("模型焊接失败:", err);
          setSupportError(err instanceof Error ? err.message : String(err));
          return null;
        }
      }
      const [sx, sy, sz] = appliedScales;
      const modelWeightG =
        model.parseResult.volumeCM3 * sx * sy * sz * materialDensity;
      try {
        const pose = await client.pose("main", {
          rotX: manualRotRef.current.x,
          rotY: manualRotRef.current.y,
          rotZ: manualRotRef.current.z,
          scales: [sx, sy, sz],
          params: supportParams,
          // 只要数,不要那块几何 —— 提交要的是支撑克重
          withShell: false,
        });
        // 算完了 → 页面上的三个克重数也立刻有(支撑是**当前姿态**的)
        setPoseSupport(pose);
        setSupportError(null);
        return {
          volumeCM3: geometry.volumeCM3,
          surfaceAreaCM2: geometry.surfaceAreaCM2,
          dims: geometry.dims,
          supportWeightG: Math.ceil(pose.supportWeightG),
          selfSupportRatio:
            modelWeightG > 0 ? pose.supportWeightG / modelWeightG : 0,
        };
      } catch (err) {
        console.error("支撑计算失败:", err);
        setSupportError(err instanceof Error ? err.message : String(err));
        return null;
      }
    }, [
      supportModelReady,
      model,
      geometry,
      appliedScales,
      supportParams,
      materialDensity,
    ]);

  /**
   * 把「现算支撑」的入口交给父组件
   *
   * 父组件(提交打印订单那张卡)在提交之前会 await 它 —— 服务端重算报价要那个
   * 支撑克重,少了它支撑费会算成 0。
   */
  useEffect(() => {
    onEnsureSupport?.(ensureSupport);
  }, [ensureSupport, onEnsureSupport]);

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
      quoteInputRef.current = null;
      notify(null);
      return;
    }
    const input: PrintQuoteInput = {
      volumeCM3: geometry.volumeCM3,
      surfaceAreaCM2: geometry.surfaceAreaCM2,
      dims: geometry.dims,
      // 支撑数据是**当前姿态**的 —— 还没点过「包裹支撑」就是 null
      // (加打印单时由 `ensureSupport()` 现算一次补上)
      supportWeightG: poseSupport
        ? Math.ceil(poseSupport.supportWeightG)
        : null,
      selfSupportRatio: poseSupport ? supportStats.ratio : null,
    };
    // 存一份 —— 「已经算过了就别重算」判断要用
    quoteInputRef.current = input;
    notify(input);
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
   * 两个视角**共用一个展示区域**(同一个 `ModelViewport`,永远挂在左栏),
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

  /**
   * 在 3D 预览里**转模型** —— 改的是打印姿态,不是相机
   *
   * 触发方式是**拖旋转控制器**(三轴彩色圆环,业界主流那套)—— 视口那边
   * 每转一下就回调一次新姿态。
   *
   * ## 姿态**不**触发支撑重算(工作室 2026-11-07 的口径)
   *
   * 转模型的时候**什么都不算** —— 支撑不跟随角度实时变化。画面上那圈支撑
   * 撤掉、支撑克重回到「—」,用户把角度摆定之后点「包裹支撑」再算一次。
   *
   * 所以这里**不需要节流**:以前要节流是因为每个事件都要往 Worker 发一条
   * 指令(`AngleOptimizerClient.pose()` 没有请求合并,发满了页面反而更卡),
   * 现在不发指令了,直接改 state 就完事。
   */
  const handlePoseChange = useCallback(
    (next: { rotX: number; rotY: number; rotZ: number }) => {
      // 画面立刻跟着转(只是姿态组的 rotation,几何不重建)
      setViewerRotX(next.rotX);
      setViewerRotY(next.rotY);
      setViewerRotZ(next.rotZ);
      // 姿态本身**立刻**跟上 —— 用户点「包裹支撑」时拿到的必须是最新角度
      setManualRotX(next.rotX);
      setManualRotY(next.rotY);
      setManualRotZ(next.rotZ);
    },
    []
  );

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
          <h3 className="text-base font-semibold text-zinc-100 flex items-center gap-2">
            <Box className="size-4 text-amber-400 shrink-0" />
            <span className="truncate">{model?.name ?? fileName ?? ""}</span>
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
            {geometry && (
              <Badge
                variant="outline"
                className="font-mono border-zinc-700 bg-zinc-900 text-zinc-300"
              >
                {fmt(geometry.dims[0], 1)} × {fmt(geometry.dims[1], 1)} ×{" "}
                {fmt(geometry.dims[2], 1)} mm
              </Badge>
            )}
            {geometry && (
              <Badge
                variant="outline"
                className="font-mono border-zinc-700 bg-zinc-900 text-zinc-300"
              >
                {t("stats.realVolume")} {fmt(geometry.volumeCM3, 2)} cm³
              </Badge>
            )}
            {geometry && (
              <Badge
                variant="outline"
                className="font-mono border-zinc-700 bg-zinc-900 text-zinc-300"
              >
                {t("stats.surfaceArea")} {fmt(geometry.surfaceAreaCM2, 2)} cm²
              </Badge>
            )}
            {model && (
              <Badge
                variant="outline"
                className="font-mono border-zinc-700 bg-zinc-900 text-zinc-300"
              >
                {t("stats.vertexCount")}{" "}
                {model.parseResult.vertexCount.toLocaleString()}
              </Badge>
            )}
            {model && (
              <Badge
                variant="outline"
                className="font-mono border-zinc-700 bg-zinc-900 text-zinc-300"
              >
                {t("stats.triangleCount")}{" "}
                {model.parseResult.triangleCount.toLocaleString()}
              </Badge>
            )}
            {dimMode === "custom" && (
              <Badge
                variant="outline"
                className="font-mono border-amber-500/40 text-amber-300 bg-amber-500/10"
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
            className="border-zinc-700 bg-zinc-900 text-violet-300 hover:bg-zinc-800 hover:text-violet-200"
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
            className="border-zinc-700 bg-zinc-900 text-emerald-300 hover:bg-zinc-800 hover:text-emerald-200"
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
              className="border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
            >
              <UploadCloud className="size-3.5" />
              <span className="hidden sm:inline">{t("upload.reupload")}</span>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={clearModel}
              className="text-zinc-500 hover:text-red-400 hover:bg-red-500/10"
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
   * 2026-11-07:摆盘结果并进这一栏(`weightColumn`)—— 摆盘跟克重本来就是
   * 一件事,拆成两栏要用户自己把两个数对上。
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
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 overflow-hidden">
        <div className="grid grid-cols-3 divide-x divide-zinc-800">
          <div className="px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-[11px] text-zinc-400">
              <Scale className="size-3.5 shrink-0" />
              <span className="truncate">{t("stats.materialWeight")}</span>
            </div>
            <div className="mt-1 flex h-9 items-end">
              <span className="font-mono text-3xl font-semibold leading-none tracking-tight text-amber-400">
                {materialWeightG} g
              </span>
            </div>
            {/* 体积 × 材料密度 —— 把这个数是怎么来的摆出来 */}
            <div className="mt-1 h-4 truncate font-mono text-[10px] text-zinc-500">
              {fmt(calc.volumeCM3, 2)} cm³ × {fmt(materialDensity, 2)}
            </div>
          </div>

          <div className="px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-[11px] text-zinc-400">
              <Compass className="size-3.5 shrink-0" />
              <span className="truncate">{t("stats.supportWeight")}</span>
            </div>
            <div className="mt-1 flex h-9 items-end">
              <span className="font-mono text-2xl font-semibold leading-none tracking-tight text-zinc-200">
                {poseSupport ? `${supportWeightG} g` : "—"}
              </span>
            </div>
            {/*
              这个数对应的是**哪个姿态** —— 初始角度 (0°,0°) 还是当前姿态。
              不标出来的话,用户会以为支撑克重跟角度没关系(其实改角度就改
              这个数)。跑没跑过摆盘不算数,只看姿态本身。
              没算过的时候写清楚怎么才有 —— 别让用户对着「—」猜。
            */}
            <div className="mt-1 h-4 truncate text-[10px] text-zinc-500">
              {poseSupport
                ? poseLabel.isInitial
                  ? t("stats.poseInitial")
                  : t("stats.poseCurrent", {
                      x: poseLabel.x,
                      y: poseLabel.y,
                      z: poseLabel.z,
                    })
                : t("stats.supportPendingHint")}
            </div>
          </div>

          {/* 总克重 = 耗材克重 + 支撑克重 —— 打印出来还没洗支撑时，整块的重量 */}
          <div className="bg-zinc-950/60 px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-[11px] text-zinc-400">
              <Package className="size-3.5 shrink-0" />
              <span className="truncate">{t("stats.totalWeight")}</span>
            </div>
            <div className="mt-1 flex h-9 items-end">
              <span className="font-mono text-2xl font-semibold leading-none tracking-tight text-zinc-100">
                {poseSupport ? `${weights.total} g` : "—"}
              </span>
            </div>
            <div className="mt-1 h-4 truncate text-[10px] text-zinc-500">
              {poseSupport ? t("stats.totalWeightNote") : null}
            </div>
          </div>
        </div>
      </div>

      {supportError && (
        <p className="mt-1 text-[11px] text-red-400">
          {t("stats.supportWeightError", { reason: supportError })}
        </p>
      )}
    </>
  ) : null;

  /**
   * 摆盘结果 —— 智能摆盘跑出来的「最佳姿态 / 省了多少料」
   *
   * 跑过摆盘才摆得出「最佳姿态 / 省了多少料」;没跑过就摆**当前姿态**
   * (初始角度 0°,0°)的样子 + 一句提示 —— 这一块空着的话,用户会以为
   * 摆盘坏了。
   *
   * 2026-11-07:从独立的一栏**并进克重栏**(见 `weightColumn`)。
   */
  const posePanel = (
    <>
      {optimalAngle ? (
        <div className="rounded-lg border border-violet-500/30 bg-violet-500/10 p-2.5">
          <div className="flex items-center gap-2 flex-wrap">
            <Compass className="size-3.5 text-violet-400" />
            <span className="text-xs text-zinc-300">
              {t("angle.best", {
                x: optimalAngle.rotX,
                y: optimalAngle.rotY,
                z: 0,
              })}
            </span>
            <Badge
              variant="outline"
              className="text-[10px] font-mono border-violet-500/40 text-violet-300 bg-violet-500/10"
            >
              {t("angle.selfSupport", {
                ratio: fmt(optimalAngle.selfSupportRatio * 100, 0),
              })}
            </Badge>
            <Badge
              variant="outline"
              className="text-[10px] font-mono border-zinc-700 bg-zinc-900 text-zinc-300"
            >
              {t("angle.supportWeight", {
                weight: Math.ceil(optimalAngle.totalSupportWeight),
              })}
            </Badge>
            <Badge
              variant="outline"
              className="text-[10px] font-mono border-zinc-700 bg-zinc-900 text-zinc-300"
            >
              {t("angle.height", {
                h: fmt(optimalAngle.rotatedHeight, 0),
              })}
            </Badge>
            {optimalAngle.laidFlat && (
              <Badge className="text-[10px] border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/10">
                {t("angle.laidFlat")}
              </Badge>
            )}
            {savingPct >= 1 && (
              <Badge
                variant="outline"
                className="text-[10px] font-mono border-emerald-500/40 text-emerald-300 bg-emerald-500/10"
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
            <div className="mt-1 text-[10px] text-zinc-400">
              {t("angle.compareSupport", {
                initial: Math.ceil(poseCompare.initialWeightG),
                current: Math.ceil(poseCompare.currentWeightG),
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-2.5">
          <div className="flex items-center gap-2 text-xs text-zinc-300">
            <Compass className="size-3.5 text-violet-400" />
            {t("angle.currentPose", {
              x: poseLabel.x,
              y: poseLabel.y,
              z: poseLabel.z,
            })}
          </div>
          {poseSupport && (
            <p className="mt-1 font-mono text-[11px] text-zinc-400">
              {t("angle.currentSupport", {
                weight: Math.ceil(poseSupport.supportWeightG),
                ratio: fmt(supportStats.ratio * 100, 0),
              })}
            </p>
          )}
          <p className="mt-1 text-[11px] text-zinc-400">
            {t("angle.noResultHint")}
          </p>
        </div>
      )}
    </>
  );

  /**
   * 克重栏的内容 —— **三个克重数 + 摆盘结果**
   *
   * 2026-11-07:摆盘从独立的一栏**并进克重栏**(工作台只剩「检查 / 克重」
   * 两个视角)。摆盘结果(最优姿态 / 自支撑比例 / 省 X%)本来就是克重的一
   * 部分 —— 支撑克重摆到哪个姿态最省,拆成两栏要用户自己把两个数对上。
   *
   * 顺序:三个克重数在上(这一栏的主菜),摆盘结果在下(补充)。
   */
  const weightColumn = (
    <>
      {weightReadout}
      {posePanel}
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

        {/* 容器封顶 1600px(2026-11-09)
            —— 以前是 1280px。右边多了一张「提交打印订单」卡(320px)之后,
            3D 视口只剩 `1280 − 48 − 336 − 400 ≈ 496px` —— 挤得没法看。

            **介绍 / 模式切换那两段仍然是 1280px**(`max-w-[1280px] mx-auto`)
            —— 它们跟页面头部对齐,只有下面那块 3D 工作台用满 1600px。 */}
        <main className="flex-1 max-w-[1600px] w-full mx-auto px-4 sm:px-6 py-6 sm:py-10">
          {/* ---------- 介绍 ---------- */}
          <section className="mb-6 max-w-[1280px] mx-auto">
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
          <section className="mb-6 max-w-[1280px] mx-auto">
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
                /* ---------- 空状态也是深色的 ----------
                   以前那个模型检查工具**从第一屏就是深色的** —— 拖放区在
                   那一块深色面板里面。现在工作台统一用那个设计,空状态
                   也得是深色的:拖完文件之后整块不换脸。 */
                <Card
                  className={`border-2 border-dashed transition-colors cursor-pointer bg-zinc-950 text-zinc-100 ${isDragOver ? "border-amber-500 bg-amber-500/10 ring-2 ring-amber-500/30" : "border-zinc-700 hover:border-amber-500/60"}`}
                  onClick={() => fileInputRef.current?.click()}
                  {...dropHandlers}
                >
                  <CardContent className="p-10 flex flex-col items-center text-center">
                    <div
                      className={`size-16 rounded-full flex items-center justify-center mb-4 transition-colors ${isDragOver ? "bg-amber-500/20" : "bg-zinc-900"}`}
                    >
                      <UploadCloud
                        className={`size-8 ${isDragOver ? "text-amber-400" : "text-zinc-400"}`}
                      />
                    </div>
                    <h3 className="text-base font-semibold text-zinc-100 mb-1">
                      {isDragOver ? t("upload.dropNow") : t("upload.dropTitle")}
                    </h3>
                    <p className="text-sm text-zinc-400 max-w-md">
                      {isDragOver ? t("upload.dropSoon") : t("upload.dropHint")}
                    </p>
                    {uploadError && (
                      <div className="mt-3 flex items-center gap-2 text-sm text-red-300 bg-red-500/15 border border-red-500/40 px-3 py-2 rounded-md">
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
                        className="mt-4 border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800 hover:text-zinc-100"
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
                    weight={weightColumn}
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
                    onPoseChange={handlePoseChange}
                    onResetAngle={resetAngle}
                    onOptimizeAngle={optimizeAngle}
                    angleOptimizing={angleOptimizing}
                    angleProgress={angleProgress}
                    angleReady={supportModelReady}
                    showSupport={showSupport}
                    onToggleSupport={() => setShowSupport((s) => !s)}
                    onPlaceOnPlane={placeOnPlane}
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
