"use client";

import {
  type DragEvent,
  type DragEventHandler,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/**
 * 拖文件进页面 —— **一份口径**
 *
 * 三个地方用同一套拖放:模型检查工具的 3D 视口、克重工具的上传卡、批量模式
 * 的空状态卡。它们以前各写一遍 `onDragOver` → true / `onDragLeave` → false,
 * 那个写法**会闪**。
 *
 * ## 为什么会闪
 *
 * ```
 * dragover → 高亮/遮罩出现 → 指针落在**它自己**身上
 *          → dragleave 从它冒到容器 → 高亮消失 → 又 dragover → 又出现 ……
 * ```
 *
 * 遮罩(或高亮边框)是拖放区的**子元素**,它盖在指针下面,就成了事件目标;
 * `dragleave` 冒泡到容器 → 容器把高亮撤掉 → 遮罩没了 → 指针落回下面的
 * canvas → `dragover` 又来 → 遮罩再出现。**一直闪**。
 *
 * 就算遮罩不挡指针,`dragleave` 在指针从容器移到**子元素**(视口里的 canvas)
 * 时也会冒泡上来 —— 容器里的高亮照样跟着闪。
 *
 * ## 这里的做法
 *
 * - **进出配对计数** —— `dragenter` +1 / `dragleave` −1,**归零才撤高亮**。
 *   在子元素之间来回移动时深度始终 > 0,状态不翻。
 * - **`dragover` 只 preventDefault** —— 不撤状态。不 `preventDefault` 的话
 *   浏览器不让放,文件根本进不来;撤状态这件事交给计数。
 * - **`dragend` / 窗口级 `drop` 兜底** —— 拖拽被 Esc 取消、或者文件被丢在
 *   容器外面时把计数清零(否则高亮会**粘**在屏幕上)。
 *
 * ## 遮罩还要加 `pointer-events-none`
 *
 * 计数解决了「子元素之间移动」,但遮罩盖在指针下面时它**仍然是**事件目标 ——
 * 浏览器会把它当成新的 dragenter / dragleave 的起点。所以凡是做遮罩的地方,
 * 那一层都得加 `pointer-events-none`(它只是给人看的,不吃事件)。
 *
 * 用法:
 *
 * ```tsx
 * const { isDragOver, dropHandlers } = useDropZone<HTMLDivElement>((files) => {
 *   void loadFile(files[0]);
 * });
 *
 * <div {...dropHandlers}>
 *   {isDragOver && <div className="pointer-events-none absolute inset-0" />}
 * </div>
 * ```
 */

/** 拖放区上的四个事件 —— 展开到容器元素上就行 */
export interface DropZoneHandlers<T extends HTMLElement> {
  onDragEnter: DragEventHandler<T>;
  onDragOver: DragEventHandler<T>;
  onDragLeave: DragEventHandler<T>;
  onDrop: DragEventHandler<T>;
}

export interface DropZone<T extends HTMLElement> {
  /** 指针在容器里 —— 用来摆高亮 / 遮罩 */
  isDragOver: boolean;
  /** 展开到容器元素上 */
  dropHandlers: DropZoneHandlers<T>;
}

export function useDropZone<T extends HTMLElement = HTMLDivElement>(
  /** 落下来的文件(可能不止一个 —— 批量模式一次拖多个) */
  onFiles: (files: File[]) => void
): DropZone<T> {
  const [isDragOver, setIsDragOver] = useState(false);
  /** 拖拽深度 —— 进入任何一层 +1,离开一层 −1 */
  const depthRef = useRef(0);

  const reset = useCallback(() => {
    depthRef.current = 0;
    setIsDragOver(false);
  }, []);

  // 拖拽被取消(按 Esc)/ 文件落在容器外 —— 兜底清零,不然高亮会粘住
  useEffect(() => {
    const onDragEnd = () => reset();
    const onWindowDrop = () => reset();
    window.addEventListener("dragend", onDragEnd);
    window.addEventListener("drop", onWindowDrop);
    return () => {
      window.removeEventListener("dragend", onDragEnd);
      window.removeEventListener("drop", onWindowDrop);
    };
  }, [reset]);

  const dropHandlers = useMemo<DropZoneHandlers<T>>(
    () => ({
      onDragEnter: (e: DragEvent<T>) => {
        e.preventDefault();
        depthRef.current += 1;
        setIsDragOver(true);
      },
      onDragOver: (e: DragEvent<T>) => {
        // 不 preventDefault 的话浏览器不让放 —— 文件根本进不来
        e.preventDefault();
        // 不设的话拖过去显示的是「禁止」光标
        if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      },
      onDragLeave: (_e: DragEvent<T>) => {
        // 离开一层减一;归零才撤高亮 —— 在子元素之间移动时不会闪
        depthRef.current = Math.max(0, depthRef.current - 1);
        if (depthRef.current === 0) setIsDragOver(false);
      },
      onDrop: (e: DragEvent<T>) => {
        e.preventDefault();
        depthRef.current = 0;
        setIsDragOver(false);
        const files = Array.from(e.dataTransfer?.files ?? []);
        if (files.length > 0) onFiles(files);
      },
    }),
    [onFiles]
  );

  return { isDragOver, dropHandlers };
}
