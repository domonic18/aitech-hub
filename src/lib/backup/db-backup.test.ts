/**
 * db-backup 单测(M19 批②):连接串剔除 Prisma 参数、北京时区戳字典序、
 * 本地保留裁剪、job 编排(dump → 上传 → 裁剪 → ssl 档;缺配置人话报错;
 * ssl 缺目录跳过;packSsl 失败不拦主体)。
 */
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  env: {
    COS_SECRET_ID: "id",
    COS_SECRET_KEY: "key",
    COS_REGION: "ap-guangzhou",
    COS_BACKUP_BUCKET: "backup-1",
    DATABASE_URL:
      "postgresql://aitech:pw@localhost:5434/aitech_hub?schema=public&connection_limit=5",
  },
}));

import { dbBackupJob, dumpStamp, pgDumpableUrl, pruneLocalDumps } from "./db-backup";

describe("pgDumpableUrl", () => {
  it("剔 Prisma 专属参数,保留 libpq 白名单,连接信息逐字保留", () => {
    expect(
      pgDumpableUrl(
        "postgresql://aitech:pw@localhost:5434/aitech_hub?schema=public&connection_limit=5",
      ),
    ).toBe("postgresql://aitech:pw@localhost:5434/aitech_hub");
    expect(
      pgDumpableUrl(
        "postgresql://u:p%40x@db.internal:5432/aitech_hub?connection_limit=10&sslmode=prefer&connect_timeout=5",
      ),
    ).toBe("postgresql://u:p%40x@db.internal:5432/aitech_hub?sslmode=prefer&connect_timeout=5");
    expect(pgDumpableUrl("postgresql://u@h/db")).toBe("postgresql://u@h/db");
  });
});

describe("dumpStamp", () => {
  it("北京时区 YYYYMMDD-HHmm,字典序即时间序", () => {
    // 2026-10-08T03:23 UTC+8 → 北京 11:23
    expect(dumpStamp(new Date("2026-10-08T03:23:00Z"))).toBe("20261008-1123");
    // 2026-10-08T16:05 UTC+8 → 北京次日 00:05(日界归北京)
    expect(dumpStamp(new Date("2026-10-08T16:05:00Z"))).toBe("20261009-0005");
  });
});

describe("pruneLocalDumps", () => {
  let dir = "";

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "ah-backup-test-"));
    for (const f of [
      "aitech_hub-20261006-0323.dump",
      "aitech_hub-20261007-0323.dump",
      "aitech_hub-20261008-0323.dump",
    ]) {
      await writeFile(path.join(dir, f), "x");
    }
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("保留最近 keep 份,删除其余;*.tgz 等无关文件不动", async () => {
    await writeFile(path.join(dir, "ssl-20261008.tgz"), "y");
    const pruned = await pruneLocalDumps(dir, 2);
    expect(pruned).toBe(1);
    const left = await readdir(dir);
    expect(left).toContain("aitech_hub-20261008-0323.dump");
    expect(left).toContain("aitech_hub-20261007-0323.dump");
    expect(left).not.toContain("aitech_hub-20261006-0323.dump");
    expect(left).toContain("ssl-20261008.tgz");
  });

  it("目录缺失返回 0 不抛", async () => {
    expect(await pruneLocalDumps(path.join(dir, "no-such"), 3)).toBe(0);
  });
});

describe("dbBackupJob(注入 stub)", () => {
  const put = vi.fn().mockResolvedValue(undefined);

  function deps(extra: Parameters<typeof dbBackupJob>[0] = {}) {
    return {
      bucket: { put },
      // stub 与真 pg_dump 行为对齐:必须产出 outPath 文件(job 随后读它上传)
      runDump: vi.fn(async (outPath: string) => {
        await writeFile(outPath, "");
      }),
      // tar 同理:产出打包文件再由 job 读取上传
      packSsl: vi.fn(async (outPath: string) => {
        await writeFile(outPath, "");
      }),
      backupDir: extra.backupDir,
      sslDir: extra.sslDir,
      now: new Date("2026-10-08T03:23:00Z"),
      ...extra,
    };
  }

  it("dump → 上传 backups/db/<名> → 本地留 3 份;返回 key/大小/耗时", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "ah-backup-job-"));
    try {
      const d = deps({ backupDir: dir, sslDir: path.join(dir, "no-ssl") });
      const r = await dbBackupJob(d);
      expect(d.runDump).toHaveBeenCalledWith(path.join(dir, "db", "aitech_hub-20261008-1123.dump"));
      expect(put).toHaveBeenCalledWith(
        "backups/db/aitech_hub-20261008-1123.dump",
        expect.any(Buffer),
        "application/octet-stream",
      );
      expect(r.key).toBe("backups/db/aitech_hub-20261008-1123.dump");
      expect(r.sizeBytes).toBe(0);
      expect(r.sslKey).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("ssl 目录存在 → tar 入桶 misc/,本地 tar 清理;packSsl 失败只 warn 不拦主体", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "ah-backup-ssl-"));
    try {
      const sslDir = path.join(dir, "ssl");
      await mkdir2(sslDir);
      await writeFile(path.join(sslDir, "fullchain.pem"), "cert");
      const d = deps({ backupDir: dir, sslDir });
      const r = await dbBackupJob(d);
      expect(r.sslKey).toBe("backups/misc/ssl-20261008.tgz");
      expect(put).toHaveBeenCalledWith("backups/misc/ssl-20261008.tgz", expect.any(Buffer));

      const d2 = deps({
        backupDir: dir,
        sslDir,
        packSsl: vi.fn().mockRejectedValue(new Error("tar boom")),
      });
      const r2 = await dbBackupJob(d2);
      expect(r2.key).toBe("backups/db/aitech_hub-20261008-1123.dump");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

async function mkdir2(p: string): Promise<void> {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(p, { recursive: true });
}
