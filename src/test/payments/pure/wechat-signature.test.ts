import {
  createCipheriv,
  generateKeyPairSync,
  type KeyObject,
  randomBytes,
} from "node:crypto";

import { describe, expect, it } from "vitest";

/**
 * 微信支付 V3 签名与解密测试。
 *
 * 纯函数:`signature.ts` 里的东西 —— 零 DB、零网络、零 env。跑在 unit
 * project 里(`pnpm test:run --project=unit`)。
 *
 * ## 为什么这个必须测
 *
 * 微信 V3 的签名有三处**错了不报错、只是静默失败**的地方:
 *
 * 1. **待签字符串末尾的换行**。少一个 `\n`,微信就报 `SIGN_ERROR`。
 * 2. **签名用的 body 字节**。签完再 `JSON.stringify` 一次,键序可能不一样,
 *    签名就废了。
 * 3. **GCM 认证标签的位置**。密文最后 16 字节才是 tag,切错了要么解不出
 *    要么解出乱码。
 *
 * 这三处肉眼 review 看不出来(代码就那么几行,读起来都对),但线上每一处都
 * 意味着「下不了单」或「收不到钱」。所以得有测试钉住。
 */

import {
  buildAuthorizationHeader,
  buildNotifyVerifyMessage,
  buildSignMessage,
  decryptResource,
  isTimestampWithinTolerance,
  signWithPrivateKey,
  verifyNotifySignature,
  verifyWithPublicKey,
  WECHAT_GCM_AUTH_TAG_LENGTH,
  WECHAT_NOTIFY_TIMESTAMP_TOLERANCE_SECONDS,
  WECHAT_SIGN_TYPE,
} from "@/features/payments/providers/wechat/signature";

/** 现生成一对 RSA 2048 密钥 —— 测试不依赖任何固定密钥文件 */
function generateKeyPair() {
  return generateKeyPairSync("rsa", { modulusLength: 2048 });
}

/**
 * 导出成 PEM 字符串
 *
 * `KeyObject.export()` 的返回类型是 `string | Buffer`(取决于 format),
 * 这里统一成字符串 —— 传给签名函数的一定是 PEM 文本。
 */
function exportPem(key: KeyObject, type: "pkcs8" | "spki"): string {
  const pem = key.export({ type, format: "pem" });
  return typeof pem === "string" ? pem : pem.toString("utf8");
}

