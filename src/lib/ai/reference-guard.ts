/**
 * 参照图风格守卫(纯函数,零依赖;M42 批③自 agent/illustrate-tool 迁出,供
 * agent 工具与贴图生成 API 共用——API 路由不该为一条正则拉进 langchain 工具模块):
 * 带参照图时 prompt 出现 HEX 色值即判自编配色与参照冲突。2026-10-21 验收实证:
 * 文字风格指令会压过参照图(Seedream 听文字的),编排模型无视工具描述里的锚定句
 * 纪律 → 升级执行侧守卫(fail-closed 人话反馈,模型可自纠重调)。只拦确定性信号
 * HEX;色名/深浅底类软冲突由系统提示 + schema 描述双层文本约束承载。
 */
export function detectReferenceStyleConflict(prompt: string): string | null {
  const hit = prompt.match(/#[0-9a-fA-F]{3,8}\b/);
  return hit ? `prompt 含具体色值 ${hit[0]}` : null;
}
