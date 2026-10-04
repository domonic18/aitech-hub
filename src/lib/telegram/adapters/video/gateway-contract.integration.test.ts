/**
 * 网关实弹契约对拍(不进 CI):打真网关(本地 dev compose
 * `docker compose --profile douyin up -d douyin-gateway`),验证黄金样本之外
 * 的真实序列化路径。网关未起则跳过;网关镜像升级 runbook 步骤之一(standard/02)。
 * 跑法:npm run test:integration
 */
import { describe, expect, it } from "vitest";

import {
  gatewayErrorSchema,
  gatewayHealthSchema,
  postsResponseSchema,
  resolveResponseSchema,
} from "./gateway-contract";

const BASE_URL = process.env.DOUYIN_GATEWAY_URL ?? "http://127.0.0.1:8010";

async function reachable(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(2_000) });
    return res.ok;
  } catch {
    return false;
  }
}

describe.skipIf((await reachable()) === false)("douyin-gateway 实弹契约", () => {
  it("/health:严格契约解析(含 jars 计数字段)", async () => {
    const res = await fetch(`${BASE_URL}/health`);
    expect(res.ok).toBe(true);
    gatewayHealthSchema.strict().parse(await res.json());
  });

  it("/posts 非法 sec_uid → 422 {detail:数组}", async () => {
    const res = await fetch(`${BASE_URL}/posts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sec_uid: "short" }),
    });
    expect(res.status).toBe(422);
    const parsed = gatewayErrorSchema.parse(await res.json());
    expect(Array.isArray(parsed.detail)).toBe(true);
  });

  it("/posts 合法 sec_uid 空Cookie → 非 2xx 错误包络 {error?, detail}(实网关真实上游错误)", async () => {
    const res = await fetch(`${BASE_URL}/posts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sec_uid: "MS4wLjABAAAA1234567890abcdefghij" }),
    });
    expect(res.ok).toBe(false);
    gatewayErrorSchema.parse(await res.json()); // 形状合法即可,状态码随上游波动不断言
  });

  it(
    "DOUYIN_INTEGRATION_SEC_UID 设置时:/posts 真实拉取走通成功包络",
    { timeout: 60_000 },
    async () => {
      const secUid = process.env.DOUYIN_INTEGRATION_SEC_UID;
      if (!secUid) {
        console.warn("跳过:设 DOUYIN_INTEGRATION_SEC_UID 才做真实拉取对拍");
        return;
      }
      const res = await fetch(`${BASE_URL}/posts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sec_uid: secUid, cookies: [], max_pages: 1 }),
      });
      // 无 Cookie 直拉可能被风控(502)——成功与否都须落在本契约形状内
      if (res.ok) {
        postsResponseSchema.strict().parse(await res.json());
      } else {
        gatewayErrorSchema.parse(await res.json());
      }
    },
  );

  it("DOUYIN_INTEGRATION_SHARE_URL 设置时:/resolve 短链解析走通", { timeout: 30_000 }, async () => {
    const url = process.env.DOUYIN_INTEGRATION_SHARE_URL;
    if (!url) {
      console.warn("跳过:设 DOUYIN_INTEGRATION_SHARE_URL 才做真实解析对拍");
      return;
    }
    const res = await fetch(`${BASE_URL}/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    });
    expect(res.ok).toBe(true);
    resolveResponseSchema.strict().parse(await res.json());
  });
});
