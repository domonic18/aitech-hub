/**
 * 采集总览 KPI 四卡(原型 kpi-grid;数组驱动对齐 stats/KpiCards 风格):
 * 今日入库(较昨日)/ 条目库存(可见·隐藏·归档)/ 队列积压 / 失败任务(>0 标红)。纯 RSC。
 */
interface SpiderStock {
  visible?: number;
  hidden?: number;
  archived?: number;
}

export default function SpiderKpiCards({
  today,
  yesterday,
  stock,
  backlog,
  active,
  completed,
  failed,
  enabledChannels,
}: {
  today: number;
  yesterday: number;
  stock: SpiderStock;
  backlog: number;
  active: number;
  completed: number;
  failed: number;
  enabledChannels: number;
}) {
  const kpi = "rounded-md border border-line bg-panel px-4 py-4";
  const kpiLabel = "flex items-center gap-1.5 text-[12.5px] text-text-2";
  const kpiNum = "mt-2 font-mono text-[26px] font-bold leading-none tracking-[-0.01em]";
  const kpiSub = "mt-1.5 text-[11.5px] text-text-3";
  const cards = [
    {
      icon: "i-send",
      label: "今日入库",
      num: String(today),
      numCls: `${kpiNum} text-text-1`,
      sub: (
        <>
          较昨日
          <b className={`ml-1 font-medium ${today >= yesterday ? "text-green" : "text-amber"}`}>
            {today >= yesterday ? "+" : ""}
            {today - yesterday}
          </b>
        </>
      ),
    },
    {
      icon: "i-cloudserver",
      label: "条目库存",
      num: String(Object.values(stock).reduce((a, b) => a + b, 0)),
      numCls: `${kpiNum} text-text-1`,
      sub: (
        <>
          可见 <b className="font-medium text-green">{stock.visible ?? 0}</b> · 隐藏{" "}
          <b className="font-medium text-text-2">{stock.hidden ?? 0}</b> · 归档{" "}
          <b className="font-medium text-text-2">{stock.archived ?? 0}</b>
        </>
      ),
    },
    {
      icon: "i-dashboard",
      label: "队列积压",
      num: String(backlog),
      numCls: `${kpiNum} text-text-1`,
      sub: (
        <>
          active <b className="font-medium text-text-2">{active}</b> · completed{" "}
          <b className="font-medium text-text-2">{completed}</b>
        </>
      ),
    },
    {
      icon: "i-warning",
      label: "失败任务",
      num: String(failed),
      numCls: `${kpiNum} ${failed > 0 ? "text-red" : "text-text-1"}`,
      sub: (
        <>
          渠道 <b className="font-medium text-text-2">{enabledChannels}</b> 个调度中
        </>
      ),
    },
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((c) => (
        <div key={c.label} className={kpi}>
          <div className={kpiLabel}>
            <svg className="ic text-accent" aria-hidden="true">
              <use href={`#${c.icon}`} />
            </svg>
            {c.label}
          </div>
          <div className={c.numCls}>{c.num}</div>
          <div className={kpiSub}>{c.sub}</div>
        </div>
      ))}
    </div>
  );
}
