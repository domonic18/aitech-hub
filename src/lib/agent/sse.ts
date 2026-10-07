/**
 * Drawer 自有 SSE 帧解析(K2.6 修复,与 wire.ts#encodeWireEvent 成对的客户端
 * 逆变换):runs.stream 自有 fetch 后不再经 @langchain/langgraph-sdk 解析
 * (SDK AsyncCaller 对非 2xx reject Response 且包装 new Error(response),
 * 状态码与 apiEnvelope 人话全丢),此读取器按「event: 名\ndata: JSON\n\n」
 * 逐帧解出。只承诺解析本后端产出的帧形态(块间空行 \n\n 分隔,无 CRLF/
 * 多 data 行);跨 chunk 多字节切分由调用方 TextDecoder({stream:true}) 兜住。
 */

/** 单帧:事件名 + 载荷(JSON.parse 后原样,形态由 wire.ts 契约钉死) */
export interface SseEvent {
  event: string;
  data: unknown;
}

export interface SseEventReader {
  /** 喂入一段已解码文本,返回其中已完整的帧(顺序保持) */
  push(chunk: string): SseEvent[];
  /** 流收尾:兜住无尾随空行的最后一帧(正常后端每帧自带 \n\n,防御用) */
  end(): SseEvent[];
}

export function createSseEventReader(): SseEventReader {
  let buf = "";

  const dispatch = (raw: string): SseEvent | null => {
    let event = "message";
    const dataLines: string[] = [];
    for (const line of raw.split("\n")) {
      if (line === "" || line.startsWith(":")) continue; // 空行/注释行(keep-alive 等)
      const colon = line.indexOf(":");
      const field = colon === -1 ? line : line.slice(0, colon);
      let value = colon === -1 ? "" : line.slice(colon + 1);
      if (value.startsWith(" ")) value = value.slice(1); // SSE 规范:冒号后单个空格归解析器剥
      if (field === "event") event = value;
      else if (field === "data") dataLines.push(value);
    }
    if (dataLines.length === 0) return null; // 纯 event 行无载荷:无消费方,丢弃
    try {
      return { event, data: JSON.parse(dataLines.join("\n")) };
    } catch {
      return null; // 非 JSON data:后端契约恒 JSON,防御性丢弃
    }
  };

  const drain = (): SseEvent[] => {
    const out: SseEvent[] = [];
    let sep: number;
    while ((sep = buf.indexOf("\n\n")) !== -1) {
      const frame = dispatch(buf.slice(0, sep));
      buf = buf.slice(sep + 2);
      if (frame) out.push(frame);
    }
    return out;
  };

  return {
    push(chunk) {
      buf += chunk;
      return drain();
    },
    end() {
      if (buf.trim() === "") return [];
      const frame = dispatch(buf);
      buf = "";
      return frame ? [frame] : [];
    },
  };
}
