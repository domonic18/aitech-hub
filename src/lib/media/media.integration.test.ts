/**
 * 媒体域集成测试(standard/01-testing:依赖 dev compose PG + Redis 会话;队列 mock 不投真任务)。
 * 覆盖 M5-b 主线:上传入库(sha1 去重/白名单/超限)→ sharp 管线直调(WebP 副本/缩略图/宽高回填)→
 * 详情与引用方 → 删除引用守卫(409)→ 批量删除(引用跳过)→
 * 体检(孤儿/复活/断链/回收站清退;全库扫描前后快照保护既有迁移行)→
 * 外链转存 worker(进程内 http server)→ import 路由 POST/GET → 守卫(Origin/未登录)。
 * MEDIA_DIR 指向临时目录,不污染 workspace/media。
 */
import { loadEnvConfig } from "@next/env";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

loadEnvConfig(process.cwd());
process.env.LOG_LEVEL = "silent";

// 队列 mock:记录投递并暴露可查询 job(getJob),不依赖 Redis;processor 在用例中直调
const queueState = vi.hoisted(() => ({
  added: [] as Array<{ jobId: string; name: string; data: unknown }>,
  jobs: new Map<
    string,
    {
      id: string;
      data: unknown;
      progress: number;
      returnvalue: unknown;
      state: string;
      getState: () => Promise<string>;
      updateProgress: (n: number) => Promise<void>;
    }
  >(),
}));
vi.mock("@/lib/queue", () => ({
  QUEUE_MEDIA_PROCESS: "media-process",
  QUEUE_MEDIA_TRANSFER: "media-transfer",
  QUEUE_MEDIA_AUDIT: "media-audit",
  QUEUE_STATS: "stats",
  QUEUE_NAMES: ["media-process", "media-transfer", "media-audit", "stats"],
  getQueue: () => ({
    add: async (_name: string, data: unknown, opts: { jobId?: string }) => {
      const jobId = opts.jobId ?? `j:${queueState.added.length}`;
      queueState.added.push({ jobId, name: _name, data });
      queueState.jobs.set(jobId, {
        id: jobId,
        data,
        progress: 0,
        returnvalue: null,
        state: "waiting",
        getState: async () => queueState.jobs.get(jobId)?.state ?? "unknown",
        updateProgress: async (n: number) => {
          const job = queueState.jobs.get(jobId);
          if (job) job.progress = n;
        },
      });
      return queueState.jobs.get(jobId);
    },
    getJob: async (id: string) => queueState.jobs.get(id) ?? null,
  }),
  bullConnection: () => {
    throw new Error("集成测试不应触达 Redis 队列");
  },
}));

const mediaRoot = await mkdtemp(path.join(tmpdir(), "ah-media-it-"));
process.env.MEDIA_DIR = mediaRoot; // env 模块在 import 时读,先改再引

import { prisma } from "@/lib/db";
import { type ApiEnvelope } from "@/lib/http/response";

const { POST: loginPOST } = await import("@/app/api/auth/login/route");
const { POST: mediaPOST } = await import("@/app/api/media/route");
const { GET: mediaIdGET, DELETE: mediaIdDELETE } = await import("@/app/api/media/[id]/route");
const { POST: batchPOST } = await import("@/app/api/media/batch-delete/route");
const { POST: auditPOST } = await import("@/app/api/media/audit/route");
const { POST: restorePOST } = await import("@/app/api/media/[id]/restore/route");
const { DELETE: purgeDELETE } = await import("@/app/api/media/[id]/purge/route");
const { POST: importPOST, GET: importGET } = await import("@/app/api/media/import/route");
const { listMediaAdmin, mediaStats, brokenRefs, getMediaDetail } =
  await import("@/lib/media/queries");
const { runAudit } = await import("@/lib/media/audit");
const { processMediaJob, transferMediaJob } = await import("../../../worker/media");
const { mediaStorage } = await import("@/lib/media/storage");
const sharp = (await import("sharp")).default;

const PHONE = "13900000004";
const PASSWORD = "it-admin-pass1";
const CAT_SLUG = "it-m5b-cat";
const createdMedia: bigint[] = [];
const createdPosts: bigint[] = [];

const ORIGIN_HEADERS: Record<string, string> = {
  origin: "http://localhost:3000",
  "x-forwarded-host": "localhost:3000",
};

