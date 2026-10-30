/**
 * admin 顶栏 crumb 链推导(纯函数,从 AdminTopbar 拆出便于单测):
 * 路径 → 「站点统计 › 域 › … › 详情」,中间级可点击返回。
 * 坑(2026-10-30 验收):中间级按字面路径拼链接,而 clusters 是虚拟段
 * (/admin/insight/clusters/[id] 有详情页、无 index 页),点「机会与痛点」
 * 落 /admin/insight/clusters/ 直接 404——虚拟段须显式指到真实落点。
 */

export interface Crumb {
  label: string;
  /** 末级 crumb 无 href(纯文本);中间级必带,可点击返回 */
  href?: string;
}

/** 已知段文案;未知段按 decodeURIComponent 兜底(不再裸输出路径) */
const SEG_LABEL: Record<string, string> = {
  posts: "文章管理",
  categories: "分类",
  media: "媒体库",
  comments: "评论管理",
  distribute: "分发中心", // IA v2 更名(原「内容分发」),路由不变
  studio: "创作中心",
  illustration: "配图工坊",
  pins: "贴图管理",
  data: "数据中心",
  sources: "源管理",
  schedule: "计划",
  plan: "计划", // IA v5:计划升独立页签 /admin/data/plan
  run: "运行",
  insight: "洞察中心", // IA v5:洞察独立域 /admin/insight
  discovery: "发现", // IA v5:洞察 › 发现(旧独立发现中心已 308)
  mine: "挖掘",
  users: "用户管理",
  feedback: "反馈管理",
  pats: "PAT 令牌",
  new: "新建文章",
  preview: "预览",
  settings: "系统设置",
  email: "邮件",
  feishu: "飞书免登",
  pay: "支付",
  orders: "支付订单",
  telegram: "电报管理",
  spider: "采集总览",
  channels: "渠道",
  bloggers: "博主",
  github: "项目",
  models: "模型配置",
  skills: "写作技能",
  usage: "AI 用量",
  sessions: "会话",
};

/** 无独立 index 页的虚拟段 → 真实落点(否则字面路径 404) */
const VIRTUAL_SEG_HREF: Record<string, string> = {
  clusters: "/admin/insight/", // 机会与痛点列表在洞察中心页内
};

/** 数字段 = 详情/编辑页 id,文案随上一段域变化;其余未知段解码展示 */
function segLabel(seg: string, prev?: string): string {
  if (/^\d+$/.test(seg)) {
    if (prev === "studio") return "创作详情";
    if (prev === "illustration") return "编辑器"; // F14 板 crumb「配图工坊 › 编辑器」
    if (prev === "pins") return "贴图详情";
    if (prev === "clusters") return "簇详情"; // F25/F26 机会/痛点详情
    return "编辑文章";
  }
  if (seg === "clusters") return "机会与痛点";
  return SEG_LABEL[seg] ?? decodeSeg(seg);
}

function decodeSeg(seg: string): string {
  try {
    return decodeURIComponent(seg);
  } catch {
    return seg;
  }
}

/** 路径 → crumb 链(中间级全部可点击,解决"进详情后回不去"的反馈) */
export function crumbsOf(pathname: string): Crumb[] {
  const crumbs: Crumb[] = [{ label: "站点统计", href: "/admin" }];
  const segs = pathname
    .replace(/^\/admin\/?/, "")
    .split("/")
    .filter(Boolean);
  let acc = "/admin";
  segs.forEach((seg, i) => {
    acc += `/${seg}`;
    const label = segLabel(seg, i > 0 ? segs[i - 1] : undefined);
    const href = VIRTUAL_SEG_HREF[seg] ?? acc;
    crumbs.push(i === segs.length - 1 ? { label } : { label, href });
  });
  return crumbs;
}
