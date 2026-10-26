"use client";

/**
 * 生成选题(F25/F26 actionCard,M46 验收批落地):洞察簇一键转创作选题——
 * POST /api/insight/clusters/[id]/topic(建题 + 自动挂载簇内电报素材),
 * 成功就地给出创作中心链接;失败显示人话原因,可重试(挂载幂等)。
 */
import Link from "next/link";
import { useState } from "react";

import type { ApiEnvelope } from "@/lib/http/response";

interface TopicGenResult {
  topic_id: string;
  title: string;
  mounted: number;
  admin_url: string;
}

export default function TopicGenButton({ clusterId }: { clusterId: string }): React.ReactElement {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<TopicGenResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function generate(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/insight/clusters/${clusterId}/topic`, { method: "POST" });
      const body = (await res.json()) as ApiEnvelope<TopicGenResult>;
      if (body.code !== 0) {
        setError(body.message);
        return;
      }
      setDone(body.data);
    } finally {
      setBusy(false);
    }
  }

  if (done !== null) {
    return (
      <span className="inline-flex flex-col items-end gap-0.5">
        <span className="text-[11px] text-text-2">
          已建《{done.title}》· 挂素材 {done.mounted} 条
        </span>
        <Link href={done.admin_url} className="text-[11px] text-accent hover:underline">
          去创作中心 →
        </Link>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => void generate()}
        className="cursor-pointer rounded-sm bg-panel-2 px-2.5 py-1 text-xs text-text-2 hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "生成中…" : "生成选题"}
      </button>
      {error && <span className="text-[11px] text-red">{error}</span>}
    </span>
  );
}
