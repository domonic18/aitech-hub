/**
 * 文生图客户端(M14 批⑥,验收反馈问题6;2026-10-06 M16 反馈问题1/2 扩):
 * OpenAI images/generations 兼容协议。POST {baseUrl}/images/generations,
 * Bearer 鉴权。协议门禁仅 openai——混元/豆包等原生签名协议不入本仓(与 LLM 侧
 * 同纪律),经其 OpenAI 兼容网关接入。
 * 响应两种形态都收(M16 问题1:智谱 CogView 只回 url 且忽略 response_format):
 * b64_json 直解;url 由服务端转存(免签名 URL 过期,不外链)。Authorization
 * 不外发下载请求(防密钥泄漏给第三方 CDN)。
 * 部分供应商(智谱)无 n 参数、单次仅回 1 张:返回不足 n 时顺序补请求凑满候选。
 * 扩展参数(M16 问题2):模型 extra_params 浅合并进请求体,保留键不可覆盖。
 * 超时/网络/HTTP/业务错归因与 llm-client 同款(AiClientError kind)。
 */
import { AI_PROTOCOL_OPENAI } from "./constants";
import { AiClientError } from "./errors";

export interface GenerateImagesInput {
  protocol: string;
  baseUrl: string | null;
  modelId: string;
  apiKey: string | null;
  prompt: string;
  /** 候选张数(一次请求多张,供应商计费按张) */
  n: number;
  /** 分辨率 WxH(需供应商支持;默认 1344×768,混元原生档) */
  size: string;
  timeoutSec: number;
  /** 供应商扩展参数(模型台账配置;浅合并,保留键 model/prompt/n/size/response_format 不可覆盖) */
  extraParams?: Record<string, unknown>;
}

/** 单张结果:b64 直解形态或 url 待转存形态(调用侧统一转 bytes) */
export type GeneratedImage = { b64: string } | { url: string };

/** 请求体保留键 model/prompt/n/size/response_format:extraParams 先展开、保留键后展开,
 * 后者恒覆盖前者(扩展参数不可改写契约,防配置把请求体改漂;单测锁定) */

/** url 下载体积帽(生图 1344×768 jpg ≈ 200KB;20MB 已是数量级冗余) */
const DOWNLOAD_MAX_BYTES = 20 * 1024 * 1024;

function postImages(
  url: string,
  apiKey: string | null,
  body: Record<string, unknown>,
  timeoutSec: number,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutSec * 1000);
  return fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify(body),
    signal: ctrl.signal,
  }).finally(() => clearTimeout(timer));
}

export async function generateImages(input: GenerateImagesInput): Promise<GeneratedImage[]> {
  if (input.protocol !== AI_PROTOCOL_OPENAI) {
    throw new AiClientError(
      "unsupported",
      `生图协议不支持(${input.protocol}):需 OpenAI images/generations 兼容端点`,
    );
  }
  if (!input.baseUrl) throw new AiClientError("unsupported", "生图 Base URL 未配置");
  const endpoint = `${input.baseUrl.replace(/\/+$/, "")}/images/generations`;
  const baseBody: Record<string, unknown> = {
    ...(input.extraParams ?? {}),
    model: input.modelId,
    prompt: input.prompt,
    n: input.n,
    size: input.size,
    response_format: "b64_json",
  };

  const collected: GeneratedImage[] = [];
  // 请求轮次帽:首轮 n 张 + 至多 2 轮补齐(单图供应商两轮即满;防病兜端点拖死 worker)
  for (let round = 0; round < 1 + 2 && collected.length < input.n; round++) {
    const remain = input.n - collected.length;
    let res: Response;
    try {
      res = await postImages(endpoint, input.apiKey, { ...baseBody, n: remain }, input.timeoutSec);
    } catch (e) {
      if (e instanceof AiClientError) throw e;
      const aborted = e instanceof Error && e.name === "AbortError";
      throw new AiClientError(
        aborted ? "timeout" : "http",
        aborted
          ? `生图超时(${input.timeoutSec}s)`
          : `生图请求失败:${e instanceof Error ? e.message : String(e)}`,
      );
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new AiClientError("http", `生图 HTTP ${res.status}:${text.slice(0, 200)}`);
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new AiClientError("business", "生图响应不是 JSON");
    }
    const rows = (body as { data?: unknown }).data;
    if (!Array.isArray(rows)) throw new AiClientError("business", "生图响应缺 data 数组(契约漂移)");
    for (const r of rows) {
      const row = r as { b64_json?: unknown; url?: unknown };
      if (typeof row?.b64_json === "string" && row.b64_json.length > 0) {
        collected.push({ b64: row.b64_json });
      } else if (
        typeof row?.url === "string" &&
        /^https:\/\//.test(row.url) &&
        row.url.length < 2000
      ) {
        collected.push({ url: row.url });
      }
    }
    if (rows.length === 0) break; // 供应商明确回空:补请求也无益
  }
  if (collected.length === 0) {
    throw new AiClientError(
      "business",
      "生图响应无 b64_json/url 图片数据(契约漂移,检查供应商与模型 ID)",
    );
  }
  return collected;
}

/** url 形态转存(M16 问题1):GET 下载为 bytes;不带 Authorization(签名 URL 自含鉴权) */
export async function downloadImage(url: string, timeoutSec: number): Promise<Uint8Array> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutSec * 1000);
  let res: Response;
  try {
    res = await fetch(url, { signal: ctrl.signal });
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    throw new AiClientError(
      aborted ? "timeout" : "http",
      aborted
        ? `生图 url 转存超时(${timeoutSec}s)`
        : `生图 url 转存失败:${e instanceof Error ? e.message : String(e)}`,
    );
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new AiClientError("http", `生图 url 转存 HTTP ${res.status}`);
  const len = Number(res.headers.get("content-length") ?? "0");
  if (len > DOWNLOAD_MAX_BYTES) throw new AiClientError("business", "生图 url 转存超过体积帽");
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.length === 0) throw new AiClientError("business", "生图 url 转存为空");
  if (buf.length > DOWNLOAD_MAX_BYTES)
    throw new AiClientError("business", "生图 url 转存超过体积帽");
  return buf;
}

/** b64 → 字节(容 data: 前缀形态);非法 b64 抛业务错 */
export function decodeImageB64(b64: string): Uint8Array {
  const raw = b64.includes(",") ? b64.slice(b64.indexOf(",") + 1) : b64;
  const buf = Buffer.from(raw, "base64");
  if (buf.length === 0) throw new AiClientError("business", "生图数据解码为空");
  return new Uint8Array(buf);
}

/** 魔数嗅探图片 mime(uploadMedia 白名单:png/jpeg/webp;其余拒绝) */
export function sniffImageMime(bytes: Uint8Array): "image/png" | "image/jpeg" | "image/webp" {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[8] === 0x57) return "image/webp";
  throw new AiClientError("business", "生图返回了不支持的图片格式(仅 png/jpeg/webp)");
}
