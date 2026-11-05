import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Shopify 凭据 —— 2026-01-01 起的新模型
 *
 * ## 背景
 *
 * Shopify 从 2026-01-01 起**不再给永久 token**:新 app 一律在 Dev Dashboard
 * 里建,给的是 **Client ID + Client Secret**。Admin API 的 token 改用
 * **client credentials grant** 去换(有效期 24 小时)。
 *
 * 2026-11-05 线上踩过的那个 503 就是栽在这儿:环境变量里配的是新的
 * Client ID / Client Secret,而代码只认旧的永久 token ——「配了但用不上」。
 *
 * ## 这个文件守住什么
 *
 * 1. **验签密钥** = Client Secret(旧路的 `SHOPIFY_API_SECRET` 优先)
 * 2. **「配好了没」** —— token 的路子 + 验签密钥,两样都要齐
 * 3. **token 怎么换** —— 请求体对不对、缓存生效吗、并发会不会换好几次
 * 4. **失败分两类** —— 4xx 是「没配好」(重试没用),5xx / 网络不通是
 *    「这次挂了」(重试就能好)
 *
 * 纯模块:不碰 DB、不碰真实网络(`fetch` 是桩)。跑在 unit project 里。
 */

type EnvModule = typeof import("@/features/payments/providers/shopify/env");
type TypesModule = typeof import("@/features/payments/lib/types");
type ClientModule =
  typeof import("@/features/payments/providers/shopify/client");

/**
 * 重新加载 env 模块
 *
 * **必须重新加载** —— env.ts 里有模块级的 token 缓存 / 单飞状态,不清掉
 * 的话上一个用例的缓存会漏进下一个用例。
 *
 * `types.ts` 也跟着重新加载了(它被 env.ts import)—— 所以**错误类要用
 * 这里返回的那份**,静态 import 的那份是另一个类对象,`instanceof` 不成立。
 */
async function loadShopify(): Promise<{
  env: EnvModule;
  types: TypesModule;
}> {
  vi.resetModules();
  const env = await import("@/features/payments/providers/shopify/env");
  const types = await import("@/features/payments/lib/types");
  return { env, types };
}

/** 连 client 一起加载 —— client.ts 也 import 了 env.ts(拿 token) */
async function loadShopifyWithClient(): Promise<{
  env: EnvModule;
  types: TypesModule;
  client: ClientModule;
}> {
  vi.resetModules();
  const env = await import("@/features/payments/providers/shopify/env");
  const types = await import("@/features/payments/lib/types");
  const client = await import("@/features/payments/providers/shopify/client");
  return { env, types, client };
}

/** 记下原始环境变量,每个用例之后还原 */
const ORIGINAL_ENV = { ...process.env };

const SHOPIFY_ENV_KEYS = [
  "SHOPIFY_STORE_DOMAIN",
  "SHOPIFY_CLIENT_ID",
  "SHOPIFY_CLIENT_SECRET",
  "SHOPIFY_ADMIN_ACCESS_TOKEN",
  "SHOPIFY_API_SECRET",
] as const;

function setShopifyEnv(
  vars: Partial<Record<string, string | undefined>>
): void {
  for (const key of SHOPIFY_ENV_KEYS) {
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) continue;
    process.env[key] = value;
  }
}

/** 新模型下的最小配置 */
const NEW_MODEL_ENV = {
  SHOPIFY_STORE_DOMAIN: "demo-shop.myshopify.com",
  SHOPIFY_CLIENT_ID: "client-id-123",
  SHOPIFY_CLIENT_SECRET: "client-secret-456",
};

/** 一个成功的 grant 响应 */
function grantResponse(
  body: Record<string, unknown> = {
    access_token: "shpat_granted",
    token_type: "Bearer",
    expires_in: 86400,
  },
  status = 200
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  setShopifyEnv(NEW_MODEL_ENV);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const key of SHOPIFY_ENV_KEYS) {
    const original = ORIGINAL_ENV[key];
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
});

