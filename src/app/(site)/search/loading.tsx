import { ArticleRowsSkeleton, Skeleton } from "@/components/Skeleton";

/** 搜索页骨架:标题/输入框为静态形态直接给真字,结果行走骨架 */
export default function Loading(): React.ReactElement {
  return (
    <section className="mx-auto w-full max-w-3xl">
      <header className="border-b border-line/60 pb-4">
        <h1 className="text-2xl font-bold">搜索</h1>
        <Skeleton className="mt-3 h-10 w-full max-w-md rounded-md" />
      </header>
      <div className="mt-6">
        <ArticleRowsSkeleton />
      </div>
    </section>
  );
}
