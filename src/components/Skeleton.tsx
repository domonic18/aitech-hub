/**
 * 站点骨架图(M10 批④):路由段 loading.tsx 的纯 CSS 占位基元与组合件,
 * 无客户端 JS(animate-pulse);令牌与真实内容同源(bg-panel-2 底、圆角同阶、
 * 版心同宽),骨架→内容不跳版。组合件按「页面形态」划分,勿在业务页内复用。
 *
 * ⚠️ loading.tsx 只放无状态码语义的路由(e2e 实证):段落级 loading 会使
 * 首屏 shell 先行 200 冲刷,页内 permanentRedirect/notFound 退化为软跳转/
 * 软 404(post 308 归一是 SEO 红线,category/tag 同理),admin 段 loading
 * 与 router.refresh 互卡致变更后内容不出——故 post/category/tag/admin
 * 不挂 loading(前三者为 ISR 缓存热读,生产近秒开,收益本就趋零)。
 */
import type { ReactElement } from "react";

/** 基元:一块脉冲占位(尺寸/圆角随调用方给;装饰性,aria-hidden) */
export function Skeleton({ className }: { className: string }): ReactElement {
  return <div aria-hidden="true" className={`animate-pulse rounded bg-panel-2 ${className}`} />;
}

/** 列表页头:标题条 + 计数行(PostListView/归档同形态) */
export function ListHeadSkeleton(): ReactElement {
  return (
    <header className="border-b border-line/60 pb-4">
      <Skeleton className="h-7 w-44" />
      <Skeleton className="mt-2 h-4 w-20" />
    </header>
  );
}

/** 文章列表行族:PostCard 形态(标题/两行摘要/元信息 chips) */
export function ArticleRowsSkeleton({ count = 6 }: { count?: number }): ReactElement {
  return (
    <div>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="border-b border-line/60 py-5 last:border-b-0">
          <Skeleton className={`h-5 ${i % 3 === 2 ? "w-3/5" : "w-[80%]"}`} />
          <Skeleton className="mt-2 h-4 w-full" />
          <Skeleton className="mt-1.5 h-4 w-5/6" />
          <div className="mt-3 flex items-center gap-3">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-3.5 w-16 rounded-sm" />
            <Skeleton className="h-3.5 w-14" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** 文章列表(全部文章:PostListView 形态) */
export function ArticleListSkeleton(): ReactElement {
  return (
    <section className="mx-auto w-full max-w-3xl">
      <ListHeadSkeleton />
      <ArticleRowsSkeleton />
    </section>
  );
}

/** 归档:页头 + 按年分组的紧凑行(标题行/日期列) */
export function ArchiveListSkeleton(): ReactElement {
  return (
    <section className="mx-auto w-full max-w-3xl">
      <ListHeadSkeleton />
      {[0, 1].map((y) => (
        <section key={y} className="mt-8">
          <Skeleton className="h-5 w-16" />
          <div className="mt-2 divide-y divide-line/60">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="flex items-center gap-3 py-2">
                <Skeleton className="h-4 w-12 shrink-0" />
                <Skeleton className={`h-4 ${i % 2 === 0 ? "w-2/3" : "w-1/2"}`} />
              </div>
            ))}
          </div>
        </section>
      ))}
    </section>
  );
}

/** 电报流时间轴:页头 + 筛选 chips + 日分组卡(首卡视频形态)+ 右栏 */
export function FeedSkeleton(): ReactElement {
  return (
    <div className="mx-auto w-full max-w-[var(--site-max-w)]">
      <div className="mt-6">
        <Skeleton className="h-7 w-52" />
        <div className="mt-2 flex gap-2">
          <Skeleton className="h-6 w-24 rounded-sm" />
          <Skeleton className="h-6 w-24 rounded-sm" />
        </div>
      </div>
      <div className="mt-5 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <main className="min-w-0">
          <div className="mb-3 flex gap-2">
            {["w-12", "w-12", "w-12"].map((w, i) => (
              <Skeleton key={i} className={`h-7 ${w} rounded-sm`} />
            ))}
          </div>
          <div className="flex flex-col gap-3">
            {/* 首卡按视频形态(封面列 + 信息列),余卡文字形态 */}
            <div className="grid grid-cols-[72px_1fr] gap-4 rounded-lg border border-line bg-panel p-4 sm:grid-cols-[88px_1fr]">
              <Skeleton className="h-[128px] w-[72px] rounded-sm sm:h-[157px] sm:w-[88px]" />
              <div className="flex flex-col gap-2">
                <Skeleton className="h-4 w-32 rounded-sm" />
                <Skeleton className="h-5 w-4/5" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            </div>
            {[0, 1, 2].map((i) => (
              <div key={i} className="rounded-lg border border-line bg-panel p-4">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-4 w-20 rounded-sm" />
                  <Skeleton className="h-3.5 w-24" />
                </div>
                <Skeleton className="mt-2 h-5 w-3/4" />
                <Skeleton className="mt-1.5 h-4 w-full" />
              </div>
            ))}
          </div>
        </main>
        <aside className="hidden min-w-0 flex-col gap-4 lg:flex">
          {[0, 1].map((i) => (
            <div key={i} className="overflow-hidden rounded-lg border border-line bg-panel">
              <div className="border-b border-line bg-panel-2 px-4 py-2.5">
                <Skeleton className="h-4 w-20" />
              </div>
              <div className="flex flex-col gap-2 px-4 py-3">
                <Skeleton className="h-3.5 w-full" />
                <Skeleton className="h-3.5 w-5/6" />
                <Skeleton className="h-3.5 w-2/3" />
              </div>
            </div>
          ))}
        </aside>
      </div>
    </div>
  );
}
