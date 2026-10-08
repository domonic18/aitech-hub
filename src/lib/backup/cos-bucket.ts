/**
 * COS 原语层(M19 批②:备份异机存放 + 批③ 媒体迁移脚本共用;storage.ts 亦复用):
 * 不绑 MediaStorage 接口——备份/迁移需要的是裸桶操作(put/head/get/delete/list,
 * 含分页列举)。仅依赖 COS SDK,零 env、零模块级副作用(可被任何测试链安全引入)。
 * key 红线:调用方传 percent-encoded byte 形态(盘名/DB/URL 侧),桶内经 cosWireKey
 * 转 COS 解码形态;缺对象 404 归一 null/false,其他错误(网络/权限)上抛——配错桶
 * 不能装作没文件。密钥仅 env;测试注入 fake client 不起真桶。
 */
import COS from "cos-nodejs-sdk-v5";

/**
 * 调用方 key(percent-encoded byte 形态)→ COS 对象 key 语义。
 * COS 服务端对请求 URI 恰好 decode 一次:对象 key 必须是**解码后 UTF-8 形态**
 * (「中文.png」),SDK(getUrl camSafeUrlEncode)线上会再编码回去。盘名/DB/URL 的
 * byte 形态红线不变(storage.ts)——转换只发生在 COS 边界。nginx 静态反代透传
 * 原始未解码 URI → COS 解码一次 → 命中。
 * 兼任对账归一:桶 listAll(不带 encoding-type)返回解码形态 key,本地清点是
 * byte 形态,两侧同过本函数落到可比空间。畸形 %(字面 % 非转义)decode 会抛
 * URIError → 原样保底,两侧口径一致。ASCII key decode 为自身,备份场景无感。
 */
export function cosWireKey(key: string): string {
  try {
    return decodeURIComponent(key);
  } catch {
    return key;
  }
}

export interface CosBucketOptions {
  secretId: string;
  secretKey: string;
  region: string;
  bucket: string;
}

export type CosBucketClient = Pick<
  InstanceType<typeof COS>,
  "putObject" | "getObject" | "headObject" | "deleteObject" | "getBucket"
>;

export interface CosObject {
  key: string;
  sizeBytes: number;
}

/** COS 缺对象错误口径:HTTP 404 或服务端码 NoSuchKey/NotFound */
export function isCosNotFound(err: unknown): boolean {
  const e = err as { statusCode?: number; code?: string } | null;
  return e?.statusCode === 404 || e?.code === "NoSuchKey" || e?.code === "NotFound";
}

export class CosBucket {
  private readonly client: CosBucketClient;
  private readonly region: string;
  private readonly bucket: string;

  constructor(options: CosBucketOptions, client?: CosBucketClient) {
    this.bucket = options.bucket;
    this.region = options.region;
    this.client = client ?? new COS({ SecretId: options.secretId, SecretKey: options.secretKey });
  }

  /**
   * 上传(key 走 cosWireKey;contentType 缺省 octet-stream;cacheControl 缺省
   * immutable——媒体不可变,备份桶私有无消费面,同值无害)
   */
  async put(
    key: string,
    data: Uint8Array,
    contentType?: string,
    cacheControl = "public, max-age=31536000, immutable",
  ): Promise<void> {
    await this.client.putObject({
      Bucket: this.bucket,
      Region: this.region,
      Key: cosWireKey(key),
      Body: Buffer.from(data),
      ContentType: contentType ?? "application/octet-stream",
      CacheControl: cacheControl,
    });
  }

  /** 下载;缺对象 null */
  async get(key: string): Promise<Buffer | null> {
    try {
      const r = await this.client.getObject({
        Bucket: this.bucket,
        Region: this.region,
        Key: cosWireKey(key),
      });
      return Buffer.from(r.Body);
    } catch (err) {
      if (isCosNotFound(err)) return null;
      throw err;
    }
  }

  /** 对象大小;缺对象 null */
  async stat(key: string): Promise<number | null> {
    try {
      const r = await this.client.headObject({
        Bucket: this.bucket,
        Region: this.region,
        Key: cosWireKey(key),
      });
      const len = Number(r.headers?.["content-length"] ?? NaN);
      return Number.isFinite(len) ? len : 0;
    } catch (err) {
      if (isCosNotFound(err)) return null;
      throw err;
    }
  }

  /** 删除(COS 删不存在 key 亦成功,天然幂等) */
  async delete(key: string): Promise<void> {
    await this.client.deleteObject({
      Bucket: this.bucket,
      Region: this.region,
      Key: cosWireKey(key),
    });
  }

  /**
   * 前缀列举全量(内部分页,1000/页;迁移对账/演练取数用)。
   * 不带 encoding-type 时 COS 返回的 Key/NextMarker 即解码形态,与对象 key 同一
   * 空间,Marker 沿响应值回传无需换算;NextMarker 缺省(无 delimiter 时)取本页
   * 末条 Key。对账归一口径见 cosWireKey。
   */
  async listAll(prefix: string): Promise<CosObject[]> {
    const out: CosObject[] = [];
    let marker = "";
    for (;;) {
      const r = await this.client.getBucket({
        Bucket: this.bucket,
        Region: this.region,
        Prefix: cosWireKey(prefix),
        Marker: marker,
        MaxKeys: 1000,
      });
      const contents = r.Contents ?? [];
      for (const c of contents) {
        out.push({ key: c.Key, sizeBytes: Number(c.Size) });
      }
      const truncated = r.IsTruncated === "true";
      if (!truncated) break;
      marker = r.NextMarker ?? contents[contents.length - 1]?.Key ?? "";
      if (!marker) break;
    }
    return out;
  }
}
