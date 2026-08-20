// @ts-nocheck
/**
 * radix-ui 别名 —— 把 infinite-canvas 的 umbrella `radix-ui` import 桥到具体的
 * @radix-ui/react-* 子包。
 *
 * 用法：画布代码 `import { Select as SelectPrimitive } from "radix-ui"`
 *      → 实际来自 @radix-ui/react-select
 *
 * 背景：radix-ui 在某段时间出过 umbrella npm package "radix-ui"，里面把所有
 * 子 primitive 都 export 出来。NextDevTpl 用具体的子包（@radix-ui/react-select 等）。
 * 这里只 shim 用到的 select 一族。
 */
import * as SelectPrimitive from "@radix-ui/react-select";

export const Root = SelectPrimitive.Root;
export const Group = SelectPrimitive.Group;
export const Value = SelectPrimitive.Value;
export const Trigger = SelectPrimitive.Trigger;
export const Portal = SelectPrimitive.Portal;
export const Content = SelectPrimitive.Content;
export const Label = SelectPrimitive.Label;
export const Item = SelectPrimitive.Item;
export const ItemText = SelectPrimitive.ItemText;
export const ItemIndicator = SelectPrimitive.ItemIndicator;
export const Separator = SelectPrimitive.Separator;
export const ScrollUpButton = SelectPrimitive.ScrollUpButton;
export const ScrollDownButton = SelectPrimitive.ScrollDownButton;
export const Icon = SelectPrimitive.Icon;
// Select 作为 namespace re-export，让 `import { Select } from "radix-ui"` 也能用
export const Select = SelectPrimitive;
