"use client";

/**
 * 元数据与渠道面板(M41):标题/轻文字/专题/阅读原文 + 保存(草稿态独立,
 * 仅保存成功信号 resetSignal 时从服务端定稿灌回,防轮询/其他写清掉未保存
 * 输入);下段渠道留痕(站点 /pins + 公众号贴图)与同步草稿箱入口。
 */
import { useEffect, useState } from "react";

import { formatCnDateTime } from "@/lib/datetime";
import { PIN_CONTENT_MAX, PIN_CONTENT_SOFT_MAX, PIN_TITLE_MAX } from "@/lib/pins/constants";
import type { PinDetailDto } from "@/lib/pins/dto";

import type { TopicOption } from "./PinEditor";

const FIELD =
  "w-full rounded-sm border border-line bg-panel-2 px-2.5 py-2 text-[13px] text-text-1 outline-none focus:border-accent disabled:opacity-60";

export default function MetaPanel({
  detail,
  topics,
  editable,
  busy,
  resetSignal,
  onSave,
  onSync,
  onDistributeXhs,
  onBackfillXhs,
  onAutoPublishXhs,
  onIngestXhsCookies,
}: {
  detail: PinDetailDto;
  topics: TopicOption[];
  editable: boolean;
  busy: boolean;
  resetSignal: number;
  onSave: (patch: Record<string, unknown>) => void;
  onSync: () => void;
  onDistributeXhs: () => void;
  onBackfillXhs: (noteUrl: string) => void;
  onAutoPublishXhs: () => void;
  onIngestXhsCookies: (cookieHeader: string) => void;
}): React.ReactElement {
  const [title, setTitle] = useState(detail.title);
  const [content, setContent] = useState(detail.content);
  const [topicId, setTopicId] = useState<string>(detail.topicId ?? "");
  const [readMoreUrl, setReadMoreUrl] = useState(detail.readMoreUrl ?? "");
  useEffect(() => {
    setTitle(detail.title);
    setContent(detail.content);
    setTopicId(detail.topicId ?? "");
    setReadMoreUrl(detail.readMoreUrl ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅保存成功信号到达时灌回
  }, [resetSignal]);

  const titleLen = [...title].length;
  const contentLen = [...content].length;
  const urlOk = readMoreUrl === "" || /^https?:\/\/\S+$/.test(readMoreUrl.trim());
  const dirty =
    title.trim() !== detail.title ||
    content !== detail.content ||
    (topicId || null) !== detail.topicId ||
    readMoreUrl.trim() !== (detail.readMoreUrl ?? "");
  const canSave =
    editable &&
    !busy &&
    titleLen > 0 &&
    titleLen <= PIN_TITLE_MAX &&
    contentLen <= PIN_CONTENT_MAX &&
    urlOk;

  const wechat = detail.channels.find((c) => c.channel === "wechat");
  const xhs = detail.channels.find((c) => c.channel === "xiaohongshu");
  const [xhsUrl, setXhsUrl] = useState("");
  const [xhsCookie, setXhsCookie] = useState("");

  return (
    <div className="rounded-sm border border-line bg-panel p-3.5">
      <div className="mb-3">
        <div className="mb-1 flex items-center">
          <label className="text-xs font-medium text-text-1" htmlFor="pin-title">
            标题 <span className="text-red">*</span>
          </label>
          <span
            className={`ml-auto font-mono text-[10.5px] ${titleLen > PIN_TITLE_MAX ? "text-red" : "text-text-3"}`}
          >
            {titleLen}/{PIN_TITLE_MAX} 字
          </span>
        </div>
        <input
          id="pin-title"
          value={title}
          disabled={!editable}
          onChange={(e) => setTitle(e.target.value)}
          className={FIELD}
        />
      </div>

      <div className="mb-3">
        <div className="mb-1 flex items-center">
          <label className="text-xs font-medium text-text-1" htmlFor="pin-content">
            轻文字
          </label>
          <span
            className={`ml-auto font-mono text-[10.5px] ${
              contentLen > PIN_CONTENT_MAX
                ? "text-red"
                : contentLen > PIN_CONTENT_SOFT_MAX
                  ? "text-amber-hi"
                  : "text-text-3"
            }`}
          >
            {contentLen} 字
            {contentLen > PIN_CONTENT_SOFT_MAX && contentLen <= PIN_CONTENT_MAX
              ? " · 建议 ≤1000"
              : ""}
          </span>
        </div>
        <textarea
          id="pin-content"
          value={content}
          disabled={!editable}
          onChange={(e) => setContent(e.target.value)}
          rows={7}
          className={`${FIELD} leading-relaxed`}
          placeholder="小绿书正文纯文本(禁 Markdown/内联 HTML)…"
        />
      </div>

      <div className="mb-3 grid grid-cols-1 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-text-1" htmlFor="pin-topic">
            绑定专题
          </label>
          <select
            id="pin-topic"
            value={topicId}
            disabled={!editable}
            onChange={(e) => setTopicId(e.target.value)}
            className={`${FIELD} cursor-pointer`}
          >
            <option value="">未绑定</option>
            {topics.map((t) => (
              <option key={t.id} value={t.id}>
                #{t.id} {t.title}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-text-1" htmlFor="pin-url">
            阅读原文链接(可空)
          </label>
          <input
            id="pin-url"
            value={readMoreUrl}
            disabled={!editable}
            onChange={(e) => setReadMoreUrl(e.target.value)}
            placeholder="https://…"
            className={`${FIELD} ${urlOk ? "" : "border-red"}`}
          />
          {!urlOk && <p className="mt-1 text-[11px] text-red">须为 http(s) 完整链接</p>}
        </div>
      </div>

      <button
        type="button"
        disabled={!canSave || !dirty}
        onClick={() =>
          onSave({
            title: title.trim(),
            content,
            topicId: topicId === "" ? null : topicId,
            readMoreUrl: readMoreUrl.trim() === "" ? null : readMoreUrl.trim(),
          })
        }
        className="w-full cursor-pointer rounded-sm bg-accent py-2 text-xs font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
      >
        {dirty ? "保存修改" : "已与线上一致"}
      </button>
      {!editable && (
        <p className="mt-1.5 text-[11px] text-amber-hi">
          已同步/已发布锁定编辑——「撤回再编辑」后方可改
        </p>
      )}

      <h3 className="mb-2 mt-4 border-t border-line pt-3.5 text-[13px] font-medium text-text-1">
        渠道记录
      </h3>
      <div className="mb-2 rounded-sm border border-line border-l-2 border-l-green px-3 py-2 text-[12px] text-text-2">
        <div className="font-medium text-text-1">站点 /pins</div>
        <div className="mt-0.5 font-mono text-[11px] text-text-3">
          {detail.status === "published"
            ? `已上架 · ${detail.publishedAt ? formatCnDateTime(new Date(detail.publishedAt)) : ""}`
            : "未上架 · 待验收后点「发布」"}
        </div>
      </div>
      <div
        className={`rounded-sm border border-line border-l-2 px-3 py-2 text-[12px] text-text-2 ${
          wechat?.status === "synced" ? "border-l-green" : "border-l-accent"
        }`}
      >
        <div className="flex items-center font-medium text-text-1">公众号贴图(小绿书)</div>
        <div className="mt-0.5 font-mono text-[11px] text-text-3">
          {wechat
            ? `状态 ${wechat.status} · 尝试 ${wechat.attempts} 次${
                wechat.syncedAt ? ` · ${formatCnDateTime(new Date(wechat.syncedAt))}` : ""
              }${wechat.mediaId ? ` · mediaId ${wechat.mediaId}` : ""}`
            : "未同步"}
        </div>
        {wechat?.lastError && <p className="mt-1 text-[11px] text-red">{wechat.lastError}</p>}
        <button
          type="button"
          disabled={busy}
          onClick={onSync}
          className="mt-2 w-full cursor-pointer rounded-sm border border-accent px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent-dim disabled:cursor-not-allowed disabled:opacity-60"
        >
          同步公众号草稿箱
        </button>
        <p className="mt-1 text-[10.5px] text-text-3">资格:已配置公众号 + 待验收态 + 至少 1 张图</p>
      </div>
      <div
        className={`rounded-sm border border-line border-l-2 px-3 py-2 text-[12px] text-text-2 ${
          xhs?.status === "synced" ? "border-l-green" : "border-l-accent"
        }`}
      >
        <div className="flex items-center font-medium text-text-1">小红书(人工发布)</div>
        <div className="mt-0.5 font-mono text-[11px] text-text-3">
          {xhs
            ? `状态 ${xhs.status}${xhs.syncedAt ? ` · ${formatCnDateTime(new Date(xhs.syncedAt))}` : ""}${
                xhs.publishId ? ` · ${xhs.publishId}` : ""
              }`
            : "未分发"}
        </div>
        {/* 分发是渠道操作非内容编辑:验收过(非草稿)即可,发布态贴图正是分发主对象 */}
        {detail.status !== "draft" && !xhs && (
          <>
            <details className="rounded-sm border border-line bg-panel-2 px-3 py-2">
              <summary className="cursor-pointer text-[11px] text-text-3">
                登录态 Cookie(已登录创作平台的浏览器 F12 复制;一次粘贴长期有效)
              </summary>
              <textarea
                value={xhsCookie}
                onChange={(e) => setXhsCookie(e.target.value)}
                rows={3}
                placeholder="粘贴 creator.xiaohongshu.com 的 Cookie 串(a=b; c=d …)"
                className={`${FIELD} mt-1.5 font-mono text-[11px]`}
              />
              <button
                type="button"
                disabled={busy || xhsCookie.trim().length < 10}
                onClick={() => {
                  onIngestXhsCookies(xhsCookie.trim());
                  setXhsCookie("");
                }}
                className="mt-1.5 w-full cursor-pointer rounded-sm border border-accent px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent-dim disabled:cursor-not-allowed disabled:opacity-50"
              >
                保存登录态
              </button>
            </details>
            <button
              type="button"
              disabled={busy}
              onClick={onAutoPublishXhs}
              className="mt-2 w-full cursor-pointer rounded-sm bg-accent px-3 py-2 text-xs font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              一键发布到小红书(自动)
            </button>
            <p className="mt-1 text-[10.5px] text-text-3">
              自动:agent 经浏览器自动化在创作平台发布(标题+轻文字+全部图片),约 1-3 分钟;
              失败自动降级为人工回填模式
            </p>
            <button
              type="button"
              onClick={() =>
                void navigator.clipboard
                  .writeText(`${detail.title}\n\n${detail.content}`)
                  .catch(() => undefined)
              }
              className="mt-1.5 w-full cursor-pointer rounded-sm border border-line px-3 py-1.5 text-xs text-text-2 hover:bg-panel-2"
            >
              复制发布文案(标题 + 轻文字)
            </button>
          </>
        )}
        {xhs && xhs.status !== "synced" && (
          <div className="mt-2 flex items-center gap-2">
            <input
              value={xhsUrl}
              onChange={(e) => setXhsUrl(e.target.value)}
              placeholder="粘贴小红书笔记链接"
              className="min-w-0 flex-1 rounded-sm border border-line bg-panel px-2.5 py-1.5 text-xs text-text-1 placeholder:text-text-3 focus:border-accent focus:outline-none"
            />
            <button
              type="button"
              disabled={busy || xhsUrl.trim() === ""}
              onClick={() => {
                onBackfillXhs(xhsUrl.trim());
                setXhsUrl("");
              }}
              className="cursor-pointer rounded-sm bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              标记已发布
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
