/**
 * 创作中心「生成中」前端态(M44 状态驱动交互):纯函数 + sessionStorage
 * 持久化,零 schema/React 依赖。背景:topic 与 agent 线程无持久化关联,
 * 「生成中」只能是前端在途态;完成信号来自落库结果比对——
 * - post:linkedPostId 出现(首稿),或 topic.updatedAt 推进(recompose 必写
 *   composedAt,@updatedAt 连带推进);
 * - pin:pinIds 集合出现新 id。已 drafted 的重生成 topic 行不动
 *   (save_topic_pin 的 updateMany 仅 collecting 推进),必须比对集合。
 * sessionStorage 同标签页刷新可恢复;跨标签页不同步(已知取舍,超时兜底)。
 */

export type GenerationKind = "post" | "pin";

/** 点击生成时的落库基线(服务端快照,详情页 props 原样下发) */
export interface GenerationBaseline {
  status: string;
  /** ISO 字符串(Date 序列化后即 ISO,前端不再碰 Date) */
  updatedAt: string;
  linkedPostId: string | null;
  pinIds: string[];
}

/** 服务端当前态快照(GET /api/topics/[id]/studio-state 返回 data 形态) */
export type StudioStateSnapshot = GenerationBaseline;

/** 轮询步长(PinEditor 5s 先例同款) */
export const POLL_STEP_MS = 5000;

/** 生成超时(6 张 × 60s/张 富余):超时清态并提示查看助手对话 */
export const GENERATION_TIMEOUT_MS = 480_000;

const STORAGE_PREFIX = "studio-gen:";

/**
 * 完成判定:kind 分信号(见模块头注)。post 的 updatedAt 比对在「生成途中
 * 人工改标题/配置」时会提前判完成——横幅可关闭、内容刷新无害,边缘可接受。
 */
export function detectCompletion(
  kind: GenerationKind,
  baseline: GenerationBaseline,
  current: StudioStateSnapshot,
): boolean {
  if (kind === "post") {
    return (
      (baseline.linkedPostId === null && current.linkedPostId !== null) ||
      current.updatedAt !== baseline.updatedAt
    );
  }
  return current.pinIds.some((id) => !baseline.pinIds.includes(id));
}

/** sessionStorage 持久化形态(startedAt 用于超时兜底) */
export interface PersistedGeneration {
  kind: GenerationKind;
  baseline: GenerationBaseline;
  startedAt: number;
}

/** 读取在途生成态;不存在、解析失败或已超时(超时顺带清除)返回 null */
export function loadGeneration(topicId: string): PersistedGeneration | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(STORAGE_PREFIX + topicId);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PersistedGeneration;
    if (
      (parsed.kind !== "post" && parsed.kind !== "pin") ||
      typeof parsed.startedAt !== "number" ||
      !parsed.baseline
    ) {
      throw new Error("malformed");
    }
    if (Date.now() - parsed.startedAt > GENERATION_TIMEOUT_MS) {
      window.sessionStorage.removeItem(STORAGE_PREFIX + topicId);
      return null;
    }
    return parsed;
  } catch {
    window.sessionStorage.removeItem(STORAGE_PREFIX + topicId);
    return null;
  }
}

export function saveGeneration(topicId: string, value: PersistedGeneration): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(STORAGE_PREFIX + topicId, JSON.stringify(value));
}

export function clearGeneration(topicId: string): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(STORAGE_PREFIX + topicId);
}
