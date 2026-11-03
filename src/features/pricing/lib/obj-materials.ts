/**
 * OBJ / MTL 材质与贴图解析 —— 纯函数(不碰 DOM、不建 blob URL),浏览器与单测都能跑。
 *
 * ## 为什么不用 three 的 `MTLLoader` 直接解析
 *
 * `MTLLoader.parse()` 只把 `map_Kd` 的**原始值**留在 `materialsInfo[name].map_kd`
 * (含 `-s 1 1 1` 之类 option token),而且 key 全被小写化。真正要解决的问题是
 * 「**这个材质的贴图到底是压缩包里的哪一个文件**」—— 这件事 `MTLLoader` 不管,
 * 它只负责把路径原样交给 `TextureLoader`。
 *
 * 所以这里自己解析一遍 MTL,拿到「材质 → 贴图文件名」的映射,再拿压缩包里的
 * 纹理清单去匹配。匹配不上就**不挂贴图**(退回材质本色),
 * 而不是随手拿包里第一张图糊上去 —— 那正是「贴图错乱」的来源。
 *
 * ## 与 viewer 的配合
 *
 * `obj-viewer.tsx` / 模型检查工具的 viewport 拿到本模块的产物后,
 * 会把 `map_kd` / `map_ks` / `norm` 三个字段**替换成 blob URL**,
 * 再交给 `MTLLoader.preload()` 同步建材质(贴图异步载入)。
 * 因此这里解析出来的指令名必须与 `MTLLoader` 的字段名一一对应。
 */

/** 一个 MTL 材质 */
export type MtlMaterial = {
  /** `newmtl` 声明的材质名(原样,不改大小写) */
  name: string;
  /** `Kd` 漫反射色(0-1),缺省时材质是白模 */
  kd?: [number, number, number];
  /** `map_Kd` 指向的贴图文件名(已剥掉 option token) */
  mapKd?: string;
  /** `map_Ks` 指向的贴图文件名(高光贴图) */
  mapKs?: string;
  /** `norm` 指向的法线贴图文件名 */
  normalMap?: string;
};

/** 压缩包里的一个纹理文件 */
export type TextureBlob = {
  /** 包内路径(可能带目录) */
  name: string;
  blob: Blob;
};

/** 材质名 → 该材质用到的贴图文件(压缩包内的路径) */
export type MaterialTextureFiles = {
  /** base color(`map_Kd`) */
  map?: string;
  /** 高光(`map_Ks`) */
  specularMap?: string;
  /** 法线(`norm`) */
  normalMap?: string;
};

/** 材质名 → 该材质用到的贴图文件(压缩包内的路径) */
export type MaterialTextureMap = Record<string, MaterialTextureFiles>;

/** 材质名 → 贴图 blob URL(浏览器侧创建) */
export type MaterialTextureUrls = {
  map?: string;
  specularMap?: string;
  normalMap?: string;
};

/** 材质名 → 贴图 blob URL */
export type TextureUrlMap = Record<string, MaterialTextureUrls>;

/**
 * MTL 贴图指令的 option token。
 *
 * `-s 1 1 1` / `-o 0 0 0` 这类 token 及其参数必须整段剥掉,
 * 否则 basename 匹配会拿 `-s 1 1 1 tex.png` 去比,永远匹配不上。
 *
 * `onoff` 表示参数只可能是 `on` / `off`(`-clamp` / `-blendu` 这类),
 * 遇到别的值就不吃参数 —— 有些导出器会写成裸的 `-blendu`。
 */
const TEXTURE_OPTIONS: Record<string, "num" | "onoff"> = {
  "-bm": "num", // bump scale
  "-mm": "num", // displacement bias + scale
  "-s": "num", // u v scale
  "-o": "num", // u v offset
  "-texres": "num",
  "-imfchan": "num",
  "-boost": "num",
  "-cc": "onoff",
  "-clamp": "onoff",
  "-blendu": "onoff",
  "-blendv": "onoff",
};

/** option token 后面跟几个数值参数 */
const TEXTURE_OPTION_ARITY: Record<string, number> = {
  "-bm": 1,
  "-mm": 2,
  "-s": 3,
  "-o": 3,
  "-texres": 1,
  "-imfchan": 1,
  "-boost": 1,
};

