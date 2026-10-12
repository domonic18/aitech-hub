/**
 * 飞书选题库推送(M25,方案 §4:任务B 热点视频 → 选题库 bitable「选题池」):
 * 四项 env 全配才启用,缺省=跳过不阻塞发现主流程。契约(2026-10-12 文档实证):
 * - client_token 走 query 参数,格式硬校验 UUIDv4(非 v4 报 1254037),随机 v4 即可
 *   (幂等主防线是 feishuRecordId 回写判重,client_token 兜同秒重放)
 * - 字段值形态:文本/单选=字符串,日期=毫秒时间戳,超链接={text,link} 对象
 * - 字段名与线上「选题池」表头实名对齐;机器只填事实列,类型/优先级/来源留给人工
 */
import { randomUUID } from "crypto";

import { z } from "zod";

import { env } from "../env";

const FEISHU_OPEN = "https://open.feishu.cn";
const TIMEOUT_MS = 10_000;

export function isFeishuPushConfigured(): boolean {
  return Boolean(
    env.FEISHU_APP_ID &&
    env.FEISHU_APP_SECRET &&
    env.DISCOVERY_FEISHU_BITABLE &&
    env.DISCOVERY_FEISHU_TABLE_ID,
  );
}

// tenant_access_token 进程级缓存(有效期 2h,提前 5min 刷新;worker 常驻复用)
let cachedToken: { token: string; expiresAt: number } | null = null;

const tokenRespSchema = z.object({
  code: z.number(),
  msg: z.string().optional(),
  tenant_access_token: z.string().optional(),
  expire: z.number().optional(),
});

async function getTenantToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 5 * 60_000) {
    return cachedToken.token;
  }
  const res = await fetch(`${FEISHU_OPEN}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: env.FEISHU_APP_ID, app_secret: env.FEISHU_APP_SECRET }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const parsed = tokenRespSchema.safeParse(await res.json());
  if (!parsed.success || parsed.data.code !== 0 || !parsed.data.tenant_access_token) {
    const detail = parsed.success
      ? (parsed.data.msg ?? `code=${parsed.data.code}`)
      : "响应形态异常";
    throw new Error(`飞书 tenant_access_token 获取失败:${detail}`);
  }
  cachedToken = {
    token: parsed.data.tenant_access_token,
    expiresAt: Date.now() + (parsed.data.expire ?? 7200) * 1000,
  };
  return cachedToken.token;
}

/** 推送载荷(video 候选的事实列) */
export interface FeishuVideoPayload {
  title: string;
  bvid: string;
  play: number;
  author: string;
  hitKeywords: string[];
}

// 选题池表头实名(线上表 2026-10-12 列字段实证)
const FIELD_TITLE = "选题标题";
const FIELD_ANGLE = "核心角度";
const FIELD_LINK = "素材链接";
const FIELD_STATUS = "状态";
const FIELD_CREATED = "创建日期";
const STATUS_IDEA = "灵感";

const recordRespSchema = z.object({
  code: z.number(),
  msg: z.string().optional(),
  data: z
    .object({ record: z.object({ record_id: z.string() }).passthrough() })
    .passthrough()
    .optional(),
});

/** 创建一条选题记录,返回 record_id(由调用方回写 candidate.feishuRecordId) */
export async function pushVideoToBitable(v: FeishuVideoPayload): Promise<string> {
  const token = await getTenantToken();
  const url = new URL(
    `${FEISHU_OPEN}/open-apis/bitable/v1/apps/${env.DISCOVERY_FEISHU_BITABLE}/tables/${env.DISCOVERY_FEISHU_TABLE_ID}/records`,
  );
  // 幂等键:UUIDv4(飞书硬校验格式);主防线仍是 feishuRecordId 判重
  url.searchParams.set("client_token", randomUUID());
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      fields: {
        [FIELD_TITLE]: v.title,
        [FIELD_STATUS]: STATUS_IDEA,
        [FIELD_LINK]: { text: "B站视频", link: `https://www.bilibili.com/video/${v.bvid}` },
        [FIELD_ANGLE]: `命中词:${v.hitKeywords.join("、")};播放:${v.play};UP主:${v.author}`,
        [FIELD_CREATED]: Date.now(),
      },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const parsed = recordRespSchema.safeParse(await res.json());
  if (!parsed.success || parsed.data.code !== 0 || !parsed.data.data?.record) {
    const detail = parsed.success
      ? (parsed.data.msg ?? `code=${parsed.data.code}`)
      : "响应形态异常";
    throw new Error(`飞书记录创建失败:${detail}`);
  }
  return parsed.data.data.record.record_id;
}
