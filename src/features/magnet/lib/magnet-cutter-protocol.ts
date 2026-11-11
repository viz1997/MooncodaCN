/**
 * 磁吸孔切割 Worker 的消息协议
 *
 * 形状照抄 `pricing/lib/angle-optimizer-protocol.ts` —— 那边是仓库里唯一
 * 一份「Worker 收/发消息类型」的样子,跟着它走省得再发明一套。
 *
 * ## 为什么要有 seq
 *
 * Worker 的回包**不保证按请求顺序回来**(主线程连发两条指令,第二条可能先回)。
 * 每条请求带一个自增序号,客户端只认自己那条 —— 过期回包直接丢掉。
 */
import type {
  MagnetFaceId,
  MagnetFaceVerdict,
  MagnetHoleParams,
  MagnetTargetId,
} from "./magnet-params";
import type { MagnetRepairReport } from "./magnet-repair";

/**
 * 模型身上带过来的「贴图信息」
 *
 * 布尔运算**能不能保住 UV 和材质** —— 工作室 2026-11-11 要求「导出模型需要
 * 保留原来的材质贴图」,Manifold3D 确实做得到:UV 走**属性通道**
 * (`numProp = 5` = xyz + uv),材质走 `reserveIDs()` + 逐三角形 run。
 *
 * 这三个字段都跟 `positions` **逐三角形对齐**(同一个三角形序)。
 */
export type MagnetTextureInput = {
  /** 每三角形 6 个 float(u0,v0,u1,v1,u2,v2)—— 没有贴图时是 null */
  uvs?: Float32Array | null;
  /** 每三角形一个材质下标 —— 没有材质时是 null */
  materialIndex?: Uint16Array | null;
  /** 材质名(下标指进这个数组) */
  materialNames?: string[] | null;
};

/** 一个候选面的体检结果 */
export type MagnetFaceReport = {
  faceId: MagnetFaceId;
  /** 这个面**朝外**的方向(单位向量) */
  direction: [number, number, number];
  /** 射线打中没有 */
  hit: boolean;
  /**
   * 平整度(度)—— 面的法线跟射线的夹角
   *
   * 0° = 面跟射线**完全垂直**(最平);180° = 完全平行(最斜)。
   */
  flatnessDeg: number;
  /** 命中点 */
  point: [number, number, number];
  /** 命中面的朝外单位法线 */
  normal: [number, number, number];
  /** 命中点的局部厚度(mm)—— 沿朝内方向量到下一个面 */
  thicknessMm: number | null;
  /** 命中点到面边缘的净空(mm)—— 孔要放得下就得 ≥ 孔半径 */
  clearanceMm: number | null;
  /** 能不能切 */
  verdict: MagnetFaceVerdict;
};

/**
 * 「智能识别」出来的那块平面区域(面积最大的平面)
 *
 * 这是工作室 2026-11-11 问的那个「智能识别背面」的答案 —— **不依赖模型的
 * 朝向**:原脚本只在六个轴向里找,模型一歪就找不着了。
 */
export type MagnetPatchReport = {
  /** 这块平面的面积(mm²) */
  areaMm2: number;
  /** 组成它的面数 */
  faceCount: number;
  /** 面积加权平均法线(朝外,单位向量) */
  normal: [number, number, number];
  /** 面积加权质心(mm)—— 这块区域大概在哪儿 */
  centroid: [number, number, number];
  /**
   * 真正下刀的那个点(mm)—— 在质心附近重新打一条射线落到表面上
   *
   * 质心只是「这块区域的中心」,不一定精确落在面上(浮雕的背面经常是
   * 一圈边框 + 中间凸起)。下刀点要落在**表面上**,所以重新打射线取命中点。
   */
  point: [number, number, number];
  /** 各面法线相对平均法线的平均夹角(度)—— 越小越平 */
  meanDeviationDeg: number;
  /** 命中点的局部厚度(mm) */
  thicknessMm: number | null;
  /** 命中点到面边缘的净空(mm) */
  clearanceMm: number | null;
  /** 能不能切 */
  verdict: MagnetFaceVerdict;
};

/** 切完之后的产物 */
export type MagnetCutOutcome = {
  /** 切完的三角汤(9 floats/tri)—— 拿去画 + 导出 */
  positions: Float32Array;
  /** 切之前的体积(mm³) */
  volumeBefore: number;
  /** 切之后的体积(mm³) */
  volumeAfter: number;
  /** 实际去掉多少(mm³) */
  removedVolume: number;
  /** 理论上去掉多少(mm³)—— 两者对不上就说明孔切到边上去了 */
  expectedRemovedVolume: number;
  /** 切完的三角形数 */
  triangleCount: number;
  /**
   * 切完的 UV(每三角形 6 个 float)—— 跟 `positions` 逐三角形对齐
   *
   * 原模型没有贴图时是 null。
   */
  uvs: Float32Array | null;
  /** 切完的材质下标(每三角形一个)—— 原模型没有材质时是 null */
  materialIndex: Uint16Array | null;
  /** 材质名 —— 下标指进这个数组 */
  materialNames: string[] | null;
};

