import PostCard from "@/components/site/PostCard";
import PostListView from "@/components/site/PostListView";
import { listLatestPosts, listPinnedPosts } from "@/lib/content/posts";
import { DEFAULT_PAGE_SIZE } from "@/lib/constants";

/** 首页(04 文档 §1:ISR 600s;最新 + 精选) */
export const revalidate = 600;

export default async function HomePage(): Promise<React.ReactElement> {
  const [pinned, latest] = await Promise.all([
    listPinnedPosts(5),
    listLatestPosts(DEFAULT_PAGE_SIZE),
  ]);
  const rest = latest.slice(0, DEFAULT_PAGE_SIZE);

  return (
    <div className="space-y-10">
      <section className="rounded-xl bg-neutral-50 px-5 py-6 ring-1 ring-neutral-200/60 dark:bg-neutral-900 dark:ring-neutral-800">
        <h1 className="text-xl font-bold sm:text-2xl">一起AI技术 —— 一个人的 AI 工程实战档案</h1>
        <p className="mt-2 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
          第一人称、可复现、可问责的实战记录:Claude Code / MCP / LLM 训练与评测。
          文章教用法,仓库给武器 —— 每篇都尽量带上可以直接跑的资产。
        </p>
      </section>

      {pinned.length > 0 ? (
        <section>
          <h2 className="mb-1 text-sm font-semibold text-neutral-500">精选</h2>
          <div>
            {pinned.map((post) => (
              <PostCard key={post.slug} post={post} />
            ))}
          </div>
        </section>
      ) : null}

      <PostListView
        heading="最新文章"
        description={`最新 ${rest.length} 篇,完整列表见「文章」`}
        items={rest}
        total={rest.length}
        page={1}
        pageSize={DEFAULT_PAGE_SIZE}
        basePath="/articles"
      />
    </div>
  );
}
