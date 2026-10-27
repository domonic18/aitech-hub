# 小红书自动发布·系统设计文档(M49 批X3 设计定稿)

> 状态:定稿落码(2026-10-26 用户逐条确认:标题/正文自动截断;复制发布文案随人工流程删除;人工流程与附属工程文件全拆,配置界面 Cookie 导入为登录态唯一入口)
> 前置:M49 批X1'(贴图渠道化)已并入 #167;本文档替代 plan M49 行中 X3 相关表述

---

## 1. 问题定义

### 1.1 我们要自动化什么

管理员在创作中心产出一篇贴图(pin:标题≤32字 + 轻文字 + 图片序列)后,希望将同一内容同步发布到小红书。当前流程:复制标题/轻文字 → 手动到创作平台上传图片/粘贴文案 → 发布 → 手动回填链接。共 5 步人工操作,目标压缩到 1 步(点一个按钮)。

### 1.2 平台约束(调研实证)

小红书**没有发布笔记的官方 API**(open.xiaohongshu.com 为电商/商家向)。可行路径仅:
- **创作平台网页自动化**(Playwright 驱动 creator.xiaohongshu.com):违反 ToS,但个人号低频使用,风控风险可控
- **移动端 API 逆向**(签名算法):猫鼠游戏,极不稳定,不可取
- **agora 一键分享**:唤起 App 人工确认,无法完全自动

本设计选**创作平台网页自动化**——与系统内 douyin-gateway(Playwright 驱动抖音)架构先例同构。

### 1.3 前置条件

- 管理员拥有小红书创作平台账号(个人号即可)
- 首次使用需人工登录一次(验证码/扫码),登录态落盘持久化
- Cookie 过期(数周~数月)后需重登续期

---

## 2. 架构:三层职责

```
┌─────────────────────────────────────────────────┐
│ 触发层(MetaPanel)                               │
│   「一键发布到小红书」按钮                        │
│   → 创建渠道行(pending)+ 入队发布 job           │
├─────────────────────────────────────────────────┤
│ 发布层(douyin-gateway 新增 XHS 模块)            │
│   Playwright 驱动创作平台发布流程               │
│   cookie 登录态(storage_state JSON 卷持久化)    │
│   → 成功:synced + 笔记链接                     │
│   → 失败:failed + 人话 lastError(可重新发布)   │
├─────────────────────────────────────────────────┤
│ 状态层(MetaPanel + PinDetailDrawer 渠道行)      │
│   实时显示状态/尝试次数/错误/笔记链接            │
│   终态失败提供「重新发布」入口(无人工回填)      │
└─────────────────────────────────────────────────┘
```

### 2.1 宿主选择:douyin-gateway 扩职责(用户已拍板)

- **已有**:Playwright chromium(async)+ FastAPI + 内网 only
- **新增**:XHS 发布模块(app/xhs/publisher.py)——独立 Playwright context,不与抖音签名共享浏览器实例
- **compose**:gateway 挂 `workspace/xhs-state`(登录态 rw)+ `workspace/media`(图片 ro)
- **不建新 sidecar**:省一个容器/镜像/部署链;职责重新定义为「浏览器自动化网关」

---

## 3. 状态机(渠道行生命周期)

```
              ┌──────────┐
  点一键发布  │  pending  │  worker 接单,准备执行
  ──────────→ │ (已入队)  │
              └─────┬─────┘
                    │ worker 开始执行
                    ▼
              ┌──────────┐
              │ publishing│  Playwright 操作中(约 30-60s)
              │ (发布中)  │
              └─────┬─────┘
                    │
            ┌───────┼───────┐
            ▼       ▼       ▼
       ┌────────┐ ┌──────┐ ┌────────┐
       │ synced │ │failed│ │ pending│  ← 超时/重试回到 pending
       │(已同步)│ │(失败)│ │(重试中)│
       └────────┘ └──┬───┘ └────────┘
                     │
                     ▼
              修正原因后重新发布
       (MetaPanel 「重新发布」按钮,
        如重配 Cookie 后再发起)
```

### 3.1 状态枚举

| 状态 | 含义 | 触发 | 退出条件 |
|---|---|---|---|
| pending | 已入队,worker 待处理 | 用户点一键发布 | worker 开始执行 |
| publishing | Playwright 操作中 | worker 开始执行 | 发布成功/失败 |
| synced | 发布成功,链接已回填 | Playwright 提交成功 | 终态 |
| failed | 发布失败,lastError 人话 | Playwright 超时/异常 | 用户点「重新发布」→ pending |

### 3.2 幂等与并发

