import { describe, expect, it } from "vitest";

/**
 * OBJ / MTL 材质与贴图解析的纯函数测试。
 *
 * ## 为什么这个值得测
 *
 * 「模型预览白模 / 贴图错乱」这类问题的根因几乎全在这一层:
 *
 *   1. MTL 里 `map_Kd` 的文件名解析不出来 → 材质挂不上贴图(白模)
 *   2. 文件名解析出来了但匹配到别的文件 → 贴图错乱
 *   3. 多 OBJ 合并时 `vt` 索引没偏移 → UV 采样到别的模型的坐标(贴图错乱)
 *
 * 这三件事都是纯计算,写反例比在浏览器里手动传包便宜得多。
 */

import {
  baseName,
  buildTextureUrlMap,
  combineObjSources,
  countObjIndices,
  matchMaterialTextures,
  mergeMtlTexts,
  parseMtl,
  parseMtllibNames,
  parseTextureFileName,
  parseUsemtlNames,
  pickMtlFileName,
  pickPreviewTextureUrl,
  resolveNegativeIndex,
  rewriteMtllib,
  rewriteMtlTextureRefs,
  rewriteTextureFileName,
  rewriteUsemtl,
} from "@/features/pricing/lib/obj-materials";

/** 造一个假的纹理 blob(createUrl 是注入的,测试里根本不看 blob) */
function fakeBlob(): Blob {
  return {} as Blob;
}

describe("baseName", () => {
  it("取路径最后一段", () => {
    expect(baseName("textures/wood.png")).toBe("wood.png");
  });

  it("兼容 Windows 的反斜杠", () => {
    expect(baseName("textures\\sub\\wood.png")).toBe("wood.png");
  });

  it("没有目录时原样返回", () => {
    expect(baseName("wood.png")).toBe("wood.png");
  });
});

describe("parseTextureFileName", () => {
  it("剥掉 -s 的三个参数", () => {
    expect(parseTextureFileName("-s 1 1 1 tex.png")).toBe("tex.png");
  });

  it("剥掉多个 option token", () => {
    expect(parseTextureFileName("-mm 0.5 1 -o 0 0 0 -s 2 2 2 tex.png")).toBe(
      "tex.png"
    );
  });

  it("剥掉 onoff 类 option", () => {
    expect(parseTextureFileName("-clamp on -blendu off tex.png")).toBe(
      "tex.png"
    );
  });

  it("裸的 onoff option(没有值)也照样剥掉", () => {
    expect(parseTextureFileName("-blendu tex.png")).toBe("tex.png");
  });

  it("剥掉外层引号", () => {
    expect(parseTextureFileName('"a b.png"')).toBe("a b.png");
  });

  it("文件名带空格时保留空格", () => {
    expect(parseTextureFileName("-s 1 1 1 wood grain.png")).toBe(
      "wood grain.png"
    );
  });

  it("没有 option 时原样返回", () => {
    expect(parseTextureFileName("tex.png")).toBe("tex.png");
  });
});

describe("rewriteTextureFileName", () => {
  it("保留 option token,只换文件名", () => {
    expect(rewriteTextureFileName("-s 1 1 1 tex.png", "flat.png")).toBe(
      "-s 1 1 1 flat.png"
    );
  });

  it("新名字带空格时加引号", () => {
    expect(rewriteTextureFileName("tex.png", "a b.png")).toBe('"a b.png"');
  });
});

