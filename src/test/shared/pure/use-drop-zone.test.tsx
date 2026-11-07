// @vitest-environment jsdom

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useDropZone } from "@/features/shared/hooks/use-drop-zone";

/**
 * 拖放区 —— **模型拖不进去的回归测试**(2026-11-07)
 *
 * ## 当时的故障
 *
 * 打印前工作台的「检查」视角拖不进去模型:指针一进视口,遮罩
 * **一闪一闪**,文件落下不来。
 *
 * 根因不在浏览器,在遮罩自己身上:
 *
 * ```
 * dragover → 遮罩出现 → 指针落在**它自己**身上
 *          → dragleave 从它冒到容器 → 容器把遮罩撤掉
 *          → 遮罩没了 → 又 dragover → 又出现 ……
 * ```
 *
 * ## 两条规矩,缺一不可
 *
 * 1. **进出配对计数** —— `dragenter` +1 / `dragleave` −1,归零才撤高亮。
 *    指针在容器和子元素之间来回移动时深度始终 > 0,高亮不翻。
 * 2. **遮罩加 `pointer-events-none`** —— 它盖在指针下面时**不能**是事件
 *    目标,不然浏览器会把它算成一次新的进入/离开,深度被算乱。
 *
 * 下面的 DOM 测试守住第 1 条;文件扫描守住第 2 条和「三个拖放区共用
 * 一份口径」。
 */

/** 一个最小的拖放区 —— 结构和真页面一样:容器 + 遮罩 + 子元素 */
function DropZone({ onFiles }: { onFiles: (files: File[]) => void }) {
  const { isDragOver, dropHandlers } = useDropZone<HTMLDivElement>(onFiles);
  return (
    <div {...dropHandlers} data-testid="zone">
      {isDragOver && (
        <div
          data-testid="overlay"
          className="pointer-events-none absolute inset-0 z-20"
        />
      )}
      <span data-testid="child">子元素</span>
    </div>
  );
}

function renderZone() {
  const onFiles = vi.fn<(files: File[]) => void>();
  render(<DropZone onFiles={onFiles} />);
  return {
    onFiles,
    zone: screen.getByTestId("zone"),
    child: screen.getByTestId("child"),
    overlay: () => screen.queryByTestId("overlay"),
  };
}

describe("拖放区 —— 高亮不闪", () => {
  it("指针进容器:高亮出现", () => {
    const { zone, overlay } = renderZone();

    fireEvent.dragEnter(zone);

    expect(overlay()).not.toBeNull();
  });

  it("指针从容器移到子元素上:高亮**不能**撤", () => {
    // 这一条是那个 bug 的核心。以前 `onDragLeave` 一律置 false,遮罩
    // 跟着闪 —— 深度计数就是为了把它按住在「> 0」。
    const { zone, child, overlay } = renderZone();

    fireEvent.dragEnter(zone);
    // 进入子元素:浏览器先给新目标发 dragenter,再给旧目标发 dragleave
    fireEvent.dragEnter(child);
    fireEvent.dragLeave(zone);

    expect(overlay()).not.toBeNull();
  });

  it("遮罩自己成了事件目标(它盖在指针下面):高亮也不能撤", () => {
    // 这一轮是「遮罩出现 → 指针落在遮罩上 → 遮罩撤掉」那个死循环。
    // 计数把它按住在「> 0」,循环自己就断了。
    const { zone, overlay } = renderZone();

    fireEvent.dragEnter(zone);
    const mask = overlay();
    expect(mask).not.toBeNull();
    fireEvent.dragEnter(mask as HTMLElement);
    fireEvent.dragLeave(zone);

    expect(overlay()).not.toBeNull();
  });

  it("指针真的离开容器:高亮撤掉", () => {
    const { zone, overlay } = renderZone();

    fireEvent.dragEnter(zone);
    fireEvent.dragLeave(zone);

    expect(overlay()).toBeNull();
  });

  it("拖到一半按 Esc(dragend):高亮撤掉,不能粘在屏幕上", () => {
    const { zone, overlay } = renderZone();

    fireEvent.dragEnter(zone);
    fireEvent.dragEnd(window);

    expect(overlay()).toBeNull();
  });

  it("文件落在容器外面:高亮也撤掉", () => {
    const { zone, overlay } = renderZone();

    fireEvent.dragEnter(zone);
    fireEvent.drop(document.body, { dataTransfer: { files: [] } });

    expect(overlay()).toBeNull();
  });
});