describe("微信支付 V3 签名", () => {
  describe("待签字符串", () => {
    it("是 `方法\\nURL\\n时间戳\\n随机串\\nbody\\n` —— 末尾那个换行不能丢", () => {
      const message = buildSignMessage({
        method: "POST",
        url: "/v3/pay/transactions/native",
        timestamp: "1700000000",
        nonce: "abc123",
        body: '{"appid":"wx1"}',
      });

      expect(message).toBe(
        'POST\n/v3/pay/transactions/native\n1700000000\nabc123\n{"appid":"wx1"}\n'
      );
    });

    it("body 为空时是连续两个换行(微信的 GET 口径)", () => {
      const message = buildSignMessage({
        method: "GET",
        url: "/v3/pay/transactions/out-trade-no/123",
        timestamp: "1700000000",
        nonce: "abc123",
        body: "",
      });

      expect(message).toBe(
        "GET\n/v3/pay/transactions/out-trade-no/123\n1700000000\nabc123\n\n"
      );
    });

    it("URL 只含路径 + 查询串,不带域名", () => {
      const message = buildSignMessage({
        method: "POST",
        url: "/v3/pay/transactions/native?foo=bar",
        timestamp: "1700000000",
        nonce: "n",
        body: "{}",
      });

      expect(message).toContain("\n/v3/pay/transactions/native?foo=bar\n");
      expect(message).not.toContain("https://");
      expect(message).not.toContain("api.mch.weixin.qq.com");
    });
  });

  describe("往返验签", () => {
    it("私钥签的、公钥能验过", () => {
      const { privateKey, publicKey } = generateKeyPair();
      const privatePem = exportPem(privateKey, "pkcs8");
      const publicPem = exportPem(publicKey, "spki");

      const message = buildSignMessage({
        method: "POST",
        url: "/v3/pay/transactions/native",
        timestamp: "1700000000",
        nonce: "abc123",
        body: '{"appid":"wx1"}',
      });

      const signature = signWithPrivateKey(message, privatePem);

      expect(verifyWithPublicKey(message, signature, publicPem)).toBe(true);
    });

    it("改一个字节就验不过", () => {
      const { privateKey, publicKey } = generateKeyPair();
      const privatePem = exportPem(privateKey, "pkcs8");
      const publicPem = exportPem(publicKey, "spki");

      const message = buildSignMessage({
        method: "POST",
        url: "/v3/pay/transactions/native",
        timestamp: "1700000000",
        nonce: "abc123",
        body: '{"appid":"wx1"}',
      });

      const signature = signWithPrivateKey(message, privatePem);

      // 报文改一个字符 —— 签名就对不上了
      const tampered = `${message.slice(0, -2)}X\n`;
      expect(verifyWithPublicKey(tampered, signature, publicPem)).toBe(false);
    });

    it("签名本身被改一个字节也验不过", () => {
      const { privateKey, publicKey } = generateKeyPair();
      const privatePem = exportPem(privateKey, "pkcs8");
      const publicPem = exportPem(publicKey, "spki");

      const message =
        "POST\n/v3/pay/transactions/native\n1700000000\nabc\n{}\n";
      const signature = signWithPrivateKey(message, privatePem);

      const bytes = Buffer.from(signature, "base64");
      bytes[0] = (bytes[0] ?? 0) ^ 0xff;
      const tampered = bytes.toString("base64");

      expect(verifyWithPublicKey(message, tampered, publicPem)).toBe(false);
    });

    it("公钥不合法 / 签名不是 base64 → false,不是抛错", () => {
      const message = "POST\n/x\n1\nn\n{}\n";

      expect(verifyWithPublicKey(message, "not-base64!!", "不是 PEM")).toBe(
        false
      );
    });

    it("私钥用 `\\n` 转义写成一行也能用", () => {
      const { privateKey, publicKey } = generateKeyPair();
      const privatePem = exportPem(privateKey, "pkcs8");
      const publicPem = exportPem(publicKey, "spki");

      // 环境变量里一行写不下 PEM,惯例是把换行写成 \n
      const escaped = privatePem.replace(/\n/g, "\\n");

      const message = "POST\n/x\n1\nn\n{}\n";
      const signature = signWithPrivateKey(message, escaped);

      expect(verifyWithPublicKey(message, signature, publicPem)).toBe(true);
    });
  });

  describe("Authorization 头", () => {
    it("拼成微信认的形状", () => {
      const header = buildAuthorizationHeader({
        mchId: "1900000109",
        nonce: "nonce123",
        signature: "sig==",
        timestamp: "1700000000",
        serialNo: "SERIAL123",
      });

      expect(header).toBe(
        `${WECHAT_SIGN_TYPE} mchid="1900000109",nonce_str="nonce123",` +
          `signature="sig==",timestamp="1700000000",serial_no="SERIAL123"`
      );
    });
  });

  describe("回调验签", () => {
    it("待签字符串是 `时间戳\\n随机串\\n原始报文\\n`", () => {
      const message = buildNotifyVerifyMessage("1700000000", "nonce", "{}");

      expect(message).toBe("1700000000\nnonce\n{}\n");
    });

    it("往返:验得过,改一个字节就验不过", () => {
      const { privateKey, publicKey } = generateKeyPair();
      const privatePem = exportPem(privateKey, "pkcs8");
      const publicPem = exportPem(publicKey, "spki");

      const rawBody = '{"resource":{"ciphertext":"xxx"}}';
      const timestamp = "1700000000";
      const nonce = "nonce123";

      const signature = signWithPrivateKey(
        buildNotifyVerifyMessage(timestamp, nonce, rawBody),
        privatePem
      );

      expect(
        verifyNotifySignature({
          timestamp,
          nonce,
          rawBody,
          signature,
          publicKeyPem: publicPem,
        })
      ).toBe(true);

      expect(
        verifyNotifySignature({
          timestamp,
          nonce,
          rawBody: `${rawBody} `,
          signature,
          publicKeyPem: publicPem,
        })
      ).toBe(false);
    });
  });

  describe("时间戳容差", () => {
    const now = 1_700_000_000;

    it("容差内的通过", () => {
      expect(isTimestampWithinTolerance(String(now), now)).toBe(true);
      expect(
        isTimestampWithinTolerance(
          String(now - WECHAT_NOTIFY_TIMESTAMP_TOLERANCE_SECONDS),
          now
        )
      ).toBe(true);
    });

    it("超过 5 分钟的拒绝(防重放)", () => {
      expect(
        isTimestampWithinTolerance(
          String(now - WECHAT_NOTIFY_TIMESTAMP_TOLERANCE_SECONDS - 1),
          now
        )
      ).toBe(false);
      expect(
        isTimestampWithinTolerance(
          String(now + WECHAT_NOTIFY_TIMESTAMP_TOLERANCE_SECONDS + 1),
          now
        )
      ).toBe(false);
    });

    it("容差就是 300 秒", () => {
      expect(WECHAT_NOTIFY_TIMESTAMP_TOLERANCE_SECONDS).toBe(300);
    });

    it("时间戳不是数字 → 拒", () => {
      expect(isTimestampWithinTolerance("not-a-timestamp", now)).toBe(false);
      expect(isTimestampWithinTolerance("", now)).toBe(false);
    });
  });
});

