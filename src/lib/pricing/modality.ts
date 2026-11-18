/**
 * 模型模态判定(M74 批G):模型名 → 模态的保守关键词推断 + 优先级归并。
 *
 * 为什么需要:六个模型面源都不携带模态信息,`getOrCreateModel` 缺省全落
 * "text"——doubao-seedream(文生图)与文本模型混排,前台按用途分组无从谈起。
 *
 * 两条纪律:
 * - **保守**:关键词按「长词优先」排序逐一匹配(先认 seedance/cogvideo 这类
 *   明确视频名,再认 -vl/-vision 这类弱后缀,避免 `wan2.2-vl` 被弱规则截胡);
 *   认不出返回 null(不猜,保持字典现值)。
 * - **单向升级**:`resolveModality` 只允许 text → 非text 的升级,绝不把非 text
 *   改回 text 或改判其它——误判的代价只发生在「第一次升级」,且站长终审
 *   (后台模态列)兜底;反向降级会跟人工订正打架。
 *
 * 纯函数、零依赖(同 normalize.ts),单测锚在旁侧 modality.test.ts。
 */

/** 模态值(与 model_pricing_model.modality 同口径) */
export type Modality =
  "text" | "text+vision" | "image" | "audio" | "video" | "embedding" | "rerank";

/** 非文本模态的中文标签(前台分组/后台列共用) */
export const MODALITY_LABELS: Record<Exclude<Modality, "text">, string> = {
  "text+vision": "图文",
  image: "文生图",
  audio: "音频",
  video: "文生视频",
  embedding: "向量",
  rerank: "重排",
};

/**
 * 关键词表:按序扫描,先命中先赢。**顺序即优先级**——长词/强特征在前,
 * 弱后缀(-vl/-vision)在最后。
 */
const KEYWORDS: ReadonlyArray<{ modality: Exclude<Modality, "text">; re: RegExp }> = [
  // 文生视频(强特征名,先于 image/video 弱词)
  {
    modality: "video",
    re: /seedance|cogvideo|video-|hunyuan-video|minimax-video|kling|vidu|pixverse|happyhorse|videoretalk|-?t2v|-?i2v|-?r2v|-?kf2v|2video|wan2\.\d+-(?:t2v|i2v|v2v)|wanx?-video|sora|ve-3\b/,
  },
  // 文生图(强特征名)
  {
    modality: "image",
    re: /seedream|seededit|kolors|flux|cogview|qwen-image|stable-diffusion|sdxl|sd3\b|jimeng|hidream|imagen|dall-e|photon|hunyuan-image|wan2\.\d+-?i2i|wanx/,
  },
  // 音频(TTS/ASR/语音/音乐生成)
  {
    modality: "audio",
    re: /cosyvoice|sensevoice|fishspeech|fun-asr|paraformer|\btts\b|whisper|qwen-?audio|qwen\d*-asr|step-asr|music/,
  },
  // 向量/重排
  { modality: "embedding", re: /embedding|(^|\/)(bge|gte)-/ },
  { modality: "rerank", re: /rerank|bge-reranker/ },
  // 图文(弱后缀,最后:video/image/audio 都排过了)
  {
    modality: "text+vision",
    re: /-vl\b|-vl-|-vision|-4v\b|glm-4v|internvl|minicpm-v\b|omni|\bmplug/,
  },
];

/** 按模型名推断模态;认不出返回 null(不猜) */
export function inferModality(modelKey: string): Exclude<Modality, "text"> | null {
  const k = modelKey.toLowerCase();
  for (const { modality, re } of KEYWORDS) {
    if (re.test(k)) return modality;
  }
  return null;
}

/**
 * 归并优先级:源显式标注 > 关键词推断 > 字典现值 > "text"。
 * 单向升级:现值非 text 时**不改动**(返回现值)——只有 text(或缺省)才可能
 * 被升级为非 text;显式标注与关键词同为非 text 但值不同时,显式标注赢。
 */
export function resolveModality(
  explicit: string | null | undefined,
  modelKey: string,
  current: string | null | undefined,
): Modality {
  const cur = (current ?? "").trim();
  const inferred = inferModality(modelKey);
  if (cur !== "" && cur !== "text") {
    // 字典已是非 text:保持(不降级、不改判)
    return cur as Modality;
  }
  const ex = explicit?.trim();
  if (ex !== undefined && ex !== "") {
    // 现值是 text(或缺省)而源显式给了非 text:显式标注赢
    return ex as Modality;
  }
  return inferred ?? "text";
}
