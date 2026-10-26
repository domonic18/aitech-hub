/**
 * 小红书分发·半自动(M49 批X2'):撰写改走侧边栏 agent 会话(save_xhs_draft
 * 工具,agent/xhs-tools),本件只留发布回填与物料视图——静默 worker LLM 路线
 * 已废除(验收反馈:过程不可见、不可多轮迭代)。渠道特有数据走行 data JSON。
 */
import { prisma } from "../db";
import { logger } from "../logger";
import { DistributeError } from "./errors";
import { CHANNEL_XHS, PUBLISH_STATUS_READY, PUBLISH_STATUS_SYNCED } from "./channels";

export interface XhsDraft {
  title: string;
  content: string;
  tags: string[];
}

export interface XhsRowData {
  draft: XhsDraft;
  coverMediaPath: string;
  readyAt: string;
  noteUrl?: string;
}

const MD_IMG_RE = /!\[[^\]]*\]\(([^)\s]+)[^)]*\)/g;

/** 3:4 封面卡 HTML(1080×1440 定尺寸;card-renderer 渲 PNG) */
/** 笔记链接回填(人工发布确认):ready/synced → synced */
export async function publishXhsNote(postId: bigint, noteUrl: string): Promise<void> {
  let host = "";
  try {
    host = new URL(noteUrl).hostname;
  } catch {
    throw new DistributeError("invalid", "笔记链接格式无效");
  }
  if (!host.endsWith("xiaohongshu.com")) {
    throw new DistributeError("invalid", "仅接受 xiaohongshu.com 域名的笔记链接");
  }
  const row = await prisma.publishChannel.findFirst({
    where: { postId, channel: CHANNEL_XHS },
    orderBy: { id: "desc" },
  });
  if (!row) throw new DistributeError("not_found", "小红书渠道行不存在(先生成物料)");
  if (row.status !== PUBLISH_STATUS_READY && row.status !== PUBLISH_STATUS_SYNCED) {
    throw new DistributeError("invalid", "物料尚未就绪,不能标记已发布");
  }
  const prev = (row.data ?? {}) as Partial<XhsRowData>;
  await prisma.publishChannel.update({
    where: { id: row.id },
    data: {
      status: PUBLISH_STATUS_SYNCED,
      syncedAt: new Date(),
      lastError: null,
      data: {
        ...prev,
        draft: prev.draft!,
        coverMediaPath: prev.coverMediaPath!,
        readyAt: prev.readyAt ?? "",
        noteUrl,
      } as unknown as Parameters<typeof prisma.publishChannel.update>[0]["data"]["data"],
    },
  });
  logger.info({ event: "xhs.synced", postId: postId.toString(), noteUrl });
}
