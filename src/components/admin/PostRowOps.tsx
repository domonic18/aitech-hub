"use client";

/**
 * 列表行内操作(原型 admin-posts .ops):编辑为普通链接(M5-d 反馈:行点击 = 查看,
 * 编辑走显式按钮;旧文回填后同样可编辑,未回填行由编辑页保真只读兜底);
 * 发布/下架/删除走 /api/posts,成功后 router.refresh 重拉本页 RSC。
 * M17 批④:「同步公众号」开 SyncWechatDialog(旧文/渠道未就绪禁用,pending 禁点)。
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import SyncWechatDialog, {
  type WechatSyncDialogPost,
} from "@/components/admin/distribute/SyncWechatDialog";
import SyncXhsDialog from "@/components/admin/distribute/SyncXhsDialog";
import type { PostDisplayState } from "@/lib/content/post-schema";
import { CHANNEL_WECHAT, wechatSyncActionLabel } from "@/lib/distribute/channels";
import { AGENT_OPEN_EVENT } from "@/lib/agent/agent-host";

const OP_BTN =
  "cursor-pointer rounded-sm bg-transparent px-1.5 py-1 text-xs text-accent hover:bg-accent-dim disabled:cursor-not-allowed disabled:opacity-50";
const OP_DANGER = "text-red hover:bg-red/10 hover:text-red-hi";

export interface PostSyncView {
  coverPath: string | null;
  seoTitle: string | null;
  excerpt: string | null;
  seoDescription: string | null;
  syncable: boolean;
  channels: Array<{ channel: string; status: string }>;
}

export default function PostRowOps({
  id,
  title,
  state,
  legacy,
  sync,
  wechatReady,
}: {
  id: string;
  title: string;
  state: PostDisplayState;
  legacy: boolean;
  sync?: PostSyncView;
  wechatReady: boolean;
}): React.ReactElement {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncOpen, setSyncOpen] = useState(false);
  const [xhsOpen, setXhsOpen] = useState(false);

  const status = sync?.channels.find((c) => c.channel === CHANNEL_WECHAT)?.status ?? null;
  const syncDisabled = !wechatReady || !sync?.syncable || status === "pending";
  const syncTitle = !wechatReady
    ? "先到「内容分发」完成公众号配置并启用渠道"
    : !sync?.syncable
      ? "旧文保真:HTML 正文不支持公众号同步,先转写 Markdown"
      : status === "pending"
        ? "同步任务进行中,完成后可再操作"
        : "推送到公众号草稿箱";

  async function act(path: string, method: string, confirmText?: string): Promise<void> {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(path, { method });
      if (res.ok) {
        router.refresh();
        return;
      }
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      setError(body?.message ?? `操作失败(${res.status})`);
    } catch {
      setError("网络错误,请重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <span className="inline-flex items-center gap-2.5">
        <Link href={`/admin/posts/${id}`} className={`${OP_BTN} inline-flex items-center`}>
          编辑
        </Link>
        {state !== "published" && (
          <button
            type="button"
            disabled={busy}
            className={OP_BTN}
            onClick={() => act(`/api/posts/${id}/publish`, "POST")}
          >
            {state === "unpublished" ? "重新上架" : "发布"}
          </button>
        )}
        {state === "published" && (
          <button
            type="button"
            disabled={busy}
            className={OP_BTN}
            onClick={() => act(`/api/posts/${id}/unpublish`, "POST")}
          >
            下架
          </button>
        )}
        {!legacy && (
          <button
            type="button"
            disabled={busy}
            className={`${OP_BTN} ${OP_DANGER}`}
            onClick={() =>
              act(`/api/posts/${id}`, "DELETE", "确认删除该文章?删除后前台即刻不可见。")
            }
          >
            删除
          </button>
        )}
        {sync && (
          <button
            type="button"
            disabled={syncDisabled}
            title={syncTitle}
            className={OP_BTN}
            onClick={() => setSyncOpen(true)}
          >
            {wechatSyncActionLabel(status)}
          </button>
        )}
        {!legacy && (
          <button
            type="button"
            title="唤起 AI 助手撰写小红书笔记(半自动)"
            className={OP_BTN}
            onClick={() => {
              // M49 批X2':撰写走侧边栏 agent 会话(可见可迭代);物料/回填面板
              // 同步打开,轮询 agent 工具落库后的 ready 物料
              window.dispatchEvent(
                new CustomEvent(AGENT_OPEN_EVENT, {
                  detail: {
                    ask: `请先用 read_post 工具阅读文章(post_id=${id}),然后把它改写成一篇小红书笔记并保存:标题 ≤20 字(可含 1 个 emoji);正文 100-1000 字,口语化短段落、适度 emoji、结尾一句互动引导,禁止外链与「公众号/博客」等导流词;3-6 个话题词(不带 # 号)。写完调用 save_xhs_draft 工具保存(post_id="${id}"),保存成功后告诉我。`,
                    send: true,
                  },
                }),
              );
              setXhsOpen(true);
            }}
          >
            小红书
          </button>
        )}
      </span>
      {error && <span className="text-[11px] text-red">{error}</span>}
      {xhsOpen && <SyncXhsDialog postId={id} onClose={() => setXhsOpen(false)} />}
      {syncOpen && sync && (
        <SyncWechatDialog
          post={
            {
              id,
              title,
              seoTitle: sync.seoTitle,
              excerpt: sync.excerpt,
              seoDescription: sync.seoDescription,
              coverPath: sync.coverPath,
              wechatStatus: status,
            } satisfies WechatSyncDialogPost
          }
          onClose={() => {
            setSyncOpen(false);
            router.refresh();
          }}
        />
      )}
    </span>
  );
}
