/**
 * 零命中空态(K1,原型 site-search .empty-state):result-head 0 条红字 +
 * 「AI 直接作答」口径 + 虚线框提示。AI 答案卡(批③)在无命中时仍会出
 * 「AI 直接作答」卡(需求红线:不硬编、明示无来源),本件只承载检索侧空态。RSC。
 */
export default function SearchEmpty({ q }: { q: string }): React.ReactElement {
  return (
    <div className="mt-5" aria-label="无检索结果">
      <div className="border-b border-line pb-3 font-mono text-[13px] text-text-2">
        $ agent.ask &quot;{q}&quot; --scope=site → <b className="text-red">0</b> 条检索 ·{" "}
        <b className="text-green-hi">AI 直接作答</b>{" "}
        <span className="text-text-3">(站内无命中)</span>
      </div>
      <div className="mt-5 rounded-md border border-dashed border-line px-6 py-11 text-center">
        <svg className="ic mx-auto h-[34px] w-[34px] text-text-3 opacity-50" aria-hidden="true">
          <use href="#i-search" />
        </svg>
        <h3 className="mt-3 text-base text-text-2">站内没有找到相关内容</h3>
        <p className="mt-1.5 text-[13px] text-text-3">
          AI 不会硬编:无命中时会明确告知并给通用回答(标注「站内无来源」),或换个问法试试
        </p>
        <span className="mt-2.5 inline-block rounded border border-line bg-panel px-2.5 py-0.5 font-mono text-xs text-text-3">
          hint: 检索范围 = 资讯(电报流)+ 教程(文章)+ 项目(repo)· 支持自然语言提问
        </span>
      </div>
    </div>
  );
}