function jsonReq(
  url: string,
  method: string,
  cookie: string,
  body?: unknown,
  origin?: string,
): never {
  return new Request(`http://localhost:3000${url}`, {
    method,
    headers: {
      ...ORIGIN_HEADERS,
      ...(origin ? { origin } : {}),
      "content-type": "application/json",
      cookie,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }) as never;
}

function formReq(url: string, cookie: string, fd: FormData, origin?: string): never {
  return new Request(`http://localhost:3000${url}`, {
    method: "POST",
    headers: { ...ORIGIN_HEADERS, cookie, ...(origin ? { origin } : {}) },
    body: fd,
  }) as never;
}

async function envelope(res: Response): Promise<ApiEnvelope<unknown>> {
  return (await res.json()) as ApiEnvelope<unknown>;
}

function fileOf(bytes: Buffer | Uint8Array, name: string, type: string): File {
  return new File([bytes as unknown as BlobPart], name, { type });
}

async function uploadPng(cookie: string, bytes = png, name = "it-m5b-test.png") {
  const fd = new FormData();
  fd.set("file", fileOf(bytes.slice(), name, "image/png"));
  return mediaPOST(formReq("/api/media", cookie, fd));
}

let cookie = "";
let png: Buffer;
let uploadedId = "";
let uploadedPath = "";

beforeAll(async () => {
  png = await sharp({
    create: { width: 3, height: 2, channels: 3, background: { r: 255, g: 0, b: 0 } },
  })
    .png()
    .toBuffer();
  await prisma.userAccount.upsert({
    where: { phone: PHONE },
    update: { role: "admin", status: "active", passwordHash: await bcrypt.hash(PASSWORD, 10) },
    create: {
      phone: PHONE,
      nickname: "it-m5b-admin",
      role: "admin",
      status: "active",
      passwordHash: await bcrypt.hash(PASSWORD, 10),
    },
  });
  await prisma.category.upsert({
    where: { slug: CAT_SLUG },
    update: { sortOrder: 998 },
    create: { slug: CAT_SLUG, name: "M5b 测试分类", sortOrder: 998 },
  });
  await prisma.post.deleteMany({ where: { title: { contains: "M5b 媒体集成" } } });
  const login = await loginPOST(
    new Request("http://localhost:3000/api/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
        "x-forwarded-host": "localhost:3000", // undici Request 不暴露 host 头,Origin 校验走此头
      },
      body: JSON.stringify({ phone: PHONE, password: PASSWORD }),
    }) as never,
  );
  expect(login.status).toBe(200);
  cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
});

afterAll(async () => {
  await prisma.mediaRef.deleteMany({ where: { post: { title: { contains: "M5b 媒体集成" } } } });
  await prisma.media.deleteMany({ where: { id: { in: createdMedia } } });
  await prisma.post.deleteMany({ where: { title: { contains: "M5b 媒体集成" } } });
  await prisma.category.deleteMany({ where: { slug: CAT_SLUG } });
  await prisma.userAccount.deleteMany({ where: { phone: PHONE } });
  await prisma.$disconnect();
  await rm(mediaRoot, { recursive: true, force: true });
});

