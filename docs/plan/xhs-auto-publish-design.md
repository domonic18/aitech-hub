# 小红书自动发布·系统设计文档(M49 批X3 设计定稿)

> 状态:设计审稿(待用户逐条确认后开工)
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
│   → 失败:failed + 人话 lastError(降级人工)     │
├─────────────────────────────────────────────────┤
│ 状态层(MetaPanel + PinDetailDrawer 渠道行)      │
│   实时显示状态/尝试次数/错误/笔记链接            │
│   失败时提供「重试」和「降级人工回填」双入口      │
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
              人工修正后可重试
         (MetaPanel 「重试」按钮
          或降级「人工回填链接」)
```

### 3.1 状态枚举

| 状态 | 含义 | 触发 | 退出条件 |
|---|---|---|---|
| pending | 已入队,worker 待处理 | 用户点一键发布 | worker 开始执行 |
| publishing | Playwright 操作中 | worker 开始执行 | 发布成功/失败 |
| synced | 发布成功,链接已回填 | Playwright 提交成功 | 终态 |
| failed | 发布失败,lastError 人话 | Playwright 超时/异常 | 用户点重试 → pending |

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
- 第 3 次失败后行变 failed,界面出现「重试」按钮(用户手动触发)和「降级人工回填」入口

### 4.2 指数退避

BullMQ `backoff.type: 'exponential'` 内建支持,`delay: 30_000` 为初始间隔。
实际间隔 = delay × 2^(attempt - 1):30s → 60s → 120s。

### 4.3 界面重试按钮

MetaPanel 小红书区,状态为 failed 时显示:
- 「重试自动发布」按钮 → 重置渠道行 pending + 重新入队
- 「切换人工回填」按钮 → 显示回填输入框(降级路径)

### 4.4 降级路径

如果自动发布连续 3 次失败,渠道行最终 failed。此时用户有两条路:
1. **点重试**:适合瞬态错误(网络抖动/页面加载慢)
2. **降级人工回填**:适合持久错误(登录态失效/平台改版)——复制物料 → 手动发布 → 回填链接

两种路径的 UI 入口都在 MetaPanel 小红书区并排展示,用户按错误信息自行选择。

---

## 5. 登录态管理

### 5.1 生命周期

```
首次使用:本地有头浏览器人工登录(scripts/xhs_login.py)
         → storage_state JSON 落盘(workspace/xhs-state/)
         → gateway 容器卷挂载自动读取
              │
 Cookie 过期 ← 定期使用,无额外操作
              │
 过期后:发布失败 → 渠道行 lastError「登录态失效」
              → 管理员重跑 xhs_login.py 续期
```

### 5.2 两种录入方式(并存,用户选其一)

| 方式 | 操作 | 适用场景 |
|---|---|---|
| storage_state 脚本 | 本机跑 `xhs_login.py` → 浏览器弹出 → 人工登录 → 自动落盘 | 本地开发/测试 |
| 手动贴 Cookie | 浏览器 F12 复制 Cookie 请求头 → 管理界面粘贴 → gateway 验证+落盘 | 生产服务器远程操作 |

两者最终都生成 Playwright storage_state JSON,存 workspace/xhs-state/ 卷。

### 5.3 过期检测

- 发布失败时,Playwright 检测到跳转至 /login → lastError =「登录态失效,请重跑 xhs_login 续期」
- MetaPanel 小红书区 lastError 红字显示
- 不做主动探针(避免无谓请求触发风控),仅在发布时被动检测

---

## 6. 发布流程(Playwright 详细步骤)

```
1. 加载 storage_state → new_context
2. goto creator.xiaohongshu.com/publish/publish
3. 等待页面稳定(3s)→ 检查 URL 不含 login
4. 确认当前 tab 为「上传图文」(非视频)
5. set_input_files 上传图片(首张=封面)
6. 等待上传完成(缩略图出现)
7. 填写标题(.d-text,≤20 字)
8. 填写正文(.ql-editor,≤1000 字)
9. 点击发布(.publishBtn)
10. 等待跳转/成功提示
11. 尽力抓取笔记链接(抓不到留空,人工补)
12. 关闭 context(storage_state 如有刷新则回写)
```

### 6.1 已知脆弱点

| 步骤 | 脆弱原因 | 缓解 |
|---|---|---|
| 4. tab 切换 | .creator-tab 类名可能改版 | 加 try/catch,输出当前可见 tab 列表辅助调试 |
| 5. 上传 | .upload-input 可能不含 multiple 属性 | 先传首张,多图需逐张(平台「继续添加」)|
| 7. 标题输入 | .d-text 类名可能改版 | 改用 placeholder 定位兜底 |
| 8. 正文输入 | .ql-editor 类名可能改版 | 改用 contenteditable 定位兜底 |
| 9. 发布按钮 | .publishBtn 类名可能改版 | 改用 text=发布 定位兜底 |
| 11. 链接抓取 | 成功页面结构可能不同 | 尽力抓取,抓不到留空人工补 |

### 6.2 选择器维护策略

- 每个选择器定义集中在 xhs/settings.py 的 SELECTORS 常量字典(非散落在代码中)
- 选择器失效时,渠道行 lastError 包含失败步骤名,辅助定位
- 定期(月度)用 /xhs/state 探针验证登录态与页面结构

---

## 7. 组成文件清单

| 文件 | 职责 |
|---|---|
| services/douyin-gateway/app/xhs/publisher.py | Playwright 发布流程(本文件核心) |
| services/douyin-gateway/app/xhs/settings.py | 运行参数(env 前缀 XHS_) |
| services/douyin-gateway/scripts/xhs_login.py | 有头登录态生成脚本(管理员本机跑) |
| src/lib/pins/xhs.ts | 系统侧:入队/渠道行落账/回填 |
| src/app/api/pins/[id]/xhs/distribute/route.ts | 触发路由 |
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
| 服务器 IP 与登录 IP 不一致 | 中 | 低 | 登录态在本地生成,175 使用时 IP 不同——低频可接受;若触发风控改为 175 上有头登录 |
| 图片路径容器间不一致 | 低 | 中 | worker 与 gateway 挂同一 media 卷到同路径,已对齐 |

---

## 9. 待用户确认的决策点

| # | 决策 | 我的建议 | 备选 |
|---|---|---|---|
| 1 | 发布通道:Playwright 网页自动化 vs XHS API 逆向 | Playwright(贴近人工,不碰签名逆向) | API 逆向(更脆弱) |
| 2 | 登录态录入:storage_state 脚本 vs 手动贴 Cookie | 两者并存(脚本=本地,贴 Cookie=远程) | 只保留一种 |
| 3 | 自动发布失败降级:自动重试 3 次 → 人工回填 | 3 次指数退避后降级 | 更多/更少次数 |
| 4 | 发布频率:日上限 | ≤3 篇(个人号安全) | 不限 |
| 5 | 贴图 = 小红书笔记载体(非新增) | ✅ 已定稿 | — |
| 6 | 文章列表零小红书入口 | ✅ 已定稿 | — |