describe("拖放区 —— 文件交出去", () => {
  it("落下文件:交出去,高亮同时撤掉", () => {
    const { zone, onFiles, overlay } = renderZone();
    const file = new File(["x"], "model.obj", { type: "text/plain" });

    fireEvent.dragEnter(zone);
    fireEvent.drop(zone, { dataTransfer: { files: [file] } });

    expect(onFiles).toHaveBeenCalledTimes(1);
    expect(onFiles.mock.calls[0]?.[0]).toEqual([file]);
    expect(overlay()).toBeNull();
  });

  it("落下多个文件:一次全交出去(批量模式靠这个)", () => {
    const { zone, onFiles } = renderZone();
    const a = new File(["a"], "a.obj");
    const b = new File(["b"], "b.obj");

    fireEvent.drop(zone, { dataTransfer: { files: [a, b] } });

    expect(onFiles.mock.calls[0]?.[0]).toEqual([a, b]);
  });

  it("没文件(拖的是文字):不交出去", () => {
    const { zone, onFiles } = renderZone();

    fireEvent.drop(zone, { dataTransfer: { files: [] } });

    expect(onFiles).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 文件扫描 —— 守住「一份口径」和「遮罩不吃事件」
// ---------------------------------------------------------------------------

/** 仓库根目录 */
const ROOT = resolve(process.cwd());

/** 要守规矩的两个功能目录(这两个工具共用模型文件的那条路) */
const SCANNED_DIRS = ["src/features/tools", "src/features/pricing"];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/** 把注释去掉 —— 注释里写着「以前是 onDragOver → true」不算违规 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*(\*|\/\/)/.test(line))
    .join("\n");
}

describe("拖放规矩 —— 三个拖放区共用一份口径", () => {
  const files = SCANNED_DIRS.flatMap((dir) => walk(join(ROOT, dir)));

  it("扫到了那三个拖放区", () => {
    // 少了说明目录改名了,这个测试就白跑了 —— 得改
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    const rel = relative(ROOT, file).replace(/\\/g, "/");

    it(`${rel}:不自己写拖放事件,一律用共享的 dropHandlers`, () => {
      const code = stripComments(readFileSync(file, "utf8"));
      // 自己写 onDragEnter= / onDragOver= / onDragLeave= / onDrop=
      // 就是又抄了一份「会闪」的写法
      const handWritten = code.match(
        /\bon(?:DragEnter|DragOver|DragLeave|Drop)\s*=/g
      );
      expect(handWritten).toBeNull();
    });

    it(`${rel}:拖放事件的来源只能是共享 hook`, () => {
      const code = stripComments(readFileSync(file, "utf8"));
      if (!/useDropZone/.test(code)) return; // 这个文件里没有拖放区
      expect(code).toContain("dropHandlers");
    });
  }
});

describe("拖放规矩 —— 遮罩不吃事件", () => {
  it("打印前工作台的拖放遮罩带 pointer-events-none", () => {
    // 2026-11-07:模型检查并进了克重工具,拖放区跟着「共用展示区域」搬到了
    // 工作台框架(`model-settings-panel.tsx`)—— 三个视角共用那一个展示区。
    const file = join(
      ROOT,
      "src/features/pricing/components/model-settings-panel.tsx"
    );
    const code = readFileSync(file, "utf8");

    // 盖在指针下面的每一层都得带 `pointer-events-none` —— 遮罩只是给人看的
    const overlayLines = code
      .split("\n")
      .filter((line) => line.includes("absolute inset-0"));

    expect(overlayLines.length).toBeGreaterThan(0);
    for (const line of overlayLines) {
      expect(line).toContain("pointer-events-none");
    }
  });
});
