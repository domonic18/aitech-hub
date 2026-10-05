"use client";

/**
 * 仓库登记/编辑弹窗(M11 批②,BloggerDialog 同款交互):
 * 登记单框 owner/name(经 GitHub /repos 校验存在性,网络不可达降级入库);
 * 编辑不改身份(fullName/slug 冻结),只改同步间隔/前台排序/备注。
 */
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { field } from "@/components/admin/form-fields";
import type { ApiEnvelope } from "@/lib/http/response";
import { GITHUB_SYNC_INTERVAL_MIN } from "@/lib/github/constants";
import DialogShell, { DialogActions } from "@/components/admin/DialogShell";

export interface RepoDialogData {
  id: number;
  syncIntervalMin: number;
  sortOrder: number;
  remark: string | null;
}

export default function RepoDialog({
  label,
  repo,
  buttonClass,
}: {
  label: string;
  repo?: RepoDialogData;
  buttonClass?: string;
}) {
  const router = useRouter();
  const editing = repo !== undefined;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fullName, setFullName] = useState("");
  const [interval, setIntervalMin] = useState(
    String(repo?.syncIntervalMin ?? GITHUB_SYNC_INTERVAL_MIN),
  );
  const [sortOrder, setSortOrder] = useState(String(repo?.sortOrder ?? 0));
  const [remark, setRemark] = useState(repo?.remark ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  const close = (): void => {
    setOpen(false);
    setError(null);
    setFullName("");
  };

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const payload = editing
      ? {
          syncIntervalMin: Number(interval),
          sortOrder: Number(sortOrder),
          remark: remark.trim() || null,
        }
      : {
          fullName: fullName.trim(),
          syncIntervalMin: Number(interval),
          remark: remark.trim() || null,
        };
    try {
      const res = await fetch(editing ? `/api/github/repos/${repo.id}` : "/api/github/repos", {
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
        <DialogShell title={editing ? "编辑仓库" : "登记仓库"}>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {!editing && (
              <label className="col-span-2 text-xs text-text-3">
                仓库 owner/name *
                <input
                  ref={inputRef}
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="如 domonic18/aitech-hub"
                  className={`mt-1 ${field}`}
                />
              </label>
            )}
            <label className="col-span-1 text-xs text-text-3">
              同步间隔(分钟,10..1440)
              <input
                type="number"
                min={10}
                max={1440}
                value={interval}
                onChange={(e) => setIntervalMin(e.target.value)}
                className={`mt-1 ${field}`}
              />
            </label>
            {editing && (
              <label className="col-span-1 text-xs text-text-3">
                前台排序(小者靠前)
                <input
                  type="number"
                  min={0}
                  max={9999}
                  value={sortOrder}
                  onChange={(e) => setSortOrder(e.target.value)}
                  className={`mt-1 ${field}`}
                />
              </label>
            )}
            <label className={`text-xs text-text-3 ${editing ? "col-span-2" : "col-span-1"}`}>
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
              disabled={busy || (!editing && fullName.trim() === "")}
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
