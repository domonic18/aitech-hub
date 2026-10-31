/**
 * 采集计划登记表(M34 批③ 验收反馈·问题1):系统全部周期任务的一份事实。
 * cron 常量的唯一真相源在本文件(queue.ts 仅 re-export,防客户端组件把
 * bullmq 拖进浏览器包);解析为「每日触发时刻 × 触发日」供日历/列表双视图,
 * 间隔型 tick 任务单列常驻清单。纯数据+纯函数,零 IO,客户端可安全引用。
 */

// ── 定时 cron 常量(worker/schedules.ts 注册与登记表展示共用;北京时间)──

/** 媒体体检每日调度(避开整点;arch/08-media §3.2;worker 与媒体库页脚同源,评审 W2) */
export const MEDIA_AUDIT_CRON = "41 3 * * *";
// 牌价渠道采集(M55 批C;M56 批B 起并入 crawl_source tick 频率调度,无独立 cron)

/** 访问明细 7 天保留期清理(M10 批⑥;凌晨档避开 media-audit) */
export const VISIT_LOG_PURGE_CRON = "14 4 * * *";

/** hold 候选临时件清扫:每日 04:23(避开 4:14 访问清理 / 4:33 会话清退档) */
export const COVER_TEMP_SWEEP_CRON = "23 4 * * *";

/** AI 用量台账 90 天保留期清理(凌晨档,与 visit-log/media-audit 错峰) */
export const USAGE_LOG_PURGE_CRON = "52 4 * * *";

/** Drawer 会话 30 天自动清退(凌晨档错峰:audit 03:41 / visit 04:14 / agent 04:33 / usage 04:52) */
export const AGENT_SESSION_PURGE_CRON = "33 4 * * *";

/** 任务运行台账 30 天保留期清理(验收二批③;04 点清理带错峰:14 访问 / 23 封面 /
 * 33 会话 / 47 任务台账 / 52 用量) */
export const JOB_RUN_PURGE_CRON = "47 4 * * *";

/** 榜单展示汇率日采 04:43(M63 v2.1:美元→人民币,价格双币切换用;错峰卡在
 * 04:33 会话清退与 04:47 任务台账之间,单请求任务) */
export const LEADERBOARD_FX_CRON = "43 4 * * *";

/** 数据库每日备份 03:23(standard/02 §6 03:30 槽位就近错峰;M19 批②) */
export const DB_BACKUP_CRON = "23 3 * * *";

/** embedding 对账调度:每 15 分钟错峰(7/22/37/52 分,避开各整点任务与 crawl tick) */
export const EMBED_RECONCILE_CRON = "7,22,37,52 * * * *";

/** 支付日对账 04:13(提案 §5.2;凌晨档,与其他清理任务不同队列不冲突) */
export const PAY_DAILY_AUDIT_CRON = "13 4 * * *";

/** 热词采集 05:37 日频(discovery-plan §7:错峰 03:23 backup / 03:41 audit / 04:52 usage) */
export const DISCOVERY_HOTWORDS_CRON = "37 5 * * *";

/** B站发现 06:13 周一早(双窗全词约 5-10 分钟,避开热词档) */
export const DISCOVERY_BILI_CRON = "13 6 * * 1";

/** 洞察向量回填+聚类调度:每 15 分钟,与三域 embedding 对账(7/22/37/52 分)
 * 错峰(3/18/33/48 分,同档不撞车) */
export const INSIGHT_EMBED_CRON = "3,18,33,48 * * * *";

/** 洞察日批 03:57(凌晨档错峰:03:41 media-audit / 04:13 pay-audit / 04:14
 * visit-purge;LLM 调用分钟级,避开 4 点清理带) */
export const INSIGHT_DAILY_CRON = "57 3 * * *";

