/**
 * 最小 ZIP 读取器(只取单个成员,不落盘)
 *
 * 为什么手写:上游 Epoch 数据包是 zip,而运行镜像里没有 unzip/python/busybox/7z
 * (只有 tar+gzip,tar 读不了 zip),依赖清单里也没有 zip 库。与其为一个文件引入
 * 一个 zip 依赖,不如按 ZIP 规范读中央目录——只需要「找到成员 + 解压 + 校验」。
 *
 * 安全边界:
 * - 只解指定的**一个**成员,不解整包、不落盘(免 zip-slip 落盘面);
 * - 解压后字节数有上限(防 zip bomb),超限直接抛错;
 * - 拒绝加密成员与不支持的压缩方法;
 * - 解完校验 CRC32,数据被篡改/截断会报错而不是静默用坏数据。
 */
import { crc32, inflateRawSync } from "node:zlib";

const EOCD_SIG = 0x06054b50;
const CD_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;
/** EOCD 注释最长 65535,故 EOCD 一定落在文件末尾 65557 字节内 */
const EOCD_SCAN_LIMIT = 65535 + 22;

const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;

export interface ZipEntryOptions {
  /** 解压后字节数上限(防 zip bomb),默认 8MB */
  maxOutputBytes?: number;
}

function findEocd(buf: Buffer): number {
  const start = Math.max(0, buf.length - EOCD_SCAN_LIMIT);
  for (let i = buf.length - 22; i >= start; i -= 1) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  throw new Error("zip 结构异常:未找到 EOCD 记录");
}

/** 读一个成员的原始字节(不落盘);找不到成员/结构异常/超限均抛错 */
export function readZipEntry(buf: Buffer, entryName: string, opts: ZipEntryOptions = {}): Buffer {
  const maxOutputBytes = opts.maxOutputBytes ?? 8 * 1024 * 1024;
  if (buf.length < 22) throw new Error("zip 结构异常:文件过小");

  const eocd = findEocd(buf);
  const totalEntries = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (totalEntries === 0xffff || cdOffset === 0xffffffff) {
    throw new Error("zip 结构异常:不支持 ZIP64");
  }
  if (cdOffset + cdSize > buf.length) throw new Error("zip 结构异常:中央目录越界");

  let cursor = cdOffset;
  for (let i = 0; i < totalEntries; i += 1) {
    if (cursor + 46 > buf.length) throw new Error("zip 结构异常:中央目录截断");
    if (buf.readUInt32LE(cursor) !== CD_SIG) throw new Error("zip 结构异常:中央目录项签名不符");
    const flags = buf.readUInt16LE(cursor + 8);
    const method = buf.readUInt16LE(cursor + 10);
    const expectedCrc = buf.readUInt32LE(cursor + 16);
    const compressedSize = buf.readUInt32LE(cursor + 20);
    const uncompressedSize = buf.readUInt32LE(cursor + 24);
    const nameLen = buf.readUInt16LE(cursor + 28);
    const extraLen = buf.readUInt16LE(cursor + 30);
    const commentLen = buf.readUInt16LE(cursor + 32);
    const localOffset = buf.readUInt32LE(cursor + 42);
    const name = buf.subarray(cursor + 46, cursor + 46 + nameLen).toString("utf-8");
    cursor += 46 + nameLen + extraLen + commentLen;

    if (name !== entryName) continue;
    if (flags & 0x1) throw new Error(`zip 成员 ${entryName} 已加密,不支持`);
    if (method !== METHOD_STORED && method !== METHOD_DEFLATE) {
      throw new Error(`zip 成员 ${entryName} 压缩方法 ${method} 不支持`);
    }
    if (uncompressedSize > maxOutputBytes) {
      throw new Error(`zip 成员 ${entryName} 解压后 ${uncompressedSize} 字节,超上限`);
    }
    return extractMember(buf, {
      entryName,
      method,
      expectedCrc,
      compressedSize,
      uncompressedSize,
      localOffset,
      maxOutputBytes,
    });
  }
  throw new Error(`zip 内没有成员 ${entryName}`);
}

function extractMember(
  buf: Buffer,
  m: {
    entryName: string;
    method: number;
    expectedCrc: number;
    compressedSize: number;
    uncompressedSize: number;
    localOffset: number;
    maxOutputBytes: number;
  },
): Buffer {
  const { localOffset } = m;
  if (localOffset + 30 > buf.length) throw new Error("zip 结构异常:本地头越界");
  if (buf.readUInt32LE(localOffset) !== LOCAL_SIG) {
    throw new Error("zip 结构异常:本地头签名不符");
  }
  // 本地头的 name/extra 长度可能与中央目录不同(中央目录里可能是别的值),
  // 数据起点必须按本地头算
  const nameLen = buf.readUInt16LE(localOffset + 26);
  const extraLen = buf.readUInt16LE(localOffset + 28);
  const dataStart = localOffset + 30 + nameLen + extraLen;
  const dataEnd = dataStart + m.compressedSize;
  if (dataEnd > buf.length) throw new Error("zip 结构异常:成员数据越界");
  const raw = buf.subarray(dataStart, dataEnd);

  const out =
    m.method === METHOD_STORED ? raw : inflateRawSync(raw, { maxOutputLength: m.maxOutputBytes });
  if (out.length !== m.uncompressedSize) {
    throw new Error(`zip 成员 ${m.entryName} 解压长度与目录不符`);
  }
  if (crc32(out) !== m.expectedCrc) {
    throw new Error(`zip 成员 ${m.entryName} CRC 校验失败`);
  }
  return out;
}
