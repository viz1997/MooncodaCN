// @ts-nocheck

import i18n from "@/features/canvas/i18n";
import {
  registerNodeDefinitions,
  unregisterPluginNodes,
} from "@/features/canvas/lib/canvas/node-registry";
import { getPluginRuntime } from "@/features/canvas/lib/canvas/plugin-runtime";
import { VITE_DEV_PLUGINS } from "@/features/canvas/lib/env-shim";
import {
  type InstalledPlugin,
  usePluginStore,
} from "@/features/canvas/stores/canvas/use-plugin-store";
import type { CanvasPlugin } from "@/features/canvas/types/canvas-plugin";

const cleanups = new Map<string, () => void>();

// A remote plugin may export CanvasPlugin directly or a factory that receives runtime and returns CanvasPlugin.
// The factory uses runtime.React so the bundle does not need its own React copy.
//
// 评估方式：用 `new Function(src)` 把源码当函数体执行，避免 `import(blob:url)`。
// - Vite 原生支持 blob URL 的 `import()`，Next.js 16 Turbopack 不支持（module not found: <dynamic>）。
// - Function 构造器返回的不是真模块，但插件代码本身用 `export default ...` / `export const plugin = ...` / `module.exports` 都不行
//   —— 所以这里要求插件源码是"自调用函数 + 把结果挂到 globalThis.plugin"，或纯 `const plugin = (runtime) => ({...})`。
// - 为了兼容无限画布原插件格式（export default function(runtime) {...}），这里把源码包成
//   `(function(exports, module, runtime){ ... })(...)` 也没用 —— 真实可靠的做法是
//   在 dev 模式下让插件作者打包成 IIFE 格式。
// - 当前 infinite-canvas Vite 项目的官方插件仓 `basketikun/infinite-canvas-plugins` 都用 ESM；
//   生产环境 VITE_DEV_PLUGINS 为空时不触发此函数。
// - dev / self-host 用户改用 `transformPluginSource` IIFE 包装（见下）。
async function evaluatePluginSource(source: string): Promise<CanvasPlugin> {
  const wrapped = transformPluginSource(source);
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const exported = new Function("runtime", `${wrapped}\nreturn plugin;`)(
    getPluginRuntime()
  );
  const plugin =
    typeof exported === "function"
      ? (exported as (runtime: unknown) => unknown)(getPluginRuntime())
      : exported;
  assertPlugin(plugin);
  return plugin;
}

// 把 ESM 源码（`export default ...` / `export const plugin = ...`）转换为 IIFE，
// 让 `new Function` 构造器能拿到 `plugin` 变量。
// - 简单正则只覆盖最常见的 `export default X` 和 `export const/let/var plugin = X` 两种写法
// - 复杂插件（re-export / 命名导出）建议走 VITE_DEV_PLUGINS 预编译成 IIFE 后注入
function transformPluginSource(source: string): string {
  return source
    .replace(/export\s+default\s+/g, "const plugin = ")
    .replace(/export\s+(?:const|let|var)\s+plugin\s*=/g, "const plugin =");
}

function assertPlugin(plugin: unknown): asserts plugin is CanvasPlugin {
  const value = plugin as Partial<CanvasPlugin> | null;
  if (!value || typeof value !== "object")
    throw new Error(i18n.t("canvas.pluginErrors.invalidExport"));
  if (!value.id || !Array.isArray(value.nodes) || !value.nodes.length)
    throw new Error(i18n.t("canvas.pluginErrors.missingFields"));
}

export function activatePlugin(plugin: CanvasPlugin) {
  registerNodeDefinitions(plugin.nodes, plugin.id);
  const runtime = getPluginRuntime();
  const disposers: Array<() => void> = [];
  // Inject declared styles when enabled and remove them when disabled or uninstalled.
  if (plugin.css) disposers.push(runtime.injectCSS(plugin.css, plugin.id));
  const cleanup = plugin.setup?.(runtime);
  if (typeof cleanup === "function") disposers.push(cleanup);
  if (disposers.length)
    cleanups.set(plugin.id, () => disposers.forEach((dispose) => dispose()));
}

export function deactivatePlugin(pluginId: string) {
  cleanups.get(pluginId)?.();
  cleanups.delete(pluginId);
  unregisterPluginNodes(pluginId);
}

async function fetchPluginSource(url: string) {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(
      i18n.t("canvas.pluginErrors.downloadFailed", { status: response.status })
    );
  return response.text();
}

// Add a cache-busting parameter so watch builds load the latest output.
function withCacheBust(url: string) {
  return `${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`;
}

