/**
 * preset 示例数据(M38 从 presets.ts 拆出):卡片模板库页(/admin/cards)
 * 预填文本,亦是各卡型的字段口径示范——新卡型落地先在此给一份可读样张。
 */
import { type CardPresetId } from "./presets";

export const PRESET_SAMPLE_DATA: Record<CardPresetId, unknown> = {
  quote: {
    quote: "模型的能力上限决定产品的上限,交互的体验下限决定用户的去留",
    author: "某科技博主 · B站《AI 产品方法论》",
  },
  points: {
    title: "三步搭建本地知识库",
    points: [
      { text: "选型:本地部署优先 Ollama,显存 8G 起步", icon: "🧰" },
      { text: "灌库:文档切块 512 token 重叠 64,召回率提升 23%", icon: "📦" },
      { text: "问答:先检索后生成,引用原文出处", icon: "💬" },
    ],
  },
  stats: {
    title: "2026 AI 工作流调研",
    items: [
      { value: "92%", label: "受访者认为 AI 已实质改变工作流", delta: "+18%" },
      { value: "3.2×", label: "效率提升中位数" },
      { value: "18 分钟", label: "平均日节省" },
    ],
  },
  bars: {
    title: "主流模型长文本吞吐对比",
    unit: "万 token/s",
    items: [
      { label: "旗舰 A", pct: 100, value: "8.6" },
      { label: "旗舰 B", pct: 72, value: "6.2" },
      { label: "开源最优", pct: 45, value: "3.9" },
      { label: "端侧 7B", pct: 18, value: "1.5" },
    ],
  },
  ledger: {
    title: "端侧推理环境速览",
    rows: [
      { k: "推理框架", v: "llama.cpp" },
      { k: "量化格式", v: "Q4_K_M" },
      { k: "显存占用", v: "5.8 GB" },
      { k: "上下文窗口", v: "32K" },
      { k: "首 token 延迟", v: "180 ms" },
    ],
  },
  compare: {
    title: "本地部署 vs 云端 API",
    left: {
      label: "🖥️ 本地部署",
      items: ["数据不出机器,隐私零顾虑", "高频调用成本随用量摊薄", "离线环境完全可用"],
    },
    right: {
      label: "☁️ 云端 API",
      items: ["上手即用,无需运维 GPU", "旗舰模型效果天花板", "弹性扩缩按需付费"],
    },
    verdict: "个人学习与隐私敏感场景选本地,生产业务与追新模型选云端 API",
  },
  steps: {
    title: "RAG 知识库落地四步",
    steps: [
      { title: "语料清洗", detail: "去重、去噪、按语义切块" },
      { title: "向量化入库", detail: "bge-m3 嵌入,建向量索引" },
      { title: "检索调优", detail: "TopK 召回 + 重排过滤" },
      { title: "引用生成", detail: "答案强制标注原文出处" },
    ],
  },
  flow: {
    title: "AI Agent 运行全流程",
    subtitle: "一次任务从提出到交付的完整链路",
    lanes: [
      { name: "用户", emoji: "🧑" },
      { name: "Agent 大脑", emoji: "🧠" },
      { name: "工具集", emoji: "🛠️" },
    ],
    phases: [
      { name: "接收任务", desc: "明确目标与约束" },
      { name: "思考规划", desc: "拆解步骤选工具" },
      { name: "执行反馈", desc: "调用工具迭代修正" },
      { name: "交付结果", desc: "汇总产出" },
    ],
    steps: [
      { text: "提出任务", lane: 0, phase: 0 },
      { text: "理解意图", lane: 1, phase: 0 },
      { text: "拆解子任务", lane: 1, phase: 1 },
      { text: "选择工具", lane: 1, phase: 1 },
      { text: "执行调用", lane: 2, phase: 2 },
      { text: "返回结果", lane: 2, phase: 2 },
      { text: "检查与重试", lane: 1, phase: 2 },
      { text: "输出答案", lane: 1, phase: 3 },
      { text: "确认收货", lane: 0, phase: 3 },
    ],
    summary: "Agent = 大脑(规划)+ 工具(执行)+ 反馈循环(修正),循环到任务完成",
  },
  timeline: {
    title: "大模型上下文窗口进化史",
    events: [
      { time: "2020.05", text: "GPT-3 发布,4K 上下文成为起点" },
      { time: "2023.03", text: "GPT-4带来 32K,长文档处理成为可能" },
      { time: "2023.11", text: "各家卷向 128K,整本书一次读完" },
      { time: "2024", text: "Gemini 1.5 破到 1M,视频级输入" },
      { time: "2026", text: "百万级成主流,记忆管理转向分层架构" },
    ],
    summary: "窗口每扩大一个量级,应用形态就换一代:问答 → 文档 → 全库",
  },
  matrix: {
    title: "端侧 AI 芯片格局盘点",
    cells: [
      { name: "NVIDIA Jetson", desc: "生态最全,算力天花板", icon: "🟩" },
      { name: "Apple Neural", desc: "能效比标杆,统一内存", icon: "🍎" },
      { name: "高通 Hexagon", desc: "手机端部署主力", icon: "📱" },
      { name: "华为昇腾", desc: "国产全栈方案", icon: "🇨🇳" },
      { name: "寒武纪", desc: "云端推理卡", icon: "🔶" },
      { name: "地平线", desc: "智驾专用芯片", icon: "🚗" },
    ],
  },
  photo: {
    src: "/wp-content/uploads/2026/10/sample-photo.jpg",
    title: "发布会的第一排",
    caption: "Keynote 现场:新一代端侧芯片首次公开跑通 70B 模型",
  },
};
