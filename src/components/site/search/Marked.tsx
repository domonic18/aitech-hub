/**
 * 命中高亮统一渲染(K1,原型 .hit mark:amber 22% color-mix 双主题):
 * highlightSegments 切段 map 出 <mark>,禁 dangerouslySetInnerHTML(注入红线)。
 */
import { highlightSegments } from "@/lib/search/highlight";

export default function Marked({
  text,
  terms,
}: {
  text: string;
  terms: string[];
}): React.ReactElement {
  return (
    <>
      {highlightSegments(text, terms).map((seg, i) =>
        typeof seg === "string" ? (
          seg
        ) : (
          <mark key={i} className="rounded-[2px] bg-amber/20 px-[2px] text-amber-hi">
            {seg.mark}
          </mark>
        ),
      )}
    </>
  );
}
