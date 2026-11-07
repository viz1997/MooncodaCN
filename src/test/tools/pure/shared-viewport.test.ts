import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  POSE_EULER_ORDER,
  rotatedBBoxMinZ,
  rotatePointXYZ,
} from "@/features/shared/components/model-viewport/pose";
import {
  prepareSupportModel,
  rotateSupportMesh,
} from "@/features/tools/lib/mesh/support-shell";
import { boxTriangles } from "@/test/tools/fixtures/mesh-fixtures";

/**
 * 共用的 3D 视口 —— **克重也用检查那一份**(2026-11-07)
 *
 * ## 背景
 *
 * 工作室的原话:**「克重也用检查的3d预览」** + **「需要支持角度调整」**。
 *
 * 以前有两个预览:模型检查那一套深色视口(`tools/components/model-check/
 * viewport.tsx`)和克重那一套浅色视口(`pricing/components/obj-viewer.tsx`)。
 * 两套代码、两套相机、两套材质 —— 同一模型在两个视角里长得不一样,支撑的
 * 画法也不一样(一个是「画出来的近似」,一个是「算出来的那块」)。
 *
 * 现在只有一份:`features/shared/components/model-viewport/`。
 *
 * ## 这个测试守住什么
 *
 * 「合并」这件事很容易在后来的改动里**慢慢散掉** —— 有人又写回一个独立
 * 预览、有人让画面上的姿态跟算克重的姿态差一个旋转顺序、有人把支撑几何
 * 又单独算一遍。每一条退化都不会报错,只会让画面跟数字**对不上**。
 *
 * 这里守两件事:
 *
 * | 守卫 | 为什么 |
 * |---|---|
 * | 克重 / 检查都 import 同一个 `ModelViewport` | 又冒出第二个预览 |
 * | 老的两份视口文件删掉了 | 有人从老文件里抄回去 |
 * | 支撑几何是摆盘 Worker 算完姿态时**同一块**几何 | 画面上画的跟算克重的不是同一块 |
 * | 视口的旋转顺序 = 摆盘算法的旋转顺序 | 画面转到 30°,克重还是躺着算的 |
 * | 支撑几何挂在模型组里,不挂姿态组里 | 支撑被转了两次 |
 * | 转模型用 `TransformControls` 控制器 | 回到「左键拖着模型瞎转」那套 |
 * | 控制器挂在姿态组上,拖的时候相机让开 | 画面抖 / 转的不是打印姿态 |
 *
 * 纯计算 + 文件扫描 —— 不需要 DB / 网络 / 浏览器。
 */

/** 仓库根目录 */
const ROOT = resolve(process.cwd());

/** 读文件(不存在就抛 —— 路径写错了要立刻炸,不是静默跳过) */
function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

/** 把注释去掉 —— 注释里写着「以前是两个预览」不算违规 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*(\*|\/\/)/.test(line))
    .join("\n");
}

/**
 * 把空白压成单个空格
 *
 * Biome 会把长表达式折行(JSX 属性、`useCallback(...)` 的参数列表)——
 * 逐字匹配就断了。压平之后匹配的是**代码**,不是排版。
 */
function flat(src: string): string {
  return src.replace(/\s+/g, " ");
}

const VIEWPORT_DIR = "src/features/shared/components/model-viewport";
const VIEWPORT = `${VIEWPORT_DIR}/model-viewport.tsx`;
const SETTINGS_PANEL =
  "src/features/pricing/components/model-settings-panel.tsx";
const CALCULATOR = "src/features/pricing/components/pricing-calculator.tsx";
const CHECK_PANEL =
  "src/features/tools/components/model-check/model-check-panel.tsx";
const ANGLE_OPTIMIZER = "src/features/pricing/lib/angle-optimizer.ts";
const PROTOCOL = "src/features/pricing/lib/angle-optimizer-protocol.ts";

