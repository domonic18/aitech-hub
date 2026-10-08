/**
 * COS 桶薄封装(M19 批②:备份异机存放 + 批③ 媒体迁移脚本共用):
 * 不绑 MediaStorage 接口——备份/迁移需要的是裸桶操作(put/head/get/delete/list,
 * 含分页列举)。key 原样 percent-encoded 不 decode(与 storage.ts 同一红线);
 * 缺对象 404 归一 null/false,其他错误(网络/权限)上抛——配错桶不能装作没文件。
 * 密钥仅 env;测试注入 fake client 不起真桶。
 */
import COS from "cos-nodejs-sdk-v5";

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

  /** 上传(key 原样;contentType 缺省 octet-stream,私有桶不面向浏览器) */
  async put(key: string, data: Uint8Array, contentType?: string): Promise<void> {
    await this.client.putObject({
      Bucket: this.bucket,
      Region: this.region,
      Key: key,
      Body: Buffer.from(data),
      ContentType: contentType ?? "application/octet-stream",
    });
  }

  /** 下载;缺对象 null */
  async get(key: string): Promise<Buffer | null> {
    try {
      const r = await this.client.getObject({ Bucket: this.bucket, Region: this.region, Key: key });
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
        Key: key,
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
    await this.client.deleteObject({ Bucket: this.bucket, Region: this.region, Key: key });
  }

  /** 前缀列举全量(内部分页,1000/页;迁移对账/演练取数用) */
  async listAll(prefix: string): Promise<CosObject[]> {
    const out: CosObject[] = [];
    let marker = "";
    for (;;) {
      const r = await this.client.getBucket({
        Bucket: this.bucket,
        Region: this.region,
        Prefix: prefix,
        Marker: marker,
        MaxKeys: 1000,
      });
      for (const c of r.Contents ?? []) {
        out.push({ key: c.Key, sizeBytes: Number(c.Size) });
      }
      const truncated = r.IsTruncated === "true";
      if (!truncated || !r.NextMarker) break;
      marker = r.NextMarker;
    }
    return out;
  }
}
