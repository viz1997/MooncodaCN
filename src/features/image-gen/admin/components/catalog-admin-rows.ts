"use client";

/**
 * 后台目录字典的**读取器** —— 两个区块共用
 *
 * ## 为什么单独一个文件
 *
 * 「尺寸字典」和「配件变体」两块都要**同一份**字典(配件变体那块要拿配件清单
 * 来做下拉选项、要拿尺寸清单来做「适用尺寸」的多选)。两份各读一次 ⇒
 * 两处的清单可能不一样(一个刷新了、另一个没刷新)⇒ 工作室看着像「刚加的配件
 * 变体不在下拉里」。
 *
 * ⇒ 一个 hook,两个区块共用。
 *
 * ## 读的是 server action,不是直接查库
 *
 * 客户端组件不许 import `@/db` ⇒ 走 `listCatalogDictionaryAdminAction`。
 *
 * ## 读失败**不抛**
 *
 * 表还没建(迁移脚本没跑)是一个**结果**,不是异常 ⇒ 返回 `errorCode`,
 * 界面按 code 查文案(`CATALOG_ERROR_TEXT_KEYS`)。
 */

import { useCallback, useEffect, useState } from "react";

import { listCatalogDictionaryAdminAction } from "@/features/image-gen/admin/actions";
import type {
  AdminCatalogAccessory,
  AdminCatalogAccessoryOption,
  AdminCatalogAccessoryVariant,
  AdminCatalogErrorCode,
  AdminCatalogSize,
} from "@/features/image-gen/admin/types";

/** 读回来的四块 */
export interface CatalogAdminRows {
  sizes: AdminCatalogSize[];
  accessories: AdminCatalogAccessory[];
  accessoryOptions: AdminCatalogAccessoryOption[];
  variants: AdminCatalogAccessoryVariant[];
}

const EMPTY_ROWS: CatalogAdminRows = {
  sizes: [],
  accessories: [],
  accessoryOptions: [],
  variants: [],
};

/**
 * 读某个型号的字典
 *
 * @param productTypeCode 型号码 —— 尺寸 / 归属 / 变体是**逐型号**的
 * @param enabled 传 `false` 就完全不读(留给「先摆别的块」的场合)
 */
export function useCatalogRows(
  productTypeCode: string,
  enabled = true
): {
  rows: CatalogAdminRows;
  loading: boolean;
  errorCode: AdminCatalogErrorCode | null;
  reload: () => void;
} {
  const [rows, setRows] = useState<CatalogAdminRows>(EMPTY_ROWS);
  const [loading, setLoading] = useState(enabled);
  const [errorCode, setErrorCode] = useState<AdminCatalogErrorCode | null>(
    null
  );

  const reload = useCallback(async () => {
    if (!enabled || !productTypeCode) return;
    setLoading(true);
    try {
      const res = await listCatalogDictionaryAdminAction({ productTypeCode });
      const data = res?.data;
      if (data?.ok) {
        setRows({
          sizes: data.sizes ?? [],
          accessories: data.accessories ?? [],
          accessoryOptions: data.accessoryOptions ?? [],
          variants: data.variants ?? [],
        });
        setErrorCode(null);
        return;
      }
      if (data && !data.ok) {
        setErrorCode(data.code);
        setRows(EMPTY_ROWS);
        return;
      }
      setErrorCode("READ_FAILED");
      setRows(EMPTY_ROWS);
    } catch {
      setErrorCode("READ_FAILED");
      setRows(EMPTY_ROWS);
    } finally {
      setLoading(false);
    }
  }, [enabled, productTypeCode]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { rows, loading, errorCode, reload: () => void reload() };
}