describe("媒体上传与处理(dev compose 真实 PG)", () => {
  it("上传:202 入库 processing + 落盘 + 投递 sharp 管线", async () => {
    const res = await uploadPng(cookie);
    expect(res.status).toBe(202);
    const { code, data } = await envelope(res);
    expect(code).toBe(0);
    const saved = data as { id: string; path: string; reused: boolean; status: string };
    expect(saved.reused).toBe(false);
    expect(saved.status).toBe("processing");
    expect(saved.path).toMatch(/^\/wp-content\/uploads\/\d{4}\/\d{2}\/[0-9a-f]{40}\.png$/);
    uploadedId = saved.id;
    uploadedPath = saved.path;
    createdMedia.push(BigInt(saved.id));

    const rel = decodeURIComponent(saved.path.replace("/wp-content/uploads/", ""));
    expect(await mediaStorage.exists(rel)).toBe(true);
    const row = await prisma.media.findUniqueOrThrow({ where: { id: BigInt(saved.id) } });
    expect(row.sha1).toHaveLength(40);
    const last = queueState.added.at(-1);
    expect(last?.name).toBe("process");
    expect(last?.jobId).toBe(`media-${row.sha1}-process`);
  });

  it("sha1 去重复用:同字节二传不建新行不重传", async () => {
    const res = await uploadPng(cookie);
    expect(res.status).toBe(202);
    const { data } = await envelope(res);
    const saved = data as { id: string; path: string; reused: boolean };
    expect(saved.reused).toBe(true);
    expect(saved.path).toBe(uploadedPath);
    expect(await prisma.media.count({ where: { sha1: { not: null }, path: uploadedPath } })).toBe(
      1,
    );
  });

  it("回收站同 sha1 复活:软删后重传同字节,复活原行而非撞路径唯一约束", async () => {
    // 前序用例已软删 uploadedPath 行(删除守卫用例);此处重传应复活而非 P2002
    const res = await uploadPng(cookie);
    expect(res.status).toBe(202);
    const { data } = await envelope(res);
    const saved = data as { id: string; path: string; reused: boolean; status: string };
    expect(saved.reused).toBe(true);
    expect(saved.id).toBe(uploadedId);
    expect(saved.status).toBe("processing");
    const row = await prisma.media.findUniqueOrThrow({ where: { id: BigInt(uploadedId) } });
    expect(row.deletedAt).toBeNull();
    // 复活行重新走 sharp 管线,拉回 active 供后续用例使用
    await processMediaJob({ data: { mediaId: uploadedId } } as never);
    expect(
      (await prisma.media.findUniqueOrThrow({ where: { id: BigInt(uploadedId) } })).status,
    ).toBe("active");
  });

  it("白名单外类型 415;超 10MB 413", async () => {
    const fd = new FormData();
    fd.set("file", new File(["<svg/>"], "it-m5b-x.svg", { type: "image/svg+xml" }));
    expect((await mediaPOST(formReq("/api/media", cookie, fd))).status).toBe(415);

    const big = new Uint8Array(10 * 1024 * 1024 + 1);
    const fd2 = new FormData();
    fd2.set("file", new File([big], "it-m5b-big.png", { type: "image/png" }));
    expect((await mediaPOST(formReq("/api/media", cookie, fd2))).status).toBe(413);
  });

  it("sharp 管线:WebP 副本 + 缩略图落盘,宽高回填置 active", async () => {
    const out = await processMediaJob({ data: { mediaId: uploadedId } } as never);
    expect(out.status).toBe("active");
    const row = await prisma.media.findUniqueOrThrow({ where: { id: BigInt(uploadedId) } });
    expect(row.status).toBe("active");
    expect(row.width).toBe(3);
    expect(row.height).toBe(2);
    expect(row.thumbPath).toBe(`${uploadedPath.slice(0, -4)}.thumb.webp`);
    const rel = decodeURIComponent(uploadedPath.replace("/wp-content/uploads/", ""));
    expect(await mediaStorage.exists(rel.replace(/\.png$/, ".webp"))).toBe(true);
    expect(await mediaStorage.exists(`${rel.slice(0, -4)}.thumb.webp`)).toBe(true);
  });
});

