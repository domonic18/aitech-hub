/**
 * 最小 ZIP 读取器单测
 * 自造 zip(stored / deflate 两种方法)读回成员,并验四类拒绝:缺成员、
 * 坏包、CRC 不符、解压体积超限。
 */
import { deflateRawSync, crc32 } from "node:zlib";
import { describe, expect, it } from "vitest";

import { readZipEntry } from "./zip-read";

interface BuiltZip {
  buffer: Buffer;
  /** 数据区起始偏移(用来故意改坏字节) */
  dataOffset: number;
}

/** 自造一个单成员 zip(deflate 或 stored) */
function buildZip(name: string, content: string, method: 0 | 8 = 8): BuiltZip {
  const nameBuf = Buffer.from(name, "utf-8");
  const raw = Buffer.from(content, "utf-8");
  const data = method === 8 ? deflateRawSync(raw) : raw;
  const sum = crc32(raw);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(method, 8);
  local.writeUInt32LE(sum, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(raw.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  local.writeUInt16LE(0, 28);

  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0);
  cd.writeUInt16LE(20, 4);
  cd.writeUInt16LE(20, 6);
  cd.writeUInt16LE(0, 8);
  cd.writeUInt16LE(method, 10);
  cd.writeUInt32LE(sum, 16);
  cd.writeUInt32LE(data.length, 20);
  cd.writeUInt32LE(raw.length, 24);
  cd.writeUInt16LE(nameBuf.length, 28);
  cd.writeUInt32LE(0, 42); // 本地头偏移 = 0

  const cdOffset = local.length + nameBuf.length + data.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cd.length + nameBuf.length, 12);
  eocd.writeUInt32LE(cdOffset, 16);

  return {
    buffer: Buffer.concat([local, nameBuf, data, cd, nameBuf, eocd]),
    dataOffset: local.length + nameBuf.length,
  };
}

describe("readZipEntry", () => {
  it("读回 deflate 成员", () => {
    const zip = buildZip("epoch_capabilities_index/eci_scores.csv", "Model,eci\nA,1\n", 8);
    const out = readZipEntry(zip.buffer, "epoch_capabilities_index/eci_scores.csv");
    expect(out.toString("utf-8")).toBe("Model,eci\nA,1\n");
  });

  it("读回 stored 成员", () => {
    const zip = buildZip("a.txt", "hello", 0);
    expect(readZipEntry(zip.buffer, "a.txt").toString("utf-8")).toBe("hello");
  });

  it("成员不存在时报错", () => {
    const zip = buildZip("a.txt", "hello", 8);
    expect(() => readZipEntry(zip.buffer, "b.txt")).toThrow(/没有成员/);
  });

  it("数据被改坏时 CRC 校验失败", () => {
    const zip = buildZip("a.txt", "hello", 0);
    zip.buffer[zip.dataOffset] = 0x00;
    expect(() => readZipEntry(zip.buffer, "a.txt")).toThrow(/CRC/);
  });

  it("坏包(没有 EOCD)报错", () => {
    expect(() => readZipEntry(Buffer.from("x".repeat(64)), "a.txt")).toThrow(/EOCD/);
  });

  it("解压体积超上限时报错", () => {
    const zip = buildZip("a.txt", "x".repeat(1000), 8);
    expect(() => readZipEntry(zip.buffer, "a.txt", { maxOutputBytes: 10 })).toThrow(/超上限/);
  });
});