/** 洞察打标小批 :12/:42(M60 批C:未命名簇积压治理——打标从「日批一次 24 条」
 * 改为配额内高频小批,簇养熟即命名;避开 :43 热榜拉取 / :3,18,33,48 向量回填 /
 * :5,15,25,35,45,55 翻译扫尾;每轮受当日剩余配额钳制,配额 300/日) */
export const INSIGHT_LABEL_CRON = "12,42 * * * *";

/** 热榜拉取小时批 :43(验收二批② 提频:热榜日内高波动,日频漏采;refId=
 * 词/问题id/关键词内容锚,unique(source,refId) 幂等——在榜词续热刷新,新词
 * 入池,提频不膨胀;LLM/向量只处理新增,成本增量可忽略) */
export const INSIGHT_FETCH_CRON = "43 * * * *";

/** 信号翻译扫尾 :05/:15/…/:55(M58 批①;避开 :43 热榜与 3/18/33/48 embed;
 * ingest 即时入队为主,本 cron 只补入队丢失与超时 pending 降级) */
export const INSIGHT_TRANSLATE_CRON = "5,15,25,35,45,55 * * * *";

/** 任务域(颜色为设计令牌原值,globals.css 同源;色点/日历 chip 共用) */
export type ScheduleCategory = "insight" | "discovery" | "process" | "ops";

export const SCHEDULE_CATEGORIES: Record<ScheduleCategory, { label: string; color: string }> = {
  insight: { label: "洞察采集", color: "#5e6ad2" },
  discovery: { label: "内容发现", color: "#2ea043" },
  process: { label: "加工对账", color: "#d29922" },
  ops: { label: "系统运维", color: "#8a8f98" },
};

export interface CronScheduleDef {
  key: string;
  label: string;
  desc: string;
  cron: string;
  category: ScheduleCategory;
  /** jobRun jobKey(最近运行落账映射;M48 批E 单源化——原 plan-rows 手工第二张
   * 映射表,漏登记则计划页「最近运行」恒显「—」)。缺省 = 不入账(如
   * embed-reconcile 准心跳) */
  jobRunKey?: string;
}

