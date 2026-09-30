"use client";

/**
 * 编辑器右侧元信息栏(原型 admin-editor meta panel):分类/标签/封面/摘要/SEO。
 * 纯受控组件(值上提,onChange 打补丁),不发请求;边界校验在 PostEditor.saveOnly。
 */
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

export default function PostMetaPanel({
  categories,
  value,
  tagCount,
  onChange,
}: {
  categories: EditorCategory[];
  value: PostMetaValue;
  tagCount: number;
  onChange: (patch: Partial<PostMetaValue>) => void;
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
          标签(逗号分隔,最多 5 个)
        </label>
        <input
          id="post-tags"
          value={value.tagsText}
          onChange={set("tagsText")}
          placeholder="如:Claude Code、Next.js"
          className={INPUT}
        />
        <div className="mt-1 font-mono text-[11px] text-text-3">{tagCount} / 5</div>
      </div>

      <div>
        <label className={LABEL} htmlFor="post-cover">
          封面路径
        </label>
        <input
          id="post-cover"
          value={value.coverPath}
          onChange={set("coverPath")}
          placeholder="/wp-content/uploads/…"
          className={`${INPUT} font-mono`}
        />
        <div className="mt-1 text-[11px] text-text-3">
          站内路径手填;上传工作流随 M5-b(媒体库)交付
        </div>
      </div>

      <div>
        <label className={LABEL} htmlFor="post-excerpt">
          摘要
        </label>
        <textarea
          id="post-excerpt"
          value={value.excerpt}
          onChange={set("excerpt")}
          maxLength={500}
          rows={3}
          className={`${INPUT} resize-y`}
        />
        <div className="mt-1 font-mono text-[11px] text-text-3">{value.excerpt.length} / 500</div>
      </div>

      <div>
        <label className={LABEL} htmlFor="post-seo-title">
          SEO 标题(缺省用文章标题)
        </label>
        <input
          id="post-seo-title"
          value={value.seoTitle}
          onChange={set("seoTitle")}
          maxLength={255}
          className={INPUT}
        />
      </div>

      <div>
        <label className={LABEL} htmlFor="post-seo-desc">
          SEO 描述(缺省用摘要)
        </label>
        <textarea
          id="post-seo-desc"
          value={value.seoDescription}
          onChange={set("seoDescription")}
          maxLength={500}
          rows={3}
          className={`${INPUT} resize-y`}
        />
      </div>
    </div>
  );
}