describe("parseMtl", () => {
  const mtl = [
    "# 注释",
    "newmtl Wood",
    "Kd 0.8 0.6 0.4",
    "map_Kd -s 1 1 1 wood.png",
    "map_Ks wood_spec.png",
    "norm wood_norm.png",
    "newmtl Metal",
    "Kd 0.9 0.9 0.9",
    "map_Kd metal.png",
  ].join("\n");

  it("解析出多个材质", () => {
    const materials = parseMtl(mtl);
    expect(materials).toHaveLength(2);
    expect(materials[0]?.name).toBe("Wood");
    expect(materials[1]?.name).toBe("Metal");
  });

  it("解析 Kd 本色", () => {
    const materials = parseMtl(mtl);
    expect(materials[0]?.kd).toEqual([0.8, 0.6, 0.4]);
  });

  it("解析 map_Kd / map_Ks / norm", () => {
    const materials = parseMtl(mtl);
    expect(materials[0]?.mapKd).toBe("wood.png");
    expect(materials[0]?.mapKs).toBe("wood_spec.png");
    expect(materials[0]?.normalMap).toBe("wood_norm.png");
    expect(materials[1]?.mapKd).toBe("metal.png");
    expect(materials[1]?.mapKs).toBeUndefined();
  });

  it("材质没有 Kd 时 kd 是 undefined(白模的来源之一)", () => {
    const materials = parseMtl("newmtl Plain\nmap_Kd a.png\n");
    expect(materials[0]?.kd).toBeUndefined();
  });

  it("空文本 → 空列表", () => {
    expect(parseMtl("")).toEqual([]);
  });
});

describe("matchMaterialTextures", () => {
  const materials = parseMtl(
    ["newmtl Wood", "map_Kd wood.png", "newmtl Metal", "map_Kd metal.png"].join(
      "\n"
    )
  );

  it("basename 匹配(MTL 写 wood.png,包里在 textures/ 下)", () => {
    const matched = matchMaterialTextures(materials, [
      { name: "textures/wood.png", blob: fakeBlob() },
      { name: "textures/metal.png", blob: fakeBlob() },
    ]);
    expect(matched.Wood?.map).toBe("textures/wood.png");
    expect(matched.Metal?.map).toBe("textures/metal.png");
  });

  it("完整路径优先于 basename", () => {
    const matched = matchMaterialTextures(materials, [
      { name: "wood.png", blob: fakeBlob() },
      { name: "textures/wood.png", blob: fakeBlob() },
    ]);
    expect(matched.Wood?.map).toBe("wood.png");
  });

  it("匹配不上就**不挂贴图**,绝不拿别的图顶替", () => {
    const matched = matchMaterialTextures(materials, [
      { name: "textures/metal.png", blob: fakeBlob() },
    ]);
    expect(matched.Wood).toBeUndefined();
    // 关键:不能因为包里有一张图就把 Wood 指到它身上
    expect(matched.Wood?.map).toBeUndefined();
  });

  it("同名的不同路径按完整路径区分", () => {
    const matched = matchMaterialTextures(
      parseMtl("newmtl A\nmap_Kd a/wood.png\n"),
      [
        { name: "a/wood.png", blob: fakeBlob() },
        { name: "b/wood.png", blob: fakeBlob() },
      ]
    );
    expect(matched.A?.map).toBe("a/wood.png");
  });

  it("包里没有纹理 → 空结果", () => {
    expect(matchMaterialTextures(materials, [])).toEqual({});
  });
});

describe("buildTextureUrlMap / pickPreviewTextureUrl", () => {
  const materials = parseMtl(
    ["newmtl Wood", "map_Kd wood.png", "newmtl Metal", "map_Kd metal.png"].join(
      "\n"
    )
  );
  const textureBlobs = [
    { name: "wood.png", blob: fakeBlob() },
    { name: "metal.png", blob: fakeBlob() },
  ];
  const matched = matchMaterialTextures(materials, textureBlobs);

  it("每个材质拿到自己的 URL", () => {
    const urls = buildTextureUrlMap(
      matched,
      textureBlobs,
      (b) => `blob:${b === textureBlobs[0]?.blob ? "wood" : "metal"}`
    );
    expect(urls.Wood?.map).toBe("blob:wood");
    expect(urls.Metal?.map).toBe("blob:metal");
  });

  it("同一个文件被多个材质引用时只建一次 URL", () => {
    let count = 0;
    const urls = buildTextureUrlMap(
      {
        A: { map: "wood.png" },
        B: { map: "wood.png" },
      },
      textureBlobs,
      () => {
        count += 1;
        return "blob:x";
      }
    );
    expect(count).toBe(1);
    expect(urls.A?.map).toBe("blob:x");
    expect(urls.B?.map).toBe("blob:x");
  });

  it("缩略图取第一个有 base color 贴图的材质", () => {
    const urls = buildTextureUrlMap(
      matched,
      textureBlobs,
      (b) => `blob:${b === textureBlobs[0]?.blob ? "wood" : "metal"}`
    );
    expect(pickPreviewTextureUrl(materials, urls)).toBe("blob:wood");
  });

  it("没有材质贴图时返回 undefined(不拿别的图糊上去)", () => {
    expect(pickPreviewTextureUrl(materials, {})).toBeUndefined();
  });
});