/** 定时任务登记(cron 顺序=凌晨时间线序,列表视图按此序展示) */
export const SCHEDULE_REGISTRY: CronScheduleDef[] = [
  {
    key: "db-backup",
    jobRunKey: "db-backup/run",
    label: "数据库备份",
    desc: "pg_dump → 备份桶,本地留 3 份",
    cron: DB_BACKUP_CRON,
    category: "ops",
  },
  {
    key: "media-audit",
    jobRunKey: "media-audit/audit",
    label: "媒体体检",
    desc: "媒体库完整性审计(每日定时)",
    cron: MEDIA_AUDIT_CRON,
    category: "ops",
  },
  {
    key: "insight-daily",
    jobRunKey: "insight/daily",
    label: "洞察日批",
    desc: "增量聚类 + LLM 打标 + 覆盖度 + 快照",
    cron: INSIGHT_DAILY_CRON,
    category: "insight",
  },
  {
    key: "insight-label",
    jobRunKey: "insight/label",
    label: "洞察打标小批",
    desc: "每 30 分钟配额内小批打标,簇养熟即命名(未命名积压治理)",
    cron: INSIGHT_LABEL_CRON,
    category: "insight",
  },
  {
    key: "pay-daily-audit",
    jobRunKey: "pay-reconcile/daily-audit",
    label: "支付日对账",
    desc: "近 7 天 paid 查单比对流水,不一致只告警",
    cron: PAY_DAILY_AUDIT_CRON,
    category: "process",
  },
  {
    key: "visit-purge",
    jobRunKey: "stats/purge-visit-log",
    label: "访问明细清理",
    desc: "访问明细 7 天保留期滚动清理",
    cron: VISIT_LOG_PURGE_CRON,
    category: "ops",
  },
  {
    key: "cover-sweep",
    jobRunKey: "cover-gen/temp-sweep",
    label: "封面候选清扫",
    desc: "cover-gen hold 候选临时件日频清扫",
    cron: COVER_TEMP_SWEEP_CRON,
    category: "ops",
  },
  {
    key: "agent-purge",
    jobRunKey: "stats/purge-agent-session",
    label: "会话清退",
    desc: "Drawer 会话 30 天前留档清理",
    cron: AGENT_SESSION_PURGE_CRON,
    category: "ops",
  },
  {
    key: "leaderboard-fx",
    jobRunKey: "crawler/leaderboard-fx-refresh",
    label: "榜单汇率",
    desc: "美元→人民币汇率日采(榜单价格双币切换,M63 v2.1)",
    cron: LEADERBOARD_FX_CRON,
    category: "insight",
  },
  {
    key: "job-run-purge",
    jobRunKey: "stats/purge-job-run",
    label: "任务台账清理",
    desc: "任务运行台账 30 天保留期清理(worker 分发器落账,验收二批③)",
    cron: JOB_RUN_PURGE_CRON,
    category: "ops",
  },
  {
    key: "discovery-hotwords",
    jobRunKey: "discovery/discovery-hotwords",
    label: "发现热词",
    desc: "外站热词日频直拉入发现池",
    cron: DISCOVERY_HOTWORDS_CRON,
    category: "discovery",
  },
  {
    key: "usage-purge",
    jobRunKey: "stats/purge-usage-log",
    label: "用量台账清理",
    desc: "AI 用量台账 90 天保留期清理",
    cron: USAGE_LOG_PURGE_CRON,
    category: "ops",
  },
  {
    key: "insight-fetch",
    jobRunKey: "insight/fetch",
    label: "热榜拉取",
    desc: "百度/知乎/B站热搜榜面小时级入信号池(在榜续热,新词入池)",
    cron: INSIGHT_FETCH_CRON,
    category: "insight",
  },
  {
    key: "discovery-bili",
    jobRunKey: "discovery/discovery-bili",
    label: "B站发现",
    desc: "双窗全词扫描,周频(周一早)",
    cron: DISCOVERY_BILI_CRON,
    category: "discovery",
  },
  {
    key: "embed-reconcile",
    label: "三域向量对账",
    desc: "扫 stale(文章/项目/信号)→ 批 embed → upsert",
    cron: EMBED_RECONCILE_CRON,
    category: "process",
  },
  {
    key: "insight-embed",
    jobRunKey: "insight/embed",
    label: "洞察向量回填",
    desc: "信号高频向量回填 + 增量聚类",
    cron: INSIGHT_EMBED_CRON,
    category: "insight",
  },
  {
    key: "insight-translate",
    jobRunKey: "insight/translate",
    label: "信号翻译扫尾",
    desc: "补翻在池非中文信号 + 超时 pending 降级",
    cron: INSIGHT_TRANSLATE_CRON,
    category: "insight",
  },
];

export interface ResidentScheduleDef {
  key: string;
  label: string;
  desc: string;
  /** 展示口径的触发频率(_interval 型无 cron,不参与解析) */
  cadence: string;
  category: ScheduleCategory;
}

/** 常驻 tick(时间驱动循环,无 cron;crawler/github tick 由 worker 启动时注册) */
export const RESIDENT_REGISTRY: ResidentScheduleDef[] = [
  {
    key: "crawler-tick",
    label: "crawler tick",
    desc: "每分钟扫到期渠道/博主 → crawl job(nextRunAt 幂等去重)",
    cadence: "每 1 分钟",
    category: "process",
  },
  {
    key: "github-tick",
    label: "github tick",
    desc: "扫描到期白名单仓 → sync job,单仓失败隔离",
    cadence: "每 5 分钟",
    category: "process",
  },
  {
    key: "ai-backfill-tick",
    label: "AI 补扫",
    desc: "消化未解读存量(文字/视频各限 5 条/轮)",
    cadence: "每 5 分钟",
    category: "process",
  },
  {
    key: "pay-sweep",
    label: "支付 sweep",
    desc: "近过期 pending 单收敛(补发货/过期关单)",
    cadence: "每 5 分钟",
    category: "process",
  },
  {
    key: "stats-flush",
    label: "统计落库",
    desc: "beacon 缓冲聚合成站访日统计",
    cadence: "每 60 秒",
    category: "process",
  },
];

