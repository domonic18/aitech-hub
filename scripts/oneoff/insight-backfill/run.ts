/**
 * 洞察信号池存量回填(M34 批①,docs/plan/insight-plan.md §4):五类内部源
 * 存量一次性灌入 insight_signal——搜索词(stats_search_log,180 天保留内)/
 * agent 会话首问(title 非空;完整问句在 checkpoint 已清,回填只有 20 字截断
 * 口径)/文章评论(visible)/站点反馈/电报 AI 解读产物(ai_status=done)。
 * 幂等:(source, ref_id) 唯一约束,撞唯一跳过——可重复执行,与实时入池并发安全。
 *
 * 自包含脚本:不用 @/ 别名(worker 容器无 tsconfig 解不开),PrismaClient
 * 直连;连接串只从 env 读,不打印。归一/截断口径与 lib/insight/ingest 一致
 * (raw 截 4000、归一 trim+空白折叠截 2000、refId 截 120),漂移需同批改。
 *
 * @status oneoff(本地+生产各执行一次,确认无 error 后删除本目录,git 历史存档)
 *
 * 用法:
 *   npx tsx scripts/oneoff/insight-backfill/run.ts           # dry-run(默认,只读)
 *   npx tsx scripts/oneoff/insight-backfill/run.ts --apply   # 写库
 */
import { loadEnvConfig } from "@next/env";
import { Prisma, PrismaClient } from "@prisma/client";

loadEnvConfig(process.cwd());

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const CHUNK = 500;

const RAW_MAX = 4000;
const NORMALIZED_MAX = 2000;
const REF_ID_MAX = 120;

let ingested = 0;
let duplicate = 0;
let error = 0;

function normalizeText(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

/** 与 lib/insight/ingest 同构的单条入池(自包含版);返回是否处理成功 */
async function put(input: {
  source: string;
  medium: string;
  refId: string;
  rawText: string;
  signalAt: Date;
  meta?: Prisma.InputJsonValue;
}): Promise<void> {
  const raw = input.rawText.trim().slice(0, RAW_MAX);
  if (raw === "") return; // 空文本跳过(与 ingest 同口径,不计 error)
  try {
    await prisma.insightSignal.create({
      data: {
        source: input.source,
        medium: input.medium,
        refId: input.refId.trim().slice(0, REF_ID_MAX),
        rawText: raw,
        normalizedText: normalizeText(raw).slice(0, NORMALIZED_MAX),
        meta: input.meta,
        signalAt: input.signalAt,
      },
      select: { id: true },
    });
    ingested += 1;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      duplicate += 1;
      return;
    }
    error += 1;
    console.warn(`[error] ${input.source}/${input.refId}: ${String(e).slice(0, 200)}`);
  }
}

/** 游标分页(id 升序,bigint 主键表与 string 主键表通用):每批拉取后逐条入池,
 * 内存占用与批大小恒定。行类型由调用点显式标注(lambda 参数上下文敏感,
 * 推断回退联合约束会让 cursor 变 string|bigint 而炸各 Prisma where 入参) */
async function walk<T extends { id: bigint | string }>(
  label: string,
  fetch: (cursor: T["id"] | null) => Promise<T[]>,
  handle: (row: T) => Promise<void>,
): Promise<void> {
  let cursor: T["id"] | null = null;
  let seen = 0;
  for (;;) {
    const rows = await fetch(cursor);
    if (rows.length === 0) break;
    for (const row of rows) await handle(row);
    seen += rows.length;
    cursor = rows[rows.length - 1]!.id;
    console.log(`  ${label}: 已处理至 id=${String(cursor)}`);
  }
  console.log(`  ${label}: 扫描 ${seen} 行${APPLY ? "" : "(dry-run 未写库)"}`);
}

