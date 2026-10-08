"use client";
/**
 * 受约束 markdown 渲染(K2 答案卡 / K2.5 Drawer 会话正文共用):
 * 标题(#~####)/加粗/行内代码/链接/代码围栏/GFM 表格/有序无序列表 + [n] 角标。
 * citeLinks=true 时角标为锚链(跳引用列表 #cite-n);Drawer 无引用列表,
 * 传 false 渲染纯上标。
 */
import {
  parseAnswerBlocks,
  type AnswerBlock,
  type AnswerInline,
} from "@/lib/search/answer-markdown";
import { parseAnswerSup } from "@/lib/search/answer-parse";

const SUP_LINK =
  "mx-0.5 rounded-[3px] bg-accent-dim px-1 font-mono text-[10.5px] text-accent-hover hover:border hover:border-accent/40";

/** 文本叶子内的 [n]/[n][m] → 上标(角标锚链可选;纯文本原样) */
function renderSup(text: string, keyPrefix: string, citeLinks: boolean): React.ReactNode[] {
  return parseAnswerSup(text).map((s, i) =>
    typeof s === "string" ? (
      <span key={`${keyPrefix}-${i}`}>{s}</span>
    ) : (
      <span key={`${keyPrefix}-${i}`}>
        {s.sup.map((n) =>
          citeLinks ? (
            <sup key={n}>
              <a href={`#cite-${n}`} className={SUP_LINK}>
                [{n}]
              </a>
            </sup>
          ) : (
            <sup key={n} className="mx-0.5 font-mono text-[10.5px] text-text-3">
              [{n}]
            </sup>
          ),
        )}
      </span>
    ),
  );
}

/** 行内段渲染:加粗/行内代码/文本(文本叶内再解 [n] 上标) */
function renderInline(
  segs: AnswerInline[],
  keyPrefix: string,
  citeLinks: boolean,
): React.ReactNode[] {
  return segs.map((s, i) => {
    const k = `${keyPrefix}-${i}`;
    if (s.t === "bold")
      return (
        <strong key={k} className="font-semibold text-text-1">
          {renderSup(s.v, k, citeLinks)}
        </strong>
      );
    if (s.t === "code")
      return (
        <code key={k} className="rounded bg-panel-2 px-1 py-px font-mono text-[13px] text-green-hi">
          {s.v}
        </code>
      );
    if (s.t === "link") {
      // http(s) 且非本站 → 外链新窗(同源/相对路径站内跳转)
      const external =
        /^https?:\/\//i.test(s.href) &&
        (typeof window === "undefined" || !s.href.startsWith(window.location.origin));
      return (
        <a
          key={k}
          href={s.href}
          {...(external ? { target: "_blank", rel: "noopener nofollow" } : {})}
          className="text-accent-hover underline decoration-line hover:decoration-accent-hover"
        >
          {s.v}
        </a>
      );
    }
    return <span key={k}>{renderSup(s.v, k, citeLinks)}</span>;
  });
}

const LIST_CLS = "my-1.5 space-y-1 pl-5 marker:text-text-3";
const HEAD_CLS: Record<2 | 3 | 4, string> = {
  2: "mt-3.5 text-[15px]",
  3: "mt-3 text-[14px]",
  4: "mt-2.5 text-[13px]",
};

/** 块渲染(子集 markdown;块级标签在 div 内合法嵌套,不用 <p> 包块) */
function renderBlocks(blocks: AnswerBlock[], citeLinks: boolean): React.ReactNode[] {
  return blocks.map((b, i) => {
    if (b.kind === "ul" || b.kind === "ol") {
      const ListTag = b.kind === "ul" ? "ul" : "ol";
      return (
        <ListTag
          key={i}
          className={`${LIST_CLS} ${b.kind === "ul" ? "list-disc" : "list-decimal"}`}
        >
          {b.items.map((segs, j) => (
            <li key={j}>{renderInline(segs, `${i}-${j}`, citeLinks)}</li>
          ))}
        </ListTag>
      );
    }
    if (b.kind === "h") {
      return (
        <p key={i} className={`${HEAD_CLS[b.level]} font-semibold text-text-1`}>
          {renderInline(b.segs, `h${i}`, citeLinks)}
        </p>
      );
    }
    if (b.kind === "pre") {
      return (
        <pre
          key={i}
          className="my-2 max-h-80 overflow-auto rounded border border-line bg-panel-2 p-3 font-mono text-[12.5px] leading-relaxed text-text-2"
        >
          {b.v}
        </pre>
      );
    }
    if (b.kind === "table") {
      return (
        <div key={i} className="my-2 overflow-x-auto">
          <table className="w-full border-collapse border border-line text-[12.5px]">
            <thead>
              <tr>
                {b.head.map((cell, j) => (
                  <th
                    key={j}
                    className="border-b border-line bg-panel-2 px-2.5 py-1.5 text-left font-medium text-text-1"
                  >
                    {renderInline(cell, `${i}-h${j}`, citeLinks)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((row, j) => (
                <tr key={j} className="border-b border-line last:border-b-0">
                  {row.map((cell, k2) => (
                    <td key={k2} className="px-2.5 py-1.5 align-top text-text-2">
                      {renderInline(cell, `${i}-${j}-${k2}`, citeLinks)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    return <p key={i}>{renderInline(b.segs, `p${i}`, citeLinks)}</p>;
  });
}

export default function AnswerMarkdown({
  text,
  citeLinks = true,
}: {
  text: string;
  citeLinks?: boolean;
}): React.ReactElement {
  return <>{renderBlocks(parseAnswerBlocks(text), citeLinks)}</>;
}
