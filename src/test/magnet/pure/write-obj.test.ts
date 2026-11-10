/**
 * 三角汤 → OBJ
 *
 * 守住四件事:
 *
 * 1. **顶点去重** —— 三角汤里每个顶点重复三遍,OBJ 里只写一行
 * 2. **面索引 1-based** —— OBJ 规范从 1 开始
 * 3. **UV / 材质要写出来** —— 工作室 2026-11-11 提的「导出模型需要保留原来的
 *    材质贴图」:布尔运算**保得住** UV 和材质分组(Manifold3D 的属性通道),
 *    所以导出时必须写 `vt` / `usemtl` / `mtllib`,还要让 `f` 带贴图下标
 * 4. **面按材质分组** —— `usemtl` 是状态指令,面不分组的话会把后面别的材质
 *    的面也改了
 */
import { describe, expect, it } from "vitest";
import {
  objBlobFromSoup,
  sanitizeMaterialName,
  writeObjFromSoup,
} from "@/features/magnet/lib/write-obj";

/** 一个三角汤:两个三角形,共用一条边(共 4 个不同顶点) */
function soup(): Float32Array {
  return new Float32Array([
    // 三角形 1
    0, 0, 0, 1, 0, 0, 0, 1, 0,
    // 三角形 2
    1, 0, 0, 1, 1, 0, 0, 1, 0,
  ]);
}

/** 两个三角形的 UV(每三角形 6 个 float) */
function uvs(): Float32Array {
  return new Float32Array([0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1]);
}

describe("writeObjFromSoup —— 基础", () => {
  it("顶点去重 —— 4 个不同的顶点只写 4 行", () => {
    const obj = writeObjFromSoup(soup());
    const vLines = obj.split("\n").filter((l) => l.startsWith("v "));
    expect(vLines).toHaveLength(4);
  });

  it("面索引是 1-based", () => {
    const obj = writeObjFromSoup(soup());
    const fLines = obj.split("\n").filter((l) => l.startsWith("f "));
    expect(fLines).toHaveLength(2);
    expect(fLines[0]).toBe("f 1 2 3");
    // 第二个三角形:顶点 2、4、3
    expect(fLines[1]).toBe("f 2 4 3");
  });

  it("文件头注释每一行前面加 `# `", () => {
    const obj = writeObjFromSoup(soup(), {
      header: ["Mooncoda magnet pocket cutter", "hole_dia_mm=20.7"],
    });
    const lines = obj.split("\n");
    expect(lines[0]).toBe("# Mooncoda magnet pocket cutter");
    expect(lines[1]).toBe("# hole_dia_mm=20.7");
  });

  it("没有注释头就不留空行", () => {
    const obj = writeObjFromSoup(soup());
    expect(obj.startsWith("v ")).toBe(true);
  });

  it("小数点后 4 位,`-0` 归一化成 `0`", () => {
    const obj = writeObjFromSoup(
      new Float32Array([0, -0, 1.23456789, 0, 0, 0, 0, 0, 0])
    );
    expect(obj).toContain("v 0 0 1.2346");
    expect(obj).not.toContain("-0 ");
  });

  it("空输入 ⇒ 只有一个换行,不炸", () => {
    expect(writeObjFromSoup(new Float32Array(0))).toBe("\n");
  });

  it("blob 的类型是纯文本", () => {
    const blob = objBlobFromSoup(soup());
    expect(blob.type).toContain("text/plain");
  });
});

