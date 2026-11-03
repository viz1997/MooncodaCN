import { describe, expect, it } from "vitest";

/**
 * OBJ worker 的材质分组 / UV 兜底测试。
 *
 * worker 源码是一段字符串(`WORKER_SOURCE`),浏览器里靠 Blob URL 起一个
 * Web Worker。这里在 Node 里用 `new Function("self", ...)` 把它跑起来 ——
 * 逻辑完全一致,只是把 `postMessage` 换成同步回调。
 *
 * ## 为什么这个值得测
 *
 * worker 曾经**整个丢掉 `usemtl`** —— 材质分组信息一丢,渲染时整块模型
 * 只能挂 `materials[0]`,也就是「所有材质都用第一张贴图」。
 * 另外 UV 是**整面**兜底的:一个角没写 `vt`,整面的 UV 全变 (0,0),
 * 贴图直接糊成一片。这两条都是纯逻辑,值得钉死。
 */

import { WORKER_SOURCE } from "@/features/pricing/lib/obj-worker-client";

type WorkerResult = {
  vertexCount: number;
  faceCount: number;
  triangleCount: number;
  uvCount: number;
  positions?: Float32Array;
  uvs?: Float32Array;
  materialNames?: string[];
  materialIndex?: Uint16Array;
  mtllibNames?: string[];
};

/**
 * 在 Node 里跑一遍 worker 源码,拿回解析结果。
 */
function runWorker(
  objText: string,
  sendGeometry = true
): Promise<WorkerResult> {
  return new Promise((resolve, reject) => {
    const scope = {
      onmessage: null as null | ((e: { data: unknown }) => void),
      postMessage: (msg: {
        type: string;
        result?: WorkerResult;
        message?: string;
      }) => {
        if (msg.type === "result" && msg.result) resolve(msg.result);
        if (msg.type === "error") {
          reject(new Error(msg.message ?? "worker error"));
        }
      },
    };
    // worker 源码是一段自包含脚本,这里直接当函数体执行
    const factory = new Function("self", `${WORKER_SOURCE}\nreturn self;`);
    const instance = factory(scope) as typeof scope;
    instance.onmessage?.({ data: { objText, sendGeometry } });
  });
}