/** 分析(挑面)的结果 */
export type MagnetAnalyzeOutcome = {
  faces: MagnetFaceReport[];
  /** 智能识别出来的那块最大平面(没有就 null) */
  backFace: MagnetPatchReport | null;
  /** 候选平面区域(按面积从大到小)—— 用户可以挑别的 */
  patches: MagnetPatchReport[];
  /** 切之前的体积(mm³) */
  volume: number;
  /** 包围盒 */
  bboxMin: [number, number, number];
  bboxMax: [number, number, number];
  /**
   * 动了什么 —— 模型**不是封闭实体**时,浏览器那条路会**临时**封上再切
   *
   * `changed === false` = 模型本来就是好的,一个字节都没动。
   * `cappedLoops > 0` = 模型有破口,切的时候**临时**盖了几处,切完摘掉 ——
   * 用户的模型上**没有**多出任何面(见 `magnet-lid.ts`)。
   *
   * 界面拿这个告诉用户「你的模型有破口,我们临时封上,切完原样还给你」——
   * **不能悄悄改用户的模型**。
   */
  repair: MagnetRepairReport | null;
};

/** Worker 回的错 —— 带稳定的 code,界面按 code 查文案 */
export type MagnetErrorCode =
  /** 模型不是封闭流形(有开放边 / 非流形边) */
  | "NOT_MANIFOLD"
  /** 模型整体法线朝内 */
  | "INVERTED_WINDING"
  /** 模型是空的 / 退化 */
  | "EMPTY_MODEL"
  /** 布尔运算失败 */
  | "BOOLEAN_FAILED"
  /** 切完的面数锐减(切坏了) */
  | "FACE_COUNT_COLLAPSED"
  /** 切完的面数没变(没切进去) */
  | "NOTHING_CUT"
  /** 体积没减少(切了个寂寞) */
  | "VOLUME_UNCHANGED"
  /** 去掉量比理论值少太多 —— 孔切到边上去了 */
  | "HOLE_SPILLED"
  /** 那个面太薄 / 净空不够 */
  | "FACE_NOT_CUTTABLE"
  /**
   * 切割超时 —— **模型太重,浏览器算不完**
   *
   * 跟模型有关(不是「不是模型的问题」!)。真实模型(AI 生成的、几十万面的)
   * 跑 manifold 的 EXACT 布尔运算可能要好几分钟,也可能根本算不完。
   */
  | "WORKER_TIMEOUT"
  /**
   * 切割引擎崩了 —— Worker 整个没了
   *
   * 常见于模型几何太复杂(自相交 / 面数太大),引擎算到一半炸了。
   */
  | "WORKER_CRASHED"
  /**
   * Worker 压根起不来 —— 已经退回主线程算了,还是没成
   *
   * 浏览器不支持 Worker、或者打包器没产出 worker chunk。
   */
  | "WORKER_UNAVAILABLE"
  /**
   * 引擎那一步抛了个预料之外的错(建网格 / 切刀摆放 / 取结果)
   *
   * **带原始信息** —— 工作室要能一眼看出是哪一步炸的。
   */
  | "ENGINE_FAILED"
  /**
   * 切割引擎(wasm)**没加载出来**
   *
   * 不是模型的问题 —— 是 `manifold.wasm` 那个文件没拿到(404 / 被 locale
   * 前缀重定向劫持 / URL 解不出来)。
   *
   * 2026-11-11 线上踩的就是这条:胶水在 Worker 里读 wasm 用的是同步 XHR,
   * URL 又是根相对路径 ⇒ `xhr.open()` 抛 `Invalid URL` ⇒ 运行时整个没起来。
   */
  | "ENGINE_LOAD_FAILED"
  /**
   * 出了个**预料之外**的错(不是上面那几种已知的)
   *
   * 以前所有非 `MagnetCutterError` 的抛出都一律报成 `BOOLEAN_FAILED` ——
   * 用户看到的是「布尔运算在这个模型上失败了」,但真因(Worker 崩了 /
   * 超时了 / 某个 TypeError)全被吞了。**分开放**,界面才能说对那句话。
   */
  | "UNEXPECTED"
  /**
   * 本地 Blender 没跑起来 —— **连不上 127.0.0.1**
   *
   * 端口没开 / 插件没启动 / 防火墙拦了。**不是模型的问题**。
   */
  | "BLENDER_NOT_RUNNING"
  /**
   * 本地 Blender 那边切失败了 —— 它自己报回来的
   *
   * 响应体里带它自己的原因(面太薄 / 孔切到边上 / 布尔失败 …)。
   */
  | "BLENDER_FAILED"
  /** 本地 Blender 那边超时了 —— 大模型切太久 */
  | "BLENDER_TIMEOUT"
  /**
   * 本地 Blender 回的不是预期的东西(不是 zip / 头对不上)
   *
   * 一般是**插件版本对不上**网页端。
   */
  | "BLENDER_BAD_RESPONSE";

export type MagnetWorkerIn =
  | {
      type: "analyze";
      seq: number;
      positions: Float32Array;
      /** 孔参数 —— 影响「太薄 / 切到边上」的判定 */
      hole?: MagnetHoleParams | null;
      texture?: MagnetTextureInput | null;
    }
  | {
      type: "cut";
      seq: number;
      positions: Float32Array;
      /** 切哪个面 —— `"auto"` = 智能识别出来的那块平面 */
      target: MagnetTargetId;
      hole?: MagnetHoleParams | null;
      texture?: MagnetTextureInput | null;
    };

export type MagnetWorkerOut =
  | { type: "analyze"; seq: number; result: MagnetAnalyzeOutcome }
  | { type: "cut"; seq: number; result: MagnetCutOutcome }
  | {
      type: "error";
      seq: number;
      code: MagnetErrorCode;
      message: string;
    };
