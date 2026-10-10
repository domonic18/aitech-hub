"use client";

/**
 * 站点设置表单(M10 批② 电报带条数;M12 批② 键族:首页项目/文章条数、
 * 站点标题、hub 主文案 markdown;2026-10-05 反馈:关于页内容 markdown。
 * 2026-10-09 验收反馈问题1:重构为分区设置形态——首页展示/站点标识/关于页
 * 三分区卡 + 底部 sticky 保存条)。空/越界由服务端 Zod 校验返回 400 文案原样
 * 展示;PUT /api/site-config 多键 partial 一次保存,保存后 revalidatePath
 * ("/","layout") 全站即时再生。
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  BTN_PRIMARY,
  INPUT,
  SettingsActions,
  SettingsField,
  SettingsGrid,
  SettingsSection,
} from "@/components/admin/settings-controls";
import { ABOUT_MD_MAX, type SiteSettings } from "@/lib/config/site-config";
import type { ApiEnvelope } from "@/lib/http/response";

export default function SiteSettingsForm({ initial }: { initial: SiteSettings }) {
  const router = useRouter();
  const [bandCount, setBandCount] = useState(String(initial.bandItemCount));
  const [repoCount, setRepoCount] = useState(String(initial.repoCount));
  const [postCount, setPostCount] = useState(String(initial.postCount));
  const [siteTitle, setSiteTitle] = useState(initial.siteTitle);
  const [heroMd, setHeroMd] = useState(initial.heroMd);
  const [aboutMd, setAboutMd] = useState(initial.aboutMd);
  const [icp, setIcp] = useState(initial.icp);
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
          aboutMd,
          icp,
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

  const message = error ? (
    <p className="text-[11px] leading-relaxed text-red">{error}</p>
  ) : notice ? (
    <p className="text-[11px] leading-relaxed text-accent">{notice}</p>
  ) : null;

  return (
    <div className="flex flex-col gap-4">
      <SettingsSection
        icon="i-eye"
        title="首页展示"
        description="控制首页 LIVE 带、项目卡与博主文章 rail 的展示条数;非法或越界值按默认兜底。"
      >
        <SettingsGrid cols={3}>
          <SettingsField label="电报流条数" htmlFor="cfg-band" hint="1-50,默认 12">
            <input
              id="cfg-band"
              type="number"
              min={1}
              max={50}
              step={1}
              value={bandCount}
              onChange={(e) => setBandCount(e.target.value)}
              aria-label="首页电报流条数"
              className={INPUT}
            />
          </SettingsField>
          <SettingsField label="项目卡条数" htmlFor="cfg-repo" hint="1-12,默认 3">
            <input
              id="cfg-repo"
              type="number"
              min={1}
              max={12}
              step={1}
              value={repoCount}
              onChange={(e) => setRepoCount(e.target.value)}
              aria-label="首页项目卡条数"
              className={INPUT}
            />
          </SettingsField>
          <SettingsField label="博主文章条数" htmlFor="cfg-post" hint="1-12,默认 5">
            <input
              id="cfg-post"
              type="number"
              min={1}
              max={12}
              step={1}
              value={postCount}
              onChange={(e) => setPostCount(e.target.value)}
              aria-label="首页博主文章条数"
              className={INPUT}
            />
          </SettingsField>
        </SettingsGrid>
      </SettingsSection>

      <SettingsSection
        icon="i-aim"
        title="站点标识"
        description="浏览器标题、顶栏/页脚、RSS 与 llms.txt 共用的站点身份;备案号展示于页脚。"
      >
        <SettingsGrid>
          <SettingsField label="站点标题" htmlFor="cfg-title" hint="1-50 字,默认「一起AI」">
            <input
              id="cfg-title"
              type="text"
              value={siteTitle}
              onChange={(e) => setSiteTitle(e.target.value)}
              aria-label="站点标题"
              className={INPUT}
            />
          </SettingsField>
          <SettingsField
            label="ICP 备案号"
            htmlFor="cfg-icp"
            hint="留空不展示;保存后页脚出现指向工信部备案系统的链接。"
          >
            <input
              id="cfg-icp"
              type="text"
              value={icp}
              onChange={(e) => setIcp(e.target.value)}
              aria-label="ICP 备案号"
              maxLength={60}
              placeholder="京ICP备XXXXXXXX号-X"
              className={INPUT}
            />
          </SettingsField>
        </SettingsGrid>
        <div className="mt-4">
          <SettingsField
            label="首页 Hub 主文案"
            htmlFor="cfg-hero"
            hint="首页终端窗品牌语一行;支持行内 Markdown(链接、加粗、斜体、行内代码),块级语法折叠为行内文本。"
          >
            <textarea
              id="cfg-hero"
              value={heroMd}
              onChange={(e) => setHeroMd(e.target.value)}
              aria-label="首页 Hub 主文案"
              rows={3}
              maxLength={2000}
              placeholder="例:# AI 信息 Hub — 资讯 · 教程 · 项目,连接人与快速变化的 AI"
              className={`font-mono ${INPUT} resize-y`}
            />
          </SettingsField>
        </div>
      </SettingsSection>

      <SettingsSection
        icon="i-checkcircle"
        title="关于页"
        description="展示于前台 /about/;保存后随全站配置即时再生。"
      >
        <SettingsField
          label="关于页内容"
          htmlFor="cfg-about"
          hint="留空用内置默认文案;支持完整 Markdown(标题、列表、链接、加粗、行内代码、代码块)。"
        >
          <textarea
            id="cfg-about"
            value={aboutMd}
            onChange={(e) => setAboutMd(e.target.value)}
            aria-label="关于页内容"
            rows={10}
            maxLength={ABOUT_MD_MAX}
            placeholder="留空回退内置默认文案;支持完整 Markdown。"
            className={`font-mono ${INPUT} resize-y`}
          />
        </SettingsField>
      </SettingsSection>

      <SettingsActions message={message} sticky>
        <button type="button" disabled={busy} onClick={() => void save()} className={BTN_PRIMARY}>
          {busy ? "保存中…" : "保存设置"}
        </button>
      </SettingsActions>
    </div>
  );
}