describe("共用视口 —— 两个视角用的是同一个组件", () => {
  it("克重那一栏 import 的是共享视口", () => {
    const code = stripComments(read(SETTINGS_PANEL));

    expect(code).toContain(
      'from "@/features/shared/components/model-viewport"'
    );
    expect(code).toContain("<ModelViewport");
  });

  it("「检查」那一栏不自己挂视口 —— 展示区域只有那一个", () => {
    const check = stripComments(read(CHECK_PANEL));

    // 检查侧栏只剩右栏那一块;视口由工作台框架统一挂
    expect(check).not.toContain("ModelViewport");

    // 整个工作台只挂一个
    const frame = stripComments(read(SETTINGS_PANEL));
    expect(frame.match(/<ModelViewport/g) ?? []).toHaveLength(1);
  });

  it("模型角度在所有视角都传给视口(转的是模型,不是相机)", () => {
    const code = stripComments(read(SETTINGS_PANEL));

    // 姿态无条件传 —— 不分视角:在「检查」那一栏转了模型,
    // 切到「克重」还是这个姿态
    expect(code).toContain("pose={{");
    expect(code).toContain("rotX: viewerRotX");
    // 角度条常驻 —— 不是「跑过智能摆盘才出现」
    expect(code).toContain('t("angle.modelAngle")');
  });

  it("两个老视口文件删掉了(别有人从老文件里抄回去)", () => {
    expect(
      existsSync(
        join(ROOT, "src/features/tools/components/model-check/viewport.tsx")
      )
    ).toBe(false);
    expect(
      existsSync(join(ROOT, "src/features/pricing/components/obj-viewer.tsx"))
    ).toBe(false);
  });

  it("克重那一栏不再 import 老的 `ObjViewer`", () => {
    const code = stripComments(read(SETTINGS_PANEL));

    expect(code).not.toContain("ObjViewer");
    expect(code).not.toContain("obj-viewer");
  });

  it("共享视口自己用 three.js 的 `ZYX` 顺序(先 X 后 Y 后 Z)", () => {
    const code = stripComments(read(VIEWPORT));

    // 摆盘算法 / OBJ 导出都是「先 X 后 Y 后 Z」= Rz·Ry·Rx,
    // three.js 里对应 `rotation.order = "ZYX"`。
    expect(code).toContain(
      'from "@/features/shared/components/model-viewport/pose"'
    );
    expect(code).toContain("rotation.order = POSE_EULER_ORDER");
    expect(POSE_EULER_ORDER).toBe("ZYX");
  });

  it("支撑几何挂在模型组里,不挂姿态组里(不然会被转两次)", () => {
    const code = stripComments(read(VIEWPORT));

    // 模型 + 问题边线在姿态组里(要跟着转)
    expect(code).toContain("poseGroup.add(mesh)");

    // 支撑那几块已经是转好姿态的坐标 —— 挂在模型组上,不能再转
    for (const mesh of [
      "shellMesh",
      "underMesh",
      "projMesh",
      "ringMesh",
      "curtainMesh",
    ]) {
      expect(code).toContain(`group.add(${mesh})`);
    }
  });
});

describe("共用视口 —— 支撑几何来自摆盘 Worker 的同一块", () => {
  it("克重那一栏把 Worker 算出来的支撑外壳传进视口", () => {
    const code = stripComments(read(SETTINGS_PANEL));

    // 外壳跟着那颗开关走 —— 关着就不画(几何留着,画不画是另一回事)
    expect(flat(code)).toMatch(
      /supportShell=\{ ?showSupport \? \(poseSupport\?\.shell \?\? null\) : null ?\}/
    );
  });

  it("当前姿态的支撑计算顺带回传画出来的那块几何", () => {
    const code = stripComments(read(CALCULATOR));

    // 外壳在**算体积的同一次调用**里建出来 —— 画出来的那圈支撑就是算克重
    // 的那块支撑。建不建由那颗开关决定(`if (!showSupport) return;`),
    // 一旦要算就整块要(数字跟画面得是同一次计算的)。
    expect(code).toContain("withShell: true");
    expect(code).toContain("if (!showSupport) return;");
  });

  it("支撑默认**不算**(用户没点「包裹支撑」之前一个支撑都不算)", () => {
    const code = stripComments(read(CALCULATOR));

    // 支撑外壳是整套计算里最贵的一块几何 —— 用户没主动要「看看支撑长什么
    // 样子」之前不该替他算。工作室的口径(2026-11-07):连**数字**也不给,
    // 用户摆定角度之后点那颗按钮才算一次。
    expect(code).toMatch(
      /const \[showSupport, setShowSupport\] = useState\(false\)/
    );
  });

  it("Worker 那头认这个开关,并且把外壳带回来", () => {
    const optimizer = stripComments(read(ANGLE_OPTIMIZER));

    expect(optimizer).toContain("withShell");
    expect(optimizer).toContain("shell: withShell ? shell : undefined");

    const protocol = stripComments(read(PROTOCOL));
    expect(protocol).toContain("withShell");
  });

  it("不请求外壳时就不建(摆盘搜索 625 个姿态,别每个都建一遍)", () => {
    const optimizer = stripComments(read(ANGLE_OPTIMIZER));

    // `includeBaseRing` / `includeCurtain` 只在真的要画的时候才打开
    expect(optimizer).toContain("includeBaseRing: withShell");
    expect(optimizer).toContain("includeCurtain: withShell");
  });
});

