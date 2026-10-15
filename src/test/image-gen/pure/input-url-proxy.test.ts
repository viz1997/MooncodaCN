/**
 * 2026-10-14 输入图代理 helper 单元测试
 *
 * 覆盖矩阵:
 *   isR2Url
 *     - 空 / null / undefined → false
 *     - 非法 URL → false
 *     - 第三方 host(CloudBase / Weiyun / 七牛 / 阿里 OSS)→ false
 *     - R2_PUBLIC_BASE_URL 派生 host → true
 *     - *.r2.cloudflarestorage.com → true
 *     - 大小写不敏感
 *
 *   proxyImageInputsToR2
 *     - undefined / null / 空串保留
 *     - data: URL passthrough(不调 persistCandidateToR2)
 *     - R2 URL 跳过(幂等)
 *     - 第三方 http URL 调 persistCandidateToR2 拿回 R2 URL
 *     - 保留输入顺序 + 长度
 *     - persistCandidateToR2 抛错冒泡(不静默)
 *     - 非 http(s) 协议(ws/file)→ 抛错
 */

// 必须先设好 R2 env,再 import 被测模块(env 在 r2.ts 模块顶层读取)
process.env.R2_ACCOUNT_ID = "test-account-id";
process.env.R2_PUBLIC_BASE_URL = "https://cdn.example.com";

import { afterEach, describe, expect, it, vi } from "vitest";

// 用 vi.mock 替掉 persistCandidateToR2(它内部 fetch + R2 PUT 真实 IO),
// 但保留模块其它成员(以防 adapter 链式依赖)。
// proxyImageInputsToR2 自己从 gpt-image/lib/generation-service 导
// persistCandidateToR2,所以 mock 必须在 import 被测模块前完成。
const persistSpy = vi.fn(
  async (url: string, _traceHint: string, _idx: number) => {
    // 模拟真实行为:返回「R2 持久化后的 URL」(以 R2 public host 开头)。
    // traceHint / _idx 真实实现会用来生成 R2 objectKey 命名空间,本 mock
    // 不关心,只透传 url 返回。
    void _traceHint;
    void _idx;
    return `https://cdn.example.com/proxied/${encodeURIComponent(url)}`;
  }
);
vi.mock("@/features/gpt-image/lib/generation-service", () => ({
  persistCandidateToR2: (
    url: string,
    _traceHint: string,
    _idx: number
  ): Promise<string> => persistSpy(url, _traceHint, _idx),
}));

const { isR2Url, proxyImageInputsToR2 } = await import(
  "@/features/image-gen/lib/image-models/input-url-proxy"
);

afterEach(() => {
  persistSpy.mockClear();
});

describe("isR2Url", () => {
  it("null / undefined / 空串 → false", () => {
    expect(isR2Url(null)).toBe(false);
    expect(isR2Url(undefined)).toBe(false);
    expect(isR2Url("")).toBe(false);
  });

  it("非法 URL 字符串 → false", () => {
    expect(isR2Url("not-a-url")).toBe(false);
    expect(isR2Url("://no-scheme")).toBe(false);
  });

  it("第三方 host → false", () => {
    // 用户上报的真实污染 URL
    const cloudbase =
      "https://636c-cloudbase-d1gp5i0wi156a787c-1493542079.tcb.qcloud.la/images/temp/img.webp?sign=abc&t=123";
    expect(isR2Url(cloudbase)).toBe(false);

    expect(isR2Url("https://example.com/foo.png")).toBe(false);
    expect(isR2Url("https://s3.amazonaws.com/bucket/key")).toBe(false);
    expect(isR2Url("https://oss-cn-hangzhou.aliyuncs.com/x")).toBe(false);
    expect(isR2Url("https://cdn.some-cdn.com/x.png")).toBe(false);
  });

  it("R2_PUBLIC_BASE_URL 派生 host → true", () => {
    expect(isR2Url("https://cdn.example.com/uploads/foo.png")).toBe(true);
    expect(
      isR2Url(
        "https://cdn.example.com/uploads/foo.png?response-content-disposition=attachment"
      )
    ).toBe(true);
  });

  it("*.r2.cloudflarestorage.com → true", () => {
    expect(
      isR2Url(
        "https://test-account-id.r2.cloudflarestorage.com/mooncada-public/abc.png"
      )
    ).toBe(true);
  });

  it("大小写不敏感(host 部分)", () => {
    expect(isR2Url("https://CDN.EXAMPLE.COM/foo.png")).toBe(true);
    expect(
      isR2Url("https://Test-Account-Id.r2.CloudflareStorage.com/x.png")
    ).toBe(true);
  });
});