describe("writeObjFromSoup —— UV 保住", () => {
  it("有 UV ⇒ 写 `vt` 行", () => {
    const obj = writeObjFromSoup(soup(), { uvs: uvs() });
    const vtLines = obj.split("\n").filter((l) => l.startsWith("vt "));
    // 4 个不同的 (u,v) ⇒ 4 行
    expect(vtLines).toHaveLength(4);
    expect(obj).toContain("vt 0 0");
    expect(obj).toContain("vt 1 0");
  });

  it("有 UV ⇒ `f` 行带贴图下标 `v/vt`", () => {
    const obj = writeObjFromSoup(soup(), { uvs: uvs() });
    const fLines = obj.split("\n").filter((l) => l.startsWith("f "));
    expect(fLines[0]).toBe("f 1/1 2/2 3/3");
    expect(fLines[1]).toBe("f 2/2 4/4 3/3");
  });

  it("没有 UV ⇒ 不写 `vt`,`f` 行也不带斜杠", () => {
    const obj = writeObjFromSoup(soup());
    expect(obj).not.toContain("vt ");
    expect(obj).not.toContain("vn ");
    expect(obj).not.toContain("usemtl");
    expect(obj).not.toContain("mtllib");
    expect(obj).toContain("f 1 2 3");
  });

  it("UV 保留 6 位小数 —— 4 位在大贴图上会看出台阶", () => {
    const obj = writeObjFromSoup(soup(), {
      uvs: new Float32Array([0, 0, 0.123456789, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    });
    expect(obj).toContain("vt 0.123457 0");
  });
});

describe("writeObjFromSoup —— 材质分组", () => {
  it("给了 MTL 文件名 ⇒ 写 `mtllib` 行", () => {
    const obj = writeObjFromSoup(soup(), { mtlFileName: "relief_final.mtl" });
    expect(obj).toContain("mtllib relief_final.mtl");
  });

  it("没有 MTL 文件名 ⇒ 不写 `mtllib`", () => {
    const obj = writeObjFromSoup(soup());
    expect(obj).not.toContain("mtllib");
  });

  it("每个材质组前面一行 `usemtl`", () => {
    const obj = writeObjFromSoup(soup(), {
      materialIndex: new Uint16Array([0, 1]),
      materialNames: ["Body", "Accent"],
    });
    const useLines = obj.split("\n").filter((l) => l.startsWith("usemtl "));
    expect(useLines).toEqual(["usemtl Body", "usemtl Accent"]);
  });

  it("**面按材质分组,同一个材质的面是连续的**", () => {
    // 三个三角形:材质 0 / 1 / 0 —— 写出来的顺序必须是 0、0、1
    const soup3 = new Float32Array([
      0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 0,
      1, 1,
    ]);
    const obj = writeObjFromSoup(soup3, {
      materialIndex: new Uint16Array([0, 1, 0]),
      materialNames: ["A", "B"],
    });
    const lines = obj.split("\n");
    const firstUse = lines.findIndex((l) => l.startsWith("usemtl "));
    // 第一个 `usemtl` 后面紧跟两个三角形(材质 A 的 0 号和 2 号),然后才轮到 B
    const after = lines.slice(firstUse + 1).filter((l) => l.startsWith("f "));
    expect(after).toHaveLength(3);
    expect(lines[firstUse]).toBe("usemtl A");
    expect(lines[firstUse + 1]).toBe("f 1 2 3"); // 三角形 0
    expect(lines[firstUse + 2]).toBe("f 5 6 7"); // 三角形 2
    expect(lines[firstUse + 3]).toBe("usemtl B");
    expect(lines[firstUse + 4]).toBe("f 2 4 3"); // 三角形 1
  });

  it("材质名**原样保留**(含空格)—— 贴图要靠它跟 MTL 对上", () => {
    const obj = writeObjFromSoup(soup(), {
      materialIndex: new Uint16Array([0, 0]),
      materialNames: ["Body Paint"],
    });
    expect(obj).toContain("usemtl Body Paint");
  });

  it("没有材质信息 ⇒ 不写 `usemtl`", () => {
    const obj = writeObjFromSoup(soup(), {
      materialIndex: new Uint16Array([0, 0]),
      materialNames: null,
    });
    expect(obj).not.toContain("usemtl");
  });
});

describe("sanitizeMaterialName", () => {
  it("原样保留空格", () => {
    expect(sanitizeMaterialName("Body Paint", 0)).toBe("Body Paint");
  });

  it("清掉换行(换行会把一行写成两行)", () => {
    expect(sanitizeMaterialName("Bad\nName", 0)).toBe("Bad Name");
  });

  it("空名字 ⇒ 退化成 `material_<下标>`", () => {
    expect(sanitizeMaterialName("", 3)).toBe("material_3");
    expect(sanitizeMaterialName(undefined, 1)).toBe("material_1");
  });
});