// ── cron 解析(只覆盖本项目在用形态:m h * * * / m1,m2 h * * * / m h * * dow)──

export interface CronParsed {
  /** 触发时刻 "HH:mm"(升序;hourly 时为档位分钟 + 00 时占位,展示走 cadenceText) */
  times: string[];
  /** 通配小时(分钟档每小时触发,如 15 分钟对账);false=单时刻档 */
  hourly: boolean;
  /** 触发日 PG dow 口径(0=周日);null=每日 */
  days: number[] | null;
  /** 触发日口径的日触发次数(hourly = 分钟档数 × 24) */
  firesPerDay: number;
}

function parseList(field: string, lo: number, hi: number): number[] | null {
  if (field === "*") return null;
  const out: number[] = [];
  for (const part of field.split(",")) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < lo || n > hi) return null;
    out.push(n);
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

/** 解析本项目 cron 子集(两种形态:分钟列表×单时刻小时 / 分钟列表×通配小时);
 * 不支持形态返回 null(登记表新增任务时同步扩此处)。 */
export function parseCron(cron: string): CronParsed | null {
  const [min, hour, , , dow] = cron.trim().split(/\s+/);
  if (min === undefined || hour === undefined) return null;
  const minutes = parseList(min, 0, 59);
  if (minutes === null) return null; // 通配分钟 = 秒级高频,不属此视图
  const days = parseList(dow ?? "*", 0, 6);
  const hours = parseList(hour, 0, 23);
  if (hours === null) {
    // 通配小时:每小时按分钟档触发(15 分钟对账档)
    return {
      times: minutes.map((m) => `00:${String(m).padStart(2, "0")}`),
      hourly: true,
      days: days === null || days.length === 7 ? null : days,
      firesPerDay: minutes.length * 24,
    };
  }
  if (hours.length !== 1) return null; // 单时刻档
  return {
    times: minutes.map((m) => `${String(hours[0]).padStart(2, "0")}:${String(m).padStart(2, "0")}`),
    hourly: false,
    days: days === null || days.length === 7 ? null : days,
    firesPerDay: minutes.length,
  };
}

export interface ScheduleEntry extends CronScheduleDef {
  parsed: CronParsed;
}

/** 日历视图只收低频任务;超过此阈值的 cron 进常驻清单(如 15 分钟对账 ×2) */
export const CALENDAR_MAX_FIRES_PER_DAY = 8;

/** 登记表 → 视图条目(解析失败静默剔除并保留 key 供测试断言不变式) */
export function buildScheduleEntries(): { calendar: ScheduleEntry[]; resident: ScheduleEntry[] } {
  const calendar: ScheduleEntry[] = [];
  const resident: ScheduleEntry[] = [];
  for (const def of SCHEDULE_REGISTRY) {
    const parsed = parseCron(def.cron);
    if (parsed === null) continue;
    (parsed.firesPerDay > CALENDAR_MAX_FIRES_PER_DAY ? resident : calendar).push({
      ...def,
      parsed,
    });
  }
  return { calendar, resident };
}

/** 人话版计划文本(列表视图;「07:43 每日」「06:13 周一」「4 次/小时」) */
export function cadenceText(entry: ScheduleEntry): string {
  const { times, days, hourly } = entry.parsed;
  if (hourly) return `${times.length} 次/小时`;
  const dayText = days === null ? "每日" : days.map((d) => DOW_LABELS_CN[d]).join("/");
  return `${times.join(" ")} ${dayText}`;
}

export const DOW_LABELS_CN = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