describe("proxyImageInputsToR2", () => {
  it("undefined / null / 空串 → 原样保留", async () => {
    const result = await proxyImageInputsToR2(
      [undefined, null, "", "https://cdn.example.com/a.png"],
      "trace"
    );
    expect(result[0]).toBeUndefined();
    expect(result[1]).toBeNull();
    expect(result[2]).toBe("");
    expect(result[3]).toBe("https://cdn.example.com/a.png");
    // 空串也没调 persistCandidate
    expect(persistSpy).not.toHaveBeenCalled();
  });

  it("data: URL 透传,不调 persistCandidateToR2", async () => {
    const dataUri =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
    const out = await proxyImageInputsToR2([dataUri], "trace");
    expect(out[0]).toBe(dataUri);
    expect(persistSpy).not.toHaveBeenCalled();
  });

  it("已是 R2 URL → 跳过(幂等)", async () => {
    const r2Url = "https://cdn.example.com/already-proxied/foo.png";
    const out = await proxyImageInputsToR2([r2Url], "trace");
    expect(out[0]).toBe(r2Url);
    expect(persistSpy).not.toHaveBeenCalled();
  });

  it("第三方 http URL → 走 persistCandidateToR2,拿回持久化 URL", async () => {
    const external = "https://636c-cloudbase.tcb.qcloud.la/img.webp?sign=x&t=1";
    const out = await proxyImageInputsToR2([external], "trace");
    expect(persistSpy).toHaveBeenCalledTimes(1);
    expect(persistSpy).toHaveBeenCalledWith(external, "trace", 0);
    expect(out[0]).toMatch(/^https:\/\/cdn\.example\.com\/proxied\//);
  });

  it("混合输入 → 各自正确处理", async () => {
    const inputs = [
      "https://636c-cloudbase.tcb.qcloud.la/x.webp", // 外部 → 代理
      "https://cdn.example.com/already.png", // R2 → 跳过
      "data:image/jpeg;base64,/9j/4AAQ", // data: → 跳过
      undefined, // 占位
      "https://other-cdn.com/y.png", // 外部 → 代理
    ];
    const out = await proxyImageInputsToR2(inputs, "trace");
    expect(out).toHaveLength(5);
    expect(out[0]).toMatch(/^https:\/\/cdn\.example\.com\/proxied\//);
    expect(out[1]).toBe("https://cdn.example.com/already.png");
    expect(out[2]).toBe("data:image/jpeg;base64,/9j/4AAQ");
    expect(out[3]).toBeUndefined();
    expect(out[4]).toMatch(/^https:\/\/cdn\.example\.com\/proxied\//);
    expect(persistSpy).toHaveBeenCalledTimes(2);
  });

  it("保留输入顺序 + 长度(并行下载不乱序)", async () => {
    const urls = Array.from(
      { length: 8 },
      (_, i) => `https://external-${i}.tcb.qcloud.la/${i}.webp`
    );
    const out = await proxyImageInputsToR2(urls, "trace");
    expect(out).toHaveLength(8);
    out.forEach((u, i) => {
      expect(u).toMatch(/^https:\/\/cdn\.example\.com\/proxied\//);
      expect(decodeURIComponent(u!)).toContain(urls[i]);
    });
  });

  it("persistCandidateToR2 抛错 → 冒泡,不静默", async () => {
    persistSpy.mockRejectedValueOnce(new Error("下载失败:HTTP 403"));
    await expect(
      proxyImageInputsToR2(["https://external.tcb.qcloud.la/x.webp"], "trace")
    ).rejects.toThrow(/下载失败.*403/);
  });

  it("非 http(s) 协议(ws://, file://)→ 抛错,不穿透", async () => {
    await expect(
      proxyImageInputsToR2(["ws://example.com/socket"], "trace")
    ).rejects.toThrow(/不支持的协议/);
    await expect(
      proxyImageInputsToR2(["file:///etc/passwd"], "trace")
    ).rejects.toThrow(/不支持的协议/);
    // 都没走到 persistCandidateToR2
    expect(persistSpy).not.toHaveBeenCalled();
  });
});