describe("getShopifyApiSecret —— webhook 的验签密钥", () => {
  it("新模型下就是 Client Secret", async () => {
    const { env } = await loadShopify();
    expect(env.getShopifyApiSecret()).toBe("client-secret-456");
  });

  it("旧路显式配了 SHOPIFY_API_SECRET 就优先用它", async () => {
    setShopifyEnv({ ...NEW_MODEL_ENV, SHOPIFY_API_SECRET: "legacy-secret" });
    const { env } = await loadShopify();
    expect(env.getShopifyApiSecret()).toBe("legacy-secret");
  });

  it("两个都没有 → 抛「没配好」", async () => {
    setShopifyEnv({ SHOPIFY_STORE_DOMAIN: "demo-shop.myshopify.com" });
    const { env } = await loadShopify();
    expect(() => env.getShopifyApiSecret()).toThrow(
      env.ShopifyNotConfiguredError
    );
  });
});

describe("isShopifyConfigured —— 「配好了没」", () => {
  it("新模型配齐了 → true", async () => {
    const { env } = await loadShopify();
    expect(env.isShopifyConfigured()).toBe(true);
  });

  it("缺 Client Secret → false(界面上是灰的、选不了)", async () => {
    setShopifyEnv({
      SHOPIFY_STORE_DOMAIN: "demo-shop.myshopify.com",
      SHOPIFY_CLIENT_ID: "client-id-123",
    });
    const { env } = await loadShopify();
    expect(env.isShopifyConfigured()).toBe(false);
  });

  it("缺店铺域名 → false", async () => {
    setShopifyEnv({
      SHOPIFY_CLIENT_ID: "client-id-123",
      SHOPIFY_CLIENT_SECRET: "client-secret-456",
    });
    const { env } = await loadShopify();
    expect(env.isShopifyConfigured()).toBe(false);
  });

  it("旧路:有永久 token + 域名 + 验签密钥 → true", async () => {
    setShopifyEnv({
      SHOPIFY_STORE_DOMAIN: "demo-shop.myshopify.com",
      SHOPIFY_ADMIN_ACCESS_TOKEN: "shpat_permanent",
      SHOPIFY_API_SECRET: "legacy-secret",
    });
    const { env } = await loadShopify();
    expect(env.isShopifyConfigured()).toBe(true);
  });

  it("凭据齐 → true(店铺能不能收人民币**这里查不了**,建单那一步才报)", async () => {
    // 币种要问 Shopify,而 isConfigured() 是同步的(界面要立刻知道能不能选)
    // —— 所以这里不查,建单那一步报得很清楚(见 shopify-currency.test.ts)
    setShopifyEnv({
      SHOPIFY_STORE_DOMAIN: "demo-shop.myshopify.com",
      SHOPIFY_CLIENT_ID: "client-id-123",
      SHOPIFY_CLIENT_SECRET: "client-secret-456",
    });
    const { env } = await loadShopify();
    expect(env.isShopifyConfigured()).toBe(true);
  });

  it("旧路:有永久 token 但**没有验签密钥** → false", async () => {
    // 回调验不过签的话,用户付了钱订单永远不会变「已付」—— 不算配好
    setShopifyEnv({
      SHOPIFY_STORE_DOMAIN: "demo-shop.myshopify.com",
      SHOPIFY_ADMIN_ACCESS_TOKEN: "shpat_permanent",
    });
    const { env } = await loadShopify();
    expect(env.isShopifyConfigured()).toBe(false);
  });

  it("什么都没配 → false", async () => {
    setShopifyEnv({});
    const { env } = await loadShopify();
    expect(env.isShopifyConfigured()).toBe(false);
  });
});

