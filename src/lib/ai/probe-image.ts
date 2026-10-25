/** 生图探针(M47 批D 自 probe.ts 拆出):真实最小生成一张 */
import { AI_PROTOCOL_OPENAI } from "./constants";
import { COVER_IMAGE_SIZE } from "./cover-prompt";
import { buildImagesBody, parseImagesResponse } from "./image-client";
import { authHeaders, humanizeErrorBody, type ProbeInput, type ProbeResult } from "./probe-shared";

/** 生图探针超时下限/上限:生图本身比 chat 慢一个量级,15s 会误报超时(实测
 * 5~15s 常态);随模型台账 timeoutSec 走(与真实管线同源),收敛在 15~120s */
const IMAGE_PROBE_TIMEOUT_MIN_SEC = 15;
const IMAGE_PROBE_TIMEOUT_MAX_SEC = 120;

/** 生图探针:真实最小生成一张(计费一张,测试按钮低频可接受),
 * 2xx 且 data[0]/output[0] 含 b64_json/url/content_url 即通——请求形状与
 * image-client 全对齐(经 buildImagesBody 同源构造,extraParams 保留键恒覆盖、
 * 显式 null 剔除/尺寸 1344x768/双数组双键形态校验与管线同口径,M39 收 AiHubMix
 * output[]/content_url),探针比管线严或松都会造成「测试失败但实际可用」或反向误报 */
export async function probeImages(input: ProbeInput, baseUrl: string): Promise<ProbeResult> {
  if (input.protocol !== AI_PROTOCOL_OPENAI) {
    return {
      ok: false,
      latencyMs: 0,
      detail: "生图协议不支持(需 OpenAI images/generations 兼容端点,与生图管线同门禁)",
    };
  }
  const timeoutSec = Math.min(
    Math.max(input.timeoutSec ?? 60, IMAGE_PROBE_TIMEOUT_MIN_SEC),
    IMAGE_PROBE_TIMEOUT_MAX_SEC,
  );
  const startedAt = Date.now();
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/images/generations`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders(input.apiKey) },
      // 请求体与 image-client 同源构造器(保留键 null 剔除语义一致,同口径)
      body: JSON.stringify(
        buildImagesBody(
          {
            model: input.modelId,
            prompt: "连通性测试",
            n: 1,
            size: COVER_IMAGE_SIZE,
            response_format: "b64_json",
          },
          input.extraParams,
        ),
      ),
      signal: AbortSignal.timeout(timeoutSec * 1000),
    });
    const latencyMs = Date.now() - startedAt;
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      return {
        ok: false,
        latencyMs,
        detail: `HTTP ${res.status}: ${humanizeErrorBody(text)}`,
      };
    }
    let body: unknown;
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      return { ok: false, latencyMs, detail: "生图响应不是 JSON(契约漂移)" };
    }
    // 响应解析单源(E2 收口):OpenAI data[] / AiHubMix output[] 双形态与
    // generateImages 共用 parseImagesResponse,行级校验口径天然一致
    const parsed = parseImagesResponse(body);
    if (!parsed.hasRows || parsed.images.length === 0) {
      return {
        ok: false,
        latencyMs,
        detail: parsed.bizError
          ? `生图失败:${parsed.bizError.slice(0, 200)}`
          : parsed.hasRows
            ? "生图响应无 b64_json/url 图片数据(契约漂移)"
            : "生图响应缺 data/output 数组(契约漂移)",
      };
    }
    return { ok: true, latencyMs, detail: `生图连通 ${latencyMs}ms(计费 1 张)` };
  } catch (e) {
    const latencyMs = Date.now() - startedAt;
    const detail =
      e instanceof Error && e.name === "TimeoutError"
        ? `超时 ${timeoutSec}s(生图慢,可重试或在模型台账调大超时)`
        : String(e);
    return { ok: false, latencyMs, detail };
  }
}
