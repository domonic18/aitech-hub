/**
 * 洞察域 AI 模型解析统一入口(M56 review P2-25):此前四处 resolveAiModel
 * 守卫范式不一(embed/daily 裸 await、classify .catch、label try-catch),
 * 收敛于此——吞异常返 null,固化「未绑定=降级跳过」:解析失败(DB 抖动/
 * apiKey 解密失败)与未绑定同途,调用方判空降级。嵌入/打标/分类均为可跳过
 * 的增强段,批处理永不因绑定解析抛错中断。
 */
import type { AiTaskRole } from "../ai/constants";
import { resolveAiModel, type ResolvedAiModel } from "../ai/resolver";

export async function resolveInsightModel(role: AiTaskRole): Promise<ResolvedAiModel | null> {
  try {
    return await resolveAiModel(role);
  } catch {
    return null;
  }
}