// Install or replace a plugin from a URL and enable it immediately.
// bustCache bypasses HTTP/CDN caches during upgrades while persisting a clean URL without the timestamp query.
export async function installPluginFromUrl(
  url: string,
  opts?: { official?: boolean; bustCache?: boolean }
) {
  const source = await fetchPluginSource(
    opts?.bustCache ? withCacheBust(url) : url
  );
  const plugin = await evaluatePluginSource(source);
  deactivatePlugin(plugin.id); // Replace the previous version.
  usePluginStore.getState().upsert({
    id: plugin.id,
    name: plugin.name || plugin.id,
    version: plugin.version || "0.0.0",
    description: plugin.description,
    url,
    source,
    enabled: true,
    official: opts?.official,
  });
  activatePlugin(plugin);
  return plugin;
}

export async function updatePlugin(record: InstalledPlugin) {
  // Upgrades must fetch the latest output and therefore always bypass caches.
  return installPluginFromUrl(record.url, {
    official: record.official,
    bustCache: true,
  });
}

export async function setPluginEnabled(
  record: InstalledPlugin,
  enabled: boolean
) {
  usePluginStore.getState().setEnabled(record.id, enabled);
  if (!enabled) {
    deactivatePlugin(record.id);
    return;
  }
  // Reload local plugins from their URL when enabled because the cached source may be stale.
  const source = record.local
    ? await fetchPluginSource(withCacheBust(record.url))
    : record.source;
  const plugin = await evaluatePluginSource(source);
  activatePlugin(plugin);
}

export function uninstallPlugin(id: string) {
  deactivatePlugin(id);
  usePluginStore.getState().remove(id);
}

let loaded = false;

// Load installed and enabled plugins at application startup.
export async function ensurePluginsLoaded() {
  if (loaded) return;
  loaded = true;
  await usePluginStore.persist.rehydrate();
  await loadLocalPlugins(); // Discover disabled local plugins first, then activate all enabled records.
  const records = usePluginStore
    .getState()
    .plugins.filter((record) => record.enabled);
  await Promise.all(
    records.map(async (record) => {
      try {
        // Local plugins use the latest output; other plugins use their cached source.
        const source = record.local
          ? await fetchPluginSource(withCacheBust(record.url))
          : record.source;
        activatePlugin(await evaluatePluginSource(source));
      } catch (error) {
        console.error(`[plugin] Failed to load: ${record.id}`, error);
      }
    })
  );
  await loadDevPlugins();
}

// Discover local plugins from web/public/plugins, add them disabled, and expose them in the manager without a URL.
// Refresh metadata and source for existing records while preserving the enabled flag so persisted versions stay current.
async function loadLocalPlugins() {
  let urls: unknown;
  try {
    const response = await fetch("/plugins/index.json");
    if (!response.ok) return;
    urls = await response.json();
  } catch {
    return; // Skip when no local manifest exists, such as production builds without plugins.
  }
  if (!Array.isArray(urls) || !urls.length) return;
  const store = usePluginStore.getState();
  await Promise.all(
    urls.map(async (url: string) => {
      try {
        const source = await fetchPluginSource(withCacheBust(url));
        const plugin = await evaluatePluginSource(source);
        const existing = store.plugins.find((item) => item.id === plugin.id);
        store.upsert({
          id: plugin.id,
          name: plugin.name || plugin.id,
          version: plugin.version || "0.0.0",
          description: plugin.description,
          url,
          source,
          enabled: existing?.enabled ?? false, // Preserve the user setting; new discoveries default to disabled.
          local: true,
        });
      } catch (error) {
        console.error(
          `[plugin] Failed to discover local plugin: ${url}`,
          error
        );
      }
    })
  );
}

// During local development, refetch VITE_DEV_PLUGINS URLs without caching or persistence on every startup.
// Together with watch builds, refreshing the page loads code changes without reinstalling the plugin.
async function loadDevPlugins() {
  const raw = VITE_DEV_PLUGINS;
  if (!raw) return;
  const urls = raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  await Promise.all(
    urls.map(async (url) => {
      try {
        const source = await fetchPluginSource(withCacheBust(url));
        const plugin = await evaluatePluginSource(source);
        deactivatePlugin(plugin.id);
        activatePlugin(plugin);
        console.info(`[plugin] Dev plugin loaded: ${plugin.id} (${url})`);
      } catch (error) {
        console.error(`[plugin] Failed to load dev plugin: ${url}`, error);
      }
    })
  );
}