/**
 * 取路径的最后一段(兼容 `/` 与 `\` 分隔 —— Windows 导出的 MTL 常带反斜杠)。
 */
export function baseName(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const idx = normalized.lastIndexOf("/");
  return idx >= 0 ? normalized.slice(idx + 1) : normalized;
}

/**
 * 把 `map_Kd` 的原始值拆成「option token」+「文件名 token」。
 *
 * 返回 `fileStart` —— 文件名在 token 列表里的起始下标。
 * 改写贴图引用时要保留前面的 option token(`-s 1 1 1`)。
 */
function splitTextureTokens(raw: string): {
  tokens: string[];
  fileStart: number;
} {
  const tokens = raw.trim().split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < tokens.length) {
    const key = (tokens[i] ?? "").toLowerCase();
    const kind = TEXTURE_OPTIONS[key];
    if (!kind) break;
    if (kind === "onoff") {
      const next = (tokens[i + 1] ?? "").toLowerCase();
      i += next === "on" || next === "off" ? 2 : 1;
      continue;
    }
    i += 1 + (TEXTURE_OPTION_ARITY[key] ?? 0);
  }
  return { tokens, fileStart: i };
}

/**
 * 从 `map_Kd` 的原始值里剥掉 option token,取出贴图文件名。
 *
 * option 只按规范出现在文件名**前面**,所以从往前剥;
 * 剩下的 token 用空格拼回去 —— 文件名带空格(`wood grain.png`)也能正确还原。
 */
export function parseTextureFileName(raw: string): string {
  const { tokens, fileStart } = splitTextureTokens(raw);
  const file = tokens.slice(fileStart).join(" ").trim();
  // 文件名可能被引号包起来
  if (file.length >= 2 && file.startsWith('"') && file.endsWith('"')) {
    return file.slice(1, -1);
  }
  return file;
}

/**
 * 把贴图指令里的文件名换成新名字(option token 原样保留)。
 */
export function rewriteTextureFileName(raw: string, newName: string): string {
  const { tokens, fileStart } = splitTextureTokens(raw);
  if (fileStart >= tokens.length) return raw;
  const quoted = newName.includes(" ") ? `"${newName}"` : newName;
  return [...tokens.slice(0, fileStart), quoted].join(" ");
}

/** MTL 里会引用贴图文件的指令 */
const TEXTURE_DIRECTIVES = new Set([
  "map_kd",
  "map_ks",
  "map_ke",
  "norm",
  "map_bump",
  "bump",
  "disp",
  "map_d",
]);

/**
 * 改写 MTL 里的贴图引用。
 *
 * `resolve` 负责把 MTL 里写的文件名对上包里的实际文件,返回要写入的新名字;
 * 返回 undefined 表示找不到对应文件 —— 那就保持原样(绝不乱指到别的图)。
 */
export function rewriteMtlTextureRefs(
  mtlText: string,
  resolve: (fileName: string) => string | undefined
): string {
  return mtlText
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return line;
      const sp = trimmed.indexOf(" ");
      const rawKey = sp >= 0 ? trimmed.slice(0, sp) : trimmed;
      const key = rawKey.toLowerCase();
      if (!TEXTURE_DIRECTIVES.has(key)) return line;
      const value = sp >= 0 ? trimmed.slice(sp + 1) : "";
      const fileName = parseTextureFileName(value);
      if (!fileName) return line;
      const next = resolve(fileName);
      if (!next || next === fileName) return line;
      const indent = line.slice(0, line.length - line.trimStart().length);
      return `${indent}${rawKey} ${rewriteTextureFileName(value, next)}`;
    })
    .join("\n");
}

/**
 * MTL 文本切成的材质块 —— 保留每块的原始指令行。
 *
 * 合并多个 MTL 时要原样搬过去(`map_Kd` 等指令不能丢),
 * 所以不能只留解析后的字段。
 */
export type MtlBlock = {
  /** `newmtl` 声明的材质名 */
  name: string;
  /** 该材质除 `newmtl` 以外的原始指令行 */
  body: string[];
};

/**
 * 把 MTL 文本切成材质块。
 */
