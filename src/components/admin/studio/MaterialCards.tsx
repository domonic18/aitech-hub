/**
 * 创作素材卡区(M42 批④:自详情页内联渲染拆出;按 mediaType 分型)——电报视频
 * 走博主/原视频/解读笔记,电报文本走原文摘要(小绿书文本素材的写作底料),
 * 文章走标题/草稿态。源条目被删时降级为「素材已不存在」并提供移除入口。
 * 服务端纯展示件(挂载候选表仍留在详情页,两者职责不同)。
 */
import Link from "next/link";

import type { TopicItemMaterial } from "@/lib/topics/materials";

import TopicItemActions from "./TopicItemActions";

export interface MaterialCardItem {
  id: bigint;
  note: string | null;
}

/** 解读笔记全文折叠块(纯文本保形渲染:## 行升格小标题,其余原样换行;
 * 不走 HTML 管线——LLM 产物零注入面) */
function NoteBlock({ note }: { note: string }) {
  return (
    <details className="mt-1.5 rounded-sm bg-panel-2/60 px-2.5 py-1.5">
      <summary className="cursor-pointer text-xs text-text-2 hover:text-text-1">
        解读笔记({note.length} 字)
      </summary>
      <div className="mt-1.5 text-[12px] leading-relaxed text-text-2">
        {note.split("\n").map((line, i) =>
          line.startsWith("## ") ? (
            <h3 key={i} className="mt-2 font-semibold text-text-1 first:mt-0">
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

function TelegramCard({
  topicId,
  material,
  note,
  itemId,
}: {
  topicId: string;
  material: NonNullable<TopicItemMaterial["telegram"]>;
  note: string | null;
  itemId: bigint;
}) {
  const isVideo = material.mediaType === "video";
  return (
    <div className="rounded-sm border border-line p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium text-text-1">
            {material.title ?? "(无标题)"}
          </div>
          <div className="mt-0.5 text-[11px] text-text-3">
            {isVideo ? (
              <>
                {material.videoBlogger ?? "未知博主"} ·{" "}
                <a
                  href={material.url}
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
                  href={material.url}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-accent"
                >
                  原文
                </a>
              </>
            )}
          </div>
        </div>
        <TopicItemActions topicId={topicId} itemId={itemId.toString()} note={note} />
      </div>
      {/* 文本素材没有解读笔记,摘要即底料;有 AI 结论时一并展示 */}
      {material.aiSummary && (
        <p className="mt-1.5 line-clamp-2 text-[12px] text-text-2">
          <span className="text-text-3">{isVideo ? "短结论:" : "解读:"}</span>
          {material.aiSummary}
        </p>
      )}
      {!isVideo && material.summary && (
        <p className="mt-1.5 line-clamp-3 text-[12px] text-text-2">
          <span className="text-text-3">原文:</span>
          {material.summary}
        </p>
      )}
      {isVideo &&
        (material.aiNote ? (
          <NoteBlock note={material.aiNote} />
        ) : (
          <p className="mt-1 text-[11px] text-text-3">
            无解读笔记(存量或降级轮次,生成初稿时自动降级拼装)
          </p>
        ))}
    </div>
  );
}

function PostCard({
  topicId,
  material,
  note,
  itemId,
}: {
  topicId: string;
  material: NonNullable<TopicItemMaterial["post"]>;
  note: string | null;
  itemId: bigint;
}) {
  return (
    <div className="rounded-sm border border-line p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/admin/posts/${material.id.toString()}`}
            className="truncate text-[13px] font-medium text-text-1 hover:text-accent"
          >
            {material.title}
          </Link>
          <div className="mt-0.5 text-[11px] text-text-3">
            文章 · {material.status === "published" ? "已发布" : "草稿"}
          </div>
        </div>
        <TopicItemActions topicId={topicId} itemId={itemId.toString()} note={note} />
      </div>
    </div>
  );
}

export default function MaterialCards({
  topicId,
  items,
  materials,
}: {
  topicId: string;
  items: MaterialCardItem[];
  materials: Map<bigint, TopicItemMaterial>;
}) {
  return (
    <div className="flex flex-col gap-2">
      {items.map((item) => {
        const material = materials.get(item.id);
        return (
          <div key={item.id.toString()}>
            {material?.telegram && (
              <TelegramCard
                topicId={topicId}
                material={material.telegram}
                note={item.note}
                itemId={item.id}
              />
            )}
            {material?.post && (
              <PostCard
                topicId={topicId}
                material={material.post}
                note={item.note}
                itemId={item.id}
              />
            )}
            {!material?.telegram && !material?.post && (
              <div className="rounded-sm border border-line p-3 text-[12px] text-text-3">
                素材已不存在(源条目被删),建议移除
                <span className="ml-2">
                  <TopicItemActions
                    topicId={topicId}
                    itemId={item.id.toString()}
                    note={item.note}
                  />
                </span>
              </div>
            )}
          </div>
        );
      })}
      {items.length === 0 && (
        <p className="rounded-sm border border-dashed border-line px-3 py-6 text-center text-[12px] text-text-3">
          还没有素材——从下方素材库添加 2~3 条解读/电报,创作的质量取决于素材本身
        </p>
      )}
    </div>
  );
}
