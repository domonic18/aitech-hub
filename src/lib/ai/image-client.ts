/**
 * 文生图客户端(M14 批⑥,验收反馈问题6):OpenAI images/generations 兼容协议。
 * POST {baseUrl}/images/generations,body {model, prompt, n, size,
 * response_format:"b64_json"},Bearer 鉴权。协议门禁仅 openai——混元/豆包等
 * 原生签名协议不入本仓(与 LLM 侧同纪律),经其 OpenAI 兼容网关接入;
 * 仅回 b64_json 形态(url 直链形态转存涉及外链抓取策略,留给兼容网关侧)。
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
}

export interface GeneratedImage {
  b64: string;
}

export async function generateImages(input: GenerateImagesInput): Promise<GeneratedImage[]> {
  if (input.protocol !== AI_PROTOCOL_OPENAI) {
    throw new AiClientError(
      "unsupported",
      `生图协议不支持(${input.protocol}):需 OpenAI images/generations 兼容端点`,
    );
  }
  if (!input.baseUrl) throw new AiClientError("unsupported", "生图 Base URL 未配置");
  const url = `${input.baseUrl.replace(/\/+$/, "")}/images/generations`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), input.timeoutSec * 1000);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(input.apiKey ? { authorization: `Bearer ${input.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: input.modelId,
        prompt: input.prompt,
        n: input.n,
        size: input.size,
        response_format: "b64_json",
      }),
      signal: ctrl.signal,
    });
  } catch (e) {
    if (ctrl.signal.aborted) {
      throw new AiClientError("timeout", `生图超时(${input.timeoutSec}s)`);
    }
    throw new AiClientError("http", `生图请求失败:${e instanceof Error ? e.message : String(e)}`);
  } finally {
    clearTimeout(timer);
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
  const rows = (body as { data?: Array<{ b64_json?: unknown }> }).data;
  if (!Array.isArray(rows)) throw new AiClientError("business", "生图响应缺 data 数组(契约漂移)");
  const images = rows
    .map((r) => (typeof r?.b64_json === "string" ? r.b64_json : ""))
    .filter((b) => b.length > 0);
  if (images.length === 0) {
    throw new AiClientError(
      "business",
      "生图响应无 b64_json(供应商返回 url 形态,需 OpenAI 兼容网关转换)",
    );
  }
  return images.map((b64) => ({ b64 }));
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
