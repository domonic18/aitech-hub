/**
 * 公众号连通性测试(M17 批①):实调 /cgi-bin/token 取 access_token,
 * 结果落 last_test 四件套;40164(IP 白名单)等经 humanizeWechatError
 * 人话透出(errmsg 自带出口 IP,指引公众号后台配置)。
 */
import { type NextRequest, NextResponse } from "next/server";

import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import { fetchWechatToken } from "@/lib/distribute/wechat-client";
import { getWechatForTest, recordWechatTest } from "@/lib/distribute/wechat-config-admin";
import { DISTRIBUTE_PAT_DENY } from "@/lib/distribute/channels";
import { DistributeError, distributeErrorStatus } from "@/lib/distribute/errors";

export const dynamic = "force-dynamic";

interface WechatTestOutcome {
  ok: boolean;
  latencyMs: number;
  detail: string;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const actor = await requireSessionActor(req, DISTRIBUTE_PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  try {
    const target = await getWechatForTest();
    const started = Date.now();
    let outcome: WechatTestOutcome;
    try {
      await fetchWechatToken(target.appid, target.appSecret);
      outcome = {
        ok: true,
        latencyMs: Date.now() - started,
        detail: "access_token 获取成功",
      };
    } catch (e) {
      outcome = {
        ok: false,
        latencyMs: Date.now() - started,
        detail: e instanceof Error ? e.message : String(e),
      };
    }
    await recordWechatTest(outcome);
    return apiEnvelope(0, outcome.ok ? "ok" : "fail", outcome);
  } catch (e) {
    if (e instanceof DistributeError) {
      return apiEnvelope(distributeErrorStatus(e.code), e.message);
    }
    throw e;
  }
}
