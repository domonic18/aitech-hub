"use client";

/**
 * 贴图详情抽屉(M41):开抽屉时抓 GET /api/pins/[id](图片序列+渠道留痕),
 * 首图大预览 + 缩略条切换 + 事实 kv + 渠道记录;「继续组装」进组装台。
 * 编辑动作不做在抽屉(改文案/调序列去组装台,单点入口防两处漂移);
 * 删除除外(M42 反馈:列表侧无删除入口,须先进组装台才能删,补进抽屉底栏)。
 */
import { useEffect, useState } from "react";
import Link from "next/link";

import type { PinDetailDto, PinImageDto } from "@/lib/pins/dto";
import type { PinStatus } from "@/lib/pins/constants";
import { formatCnDateTime } from "@/lib/datetime";
import { PUBLISH_STATUS_LABELS } from "@/lib/distribute/channels";

import { callPinApi } from "./api";
import { PIN_BADGE_CLS, PIN_BADGE_LABEL } from "./status";

function ChannelRow({
  label,
  note,
  ok,
}: {
  label: string;
  note: string;
  ok: boolean;
}): React.ReactElement {
  return (
    <div
      className={`mb-1.5 rounded-sm border border-line border-l-2 px-3 py-2 text-[12px] text-text-2 ${
        ok ? "border-l-green" : "border-l-accent"
      }`}
    >
      <div className="flex items-center gap-1.5 font-medium text-text-1">
        <svg className={`ic ic-sm ${ok ? "text-green" : ""}`} aria-hidden="true">
          <use href={ok ? "#i-check" : "#i-export"} />
        </svg>
        {label}
      </div>
      <div className="mt-0.5 font-mono text-[11px] text-text-3">{note}</div>
    </div>
  );
}

