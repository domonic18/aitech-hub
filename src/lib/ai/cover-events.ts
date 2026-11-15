/**
 * 封面候选事件名(客户端安全的叶子模块):编辑器 ↔ 候选面板的同页面广播。
 *
 * 独立成文件的原因:事件名既要给 agent 候选卡(站内)用,也要给编辑器的
 * HTTP 触发面板用,而后者是 client 组件——不能从带 prisma 的服务端模块引。
 */

export const COVER_ADOPTED_EVENT = "ah:cover-adopted";
