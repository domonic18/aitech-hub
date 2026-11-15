/**
 * 卡图嵌入自洽校验(M72 B1 移到内容域共享):原在 lib/agent/topic-draft-tool.ts
 * (站内 agent 写工具,B4 随创作面下线)——MCP 侧 upsert_article 也要用同一道闸,
 * 故提到内容域:agent 通道与 MCP 通道同源,不做两份实现。
 */
/**
 * 卡图嵌入自洽校验(纯函数):只审计「清单对得上」——card_urls 列出的每张
 * 卡必须在正文中嵌了图;不规定该有几张卡(呈现策略归技能指南与自评审)。
 * 2026-10-17 验收反馈:模型渲染了卡但起草正文时漏嵌入,媒体库有图正文无图。
 * 同图重复校验(2026-10-17 呈现协调性反馈):任一站内图片路径在正文出现
 * >1 次即拒(封面重复插等协调性硬伤机器可判,策略归指南)。
 */
export function checkCardEmbeds(
  contentMd: string,
  cardUrls: string[],
): { ok: true } | { ok: false; error: string } {
  const missing = cardUrls.filter((u) => !contentMd.includes(u));
  if (missing.length > 0) {
    return {
      ok: false,
      error:
        `正文缺少 ${missing.length} 张已渲染卡片图(渲染了但没嵌入):` +
        `${missing
          .slice(0, 5)
          .map((u) => `![](${u})`)
          .join("、")};` +
        "请把这些 markdown 行原样插入正文对应位置(独占一行,前后空行)后重新提交",
    };
  }
  const counts = new Map<string, number>();
  for (const m of contentMd.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)) {
    counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
  }
  const duplicated = [...counts.entries()].filter(([, n]) => n > 1);
  if (duplicated.length > 0) {
    return {
      ok: false,
      error:
        "同一图片在正文重复嵌入(每张图全文至多出现一次):" +
        duplicated
          .slice(0, 5)
          .map(([u, n]) => `${u}(${String(n)} 次)`)
          .join("、") +
        ";请删除多余重复嵌入后重新提交",
    };
  }
  return { ok: true };
}