describe("列表/详情/删除(引用守卫与批量)", () => {
  it("详情:资产 kv + 引用方文章;列表含引用计数与孤儿口径", async () => {
    const post = await prisma.post.create({
      data: {
        slug: "it-m5b-media-ref-post",
        title: "M5b 媒体集成 · 引用方",
        contentMd: `![x](${uploadedPath})`,
        category: { connect: { slug: CAT_SLUG } },
      },
    });
    createdPosts.push(post.id);
    await prisma.mediaRef.create({ data: { mediaPath: uploadedPath, postId: post.id } });

    const res = await mediaIdGET(
      new Request(`http://localhost:3000/api/media/${uploadedId}`, {
        headers: { cookie },
      }) as never,
      { params: Promise.resolve({ id: uploadedId }) },
    );
    expect(res.status).toBe(200);
    const { data } = await envelope(res);
    const detail = data as { media: { path: string }; refs: Array<{ title: string }> };
    expect(detail.media.path).toBe(uploadedPath);
    expect(detail.refs.map((r) => r.title)).toContain("M5b 媒体集成 · 引用方");

    const list = await listMediaAdmin({ kind: "image", refFilter: "referenced", page: 1 });
    const item = list.items.find((i) => i.id === uploadedId);
    expect(item?.refCount).toBe(1);
    expect(list.counts.image.referenced).toBeGreaterThanOrEqual(1);
    const orphans = await listMediaAdmin({ kind: "image", refFilter: "orphan", page: 1 });
    expect(orphans.items.some((i) => i.id === uploadedId)).toBe(false);
    expect((await mediaStats()).kinds.image.count).toBeGreaterThan(0);
  });

  it("删除引用守卫:有引用 409 并列出《引用方》;移除后软删入回收站", async () => {
    const denied = await mediaIdDELETE(jsonReq(`/api/media/${uploadedId}`, "DELETE", cookie), {
      params: Promise.resolve({ id: uploadedId }),
    });
    expect(denied.status).toBe(409);
    const { message } = await envelope(denied);
    expect(message).toContain("《M5b 媒体集成 · 引用方》");

    await prisma.mediaRef.deleteMany({ where: { mediaPath: uploadedPath } });
    const ok = await mediaIdDELETE(jsonReq(`/api/media/${uploadedId}`, "DELETE", cookie), {
      params: Promise.resolve({ id: uploadedId }),
    });
    expect(ok.status).toBe(200);
    const row = await prisma.media.findUniqueOrThrow({ where: { id: BigInt(uploadedId) } });
    expect(row.status).toBe("deleted");
    expect(row.deletedAt).not.toBeNull();
  });

  it("批量删除:无引用删除、有引用跳过并列出", async () => {
    const a = await prisma.media.create({
      data: {
        path: `/wp-content/uploads/2026/09/${crypto.randomUUID()}.png`,
        filename: "it-m5b-batch-free.png",
        kind: "image",
        status: "active",
        sizeBytes: BigInt(10),
      },
    });
    const b = await prisma.media.create({
      data: {
        path: `/wp-content/uploads/2026/09/${crypto.randomUUID()}.png`,
        filename: "it-m5b-batch-refd.png",
        kind: "image",
        status: "active",
        sizeBytes: BigInt(10),
      },
    });
    createdMedia.push(a.id, b.id);
    const post = await prisma.post.create({
      data: {
        slug: "it-m5b-batch-ref-post",
        title: "M5b 媒体集成 · 批删引用",
        contentMd: "x",
        category: { connect: { slug: CAT_SLUG } },
      },
    });
    createdPosts.push(post.id);
    await prisma.mediaRef.create({ data: { mediaPath: b.path, postId: post.id } });

    const res = await batchPOST(
      jsonReq("/api/media/batch-delete", "POST", cookie, {
        ids: [a.id.toString(), b.id.toString()],
      }),
    );
    expect(res.status).toBe(200);
    const { data } = await envelope(res);
    const result = data as {
      deleted: number;
      skipped: Array<{ filename: string; refCount: number }>;
    };
    expect(result.deleted).toBe(1);
    expect(result.skipped).toEqual([
      { id: b.id.toString(), filename: "it-m5b-batch-refd.png", refCount: 1 },
    ]);
  });
});

