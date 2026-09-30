/**
 * media-manifest 阶段(引用闭包 → 落盘清单):引用闭包 → media/ 落盘 + rsync 清单。
 * - uploads 项:从源 uploads 树拷贝(URL /wp-content/uploads/X → media/X)
 * - extracted 项:transform 解码的 base64 产物从 artifacts 拷入
 * - 产出 media_files_from.txt(生产 rsync --files-from 用)与 copy-summary(load/verify 用)
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";

import { ARTIFACTS, config } from "./config";
import type { MediaPlan, TransformResult } from "./types";

export interface CopyEntry {
  path: string;
  status: "copied" | "missing";
  sizeBytes: number | null;
  sha1: string | null;
}

function sha1File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha1");
    createReadStream(file)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });
}

export async function runMediaManifest(): Promise<CopyEntry[]> {
  const result = JSON.parse(
    await readFile(join(config.artifactsDir(), ARTIFACTS.transform.result), "utf8"),
  ) as TransformResult;

  const uploadsDir = config.uploadsDir();
  const mediaDir = config.mediaDir();
  const base64Dir = join(config.artifactsDir(), ARTIFACTS.transform.base64Dir);

  const entries: CopyEntry[] = [];
  const rsyncLines: string[] = [];
  const missing: string[] = [];

  for (const m of result.media as MediaPlan[]) {
    const targetRel = m.path.replace(/^\/wp-content\/uploads\//, "");
    const target = join(mediaDir, targetRel);
    const source =
      m.source.type === "uploads"
        ? join(uploadsDir, m.source.relPath)
        : join(base64Dir, m.source.artifactFile);
    try {
      await stat(source);
      await mkdir(dirname(target), { recursive: true });
      await copyFile(source, target);
      const [size, hash] = await Promise.all([stat(source).then((s) => s.size), sha1File(target)]);
      entries.push({ path: m.path, status: "copied", sizeBytes: size, sha1: hash });
      if (m.source.type === "uploads") rsyncLines.push(m.source.relPath);
    } catch {
      entries.push({ path: m.path, status: "missing", sizeBytes: null, sha1: null });
      missing.push(m.path);
    }
  }

  await writeFile(
    join(config.artifactsDir(), ARTIFACTS.manifest.filesFrom),
    rsyncLines.join("\n") + "\n",
    "utf8",
  );
  await writeFile(
    join(config.artifactsDir(), ARTIFACTS.manifest.copySummary),
    JSON.stringify({ entries, missing }, null, 2),
    "utf8",
  );

  console.log(
    JSON.stringify({
      event: "media.done",
      total: entries.length,
      copied: entries.filter((e) => e.status === "copied").length,
      missing: missing.length,
    }),
  );
  if (missing.length > 0) {
    console.warn(JSON.stringify({ event: "media.missing", paths: missing.slice(0, 20) }));
  }
  return entries;
}

if (process.argv[1]?.endsWith("media-manifest.ts")) {
  runMediaManifest().catch((e) => {
    console.error(JSON.stringify({ event: "media.failed", error: String(e) }));
    process.exit(1);
  });
}
