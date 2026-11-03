// 共用的 3D 预览组件 —— 克重工具(/tools/weight)与模型检查工具(/tools/model-check)
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