export default function PinDetailDrawer({
  pinId,
  onClose,
  onDeleted,
}: {
  pinId: string;
  onClose: () => void;
  onDeleted?: (id: string) => void;
}): React.ReactElement {
  const [detail, setDetail] = useState<PinDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [selected, setSelected] = useState(0);

  async function delPin(): Promise<void> {
    if (!window.confirm("删除该贴图?图片序列与渠道记录一并删除,不可恢复。")) return;
    setDeleting(true);
    const body = await callPinApi(`/api/pins/${pinId}`, { method: "DELETE" });
    setDeleting(false);
    if (body.code !== 0) {
      setError(body.message);
      return;
    }
    onDeleted?.(pinId);
  }

  useEffect(() => {
    let alive = true;
    void callPinApi<PinDetailDto>(`/api/pins/${pinId}`).then((body) => {
      if (!alive) return;
      if (body.code !== 0 || !body.data) setError(body.message);
      else setDetail(body.data);
    });
    return () => {
      alive = false;
    };
  }, [pinId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const images: PinImageDto[] = detail?.images ?? [];
  const current = images[selected] ?? images[0] ?? null;
  const status = detail ? (detail.status as PinStatus) : null;
  const wechat = detail?.channels.find((c) => c.channel === "wechat");

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/45" onClick={onClose} aria-hidden="true" />
      <aside className="absolute bottom-0 right-0 top-0 flex w-[460px] max-w-[92vw] flex-col border-l border-line bg-panel shadow-2xl">
        <div className="flex items-center gap-2.5 border-b border-line px-5 py-4">
          <h3 className="text-[15px] font-semibold">贴图详情</h3>
          {status && (
            <span
              className={`rounded-sm px-1.5 py-px font-mono text-[10.5px] text-white ${PIN_BADGE_CLS[status]}`}
            >
              {PIN_BADGE_LABEL[status] ?? detail?.status}
            </span>
          )}
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            className="ml-auto cursor-pointer text-text-3 hover:text-text-1"
          >
            <svg className="ic" style={{ width: 16, height: 16 }} aria-hidden="true">
              <use href="#i-close" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {error && <p className="text-xs text-red">{error}</p>}
          {!detail && !error && <p className="py-6 text-center text-xs text-text-3">加载中…</p>}
          {detail && (
            <>
              <div className="mb-3 overflow-hidden rounded-sm border border-line">
                {current ? (
                  // eslint-disable-next-line @next/next/no-img-element -- 站内媒体路径缩略
                  <img src={current.mediaPath} alt="" className="block w-full" />
                ) : (
                  <div className="flex aspect-[3/4] items-center justify-center text-xs text-text-3">
                    暂无图片
                  </div>
                )}
              </div>
              {images.length > 0 && (
                <div className="mb-4 flex gap-2 overflow-x-auto">
                  {images.map((img, i) => (
                    <button
                      key={img.id}
                      type="button"
                      onClick={() => setSelected(i)}
                      className={`w-16 flex-none overflow-hidden rounded-sm border ${
                        i === selected
                          ? "border-accent shadow-[0_0_0_1px_var(--accent)]"
                          : "border-line"
                      }`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- 站内媒体路径缩略 */}
                      <img
                        src={img.mediaPath}
                        alt=""
                        loading="lazy"
                        className="h-[85px] w-full object-cover"
                      />
                      <span className="block bg-black/65 py-px text-center font-mono text-[9.5px] text-accent-hi">
                        {img.versionId ? `工坊 #${img.versionId}` : "上传"}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              <dl className="mb-4 grid grid-cols-[92px_1fr] gap-x-3 gap-y-2 text-[12.5px]">
                <dt className="text-text-3">标题</dt>
                <dd className="break-all font-mono text-xs text-text-1">
                  {detail.title}({[...detail.title].length} / 32 字)
                </dd>
                <dt className="text-text-3">轻文字</dt>
                <dd className="font-mono text-xs text-text-1">
                  {[...detail.content].length} 字(纯文本)
                </dd>
                <dt className="text-text-3">图片</dt>
                <dd className="font-mono text-xs text-text-1">
                  {images.length} 张 · {detail.cropSpec} · 首张即封面
                </dd>
                <dt className="text-text-3">专题</dt>
                <dd className="font-mono text-xs text-text-1">
                  {detail.topicId ? `#${detail.topicId}` : "未绑定"}
                </dd>
                <dt className="text-text-3">更新时间</dt>
                <dd className="font-mono text-xs text-text-1">
                  {formatCnDateTime(new Date(detail.updatedAt))}
                </dd>
              </dl>
              <h4 className="mb-2 text-[13px] font-medium text-text-1">渠道记录</h4>
              <ChannelRow
                label="站点 /pins"
                ok={detail.status === "published"}
                note={
                  detail.publishedAt
                    ? `已上架 · ${formatCnDateTime(new Date(detail.publishedAt))}`
                    : "已保存 · 验收通过点「发布」后前台可见"
                }
              />
              <ChannelRow
                label="公众号贴图(小绿书)"
                ok={wechat?.status === "synced"}
                note={
                  wechat
                    ? `${PUBLISH_STATUS_LABELS[wechat.status] ?? `状态 ${wechat.status}`}${
                        wechat.lastError ? ` · ${wechat.lastError}` : ""
                      }${wechat.syncedAt ? ` · ${formatCnDateTime(new Date(wechat.syncedAt))}` : ""}`
                    : "未同步 · 验收通过后执行「同步草稿箱」"
                }
              />
              {(() => {
                const xhs = detail.channels.find((c) => c.channel === "xiaohongshu");
                return (
                  <ChannelRow
                    label="小红书(自动发布)"
                    ok={xhs?.status === "synced"}
                    note={
                      xhs
                        ? `${PUBLISH_STATUS_LABELS[xhs.status] ?? `状态 ${xhs.status}`}${
                            xhs.lastError ? ` · ${xhs.lastError}` : ""
                          }${xhs.syncedAt ? ` · ${formatCnDateTime(new Date(xhs.syncedAt))}` : ""}${
                            xhs.publishId ? ` · ${xhs.publishId}` : ""
                          }`
                        : "未分发 · 验收通过后到组装台「一键发布到小红书」"
                    }
                  />
                );
              })()}
            </>
          )}
        </div>

        <div className="flex gap-2.5 border-t border-line px-5 py-3.5">
          <button
            type="button"
            disabled={deleting}
            onClick={() => void delPin()}
            className="cursor-pointer text-xs text-text-3 hover:text-red disabled:cursor-not-allowed disabled:opacity-60"
          >
            删除贴图
          </button>
          <Link
            href={`/admin/pins/${pinId}`}
            className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-sm border border-line py-2 text-[13px] text-text-1 hover:border-accent hover:text-accent"
          >
            <svg className="ic" aria-hidden="true">
              <use href="#i-edit" />
            </svg>
            继续组装
          </Link>
        </div>
      </aside>
    </div>
  );
}
