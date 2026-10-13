/**
 * 解读管道媒体操作(M9;批C 从 interpret-video 平移,媒体域单点):
 * 直链下载(流式落盘:卡顿探测超时替全局死线 + 大小帽护栏,M27 批⑦ 长视频)
 * → ffmpeg 抽 16k 单声 mp3 按段切片 → 转写逐段读字节。
 * 版权红线承载:音视频只在 tmp 存活于单次判读,调用方 finally 即焚(removeTmpDir)。
 */
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import ffmpegPath from "ffmpeg-static";

/** 建连/响应头死线(整体下载不再设全局死线——长视频慢链路 60s 必死) */
const DOWNLOAD_HEADERS_TIMEOUT_MS = 60_000;
/** 卡顿探测:单次 read 无新数据的死线(有数据流过就续命,慢而不死) */
const DOWNLOAD_STALL_TIMEOUT_MS = 30_000;
/** 大小帽(流式落盘不占内存,从 100MB 放宽到 500MB 容长视频) */
const DOWNLOAD_MAX_BYTES = 500 * 1024 * 1024;
/** ffmpeg 抽轨切片死线(进程级 kill,防挂死占 tmp) */
const FFMPEG_TIMEOUT_MS = 10 * 60_000;

const execFileAsync = promisify(execFile);

/** 给 promise 挂死线(到期 reject message;finally 清 timer 防进程悬挂) */
function withDeadline<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([p, deadline]).finally(() => clearTimeout(timer));
}

/** 判读临时目录(前缀 interpret-,便于运维辨识与清理) */
export function makeInterpretTmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "interpret-"));
}

/** 临时目录内视频文件路径(抽轨切片产物由 extractAudioSegments 直接落 tmpDir) */
export function tmpMediaPaths(tmpDir: string): { videoPath: string } {
  return { videoPath: path.join(tmpDir, "video.mp4") };
}

/** 即焚临时目录(版权红线:成功/失败都必须走到) */
export function removeTmpDir(dir: string): Promise<void> {
  return fs.rm(dir, { recursive: true, force: true }).then(() => undefined);
}

/** 无水印直链下载流式落盘(M27 批⑦ 长视频:内存缓冲 100MB/60s 双门槛是长视频
 * 解读失败的第一根因——改流式写盘,卡顿探测替全局死线,大小帽放宽 500MB 且
 * 落盘逐块复核防 content-length 谎报)。
 * headers:B站 CDN 防盗链须 Referer(M24 downloadHeadersFor 透传),douyin 裸 fetch */
export async function downloadVideoToTmp(
  playUrl: string,
  destPath: string,
  headers: Record<string, string> = {},
): Promise<void> {
  const res = await withDeadline(
    fetch(playUrl, { headers }),
    DOWNLOAD_HEADERS_TIMEOUT_MS,
    "直链下载建连超时(60s 无响应头)",
  );
  if (!res.ok || !res.body) throw new Error(`直链下载失败 HTTP ${res.status}`);
  const len = Number(res.headers.get("content-length") ?? "0");
  if (len > DOWNLOAD_MAX_BYTES) {
    throw new Error(`视频超过大小上限(${Math.round(len / 1e6)}MB > 500MB)`);
  }
  const reader = res.body.getReader();
  const file = await fs.open(destPath, "w");
  try {
    let total = 0;
    for (;;) {
      const { done, value } = await withDeadline(
        reader.read(),
        DOWNLOAD_STALL_TIMEOUT_MS,
        `直链下载停滞超时(${DOWNLOAD_STALL_TIMEOUT_MS / 1000}s 无新数据)`,
      );
      if (done) break;
      total += value.byteLength;
      if (total > DOWNLOAD_MAX_BYTES) throw new Error("视频超过大小上限(500MB)");
      await file.write(value);
    }
  } catch (err) {
    await reader.cancel().catch(() => undefined); // 中途断:释放连接,不留半截读挂起
    throw err;
  } finally {
    await file.close();
  }
}

/** ffmpeg 抽 16k 单声 mp3 并按段切片(M27 批⑦ 长视频:单段直传 ASR 超 120s
 * 死线是第二根因——5min/段让每段独立吃转写预算)。-t 总帽保留防超长刷爆 tmp;
 * execFile 数组参数零注入,-loglevel error 防 stderr 撑爆,进程级超时护栏。
 * 返回按序段文件路径(seg-000.mp3 起字典序即时间序)。 */
export async function extractAudioSegments(
  videoPath: string,
  tmpDir: string,
  maxAudioSeconds: number,
  segmentSeconds: number,
): Promise<string[]> {
  if (!ffmpegPath) throw new Error("ffmpeg 二进制缺失(ffmpeg-static 安装异常)");
  try {
    await execFileAsync(
      ffmpegPath,
      [
        "-i",
        videoPath,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-t",
        String(maxAudioSeconds),
        "-f",
        "segment",
        "-segment_time",
        String(segmentSeconds),
        "-reset_timestamps",
        "1",
        "-loglevel",
        "error",
        "-y",
        path.join(tmpDir, "seg-%03d.mp3"),
      ],
      { timeout: FFMPEG_TIMEOUT_MS, killSignal: "SIGKILL" },
    );
  } catch (err) {
    throw new Error(`ffmpeg 抽轨切片失败:${err instanceof Error ? err.message : String(err)}`);
  }
  const names = (await fs.readdir(tmpDir)).filter((n) => /^seg-\d+\.mp3$/.test(n)).sort();
  if (names.length === 0) throw new Error("音轨切片产物为空(源无音轨或 ffmpeg 失败)");
  return names.map((n) => path.join(tmpDir, n));
}

/** 读段音节给 ASR 客户端(转写后音频即弃,不落任何持久层) */
export function readAudioFile(audioPath: string): Promise<Buffer> {
  return fs.readFile(audioPath);
}
