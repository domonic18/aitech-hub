/**
 * 分发记录服务单测(prisma mock):resetRecordBinding(M17 批⑤)
 * 三分支——记录不存在 404 / 无绑定拒清 / 有绑定置 null。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({
  prisma: {
    publishChannel: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

import { prisma } from "../db";
import { DistributeError } from "./errors";
import { resetRecordBinding } from "./records";

const mockedFind = vi.mocked(prisma.publishChannel.findUnique);
const mockedUpdate = vi.mocked(prisma.publishChannel.update);

function row(mediaId: string | null): Record<string, unknown> {
  return { id: 7, postId: 101, channel: "wechat", status: "synced", mediaId };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resetRecordBinding", () => {
  it("记录不存在 → not_found", async () => {
    mockedFind.mockResolvedValue(null as never);
    await expect(resetRecordBinding(BigInt(7))).rejects.toThrow(DistributeError);
    await expect(resetRecordBinding(BigInt(7))).rejects.toThrow("同步记录不存在");
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it("无 media_id 绑定 → 拒清(invalid)", async () => {
    mockedFind.mockResolvedValue(row(null) as never);
    await expect(resetRecordBinding(BigInt(7))).rejects.toThrow("没有 media_id 绑定");
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it("有绑定 → update 置 mediaId=null", async () => {
    mockedFind.mockResolvedValue(row("DRAFT_MEDIA_1") as never);
    mockedUpdate.mockResolvedValue(row(null) as never);
    await expect(resetRecordBinding(BigInt(7))).resolves.toBeUndefined();
    expect(mockedUpdate).toHaveBeenCalledWith({
      where: { id: BigInt(7) },
      data: { mediaId: null },
    });
  });
});