describe("微信支付 V3 回调解密", () => {
  /** 按微信的格式造一份密文:密文 + 认证标签,一起 base64 */
  function encryptForTest(params: {
    plaintext: string;
    nonce: string;
    associatedData: string;
    apiV3Key: string;
  }): string {
    // 用与被测代码无关的方式手写一遍加密,免得两边错得一样而测不出来
    const cipher = createCipheriv(
      "aes-256-gcm",
      Buffer.from(params.apiV3Key, "utf8"),
      Buffer.from(params.nonce, "utf8")
    );
    cipher.setAAD(Buffer.from(params.associatedData, "utf8"));
    const encrypted = Buffer.concat([
      cipher.update(Buffer.from(params.plaintext, "utf8")),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([encrypted, authTag]).toString("base64");
  }

  const apiV3Key = "0123456789abcdef0123456789abcdef";

  it("解密出来的内容跟原文一致", () => {
    const plaintext = JSON.stringify({
      mchid: "1900000109",
      appid: "wx123",
      out_trade_no: "SO-20261105-942D88",
      transaction_id: "4200001234202311012345",
      trade_state: "SUCCESS",
    });
    const nonce = "abcdefghijkl";

    const ciphertext = encryptForTest({
      plaintext,
      nonce,
      associatedData: "transaction",
      apiV3Key,
    });

    const decrypted = decryptResource({
      ciphertext,
      nonce,
      associatedData: "transaction",
      apiV3Key,
    });

    expect(decrypted).toBe(plaintext);
    expect(JSON.parse(decrypted).trade_state).toBe("SUCCESS");
  });

  it("认证标签在密文最后 16 字节", () => {
    const nonce = "abcdefghijkl";
    const ciphertext = encryptForTest({
      plaintext: "hello",
      nonce,
      associatedData: "transaction",
      apiV3Key,
    });

    const raw = Buffer.from(ciphertext, "base64");

    // 长度 = 明文长度 + 认证标签长度
    expect(raw.length).toBe(5 + WECHAT_GCM_AUTH_TAG_LENGTH);
  });

  it("密钥不对 → 解密失败(抛错,不返回乱码)", () => {
    const nonce = "abcdefghijkl";
    const ciphertext = encryptForTest({
      plaintext: "hello",
      nonce,
      associatedData: "transaction",
      apiV3Key,
    });

    expect(() =>
      decryptResource({
        ciphertext,
        nonce,
        associatedData: "transaction",
        apiV3Key: "ffffffffffffffffffffffffffffffff",
      })
    ).toThrow();
  });

  it("associated_data 不对 → 解密失败", () => {
    const nonce = "abcdefghijkl";
    const ciphertext = encryptForTest({
      plaintext: "hello",
      nonce,
      associatedData: "transaction",
      apiV3Key,
    });

    expect(() =>
      decryptResource({
        ciphertext,
        nonce,
        associatedData: "wrong",
        apiV3Key,
      })
    ).toThrow();
  });

  it("APIv3 密钥不是 32 字节 → 直接报错(而不是解出乱码)", () => {
    expect(() =>
      decryptResource({
        ciphertext: randomBytes(64).toString("base64"),
        nonce: "abcdefghijkl",
        associatedData: "transaction",
        apiV3Key: "too-short",
      })
    ).toThrow(/32/);
  });
});
