# 编辑器 AI 化实现方案(agent 对话改稿 + diff 评审 + 自动保存)

> 2026-10-12 立项(M27):M26 专题文档 compose 初稿的人工定稿效率工程。用户定调「编辑全流程系统内闭环」——侧边栏 deepagents 对话改稿、局部修改以类 VSCode 的 diff 过程呈现、编辑器自动保存。三块地基已在:编辑主面 Vditor(M5-d `MdEditor.tsx`)/ `read_post` 工具(`src/lib/agent/tools.ts`)/ ask_user HITL 往返(deepagents interrupt + PR #65 三件守卫)。方案锚回管线 [topic-pipeline-plan.md](topic-pipeline-plan.md),里程碑 **M27**([development-plan.md](development-plan.md))。建议 M26 后启动(首个吃红利场景 = compose 初稿修订),无硬依赖。

## 1. 背景与目标

**现状**:编辑主面 MdEditor(Vditor dynamic 封装,截图粘贴直传 + 微信码点计数)手动保存走 `PUT /api/posts/[id]`;agent 侧有 `read_post`(**仅 PUBLISHED 可读**,超长截断)与 `ask_user`(HITL interrupt 往返已稳)。

**目标**:

1. **对话改稿**:编辑页打开 Drawer 即注入编辑上下文,对 agent 说「第二段展开,按我的口径」即可获改稿提案
2. **diff 评审**:提案以 chunk 级 diff 呈现,逐块接受/拒绝,接受后写回编辑器
3. **自动保存**:debounce 落库 + 乐观锁 + 崩溃恢复——**兼作 agent 读一致性的前提**(DB ≈ 屏幕,agent 读不到陈旧稿)

## 2. 总体架构(核心原则:提案不落笔)

agent 工具只出提案,**写库永远 = 人点「接受」→ 既有 `PUT /api/posts/[id]`**(admin 会话)。agent 无独立写凭据,权限边界与「PAT 拒绝 mutation」惯例同构。

```
admin 编辑页打开 → Drawer 注入编辑上下文(postId / 标题 / 草稿态)
      ↓ 对话:「第二段展开,按我的口径」
agent(服务端)→ propose_edits 工具 → HITL interrupt 挂起
      ↓ 提案(S/R 块 / 整档重写)随 SSE 流到客户端
diff 评审面(@codemirror/merge,chunk 级 accept/reject)
      ↓ 接受 → 应用器写回 Vditor(保 undo 栈)
自动保存(debounce PUT)→ DB;agent 下一轮 read_draft 即最新
      ↓ 拒绝(可带评语)→ resume 回流,agent 可继续迭代(ask_user 同款)
```

**编辑面与评审面分离**:编辑体验零回归(Vditor 不换、不动);diff 是叠加的评审层。Vditor 本身无 diff/merge 能力(定位是编辑不是评审),故评审在独立面完成,接受后整段写回。

## 3. agent 工具面

- **`propose_edits`(admin-only,zod 双档契约)**:
  - 档一 局部修改:`edits[]: { oldString, newString, note? }`——Claude Code Edit 工具语义(oldString 须原文唯一命中;多块按序应用;note = 改动意图,评审面展示用)
  - 档二 整档重写:`{ contentMd, note }`——大改意图(「按公众号风重写全文」),客户端整档 diff 出 chunk
  - 工具端**不写库**,返回结构化提案即 interrupt 点(HITL interrupt 清单在 ask_user 之外扩 propose_edits);客户端评审结果 resume 回流,拒绝带评语时 agent 可再提案
- **`read_draft`(admin-only)**:读任意状态文章 `{title, contentMd}`(截断沿用 `TOOL_BODY_MAX`)——现 `read_post` 仅 PUBLISHED,编辑场景必须能读草稿;不新开公共读面,纯 admin 身份工具
- **工具按身份注册**:现 `agent.ts` `createDeepAgent({ tools: AGENT_TOOLS })` 单图按模型 key 缓存,工具不分公司——拆 admin 工具段后,**graph 缓存键加身份档**(model key + identity class),防编辑工具泄入游客/用户会话
- **编辑上下文注入**:编辑页打开 Drawer 时客户端带当前 postId + 标题(会话上下文/chip);自动保存保证 DB≈屏幕,残余漂移窗口 2-3s 可接受

## 4. diff 评审面(@codemirror/merge,选型定稿)

| 方案 | 结论 |
|---|---|
| **@codemirror/merge(MIT)** | **定稿**:chunk 级 accept/reject 内建、markdown 高亮免费、体积 ~百 KB 级 |
| Monaco DiffEditor(MIT) | 最像 VSCode 但 3-4MB 重、主题适配费劲,杀鸡用牛刀,排除 |
| jsdiff/diff-match-patch 自绘(GitHub PR 式 hunk 列表) | 完全可控贴终端风,但自定义代码量最大;留作 CM merge 不可用时的备选 |

- 交互:提案到达 → 评审模态(原文/提案对照)→ 逐 chunk 接受/拒绝/全部接受 → 应用器生成新全文
- **应用器语义**:edits 档逐块定位(精确匹配 → diff-match-patch 模糊兜底 → 未命中标「未能定位,请手动处理」不阻塞其他块);rewrite 档整档 diff
- **Vditor 写回 spike(批③ 首项,半天级)**:整段写回后 undo 栈行为验证;若 undo 不可跨写回边界,接受「评审写回后 undo 从此处重新起算」并在界面明示(降级口径,先记后验)
- 样式对齐 DESIGN-SPEC 终端风 token

## 5. 自动保存(无轮子,~百行 in-house)

- debounce 2-3s → `PUT /api/posts/[id]`(**仅 draft 文**;published 文保持既有手动口径不动)
- `updatedAt` 乐观锁:请求携带加载时刻的 updatedAt,冲突 409 → 「文章已在其他端被修改」人话提示,不强覆盖
- localStorage 影子副本(postId 键,保存成功即清):崩溃/断网后恢复提示
- 「已保存 HH:MM / 保存中…」角标;微信码点计数既有逻辑复用
- 协同效应:自动保存是 `read_draft` 读到「≈屏幕状态」的前提,两者同批交付

## 6. 数据与 API

- **v1 零新表**:提案不落库(评审状态在客户端);版本历史 `post_revision` 表留后续评审(v1 diff 基准 = 客户端持有的 loaded 文本)
- API:复用 `PUT /api/posts/[id]`(乐观锁字段扩可选入参);agent 工具走既有 agent run/SSE 通道,不新增 REST 路由

## 7. 安全与权限

- `propose_edits`/`read_draft` 仅 admin 身份注册;游客/用户 FAB 工具面零变化
- 提案随 SSE 下发,服务端持久层零落;日志记事件(edit_proposed/accepted/rejected + postId)不记正文
- 写路径仍 admin 会话 + Origin 校验(既有);agent 无独立写凭据(§2 原则)

## 8. 非目标(v1 明确不做)

- `post_revision` 版本历史 / 时间线回滚
- 多人协同编辑(CRDT/Yjs)
- 移动端编辑体验优化
- Vditor 所见即所得模式切换(WYSIWYG 化)
- agent 直接发布 / 直接推公众号(定稿与发布永远人工)
- 编辑工具全站 FAB 泛化(仅 admin 文章编辑页启用)

## 9. 实施分批

| 批 | 内容 | 出口 |
|---|---|---|
| 批① 自动保存 + 编辑上下文 | autosave(debounce PUT/乐观锁/localStorage/角标)+ 编辑页 Drawer 上下文注入 + e2e 扩 | `make check` + 人工验收 |
| 批② propose_edits 与提案流 | 工具 zod 契约(双档)+ admin-only 注册与 HITL interrupt/回流 + 客户端提案卡与应用器(精确 → 模糊 → 未定位降级)+ 单测(graph 缓存键身份档 **已随 M27 批④ compose 工具提前落地**,`agentToolsFor/agentSystemPrompt` 收口,本批直接挂新工具)| `make check` |
| 批③ diff 评审面 | @codemirror/merge 评审模态 + chunk 接受/拒绝 + Vditor 写回 spike(undo)+ 终端风样式 | 人工验收(undo/降级路径) |
| 批④ 收口 | 全链真机(见 §10)+ 文档收口(arch/04 §3 工具清单、arch/06、本表)+ PR 合 develop + 生产部署 | 真机全链走通 |

## 10. 验收标准

- **真机全链**:M26 compose 初稿 → 对话修订 → 提案卡 → diff 评审逐 chunk 接受 → Vditor 更新且 undo 可回退 → autosave 落库(角标)→ 发布 → 公众号草箱
- **拒绝零副作用**:拒绝后内容零变化(提案不落笔断言);带评语拒绝后 agent 可继续修订
- **降级路径**:未定位 S/R 块不阻塞其他块;乐观锁 409 人话提示;localStorage 恢复提示可唤起
- **权限**:游客/用户会话工具清单无 `propose_edits`/`read_draft`
- `make check` 全绿;e2e 零真 LLM(提案流用 fixture 提案,同 M25「真触发不入 e2e」口径)

**风险注记**:ask_user 的 MiniMax 触发率已知风险(M22 记录)不同传——propose_edits 的 interrupt 是工具配置点,不依赖模型主动询问;但「带评语拒绝后 agent 自主继续」依赖 resume 行为,批② 真机验证。

**状态:方案定稿(2026-10-12),待开发;建议 M26 专题管线后启动。** 状态流转对齐 [development-plan.md](development-plan.md) §5 维护约定。
