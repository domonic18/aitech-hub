"use client";

/**
 * 站点设置表单(M10 批② 电报带条数;M12 批② 键族:首页项目/文章条数、
 * 站点标题、hub 主文案 markdown;2026-10-05 反馈:关于页内容 markdown。
 * 2026-10-09 验收反馈问题1:重构为分区设置形态——首页展示/站点标识/关于页
 * 三分区卡 + 底部 sticky 保存条。2026-10-17 验收反馈:增「Agent 额度」
 * 分区——三档(游客/登录用户/管理员)×工具调用次数/tokens 上限,recursion
 * 按 2.5×toolCalls 服务端派生不入表单)。空/越界由服务端 Zod 校验返回 400
 * 文案原样展示;PUT /api/site-config 多键 partial 一次保存,保存后
 * revalidatePath ("/","layout") 全站即时再生。
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
import {
  TOKENS_MAX,
  TOKENS_MIN,
  TOOL_CALLS_MAX,
  TOOL_CALLS_MIN,
  type AgentLimitKind,
  type AgentLimitsConfig,
} from "@/lib/config/agent-limits";
import { ABOUT_MD_MAX, type SiteSettings } from "@/lib/config/site-config";
import type { ApiEnvelope } from "@/lib/http/response";

/** 三档额度展示名与默认值(默认值仅作 hint 文案) */
const AGENT_KIND_META: Record<AgentLimitKind, { label: string; def: AgentLimitsConfig }> = {
  guest: { label: "游客", def: { toolCalls: 12, tokens: 50_000 } },
  user: { label: "登录用户", def: { toolCalls: 12, tokens: 50_000 } },
  admin: { label: "管理员", def: { toolCalls: 80, tokens: 400_000 } },
};

/** 输入框字符串态(提交时 Number 化,服务端 Zod 把关) */
type AgentFormState = Record<AgentLimitKind, { toolCalls: string; tokens: string }>;

function toAgentFormState(v: Record<AgentLimitKind, AgentLimitsConfig>): AgentFormState {
  return {
    guest: { toolCalls: String(v.guest.toolCalls), tokens: String(v.guest.tokens) },
    user: { toolCalls: String(v.user.toolCalls), tokens: String(v.user.tokens) },
    admin: { toolCalls: String(v.admin.toolCalls), tokens: String(v.admin.tokens) },
  };
}

export default function SiteSettingsForm({
  initial,
  agentLimits,
}: {
  initial: SiteSettings;
  agentLimits: Record<AgentLimitKind, AgentLimitsConfig>;
}) {
  const router = useRouter();
  const [bandCount, setBandCount] = useState(String(initial.bandItemCount));
  const [repoCount, setRepoCount] = useState(String(initial.repoCount));
  const [postCount, setPostCount] = useState(String(initial.postCount));
  const [siteTitle, setSiteTitle] = useState(initial.siteTitle);
  const [heroMd, setHeroMd] = useState(initial.heroMd);
  const [aboutMd, setAboutMd] = useState(initial.aboutMd);
  const [icp, setIcp] = useState(initial.icp);
  const [agent, setAgent] = useState<AgentFormState>(toAgentFormState(agentLimits));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const setAgentField = (kind: AgentLimitKind, field: "toolCalls" | "tokens", v: string): void => {
    setAgent((prev) => ({ ...prev, [kind]: { ...prev[kind], [field]: v } }));
  };

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
          guestToolCalls: Number(agent.guest.toolCalls),
          guestTokens: Number(agent.guest.tokens),
          userToolCalls: Number(agent.user.toolCalls),
          userTokens: Number(agent.user.tokens),
          adminToolCalls: Number(agent.admin.toolCalls),
          adminTokens: Number(agent.admin.tokens),
        }),
      });
      const body = (await res.json()) as ApiEnvelope;
      if (body.code !== 0) {
        setError(body.message || `HTTP ${res.status}`);
        return;
      }
      setNotice(
        "已保存,首页即时再生;其余页面的标题在 ISR 周期(≤10 分钟)内更新;Agent 额度对收到的下一条消息生效",
      );
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

      <SettingsSection
        icon="i-robot"
        title="Agent 额度"
        description="站内 AI 助手(搜索/专题生产)的单轮护栏,按身份分档;保存后新会话即时生效。递归上限按工具调用次数 2.5 倍自动推导,不单独设置。"
      >
        <SettingsGrid cols={3}>
          {(["guest", "user", "admin"] as const).map((kind) => (
            <SettingsField
              key={`${kind}-toolcalls`}
              label={`${AGENT_KIND_META[kind].label} · 工具调用次数`}
              htmlFor={`cfg-agent-${kind}-toolcalls`}
              hint={`1-200,默认 ${AGENT_KIND_META[kind].def.toolCalls}`}
            >
              <input
                id={`cfg-agent-${kind}-toolcalls`}
                type="number"
                min={TOOL_CALLS_MIN}
                max={TOOL_CALLS_MAX}
                step={1}
                value={agent[kind].toolCalls}
                onChange={(e) => setAgentField(kind, "toolCalls", e.target.value)}
                aria-label={`${AGENT_KIND_META[kind].label}工具调用次数上限`}
                className={INPUT}
              />
            </SettingsField>
          ))}
          {(["guest", "user", "admin"] as const).map((kind) => (
            <SettingsField
              key={`${kind}-tokens`}
              label={`${AGENT_KIND_META[kind].label} · tokens 上限`}
              htmlFor={`cfg-agent-${kind}-tokens`}
              hint={`1000-2000000,默认 ${AGENT_KIND_META[kind].def.tokens}`}
            >
              <input
                id={`cfg-agent-${kind}-tokens`}
                type="number"
                min={TOKENS_MIN}
                max={TOKENS_MAX}
                step={1000}
                value={agent[kind].tokens}
                onChange={(e) => setAgentField(kind, "tokens", e.target.value)}
                aria-label={`${AGENT_KIND_META[kind].label}tokens 用量上限`}
                className={INPUT}
              />
            </SettingsField>
          ))}
        </SettingsGrid>
      </SettingsSection>

      <SettingsActions message={message} sticky>
        <button type="button" disabled={busy} onClick={() => void save()} className={BTN_PRIMARY}>
          {busy ? "保存中…" : "保存设置"}
        </button>
      </SettingsActions>
    </div>
  );
}
