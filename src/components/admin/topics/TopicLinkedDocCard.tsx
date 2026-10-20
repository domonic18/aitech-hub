/**
 * 初稿文档状态卡(2026-10-20 验收反馈问题三:合成后链路可视化;同日详情页
 * 重构更名「初稿」)——专题详情「初稿」区内展示:文档标题/状态 + 公众号渠道
 * 同步快照(未同步/已同步/失败原因),把「生成初稿 → 人工定稿 → 发布 → 渠道
 * 分发」的落点直接摆在生成按钮旁边;「打开文档」主按钮引导人工定稿。服务端
 * 纯展示件,数据 getLinkedDocDetail。
 */
import Link from "next/link";

export interface LinkedDocDetail {
  title: string;
  status: string;
  wechat: { status: string; syncedAt: Date | null; lastError: string | null } | null;
}

const DOC_STATUS: Record<string, { label: string; cls: string }> = {
  published: { label: "已发布", cls: "border-green/30 bg-green/10 text-green-hi" },
  draft: { label: "草稿", cls: "border-amber/30 bg-amber/10 text-amber-hi" },
  deleted: { label: "已删除", cls: "border-line bg-panel-2 text-text-3" },
};

const WECHAT_STATUS: Record<string, { label: string; cls: string }> = {
  synced: { label: "已同步草箱", cls: "text-green-hi" },
  failed: { label: "同步失败", cls: "text-red" },
  pending: { label: "待同步", cls: "text-text-3" },
};

export default function TopicLinkedDocCard({
  postId,
  doc,
}: {
  postId: string;
  doc: LinkedDocDetail;
}) {
  const docStatus = DOC_STATUS[doc.status] ?? {
    label: doc.status,
    cls: "border-line bg-panel-2 text-text-3",
  };
  const wechat = doc.wechat ? (WECHAT_STATUS[doc.wechat.status] ?? null) : null;
  return (
    <div className="rounded-sm border border-line bg-panel p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold text-text-3">初稿</span>
        <Link
          href={`/admin/posts/${postId}`}
          className="min-w-0 truncate text-[13px] font-medium text-text-1 hover:text-accent"
          title={doc.title}
        >
          {doc.title}
        </Link>
        <span className={`rounded-sm border px-1.5 py-0.5 text-[11px] ${docStatus.cls}`}>
          {docStatus.label}
        </span>
        <span className="ml-auto">
          <Link
            href={`/admin/posts/${postId}`}
            className="rounded-sm bg-accent px-3 py-1 text-xs font-medium text-[color:var(--accent-contrast)] hover:opacity-90"
          >
            打开文档
          </Link>
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-text-3">
        <span>公众号:</span>
        {wechat ? (
          <>
            <span className={wechat.cls}>{wechat.label}</span>
            {doc.wechat?.syncedAt && (
              <span>· {doc.wechat.syncedAt.toLocaleString("zh-CN", { hour12: false })}</span>
            )}
            {doc.wechat?.lastError && (
              <span className="text-red" title={doc.wechat.lastError}>
                · {doc.wechat.lastError.slice(0, 60)}
              </span>
            )}
          </>
        ) : (
          <span>未推送(文档编辑页右上角「公众号同步」发起)</span>
        )}
      </div>
    </div>
  );
}
