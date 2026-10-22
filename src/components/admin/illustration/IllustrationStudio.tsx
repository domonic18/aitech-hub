"use client";

/**
 * 配图工坊·编排(M40 批 B):服务端取数初值 + 客户端交互编排——processing
 * 轮询自刷/拆层入队/三回路编辑(候选确认制)/图层显隐乐观更新/显隐组合
 * 导出(canvas 合成 → POST /api/media 入库)。API 包络与类型均自服务端
 * lib 引入,不手写同形接口(M5-a 评审 W3)。
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import type { StudioView } from "@/lib/ai/illustration-studio";
import type { ApiEnvelope } from "@/lib/http/response";
import { formatCnDateTime } from "@/lib/datetime";

import { exportCompositeBlob } from "./composite";
import {
  MODE_TO_ORIGIN,
  ORIGIN_BADGE_CLS,
  ORIGIN_LABEL,
  type EditMode,
  type NormalizedBbox,
} from "./labels";
import EditPanel from "./EditPanel";
import LayerCanvas from "./LayerCanvas";
import LayerTree from "./LayerTree";
import VersionStrip from "./VersionStrip";

type Busy = null | "decompose" | "edit" | "confirm" | "export";

const JSON_HEADERS = { "Content-Type": "application/json" };

async function callApi<T>(url: string, init?: RequestInit): Promise<ApiEnvelope<T>> {
  const res = await fetch(url, init);
  const body = (await res.json().catch(() => null)) as ApiEnvelope<T> | null;
  return body ?? { code: 500, message: `响应解析失败(HTTP ${res.status})`, data: null as T };
}

export default function IllustrationStudio({
  initialView,
}: {
  initialView: StudioView;
}): React.ReactElement {
  const router = useRouter();
  const [view, setView] = useState(initialView);
  const [mode, setMode] = useState<EditMode>("text");
  const [bbox, setBbox] = useState<NormalizedBbox | null>(null);
  const [selectedLayerId, setSelectedLayerId] = useState<number | null>(null);
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [exportPath, setExportPath] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const versionId = view.version.id;
  const group = view.latestGroup;
  const readyGroup = group?.status === "ready" ? group : null;

  const refresh = useCallback(async () => {
    const body = await callApi<StudioView>(`/api/illustration/studio/${versionId}`);
    if (body.code === 0 && body.data) setView(body.data);
  }, [versionId]);

  // 拆层进行中 5s 轮询自刷(ready/failed 即停)
  useEffect(() => {
    if (group?.status !== "processing") return;
    const timer = setInterval(() => {
      void refresh();
    }, 5000);
    return () => clearInterval(timer);
  }, [group?.status, refresh]);

  function handleSelectLayer(id: number | null) {
    setSelectedLayerId(id);
    setEditError(null);
    if (id === null) {
      setBbox(null);
      return;
    }
    const layer = readyGroup?.layers.find((l) => l.id === id);
    if (layer) setBbox(layer.bbox);
  }

  function handleModeChange(m: EditMode) {
    setMode(m);
    setPreviewPath(null);
    setEditError(null);
  }

  async function handleDecompose() {
    setBusy("decompose");
    setEditError(null);
    setExportError(null);
    try {
      const body = await callApi<{ groupId: number }>(
        `/api/illustration/studio/${versionId}/decompose`,
        {
          method: "POST",
          headers: JSON_HEADERS,
          body: "{}",
        },
      );
      if (body.code !== 0) setEditError(body.message);
      else await refresh();
    } catch (e) {
      setEditError(e instanceof Error ? e.message : "网络异常");
    } finally {
      setBusy(null);
    }
  }

  async function handleToggleVisible(layerId: number, visible: boolean) {
    setView((v) => {
      if (!v.latestGroup) return v;
      return {
        ...v,
        latestGroup: {
          ...v.latestGroup,
          layers: v.latestGroup.layers.map((l) => (l.id === layerId ? { ...l, visible } : l)),
        },
      };
    });
    const body = await callApi(`/api/illustration/layers/${layerId}`, {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({ visible }),
    });
    if (body.code !== 0) {
      setEditError(body.message);
      await refresh();
    }
  }

  async function handleEdit() {
    if (!bbox) return;
    setBusy("edit");
    setEditError(null);
    setExportError(null);
    try {
      const body = await callApi<{ imagePath: string }>(
        `/api/illustration/studio/${versionId}/edit`,
        {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({
            mode,
            bbox: bbox.join(" "),
            instruction: instruction.trim() || undefined,
          }),
        },
      );
      if (body.code !== 0) setEditError(body.message);
      else setPreviewPath(body.data.imagePath);
    } catch (e) {
      setEditError(e instanceof Error ? e.message : "网络异常");
    } finally {
      setBusy(null);
    }
  }

  async function handleConfirm() {
    if (!previewPath) return;
    setBusy("confirm");
    try {
      const body = await callApi<{ versionId: number }>(
        `/api/illustration/studio/${versionId}/versions`,
        {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({
            imagePath: previewPath,
            origin: MODE_TO_ORIGIN[mode],
            instruction: instruction.trim() || undefined,
            bbox: bbox ? bbox.join(" ") : undefined,
          }),
        },
      );
      if (body.code !== 0) {
        setEditError(body.message);
        return;
      }
      router.push(`/admin/illustration/${body.data.versionId}`);
    } catch (e) {
      setEditError(e instanceof Error ? e.message : "网络异常");
    } finally {
      setBusy(null);
    }
  }

  async function handleExport() {
    if (!readyGroup) return;
    setBusy("export");
    setExportError(null);
    setExportPath(null);
    try {
      const blob = await exportCompositeBlob({
        baseSrc: readyGroup.baseMediaPath ?? view.version.mediaPath,
        layers: readyGroup.layers
          .filter((l) => l.visible)
          .map((l) => ({ mediaPath: l.mediaPath, bbox: l.bbox })),
      });
      const form = new FormData();
      form.append("file", blob, `illu-export-${versionId}-${Date.now()}.png`);
      const res = await fetch("/api/media", { method: "POST", body: form });
      const body = (await res.json().catch(() => null)) as ApiEnvelope<{ path?: string }> | null;
      if (!body || body.code !== 0 || !body.data?.path) {
        setExportError(body?.message ?? `上传失败(HTTP ${res.status})`);
        return;
      }
      setExportPath(body.data.path);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : "导出失败");
    } finally {
      setBusy(null);
    }
  }

  const originCls = ORIGIN_BADGE_CLS[view.version.origin] ?? ORIGIN_BADGE_CLS.original;
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/admin/illustration/" className="text-[11px] text-text-2 hover:text-accent">
            ← 列表
          </Link>
          <h1 className="text-sm font-medium text-text-1">配图工坊</h1>
          <span className={`rounded-sm px-1.5 py-0.5 text-[10px] ${originCls}`}>
            {ORIGIN_LABEL[view.version.origin] ?? view.version.origin} #{view.version.id}
          </span>
          <span className="text-[11px] text-text-3">
            {formatCnDateTime(new Date(view.version.createdAt))}
          </span>
          <a
            href={view.version.mediaPath}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] text-accent hover:underline"
          >
            查看整图
          </a>
        </div>
        {view.version.editInstruction && (
          <p className="text-[11px] text-text-3">
            本版编辑:{view.version.editInstruction}
            {view.version.editBbox ? `(bbox ${view.version.editBbox})` : ""}
          </p>
        )}
      </header>
      <VersionStrip chain={view.chain} currentId={versionId} />
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <LayerCanvas
          baseSrc={readyGroup?.baseMediaPath ?? view.version.mediaPath}
          group={group}
          selectedLayerId={selectedLayerId}
          editBbox={bbox}
          onSelectLayer={handleSelectLayer}
          onDrawBbox={(b) => {
            setBbox(b);
            setSelectedLayerId(null);
            setEditError(null);
          }}
        />
        <div className="flex flex-col gap-4">
          <LayerTree
            group={group}
            selectedLayerId={selectedLayerId}
            decomposing={busy === "decompose"}
            onSelectLayer={handleSelectLayer}
            onToggleVisible={(id, visible) => void handleToggleVisible(id, visible)}
            onDecompose={() => void handleDecompose()}
          />
          {readyGroup && (
            <section className="flex flex-col gap-2 rounded-md border border-line bg-panel-1 p-3">
              <h2 className="text-xs font-medium text-text-2">导出当前组合</h2>
              <p className="text-[10px] leading-relaxed text-text-3">
                底板 + 可见图层按原分辨率合成 PNG,上传媒体库;隐藏的图层不会出现。
              </p>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void handleExport()}
                className="cursor-pointer rounded-sm bg-accent px-2 py-1.5 text-[11px] font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy === "export" ? "合成上传中…" : "⤓ 合成并上传媒体库"}
              </button>
              {exportPath && (
                <p className="text-[11px] text-text-2">
                  已导出:
                  <a
                    href={exportPath}
                    target="_blank"
                    rel="noreferrer"
                    className="break-all text-accent hover:underline"
                  >
                    {exportPath}
                  </a>
                </p>
              )}
              {exportError && <p className="text-[11px] text-red">{exportError}</p>}
            </section>
          )}
          <EditPanel
            mode={mode}
            bbox={bbox}
            instruction={instruction}
            busy={busy === "edit"}
            previewPath={previewPath}
            error={editError}
            confirming={busy === "confirm"}
            hasReadyGroup={readyGroup !== null}
            onMode={handleModeChange}
            onInstruction={setInstruction}
            onSubmit={() => void handleEdit()}
            onConfirm={() => void handleConfirm()}
            onDiscard={() => setPreviewPath(null)}
          />
        </div>
      </div>
    </div>
  );
}
