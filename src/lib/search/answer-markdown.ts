/**
 * 答案卡 markdown 子集解析(K2,纯函数):prompt 只放开 **加粗**、`行内代码`、
 * 「- 」列表,但模型会习惯性漏写其他标记——按子集解析成渲染描述块,
 * 子集之外一律字面量。不产 HTML、不经 dangerouslySetInnerHTML,无注入面。
 * 流式期间尾部未闭合标记短暂按字面量显示,闭合后即正常(可接受)。
 */

export type AnswerInline =
  { t: "text"; v: string } | { t: "bold"; v: string } | { t: "code"; v: string };

export type AnswerBlock =
  | { kind: "p"; segs: AnswerInline[] }
  | { kind: "ul"; items: AnswerInline[][] }
  | { kind: "ol"; items: AnswerInline[][] };

/** 行内解析:**加粗** 与 `代码`(空内容/未闭合按字面量;代码段内不再嵌套) */
export function parseAnswerInline(text: string): AnswerInline[] {
  const segs: AnswerInline[] = [];
  let plain = "";
  let i = 0;
  const flush = (): void => {
    if (plain !== "") {
      segs.push({ t: "text", v: plain });
      plain = "";
    }
  };
  while (i < text.length) {
    if (text[i] === "`") {
      const end = text.indexOf("`", i + 1);
      if (end !== -1 && end > i + 1) {
        flush();
        segs.push({ t: "code", v: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    } else if (text[i] === "*" && text[i + 1] === "*") {
      const end = text.indexOf("**", i + 2);
      if (end !== -1 && end > i + 2) {
        flush();
        segs.push({ t: "bold", v: text.slice(i + 2, end) });
        i = end + 2;
        continue;
      }
    }
    plain += text[i];
    i += 1;
  }
  flush();
  return segs;
}

const UL_LINE = /^\s*[-*]\s+(.*)$/;
const OL_LINE = /^\s*\d{1,2}[.)]\s+(.*)$/;

/** 块解析:连续 `- `/`* ` 行 → ul;`1.`/`1)` 行 → ol;空行分段;
 * 段内软换行(CJK 语义)直接拼接。列表项内做行内解析 */
export function parseAnswerBlocks(text: string): AnswerBlock[] {
  const blocks: AnswerBlock[] = [];
  let para = "";
  let list: { kind: "ul" | "ol"; items: AnswerInline[][] } | null = null;
  const flushPara = (): void => {
    if (para !== "") {
      blocks.push({ kind: "p", segs: parseAnswerInline(para) });
      para = "";
    }
  };
  const flushList = (): void => {
    if (list) {
      blocks.push({ kind: list.kind, items: list.items });
      list = null;
    }
  };
  for (const line of text.split("\n")) {
    const ul = UL_LINE.exec(line);
    const ol = ul ? null : OL_LINE.exec(line);
    if (ul || ol) {
      flushPara();
      if (list === null || list.kind !== (ul ? "ul" : "ol")) {
        flushList();
        list = { kind: ul ? "ul" : "ol", items: [] };
      }
      list.items.push(parseAnswerInline((ul ?? ol)![1]));
    } else if (line.trim() === "") {
      flushPara();
      flushList();
    } else {
      flushList();
      para += line;
    }
  }
  flushPara();
  flushList();
  return blocks;
}