export function splitMtlBlocks(text: string): MtlBlock[] {
  const blocks: MtlBlock[] = [];
  let current: MtlBlock | undefined;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const sp = line.indexOf(" ");
    const key = (sp >= 0 ? line.slice(0, sp) : line).toLowerCase();
    const value = sp >= 0 ? line.slice(sp + 1).trim() : "";

    if (key === "newmtl") {
      current = { name: value, body: [] };
      blocks.push(current);
      continue;
    }
    // MTL 允许 `newmtl` 之前有全局指令(少见),忽略
    if (!current) continue;
    current.body.push(line);
  }

  return blocks;
}

/**
 * 解析 MTL 文本 → 材质列表。
 *
 * 宽容处理:未知指令忽略;贴图文件名解析不出来就当这个材质没贴图。
 */
export function parseMtl(text: string): MtlMaterial[] {
  return splitMtlBlocks(text).map((block) => {
    const material: MtlMaterial = { name: block.name };
    for (const line of block.body) {
      const sp = line.indexOf(" ");
      const key = (sp >= 0 ? line.slice(0, sp) : line).toLowerCase();
      const value = sp >= 0 ? line.slice(sp + 1).trim() : "";
      if (key === "kd") {
        const parts = value.split(/\s+/).map(Number);
        if (
          parts.length >= 3 &&
          parts.slice(0, 3).every((n) => Number.isFinite(n))
        ) {
          material.kd = [
            parts[0] as number,
            parts[1] as number,
            parts[2] as number,
          ];
        }
      } else if (key === "map_kd") {
        const file = parseTextureFileName(value);
        if (file) material.mapKd = file;
      } else if (key === "map_ks") {
        const file = parseTextureFileName(value);
        if (file) material.mapKs = file;
      } else if (key === "norm" || key === "map_ns") {
        // MTL 规范里法线贴图指令是 `norm`;`map_Ns` 是部分导出器的写法
        const file = parseTextureFileName(value);
        if (file) material.normalMap = file;
      }
    }
    return material;
  });
}

/**
 * 把 MTL 里声明的贴图文件名,匹配到压缩包里的实际文件。
 *
 * 匹配规则:先按完整路径(忽略大小写)精确匹配,再退到 basename 匹配 ——
 * MTL 写 `wood.png` 而包里是 `textures/wood.png` 是常态。
 *
 * 匹配不上就**不返回**(该材质退回本色),绝不拿别的图顶替。
 */
export function matchMaterialTextures(
  materials: MtlMaterial[],
  textureBlobs: TextureBlob[]
): MaterialTextureMap {
  const result: MaterialTextureMap = {};
  if (materials.length === 0 || textureBlobs.length === 0) return result;

  const byFullPath = new Map<string, TextureBlob>();
  const byBaseName = new Map<string, TextureBlob>();
  for (const tb of textureBlobs) {
    const full = tb.name.replace(/\\/g, "/").toLowerCase();
    if (!byFullPath.has(full)) byFullPath.set(full, tb);
    const base = baseName(tb.name).toLowerCase();
    if (!byBaseName.has(base)) byBaseName.set(base, tb);
  }

  const find = (ref: string): TextureBlob | undefined => {
    const full = ref.replace(/\\/g, "/").toLowerCase();
    const exact = byFullPath.get(full);
    if (exact) return exact;
    return byBaseName.get(baseName(ref).toLowerCase());
  };

  for (const m of materials) {
    const entry: MaterialTextureFiles = {};
    if (m.mapKd) {
      const hit = find(m.mapKd);
      if (hit) entry.map = hit.name;
    }
    if (m.mapKs) {
      const hit = find(m.mapKs);
      if (hit) entry.specularMap = hit.name;
    }
    if (m.normalMap) {
      const hit = find(m.normalMap);
      if (hit) entry.normalMap = hit.name;
    }
    if (entry.map || entry.specularMap || entry.normalMap) {
      result[m.name] = entry;
    }
  }

  return result;
}

/**
 * 从 OBJ 文本里取出 `mtllib` 声明的 MTL 文件名(可能有多个)。
 *
 * OBJ 规范允许一行写多个(`mtllib a.mtl b.mtl`)—— 必须按空白拆开,
 * 否则 `pickMtlFileName` 拿 `a.mtl b.mtl` 去比,永远匹配不上,
 * 最后退回「包里的第一个 .mtl」—— 贴图错乱的经典来源。
 */