describe("parseMtllibNames / parseUsemtlNames", () => {
  it("取出 mtllib 声明", () => {
    const obj = "mtllib model.mtl\nv 0 0 0\n";
    expect(parseMtllibNames(obj)).toEqual(["model.mtl"]);
  });

  it("mtllib 一行多个文件名", () => {
    const obj = "mtllib a.mtl b.mtl\n";
    expect(parseMtllibNames(obj)).toEqual(["a.mtl", "b.mtl"]);
  });

  it("取出 usemtl 声明(去重、保序)", () => {
    const obj = "usemtl A\nusemtl B\nusemtl A\n";
    expect(parseUsemtlNames(obj)).toEqual(["A", "B"]);
  });
});

describe("pickMtlFileName", () => {
  it("按 mtllib 命中", () => {
    expect(pickMtlFileName(["model.mtl"], ["other.mtl", "model.mtl"])).toBe(
      "model.mtl"
    );
  });

  it("mtllib 带目录也能命中(按 basename 比)", () => {
    expect(pickMtlFileName(["mtls/model.mtl"], ["model.mtl"])).toBe(
      "model.mtl"
    );
  });

  it("mtllib 没命中 → 退回第一个候选", () => {
    expect(pickMtlFileName(["nope.mtl"], ["a.mtl", "b.mtl"])).toBe("a.mtl");
  });

  it("没有候选 → undefined", () => {
    expect(pickMtlFileName(["a.mtl"], [])).toBeUndefined();
  });
});

describe("mergeMtlTexts", () => {
  it("材质撞名 → 加 _1 后缀", () => {
    const merged = mergeMtlTexts([
      { mtlText: "newmtl Material\nKd 1 0 0\n" },
      { mtlText: "newmtl Material\nKd 0 1 0\n" },
    ]);
    expect(merged.renameByFile[0]?.get("Material")).toBe("Material");
    expect(merged.renameByFile[1]?.get("Material")).toBe("Material_1");
    expect(merged.mtlText).toContain("newmtl Material_1");
  });

  it("OBJ 引用了但 MTL 没声明的材质也要占位改名", () => {
    const merged = mergeMtlTexts([
      { mtlText: "newmtl A\nKd 1 1 1\n", usemtlNames: ["A"] },
      { mtlText: "", usemtlNames: ["A"] },
    ]);
    expect(merged.renameByFile[1]?.get("A")).toBe("A_1");
  });

  it("贴图指令原样搬运", () => {
    const merged = mergeMtlTexts([
      { mtlText: "newmtl A\nmap_Kd wood.png\n" },
      { mtlText: "newmtl B\nmap_Kd metal.png\n" },
    ]);
    expect(merged.mtlText).toContain("map_Kd wood.png");
    expect(merged.mtlText).toContain("map_Kd metal.png");
  });
});

describe("resolveNegativeIndex", () => {
  it("负下标按「到该行为止的数量」换算成 0 基绝对下标", () => {
    // 已经写了 3 个 → -3 指的是「刚写的那 3 个里的第 1 个」
    expect(resolveNegativeIndex(-3, 3)).toBe(0);
    expect(resolveNegativeIndex(-2, 3)).toBe(1);
    expect(resolveNegativeIndex(-1, 3)).toBe(2);
    // 已经写了 6 个 → -3 指的是第 4 个
    expect(resolveNegativeIndex(-3, 6)).toBe(3);
  });

  it("常规文件里「到该行为止」==「整个文件」→ 与按规范解析一致", () => {
    expect(resolveNegativeIndex(-3, 10)).toBe(7);
  });
});