describe("getShopifyAdminToken —— client credentials grant", () => {
  it("拿到的 token 是 grant 返回的那个", async () => {
    const fetchMock = vi.fn().mockResolvedValue(grantResponse());
    vi.stubGlobal("fetch", fetchMock);

    const { env } = await loadShopify();
    expect(await env.getShopifyAdminToken()).toBe("shpat_granted");
  });

  it("请求体是 client_credentials 那一套", async () => {
    const fetchMock = vi.fn().mockResolvedValue(grantResponse());
    vi.stubGlobal("fetch", fetchMock);

    const { env } = await loadShopify();
    await env.getShopifyAdminToken();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://demo-shop.myshopify.com/admin/oauth/access_token"
    );
    expect(init.method).toBe("POST");
    const body = new URLSearchParams(String(init.body));
    expect(body.get("grant_type")).toBe("client_credentials");
    expect(body.get("client_id")).toBe("client-id-123");
    expect(body.get("client_secret")).toBe("client-secret-456");
  });

  it("旧路的永久 token 优先 —— 根本不联网", async () => {
    setShopifyEnv({
      ...NEW_MODEL_ENV,
      SHOPIFY_ADMIN_ACCESS_TOKEN: "shpat_permanent",
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { env } = await loadShopify();
    expect(await env.getShopifyAdminToken()).toBe("shpat_permanent");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("token 有缓存 —— 第二次调用不再发请求", async () => {
    const fetchMock = vi.fn().mockResolvedValue(grantResponse());
    vi.stubGlobal("fetch", fetchMock);

    const { env } = await loadShopify();
    await env.getShopifyAdminToken();
    await env.getShopifyAdminToken();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("并发调用只换一次 —— 单飞", async () => {
    const fetchMock = vi.fn().mockResolvedValue(grantResponse());
    vi.stubGlobal("fetch", fetchMock);

    const { env } = await loadShopify();
    const [a, b] = await Promise.all([
      env.getShopifyAdminToken(),
      env.getShopifyAdminToken(),
    ]);

    expect(a).toBe("shpat_granted");
    expect(b).toBe("shpat_granted");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("有效期比「提前量」还短 → 下次调用重新换", async () => {
    // 提前 5 分钟就换 —— 给的 60 秒有效期直接落在提前量里
    // 每次都要给一个**新的** Response:body 只能读一次
    const fetchMock = vi
      .fn()
      .mockImplementation(async () =>
        grantResponse({ access_token: "shpat_granted", expires_in: 60 })
      );
    vi.stubGlobal("fetch", fetchMock);

    const { env } = await loadShopify();
    await env.getShopifyAdminToken();
    await env.getShopifyAdminToken();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("4xx = 「没配好」—— 重试没用", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "app_not_installed" }), {
        status: 404,
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const { env } = await loadShopify();
    await expect(env.getShopifyAdminToken()).rejects.toThrow(
      env.ShopifyNotConfiguredError
    );
  });

  it("5xx = 「这次挂了」—— 重试就能好", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("upstream boom", { status: 502 }));
    vi.stubGlobal("fetch", fetchMock);

    const { env, types } = await loadShopify();
    await expect(env.getShopifyAdminToken()).rejects.toThrow(
      types.PaymentProviderError
    );
  });

  it("网络不通 = 「这次挂了」", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    vi.stubGlobal("fetch", fetchMock);

    const { env, types } = await loadShopify();
    await expect(env.getShopifyAdminToken()).rejects.toThrow(
      types.PaymentProviderError
    );
  });

  it("换了 token 之后失败也不缓存 —— 下次还能重试", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("boom", { status: 500 }))
      .mockResolvedValueOnce(grantResponse());
    vi.stubGlobal("fetch", fetchMock);

    const { env } = await loadShopify();
    await expect(env.getShopifyAdminToken()).rejects.toThrow();
    expect(await env.getShopifyAdminToken()).toBe("shpat_granted");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("shopifyGraphql —— 失败怎么归类", () => {
  /**
   * 桩 fetch:grant 那次给 token,GraphQL 那次给指定的响应
   */
  function stubFetch(graphqlResponse: () => Response) {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/admin/oauth/access_token")) return grantResponse();
      return graphqlResponse();
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("401 = 「没配好」—— 凭据 / token 被拒,重试没用", async () => {
    stubFetch(() => new Response("Unauthorized", { status: 401 }));

    const { env, client } = await loadShopifyWithClient();
    await expect(
      client.shopifyGraphql("query Q { shop { name } }", {})
    ).rejects.toThrow(env.ShopifyNotConfiguredError);
  });

  it("403 = 「没配好」—— scope 不够,重试没用", async () => {
    stubFetch(() => new Response("Forbidden", { status: 403 }));

    const { env, client } = await loadShopifyWithClient();
    await expect(
      client.shopifyGraphql("query Q { shop { name } }", {})
    ).rejects.toThrow(env.ShopifyNotConfiguredError);
  });

  it("500 = 「这次挂了」—— 重试就能好", async () => {
    stubFetch(() => new Response("boom", { status: 500 }));

    const { types, client } = await loadShopifyWithClient();
    await expect(
      client.shopifyGraphql("query Q { shop { name } }", {})
    ).rejects.toThrow(types.PaymentProviderError);
  });

  it("429(限流)= 「这次挂了」", async () => {
    stubFetch(() => new Response("slow down", { status: 429 }));

    const { types, client } = await loadShopifyWithClient();
    await expect(
      client.shopifyGraphql("query Q { shop { name } }", {})
    ).rejects.toThrow(types.PaymentProviderError);
  });
});
