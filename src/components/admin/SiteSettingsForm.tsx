"use client";

/**
 * 站点设置表单(M10 批② 电报带条数;M12 批② 键族:首页项目/文章条数、
 * 站点标题、hub 主文案 markdown)。空/越界由服务端 Zod 校验返回 400 文案
 * 原样展示;PUT /api/site-config 多键 partial 一次保存。
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { SiteSettings } from "@/lib/config/site-config";
import type { ApiEnvelope } from "@/lib/http/response";

const inputField =
  "w-32 rounded-sm border border-line bg-panel-2 px-2 py-1.5 text-xs text-text-1 outline-none focus:border-accent";
const wideField =
  "w-full rounded-sm border border-line bg-panel-2 px-2 py-1.5 text-xs text-text-1 outline-none focus:border-accent";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <label className="block text-[11px] text-text-3">
      {label}
      {children}
      {hint ? <span className="mt-1 block leading-relaxed">{hint}</span> : null}
    </label>
  );
}

export default function SiteSettingsForm({ initial }: { initial: SiteSettings }) {
  const router = useRouter();
  const [bandCount, setBandCount] = useState(String(initial.bandItemCount));
  const [repoCount, setRepoCount] = useState(String(initial.repoCount));
  const [postCount, setPostCount] = useState(String(initial.postCount));
  const [siteTitle, setSiteTitle] = useState(initial.siteTitle);
  const [heroMd, setHeroMd] = useState(initial.heroMd);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/site-config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          bandItemCount: Number(bandCount),
          repoCount: Number(repoCount),
          postCount: Number(postCount),
          siteTitle,
          heroMd,
        }),
      });
      const body = (await res.json()) as ApiEnvelope;
      if (body.code !== 0) {
        setError(body.message || `HTTP ${res.status}`);
        return;
      }
      setNotice("已保存,首页即时再生;其余页面的标题在 ISR 周期(≤10 分钟)内更新");
      router.refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-md border border-line bg-panel p-4">
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-sm bg-accent/10 text-accent">
          <svg className="ic ic-sm" aria-hidden="true">
            <use href="#i-setting" />
          </svg>
        </span>
        <b className="text-[13px] text-text-1">前台展示</b>
      </div>
      <div className="mt-3 flex flex-wrap gap-4">
        <Field label="首页电报流条数(1-50,默认 12)">
          <input
            type="number"
            min={1}
            max={50}
            step={1}
            value={bandCount}
            onChange={(e) => setBandCount(e.target.value)}
            aria-label="首页电报流条数"
            className={`mt-1 ${inputField}`}
          />
        </Field>
        <Field label="首页项目卡条数(1-12,默认 3)">
          <input
            type="number"
            min={1}
            max={12}
            step={1}
            value={repoCount}
            onChange={(e) => setRepoCount(e.target.value)}
            aria-label="首页项目卡条数"
            className={`mt-1 ${inputField}`}
          />
        </Field>
        <Field label="首页博主文章条数(1-12,默认 5)">
          <input
            type="number"
            min={1}
            max={12}
            step={1}
            value={postCount}
            onChange={(e) => setPostCount(e.target.value)}
            aria-label="首页博主文章条数"
            className={`mt-1 ${inputField}`}
          />
        </Field>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-text-3">
        电报流条数控制 LIVE 带初始展示(滚动到底自动加载更多);项目/文章条数控制 aside 两张 rail
        卡的行数,非法/低于下限按默认值兜底,超上限取上限。
      </p>

      <div className="mt-5 flex items-center gap-2 border-t border-line pt-4">
        <b className="text-[13px] text-text-1">站点标识</b>
      </div>
      <div className="mt-3 flex flex-col gap-3">
        <Field label="站点标题(1-50 字,默认「一起AI」;作用于浏览器标题、顶栏/页脚、RSS 与 llms.txt)">
          <input
            type="text"
            value={siteTitle}
            onChange={(e) => setSiteTitle(e.target.value)}
            aria-label="站点标题"
            className={`mt-1 ${inputField} w-full sm:w-64`}
          />
        </Field>
        <Field
          label="首页 Hub 主文案(留空用默认;支持 Markdown 行内样式:链接、加粗、斜体、行内代码)"
          hint="展示于首页终端窗的品牌语一行,块级语法会被折叠为行内文本。"
        >
          <textarea
            value={heroMd}
            onChange={(e) => setHeroMd(e.target.value)}
            aria-label="首页 Hub 主文案"
            rows={3}
            maxLength={2000}
            placeholder="例:# AI 信息 Hub — 资讯 · 教程 · 项目,连接人与快速变化的 AI"
            className={`mt-1 font-mono ${wideField}`}
          />
        </Field>
      </div>

      {error && <p className="mt-2 font-mono text-[11px] text-red">{error}</p>}
      {notice && <p className="mt-2 font-mono text-[11px] text-text-2">{notice}</p>}
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          disabled={busy}
          onClick={() => void save()}
          className="cursor-pointer rounded-sm bg-accent px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {busy ? "保存中…" : "保存"}
        </button>
      </div>
      <p className="mt-3 font-mono text-[11px] text-text-3">
        GET/PUT /api/site-config — 配置存 site_config kv(band.item_count / home.repo_count /
        home.post_count / site.title / home.hero_md)。
      </p>
    </div>
  );
}