describe("countObjIndices", () => {
  it("分别统计 v 与 vt", () => {
    const obj = "v 0 0 0\nv 1 0 0\nvt 0 0\nvt 1 1\nf 1/1 2/2 1/1\n";
    expect(countObjIndices(obj)).toEqual({ vertices: 2, uvs: 2 });
  });

  it("不把 vn / f 算进去", () => {
    const obj = "v 0 0 0\nvn 0 0 1\nf 1 1 1\n";
    expect(countObjIndices(obj)).toEqual({ vertices: 1, uvs: 0 });
  });
});

describe("combineObjSources", () => {
  const sourceA = [
    "v 0 0 0",
    "v 1 0 0",
    "v 0 1 0",
    "vt 0 0",
    "vt 1 0",
    "vt 0 1",
    "usemtl Wood",
    "f 1/1 2/2 3/3",
  ].join("\n");
  const sourceB = [
    "v 0 0 0",
    "v 1 0 0",
    "v 0 1 0",
    "vt 0 0",
    "vt 1 0",
    "vt 0 1",
    "usemtl Metal",
    "f 1/1 2/2 3/3",
  ].join("\n");

  it("**vt 索引也必须偏移** —— 只偏移 v 会让 UV 采样到别的模型", () => {
    const combined = combineObjSources([
      { objText: sourceA, mtlFileName: "model.mtl", mtlText: "newmtl Wood\n" },
      { objText: sourceB, mtlFileName: "model.mtl", mtlText: "newmtl Metal\n" },
    ]);
    // 第二个 OBJ 的 3 个顶点 / 3 个 UV 都要往后挪
    expect(combined.objText).toContain("f 4/4 5/5 6/6");
  });

  it("顶点索引同样偏移", () => {
    const combined = combineObjSources([
      { objText: sourceA },
      { objText: sourceB },
    ]);
    expect(combined.objText).toContain("f 4/4 5/5 6/6");
  });

  it("负索引换算成绝对索引", () => {
    const negative =
      "v 0 0 0\nv 1 0 0\nv 0 1 0\nvt 0 0\nvt 1 0\nvt 0 1\nf -3/-3 -2/-2 -1/-1";
    const combined = combineObjSources([
      { objText: sourceA },
      { objText: negative },
    ]);
    // offset(3) + count(3) + (-3) + 1 = 4
    expect(combined.objText).toContain("f 4/4 5/5 6/6");
  });

  /**
   * 流式 OBJ(3ds Max 写法)合并时的负下标换算。
   *
   * 每个面自带一组 vt,面里用 `-3 -2 -1` 引用「刚写的那几个」。
   * 合并时要把负下标烘成绝对下标 —— 基准必须是**这个文件自己写到该行为止**的
   * vt 数量,而不是整个文件的 vt 总数,否则每个面都会指向同一组 vt
   * (贴图糊成一块纯色)。
   */
  it("流式 OBJ 合并:每个面的 vt 组各自换算,不会全指向同一组", () => {
    const streaming = [
      "v 0 0 0",
      "v 1 0 0",
      "v 0 1 0",
      "vt 0 0",
      "vt 1 0",
      "vt 0 1",
      "f -3/-3 -2/-2 -1/-1",
      "vt 0.5 0.5",
      "vt 0.75 0.5",
      "vt 0.75 0.75",
      "f -3/-3 -2/-2 -1/-1",
    ].join("\n");
    const combined = combineObjSources([
      { objText: sourceA },
      { objText: streaming },
    ]);
    // 第一组 vt → 绝对 4/5/6(前面已有 sourceA 的 3 个)
    expect(combined.objText).toContain("f 4/4 5/5 6/6");
    // 第二组 vt → 绝对 7/8/9;顶点还是那 3 个 → 4/5/6
    expect(combined.objText).toContain("f 4/7 5/8 6/9");
  });

  it("共用同一个 MTL 时材质名保持原样", () => {
    const combined = combineObjSources([
      { objText: sourceA, mtlFileName: "model.mtl", mtlText: "newmtl Wood\n" },
      { objText: sourceB, mtlFileName: "model.mtl", mtlText: "newmtl Metal\n" },
    ]);
    expect(combined.objText).toContain("usemtl Wood");
    expect(combined.objText).toContain("usemtl Metal");
    expect(combined.mtlText).not.toContain("Wood_1");
  });

  it("各自带不同 MTL 时撞名加后缀且 usemtl 同步改名", () => {
    const objA = sourceA.replace("usemtl Wood", "usemtl Material");
    const objB = sourceB.replace("usemtl Metal", "usemtl Material");
    const combined = combineObjSources([
      {
        objText: objA,
        mtlFileName: "a.mtl",
        mtlText: "newmtl Material\nmap_Kd wood.png\n",
      },
      {
        objText: objB,
        mtlFileName: "b.mtl",
        mtlText: "newmtl Material\nmap_Kd metal.png\n",
      },
    ]);
    expect(combined.objText).toContain("usemtl Material_1");
    expect(combined.mtlText).toContain("newmtl Material_1");
    expect(combined.mtlText).toContain("map_Kd metal.png");
  });

  it("mtllib 统一改写成合并后的 MTL 名", () => {
    const withLib = `mtllib ${"orig.mtl"}\n${sourceA}`;
    const combined = combineObjSources([
      { objText: withLib, mtlFileName: "orig.mtl", mtlText: "newmtl Wood\n" },
    ]);
    expect(combined.objText).toContain("mtllib orig.mtl");
    expect(combined.mtlFileName).toBe("orig.mtl");
  });
});

