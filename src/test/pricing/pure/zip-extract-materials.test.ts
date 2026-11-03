import JSZip from "jszip";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * 多材质模型的**端到端**解压测试 —— 走真实的 `extractZip()`。
 *
 * ## 为什么这个值得测
 *
 * 「白模 / 贴图错乱」的三条根因全都落在解压这一层:
 *
 *   1. MTL 选错(拿「包里第一个 .mtl」而不是 OBJ `mtllib` 指的那个)
 *   2. 贴图匹配错(拿「包里第一张图」而不是该材质 `map_Kd` 指的那张)
 *   3. 材质分组丢(worker 丢掉 `usemtl`,整块模型只能挂第一个材质)
 *
 * 单测测 helpers 只能证明「helper 是对的」,证明不了「解压管线用对了 helper」。
 * 这里造真的 zip 走一遍完整管线,把上面三条钉死。
 *
 * Worker 在 Node 里没有 —— 用 `WORKER_SOURCE` 在进程内跑一遍,逻辑完全一致。
 */

import { WORKER_SOURCE } from "@/features/pricing/lib/obj-worker-client";
import {
  extractZip,
  type ModelFile,
} from "@/features/pricing/lib/zip-extractor";

/** 在进程内跑 worker 源码的假 Worker */
class InProcessWorker {
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((err: unknown) => void) | null = null;
  terminate() {}
  postMessage(data: unknown) {
    const scope = {
      onmessage: null as null | ((e: { data: unknown }) => void),
      postMessage: (msg: { type: string }) => {
        if (msg.type === "result" || msg.type === "error") {
          this.onmessage?.({ data: msg });
        }
      },
    };
    const factory = new Function("self", `${WORKER_SOURCE}\nreturn self;`);
    const instance = factory(scope) as typeof scope;
    instance.onmessage?.({ data });
  }
}

beforeAll(() => {
  (globalThis as { Worker?: unknown }).Worker = InProcessWorker;
});

/** 造一个假的 PNG(内容无所谓,只关心它是哪个文件) */
function png(marker: string): Blob {
  return new Blob([marker], { type: "image/png" });
}

/** 两个材质的 OBJ:一半面用 Wood,一半面用 Metal,UV 齐全 */
const MULTI_MATERIAL_OBJ = [
  "mtllib model.mtl",
  "v 0 0 0",
  "v 1 0 0",
  "v 0 1 0",
  "vt 0 0",
  "vt 1 0",
  "vt 0 1",
  "usemtl Wood",
  "f 1/1 2/2 3/3",
  "usemtl Metal",
  "f 1/1 2/2 3/3",
].join("\n");

const MULTI_MATERIAL_MTL = [
  "newmtl Wood",
  "Kd 0.8 0.6 0.4",
  "map_Kd wood.png",
  "newmtl Metal",
  "Kd 0.9 0.9 0.9",
  "map_Kd metal.png",
].join("\n");

/** 把若干文件打成一个 zip */
async function makeZip(files: Record<string, string | Blob>): Promise<File> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) {
    zip.file(name, content);
  }
  const blob = await zip.generateAsync({ type: "blob" });
  return new File([blob], "model.zip", { type: "application/zip" });
}

/** 取某个材质的 base color 贴图 URL */
function mapUrl(model: ModelFile, material: string): string | undefined {
  return model.textureUrls?.[material]?.map;
}

/** 在进程内跑一遍 worker,拿回几何数据 */
function parseWithWorker(objText: string): Promise<{
  uvs?: Float32Array;
  materialNames?: string[];
}> {
  return new Promise((resolve, reject) => {
    const worker = new InProcessWorker();
    worker.onmessage = (ev: { data: unknown }) => {
      const msg = ev.data as {
        type: string;
        result?: { uvs?: Float32Array; materialNames?: string[] };
        message?: string;
      };
      if (msg.type === "result" && msg.result) resolve(msg.result);
      if (msg.type === "error")
        reject(new Error(msg.message ?? "worker error"));
    };
    worker.postMessage({ objText, sendGeometry: true });
  });
}