describe("共用视口 —— 转模型用**旋转控制器**(业界主流那套)", () => {
  it("挂 three.js 的 `TransformControls`(模型上套三个彩色圆环)", () => {
    const code = stripComments(read(VIEWPORT));

    // 工作室的原话(2026-11-07):「模型旋转不是这样操作,按照业界主流设计,
    // 带控制器」—— Blender / Sketchfab 那一套,three.js 里现成就有。
    expect(code).toContain(
      'from "three/examples/jsm/controls/TransformControls.js"'
    );
    expect(code).toContain("new TransformControls(");
    // 只给「转」—— 平移 / 缩放不该改打印姿态
    expect(code).toContain('tc.setMode("rotate")');
    // 世界坐标轴 —— 环上那三个轴跟角度条上的 rotX / rotY / rotZ 一一对应
    // (绕模型自身的局部轴转的话,数对不上,用户会懵)
    expect(code).toContain('tc.setSpace("world")');
    // helper 得进场景 —— 0.187 起控制器本体不是 Object3D
    expect(code).toContain("tc.getHelper()");
    expect(code).toContain("ctx.scene.add(helper)");
  });

  it("控制器挂在**姿态组**上 —— 姿态组才是「打印姿态」那一份", () => {
    const code = stripComments(read(VIEWPORT));

    // 挂错组的话:画面上转的是模型,算克重的却是另一个姿态
    expect(code).toContain("tc.attach(poseGroup)");
    expect(code).not.toContain("tc.attach(mesh");
  });

  it("拖环的时候相机让开 —— 否则拖环的同时画面也在转", () => {
    const code = stripComments(read(VIEWPORT));

    // 控制器按下时左键归它 —— 相机得让开,放手再交回来
    expect(code).toContain("ctx.controls.enabled = false");
    expect(code).toContain("ctx.controls.enabled = true");
  });

  it("控制器写的是 quaternion —— 按仓库口径分解回欧拉角", () => {
    const code = stripComments(read(VIEWPORT));

    // 不分解的话,角度条上的数跟画面对不上
    expect(code).toContain("setFromQuaternion");
    expect(code).toContain("POSE_EULER_ORDER");
  });

  it("左键不再被从相机手里拿走 —— 空白处拖动还是转相机", () => {
    const code = stripComments(read(VIEWPORT));

    // 以前是「左键拖 = 转模型」,现在模型由控制器转 —— 相机的左键旋转
    // 得留着(不然空白处拖一点反应都没有,用户以为页面卡了)。
    expect(code).not.toContain("mouseButtons.LEFT");
    expect(code).not.toContain("touches.ONE");
    // 右键平移 / 滚轮缩放没被动
    expect(code).not.toContain("mouseButtons.RIGHT = null");
  });

  it("控制器不传回调就不挂(这个视口也可能被别处拿去只看不动)", () => {
    const code = stripComments(read(VIEWPORT));

    expect(code).toContain("if (!onPoseChangeRef.current) return;");
  });
});