describe("rewriteUsemtl / rewriteMtllib", () => {
  it("按改名表改写 usemtl", () => {
    const obj = "usemtl Wood\nusemtl Metal\n";
    const renamed = rewriteUsemtl(
      obj,
      new Map([
        ["Wood", "Wood"],
        ["Metal", "Metal_1"],
      ])
    );
    expect(renamed).toContain("usemtl Wood\n");
    expect(renamed).toContain("usemtl Metal_1");
  });

  it("改写所有 mtllib 行", () => {
    const obj = "mtllib a.mtl\nmtllib b.mtl\n";
    expect(rewriteMtllib(obj, "merged.mtl")).toBe(
      "mtllib merged.mtl\nmtllib merged.mtl\n"
    );
  });
});

describe("rewriteMtlTextureRefs", () => {
  it("把 map_Kd 改成平铺后的名字", () => {
    const mtl = "newmtl Wood\nmap_Kd textures/wood.png\n";
    const out = rewriteMtlTextureRefs(mtl, () => "wood.png");
    expect(out).toContain("map_Kd wood.png");
  });

  it("保留 option token", () => {
    const mtl = "newmtl Wood\nmap_Kd -s 1 1 1 wood.png\n";
    const out = rewriteMtlTextureRefs(mtl, () => "flat.png");
    expect(out).toContain("map_Kd -s 1 1 1 flat.png");
  });

  it("norm 指令也改写", () => {
    const mtl = "newmtl Wood\nnorm wood_n.png\n";
    const out = rewriteMtlTextureRefs(mtl, () => "flat_n.png");
    expect(out).toContain("norm flat_n.png");
  });

  it("解析不到的文件保持原样(绝不乱指)", () => {
    const mtl = "newmtl Wood\nmap_Kd missing.png\n";
    const out = rewriteMtlTextureRefs(mtl, () => undefined);
    expect(out).toContain("map_Kd missing.png");
  });

  it("非贴图指令不受影响", () => {
    const mtl = "newmtl Wood\nKd 0.8 0.6 0.4\n";
    expect(rewriteMtlTextureRefs(mtl, () => "x.png")).toBe(mtl);
  });

  it("注释行不受影响", () => {
    const mtl = "# map_Kd wood.png\n";
    expect(rewriteMtlTextureRefs(mtl, () => "x.png")).toBe(mtl);
  });
});