export function parseMtllibNames(objText: string): string[] {
  const names: string[] = [];
  for (const rawLine of objText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (!/^mtllib\s/i.test(line)) continue;
    const value = line.slice(line.indexOf(" ") + 1).trim();
    for (const token of value.split(/\s+/)) {
      if (token) names.push(token);
    }
  }
  return names;
}

/**
 * 从 OBJ 文本里取出 `usemtl` 声明的材质名(按出现顺序,去重)。
 */
export function parseUsemtlNames(objText: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const rawLine of objText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (!/^usemtl\s/i.test(line)) continue;
    const value = line.slice(line.indexOf(" ") + 1).trim();
    if (value && !seen.has(value)) {
      seen.add(value);
      names.push(value);
    }
  }
  return names;
}

/**
 * 从候选列表里挑出 OBJ 真正引用的那个 MTL 文件。
 *
 * OBJ 里 `mtllib xxx.mtl` 指向的才是配套材质表 —— 压缩包里可能有多个 `.mtl`,
 * 拿第一个就是「贴图错乱」的常见来源。
 */
export function pickMtlFileName(
  mtllibRefs: string[],
  candidates: string[]
): string | undefined {
  if (candidates.length === 0) return undefined;
  for (const ref of mtllibRefs) {
    const refBase = baseName(ref).toLowerCase();
    const hit = candidates.find((c) => baseName(c).toLowerCase() === refBase);
    if (hit) return hit;
  }
  // OBJ 没写 mtllib(或写的文件不在包里)→ 退回第一个候选
  return candidates[0];
}

/**
 * 多个 OBJ 合并时的 MTL 合并结果。
 */
export type MergedMtl = {
  /** 合并后的 MTL 文本(每个材质的 `newmtl` 都改成合并后的名字) */
  mtlText: string;
  /** 每个源文件对应的「原材质名 → 合并后材质名」映射 */
  renameByFile: Map<string, string>[];
};

/**
 * 把多个 OBJ 各自的 MTL 合并成一份。
 *
 * 不同文件的材质可能同名(`Material`),直接合并会让两个文件共用一张贴图。
 * 这里给撞名的材质加 `_1` 后缀,并返回改名表,让合并后的 OBJ 里
 * `usemtl` 同步改名 —— OBJ 与 MTL 始终自洽(导出 zip 时也靠这个一致性)。
 *
 * `usemtlNames` 是 OBJ 里引用但 MTL 没声明的材质(常见于「OBJ 没配套 MTL」
 * 的组合包):它们同样要占位改名,否则会撞上别的文件的同名材质,
 * 让两个文件共用一张贴图 —— 这正是「贴图错乱」的来源。
 *
 * 贴图指令原样搬运 —— 贴的是哪张图由匹配阶段(`matchMaterialTextures`)负责。
 */
export function mergeMtlTexts(
  entries: { mtlText: string; usemtlNames?: string[] }[]
): MergedMtl {
  const renameByFile: Map<string, string>[] = [];
  const used = new Set<string>();
  const blocks: string[] = [];

  for (const entry of entries) {
    const rename = new Map<string, string>();
    const out: string[] = [];
    const mtlBlocks = splitMtlBlocks(entry.mtlText);
    const mtlNames = new Set(mtlBlocks.map((b) => b.name));
    const blockByName = new Map(mtlBlocks.map((b) => [b.name, b]));

    const ordered: string[] = [
      ...mtlBlocks.map((b) => b.name),
      ...(entry.usemtlNames ?? []).filter((n) => !mtlNames.has(n)),
    ];

    for (const name of ordered) {
      let target = name;
      if (used.has(target)) {
        let n = 1;
        while (used.has(`${name}_${n}`)) n += 1;
        target = `${name}_${n}`;
      }
      used.add(target);
      rename.set(name, target);
      const block = blockByName.get(name);
      if (block) {
        out.push(`newmtl ${target}`);
        out.push(...block.body);
      }
    }

    renameByFile.push(rename);
    if (out.length > 0) blocks.push(out.join("\n"));
  }

  return {
    mtlText: blocks.join("\n"),
    renameByFile,
  };
}

/**
 * 统计 OBJ 文本里 `v` / `vt` 的数量。
 */
