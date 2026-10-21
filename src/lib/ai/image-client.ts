/**
 * 文生图客户端(M14 批⑥,验收反馈问题6;2026-10-06 M16 反馈问题1/2 扩;
 * 2026-10-21 M39 扩 AiHubMix 形态):OpenAI images/generations 兼容协议。
 * POST {baseUrl}/images/generations,Bearer 鉴权。协议门禁仅 openai——
 * 混元/豆包等原生签名协议不入本仓(与 LLM 侧同纪律),经其 OpenAI 兼容网关
 * 接入(nano banana 即经 AiHubMix 网关,topic-pipeline-plan §13)。
 * 响应三种形态都收(M16 问题1:智谱 CogView 只回 url 且忽略 response_format;
 * M39:AiHubMix 回 output[] 数组且条目键为 content_url):OpenAI `data[]` 与
 * AiHubMix `output[]` 双数组等价解析,条目 b64_json 直解;url/content_url 由
 * 服务端转存(免签名 URL 过期,不外链)。解析单源 parseImagesResponse——
 * generateImages 与 probeImages 共用(E2 收口,供应商新形态只改一处)。
 * 下载鉴权纪律:默认不带 Authorization
 * (防密钥泄漏给第三方 CDN);收窄例外=同源下载(M39 AiHubMix content_url 须带
 * 同 key,约 30 分钟过期)——仅当下载 URL 宿主与网关 baseUrl 宿主一致才带,
 * 密钥不出同一供应商边界。
 * 部分供应商(智谱)无 n 参数、单次仅回 1 张:返回不足 n 时顺序补请求凑满候选。
 * 扩展参数(M16 问题2):模型 extra_params 浅合并进请求体,保留键不可覆盖;
 * 保留键显式 null = 整键剔除(M39 严格校验供应商适配,如 AiHubMix 拒收
 * size/response_format)。超时/网络/HTTP/业务错归因与 llm-client 同款(AiClientError kind)。
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
  /** 参照图 data URL(M39 批③:Seedream 原生 image 参数,出图向参照风格靠拢;
   * 仅传入时进请求体顶层;拒收型供应商会回 400——换绑前先探针) */
  image?: string;
}

/** 单张结果:b64 直解形态或 url 待转存形态(调用侧统一转 bytes) */
export type GeneratedImage = { b64: string } | { url: string };

/** 请求体保留键 model/prompt/n/size/response_format:extraParams 先展开、保留键后展开,
 * 后者恒覆盖前者(扩展参数不可改写契约,防配置把请求体改漂;单测锁定)。
 * M39 补充:extraParams 某保留键显式 null = 该键整体剔除——严格校验供应商适配
 * (探针实证 AiHubMix nano-banana 拒收 size/response_format 回 400 Unknown
 * request parameter),null 值本身不进请求体;与探针共用本构造器保证同口径。 */

export interface ImagesBodyKeys {
  model: string;
  prompt: string;
  n: number;
  size: string;
  response_format: string;
}

/** 生图请求体构造(image-client 与 probe 同源):保留键缺省在场,extraParams
 * 非 null 键先展开(保留键恒覆盖)、null 键仅作剔除指令不透传 */
export function buildImagesBody(
  keys: ImagesBodyKeys,
  extraParams?: Record<string, unknown>,
): Record<string, unknown> {
  const extra = Object.fromEntries(Object.entries(extraParams ?? {}).filter(([, v]) => v !== null));
  const omit = new Set(
    Object.entries(extraParams ?? {})
      .filter(([, v]) => v === null)
      .map(([k]) => k),
  );
  const preserved = Object.fromEntries(Object.entries(keys).filter(([k]) => !omit.has(k)));
  return { ...extra, ...preserved };
}

/** 响应单行(双供应商形态并集):b64 直解,或 url/content_url 待转存 */
interface ImagesResponseRow {
  b64_json?: unknown;
  url?: unknown;
  content_url?: unknown;
}

export interface ParsedImagesResponse {
  /** 行级校验通过的图片(url 形态已过 https+长度门) */
  images: GeneratedImage[];
  /** HTTP 200 体携顶层 {error} 文案的业务错(AiHubMix 形态),无则 null */
  bizError: string | null;
  /** data[]/output[] 数组是否在场(缺 = 契约漂移,补请求无益) */
  hasRows: boolean;
}

/** 行级归一:b64 非空串直解优先;url/content_url 须 https 且 <2000(转存口径)。 */
function parseImageRow(row: ImagesResponseRow | undefined): GeneratedImage | null {
  if (typeof row?.b64_json === "string" && row.b64_json.length > 0) return { b64: row.b64_json };
  const link =
    typeof row?.url === "string"
      ? row.url
      : typeof row?.content_url === "string"
        ? row.content_url
        : null;
  return link !== null && /^https:\/\//.test(link) && link.length < 2000 ? { url: link } : null;
}

