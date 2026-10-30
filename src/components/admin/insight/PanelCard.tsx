/**
 * 洞察中心卡壳(P2-22 自 overview 页抽出):标题 + 一句话读法 + 页签槽
 * (热榜渠道页签位,F11 v2 板定紧随标题)+ 右侧 extra + 内容;id 供页头控件
 * 锚点跳滚。
 */
export function PanelCard({
  title,
  hint,
  tabs,
  extra,
  id,
  children,
}: {
  title: string;
  hint: string;
  tabs?: React.ReactNode;
  extra?: React.ReactNode;
  id?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    // min-w-0:grid item 自动最小尺寸会被 truncate(nowrap)标题的 min-content
    // 顶爆——移动端视口下热榜长标题把隐式轨道撑到 877px 整页横滚(M48 验收反馈),
    // 打断 min-content 传播链让 truncate 在视口内真正生效
    <div id={id} className="min-w-0 rounded-md border border-line bg-panel">
      <div className="flex flex-wrap items-baseline gap-2 border-b border-line px-4 py-2.5">
        <span className="text-sm font-semibold">{title}</span>
        <span className="text-[11px] text-text-3">{hint}</span>
        {tabs !== undefined && <span className="flex flex-wrap items-center gap-1">{tabs}</span>}
        {extra !== undefined && <span className="ml-auto flex items-center gap-1.5">{extra}</span>}
      </div>
      <div className="px-2 py-2">{children}</div>
    </div>
  );
}