export function countObjIndices(objText: string): {
  vertices: number;
  uvs: number;
} {
  let vertices = 0;
  let uvs = 0;
  for (const rawLine of objText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (/^v\s/.test(line)) vertices += 1;
    else if (/^vt\s/.test(line)) uvs += 1;
  }
  return { vertices, uvs };
}

/**
 * 给 OBJ 文本里 `f` 行的索引加偏移(多 OBJ 合并用)。
 *
 * `v` 与 `vt` 是**两套独立的索引空间** —— 只偏移 `v` 会让合并后的模型
 * 去采样别的模型的 UV 坐标,贴图直接错乱。
 *
 * 负索引(相对文件末尾)按 OBJ 规范换算成绝对索引:
 * 被合并文件里的 `-1` 指的是它自己的最后一个顶点,
 * 换算后应是 `offset + count`(而不是 `offset - 1`)。
 */
export function offsetObjFaceIndices(
  objText: string,
  vertexOffset: number,
  uvOffset: number,
  vertexCount: number,
  uvCount: number
): string {
  if (vertexOffset === 0 && uvOffset === 0) return objText;

  return objText
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!/^f\s/.test(trimmed)) return line;
      const indent = line.slice(0, line.length - line.trimStart().length);
      const tokens = trimmed.split(/\s+/);
      const out = tokens.map((token, idx) => {
        if (idx === 0) return token;
        const parts = token.split("/");
        const vIdx = parseInt(parts[0] ?? "", 10);
        if (Number.isFinite(vIdx)) {
          parts[0] = String(
            vIdx > 0
              ? vIdx + vertexOffset
              : vertexOffset + vertexCount + vIdx + 1
          );
        }
        if (parts.length > 1) {
          const tIdx = parseInt(parts[1] ?? "", 10);
          if (Number.isFinite(tIdx)) {
            parts[1] = String(
              tIdx > 0 ? tIdx + uvOffset : uvOffset + uvCount + tIdx + 1
            );
          }
        }
        return parts.join("/");
      });
      return `${indent}${out.join(" ")}`;
    })
    .join("\n");
}

/** 参与合并的一个 OBJ(可能带配套 MTL) */
export type ObjSource = {
  /** OBJ 文本 */
  objText: string;
  /** 配套 MTL 文本 */
  mtlText?: string | undefined;
  /** OBJ 在包内的文件名 */
  objFileName?: string | undefined;
  /** 配套 MTL 在包内的文件名 */
  mtlFileName?: string | undefined;
};

/** 多 OBJ 合并的结果 */
export type CombinedObj = {
  /** 合并后的 OBJ 文本 */
  objText: string;
  /** 合并后的 MTL 文本(没有 MTL 时为 undefined) */
  mtlText?: string | undefined;
  /** 合并后 OBJ 里 `mtllib` 指向的文件名 */
  mtlFileName?: string | undefined;
};

/**
 * 合并多个 OBJ(组合模型)成一份自洽的 OBJ + MTL。
 *
 * - 顶点与 UV 索引分别偏移 —— 漏掉 `vt` 就是「组合模型贴图错乱」
 * - 所有 OBJ 共享同一个 MTL 时,材质名保持原样(最常见的情况)
 * - 各自带不同 MTL 时,材质撞名加后缀,`usemtl` 同步改名
 */
export function combineObjSources(sources: ObjSource[]): CombinedObj {
  if (sources.length === 0) return { objText: "" };

  // 所有 OBJ 是不是共用同一个 MTL?
  const mtlNames = new Set(
    sources
      .map((s) => (s.mtlFileName ? baseName(s.mtlFileName).toLowerCase() : ""))
      .filter(Boolean)
  );

  const mergedMtl =
    mtlNames.size > 1
      ? mergeMtlTexts(
          sources.map((s) => ({
            mtlText: s.mtlText ?? "",
            usemtlNames: parseUsemtlNames(s.objText),
          }))
        )
      : null;

  const outputMtlName = resolveMergedMtlName(sources, mtlNames.size > 1);

  let vertexOffset = 0;
  let uvOffset = 0;
  const parts: string[] = [];

  for (let i = 0; i < sources.length; i++) {
    const source = sources[i]!;
    const counts = countObjIndices(source.objText);
    let text = offsetObjFaceIndices(
      source.objText,
      vertexOffset,
      uvOffset,
      counts.vertices,
      counts.uvs
    );
    if (mergedMtl) {
      const rename = mergedMtl.renameByFile[i];
      if (rename) text = rewriteUsemtl(text, rename);
    }
    if (outputMtlName) text = rewriteMtllib(text, outputMtlName);
    parts.push(text);
    vertexOffset += counts.vertices;
    uvOffset += counts.uvs;
  }

  const mtlText = mergedMtl
    ? mergedMtl.mtlText
    : sources.find((s) => s.mtlText)?.mtlText;

  return {
    objText: parts.join("\n"),
    mtlText: mtlText || undefined,
    mtlFileName: outputMtlName,
  };
}