describe("extractZip:多材质模型的贴图解析", () => {
  it("每个材质挂自己 map_Kd 指的那张图,互不串味", async () => {
    const file = await makeZip({
      "model.obj": MULTI_MATERIAL_OBJ,
      "model.mtl": MULTI_MATERIAL_MTL,
      "wood.png": png("wood"),
      "metal.png": png("metal"),
    });

    const result = await extractZip(file);
    expect(result.error).toBeUndefined();
    const model = result.model;
    expect(model).not.toBeNull();

    const wood = mapUrl(model!, "Wood");
    const metal = mapUrl(model!, "Metal");
    expect(wood).toBeTruthy();
    expect(metal).toBeTruthy();
    // 关键:两个材质必须是**不同的** URL —— 共用一张就是「贴图错乱」
    expect(wood).not.toBe(metal);

    // 缩略图 = 第一个材质的 base color 贴图
    expect(model!.previewUrl).toBe(wood);
  });

  it("OBJ 的 mtllib 指哪个 MTL 就用哪个(包里多个 .mtl 时)", async () => {
    // 包里有两个 .mtl,OBJ 指的是第二个
    const obj = MULTI_MATERIAL_OBJ.replace("model.mtl", "real.mtl");
    const file = await makeZip({
      "model.obj": obj,
      "decoy.mtl": ["newmtl Wood", "Kd 1 0 0", "map_Kd decoy.png"].join("\n"),
      "real.mtl": MULTI_MATERIAL_MTL,
      "decoy.png": png("decoy"),
      "wood.png": png("wood"),
      "metal.png": png("metal"),
    });

    const result = await extractZip(file);
    const model = result.model!;
    expect(model.mtlText).toContain("newmtl Metal");
    expect(model.mtlText).not.toContain("decoy.png");
    expect(mapUrl(model, "Wood")).toBeTruthy();
    expect(mapUrl(model, "Wood")).not.toBe(mapUrl(model, "Metal"));
  });

  it("贴图放在子目录里也能按 basename 匹配上", async () => {
    const file = await makeZip({
      "model.obj": MULTI_MATERIAL_OBJ,
      "model.mtl": MULTI_MATERIAL_MTL,
      "textures/wood.png": png("wood"),
      "textures/metal.png": png("metal"),
    });

    const result = await extractZip(file);
    const model = result.model!;
    expect(mapUrl(model, "Wood")).toBeTruthy();
    expect(mapUrl(model, "Metal")).toBeTruthy();
    expect(mapUrl(model, "Wood")).not.toBe(mapUrl(model, "Metal"));
  });

  it("**反例**:某个材质的贴图缺失 → 该材质不挂贴图,绝不拿别的图顶替", async () => {
    const file = await makeZip({
      "model.obj": MULTI_MATERIAL_OBJ,
      "model.mtl": MULTI_MATERIAL_MTL,
      // wood.png 故意不放
      "metal.png": png("metal"),
    });

    const result = await extractZip(file);
    const model = result.model!;

    // Wood 没有贴图 → 不挂
    expect(mapUrl(model, "Wood")).toBeUndefined();
    // Metal 仍然挂自己的那张
    expect(mapUrl(model, "Metal")).toBeTruthy();
    // 缩略图不能是 Wood 的(它没有贴图),得是 Metal 的
    expect(model.previewUrl).toBe(mapUrl(model, "Metal"));
  });

  it("map_Kd 带 option token(-s 1 1 1)也能匹配上", async () => {
    const mtl = MULTI_MATERIAL_MTL.replace(
      "map_Kd wood.png",
      "map_Kd -s 1 1 1 wood.png"
    );
    const file = await makeZip({
      "model.obj": MULTI_MATERIAL_OBJ,
      "model.mtl": mtl,
      "wood.png": png("wood"),
      "metal.png": png("metal"),
    });

    const result = await extractZip(file);
    const model = result.model!;
    expect(mapUrl(model, "Wood")).toBeTruthy();
    expect(mapUrl(model, "Metal")).toBeTruthy();
  });

  it("多个 OBJ 合并:vt 索引要偏移,材质名撞车要加后缀", async () => {
    const objA = [
      "mtllib a.mtl",
      "v 0 0 0",
      "v 1 0 0",
      "v 0 1 0",
      "vt 0 0",
      "vt 1 0",
      "vt 0 1",
      "usemtl Material",
      "f 1/1 2/2 3/3",
    ].join("\n");
    const objB = [
      "mtllib b.mtl",
      "v 0 0 0",
      "v 1 0 0",
      "v 0 1 0",
      "vt 0 0",
      "vt 1 0",
      "vt 0 1",
      "usemtl Material",
      "f 1/1 2/2 3/3",
    ].join("\n");
    const file = await makeZip({
      "a.obj": objA,
      "b.obj": objB,
      "a.mtl": ["newmtl Material", "map_Kd wood.png"].join("\n"),
      "b.mtl": ["newmtl Material", "map_Kd metal.png"].join("\n"),
      "wood.png": png("wood"),
      "metal.png": png("metal"),
    });

    const result = await extractZip(file);
    const model = result.model!;

    // 第二个 OBJ 的顶点/UV 索引都往后挪了 3
    expect(model.objText).toContain("f 4/4 5/5 6/6");
    // 撞名的材质加了后缀
    expect(model.mtlText).toContain("newmtl Material_1");
    // 两个材质各自挂各自的图
    const urls = Object.values(model.textureUrls ?? {}).map((u) => u.map);
    expect(urls.filter(Boolean).length).toBe(2);
    expect(new Set(urls).size).toBe(2);
  });

  /**
   * 流式 OBJ(3ds Max 导出)的负下标 —— 真实案例 `006109.zip`。
   *
   * 那种导出器**每个面自带一组 vt**,面里用 `-3 -2 -1` 引用刚写的那几个。
   * 按 OBJ 规范(负下标 = 从文件末尾数)解析的话,每个面都会拿到文件最后几个 vt,
   * 整张模型的 UV 塌成同几个点 —— 贴图明明加载了,画面却是一整块纯色。
   */
  it("流式 OBJ 的负下标:每个面拿到自己的 UV,不是全部塌成同一组", async () => {
    const streamingObj = [
      "mtllib model.mtl",
      "v 0 0 0",
      "v 1 0 0",
      "v 0 1 0",
      "v 1 1 0",
      "usemtl Wood",
      "vt 0 0",
      "vt 1 0",
      "vt 0 1",
      "f 1/-3 2/-2 3/-1",
      "vt 0.5 0.5",
      "vt 0.75 0.5",
      "vt 0.75 0.75",
      "f 1/-3 2/-2 4/-1",
    ].join("\n");
    const file = await makeZip({
      "model.obj": streamingObj,
      "model.mtl": ["newmtl Wood", "Kd 1 1 1", "map_Kd wood.png"].join("\n"),
      "wood.png": png("wood"),
    });

    const result = await extractZip(file);
    const model = result.model!;
    expect(mapUrl(model, "Wood")).toBeTruthy();

    const parsed = await parseWithWorker(model.objText);
    // 两个面 → 6 个角 → 12 个 float,UV 各不相同
    expect(Array.from(parsed.uvs ?? [])).toEqual([
      0, 0, 1, 0, 0, 1, 0.5, 0.5, 0.75, 0.5, 0.75, 0.75,
    ]);
  });
});
