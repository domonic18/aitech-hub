/**
 * 档位参数解析(牌价改造 P3):tierLabel → 结构化参数。
 *
 * 双路口径(D3):
 * - 采集显式:落库路径(model-persist)对模态计价档(按张/秒/分钟)调用
 *   parseTierParams 写入 `model_pricing_tier.params`(source=parsed);
 * - 读侧兜底:DB params 为空时(存量行)同函数解析标签,标 source=inferred,
 *   前台显示「推断」角标;**推断值不参与改价与最低价判定**。
 *
 * 纯函数、零库零 env(同 resolution.ts,可进 client chunk)。分辨率识别复用
 * resolution.ts 的口径(1K/2K/480P/宽×高/像素档),音频/时长/帧率是本件新增。
 */

/** 档位参数(可全空的稀疏结构;null=标签未表达该维度) */
export interface TierParams {
  /** 分辨率原文(480P / 2K / 1024×1536 / P ≤ 2.61M) */
  resolution: string | null;
  /** 是否含音频(有声视频=true / 无声视频·audio=false=false);null=未表达 */
  hasAudio: boolean | null;
  /** 时长(秒);标签如「5s」「10 秒」;null=未表达 */
  durationSec: number | null;
  /** 帧率(fps);标签如「24fps」「30 帧」;null=未表达 */
  fps: number | null;
}

/** 解析结果带来源:parsed=采集显式入库,inferred=读侧从标签兜底解析 */
export type TierParamsWithSource = TierParams & { source: "parsed" | "inferred" };

const AUDIO_TRUE_RE = /有声|audio\s*=\s*true/i;
const AUDIO_FALSE_RE = /无声|audio\s*=\s*false/i;
const DURATION_RE = /(\d+(?:\.\d+)?)\s*(?:s\b|秒)/;
const FPS_RE = /(\d+)\s*(?:fps\b|帧)/;

/** 档位标签 → 参数(纯函数);解析不到的维度为 null,不猜 */
export function parseTierParams(label: string, resolution: string | null): TierParams {
  return {
    resolution,
    hasAudio: AUDIO_TRUE_RE.test(label) ? true : AUDIO_FALSE_RE.test(label) ? false : null,
    durationSec: numberOrNull(DURATION_RE.exec(label)?.[1]),
    fps: numberOrNull(FPS_RE.exec(label)?.[1]),
  };
}

/** 读侧出口:DB 显式参数优先,空则按标签兜底解析(标 inferred) */
export function tierParamsWithFallback(
  params: unknown,
  label: string,
  resolution: string | null,
): TierParamsWithSource | null {
  if (isTierParams(params)) return { ...params, source: "parsed" };
  const parsed = parseTierParams(label, resolution);
  // 四维全空不值得挂参数对象
  if (
    parsed.resolution === null &&
    parsed.hasAudio === null &&
    parsed.durationSec === null &&
    parsed.fps === null
  ) {
    return null;
  }
  return { ...parsed, source: "inferred" };
}

function numberOrNull(v: string | undefined): number | null {
  if (v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** DB params 列的形状校验(Json 列不信任存量形态) */
function isTierParams(v: unknown): v is TierParams {
  if (typeof v !== "object" || v === null) return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.resolution === "string" &&
    (p.hasAudio === null || typeof p.hasAudio === "boolean") &&
    (p.durationSec === null || typeof p.durationSec === "number") &&
    (p.fps === null || typeof p.fps === "number")
  );
}