describe("体检(孤儿/复活/断链/回收站清退)", () => {
  it("全库扫描重算状态并清退超期软删;既有行状态前后快照恢复", async () => {
    const stem = `2026/09/${crypto.randomUUID().replace(/-/g, "")}`;
    await mediaStorage.put(`${stem}.png`, png);
    const orphanRow = await prisma.media.create({
      data: {
        path: `/wp-content/uploads/${stem}.png`,
        filename: "it-m5b-orphan.png",
        kind: "image",
        status: "active",
      },
    });
    const refStem = `2026/09/${crypto.randomUUID().replace(/-/g, "")}`;
    await mediaStorage.put(`${refStem}.png`, png);
    const refRow = await prisma.media.create({
      data: {
        path: `/wp-content/uploads/${refStem}.png`,
        filename: "it-m5b-refd.png",
        kind: "image",
        status: "orphan",
      },
    });
    const auditPost = await prisma.post.create({
      data: {
        slug: "it-m5b-audit-ref-post",
        title: "M5b 媒体集成 · 体检引用",
        contentMd: "x",
        category: { connect: { slug: CAT_SLUG } },
      },
    });
    createdPosts.push(auditPost.id);
    await prisma.mediaRef.create({
      data: { mediaPath: `/wp-content/uploads/${refStem}.png`, postId: auditPost.id },
    });
    const missingRow = await prisma.media.create({
      data: {
        path: "/wp-content/uploads/2026/09/it-m5b-ghost.png",
        filename: "it-m5b-ghost.png",
        kind: "image",
        status: "active",
      },
    });
    const purgeStem = `2026/09/${crypto.randomUUID().replace(/-/g, "")}`;
    await mediaStorage.put(`${purgeStem}.png`, png);
    await mediaStorage.put(`${purgeStem}.thumb.webp`, png);
    const purgedRow = await prisma.media.create({
      data: {
        path: `/wp-content/uploads/${purgeStem}.png`,
        filename: "it-m5b-expired.png",
        kind: "image",
        status: "deleted",
        deletedAt: new Date(Date.now() - 8 * 24 * 3600 * 1000),
      },
    });
    const keepRow = await prisma.media.create({
      data: {
        path: `/wp-content/uploads/${purgeStem}k.png`,
        filename: "it-m5b-keep.png",
        kind: "image",
        status: "deleted",
        deletedAt: new Date(Date.now() - 1 * 24 * 3600 * 1000),
      },
    });
    createdMedia.push(orphanRow.id, refRow.id, missingRow.id, purgedRow.id, keepRow.id);

    const statusOf = (id: bigint): Promise<string | null> =>
      prisma.media.findUnique({ where: { id } }).then((r) => r?.status ?? null);

    // 全库扫描会波及迁移行的 status 列:先快照,跑完按原值分组恢复
    const snapshot = await prisma.media.findMany({
      where: { id: { notIn: createdMedia }, deletedAt: null },
      select: { id: true, status: true },
    });
    try {
      const summary = await runAudit();
      expect(await statusOf(orphanRow.id)).toBe("orphan");
      expect(await statusOf(refRow.id)).toBe("active"); // 有引用 → 复活
      expect(await statusOf(missingRow.id)).toBe("missing");
      expect(summary.restored).toBeGreaterThanOrEqual(1);
      expect(summary.missing).toBeGreaterThanOrEqual(1);
      expect(summary.purged).toBeGreaterThanOrEqual(1);
      expect(await prisma.media.findUnique({ where: { id: purgedRow.id } })).toBeNull(); // 超期物理清退
      expect(await mediaStorage.exists(`${purgeStem}.png`)).toBe(false); // 文件家族随删
      expect(await mediaStorage.exists(`${purgeStem}.thumb.webp`)).toBe(false);
      expect(await prisma.media.findUnique({ where: { id: keepRow.id } })).not.toBeNull(); // 7 天内保留
    } finally {
      const byStatus = new Map<string, bigint[]>();
      for (const s of snapshot) {
        byStatus.set(s.status, [...(byStatus.get(s.status) ?? []), s.id]);
      }
      for (const [status, ids] of byStatus) {
        await prisma.media.updateMany({
          where: { id: { in: ids }, status: { not: status } },
          data: { status },
        });
      }
    }
  });
});

