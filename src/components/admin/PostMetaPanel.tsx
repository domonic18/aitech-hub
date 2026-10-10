"use client";

/**
 * 编辑器右侧元信息栏(原型 admin-editor meta panel;M5-d 表单简化):
 * 常用组 = 分类/标签/封面/摘要;【高级选项】默认折叠 = slug/SEO(用户反馈:术语不可
 * 理解、创建时必填项太多)。纯受控组件(值上提,onChange 打补丁),不发请求;
 * 边界校验在 PostEditor.saveOnly。SEO「AI 填充」按钮(2026-10-06 验收反馈问题7)
 * 仅转交 onSeoSuggest 回调,请求仍在 PostEditor(不发请求契约不破)。
 */
import { POST_LIMITS, type ContentOrigin } from "@/lib/content/post-schema";

import CoverUploader from "./CoverUploader";
import { INPUT, LABEL } from "./editor-controls";
import type { CoverGenContext } from "./cover/templates";

export interface EditorCategory {
  slug: string;
  name: string;
}

export interface PostMetaValue {
  categorySlug: string;
  tagsText: string;
  coverPath: string;
  excerpt: string;
  seoTitle: string;
  seoDescription: string;
  contentOrigin: ContentOrigin;
  /** 阅读门禁(M21 批⑤ + 补齐批):付费开关 + 价格文本 + 登录可见;付费/登录可见互斥 */
  isPurchasable: boolean;
  purchasePriceText: string;
  isLoginRequired: boolean;
}

/** 创作方式选项(值域唯一真相源 CONTENT_ORIGINS;合规要求见 post-schema 注) */
const ORIGIN_OPTIONS: Array<{ value: ContentOrigin; label: string }> = [
  { value: "human", label: "人工原创" },
  { value: "ai_assisted", label: "AI 辅助创作" },
  { value: "ai_generated", label: "AI 生成" },
];

/** slug 字段(2026-10 URL 终态):两态统一可编辑——id 锚定 URL,改 slug 永不毁外链;
 * preview 展示派生/当前 canonical 形态,留空语义由调用方按创建(=派生)/编辑(=不改)区分 */
export type SlugField = { text: string; preview: string; onChange: (v: string) => void };

