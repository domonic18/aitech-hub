/**
 * /telegram 公开右栏「采集计划」快照(M69):未来 12 小时内容任务 + 最近内容类
 * 运行记录。只取内容链路(content-scope 白名单),运维/对账/清理/健康一律不露出;
 * 台账查询失败时降级为空列表——公开页不因运行台账异常 500。
 */
import { CONTENT_JOB_KEYS } from "./content-scope";
import { upcomingContentRuns } from "./plan-rows";
import { formatCnTime } from "../datetime";
import { jobRunLabel, listRecentJobRuns } from "../jobs/runlog-admin";
import { logWarn } from "../logger";

export interface ContentPlanSnapshot {
  /** 即将运行(时刻升序,服务端预格式化) */
  upcoming: Array<{ key: string; label: string; atText: string }>;
  /** 最近内容类运行(startedAt 倒序) */
  recent: Array<{ id: string; label: string; status: string; atText: string }>;
}

const EMPTY: ContentPlanSnapshot = { upcoming: [], recent: [] };

export async function getContentPlanSnapshot(): Promise<ContentPlanSnapshot> {
  try {
    const [upcoming, rows] = await Promise.all([
      upcomingContentRuns(12, 5),
      listRecentJobRuns(CONTENT_JOB_KEYS, 3),
    ]);
    return {
      upcoming,
      recent: rows.map((r) => ({
        id: r.id.toString(),
        label: jobRunLabel(r.jobKey),
        status: r.status,
        atText: formatCnTime(r.startedAt),
      })),
    };
  } catch (e) {
    logWarn("telegram.content_plan.failed", { error: e });
    return EMPTY;
  }
}
