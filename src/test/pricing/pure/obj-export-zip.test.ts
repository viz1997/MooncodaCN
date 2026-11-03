import JSZip from "jszip";
import { describe, expect, it } from "vitest";

/**
 * 导出 zip 的贴图引用测试。
 *
 * ## 为什么这个值得测
 *
 * 工作室拿到的 zip 解压出来必须能直接打开 —— OBJ 里的 `mtllib` 要指向
 * 真正存在的 MTL,MTL 里的 `map_Kd` 要指向真正存在的贴图文件。
 *
 * 之前纹理按**压缩包里的原始路径**写入(`textures/wood.png`),
 * 而 MTL 里写的是相对文件名(`wood.png`)—— 解压出来引用直接断掉,
 * 工作室那边看到的就是「白模」。这个测试守住「解压后引用仍然对得上」。
 */

import { buildModelZipBlob } from "@/features/pricing/lib/obj-exporter";
import { parseMtl } from "@/features/pricing/lib/obj-materials";

/** 造一个带内容的假贴图 */
function fakeTexture(text: string): Blob {
  return new Blob([text], { type: "image/png" });
}

describe("buildModelZipBlob", () => {
  it("MTL 的 map_Kd 指向的贴图文件必须在包里存在", async () => {
    const objText = [
      "mtllib model.mtl",
      "usemtl Wood",
      "v 0 0 0",
      "v 1 0 0",
      "v 0 1 0",
      "f 1 2 3",
    ].join("\n");
    const mtlText = ["newmtl Wood", "Kd 0.8 0.6 0.4", "map_Kd wood.png"].join(
      "\n"
    );
    // 贴图在压缩包里是带目录的 —— MTL 写的却是文件名
    const textureBlobs = [
      { name: "textures/wood.png", blob: fakeTexture("a") },
    ];

    const zipBlob = await buildModelZipBlob(
      objText,
      mtlText,
      textureBlobs,
      "model.obj",
      "model.mtl"
    );
    const zip = await JSZip.loadAsync(await zipBlob.arrayBuffer());
    const entries = Object.keys(zip.files);

    // 纹理被平铺到根目录
    expect(entries).toContain("wood.png");

    // MTL 里的引用被同步改写成平铺后的名字
    const mtl = await zip.file("model.mtl")?.async("text");
    expect(mtl).toContain("map_Kd wood.png");

    // 引用指向的文件真的在包里
    const referenced = (mtl ?? "")
      .split("\n")
      .filter((l) => l.trim().toLowerCase().startsWith("map_kd "))
      .map((l) => l.trim().split(/\s+/).pop() ?? "");
    expect(referenced.length).toBeGreaterThan(0);
    for (const name of referenced) {
      expect(entries).toContain(name);
    }
  });

  it("OBJ 的 mtllib 指向的 MTL 必须在包里存在", async () => {
    const objText = ["mtllib model.mtl", "v 0 0 0"].join("\n");
    const mtlText = ["newmtl Wood", "Kd 1 1 1"].join("\n");

    const zipBlob = await buildModelZipBlob(
      objText,
      mtlText,
      [{ name: "wood.png", blob: fakeTexture("a") }],
      "model.obj",
      "model.mtl"
    );
    const zip = await JSZip.loadAsync(await zipBlob.arrayBuffer());
    const entries = Object.keys(zip.files);

    const obj = await zip.file("model.obj")?.async("text");
    const mtlName = obj
      ?.split("\n")
      .find((l) => l.trim().toLowerCase().startsWith("mtllib "))
      ?.trim()
      .split(/\s+/)
      .pop();
    expect(mtlName).toBeTruthy();
    expect(entries).toContain(mtlName);
  });

  it("同名贴图(不同目录)加序号后缀,互不覆盖", async () => {
    const objText = ["mtllib model.mtl", "v 0 0 0"].join("\n");
    const mtlText = [
      "newmtl A",
      "map_Kd a/wood.png",
      "newmtl B",
      "map_Kd b/wood.png",
    ].join("\n");
    const textureBlobs = [
      { name: "a/wood.png", blob: fakeTexture("a") },
      { name: "b/wood.png", blob: fakeTexture("b") },
    ];

    const zipBlob = await buildModelZipBlob(
      objText,
      mtlText,
      textureBlobs,
      "model.obj",
      "model.mtl"
    );
    const zip = await JSZip.loadAsync(await zipBlob.arrayBuffer());
    const entries = Object.keys(zip.files);

    // 两个贴图都在,而且名字不同
    const woodEntries = entries.filter((e) => e.startsWith("wood"));
    expect(woodEntries.length).toBe(2);

    // MTL 里两个材质的引用指向不同的文件
    const mtl = await zip.file("model.mtl")?.async("text");
    const refs = parseMtl(mtl ?? "")
      .map((m) => m.mapKd)
      .filter((v): v is string => Boolean(v));
    expect(new Set(refs).size).toBe(2);
    for (const ref of refs) {
      expect(entries).toContain(ref);
    }
  });

  it("option token 保留,文件名被改写", async () => {
    const objText = ["mtllib model.mtl", "v 0 0 0"].join("\n");
    const mtlText = ["newmtl Wood", "map_Kd -s 1 1 1 textures/wood.png"].join(
      "\n"
    );

    const zipBlob = await buildModelZipBlob(
      objText,
      mtlText,
      [{ name: "textures/wood.png", blob: fakeTexture("a") }],
      "model.obj",
      "model.mtl"
    );
    const zip = await JSZip.loadAsync(await zipBlob.arrayBuffer());
    const mtl = await zip.file("model.mtl")?.async("text");
    expect(mtl).toContain("map_Kd -s 1 1 1 wood.png");
  });

  it("没有 MTL 时只写 OBJ 和贴图", async () => {
    const zipBlob = await buildModelZipBlob(
      "v 0 0 0\n",
      undefined,
      [{ name: "wood.png", blob: fakeTexture("a") }],
      "model.obj",
      undefined
    );
    const zip = await JSZip.loadAsync(await zipBlob.arrayBuffer());
    const entries = Object.keys(zip.files);
    expect(entries).toContain("model.obj");
    expect(entries).toContain("wood.png");
    expect(entries.filter((e) => e.endsWith(".mtl"))).toHaveLength(0);
  });

  it("OBJ 条目名统一成 .obj(STL / GLB 上传也是 .obj)", async () => {
    const zipBlob = await buildModelZipBlob(
      "v 0 0 0\n",
      undefined,
      undefined,
      "model.stl",
      undefined
    );
    const zip = await JSZip.loadAsync(await zipBlob.arrayBuffer());
    expect(Object.keys(zip.files)).toContain("model.obj");
  });

  it("合并模型(没有扩展名的显示名)也能落地成 .obj", async () => {
    const zipBlob = await buildModelZipBlob(
      "v 0 0 0\n",
      undefined,
      undefined,
      "3 个 OBJ 合并",
      undefined
    );
    const zip = await JSZip.loadAsync(await zipBlob.arrayBuffer());
    expect(Object.keys(zip.files)).toContain("3 个 OBJ 合并.obj");
  });
});