/**
 * 合并后 MTL 的文件名。
 *
 * 优先沿用第一个 OBJ 配套的 MTL 名;没有就用第一个 OBJ 的名字推导。
 */
function resolveMergedMtlName(
  sources: ObjSource[],
  merged: boolean
): string | undefined {
  if (!merged) {
    const first = sources.find((s) => s.mtlFileName);
    return first?.mtlFileName ? baseName(first.mtlFileName) : undefined;
  }
  const first = sources.find((s) => s.mtlFileName);
  if (first?.mtlFileName) return baseName(first.mtlFileName);
  const objName = sources[0]?.objFileName;
  if (!objName) return undefined;
  return `${baseName(objName).replace(/\.[^.]+$/, "")}.mtl`;
}

/**
 * 把「材质 → 包内贴图文件」变成「材质 → blob URL」。
 *
 * `createUrl` 由调用方注入(浏览器端是 `URL.createObjectURL`)——
 * 本模块保持纯函数,可以在 Node 单测里跑。
 *
 * 同一个文件被多个材质引用时只建一次 URL。
 */
export function buildTextureUrlMap(
  materialTextures: MaterialTextureMap,
  textureBlobs: TextureBlob[],
  createUrl: (blob: Blob) => string
): TextureUrlMap {
  const byName = new Map(textureBlobs.map((tb) => [tb.name, tb]));
  const urlCache = new Map<string, string>();
  const urls: TextureUrlMap = {};

  for (const [material, files] of Object.entries(materialTextures)) {
    const entry: MaterialTextureUrls = {};
    for (const key of ["map", "specularMap", "normalMap"] as const) {
      const fileName = files[key];
      if (!fileName) continue;
      const tb = byName.get(fileName);
      if (!tb) continue;
      let url = urlCache.get(fileName);
      if (!url) {
        url = createUrl(tb.blob);
        urlCache.set(fileName, url);
      }
      entry[key] = url;
    }
    urls[material] = entry;
  }

  return urls;
}

/**
 * 挑「第一张 base color 贴图」当缩略图 —— 按材质声明顺序。
 *
 * 没有材质贴图时返回 undefined(**不**回退到包里随便一张图:
 * 那会让缩略图跟模型对不上,看起来就是贴图错乱)。
 */
export function pickPreviewTextureUrl(
  materials: MtlMaterial[],
  urls: TextureUrlMap
): string | undefined {
  for (const m of materials) {
    const url = urls[m.name]?.map;
    if (url) return url;
  }
  return undefined;
}

/**
 * 按改名表改写 OBJ 文本里的 `usemtl` 行。
 */
export function rewriteUsemtl(
  objText: string,
  rename: Map<string, string>
): string {
  if (rename.size === 0) return objText;
  return objText
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!/^usemtl\s/i.test(trimmed)) return line;
      const value = trimmed.slice(trimmed.indexOf(" ") + 1).trim();
      const next = rename.get(value);
      if (!next || next === value) return line;
      const indent = line.slice(0, line.length - line.trimStart().length);
      return `${indent}usemtl ${next}`;
    })
    .join("\n");
}

/**
 * 把 OBJ 文本里所有 `mtllib` 行改写成同一个文件名(多 OBJ 合并后只有一个 MTL)。
 */
export function rewriteMtllib(objText: string, mtlFileName: string): string {
  return objText
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!/^mtllib\s/i.test(trimmed)) return line;
      const indent = line.slice(0, line.length - line.trimStart().length);
      return `${indent}mtllib ${mtlFileName}`;
    })
    .join("\n");
}
