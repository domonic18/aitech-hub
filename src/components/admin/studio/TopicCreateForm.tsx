"use client";

/**
 * 创作新建(M42 创作中心:专题新建泛化):主意图(长文创作/贴图创作)+ 标题;
 * 长文意图追加内容形式(TOPIC_PURPOSES,选中即回填定位模板)与写作要求底稿,
 * 贴图意图不填长文定位(配置在详情页「贴图配置」页签)。POST /api/topics
 * 成功后直跳详情页;401/400 行内红字。
 */
import { useState } from "react";
import { useRouter } from "next/navigation";

import type { ApiEnvelope } from "@/lib/http/response";
import {
  DEFAULT_TOPIC_POSITIONING,
  TOPIC_OUTPUT_LABEL,
  TOPIC_OUTPUT_TYPES,
  TOPIC_PURPOSES,
  type TopicOutputType,
  type TopicPurposeKey,
} from "@/lib/topics/constants";

export default function TopicCreateForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [outputType, setOutputType] = useState<TopicOutputType>("article");
  const [title, setTitle] = useState("");
  // 预置推荐体角度底稿(1276 验收反馈:不要每次现填;用户可清空/改写)
  const [positioning, setPositioning] = useState(DEFAULT_TOPIC_POSITIONING);
  const [purposeKey, setPurposeKey] = useState<TopicPurposeKey | null>("video-recommend");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(): Promise<void> {
    if (!title.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/topics", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          outputType,
          ...(outputType === "article" && positioning.trim()
            ? { positioning: positioning.trim() }
            : {}),
        }),
      });
      const body = (await res.json()) as ApiEnvelope<{ id: string }>;
      if (!res.ok || body.code !== 0) {
        setErr(body.message || `创建失败(${res.status})`);
        return;
      }
      router.push(`/admin/studio/${body.data.id}`);
    } catch {
      setErr("网络异常,请重试");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-sm bg-accent px-3 py-1.5 text-xs font-medium text-[color:var(--accent-contrast)] hover:opacity-90"
      >
        新建创作
      </button>
    );
  }
  return (
    <div className="flex flex-col gap-2 rounded-sm border border-line bg-panel p-3">
      <div className="flex items-center gap-1.5">
        <span className="mr-1 font-mono text-[11px] text-text-3">主意图</span>
        {TOPIC_OUTPUT_TYPES.map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => setOutputType(o)}
            className={`cursor-pointer rounded-sm px-2.5 py-1 text-xs font-medium ${
              outputType === o
                ? "bg-accent/12 text-accent"
                : "border border-line text-text-2 hover:text-text-1"
            }`}
          >
            {TOPIC_OUTPUT_LABEL[o]}
          </button>
        ))}
      </div>
      <input
        value={title}
        maxLength={200}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="创作标题(必填,≤200 字符)…"
        className="w-80 rounded-sm border border-line bg-panel px-2.5 py-1.5 text-[13px] outline-none focus:border-accent placeholder:text-text-3"
      />
      {outputType === "article" ? (
        <>
          <div className="flex w-80 flex-wrap items-center gap-1">
            <span className="mr-1 font-mono text-[11px] text-text-3">内容形式</span>
            {TOPIC_PURPOSES.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => {
                  setPurposeKey(p.key);
                  setPositioning(p.positioningTemplate);
                }}
                className={`cursor-pointer rounded-sm px-2 py-0.5 text-[11px] ${
                  purposeKey === p.key
                    ? "bg-panel-2 font-medium text-text-1"
                    : "text-text-2 hover:text-text-1"
                }`}
              >
                {p.label}
              </button>
            ))}
            <span
              className={`rounded-sm px-2 py-0.5 text-[11px] ${
                purposeKey === null ? "bg-panel-2 font-medium text-text-1" : "text-text-3"
              }`}
            >
              自定义
            </span>
          </div>
          <textarea
            value={positioning}
            maxLength={1000}
            onChange={(e) => {
              setPositioning(e.target.value);
              setPurposeKey(null);
            }}
            placeholder="写作要求(可选:选材与口吻指引,生成初稿时生效,≤1000 字符)…"
            rows={2}
            className="w-80 rounded-sm border border-line bg-panel px-2.5 py-1.5 text-[13px] outline-none focus:border-accent placeholder:text-text-3"
          />
        </>
      ) : (
        <p className="w-80 text-[11px] text-text-3">
          贴图配置(张数/比例/裁剪/画面风格)创建后在详情页「贴图配置」页签设置。
        </p>
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || title.trim() === ""}
          className="rounded-sm bg-accent px-3 py-1 text-xs font-medium text-[color:var(--accent-contrast)] hover:opacity-90 disabled:opacity-50"
        >
          创建
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setErr(null);
          }}
          className="rounded-sm border border-line px-3 py-1 text-xs text-text-2 hover:text-text-1"
        >
          取消
        </button>
        {err && <span className="text-[11px] text-red">{err}</span>}
      </div>
    </div>
  );
}