/**
 * 生图响应解析单源(generateImages 与 probeImages 共用;M39 双形态收编,后续
 * 供应商新响应形态只改这里):OpenAI `data[]`(b64_json|url)与 AiHubMix
 * `output[]`(b64_json|content_url)等价解析,data 优先不歧义;单行脏数据跳过
 * 不再弃全轮;顶层 error 文案透传给调用方拼业务错。
 */
export function parseImagesResponse(body: unknown): ParsedImagesResponse {
  const shell = body as { data?: unknown; output?: unknown; error?: unknown };
  const bizError =
    typeof shell.error === "string" && shell.error.trim() !== "" ? shell.error : null;
  const rows = Array.isArray(shell.data)
    ? shell.data
    : Array.isArray(shell.output)
      ? shell.output
      : null;
  if (rows === null) return { images: [], bizError, hasRows: false };
  const images: GeneratedImage[] = [];
  for (const r of rows) {
    const img = parseImageRow(r as ImagesResponseRow | undefined);
    if (img) images.push(img);
  }
  return { images, bizError, hasRows: true };
}

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
  const baseBody = buildImagesBody(
    {
      model: input.modelId,
      prompt: input.prompt,
      n: input.n,
      size: input.size,
      response_format: "b64_json",
    },
    input.extraParams,
  );
  // 参照图(M39 批③)仅传入时附加在请求体顶层(openai 协议外置键,不占保留键契约;
  // 不进 extraParams 合并语义——调用侧显式给才带,防模型台账误配出参照图)
  const reqBody = input.image ? { ...baseBody, image: input.image } : baseBody;

  const collected: GeneratedImage[] = [];
  let lastBizError: string | null = null; // AiHubMix 形态:{error} 文案随 200 回,末轮无图时透传
  // 请求轮次帽:首轮 n 张 + 至多 2 轮补齐(单图供应商两轮即满;防病兜端点拖死 worker)
  for (let round = 0; round < 1 + 2 && collected.length < input.n; round++) {
    const remain = input.n - collected.length;
    let res: Response;
    try {
      res = await postImages(endpoint, input.apiKey, { ...reqBody, n: remain }, input.timeoutSec);
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
    // 双数组等价解析单源(E2 收口:与 probeImages 共用 parseImagesResponse)
    const parsed = parseImagesResponse(body);
    lastBizError = parsed.bizError;
    if (!parsed.hasRows) {
      // AiHubMix 业务错可能随 HTTP 200 回 {error}:有文案就透传,无则报契约漂移
      throw new AiClientError(
        "business",
        parsed.bizError ? `生图失败:${parsed.bizError}` : "生图响应缺 data/output 数组(契约漂移)",
      );
    }
    collected.push(...parsed.images);
    if (parsed.images.length === 0) {
      // 空数组(供应商明确回空,补请求无益)或行全非法:立即失败,不烧补齐轮
      throw new AiClientError(
        "business",
        lastBizError
          ? `生图失败:${lastBizError}`
          : "生图响应无 b64_json/url 图片数据(契约漂移,检查供应商与模型 ID)",
      );
    }
  }
  return collected;
}

/** 下载鉴权(M39):同源才带 Authorization——AiHubMix content_url 须带同 key 且
 * 约 30 分钟过期;跨宿主(第三方 CDN 签名 URL)严禁外发密钥 */
export interface DownloadAuth {
  baseUrl: string | null;
  apiKey: string | null;
}

/** URL 宿主与网关 baseUrl 宿主一致判定(任一非法 URL = 非同源) */
function isSameHost(url: string, baseUrl: string | null): boolean {
  if (!baseUrl) return false;
  try {
    return new URL(url).host === new URL(baseUrl).host;
  } catch {
    return false;
  }
}

/**
 * url 形态转存(M16 问题1):GET 下载为 bytes;默认不带 Authorization(签名 URL
 * 自含鉴权);传 auth 且 URL 与 baseUrl 同宿主才带(M39 同源带鉴权下载)。
 */
export async function downloadImage(
  url: string,
  timeoutSec: number,
  auth?: DownloadAuth,
): Promise<Uint8Array> {
  const sameOriginAuth: Record<string, string> =
    auth?.apiKey && isSameHost(url, auth.baseUrl) ? { authorization: `Bearer ${auth.apiKey}` } : {};
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutSec * 1000);
  let res: Response;
  try {
    res = await fetch(url, { headers: sameOriginAuth, signal: ctrl.signal });
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
