/**
 * 三角汤 → OBJ
 *
 * 守住三件事:
 *
 * 1. **顶点去重** —— 三角汤里每个顶点重复三遍,OBJ 里只写一行
 * 2. **面索引 1-based** —— OBJ 规范从 1 开始
 * 3. **不带 `vt` / `vn`** —— 布尔运算不保留 UV,硬塞一个旧的 `vt` 进去
 *    只会得到**错的**贴图
 */
import { describe, expect, it } from "vitest";
import {
  objBlobFromSoup,
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

describe("writeObjFromSoup", () => {
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

  it("**不带 vt / vn** —— 布尔运算不保留 UV,塞进去只会给出错的贴图", () => {
    const obj = writeObjFromSoup(soup());
    expect(obj).not.toContain("vt ");
    expect(obj).not.toContain("vn ");
    expect(obj).not.toContain("usemtl");
    expect(obj).not.toContain("mtllib");
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
