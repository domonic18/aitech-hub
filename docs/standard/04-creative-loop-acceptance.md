# 创作闭环验收剧本

**用途**:站内创作能力下线前后的回归基准。每批改动(B3~B8)都跑一遍本剧本,证明
「线下 Claude Code + MCP」仍能独立走完一整条闭环。

**背景**:2026-11 站内创作中心瘦身(M72)。站内 agent 写侧逐批下线,创作职责外移到
线下 Claude Code;线上只保留文章/贴图的**管理**与**分发**。本剧本就是这条迁移的
验收线——跑通了才有资格关站内入口。

## 一、闭环的七步

```
选 skill → 读素材 → 出稿 → 出卡/出图 → 上传入库 → 同步公众号草稿 → 后台人工发布
```

| 步 | 做什么 | 用什么 | 通过判据 |
| --- | --- | --- | --- |
| 1 选 skill | 按场景挑写作指南并读全文 | MCP `list_skills` → `get_skill` | 拿到 key/名称/场景/版本;全文含结构·口吻·字数·配图·码点预算 |
| 2 读素材 | 取信号与站内已有内容 | MCP `list_signals`(增量游标)/ `search_site` / `get_telegram_item` | 素材可溯源(带原文链与时间);不引无源内容 |
| 3 出稿 | 按指南写 .md | 线下本地 | frontmatter 齐(title/category/slug);字数与结构合指南 |
| 4 出卡/出图 | 本地生成配图/信息卡 | 线下本地(渲染与生图都在线下) | 图落本地;卡图**同时**有清单(path)与正文引用 |
| 5 上传入库 | 图 + 文一起进站,落草稿 | `POST /api/posts/bundle`(单篇)/ `POST /api/posts/bundles`(批量)/ MCP `upsert_article` | 返回 `action=created` 与站内路径;`list_drafts` 能查到该稿 |
| 6 同步公众号 | 推成公众号草稿箱 | MCP `sync_article_to_wechat` → `get_distribute_job` 轮询 | job 到 `completed`;草稿出现在公众号后台草稿箱(未发布) |
| 7 人工发布 | 站长在后台/公众号点发布 | 后台界面 | 前台可见;URL 为 `/post/<id>-<slug>` |

## 二、每步的具体调用

以下 `<MCP>` 指 `POST /api/mcp`(Streamable HTTP,Bearer PAT),`<BASE>` 指站点源。

### 1 选 skill

```bash
curl -s -X POST "$BASE/api/mcp/" \
  -H "Authorization: Bearer $PAT" -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_skills","arguments":{}}}'

# 再按 key 取全文
curl -s -X POST "$BASE/api/mcp/" -H "Authorization: Bearer $PAT" \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_skill","arguments":{"key":"blogger-video"}}}'
```

### 2 读素材

```
tools/call list_signals  {since: <ISO 时间>}   → 事件级增量,带 nextCursor 续页
tools/call search_site   {q: "<关键词>"}        → 三域检索,命中带 id 与原文链
tools/call get_telegram_item {id: "<条目 id>"}  → 单条完整元数据(AI 解读、解读笔记)
```

### 4~5 出卡/出图 → 上传入库

图在本地生成后直传(**字节不过模型上下文**):

```bash
curl -s -X POST "$BASE/api/media/" -H "Authorization: Bearer $PAT" \
  -F "file=@<图.png>"          # → {data:{path:"/wp-content/uploads/…"}}
```

带图的文稿走整包上传(一篇 + 它的图):

```bash
curl -s -X POST "$BASE/api/posts/bundle/" -H "Authorization: Bearer $PAT" \
  -F "md=@<文章.md>" -F "files=@<图1.png>" -F "files=@<图2.png>"
```

一周多篇走批量(`mds` 重复字段 + 共享图池,单批 ≤20 篇,逐篇回报成败):

```bash
curl -s -X POST "$BASE/api/posts/bundles/" -H "Authorization: Bearer $PAT" \
  -F "mds=@<a.md>" -F "mds=@<b.md>" \
  -F "files=@<a-cover.png>" -F "files=@<b-cover.png>"
```

纯文本稿(无图)走 MCP,并用 `cardUrls` 声明信息卡清单:

```
tools/call upsert_article {markdown: "<md 正文>", cardUrls: ["/wp-content/uploads/…/card.png"]}
```

**卡图清单闸**:声明了 `cardUrls` 就会校验「每张卡都已嵌入正文」,漏嵌直接拒稿
(`invalid_body`)。渲了卡却漏嵌,卡片在站内会退化成普通配图——所以清单和正文引用
必须同时给。

### 6 同步公众号

```
tools/call sync_article_to_wechat {postId: "<id>"}   → {jobId, token}
tools/call get_distribute_job {jobId, token}          → 轮询到 state=completed
```

贴图面同理:`create_pin(images:[...])` → `set_pin_status(pinId,"pending")` →
`sync_pin_to_wechat` → `get_distribute_job`。

**产出恒落草稿**:全链路没有任何一步会直接发布;发布只走第 7 步的人工通道。

## 三、剧本的跑批与判据

- **每批必跑**:B3(关站内入口)~B8(删干净)每一批 PR 合入后跑一遍全七步。
- **贴图组**:文章闭环之外,另跑一组贴图闭环(建贴图 → 补图 → 验收 → 同步 → 草稿箱),
  确认贴图面也没掉链子。
- **判据**:七步全过 + 贴图组全过 = 该批可合;任一步断 → 该批**不得合**,先修再跑。
- **留痕**:跑批记录(时间、稿 slug、jobId、失败步与现象)追加在本文件末尾「跑批记录」。

## 四、熔断与回滚

站内创作能力下线后,任一环节出问题且短期修不好:

1. 把 site_config 的 kv `creation.agent_enabled` 置回 `true` —— 站内生成入口恢复
   (页面上的旧按钮分支代码在 B4 删除前一直保留)。
2. 内容供给断档的兜底:线下闭环照旧跑,只是人工发布节奏变慢;SEO 是生命线,
   若新增原创篇数低于既定阈值,同样先熔断回站内。

## 五、跑批记录

| 日期 | 批次 | 结果 | 备注 |
| --- | --- | --- | --- |
| 2026-11-15 | B1/B2 合入后首跑 | 待填 | 见 PR #244 |
