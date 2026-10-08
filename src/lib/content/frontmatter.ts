/**
 * 文章 frontmatter 解析(M5-c,发布 API 消费):手写 YAML 子集,不引
 * gray-matter。支持 `---` 围栏内:键值字符串(可带单/双引号)、行内数组
 * [a, b]、多行 `- item` 列表;无闭合围栏视为无 frontmatter(整串为正文);
 * 畸形行忽略。仅做发布 API 需要的最小集合,不支持嵌套/锚点/多文档。
 */
export type FrontmatterValue = string | string[];

export interface ParsedMarkdown {
  fm: Record<string, FrontmatterValue>;
  body: string;
}

/** 去一层成对引号('…' 或 "…") */
function stripQuotes(s: string): string {
  if (
    s.length >= 2 &&
    ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))
  )
    return s.slice(1, -1);
  return s;
}

export function parseFrontmatter(md: string): ParsedMarkdown {
  const fence = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(md);
  if (!fence) return { fm: {}, body: md };

  const fm: Record<string, FrontmatterValue> = {};
  let currentKey: string | null = null; // 多行列表的挂载键
  for (const line of fence[1]!.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "") continue;

    const listItem = /^-\s+(.+)$/.exec(trimmed);
    if (listItem && currentKey !== null) {
      const arr = Array.isArray(fm[currentKey]) ? (fm[currentKey] as string[]) : [];
      arr.push(stripQuotes(listItem[1]!.trim()));
      fm[currentKey] = arr;
      continue;
    }

    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(trimmed);
    if (!kv) {
      currentKey = null;
      continue;
    }
    const key = kv[1]!;
    const rawValue = kv[2]!.trim();
    currentKey = key;
    if (rawValue === "") {
      fm[key] = []; // 期待后续多行列表;无则等价空数组
      continue;
    }
    const inline = /^\[(.*)\]$/.exec(rawValue);
    fm[key] = inline
      ? inline[1]!
          .split(",")
          .map((s) => stripQuotes(s.trim()))
          .filter((s) => s !== "")
      : stripQuotes(rawValue);
  }
  return { fm, body: md.slice(fence[0].length) };
}

/** fm 取字符串字段(数组/缺失 → undefined;空串 → undefined) */
export function fmString(fm: Record<string, FrontmatterValue>, key: string): string | undefined {
  const v = fm[key];
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
}

/** fm 取字符串数组字段:行内/多行列表原样;裸串按中英逗号切分 */
export function fmStringArray(
  fm: Record<string, FrontmatterValue>,
  key: string,
): string[] | undefined {
  const v = fm[key];
  if (Array.isArray(v)) return v;
  if (typeof v === "string" && v.trim() !== "")
    return v
      .split(/[,，]/)
      .map((s) => s.trim())
      .filter((s) => s !== "");
  return undefined;
}