- 渠道行唯一键:`pinId × channel` → 同一贴图同一渠道只有一行
- BullMQ job 去重:jobId = `xhs-auto-{pinId}-{timestamp}`,重复点击不会重复入队(渠道行已存在时前置拦截)
- 并发控制:QUEUE_DISTRIBUTE_XHS concurrency=1,同一时间只有一个发布 job 在跑

---

## 4. 韧性模式(系统性回答你的问题 2-4)

### 4.1 自动重试

- BullMQ `attempts: 3, backoff: { type: 'exponential', delay: 30_000 }`
- 第 1 次失败 → 30s 后重试 → 第 2 次失败 → 60s 后重试 → 第 3 次失败 → 标记 failed
- 重试期间渠道行状态回 pending(界面可见「重试中」)
- 第 3 次失败后行变 failed,界面出现「重新发布」按钮(修正原因后手动重新入队)

### 4.2 指数退避

BullMQ `backoff.type: 'exponential'` 内建支持,`delay: 30_000` 为初始间隔。
实际间隔 = delay × 2^(attempt - 1):30s → 60s → 120s。

### 4.3 界面「重新发布」按钮

MetaPanel 小红书区,状态为 failed 时显示「重新发布」按钮:复位渠道行
pending + 重新入队(复用同一分发路由)。适合按 lastError 修正原因后的再次发起。

### 4.4 终态失败处理(无人工回填)

自动发布连续 3 次失败后行终态 failed。系统**不提供人工发布/链接回填旁路**
(用户裁定:操作统一性优先,人工双轨徒增维护面)。用户按 lastError 修正
原因后点「重新发布」:
- 登录态失效 → 分发中心渠道卡重贴 Cookie → 重新发布
- 平台改版/选择器漂移 → 修选择器发版 → 重新发布
- 瞬态抖动 → 自动重试大概率已覆盖;仍失败直接重新发布

---

## 5. 登录态管理

### 5.1 生命周期

```
首次使用:后台分发中心 → 小红书渠道卡「配置」→ 弹窗粘贴 F12 Cookie 请求头
         → gateway 验证登录 → storage_state JSON 落盘(workspace/xhs-state/)
              │
 Cookie 过期 ← 定期使用,无额外操作
              │
 过期后:发布失败 → 渠道行 lastError「登录态失效,请到分发中心重新配置」
              → 管理员重贴 Cookie → 「重新发布」即恢复
```

### 5.2 录入方式(唯一)

配置界面 Cookie 导入(与公众号/抖音渠道卡同款「配置→弹窗」交互):浏览器
F12 复制完整 Cookie 请求头 → 粘贴保存 → gateway 解析 name=value(域按
.xiaohongshu.com 补全)→ 访问创作平台验证登录 → 落 storage_state。
scripts/xhs_login.py 有头登录脚本已删除(用户裁定:配置界面为唯一入口,
仓库不出登录脚本)。

### 5.3 过期检测

- 发布失败时,Playwright 检测到跳转至 /login → lastError =「登录态失效,请到后台分发中心重新配置 Cookie」
- MetaPanel 小红书区 lastError 红字显示
- 不做周期性主动探针(避免无谓请求触发风控),发布时被动检测;/xhs/state 探针供配置弹窗保存前后即时核验

---

## 6. 发布流程(Playwright 详细步骤)

```
1. 加载 storage_state → new_context
2. goto creator.xiaohongshu.com/publish/publish
3. 等待页面稳定(3s)→ 检查 URL 不含 login
4. 确认当前 tab 为「上传图文」(非视频)
5. set_input_files 批量上传全部图片(数组直传,「N/18」计数实测;轮询到齐再进下一步)
6. 等待上传完成(缩略图出现)
7. 填写标题(.d-text,超 20 字自动截断——用户裁定)
8. 填写正文(.ql-editor,超 1000 字自动截断——用户裁定)
9. 点击发布(.publishBtn)
10. 等待跳转/成功提示
11. 尽力抓取笔记链接(抓不到留空;笔记已发布,系统记录不受影响)
12. 关闭 context(storage_state 如有刷新则回写)
```

### 6.1 已知脆弱点

| 步骤 | 脆弱原因 | 缓解 |
|---|---|---|
| 4. tab 切换 | .creator-tab 类名可能改版 | 加 try/catch,输出当前可见 tab 列表辅助调试 |
| 5. 上传 | 计数未到齐就点发布会被平台禁用发布钮 | 批量数组直传 + 「N/18」计数轮询到齐(2026-10-27 实测)|
| 7. 标题输入 | .d-text 类名可能改版 | 改用 placeholder 定位兜底 |
| 8. 正文输入 | .ql-editor 类名可能改版 | 改用 contenteditable 定位兜底 |
| 9. 发布按钮 | .publishBtn 类名可能改版 | 改用 text=发布 定位兜底 |
| 11. 链接抓取 | 成功页面结构可能不同 | 尽力抓取,抓不到留空人工补 |

