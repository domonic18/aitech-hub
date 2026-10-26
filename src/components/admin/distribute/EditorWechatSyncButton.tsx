"use client";

/**
 * 编辑页顶栏「同步公众号」入口:与列表行内入口(PostRowOps)同一
 * SyncWechatDialog,预填取编辑器当前表单值(所见即所填;正文仍以库内
 * contentMd 为源,未保存修改先存草稿)。禁用语义对齐列表:渠道未就绪/
 * 同步中禁点;编辑器仅 MD 稿可达,无旧文保真分支。样式对齐 PostEditor
 * 顶栏次级按钮(BTN_SECONDARY 同串,该常量未出模块故就地复制)。
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

import SyncWechatDialog, {
  type WechatSyncDialogPost,
} from "@/components/admin/distribute/SyncWechatDialog";
import { wechatSyncActionLabel } from "@/lib/distribute/channels";

export default function EditorWechatSyncButton({
  post,
  wechatReady,
}: {
  post: WechatSyncDialogPost;
  wechatReady: boolean;
}): React.ReactElement {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const status = post.wechatStatus;
  const disabled = !wechatReady || status === "pending";
  const title = !wechatReady
    ? "先到「内容分发」完成公众号配置并启用渠道"
    : status === "pending"
      ? "同步任务进行中,完成后可再操作"
      : "推送到公众号草稿箱";
  return (
    <>
      <button
        type="button"
        disabled={disabled}
        title={title}
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-sm border border-line bg-panel px-3 py-2 text-sm text-text-1 hover:border-line-hover disabled:cursor-not-allowed disabled:opacity-60"
        onClick={() => setOpen(true)}
      >
        {wechatSyncActionLabel(status)}
      </button>
      {open && (
        <SyncWechatDialog
          post={post}
          onClose={() => {
            setOpen(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
