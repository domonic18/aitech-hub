"use client";

/**
 * 媒体库工具条动作(原型 admin-media §2):上传图片(POST /api/media,sha1 去重)+
 * 体检(POST /api/media/audit → 202,扫描在 worker 执行,arch/00 §7 请求内禁秒级)。
 * 成功后 router.refresh 重拉本页 RSC;上传走 upload-client(评审 W4),反馈均为内联提示。
 */
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { IMAGE_MIME_WHITELIST, MEDIA_LIMITS } from "@/lib/media/media-schema";
import { uploadImageFile } from "@/lib/media/upload-client";

export default function MediaActions(): React.ReactElement {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const [auditing, setAuditing] = useState(false);
  const [auditMsg, setAuditMsg] = useState<string | null>(null);

  async function uploadFiles(files: FileList): Promise<void> {
    setUploading(true);
    setUploadMsg(null);
    let ok = 0;
    let reused = 0;
    const failed: string[] = [];
    for (const file of files) {
      if (file.size > MEDIA_LIMITS.maxUploadBytes) {
        failed.push(`${file.name}(超 ${MEDIA_LIMITS.maxUploadBytes / 1024 / 1024}MB)`);
        continue;
      }
      const r = await uploadImageFile(file, file.name);
      if (r.ok) {
        if (r.reused) reused += 1;
        else ok += 1;
      } else {
        failed.push(`${file.name}(${r.error})`);
      }
    }
    setUploading(false);
    const parts: string[] = [];
    if (ok > 0) parts.push(`上传 ${ok} 张`);
    if (reused > 0) parts.push(`去重复用 ${reused} 张`);
    if (failed.length > 0) parts.push(`失败:${failed.join("、")}`);
    setUploadMsg(parts.join(";") || null);
    if (ok > 0 || reused > 0) router.refresh();
  }

  async function triggerAudit(): Promise<void> {
    setAuditing(true);
    setAuditMsg(null);
    try {
      const res = await fetch("/api/media/audit", { method: "POST" });
      setAuditMsg(
        res.status === 202
          ? "体检任务已提交,扫描在后台执行,稍后刷新查看结果。"
          : `提交失败(${res.status})`,
      );
    } catch {
      setAuditMsg("网络错误,请重试");
    } finally {
      setAuditing(false);
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-3">
      <input
        ref={fileRef}
        type="file"
        accept={IMAGE_MIME_WHITELIST.join(",")}
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) void uploadFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        disabled={uploading}
        onClick={() => fileRef.current?.click()}
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-sm bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60"
      >
        <svg className="ic" aria-hidden="true">
          <use href="#i-cloudupload" />
        </svg>
        {uploading ? "上传中…" : "上传图片"}
      </button>
      <button
        type="button"
        disabled={auditing}
        onClick={() => void triggerAudit()}
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-sm border border-line bg-panel px-3 py-2 text-sm text-text-2 hover:border-line-hover hover:text-text-1 disabled:opacity-60"
      >
        <svg className="ic" aria-hidden="true">
          <use href="#i-scan" />
        </svg>
        {auditing ? "提交中…" : "体检"}
      </button>
      {uploadMsg && <span className="text-xs text-text-2">{uploadMsg}</span>}
      {auditMsg && <span className="text-xs text-text-2">{auditMsg}</span>}
    </span>
  );
}