### 6.2 适配 Runbook(平台改版标准处理流)

发布链路已步骤化(批X3'):每步统一日志(`xhs.step_*`,带 pin_id/耗时/
URL),任一步失败自动落现场快照——`workspace/xhs-state/debug/<时间戳>_<步骤>/`
(video + 截图 + DOM + URL,滚动保留最近 5 份)。改版处理流:

1. 看渠道行 lastError——格式 `小红书发布失败[步骤名]: 人话(现场已存 …)`,直接打开对应快照目录
2. 看 flow.webm / page.png / page.html,定位失效的选择器或坐标
3. 只改 `xhs/settings.py`(SELECTORS / 节奏常量 / PUBLISH_CLICK_*),不动流程
4. `/xhs/state` 探针验证地标(creator_tab 计数、publish_bar 宿主在否),再实弹「重新发布」
5. 快照目录未生成 → 失败在浏览器外(登录态/浏览器未启动),按 lastError 的 login/browser 类处理

错误分类:`login`(重配 Cookie)/ `selector`(改选择器)/ `upload` /
`click` / `success_signal`(素材校验被拒,如图片 <720P)/ `unknown`(看快照)。
节奏参数为**纯代码常量不入 env**(用户裁定:调参=改码发版,防环境漂移);
发布按钮坐标依赖 viewport 钉死 1280×720。

---

## 7. 组成文件清单

| 文件 | 职责 |
|---|---|
| services/douyin-gateway/app/xhs/publisher.py | Playwright 发布流程(步骤化:统一步骤日志/失败快照/视频) |
| services/douyin-gateway/app/xhs/settings.py | 选择器与节奏常量(纯代码,不入 env)+ env 字段 |
| services/douyin-gateway/app/xhs/support.py | 错误分类 + XhsStepError + 失败现场快照 |
| src/lib/pins/xhs.ts | 系统侧:入队/渠道行落账/attempts 单点计数 |
| src/app/api/pins/[id]/xhs/distribute/route.ts | 发布触发/重新发布路由(唯一入口) |
| src/app/api/distribute/xiaohongshu/cookies/route.ts | Cookie 录入路由 |
| src/app/api/distribute/xiaohongshu/state/route.ts | 登录态探针路由 |
| src/components/admin/pins/MetaPanel.tsx | 触发按钮+状态+重试+降级 UI |
| src/components/admin/pins/PinDetailDrawer.tsx | 渠道行状态展示 |
| docker-compose.prod.yml | gateway 卷挂载(xhs-state + media) |

---

## 8. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| 小红书风控/封号 | 低(个人号低频) | 高 | 限定站长个人号,日发布≤3 篇,避开密集时段 |
| creator 平台改版致选择器失效 | 中 | 中 | 失败人话 lastError→人工降级;月度探针验证 |
| cookie 过期发布中断 | 高(数周) | 低 | 失败人话提示续期;续期后重试即恢复 |
| 服务器 IP 与登录 IP 不一致 | 中 | 低 | Cookie 取自管理员本机浏览器,服务器使用时 IP 不同——低频可接受;若触发风控,在同网络环境登录后导出 Cookie 重贴 |
| 图片物料跨容器不可达/空字节 | 已发生×2 | 中 | **字节下发 {name,dataB64}**(worker 经 mediaStorage.get 读桶,base64 过内网,gateway 零密钥)——「同卷同路径」缓解已被生产证伪(MEDIA_STORAGE=cos 后新图只在桶里,2026-10-27 实收 No such file);字节化后又实收字段名错位(worker 发 dataB64/网关读 data → 全部落 0 字节文件,平台静默忽略,上传假通过),现网关/步骤双闸拒空字节(decode_publish_images + upload_images 前置检查) |

---

## 9. 决策点(全部定稿,2026-10-26)

| # | 决策 | 定稿 |
|---|---|---|
| 1 | 发布通道 | Playwright 网页自动化(不逆向 API) |
| 2 | 登录态录入 | 唯一入口 = 配置界面 Cookie 导入;xhs_login.py 已删除 |
| 3 | 失败处理 | 自动重试 3 次(指数退避)→ 终态 failed 界面「重新发布」;无人工回填 |
| 4 | 超长物料 | 标题截 20 字 / 正文截 1000 字(gateway 发布前自动截断) |
| 5 | 载体 | 贴图 = 小红书笔记载体(非新增);文章零小红书入口 |
| 6 | 发布频率 | 日 ≤3 篇(操作纪律,不做代码强制) |