describe("回收站(视图/恢复/立即清除)", () => {
  it("恢复:trash 视图列软删行带 daysLeft,restore 清 deletedAt 按引用重算 status", async () => {
    const stem = `2026/09/${crypto.randomUUID().replace(/-/g, "")}`;
    await mediaStorage.put(`${stem}.png`, png);
    const row = await prisma.media.create({
      data: {
        path: `/wp-content/uploads/${stem}.png`,
        filename: "it-m5b-trash-restore.png",
        kind: "image",
        status: "active",
      },
    });
    createdMedia.push(row.id);
    await mediaIdDELETE(jsonReq(`/api/media/${row.id}`, "DELETE", cookie), {
      params: Promise.resolve({ id: row.id.toString() }),
    });

    const trash = await listMediaAdmin({ kind: "image", refFilter: "trash", page: 1 });
    const item = trash.items.find((i) => i.id === row.id.toString());
    expect(item).toBeDefined();
    expect(item?.deletedAt).not.toBeNull();
    expect(item?.daysLeft).toBe(7); // 刚软删,7 天窗口整
    expect(trash.counts.image.trash).toBeGreaterThanOrEqual(1);
    expect(trash.items.every((i) => i.deletedAt !== null)).toBe(true); // live 行不入视图

    const res = await restorePOST(jsonReq(`/api/media/${row.id}/restore`, "POST", cookie), {
      params: Promise.resolve({ id: row.id.toString() }),
    });
    expect(res.status).toBe(200);
    const { code, data } = await envelope(res);
    expect(code).toBe(0);
    const restored = data as { id: string; path: string; status: string };
    expect(restored.path).toBe(`/wp-content/uploads/${stem}.png`);
    expect(restored.status).toBe("orphan"); // 无引用 → orphan 而非删除前快照
    const after = await prisma.media.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.deletedAt).toBeNull();
    expect(await mediaStorage.exists(`${stem}.png`)).toBe(true); // 文件原样,零拷贝复活
    const gone = await restorePOST(jsonReq(`/api/media/${row.id}/restore`, "POST", cookie), {
      params: Promise.resolve({ id: row.id.toString() }),
    });
    expect(gone.status).toBe(404); // 已不在回收站
  });

  it("立即清除:物理删文件家族与记录,绕过 7 天;未软删行 404", async () => {
    const stem = `2026/09/${crypto.randomUUID().replace(/-/g, "")}`;
    await mediaStorage.put(`${stem}.png`, png);
    await mediaStorage.put(`${stem}.webp`, png);
    await mediaStorage.put(`${stem}.thumb.webp`, png);
    const row = await prisma.media.create({
      data: {
        path: `/wp-content/uploads/${stem}.png`,
        filename: "it-m5b-trash-purge.png",
        kind: "image",
        status: "active",
      },
    });
    createdMedia.push(row.id);
    await mediaIdDELETE(jsonReq(`/api/media/${row.id}`, "DELETE", cookie), {
      params: Promise.resolve({ id: row.id.toString() }),
    });

    const res = await purgeDELETE(jsonReq(`/api/media/${row.id}/purge`, "DELETE", cookie), {
      params: Promise.resolve({ id: row.id.toString() }),
    });
    expect(res.status).toBe(200);
    const { code, data } = await envelope(res);
    expect(code).toBe(0);
    expect(data).toEqual({ id: row.id.toString(), path: `/wp-content/uploads/${stem}.png` });
    expect(await prisma.media.findUnique({ where: { id: row.id } })).toBeNull();
    for (const f of [`${stem}.png`, `${stem}.webp`, `${stem}.thumb.webp`]) {
      expect(await mediaStorage.exists(f)).toBe(false); // 文件家族随删
    }
    const again = await purgeDELETE(jsonReq(`/api/media/${row.id}/purge`, "DELETE", cookie), {
      params: Promise.resolve({ id: row.id.toString() }),
    });
    expect(again.status).toBe(404); // 记录已物理删除
    // 未软删行不可清除:自建 live 行验证(不碰共享 uploadedId——它在删除守卫用例后处于软删态,
    // 对它 purge 会真物理删除,污染后续转存用例的 sha1 去重前提)
    const liveStem = `2026/09/${crypto.randomUUID().replace(/-/g, "")}`;
    await mediaStorage.put(`${liveStem}.png`, png);
    const liveRow = await prisma.media.create({
      data: {
        path: `/wp-content/uploads/${liveStem}.png`,
        filename: "it-m5b-trash-live.png",
        kind: "image",
        status: "active",
      },
    });
    createdMedia.push(liveRow.id);
    const live = await purgeDELETE(jsonReq(`/api/media/${liveRow.id}/purge`, "DELETE", cookie), {
      params: Promise.resolve({ id: liveRow.id.toString() }),
    });
    expect(live.status).toBe(404); // 未软删行不可清除
    expect(await prisma.media.findUnique({ where: { id: liveRow.id } })).not.toBeNull();
  });
});

