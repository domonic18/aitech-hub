/**
 * CosProvider 单测(M19 批①):key 原样 percent-encoded 不 decode(与盘名/URL 逐字节
 * 同构红线)、put 带 ContentType/immutable 缓存、缺对象 404 → null/false 不抛、
 * 其他错误上抛(配错桶不能装作没文件)、env 缺项人话报错、delete 幂等交由 COS 语义。
 */
import { describe, expect, it, vi } from "vitest";

import { type CosClient, CosProvider, cosConfigFromEnv } from "./storage";

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

describe("CosProvider(注入 fake client)", () => {
  const config = { secretId: "id", secretKey: "key", region: "ap-guangzhou", bucket: "b-1" };

  it("put:key 原样不 decode,带 Content-Type 与 immutable 缓存", async () => {
    const client = fakeClient();
    const store = new CosProvider(config, client);
    const key = "2024/04/%E4%B8%AD%E6%96%87.png"; // 小写/大写 hex 均原样
    await store.put(key, new Uint8Array([9, 9]));
    expect(client.putObject).toHaveBeenCalledWith(
      expect.objectContaining({
        Bucket: "b-1",
        Region: "ap-guangzhou",
        Key: key,
        ContentType: "image/png",
        CacheControl: "public, max-age=31536000, immutable",
      }),
    );
  });

  it("get:命中回 Buffer;404 → null 不抛", async () => {
    const client = fakeClient({
      getObject: vi.fn((p: { Key: string }) =>
        p.Key === "a/b.png"
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
        p.Key === "2026/09/x.png"
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
      expect.objectContaining({ Bucket: "b-1", Key: "gone.png" }),
    );
  });
});
