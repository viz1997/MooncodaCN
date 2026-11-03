import JSZip from "jszip";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * 真实打包方式的贴图解析测试 —— 走完整的 `extractZip()` 管线。
 *
 * ## 为什么值得测
 *
 * 「模型预览白模」的原因很少是「代码写错了」,更多是**包里的文件摆法**
 * 跟开发者想的不一样:MTL 写在子目录、贴图用了别的扩展名、文件名带 URL 转义、
 * `usemtl` 的大小写跟 `newmtl` 对不上……
 *
 * 每一种摆法都要单独配一次,配错一次就是一次「白模」工单。
 * 这里把常见摆法逐个钉死 —— 每种摆法都必须解析出贴图。
 */

import { WORKER_SOURCE } from "@/features/pricing/lib/obj-worker-client";
import {
  extractZip,
  type ModelFile,
} from "@/features/pricing/lib/zip-extractor";

/** 在进程内跑 worker 源码的假 Worker(Node 里没有真正的 Web Worker) */
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

/** 把若干文件打成一个 zip */
async function makeZip(files: Record<string, string | Blob>): Promise<File> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) {
    zip.file(name, content);
  }
  const blob = await zip.generateAsync({ type: "blob" });
  return new File([blob], "model.zip", { type: "application/zip" });
}

/** 一个三角形的顶点 + UV */
const BODY = [
  "v 0 0 0",
  "v 1 0 0",
  "v 0 1 0",
  "vt 0 0",
  "vt 1 0",
  "vt 0 1",
].join("\n");

/** OBJ 里声明的材质槽位(没有 usemtl 时退回 MTL 的第一个材质) */
function slots(model: ModelFile): string[] {
  const names = new Set<string>();
  for (const line of model.objText.split(/\r?\n/)) {
    const t = line.trim();
    if (/^usemtl\s/i.test(t)) names.add(t.slice(t.indexOf(" ") + 1).trim());
  }
  if (names.size > 0) return [...names];
  const first = (model.mtlText ?? "")
    .split(/\r?\n/)
    .find((l) => /^newmtl\s/i.test(l.trim()))
    ?.trim()
    .split(/\s+/)[1];
  return first ? [first] : [];
}

/** 某个槽位有没有解析到 base color 贴图 */
function hasTexture(model: ModelFile, slot: string): boolean {
  return Boolean(model.textureUrls?.[slot]?.map);
}

/** 跑一遍解压,断言「这个槽位解析出贴图了」 */
async function expectTexture(
  files: Record<string, string | Blob>,
  slot: string
): Promise<ModelFile> {
  const result = await extractZip(await makeZip(files));
  expect(result.error).toBeUndefined();
  const model = result.model;
  expect(model).not.toBeNull();
  expect(hasTexture(model!, slot)).toBe(true);
  return model!;
}