describe("worker: usemtl 材质分组", () => {
  const obj = [
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

  it("按首次出现顺序收集材质名", async () => {
    const result = await runWorker(obj);
    expect(result.materialNames).toEqual(["Wood", "Metal"]);
  });

  it("每个三角形一个材质下标", async () => {
    const result = await runWorker(obj);
    expect(result.triangleCount).toBe(2);
    expect(Array.from(result.materialIndex ?? [])).toEqual([0, 1]);
  });

  it("材质下标跟三角形顺序一一对应", async () => {
    const multi = [
      "v 0 0 0",
      "v 1 0 0",
      "v 0 1 0",
      "usemtl A",
      "f 1 2 3",
      "usemtl B",
      "f 1 2 3",
      "usemtl A",
      "f 1 2 3",
    ].join("\n");
    const result = await runWorker(multi);
    expect(result.materialNames).toEqual(["A", "B"]);
    expect(Array.from(result.materialIndex ?? [])).toEqual([0, 1, 0]);
  });

  it("同一个 usemtl 重复出现不会产生第二个材质", async () => {
    const repeat = [
      "v 0 0 0",
      "v 1 0 0",
      "v 0 1 0",
      "usemtl A",
      "f 1 2 3",
      "usemtl A",
      "f 1 2 3",
    ].join("\n");
    const result = await runWorker(repeat);
    expect(result.materialNames).toEqual(["A"]);
  });

  it("usemtl 之前的面归到第一个材质", async () => {
    const before = [
      "v 0 0 0",
      "v 1 0 0",
      "v 0 1 0",
      "f 1 2 3",
      "usemtl A",
      "f 1 2 3",
    ].join("\n");
    const result = await runWorker(before);
    expect(result.materialNames).toEqual(["A"]);
    expect(Array.from(result.materialIndex ?? [])).toEqual([0, 0]);
  });

  it("OBJ 没有 usemtl 时不返回材质信息", async () => {
    const plain = ["v 0 0 0", "v 1 0 0", "v 0 1 0", "f 1 2 3"].join("\n");
    const result = await runWorker(plain);
    expect(result.materialNames).toBeUndefined();
    expect(result.materialIndex).toBeUndefined();
  });

  it("材质下标数量跟三角形数一致", async () => {
    const result = await runWorker(obj);
    expect(result.materialIndex?.length).toBe(result.triangleCount);
  });
});

describe("worker: mtllib 声明", () => {
  it("取出 mtllib 文件名", async () => {
    const result = await runWorker("mtllib model.mtl\nv 0 0 0\n");
    expect(result.mtllibNames).toEqual(["model.mtl"]);
  });

  it("一行多个 mtllib 也要全取出来", async () => {
    const result = await runWorker("mtllib a.mtl b.mtl\nv 0 0 0\n");
    expect(result.mtllibNames).toEqual(["a.mtl", "b.mtl"]);
  });

  it("sendGeometry=false 时也返回(选配套 MTL 要用)", async () => {
    const result = await runWorker("mtllib model.mtl\nv 0 0 0\n", false);
    expect(result.mtllibNames).toEqual(["model.mtl"]);
    expect(result.materialNames).toBeUndefined();
  });
});

describe("worker: 逐角 UV 兜底", () => {
  it("三个角都有 vt → UV 原样保留", async () => {
    const obj = [
      "v 0 0 0",
      "v 1 0 0",
      "v 0 1 0",
      "vt 0 0",
      "vt 1 0",
      "vt 0 1",
      "f 1/1 2/2 3/3",
    ].join("\n");
    const result = await runWorker(obj);
    expect(Array.from(result.uvs ?? [])).toEqual([0, 0, 1, 0, 0, 1]);
  });

  it("一个角缺 vt → **只有那个角**退 (0,0),其余角照旧", async () => {
    const obj = [
      "v 0 0 0",
      "v 1 0 0",
      "v 0 1 0",
      "vt 0 0",
      "vt 1 0",
      "vt 0 1",
      "f 1/1 2/2 3",
    ].join("\n");
    const result = await runWorker(obj);
    // 第三个角没有 vt → (0,0);第一、二个角保留自己的 UV
    expect(Array.from(result.uvs ?? [])).toEqual([0, 0, 1, 0, 0, 0]);
  });

  it("第一个角缺 vt → 只有第一个角退 (0,0)", async () => {
    const obj = [
      "v 0 0 0",
      "v 1 0 0",
      "v 0 1 0",
      "vt 0 0",
      "vt 1 0",
      "vt 0 1",
      "f 1 2/2 3/3",
    ].join("\n");
    const result = await runWorker(obj);
    expect(Array.from(result.uvs ?? [])).toEqual([0, 0, 1, 0, 0, 1]);
  });

  it("负的 vt 索引换算成绝对索引", async () => {
    const obj = [
      "v 0 0 0",
      "v 1 0 0",
      "v 0 1 0",
      "vt 0 0",
      "vt 1 0",
      "vt 0 1",
      "f -3/-3 -2/-2 -1/-1",
    ].join("\n");
    const result = await runWorker(obj);
    expect(Array.from(result.uvs ?? [])).toEqual([0, 0, 1, 0, 0, 1]);
  });

  it("整个模型没有 vt → 不返回 uvs", async () => {
    const obj = ["v 0 0 0", "v 1 0 0", "v 0 1 0", "f 1 2 3"].join("\n");
    const result = await runWorker(obj);
    expect(result.uvs).toBeUndefined();
    expect(result.uvCount).toBe(0);
  });

  it("UV 数量 = 三角形数 × 6", async () => {
    const obj = [
      "v 0 0 0",
      "v 1 0 0",
      "v 0 1 0",
      "vt 0 0",
      "vt 1 0",
      "vt 0 1",
      "f 1/1 2/2 3/3",
      "f 1/1 2/2 3/3",
    ].join("\n");
    const result = await runWorker(obj);
    expect(result.uvs?.length).toBe(result.triangleCount * 6);
  });
});
