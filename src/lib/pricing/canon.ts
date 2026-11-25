/**
 * 型号归一·能力维度(2026-11-25 牌价改造 P1):把同一型号在不同源的不同写法
 * 收敛到同一归一键 group_key(`<base>::<task>`),解决「同型号跨渠道分裂成
 * 不同字典行 → 比价组不起来」。
 *
 * 例:kling-v3(词元所,裸键)↔ kling-v3-video-generation(百炼,能力后缀)
 * → 同组 `kling-v3::t2v`;而 viduq3-pro_img2video → `viduq3-pro::i2v`
 * 不与 `::t2v` 合并(任务不同不误并)。
 *
 * 分工边界:
 * - 快照版本(wan2.6-t2v ↔ wan2.6-t2v-2026-06-12)由字典层 match_key 合并,
 *   不归本层(model-registry.getOrCreateModel 的 OR 查找);
 * - 源内异写超出通用剥离的(词元所 `v6`=爱诗 PixVerse),走 model-aliases.ts
 *   的源作用域别名表。
 *
 * 纪律:后缀表是**窄表**——只有显式映射到任务词的后缀才剥离,且仅当任务
 * 暗示的模态与模型模态一致时生效;不一致(数据矛盾)保留原键,宁可分裂
 * 不可误并。纯函数、零库零 env(同 normalize.ts,可进 client chunk)。
 */
import { normalizeModelKey } from "./normalize";
import { aliasRuleOf } from "./model-aliases";

/** 能力后缀(已归一形态:`_` 折成 `-`)→ 任务词;按长度降序,只剥一层 */
const CAPABILITY_SUFFIXES: ReadonlyArray<{ suffix: string; task: string }> = [
  { suffix: "-video-generation", task: "t2v" },
  { suffix: "-image-generation", task: "t2i" },
  { suffix: "-reference2video", task: "r2v" },
  { suffix: "-start-end2video", task: "se2v" },
  { suffix: "-text2video", task: "t2v" },
  { suffix: "-reference2image", task: "r2i" },
  { suffix: "-text2image", task: "t2i" },
  { suffix: "-img2video", task: "i2v" },
  { suffix: "-img2image", task: "i2i" },
  { suffix: "-kf2v", task: "kf2v" },
  { suffix: "-t2v", task: "t2v" },
  { suffix: "-t2i", task: "t2i" },
  { suffix: "-i2v", task: "i2v" },
  { suffix: "-r2v", task: "r2v" },
];

/** 任务词 → 暗示模态(剥离一致性的判据) */
const TASK_MODALITY: Record<string, "video" | "image"> = {
  t2v: "video",
  i2v: "video",
  kf2v: "video",
  r2v: "video",
  se2v: "video",
  t2i: "image",
  i2i: "image",
  r2i: "image",
};

/** 裸键(无能力后缀)按模态主任务归一;非视觉模态用模态名兜底 */
function defaultTaskOf(modality: string | null | undefined): string {
  if (modality === "video") return "t2v";
  if (modality === "image") return "t2i";
  return (modality ?? "").trim() || "text";
}

/** 型号归一结果 */
export interface ModelGroup {
  /** 基型(去 org 前缀与能力后缀的规范键) */
  base: string;
  /** 任务词(t2v/i2v/t2i/…;非视觉模态为模态名) */
  task: string;
  /** 归一键 `${base}::${task}`,空基型返回 ""(不落库) */
  groupKey: string;
}

/**
 * 原始模型键 + 模态 → 归一组。modality 用 resolveModality 的结果
 * (源显式 > 关键词推断 > text);providerKey 供源作用域别名覆盖。
 */
export function groupOf(
  rawKey: string,
  modality: string | null | undefined,
  providerKey?: string | null,
): ModelGroup {
  const key = normalizeModelKey(rawKey);
  let base = key;
  let task: string | null = null;
  if (key !== "") {
    for (const { suffix, task: t } of CAPABILITY_SUFFIXES) {
      if (!key.endsWith(suffix) || key === suffix) continue;
      if (TASK_MODALITY[t] === modality) {
        base = key.slice(0, key.length - suffix.length);
        task = t;
      }
      break; // 表按长度降序,首个命中即最长的;一致才剥、不一致保留原键
    }
  }
  const resolvedTask = task ?? defaultTaskOf(modality);
  const group: ModelGroup = {
    base,
    task: resolvedTask,
    groupKey: base === "" ? "" : `${base}::${resolvedTask}`,
  };

  const alias = aliasRuleOf(providerKey, rawKey);
  if (alias !== null) {
    const aliasBase = alias.base !== undefined ? normalizeModelKey(alias.base) : group.base;
    const aliasTask = alias.task ?? group.task;
    return {
      base: aliasBase,
      task: aliasTask,
      groupKey: aliasBase === "" ? "" : `${aliasBase}::${aliasTask}`,
    };
  }
  return group;
}
