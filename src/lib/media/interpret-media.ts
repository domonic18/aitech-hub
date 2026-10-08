/**
 * 解读管道媒体操作(M9;批C 从 interpret-video 平移,媒体域单点):
 * 直链下载(内存缓冲 + 大小上限护栏)→ ffmpeg 抽 16k 单声 mp3 → 转写读字节。
 * 版权红线承载:音视频只在 tmp 存活于单次判读,调用方 finally 即焚(removeTmpDir)。
 */
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import ffmpegPath from "ffmpeg-static";

const DOWNLOAD_TIMEOUT_SEC = 60;
const DOWNLOAD_MAX_BYTES = 100 * 1024 * 1024; // 100MB(并发 1,内存缓冲可承受)

const execFileAsync = promisify(execFile);

/** 判读临时目录(前缀 interpret-,便于运维辨识与清理) */
export function makeInterpretTmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "interpret-"));
}

/** 临时目录内媒体文件路径(视频 mp4 / 抽轨 mp3) */
export function tmpMediaPaths(tmpDir: string): { videoPath: string; audioPath: string } {
  return { videoPath: path.join(tmpDir, "video.mp4"), audioPath: path.join(tmpDir, "audio.mp3") };
}

/** 即焚临时目录(版权红线:成功/失败都必须走到) */
export function removeTmpDir(dir: string): Promise<void> {
  return fs.rm(dir, { recursive: true, force: true }).then(() => undefined);
}

/** 无水印直链下载落 tmp(内存缓冲;超限二次校验防 content-length 缺失谎报) */
export async function downloadVideoToTmp(playUrl: string, destPath: string): Promise<void> {
  const res = await fetch(playUrl, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_SEC * 1000) });
  if (!res.ok || !res.body) throw new Error(`直链下载失败 HTTP ${res.status}`);
  const len = Number(res.headers.get("content-length") ?? "0");
  if (len > DOWNLOAD_MAX_BYTES) {
    throw new Error(`视频超过大小上限(${Math.round(len / 1e6)}MB > 100MB)`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > DOWNLOAD_MAX_BYTES) throw new Error("视频超过大小上限(100MB)");
  await fs.writeFile(destPath, buf);
}

/** ffmpeg 抽 mp3(16k 单声,-t 截断);execFile 数组参数零注入,-loglevel error 防 stderr 撑爆 */
export async function extractAudioMp3(
  videoPath: string,
  audioPath: string,
  maxAudioSeconds: number,
): Promise<void> {
  if (!ffmpegPath) throw new Error("ffmpeg 二进制缺失(ffmpeg-static 安装异常)");
  await execFileAsync(ffmpegPath, [
    "-i",
    videoPath,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-t",
    String(maxAudioSeconds),
    "-loglevel",
    "error",
    "-y",
    audioPath,
  ]);
}

/** 读抽轨音节给 ASR 客户端(转写后音频即弃,不落任何持久层) */
export function readAudioFile(audioPath: string): Promise<Buffer> {
  return fs.readFile(audioPath);
}
