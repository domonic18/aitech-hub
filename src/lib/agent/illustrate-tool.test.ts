/**
 * 文生图图文工具单测(M39 批④建,§13.9 重定义,全 mock):admin 会话防线 /
 * 成功回传路径与 markdown 行 / aspect 透传执行核心 / 未绑定与生图失败人话
 * ok:false(不阻塞,模型可自纠改走 render_card)/ 意外异常原样上抛。执行核心
 * 见 illustrate-generate.test.ts。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const assertAdminThread = vi.hoisted(() => vi.fn());
const adminThreadDeny = vi.hoisted(() =>
  vi.fn((_tid: unknown, scope: string) => JSON.stringify({ ok: false, error: `非${scope}会话` })),
);
vi.mock("./admin-thread", () => ({ adminThreadDeny, assertAdminThread }));

const generateIllustrations = vi.hoisted(() => vi.fn());
vi.mock("../ai/illustrate-generate", () => ({
  generateIllustrations,
  ILLUSTRATE_ASPECT_SIZES: { "16:9": "1344x768", "3:4": "864x1152", "1:1": "1024x1024" },
  ILLUSTRATE_MAX_COUNT: 3,
}));

import { AiAdminError, AiClientError } from "../ai/errors";
import { generateIllustrationTool } from "./illustrate-tool";

async function invoke(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const raw = (await generateIllustrationTool.invoke(
    args as never,
    {
      configurable: { thread_id: "t-admin" },
    } as never,
  )) as string;
  return JSON.parse(raw) as Record<string, unknown>;
}

beforeEach(() => {
  vi.resetAllMocks();
  assertAdminThread.mockResolvedValue(true);
});

describe("generate_illustration(文生图图文工具)", () => {
  it("非 admin 会话 → 拒且不触达执行核心", async () => {
    assertAdminThread.mockResolvedValueOnce(false);
    await expect(invoke({ prompt: "p" })).resolves.toMatchObject({ ok: false });
    expect(generateIllustrations).not.toHaveBeenCalled();
  });

  it("成功:回传站内路径与 markdown 行,附落稿 hint", async () => {
    generateIllustrations.mockResolvedValueOnce({
      images: [{ path: "/wp-content/uploads/2026/10/illu-a.png", mime: "image/png" }],
    });
    const out = await invoke({ prompt: "一只机械鹤立于数据流之上" });
    expect(out).toMatchObject({ ok: true });
    expect((out.images as Array<{ markdown: string }>)[0]?.markdown).toBe(
      "![图文](/wp-content/uploads/2026/10/illu-a.png)",
    );
    expect(generateIllustrations).toHaveBeenCalledWith({
      prompt: "一只机械鹤立于数据流之上",
      n: 1,
    });
    expect(String(out.hint)).toContain("card_urls");
  });

  it("aspect 透传执行核心(机制参数,工具不改写)", async () => {
    generateIllustrations.mockResolvedValueOnce({
      images: [{ path: "/wp-content/uploads/2026/10/illu-a.png", mime: "image/png" }],
    });
    await invoke({ prompt: "p", aspect: "3:4" });
    expect(generateIllustrations).toHaveBeenCalledWith({
      prompt: "p",
      aspect: "3:4",
      n: 1,
    });
  });

  it("多张:markdown 逐张带序号", async () => {
    generateIllustrations.mockResolvedValueOnce({
      images: [
        { path: "/wp-content/uploads/2026/10/illu-a.png", mime: "image/png" },
        { path: "/wp-content/uploads/2026/10/illu-b.png", mime: "image/png" },
      ],
    });
    const out = await invoke({ prompt: "p", count: 2 });
    const marks = (out.images as Array<{ markdown: string }>).map((i) => i.markdown);
    expect(marks).toEqual([
      "![图文1](/wp-content/uploads/2026/10/illu-a.png)",
      "![图文2](/wp-content/uploads/2026/10/illu-b.png)",
    ]);
  });

  it("未绑定模型 → ok:false 人话(AiAdminError 不上抛)", async () => {
    generateIllustrations.mockRejectedValueOnce(
      new AiAdminError(
        "disabled",
        "未绑定或未启用「插图配图(illustrate)」模型:先到 AI 配置完成任务绑定",
      ),
    );
    await expect(invoke({ prompt: "p" })).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("未绑定"),
    });
  });

  it("生图失败 → ok:false 人话(AiClientError 不上抛)", async () => {
    generateIllustrations.mockRejectedValueOnce(new AiClientError("timeout", "生图超时(60s)"));
    await expect(invoke({ prompt: "p" })).resolves.toMatchObject({
      ok: false,
      error: "生图超时(60s)",
    });
  });

  it("意外异常原样上抛(非契约错误不由工具吞)", async () => {
    generateIllustrations.mockRejectedValueOnce(new Error("pg 连接断"));
    await expect(invoke({ prompt: "p" })).rejects.toThrow("pg 连接断");
  });
});