async function main(): Promise<void> {
  console.log(`洞察信号池存量回填(${APPLY ? "APPLY 写库" : "dry-run 只读,--apply 生效"})`);

  // ① 站内搜索词(增强前的行 hitCount=null,meta 不落 hitCount 键——零结果统计不误伤旧数据)
  await walk<{ id: bigint; term: string; createdAt: Date }>(
    "search",
    (cursor) =>
      prisma.statsSearchLog.findMany({
        where: cursor === null ? undefined : { id: { gt: cursor } },
        orderBy: { id: "asc" },
        take: CHUNK,
        select: { id: true, term: true, createdAt: true },
      }),
    async (row) => {
      if (!APPLY) return;
      await put({
        source: "internal-search",
        medium: "search",
        refId: row.id.toString(),
        rawText: row.term,
        signalAt: row.createdAt,
      });
    },
  );

  // ② agent 会话首问(20 字截断口径,checkpoint 侧完整问句不可回溯)
  await walk<{ id: string; title: string | null; createdAt: Date }>(
    "agent",
    (cursor) =>
      prisma.searchAgentSession.findMany({
        where: { ...(cursor === null ? {} : { id: { gt: cursor } }), title: { not: null } },
        orderBy: { id: "asc" },
        take: CHUNK,
        select: { id: true, title: true, createdAt: true },
      }),
    async (r) => {
      if (!APPLY) return;
      await put({
        source: "internal-agent",
        medium: "search",
        refId: r.id,
        rawText: r.title ?? "",
        signalAt: r.createdAt,
      });
    },
  );

  // ③ 文章评论(仅 visible;hidden/deleted 不入池)
  await walk<{ id: bigint; content: string; postId: bigint; createdAt: Date }>(
    "comment",
    (cursor) =>
      prisma.postComment.findMany({
        where: { ...(cursor === null ? {} : { id: { gt: cursor } }), status: "visible" },
        orderBy: { id: "asc" },
        take: CHUNK,
        select: { id: true, content: true, postId: true, createdAt: true },
      }),
    async (row) => {
      if (!APPLY) return;
      await put({
        source: "internal-comment",
        medium: "voice",
        refId: row.id.toString(),
        rawText: row.content,
        signalAt: row.createdAt,
        meta: { postId: row.postId.toString() },
      });
    },
  );

  // ④ 站点反馈(全状态:resolved 反馈仍是历史需求证据)
  await walk<{ id: bigint; content: string; category: string; createdAt: Date }>(
    "feedback",
    (cursor) =>
      prisma.feedback.findMany({
        where: cursor === null ? undefined : { id: { gt: cursor } },
        orderBy: { id: "asc" },
        take: CHUNK,
        select: { id: true, content: true, category: true, createdAt: true },
      }),
    async (row) => {
      if (!APPLY) return;
      await put({
        source: "internal-feedback",
        medium: "voice",
        refId: row.id.toString(),
        rawText: row.content,
        signalAt: row.createdAt,
        meta: { category: row.category },
      });
    },
  );

  // ⑤ 电报 AI 解读产物(视频 interpret + 文字 summarize 共用 ai_* 列,ai_status=done)
  await walk<{
    id: bigint;
    title: string | null;
    aiSummary: string | null;
    aiTopic: string | null;
    aiKeywords: unknown;
    publishedAt: Date | null;
    createdAt: Date;
  }>(
    "telegram-ai",
    (cursor) =>
      prisma.telegram.findMany({
        where: { ...(cursor === null ? {} : { id: { gt: cursor } }), aiStatus: "done" },
        orderBy: { id: "asc" },
        take: CHUNK,
        select: {
          id: true,
          title: true,
          aiSummary: true,
          aiTopic: true,
          aiKeywords: true,
          publishedAt: true,
          createdAt: true,
        },
      }),
    async (row) => {
      if (!APPLY) return;
      const meta: Record<string, unknown> = { title: row.title, topic: row.aiTopic };
      if (Array.isArray(row.aiKeywords)) meta.keywords = row.aiKeywords;
      await put({
        source: "telegram-ai",
        medium: "ai-record",
        refId: row.id.toString(),
        rawText: row.aiSummary ?? row.title ?? "",
        signalAt: row.publishedAt ?? row.createdAt,
        meta: meta as Prisma.InputJsonValue,
      });
    },
  );

  console.log(`完成:ingested=${ingested} duplicate=${duplicate} error=${error}`);
}

main()
  .catch((e) => {
    console.error(String(e));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
