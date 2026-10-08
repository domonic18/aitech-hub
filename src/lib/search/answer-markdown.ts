/**
 * 答案卡/Drawer markdown 子集解析(K2,纯函数):放开 **加粗**、`行内代码`、
 * `[文本](URL)` 链接、「- 」列表、#/##/### 标题、``` 代码围栏与 GFM 表格
 * (标题/围栏/表格/链接系 K2.5 验收反馈补充——技术问题下模型习惯性输出,
 * 渲染器按子集解析成描述块),子集之外一律字面量。
 * 不产 HTML、不经 dangerouslySetInnerHTML,无注入面;链接 href 仅收
 * 无空白单行 URL(渲染侧 http(s) 外链 target=_blank)。
 * 流式期间尾部未闭合标记短暂按字面量显示,闭合后即正常(可接受)。
 */

export type AnswerInline =
  | { t: "text"; v: string }
  | { t: "bold"; v: string }
  | { t: "code"; v: string }
  | { t: "link"; v: string; href: string };

export type AnswerBlock =
  | { kind: "p"; segs: AnswerInline[] }
  | { kind: "h"; level: 2 | 3 | 4; segs: AnswerInline[] }
  | { kind: "pre"; lang: string; v: string }
  | { kind: "table"; head: AnswerInline[][]; rows: AnswerInline[][][] }
  | { kind: "ul"; items: AnswerInline[][] }
  | { kind: "ol"; items: AnswerInline[][] };

/** 行内解析:`代码`、**加粗** 与 [文本](URL)(空内容/未闭合/URL 含空白按字面量;
 * 代码段内不再嵌套;链接文本不再嵌套行内标记) */
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
    } else if (text[i] === "[") {
      const mid = text.indexOf("](", i + 1);
      if (mid !== -1 && mid > i + 1) {
        const end = text.indexOf(")", mid + 2);
        const href = end !== -1 ? text.slice(mid + 2, end).trim() : "";
        const label = text.slice(i + 1, mid);
        // href 单行无空白(模型偶发换行排版退化字面量);label 不为空
        if (end !== -1 && href !== "" && !/\s/.test(href) && label !== "") {
          flush();
          segs.push({ t: "link", v: label, href });
          i = end + 1;
          continue;
        }
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
const HEAD_LINE = /^(#{1,4})\s+(.+)$/;
const FENCE_LINE = /^\s*```(.*)$/;
// 表格分隔行:| --- | :---: | 形态,至少两段连字符
const TABLE_DELIM = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/;

/** 表格行拆单元格:去首尾竖线后按 | 切,单元格 trim(行内代码含 | 的瑕疵接受) */
function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

/** 块解析:连续 `- `/`* ` 行 → ul;`1.`/`1)` 行 → ol;`#`~`####` 行 → 标题;
 * ``` 围栏间原文收集(不做行内解析,未闭合到 EOF 按代码块收尾);
 * 表头行 + 分隔行开表格,连续含 | 行收表体;空行分段;
 * 段内软换行(CJK 语义)直接拼接。列表项/标题/单元格内做行内解析 */
export function parseAnswerBlocks(text: string): AnswerBlock[] {
  const blocks: AnswerBlock[] = [];
  let para = "";
  let list: { kind: "ul" | "ol"; items: AnswerInline[][] } | null = null;
  let fence: { lang: string; lines: string[] } | null = null;
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
  const lines = text.split("\n");
  for (let li = 0; li < lines.length; li += 1) {
    const line = lines[li]!;
    const fenceMark = FENCE_LINE.exec(line);
    if (fence) {
      // 围栏内:闭合标记退出;否则原文收集(含空行)
      if (fenceMark) {
        blocks.push({ kind: "pre", lang: fence.lang, v: fence.lines.join("\n") });
        fence = null;
      } else {
        fence.lines.push(line);
      }
      continue;
    }
    if (fenceMark) {
      flushPara();
      flushList();
      fence = { lang: fenceMark[1].trim(), lines: [] };
      continue;
    }
    // 表格:当前行含 | 且下一行是分隔行;表体连续吞含 | 的非空行
    if (line.includes("|") && li + 1 < lines.length && TABLE_DELIM.test(lines[li + 1]!)) {
      flushPara();
      flushList();
      const head = splitTableRow(line).map(parseAnswerInline);
      li += 2;
      const rows: AnswerInline[][][] = [];
      while (li < lines.length && lines[li]!.trim() !== "" && lines[li]!.includes("|")) {
        rows.push(splitTableRow(lines[li]!).map(parseAnswerInline));
        li += 1;
      }
      li -= 1; // 抵消外层 for 的自增
      blocks.push({ kind: "table", head, rows });
      continue;
    }
    const head = HEAD_LINE.exec(line);
    if (head) {
      flushPara();
      flushList();
      // 层级收敛 2~4(卡片内 # 当二级用,避免超大标题)
      const level = Math.min(Math.max(head[1].length, 2), 4) as 2 | 3 | 4;
      blocks.push({ kind: "h", level, segs: parseAnswerInline(head[2]) });
      continue;
    }
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
  if (fence) {
    // 未闭合围栏:剩余内容按代码块收尾(比字面量裸奔可读)
    blocks.push({ kind: "pre", lang: fence.lang, v: fence.lines.join("\n") });
  }
  flushPara();
  flushList();
  return blocks;
}
