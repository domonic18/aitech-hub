"use client";

/**
 * 贴图组装台编排(M41):详情态 + 全部写操作收口(元数据 PATCH/状态流转/
 * 同步入队/序列重排/移除/删除)+ 异步完成轮询(AI 出图按序列张数增长、
 * 渠道行到终态,5s 步进,4min 超时自停)。动作反馈统一 toast(右下角,
 * M49 验收反馈:顶部 notice 条在页面底部操作时不可见)。布局:顶部状态
 * 步进条,下方左序列轨 / 中预览裁剪 / 右元数据与渠道面板。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { useToast } from "@/components/admin/Toast";
import type { PinDetailDto } from "@/lib/pins/dto";
import type { PinCropSpec, PinStatus } from "@/lib/pins/constants";

import { callPinApi, JSON_HEADERS } from "./api";
import { PIN_BADGE_CLS, PIN_BADGE_LABEL } from "./status";
import ImageRail from "./ImageRail";
import AddImageModal from "./AddImageModal";
import MetaPanel from "./MetaPanel";
import PinStatusStepper from "./PinStatusStepper";
import PreviewPane from "./PreviewPane";

export interface TopicOption {
  id: string;
  title: string;
}
export interface WorkshopRootOption {
  id: string;
  mediaPath: string;
  origin: string;
}

const POLL_STEP_MS = 5000;
const POLL_TIMEOUT_MS = 4 * 60_000;

export default function PinEditor({
  initial,
  topics,
  workshopRoots,
}: {
  initial: PinDetailDto;
  topics: TopicOption[];
  workshopRoots: WorkshopRootOption[];
}): React.ReactElement {
  const router = useRouter();
  const { push } = useToast();
  const [detail, setDetail] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [selected, setSelected] = useState(0);
  const [resetSignal, setResetSignal] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const doneRef = useRef<((d: PinDetailDto) => boolean) | null>(null);
  const deadlineRef = useRef(0);

  useEffect(
    () => () => {
      if (pollRef.current) clearInterval(pollRef.current);
    },
    [],
  );

  /** 异步完成轮询:每 5s 拉详情刷态,done 判真或超时自停;判真时回调
   * onFinish(终态提示由调用方按渠道行状态 toast,超时静默、渠道行为准) */
  const startPolling = useCallback(
    (done: (d: PinDetailDto) => boolean, onFinish?: (d: PinDetailDto) => void) => {
      if (pollRef.current) clearInterval(pollRef.current);
      doneRef.current = done;
      deadlineRef.current = Date.now() + POLL_TIMEOUT_MS;
      pollRef.current = setInterval(() => {
        void callPinApi<PinDetailDto>(`/api/pins/${initial.id}`).then((body) => {
          if (body.code !== 0 || !body.data) return;
          setDetail(body.data);
          if (doneRef.current?.(body.data)) {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            onFinish?.(body.data);
          } else if (Date.now() > deadlineRef.current) {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
          }
        });
      }, POLL_STEP_MS);
    },
    [initial.id],
  );

  /** 立即拉取详情(入队类动作成功后马上刷行状态,防「点了没反应」感知) */
  async function refreshDetail(): Promise<void> {
    const body = await callPinApi<PinDetailDto>(`/api/pins/${initial.id}`);
    if (body.code === 0 && body.data) setDetail(body.data);
  }

  async function mutate(
    url: string,
    init: RequestInit,
    okMsg: string,
  ): Promise<PinDetailDto | null> {
    setBusy(true);
    const body = await callPinApi<PinDetailDto>(url, init);
    setBusy(false);
    if (body.code !== 0 || !body.data) {
      push("error", body.message);
      return null;
    }
    push("success", okMsg);
    return body.data;
  }

  async function saveMeta(patch: Record<string, unknown>) {
    const next = await mutate(
      `/api/pins/${initial.id}`,
      { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify(patch) },
      "已保存",
    );
    if (next) {
      setDetail(next);
      setResetSignal((v) => v + 1);
    }
  }

  async function transition(next: PinStatus) {
    const nextDetail = await mutate(
      `/api/pins/${initial.id}`,
      { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify({ status: next }) },
      "状态已更新",
    );
    if (nextDetail) setDetail(nextDetail);
  }

  /** 渠道行终态谓词(轮询停止条件;基线对比会误停在中间态 pending) */
  const wechatTerminal = (d: PinDetailDto): boolean => {
    const s = d.channels.find((c) => c.channel === "wechat")?.status ?? null;
    return s === "synced" || s === "failed";
  };
  const xhsTerminal = (d: PinDetailDto): boolean => {
    const s = d.channels.find((c) => c.channel === "xiaohongshu")?.status ?? null;
    return s === "synced" || s === "failed";
  };

  function finishWechat(d: PinDetailDto): void {
    const row = d.channels.find((c) => c.channel === "wechat");
    if (row?.status === "synced") push("success", "公众号草稿已同步");
    if (row?.status === "failed") push("error", `公众号同步失败:${row.lastError ?? "原因未知"}`);
  }

  function finishXhs(d: PinDetailDto): void {
    const row = d.channels.find((c) => c.channel === "xiaohongshu");
    if (row?.status === "synced")
      push("success", `小红书已发布${row.publishId ? `:${row.publishId}` : ""}`);
    if (row?.status === "failed")
      push("error", `小红书发布失败(自动重试后仍失败):${row.lastError ?? "原因未知"}`);
  }

  async function syncWechat() {
    setBusy(true);
    const body = await callPinApi<{ jobId: string }>(`/api/pins/${initial.id}/sync`, {
      method: "POST",
    });
    await refreshDetail();
    setBusy(false);
    if (body.code !== 0) {
      push("error", body.message);
      return;
    }
    push("success", "已入队公众号同步,完成后自动提示(约 10~60s)");
    startPolling(wechatTerminal, finishWechat);
  }

  /** 小红书全自动发布(M49 批X3):入队 job(worker 调 gateway Playwright),
   * 轮询渠道行到终态(含 3 次自动重试,超 4min 轮询自停、渠道行为准) */
  async function autoPublishXhs() {
    setBusy(true);
    const body = await callPinApi(`/api/pins/${initial.id}/xhs/distribute`, { method: "POST" });
    await refreshDetail();
    setBusy(false);
    if (body.code !== 0) {
      push("error", body.message);
      return;
    }
    push("success", "已入队小红书自动发布,完成后自动提示(约 1-3 分钟)");
    startPolling(xhsTerminal, finishXhs);
  }

  async function reorder(from: number, to: number) {
    if (to < 0 || to >= detail.images.length) return;
    const ids = detail.images.map((i) => i.id);
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);
    const body = await callPinApi<{ images: PinDetailDto["images"] }>(
      `/api/pins/${initial.id}/images`,
      { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify({ ids }) },
    );
    if (body.code !== 0 || !body.data) {
      push("error", body.message);
      return;
    }
    setDetail((d) => ({ ...d, images: body.data!.images }));
    setSelected(to);
  }

  async function removeImage(imageId: string) {
    const body = await callPinApi<{ images: PinDetailDto["images"] }>(
      `/api/pins/${initial.id}/images?imageId=${imageId}`,
      { method: "DELETE" },
    );
    if (body.code !== 0 || !body.data) {
      push("error", body.message);
      return;
    }
    setDetail((d) => ({ ...d, images: body.data!.images }));
    setSelected(0);
  }

  async function delPin() {
    if (!window.confirm("删除该贴图?图片序列与渠道记录一并删除,不可恢复。")) return;
    const body = await callPinApi(`/api/pins/${initial.id}`, { method: "DELETE" });
    if (body.code !== 0) {
      push("error", body.message);
      return;
    }
    router.push("/admin/pins/");
  }

  /** AI 出图入队(AddImageModal 回调):关弹窗 + 轮询到序列增长 */
  function onGenerated(baseline: number) {
    setAddOpen(false);
    push("success", "AI 出图中(约 15~60s,单批计费不重试),完成后自动挂到序列尾");
    startPolling((d) => d.images.length > baseline);
  }

  const editable = detail.status !== "synced" && detail.status !== "published";
  const images = detail.images;
  const current = images[Math.min(selected, images.length - 1)] ?? null;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2.5">
        <Link href="/admin/pins/" className="cursor-pointer text-xs text-text-3 hover:text-accent">
          ← 返回工作台
        </Link>
        <h1 className="truncate text-lg font-semibold">{detail.title}</h1>
        <span
          className={`rounded-sm px-1.5 py-px font-mono text-[10.5px] text-white ${PIN_BADGE_CLS[detail.status as PinStatus] ?? ""}`}
        >
          {PIN_BADGE_LABEL[detail.status as PinStatus] ?? detail.status}
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={() => void delPin()}
          className="ml-auto cursor-pointer text-xs text-text-3 hover:text-red disabled:cursor-not-allowed disabled:opacity-60"
        >
          删除贴图
        </button>
      </div>

      <PinStatusStepper
        status={detail.status as PinStatus}
        busy={busy}
        onTransition={(n) => void transition(n)}
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[176px_minmax(0,1fr)_400px]">
        <ImageRail
          images={images}
          editable={editable}
          busy={busy}
          selected={Math.min(selected, Math.max(0, images.length - 1))}
          onSelect={setSelected}
          onMove={(from, to) => void reorder(from, to)}
          onRemove={(id) => void removeImage(id)}
          onAdd={() => setAddOpen(true)}
        />
        <PreviewPane
          image={current}
          cropSpec={detail.cropSpec as PinCropSpec}
          editable={editable}
          busy={busy}
          onCropChange={(spec) => void saveMeta({ cropSpec: spec })}
        />
        <MetaPanel
          detail={detail}
          topics={topics}
          editable={editable}
          busy={busy}
          resetSignal={resetSignal}
          onSave={(patch) => void saveMeta(patch)}
          onSync={() => void syncWechat()}
          onAutoPublishXhs={() => void autoPublishXhs()}
        />
      </div>

      {addOpen && (
        <AddImageModal
          pinId={initial.id}
          workshopRoots={workshopRoots}
          currentCount={images.length}
          onClose={() => setAddOpen(false)}
          onAdded={(res) => {
            setDetail((d) => ({ ...d, images: res.images }));
            setAddOpen(false);
            push("success", `已添加 ${res.added} 张图片`);
          }}
          onGenerated={onGenerated}
        />
      )}
    </div>
  );
}
