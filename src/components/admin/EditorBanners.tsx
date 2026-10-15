"use client";

/**
 * 编辑器顶部横幅组(技术债批③,自 PostEditor 抽出):全局错误、自动保存状态行、
 * 影子副本恢复提示。影子横幅(M27 批①):崩溃/断网留底的本地修改,恢复=回填
 * 标题与正文(影子保留至保存成功,期间再崩可再次恢复);丢弃=清除留底。
 */
import { clearPostShadow, type PostShadow } from "@/components/admin/usePostAutosave";
import { formatCnTime } from "@/lib/datetime";

export default function EditorBanners({
  error,
  autosaveLine,
  shadowOffer,
  postId,
  onShadowRecover,
  onShadowDismiss,
}: {
  error: string | null;
  autosaveLine: string | null;
  shadowOffer: PostShadow | null;
  /** 丢弃影子时清除 localStorage 留底(编辑态传入) */
  postId?: string;
  onShadowRecover: (shadow: PostShadow) => void;
  onShadowDismiss: () => void;
}): React.ReactElement {
  return (
    <>
      {error && (
        <div className="rounded-sm border border-red/40 bg-red/10 px-3 py-2 text-xs text-red">
          {error}
        </div>
      )}
      {autosaveLine && !error && <div className="text-xs text-text-3">{autosaveLine}</div>}
      {shadowOffer && (
        <div className="flex flex-wrap items-center gap-2 rounded-sm border border-amber/40 bg-amber/10 px-3 py-2 text-xs text-amber-hi">
          <span>
            检测到未保存的本地修改(留底于 {formatCnTime(new Date(shadowOffer.at))}
            ),是否恢复正文与标题?
          </span>
          <button
            type="button"
            className="cursor-pointer font-semibold underline"
            onClick={() => onShadowRecover(shadowOffer)}
          >
            恢复
          </button>
          <button
            type="button"
            className="cursor-pointer underline"
            onClick={() => {
              if (postId) clearPostShadow(postId);
              onShadowDismiss();
            }}
          >
            丢弃
          </button>
        </div>
      )}
    </>
  );
}
