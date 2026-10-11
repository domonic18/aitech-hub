"use client";

/**
 * 博主登记/编辑弹窗(M8 批③,ChannelDialog 同款交互):
 * 登记先选平台(M24:抖音/B站,xhs 规划中),填主页链接或裸身份标识
 * (经网关自动拉昵称头像,手填昵称兜底网关不可达);
 * 编辑不改身份(sec_uid),只改昵称/分类/频率/备注。
 */
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import {
  SOCIAL_CRAWL_INTERVAL_MIN,
  VIDEO_PLATFORM_BILIBILI,
  VIDEO_PLATFORM_DOUYIN,
} from "@/lib/telegram/constants";
import { field } from "@/components/admin/form-fields";
import type { ApiEnvelope } from "@/lib/http/response";
import DialogShell, { DialogActions } from "@/components/admin/DialogShell";

export interface BloggerDialogData {
  id: number;
  nickname: string;
  category: string | null;
  crawlIntervalMin: number;
  remark: string | null;
}

/** 登记平台选项(xhs 规划中灰置;与 BloggerCreateSchema REGISTERABLE 同口径) */
const PLATFORM_OPTIONS = [
  { value: VIDEO_PLATFORM_DOUYIN, label: "抖音" },
  { value: VIDEO_PLATFORM_BILIBILI, label: "B站" },
] as const;

/** 平台相关输入提示(身份标签/placeholder) */
const PLATFORM_INPUT_META: Record<string, { label: string; placeholder: string }> = {
  [VIDEO_PLATFORM_DOUYIN]: {
    label: "主页链接或 sec_uid",
    placeholder: "https://www.douyin.com/user/MS4wLjABAAAA… 或分享口令",
  },
  [VIDEO_PLATFORM_BILIBILI]: {
    label: "主页链接或 mid",
    placeholder: "https://space.bilibili.com/9469941 或纯数字 mid(b23.tv 短链亦可)",
  },
};

export default function BloggerDialog({
  label,
  blogger,
  buttonClass,
}: {
  label: string;
  blogger?: BloggerDialogData;
  buttonClass?: string;
}) {
  const router = useRouter();
  const editing = blogger !== undefined;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [platform, setPlatform] = useState<string>(VIDEO_PLATFORM_DOUYIN);
  const [input, setInput] = useState("");
  const [nickname, setNickname] = useState(blogger?.nickname ?? "");
  const [category, setCategory] = useState(blogger?.category ?? "");
  const [interval, setIntervalMin] = useState(
    String(blogger?.crawlIntervalMin ?? SOCIAL_CRAWL_INTERVAL_MIN),
  );
  const [remark, setRemark] = useState(blogger?.remark ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  const close = (): void => {
    setOpen(false);
    setError(null);
    setInput("");
  };

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const payload = editing
      ? {
          nickname: nickname.trim(),
          category: category.trim() || null,
          crawlIntervalMin: Number(interval),
          remark: remark.trim() || null,
        }
      : {
          platform,
          input: input.trim(),
          nickname: nickname.trim() || undefined,
          category: category.trim() || null,
          crawlIntervalMin: Number(interval),
          remark: remark.trim() || null,
        };
    try {
      const res = await fetch(editing ? `/api/bloggers/${blogger.id}` : "/api/bloggers", {
        method: editing ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json()) as ApiEnvelope;
      if (body.code !== 0) {
        setError(body.message || `HTTP ${res.status}`);
        return;
      }
      close();
      router.refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setTimeout(() => inputRef.current?.focus(), 0);
        }}
        className={
          buttonClass ??
          "rounded-sm bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover"
        }
      >
        {label}
      </button>
      {open && (
        <DialogShell width="lg" scroll title={editing ? "编辑博主" : "登记博主"}>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {!editing && (
              <>
                <div className="col-span-2 text-xs text-text-3">
                  平台 *
                  <div className="mt-1 flex items-center gap-2">
                    {PLATFORM_OPTIONS.map((p) => (
                      <button
                        key={p.value}
                        type="button"
                        onClick={() => setPlatform(p.value)}
                        aria-pressed={platform === p.value}
                        className={`rounded-sm border px-3 py-1.5 text-xs transition-colors ${
                          platform === p.value
                            ? "border-accent bg-accent/10 font-medium text-accent"
                            : "border-line text-text-2 hover:bg-panel-2"
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                    <span
                      title="规划中"
                      className="cursor-not-allowed rounded-sm border border-line px-3 py-1.5 text-xs text-text-3 opacity-50"
                    >
                      小红书·规划中
                    </span>
                  </div>
                </div>
                <label className="col-span-2 text-xs text-text-3">
                  {PLATFORM_INPUT_META[platform]?.label ?? "主页链接或身份标识"} *
                  <input
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder={PLATFORM_INPUT_META[platform]?.placeholder ?? ""}
                    className={`mt-1 ${field}`}
                  />
                </label>
              </>
            )}
            <label className="col-span-1 text-xs text-text-3">
              昵称 {editing ? "*" : "(可选,手填兜底)"}
              <input
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                maxLength={100}
                placeholder={editing ? "" : "网关不可达时必填"}
                className={`mt-1 ${field}`}
              />
            </label>
            <label className="col-span-1 text-xs text-text-3">
              分类
              <input
                value={category ?? ""}
                onChange={(e) => setCategory(e.target.value)}
                maxLength={50}
                placeholder="如 AI 工具/大模型"
                className={`mt-1 ${field}`}
              />
            </label>
            <label className="col-span-1 text-xs text-text-3">
              采集间隔(分钟,≥120)
              <input
                type="number"
                min={SOCIAL_CRAWL_INTERVAL_MIN}
                max={1440}
                value={interval}
                onChange={(e) => setIntervalMin(e.target.value)}
                className={`mt-1 ${field}`}
              />
            </label>
            <label className="col-span-1 text-xs text-text-3">
              备注
              <input
                value={remark ?? ""}
                onChange={(e) => setRemark(e.target.value)}
                maxLength={200}
                className={`mt-1 ${field}`}
              />
            </label>
          </div>
          {error && <p className="mt-2 font-mono text-xs text-red">{error}</p>}
          <DialogActions>
            <button
              type="button"
              onClick={close}
              className="rounded-sm border border-line px-3 py-1.5 text-xs text-text-2 hover:bg-panel-2"
            >
              取消
            </button>
            <button
              type="button"
              disabled={busy || nickname.trim() === "" || (!editing && input.trim() === "")}
              onClick={() => void submit()}
              className="rounded-sm bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
            >
              {busy ? "保存中…" : "保存"}
            </button>
          </DialogActions>
        </DialogShell>
      )}
    </>
  );
}
