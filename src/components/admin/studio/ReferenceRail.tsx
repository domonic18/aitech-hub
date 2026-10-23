"use client";

/**
 * 参照图选择轨(M42 批④ 贴图配置;M44 验收反馈补齐三源入口)——候选来自
 * 服务端 resolveTopicReferences(绑定样例图 → 样例图库全量 → 视频封面 →
 * 挂载文章配图 → 本创作已有贴图,仅站内 uploads);另支持 ① 上传本地图
 * ② 剪贴板粘贴图片,均经
 * 既有 uploadImageFile → POST /api/media 管线入库,路径写进 pin_positioning
 * 的「参照图:」条款行,随「保存贴图配置」落库(get_topic_brief 同源读取)。
 * 「自动」= 不指定,agent 生成时按同一优先级自选;单选、无多选。
 * 粘贴监听挂 document:仅本轨可见(hidden 页签 display:none → offsetParent
 * null,不接管)且目标非输入框时才消费剪贴板图片,其余粘贴行为不受影响。
 * 上传/粘贴的路径不在服务端候选内,以「已指定」卡呈现(条款行持久,刷新仍在)。
 */
import { useEffect, useRef, useState } from "react";

import SampleLibraryModal from "@/components/admin/SampleLibraryModal";
import { uploadImageFile } from "@/lib/media/upload-client";
import { REFERENCE_SOURCE_LABEL, type ReferenceSource } from "@/lib/topics/reference-labels";

export interface ReferenceRailItem {
  source: string;
  mediaPath: string;
  label: string;
}

const ACCEPT = "image/jpeg,image/png,image/webp,image/gif";

export default function ReferenceRail({
  candidates,
  value,
  onChange,
  disabled = false,
}: {
  candidates: ReferenceRailItem[];
  /** 当前指定路径(空串 = 自动) */
  value: string;
  onChange: (mediaPath: string) => void;
  disabled?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // 图库管理弹层(F8;本轨自持开合态):开着时本轨不抢剪贴板粘贴
  const [libOpen, setLibOpen] = useState(false);

  async function upload(file: Blob, filename: string): Promise<void> {
    if (uploading) return;
    setErr(null);
    setUploading(true);
    const r = await uploadImageFile(file, filename);
    setUploading(false);
    if (r.ok) {
      onChange(r.path);
    } else {
      setErr(r.error);
    }
  }

  // 剪贴板图片 → 上传管线;目标在输入框/可编辑区(文本粘贴)或本轨不可见时不接管
  useEffect(() => {
    const onPaste = (e: ClipboardEvent): void => {
      if (disabled || uploading || libOpen) return;
      const t = e.target;
      if (
        t instanceof HTMLElement &&
        (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA")
      ) {
        return;
      }
      if (!rootRef.current || rootRef.current.offsetParent === null) return;
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith("image/"));
      const file = item?.getAsFile();
      if (!file) return;
      e.preventDefault();
      void upload(file, file.name || "paste.png");
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  });

  /** 上传/粘贴图不在服务端候选内 → 以「已指定」卡呈现 */
  const specifiedOutside = value !== "" && !candidates.some((c) => c.mediaPath === value);

  return (
    <div ref={rootRef} className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold text-text-3">参照图</span>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange("")}
          className={`rounded-sm px-2 py-0.5 text-[11px] ${
            value === ""
              ? "bg-accent/12 font-medium text-accent"
              : "border border-line text-text-2 hover:text-text-1"
          } disabled:opacity-50`}
        >
          自动(按优先级)
        </button>
        <button
          type="button"
          disabled={disabled || uploading}
          onClick={() => fileRef.current?.click()}
          className="rounded-sm border border-line px-2 py-0.5 text-[11px] text-text-2 hover:text-text-1 disabled:opacity-50"
        >
          {uploading ? "上传中…" : "上传"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT}
          aria-label="上传参照图"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void upload(f, f.name);
          }}
        />
        <button
          type="button"
          onClick={() => setLibOpen(true)}
          className="rounded-sm border border-line px-2 py-0.5 text-[11px] text-text-2 hover:text-text-1"
        >
          图库管理
        </button>
      </div>
      <p className="text-[11px] leading-relaxed text-text-3">
        {value === ""
          ? "点选下方预置候选,或上传 / 粘贴(Ctrl+V)本地图;不指定则生成时自选:样例图 → 样例图库 → 视频封面 → 文章配图 → 本创作贴图"
          : value}
      </p>
      {specifiedOutside && (
        <div className="w-20 shrink-0 overflow-hidden rounded-sm border border-accent">
          {/* eslint-disable-next-line @next/next/no-img-element -- 管理端内部缩略,src 为站内动态路径 */}
          <img src={value} alt="已指定参照图" className="h-20 w-20 bg-panel-2 object-cover" />
          <span className="block truncate px-1 py-0.5 text-[10px] text-accent">已指定</span>
        </div>
      )}
      {candidates.length === 0 ? (
        <p className="text-[11px] text-text-3">
          暂无预置候选(样例图库为空,素材也没有可用封面/配图;可先用上传/粘贴)
        </p>
      ) : (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {candidates.map((c) => {
            const selected = value === c.mediaPath;
            return (
              <button
                key={`${c.source}:${c.mediaPath}`}
                type="button"
                disabled={disabled}
                onClick={() => onChange(c.mediaPath)}
                title={`${REFERENCE_SOURCE_LABEL[c.source as ReferenceSource] ?? c.source}·${c.label}`}
                className={`w-20 shrink-0 cursor-pointer overflow-hidden rounded-sm border text-left disabled:opacity-50 ${
                  selected ? "border-accent" : "border-line hover:border-text-3"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- 管理端内部缩略,src 为站内动态路径 */}
                <img
                  src={c.mediaPath}
                  alt={c.label}
                  loading="lazy"
                  className="h-20 w-20 bg-panel-2 object-cover"
                />
                <span className="block truncate px-1 py-0.5 text-[10px] text-text-3">
                  {REFERENCE_SOURCE_LABEL[c.source as keyof typeof REFERENCE_SOURCE_LABEL] ??
                    c.source}
                </span>
              </button>
            );
          })}
        </div>
      )}
      {err && (
        <p className="text-[11px] text-red" role="alert">
          {err}
        </p>
      )}
      <SampleLibraryModal open={libOpen} onClose={() => setLibOpen(false)} />
    </div>
  );
}
