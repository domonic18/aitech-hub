/**
 * 答案卡 SSE 事件协议(K2,arch/04 §3.4;客户端/服务端共用,零依赖):
 * meta(引用与命中口径)→ delta*(流式增量)→ done(追问 chips)收尾;
 * 降级三路径(no_binding/quota/error)一律单帧 unavailable,前台无感。
 * encode 服务端帧化;parseSseBlocks 客户端粘包安全解析(半截帧留 rest,CRLF 容忍)。
 */

export type AnswerCiteKind = "feed-text" | "feed-video" | "post" | "repo";

export interface AnswerCite {
  /** 引用序号(1 起,与答案内 [n] 标注对齐) */
  n: number;
  kind: AnswerCiteKind;
  title: string;
  href: string;
  /** 引用片段(正文首段/摘要,≤300 字) */
  snippet: string;
}

export type AnswerEvent =
  | {
      type: "meta";
      /** 三域命中总数(0 = 站内无命中,AI 直接作答) */
      total: number;
      noHits: boolean;
      cites: AnswerCite[];
      generatedAt: string;
    }
  | { type: "delta"; text: string }
  | { type: "done"; durationMs: number; followUps: string[] }
  | { type: "unavailable"; reason: "no_binding" | "quota" | "error" };

const EVENT_TYPES = ["meta", "delta", "done", "unavailable"] as const;

/** 事件 → SSE 帧(event 行 + data 行 + 空行收尾) */
export function encodeAnswerEvent(e: AnswerEvent): string {
  return `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`;
}

function parseBlock(block: string): AnswerEvent | null {
  const dataLine = block.split("\n").find((l) => l.startsWith("data:"));
  if (!dataLine) return null;
  try {
    const e = JSON.parse(dataLine.slice(5).trim()) as AnswerEvent;
    return EVENT_TYPES.includes(e.type) ? e : null;
  } catch {
    return null;
  }
}

/** 网络分块不可对齐 SSE 帧:完整块解析为事件,半截尾串留 rest 与下块拼接 */
export function parseSseBlocks(buffer: string): { events: AnswerEvent[]; rest: string } {
  const parts = buffer.replace(/\r\n/g, "\n").split("\n\n");
  const rest = parts.pop() ?? "";
  const events: AnswerEvent[] = [];
  for (const block of parts) {
    const e = parseBlock(block);
    if (e) events.push(e);
  }
  return { events, rest };
}
