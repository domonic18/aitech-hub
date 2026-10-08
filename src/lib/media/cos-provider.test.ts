/**
 * CosProvider 单测(M19 批①,批④ 补 COS key 语义):调用方 relPath 为 percent-encoded
 * byte 形态(盘名/DB 红线不 decode),桶内 Key = wp-content/uploads/ 前缀 +
 * cosWireKey 解码形态(SDK 线上编码一次 + COS 服务端解码一次 = URL 路径原文,
 * 与 nginx 静态反代透传即命中同构);畸形 % 原样保底。put 带 ContentType/immutable、
 * 缺对象 404 → null/false 不抛、其他错误上抛、env 缺项人话报错、delete 幂等交 COS 语义。
 */
import { describe, expect, it, vi } from "vitest";

import { cosWireKey } from "../backup/cos-bucket";
import { COS_MEDIA_KEY_PREFIX, type CosClient, CosProvider, cosConfigFromEnv } from "./storage";

const PREFIX = COS_MEDIA_KEY_PREFIX;

const FULL_ENV = {
  COS_SECRET_ID: "id-x",
  COS_SECRET_KEY: "key-x",
  COS_REGION: "ap-guangzhou",
  COS_MEDIA_BUCKET: "aitech-media-1250000000",
};

/** fake COS 客户端:四方法可编程,默认全 404(新桶空态) */
function fakeClient(overrides: Partial<Record<keyof CosClient, unknown>> = {}): CosClient {
  const notFound = (params: { Key: string }) =>
    Promise.reject(Object.assign(new Error("NoSuchKey"), { code: "NoSuchKey", statusCode: 404 }));
  return {
    putObject: vi.fn().mockResolvedValue({ statusCode: 200 }),
    getObject: vi.fn(notFound),
    headObject: vi.fn(notFound),
    deleteObject: vi.fn().mockResolvedValue({ statusCode: 204 }),
    ...overrides,
  } as unknown as CosClient;
}

describe("cosConfigFromEnv", () => {
  it("配置齐 → 原样装配", () => {
    expect(cosConfigFromEnv(FULL_ENV)).toEqual({
      secretId: "id-x",
      secretKey: "key-x",
      region: "ap-guangzhou",
      bucket: "aitech-media-1250000000",
    });
  });

  it("缺项 → 一次列全人话报错(启动即拦)", () => {
    expect(() =>
      cosConfigFromEnv({
        COS_SECRET_ID: "id-x",
        COS_SECRET_KEY: "",
        COS_REGION: "",
        COS_MEDIA_BUCKET: "b",
      }),
    ).toThrow(/COS 配置缺失.*COS_SECRET_KEY\/COS_REGION/);
  });
});

describe("cosWireKey(key 语义边界)", () => {
  it("percent-encoded byte 形态 → 解码形态(SDK 线上会再编码回去)", () => {
    expect(cosWireKey("2024/04/%E4%B8%AD%E6%96%87.png")).toBe("2024/04/中文.png");
    expect(cosWireKey("2026/09/%e4%b8%ad%e6%96%87.png")).toBe("2026/09/中文.png");
    expect(cosWireKey("a%20b.png")).toBe("a b.png");
  });

  it("ASCII 无感;畸形 % 原样保底不抛(两侧对账同口径)", () => {
    expect(cosWireKey("2026/09/abc123.png")).toBe("2026/09/abc123.png");
    expect(cosWireKey("50%off.png")).toBe("50%off.png");
    expect(cosWireKey("2026/09/%E4%B8%AD.png")).toBe("2026/09/中.png");
  });
});

describe("CosProvider(注入 fake client)", () => {
  const config = { secretId: "id", secretKey: "key", region: "ap-guangzhou", bucket: "b-1" };

  it("put:relPath byte 形态 → 桶内前缀+解码 Key,带 Content-Type 与 immutable 缓存", async () => {
    const client = fakeClient();
    const store = new CosProvider(config, client);
    await store.put("2024/04/%E4%B8%AD%E6%96%87.png", new Uint8Array([9, 9]));
    expect(client.putObject).toHaveBeenCalledWith(
      expect.objectContaining({
        Bucket: "b-1",
        Region: "ap-guangzhou",
        Key: `${PREFIX}2024/04/中文.png`,
        ContentType: "image/png",
        CacheControl: "public, max-age=31536000, immutable",
      }),
    );
  });

  it("get:命中回 Buffer;404 → null 不抛", async () => {
    const client = fakeClient({
      getObject: vi.fn((p: { Key: string }) =>
        p.Key === `${PREFIX}a/b.png`
          ? Promise.resolve({ Body: Buffer.from([1, 2, 3]), statusCode: 200 })
          : Promise.reject(
              Object.assign(new Error("NoSuchKey"), { code: "NoSuchKey", statusCode: 404 }),
            ),
      ),
    });
    const store = new CosProvider(config, client);
    expect(await store.get("a/b.png")).toEqual(Buffer.from([1, 2, 3]));
    expect(await store.get("no/such.png")).toBeNull();
  });

  it("exists/size:headObject content-length;缺对象 false/null", async () => {
    const client = fakeClient({
      headObject: vi.fn((p: { Key: string }) =>
        p.Key === `${PREFIX}2026/09/x.png`
          ? Promise.resolve({ headers: { "content-length": "123" }, statusCode: 200 })
          : Promise.reject(
              Object.assign(new Error("NoSuchKey"), { code: "NoSuchKey", statusCode: 404 }),
            ),
      ),
    });
    const store = new CosProvider(config, client);
    expect(await store.exists("2026/09/x.png")).toBe(true);
    expect(await store.size("2026/09/x.png")).toBe(123);
    expect(await store.exists("no/such.png")).toBe(false);
    expect(await store.size("no/such.png")).toBeNull();
  });

  it("非 404 错误(网络/权限)上抛,不吞成 null", async () => {
    const boom = Object.assign(new Error("AccessDenied"), {
      code: "AccessDenied",
      statusCode: 403,
    });
    const store = new CosProvider(
      config,
      fakeClient({
        getObject: vi.fn().mockRejectedValue(boom),
        headObject: vi.fn().mockRejectedValue(boom),
      }),
    );
    await expect(store.get("a.png")).rejects.toThrow(/AccessDenied/);
    await expect(store.exists("a.png")).rejects.toThrow(/AccessDenied/);
  });

  it("delete:走 deleteObject(不存在 key COS 侧亦成功,天然幂等)", async () => {
    const client = fakeClient();
    const store = new CosProvider(config, client);
    await expect(store.delete("gone.png")).resolves.toBeUndefined();
    expect(client.deleteObject).toHaveBeenCalledWith(
      expect.objectContaining({ Bucket: "b-1", Key: `${PREFIX}gone.png` }),
    );
  });
});
