/**
 * 舞台引导卡(M44 状态驱动交互,原型 F2):产出为空时替代一行虚线文案——
 * 三步清单告诉用户「现在在哪、下一步点哪」:① 挂载素材 ② 确认右侧配置
 * ③ 点底部创作条生成;首个未完成步标「当前步骤」chip,底部 ↓ 指向创作条。
 * 服务端纯展示件(完成度由服务端数据直接判定,无客户端状态)。
 */

export default function StageGuideCard({
  variant,
  materialsCount,
  configured,
}: {
  variant: "post" | "pin";
  /** 已挂素材数(步骤① 完成判定:≥2) */
  materialsCount: number;
  /** 对应配置已落库(步骤② 完成判定:positioning|pinPositioning 非空) */
  configured: boolean;
}) {
  const isPost = variant === "post";
  const action = isPost ? "生成长文" : "生成贴图";
  const configName = isPost ? "写作要求" : "贴图配置";
  const steps: { done: boolean; text: string }[] = [
    { done: materialsCount >= 2, text: `挂载素材(建议 2~3 条,当前 ${materialsCount} 条)` },
    { done: configured, text: `确认右侧「${configName}」配置` },
    { done: false, text: `点击下方「${action}」,生成过程实时可见` },
  ];
  const current = steps.findIndex((s) => !s.done);

  return (
    <div className="flex flex-col gap-3.5 rounded-sm border border-line bg-panel p-5">
      <h3 className="text-[13px] font-semibold text-text-1">
        {materialsCount >= 2
          ? `素材已就绪,还没有${isPost ? "长文" : "贴图"}`
          : "先挂载素材,再开始创作"}
      </h3>
      <ol className="flex flex-col gap-2.5">
        {steps.map((s, i) => (
          <li key={s.text} className="flex items-center gap-2 text-[12.5px]">
            {s.done ? (
              <span className="text-green">✓</span>
            ) : i === current ? (
              <span className="text-accent">●</span>
            ) : (
              <span className="text-text-3">○</span>
            )}
            <span
              className={s.done ? "text-text-2" : i === current ? "text-text-1" : "text-text-3"}
            >
              {s.text}
            </span>
            {i === current && (
              <span className="rounded-sm bg-accent/12 px-1.5 py-px text-[10.5px] text-accent">
                当前步骤
              </span>
            )}
          </li>
        ))}
      </ol>
      <p className="flex items-center gap-1.5 text-[11px] text-text-3">
        <span className="text-accent">↓</span>
        生成入口在底部创作条;生成中舞台会显示进度现场,完成后自动刷新并高亮新产出。
      </p>
    </div>
  );
}
