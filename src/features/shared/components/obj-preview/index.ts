// 共用的 3D 预览组件 —— 打印前工作台(/tools/weight)的「克重 / 摆盘」视角
// 与「检查」视角
export {
  addMaterialGroups,
  buildPreviewMaterials,
  type PreviewMaterialInput,
  type PreviewMaterials,
} from "./materials";
export {
  ObjPreview,
  type ObjPreviewProps,
  type PreviewContext,
} from "./obj-preview";
export {
  addPreviewLights,
  addPrintBedGrid,
  getPreviewStyle,
  type PreviewMode,
  type PreviewStyle,
} from "./styles";
