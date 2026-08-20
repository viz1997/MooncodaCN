// @ts-nocheck

import { App } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { APP_VERSION } from "@/features/canvas/constant/env";
import {
  parseChangelog,
  type ReleaseInfo,
} from "@/features/canvas/lib/release";

const latestVersionUrl =
  "https://raw.githubusercontent.com/basketikun/infinite-canvas/main/VERSION";
const latestChangelogUrl =
  "https://raw.githubusercontent.com/basketikun/infinite-canvas/main/CHANGELOG.md";

function readLocalReleases(): ReleaseInfo[] {
  // __APP_RELEASES__ 来自原 infinite-canvas Vite define 构建时常量；
  // Next.js 16 Turbopack 无 define API，运行时 typeof 兜底
  // （typeof 对未声明标识符不抛 ReferenceError）
  if (
    typeof __APP_RELEASES__ !== "undefined" &&
    Array.isArray(__APP_RELEASES__)
  ) {
    return __APP_RELEASES__;
  }
  return [];
}

function toVersionParts(version: string) {
  const match = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1).map(Number) : null;
}

function isNewerVersion(latestVersion: string, currentVersion: string) {
  const latest = toVersionParts(latestVersion);
  const current = toVersionParts(currentVersion);
  if (!latest || !current) return false;
  return latest.some(
    (value, index) =>
      value > current[index] &&
      latest
        .slice(0, index)
        .every((part, prevIndex) => part === current[prevIndex])
  );
}

/**
 * 把上游 GitHub 上的画布版本号作为"当前版本"显示。
 *
 * Mooncoda 本体版本（package.json '0.1.0'）跟上游 infinite-canvas 版本
 * （v0.16.0 起）是两条独立线，硬比没意义。画布是"客户端孤岛"，
 * 它的版本语义应该跟上游对齐——canvas 编辑器顶部按钮和"版本更新"弹窗
 * 里都用同一个值，不再显示"有新版本"。
 *
 * 拿不到时（离线 / GitHub 不可达）fallback 到本地 APP_VERSION，
 * 至少不会让按钮变成空。
 */
const FALLBACK_VERSION = APP_VERSION;

async function fetchCanvasVersion(): Promise<string | null> {
  try {
    const response = await fetch(latestVersionUrl);
    if (!response.ok) return null;
    const version = (await response.text()).trim();
    return version || null;
  } catch {
    return null;
  }
}

export function useVersionCheck() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const localReleases = useMemo(readLocalReleases, []);
  // 初始用本地版本号占位，useEffect 拿到上游版本后同步刷新
  const [latestVersion, setLatestVersion] = useState(FALLBACK_VERSION);
  const [currentVersion, setCurrentVersion] = useState(FALLBACK_VERSION);
  const [releases, setReleases] = useState<ReleaseInfo[]>(localReleases);
  const [checking, setChecking] = useState(false);
  const [open, setOpen] = useState(false);
  const hasNewVersion = isNewerVersion(latestVersion, currentVersion);

  const checkLatestVersion = useCallback(async () => {
    const version = await fetchCanvasVersion();
    if (version) {
      setLatestVersion(version);
      setCurrentVersion(version);
    }
    return Boolean(version);
  }, []);

  const checkLatestRelease = useCallback(
    async (showMessage = false) => {
      setChecking(true);
      try {
        const [versionResponse, changelogResponse] = await Promise.all([
          fetch(latestVersionUrl),
          fetch(latestChangelogUrl),
        ]);
        if (!versionResponse.ok) throw new Error(t("version.readFailed"));
        if (!changelogResponse.ok)
          throw new Error(t("version.changelogFailed"));
        const [version, changelog] = await Promise.all([
          versionResponse.text(),
          changelogResponse.text(),
        ]);
        const trimmed = version.trim();
        if (trimmed) {
          setLatestVersion(trimmed);
          setCurrentVersion(trimmed);
        }
        if (changelog.trim()) setReleases(parseChangelog(changelog));
        if (showMessage) message.success(t("version.updated"));
        return true;
      } catch {
        // 拿不到时（离线 / GitHub 不可达）保持当前显示，不回滚到本地版本
        // —— 之前的 setLatestVersion(currentVersion) 会让最新版本号倒退，
        // 体感上"刷新一下版本号变老"很奇怪
        if (showMessage) message.error(t("version.updateFailed"));
        return false;
      } finally {
        setChecking(false);
      }
    },
    [message, t]
  );

  useEffect(() => {
    void checkLatestVersion();
  }, [checkLatestVersion]);

  const openReleaseModal = useCallback(() => {
    setOpen(true);
    void checkLatestRelease();
  }, [checkLatestRelease]);

  return {
    open,
    setOpen,
    openReleaseModal,
    latestVersion,
    currentVersion,
    releases,
    checking,
    hasNewVersion,
    checkLatestRelease,
  };
}