describe("共用视口 —— 画面上的姿态就是算克重的那个姿态", () => {
  /** 一个不对称的盒子(各边不一样长,转起来才看得出顺序对不对) */
  const BOX = boxTriangles([0, 0, 0], [30, 12, 7]);

  /** 绕 X 转一次 */
  function rotX(v: { x: number; y: number; z: number }, deg: number) {
    const c = Math.cos((deg * Math.PI) / 180);
    const s = Math.sin((deg * Math.PI) / 180);
    return { x: v.x, y: v.y * c - v.z * s, z: v.y * s + v.z * c };
  }

  /** 绕 Y 转一次 */
  function rotY(v: { x: number; y: number; z: number }, deg: number) {
    const c = Math.cos((deg * Math.PI) / 180);
    const s = Math.sin((deg * Math.PI) / 180);
    return { x: v.x * c + v.z * s, y: v.y, z: -v.x * s + v.z * c };
  }

  /** 绕 Z 转一次 */
  function rotZ(v: { x: number; y: number; z: number }, deg: number) {
    const c = Math.cos((deg * Math.PI) / 180);
    const s = Math.sin((deg * Math.PI) / 180);
    return { x: v.x * c - v.y * s, y: v.x * s + v.y * c, z: v.z };
  }

  /** 「先 X 后 Y 后 Z」= Rz·Ry·Rx —— 仓库口径 */
  function compose(
    v: { x: number; y: number; z: number },
    rx: number,
    ry: number,
    rz: number
  ) {
    return rotZ(rotY(rotX(v, rx), ry), rz);
  }

  /** 「先 Z 后 Y 后 X」= Rx·Ry·Rz —— three.js 默认的 "XYZ",**反的** */
  function composeXYZ(
    v: { x: number; y: number; z: number },
    rx: number,
    ry: number,
    rz: number
  ) {
    return rotX(rotY(rotZ(v, rz), ry), rx);
  }

  it("纯实现的旋转跟摆盘算法(`rotateSupportMesh`)逐点相同", () => {
    const model = prepareSupportModel(BOX);

    for (const [rx, ry, rz] of [
      [30, 0, 0],
      [0, 45, 0],
      [0, 0, 60],
      [25, 40, 15],
      [-70, 20, 130],
    ] as [number, number, number][]) {
      const rotated = rotateSupportMesh(model.mesh, rx, ry, rz);
      for (let v = 0; v < model.mesh.vertexCount; v++) {
        const expected = rotatePointXYZ(
          {
            x: model.mesh.vertices[v * 3] ?? 0,
            y: model.mesh.vertices[v * 3 + 1] ?? 0,
            z: model.mesh.vertices[v * 3 + 2] ?? 0,
          },
          rx,
          ry,
          rz
        );
        expect(rotated.vertices[v * 3]).toBeCloseTo(expected.x, 4);
        expect(rotated.vertices[v * 3 + 1]).toBeCloseTo(expected.y, 4);
        expect(rotated.vertices[v * 3 + 2]).toBeCloseTo(expected.z, 4);
      }
    }
  });

  it("旋转后的最低点跟包围盒算出来的一致(模型托底高度用得上)", () => {
    const model = prepareSupportModel(BOX);

    for (const [rx, ry, rz] of [
      [30, 0, 0],
      [0, 45, 0],
      [25, 40, 15],
      [-70, 20, 130],
    ] as [number, number, number][]) {
      const rotated = rotateSupportMesh(model.mesh, rx, ry, rz);
      const fromBbox = rotatedBBoxMinZ(
        {
          min: {
            x: model.mesh.bboxMin[0],
            y: model.mesh.bboxMin[1],
            z: model.mesh.bboxMin[2],
          },
          max: {
            x: model.mesh.bboxMax[0],
            y: model.mesh.bboxMax[1],
            z: model.mesh.bboxMax[2],
          },
        },
        rx,
        ry,
        rz
      );
      expect(fromBbox).toBeCloseTo(rotated.bboxMin[2], 4);
    }
  });

  it("`ZYX` 跟「先 X 后 Y 后 Z」是一回事(不是反的)", () => {
    const v = { x: 1, y: 2, z: 3 };
    const rx = 30;
    const ry = 40;
    const rz = 50;

    // 「先 X 后 Y 后 Z」= Rz·Ry·Rx
    const zyx = compose(v, rx, ry, rz);
    // 「先 Z 后 Y 后 X」= Rx·Ry·Rz —— three.js 默认的 "XYZ" 就是它
    const xyz = composeXYZ(v, rx, ry, rz);

    const got = rotatePointXYZ(v, rx, ry, rz);
    expect(got.x).toBeCloseTo(zyx.x, 6);
    expect(got.y).toBeCloseTo(zyx.y, 6);
    expect(got.z).toBeCloseTo(zyx.z, 6);

    // 两个顺序确实不同 —— 顺序写反了,上面那条断言会立刻炸
    expect(zyx.x).not.toBeCloseTo(xyz.x, 3);
  });
});