describe("压缩包布局:各种摆法都要解析出贴图", () => {
  it("1 根目录 obj + mtl + png", async () => {
    await expectTexture(
      {
        "model.obj": `mtllib model.mtl\nusemtl Wood\n${BODY}\nf 1/1 2/2 3/3\n`,
        "model.mtl": "newmtl Wood\nKd 1 1 1\nmap_Kd wood.png\n",
        "wood.png": png("w"),
      },
      "Wood"
    );
  });

  it("2 usemtl 的大小写跟 newmtl 不一致", async () => {
    await expectTexture(
      {
        "model.obj": `mtllib model.mtl\nusemtl wood\n${BODY}\nf 1/1 2/2 3/3\n`,
        "model.mtl": "newmtl Wood\nKd 1 1 1\nmap_Kd wood.png\n",
        "wood.png": png("w"),
      },
      "wood"
    );
  });

  it("3 usemtl 的名字跟 newmtl 差一个副本序号(.001)", async () => {
    await expectTexture(
      {
        "model.obj": `mtllib model.mtl\nusemtl Material\n${BODY}\nf 1/1 2/2 3/3\n`,
        "model.mtl": "newmtl Material.001\nKd 1 1 1\nmap_Kd wood.png\n",
        "wood.png": png("w"),
      },
      "Material"
    );
  });

  it("4 map_Kd 写了目录,包里是平铺的", async () => {
    await expectTexture(
      {
        "model.obj": `mtllib model.mtl\nusemtl Wood\n${BODY}\nf 1/1 2/2 3/3\n`,
        "model.mtl": "newmtl Wood\nKd 1 1 1\nmap_Kd textures/wood.png\n",
        "wood.png": png("w"),
      },
      "Wood"
    );
  });

  it("5 map_Kd 的扩展名跟包里不一样(.tga vs .png)", async () => {
    await expectTexture(
      {
        "model.obj": `mtllib model.mtl\nusemtl Wood\n${BODY}\nf 1/1 2/2 3/3\n`,
        "model.mtl": "newmtl Wood\nKd 1 1 1\nmap_Kd wood.tga\n",
        "wood.png": png("w"),
      },
      "Wood"
    );
  });

  it("6 obj / mtl / png 全在子目录", async () => {
    await expectTexture(
      {
        "model/model.obj": `mtllib model.mtl\nusemtl Wood\n${BODY}\nf 1/1 2/2 3/3\n`,
        "model/model.mtl": "newmtl Wood\nKd 1 1 1\nmap_Kd wood.png\n",
        "model/wood.png": png("w"),
      },
      "Wood"
    );
  });

  it("7 OBJ 完全没有 usemtl → 用 MTL 的第一个材质", async () => {
    await expectTexture(
      {
        "model.obj": `mtllib model.mtl\n${BODY}\nf 1/1 2/2 3/3\n`,
        "model.mtl": "newmtl Wood\nKd 1 1 1\nmap_Kd wood.png\n",
        "wood.png": png("w"),
      },
      "Wood"
    );
  });

  it("8 map_Kd 的文件名带 URL 转义的空格", async () => {
    await expectTexture(
      {
        "model.obj": `mtllib model.mtl\nusemtl Wood\n${BODY}\nf 1/1 2/2 3/3\n`,
        "model.mtl": "newmtl Wood\nKd 1 1 1\nmap_Kd wood%20grain.png\n",
        "wood grain.png": png("w"),
      },
      "Wood"
    );
  });

  it("9 newmtl 的名字带尾随空格", async () => {
    await expectTexture(
      {
        "model.obj": `mtllib model.mtl\nusemtl Wood\n${BODY}\nf 1/1 2/2 3/3\n`,
        "model.mtl": "newmtl Wood \nKd 1 1 1\nmap_Kd wood.png\n",
        "wood.png": png("w"),
      },
      "Wood"
    );
  });

  it("10 mtllib 指的 MTL 不在包里 → 退回包里的另一个 MTL", async () => {
    await expectTexture(
      {
        "model.obj": `mtllib missing.mtl\nusemtl Wood\n${BODY}\nf 1/1 2/2 3/3\n`,
        "other.mtl": "newmtl Wood\nKd 1 1 1\nmap_Kd wood.png\n",
        "wood.png": png("w"),
      },
      "Wood"
    );
  });

  it("11 map_Kd 带 ./ 前缀", async () => {
    await expectTexture(
      {
        "model.obj": `mtllib model.mtl\nusemtl Wood\n${BODY}\nf 1/1 2/2 3/3\n`,
        "model.mtl": "newmtl Wood\nKd 1 1 1\nmap_Kd ./wood.png\n",
        "wood.png": png("w"),
      },
      "Wood"
    );
  });

  it("12 MTL 在根目录,贴图在子目录", async () => {
    await expectTexture(
      {
        "model.obj": `mtllib model.mtl\nusemtl Wood\n${BODY}\nf 1/1 2/2 3/3\n`,
        "model.mtl": "newmtl Wood\nKd 1 1 1\nmap_Kd tex/wood.png\n",
        "tex/wood.png": png("w"),
      },
      "Wood"
    );
  });
});

describe("一个材质没贴图,不能拖累其他材质", () => {
  const TWO_MATERIAL_OBJ = [
    "mtllib model.mtl",
    "v 0 0 0",
    "v 1 0 0",
    "v 0 1 0",
    "vt 0 0",
    "vt 1 0",
    "vt 0 1",
    "usemtl Plain",
    "f 1/1 2/2 3/3",
    "usemtl Wood",
    "f 1/1 2/2 3/3",
  ].join("\n");

  /** Plain 压根没写贴图指令(它本来就不该有贴图) */
  const TWO_MATERIAL_MTL = [
    "newmtl Plain",
    "Kd 1 1 1",
    "newmtl Wood",
    "Kd 0.8 0.6 0.4",
    "map_Kd wood.png",
  ].join("\n");

  it("MTL 里没写 map_Kd 的材质不挂贴图,其他材质照常挂", async () => {
    const result = await extractZip(
      await makeZip({
        "model.obj": TWO_MATERIAL_OBJ,
        "model.mtl": TWO_MATERIAL_MTL,
        "wood.png": png("w"),
      })
    );
    const model = result.model!;

    // 材质槽位 = OBJ 里 usemtl 的首次出现顺序
    expect(slots(model)).toEqual(["Plain", "Wood"]);
    // Plain 没有贴图指令 → 不挂贴图
    expect(hasTexture(model, "Plain")).toBe(false);
    // Wood 照常挂自己的贴图 —— 不能被 Plain 拖累
    expect(hasTexture(model, "Wood")).toBe(true);
  });

  it("诊断要说清楚是「MTL 里没写贴图」,而不是「贴图丢了」", async () => {
    const result = await extractZip(
      await makeZip({
        "model.obj": TWO_MATERIAL_OBJ,
        "model.mtl": TWO_MATERIAL_MTL,
        "wood.png": png("w"),
      })
    );
    const model = result.model!;
    const plain = model.textureDiagnostics?.find((d) => d.material === "Plain");
    expect(plain?.status).toBe("no-texture-in-mtl");
    const wood = model.textureDiagnostics?.find((d) => d.material === "Wood");
    expect(wood?.status).toBe("ok");
  });
});
