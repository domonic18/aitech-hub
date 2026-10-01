"use client";

/**
 * 编辑器右侧元信息栏(原型 admin-editor meta panel;M5-d 表单简化):
 * 常用组 = 分类/标签/封面/摘要;【高级选项】默认折叠 = slug/SEO(用户反馈:术语不可
 * 理解、创建时必填项太多)。纯受控组件(值上提,onChange 打补丁),不发请求;
 * 边界校验在 PostEditor.saveOnly。
 */
import { POST_LIMITS } from "@/lib/content/post-schema";

import CoverUploader from "./CoverUploader";
import { INPUT, LABEL } from "./editor-controls";

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
}

/** slug 字段两态:创建可填(带实时派生预览)/编辑只读(displaySlug 解码展示) */
export type SlugField =
  | { mode: "create"; text: string; preview: string; onChange: (v: string) => void }
  | { mode: "edit"; fixed: string };

export default function PostMetaPanel({
  categories,
  value,
  tagCount,
  onChange,
  slug,
}: {
  categories: EditorCategory[];
  value: PostMetaValue;
  tagCount: number;
  onChange: (patch: Partial<PostMetaValue>) => void;
  slug: SlugField;
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
        <CoverUploader coverPath={value.coverPath} onChange={(p) => onChange({ coverPath: p })} />
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

      <details>
        <summary className="cursor-pointer select-none text-xs font-medium text-text-2 hover:text-text-1">
          高级选项(slug / SEO,均可留空)
        </summary>
        <div className="mt-3 flex flex-col gap-4">
          {slug.mode === "create" ? (
            <div>
              <label className={LABEL} htmlFor="post-slug">
                链接地址 slug(留空按标题自动生成)
              </label>
              <input
                id="post-slug"
                value={slug.text}
                onChange={(e) => slug.onChange(e.target.value)}
                placeholder="留空 = 自动生成"
                maxLength={POST_LIMITS.slug}
                className={`${INPUT} font-mono`}
              />
              <div className="mt-1 truncate font-mono text-[11px] text-text-3" title={slug.preview}>
                发布后不可改:{slug.preview}
              </div>
            </div>
          ) : (
            <div>
              <label className={LABEL}>链接地址 slug(发布后不可改)</label>
              <div className={`${INPUT} truncate font-mono text-text-3`} title={"/" + slug.fixed}>
                /{slug.fixed}
              </div>
            </div>
          )}

          <div>
            <label className={LABEL} htmlFor="post-seo-title">
              SEO 标题(搜索引擎结果页;留空用文章标题)
            </label>
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