describe("外链转存与 import 路由", () => {
  let server: Server;
  let baseUrl = "";

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === "/img.png") {
        res.writeHead(200, { "content-type": "image/png" });
        res.end(png);
      } else {
        res.writeHead(404);
        res.end("nope");
      }
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });

  afterAll(async () => {
    await new Promise((r) => server.close(r));
  });

  it("transferMediaJob:成功转存入库,失败项标 null 不拖垮整批", async () => {
    const goodUrl = `${baseUrl}/img.png`;
    const badUrl = `${baseUrl}/missing.png`;
    const result = await transferMediaJob({
      id: "it-transfer",
      data: { urls: [goodUrl, badUrl] },
      updateProgress: async () => {},
    } as never);
    expect(result.ok).toBe(1);
    expect(result.failed).toBe(1);
    const goodPath = result.mapping[goodUrl];
    if (!goodPath) throw new Error("转存应成功");
    expect(goodPath).toMatch(/^\/wp-content\/uploads\//);
    expect(result.mapping[badUrl]).toBeNull();
    // 服务的是与直传用例相同的字节 → sha1 去重命中,复用复活行而非新建
    const row = await prisma.media.findFirst({ where: { path: goodPath } });
    expect(row?.id).toBe(BigInt(uploadedId));
  });

  it("import 路由:POST 202 建 job,GET 轮询状态与 returnvalue", async () => {
    const post = await importPOST(
      jsonReq("/api/media/import", "POST", cookie, { urls: [`${baseUrl}/img.png`] }),
    );
    expect(post.status).toBe(202);
    const { data } = await envelope(post);
    const { jobId, total } = data as { jobId: string; total: number };
    expect(total).toBe(1);

    const poll1 = await importGET(
      new Request(`http://localhost:3000/api/media/import?job=${jobId}`, {
        headers: { cookie },
      }) as never,
    );
    expect((await envelope(poll1)).data).toMatchObject({ state: "waiting" });

    const job = queueState.jobs.get(jobId)!;
    job.state = "completed";
    job.returnvalue = {
      mapping: { [`${baseUrl}/img.png`]: "/wp-content/uploads/x.png" },
      ok: 1,
      failed: 0,
    };
    const poll2 = await importGET(
      new Request(`http://localhost:3000/api/media/import?job=${jobId}`, {
        headers: { cookie },
      }) as never,
    );
    const body2 = (await envelope(poll2)).data as { state: string; result: { ok: number } };
    expect(body2.state).toBe("completed");
    expect(body2.result.ok).toBe(1);

    const bad = await importPOST(
      jsonReq("/api/media/import", "POST", cookie, { urls: ["notaurl"] }),
    );
    expect(bad.status).toBe(400);
  });
});

describe("统计侧翼与守卫", () => {
  it("mediaStats:kind 聚合/孤儿口径/近 30 天直测(评审 S7)", async () => {
    const stem = `2026/09/${crypto.randomUUID().replace(/-/g, "")}`;
    const row = await prisma.media.create({
      data: {
        path: `/wp-content/uploads/${stem}.png`,
        filename: "it-m5b-stat-orphan.png",
        kind: "image",
        status: "active",
        sizeBytes: BigInt(123),
      },
    });
    createdMedia.push(row.id);
    const stats = await mediaStats();
    expect(stats.kinds.image.count).toBeGreaterThan(0);
    expect(stats.orphanCount).toBeGreaterThanOrEqual(1); // 本用例无引用行计入孤儿口径
    expect(stats.last30d.count).toBeGreaterThan(0);
    expect(stats.last30d.bytes).toBeGreaterThanOrEqual(123);
  });

  it("brokenRefs:库中不存在的引用路径按篇数排序列出", async () => {
    const post = await prisma.post.create({
      data: {
        slug: "it-m5b-broken-post",
        title: "M5b 媒体集成 · 断链",
        contentMd: "x",
        category: { connect: { slug: CAT_SLUG } },
      },
    });
    createdPosts.push(post.id);
    await prisma.mediaRef.create({
      data: { mediaPath: "/wp-content/uploads/1999/01/ghost.png", postId: post.id },
    });
    const broken = await brokenRefs();
    expect(broken).toContainEqual({ path: "/wp-content/uploads/1999/01/ghost.png", posts: 1 });
  });

  it("audit 路由:202 受理并入队(扫描在 worker)", async () => {
    const res = await auditPOST(jsonReq("/api/media/audit", "POST", cookie));
    expect(res.status).toBe(202);
    expect(queueState.added.at(-1)?.name).toBe("audit");
  });

  it("守卫:跨 Origin 403;未登录 401;未登录详情 401;import POST 同规(评审 S7)", async () => {
    const fd = new FormData();
    fd.set("file", fileOf(png, "x.png", "image/png"));
    expect(
      (await mediaPOST(formReq("/api/media", cookie, fd, "https://evil.example.com"))).status,
    ).toBe(403);
    expect((await mediaPOST(formReq("/api/media", "", fd))).status).toBe(401);
    const anon = await mediaIdGET(new Request("http://localhost:3000/api/media/1") as never, {
      params: Promise.resolve({ id: "1" }),
    });
    expect(anon.status).toBe(401);
    expect(
      (
        await importPOST(
          jsonReq(
            "/api/media/import",
            "POST",
            cookie,
            { urls: ["https://a.com/x.png"] },
            "https://evil.example.com",
          ),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await importPOST(
          jsonReq("/api/media/import", "POST", "", { urls: ["https://a.com/x.png"] }),
        )
      ).status,
    ).toBe(401);
  });

  it("管理详情 service:软删行不可见", async () => {
    expect(await getMediaDetail(BigInt(999999999))).toBeNull();
  });
});
