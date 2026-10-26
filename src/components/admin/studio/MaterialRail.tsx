/**
 * 素材栏(v2 工作台左栏,自 MaterialCards 收编紧凑化):已挂素材按型分卡
 * (解读视频/电报图文/文章),批注有值显「批注」角标,行内操作(批注/卸载)
 * 复用 TopicItemActions;底部 candidates 槽位放「添加素材」弹层(详情页把
 * StudioMaterialModal 连同服务端候选一起传入)。源条目被删时降级提示可移除。
 * 服务端纯展示件。
 */
import Link from "next/link";

import type { TopicItemMaterial } from "@/lib/topics/materials";

import TopicItemActions from "./TopicItemActions";

export interface RailItem {
  id: bigint;
  note: string | null;
}

/** 解读笔记全文折叠块(纯文本保形渲染:## 行升格小标题,LLM 产物零注入面) */
function NoteBlock({ note }: { note: string }) {
  return (
    <details className="mt-1.5 rounded-sm bg-panel-2/60 px-2 py-1">
      <summary className="cursor-pointer text-[11px] text-text-2 hover:text-text-1">
        解读笔记({note.length} 字)
      </summary>
      <div className="mt-1 text-[11.5px] leading-relaxed text-text-2">
        {note.split("\n").map((line, i) =>
          line.startsWith("## ") ? (
            <h3 key={i} className="mt-1.5 font-semibold text-text-1 first:mt-0">
              {line.slice(3)}
            </h3>
          ) : (
            <p key={i} className="whitespace-pre-wrap">
              {line}
            </p>
          ),
        )}
      </div>
    </details>
  );
}

const KIND_BADGE: Record<string, string> = {
  video: "bg-accent/12 text-accent",
  text: "bg-green/12 text-green",
  post: "bg-panel-2 text-text-2",
};

export default function MaterialRail({
  topicId,
  items,
  materials,
  candidates,
}: {
  topicId: string;
  items: RailItem[];
  materials: Map<bigint, TopicItemMaterial>;
  /** 添加素材弹层(触发钮 + 弹层,服务端渲染候选) */
  candidates: React.ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 rounded-sm border border-line bg-panel p-2.5">
      <div className="flex items-center gap-1.5 px-0.5">
        <h2 className="text-[13px] font-semibold text-text-1">素材</h2>
        <span className="rounded-sm bg-panel-2 px-1.5 text-[11px] text-text-2">{items.length}</span>
        <span className="ml-auto text-[10.5px] text-text-3">2~3 条起创作</span>
      </div>

      <div className="flex flex-col gap-2">
        {items.map((item) => {
          const material = materials.get(item.id);
          const telegram = material?.telegram;
          const post = material?.post;
          const isVideo = telegram?.mediaType === "video";
          const kind = telegram ? (isVideo ? "video" : "text") : post ? "post" : "missing";
          return (
            <div key={item.id.toString()} className="rounded-sm border border-line p-2">
              <div className="flex items-center gap-1.5">
                <span
                  className={`rounded-sm px-1 py-px text-[10px] font-medium ${KIND_BADGE[kind] ?? ""}`}
                >
                  {kind === "video"
                    ? "视频"
                    : kind === "text"
                      ? "图文"
                      : kind === "post"
                        ? "文章"
                        : "失效"}
                </span>
                {item.note && (
                  <span className="rounded-sm bg-amber/12 px-1 py-px text-[10px] text-amber-hi">
                    批注
                  </span>
                )}
              </div>
              {telegram && (
                <>
                  <div
                    className="mt-1 truncate text-[12px] font-medium text-text-1"
                    title={telegram.title ?? undefined}
                  >
                    {telegram.title ?? "(无标题)"}
                  </div>
                  <div className="mt-0.5 text-[10.5px] text-text-3">
                    {isVideo ? (
                      <>
                        {telegram.videoBlogger ?? "未知博主"} ·{" "}
                        <a
                          href={telegram.url}
                          target="_blank"
                          rel="noreferrer"
                          className="hover:text-accent"
                        >
                          原视频
                        </a>
                      </>
                    ) : (
                      <>
                        电报图文 ·{" "}
                        <a
                          href={telegram.url}
                          target="_blank"
                          rel="noreferrer"
                          className="hover:text-accent"
                        >
                          原文
                        </a>
                      </>
                    )}
                  </div>
                  {telegram.aiSummary && (
                    <p className="mt-1 line-clamp-2 text-[11px] text-text-2">
                      <span className="text-text-3">{isVideo ? "短结论:" : "解读:"}</span>
                      {telegram.aiSummary}
                    </p>
                  )}
                  {!isVideo && telegram.summary && (
                    <p className="mt-1 line-clamp-3 text-[11px] text-text-2">
                      <span className="text-text-3">原文:</span>
                      {telegram.summary}
                    </p>
                  )}
                  {isVideo &&
                    (telegram.aiNote ? (
                      <NoteBlock note={telegram.aiNote} />
                    ) : (
                      <p className="mt-1 text-[10.5px] text-text-3">
                        无解读笔记(生成初稿时自动降级拼装)
                      </p>
                    ))}
                </>
              )}
              {post && (
                <>
                  <Link
                    href={`/admin/posts/${post.id.toString()}`}
                    className="mt-1 block truncate text-[12px] font-medium text-text-1 hover:text-accent"
                  >
                    {post.title}
                  </Link>
                  <div className="mt-0.5 text-[10.5px] text-text-3">
                    文章 · {post.status === "published" ? "已发布" : "草稿"}
                  </div>
                </>
              )}
              {!telegram && !post && (
                <p className="mt-1 text-[11px] text-text-3">素材已不存在(源条目被删),建议移除</p>
              )}
              <div className="mt-1.5 flex justify-end border-t border-line pt-1.5">
                <TopicItemActions topicId={topicId} itemId={item.id.toString()} note={item.note} />
              </div>
            </div>
          );
        })}
        {items.length === 0 && (
          <p className="rounded-sm border border-dashed border-line px-2 py-4 text-center text-[11px] leading-relaxed text-text-3">
            还没有素材——点「添加素材」从库中选 2~3 条解读/文章/电报,创作的质量取决于素材本身
          </p>
        )}
      </div>

      {candidates}

      {/* 底部就绪锚点(M44 F2):spacer 把状态压到栏底,三栏底边对齐 */}
      <div className="flex-1" />
      {items.length >= 2 && (
        <div className="flex items-center gap-1.5 rounded-sm bg-green/10 px-2 py-1.5 text-[11px] text-green">
          <span>✓</span>
          <span>素材已就绪({items.length} 条)· 可以开始生成</span>
        </div>
      )}
      {items.length === 1 && (
        <div className="rounded-sm bg-amber/12 px-2 py-1.5 text-[11px] text-amber-hi">
          已有 1 条,建议再添 1~2 条
        </div>
      )}
      {items.length > 0 && (
        <p className="px-0.5 text-[10.5px] leading-relaxed text-text-3">
          已挂素材将全部作为创作依据交给 AI
        </p>
      )}
    </div>
  );
}