export default function PostMetaPanel({
  categories,
  value,
  tagCount,
  onChange,
  slug,
  onSeoSuggest,
  seoSuggesting = false,
  coverContext,
}: {
  categories: EditorCategory[];
  value: PostMetaValue;
  tagCount: number;
  onChange: (patch: Partial<PostMetaValue>) => void;
  slug: SlugField;
  /** 提供即渲染「AI 填充」(PostEditor 传生成函数;缺省不渲染,如测试) */
  onSeoSuggest?: () => void;
  seoSuggesting?: boolean;
  /** AI 文生图上下文(标题/摘要/标签快照;缺省不出 AI 生图入口) */
  coverContext?: CoverGenContext;
}): React.ReactElement {
  const set =
    (key: keyof PostMetaValue) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      onChange({ [key]: e.target.value });

  return (
    <div className="flex flex-col gap-4 rounded-md border border-line bg-panel p-4">
      <div>
        <label className={LABEL} htmlFor="post-category">
          分类
        </label>
        <select
          id="post-category"
          value={value.categorySlug}
          onChange={set("categorySlug")}
          className={INPUT}
        >
          {categories.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className={LABEL} htmlFor="post-origin">
          创作方式(对外合规标识)
        </label>
        <select
          id="post-origin"
          value={value.contentOrigin}
          onChange={(e) => onChange({ contentOrigin: e.target.value as ContentOrigin })}
          className={INPUT}
        >
          {ORIGIN_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <div className="mt-1 text-[11px] text-text-3">
          AI 生成内容按《人工智能生成合成内容标识办法》须显式标识,发布后展示于文章页
        </div>
      </div>

      <div>
        <label className={LABEL} htmlFor="post-tags">
          标签(逗号分隔,最多 {POST_LIMITS.tagsMax} 个)
        </label>
        <input
          id="post-tags"
          value={value.tagsText}
          onChange={set("tagsText")}
          placeholder="如:Claude Code、Next.js"
          className={INPUT}
        />
        <div className="mt-1 font-mono text-[11px] text-text-3">
          {tagCount} / {POST_LIMITS.tagsMax}
        </div>
      </div>

      <div>
        <CoverUploader
          coverPath={value.coverPath}
          onChange={(p) => onChange({ coverPath: p })}
          coverContext={coverContext}
        />
      </div>

      <div>
        <label className={LABEL} htmlFor="post-excerpt">
          摘要(列表/订阅展示;留空自动截取正文)
        </label>
        <textarea
          id="post-excerpt"
          value={value.excerpt}
          onChange={set("excerpt")}
          maxLength={POST_LIMITS.excerpt}
          rows={3}
          className={`${INPUT} resize-y`}
        />
        <div className="mt-1 font-mono text-[11px] text-text-3">
          {value.excerpt.length} / {POST_LIMITS.excerpt}
        </div>
      </div>

      <div>
        <label className={LABEL} htmlFor="post-gate">
          阅读门禁(M21)
        </label>
        <select
          id="post-gate"
          value={value.isPurchasable ? "paid" : value.isLoginRequired ? "login" : "free"}
          onChange={(e) => {
            const gate = e.target.value;
            if (gate === "paid") {
              onChange({ isPurchasable: true, isLoginRequired: false });
            } else if (gate === "login") {
              onChange({ isPurchasable: false, purchasePriceText: "", isLoginRequired: true });
            } else {
              onChange({ isPurchasable: false, purchasePriceText: "", isLoginRequired: false });
            }
          }}
          className={INPUT}
        >
          <option value="free">免费阅读</option>
          <option value="login">登录可见(免费,须登录)</option>
          <option value="paid">付费解锁</option>
        </select>
        <div className="mt-1 text-[11px] text-text-3">
          {value.isPurchasable
            ? "前台仅展示截断预览,读者支付解锁全文"
            : value.isLoginRequired
              ? "前台仅展示截断预览,登录后免费阅读全文"
              : "全文对所有人可见"}
        </div>
        {value.isPurchasable && (
          <div className="mt-2">
            <label className={LABEL} htmlFor="post-price">
              价格(元)
            </label>
            <input
              id="post-price"
              type="number"
              inputMode="decimal"
              min={0.01}
              max={999.99}
              step={0.01}
              value={value.purchasePriceText}
              onChange={set("purchasePriceText")}
              placeholder="5.00"
              className={INPUT}
            />
            <div className="mt-1 text-[11px] text-text-3">0.01 ~ 999.99 元;下单按此服务端定价</div>
          </div>
        )}
      </div>

      <details>
        <summary className="cursor-pointer select-none text-xs font-medium text-text-2 hover:text-text-1">
          高级选项(slug / SEO,均可留空)
        </summary>
        <div className="mt-3 flex flex-col gap-4">
          <div>
            <label className={LABEL} htmlFor="post-slug">
              链接地址 slug(ASCII;可随时改,旧链接按 id 自动重定向)
            </label>
            <input
              id="post-slug"
              value={slug.text}
              onChange={(e) => slug.onChange(e.target.value)}
              placeholder={slug.preview}
              maxLength={POST_LIMITS.slug}
              className={`${INPUT} font-mono`}
            />
            <div className="mt-1 truncate font-mono text-[11px] text-text-3" title={slug.preview}>
              文章地址:{slug.preview}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label className={LABEL} htmlFor="post-seo-title">
                SEO 标题(搜索引擎结果页;留空用文章标题)
              </label>
              {onSeoSuggest && (
                <button
                  type="button"
                  disabled={seoSuggesting}
                  title="按标题/分类/标签/摘要/正文由 LLM 生成 SEO 标题与描述,覆盖现有值"
                  onClick={onSeoSuggest}
                  className="mb-1 cursor-pointer text-xs text-accent hover:text-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {seoSuggesting ? "生成中…" : "AI 填充"}
                </button>
              )}
            </div>
            <input
              id="post-seo-title"
              value={value.seoTitle}
              onChange={set("seoTitle")}
              maxLength={POST_LIMITS.seoTitle}
              className={INPUT}
            />
          </div>

          <div>
            <label className={LABEL} htmlFor="post-seo-desc">
              SEO 描述(结果页摘要;留空用摘要)
            </label>
            <textarea
              id="post-seo-desc"
              value={value.seoDescription}
              onChange={set("seoDescription")}
              maxLength={POST_LIMITS.seoDescription}
              rows={3}
              className={`${INPUT} resize-y`}
            />
          </div>
        </div>
      </details>
    </div>
  );
}
