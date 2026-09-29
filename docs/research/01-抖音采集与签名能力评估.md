# 调研:Node 全栈下的抖音采集与签名能力评估

> 背景:二期 AI 资讯/视频管道需要爬取抖音视频,而抖音有严格签名机制(a_bogus / verifyFp / msToken / x-secsdk-web-signature)。
> 现有资产:`ai-invest-assisstant` 已稳定解决该问题(Python 栈)。本文回答:**改用 Next.js 全栈单体后,该能力是否仍可支撑、以何种形态落地**。
> 调研日期:2026-09-29。状态:结论已定,二期立项时直接引用本文。

## 1. 结论(TL;DR)

**Node 栈完全支撑,且不需要重写签名逻辑。** 推荐路线:

> **保留 ai-invest-assisstant 的 Python signer sidecar 原样复用**,以 compose 内部服务(signer 容器)形态接入 aitech-hub,Node worker(BullMQ `crawler` 队列)通过内网 HTTP `POST /sign` 取签名参数。纯算降级路线二期按需再评估。

核心理由一句话:**这套方案的本质是"让抖音自己的页面 SDK 在真实浏览器里完成签名",签名智慧活在浏览器内的 JS(脚本钩子 + SDK 字节码)里,Python 只是"司机"——把司机从 Python 换成 Node 没有收益,把浏览器换掉才有风险。**

## 2. 问题定义:抖音签名为什么难

- 抖音 Web API 请求必须携带 `a_bogus`(早期为 `X-Bogus`)、`msToken`、`verifyFp` 等参数,由页面加载的 SDK 在浏览器内生成。
- SDK 算法运行在 **JSVMP 字节码虚拟机**内(混淆 + 环境检测),且**没有可直接调用的签名函数**——它 patch 的是 `window.fetch` / `XMLHttpRequest.prototype.open`,在**传输层**对 URL 完成签名。
- 社区共识(本次调研再次印证):**纯算法复刻(纯算)易碎**,平台灰度期参数集与算法版本频繁变化;**浏览器承载 + RPC/捕获式方案降级最优雅**。

## 3. 现有资产盘点(ai-invest-assisstant,已验证可用)

| 层 | 位置 | 形态 | 与运行时的耦合 |
|----|------|------|----------------|
| 签名服务(主) | `docker/signer/Dockerfile` + `backend/app/signer/main.py` | Playwright chromium 常驻页 + FastAPI `POST /sign`(内网无鉴权,/health 探活) | 无:HTTP 面,任何语言可调用 |
| 捕获钩子(核心) | `backend/app/signer/shim.py` | `CAPTURE_INIT_SCRIPT` + `SIGN_SCRIPT`,patch fetch/XHR 捕获 SDK 重写后的 URL,**差集返回新增参数**(不硬编码参数集,灰度免疫) | **纯 JS 字符串**,在浏览器内执行 |
| 静态算法(降级) | `backend/app/adapters/douyin/signing.py` | 自研移植 f2 的 a_bogus 纯算(SM3 内联),单点跟版 | 无:纯函数,可移植 |
| 双轨客户端 | `signer_client.py` + `transport.py` | sidecar 在线用 sidecar,失败/未配置回落纯算 | 调用方按 HTTP 结果切换 |

关键洞察:**三层里两层(钩子脚本、SDK 字节码)本来就是 JS 且运行在浏览器里;Python 侧只做了"浏览器生命周期管理 + 槽位管理 + HTTP 面"**。这与语言栈无关。

## 4. 生态调研结果(2026-09)

### 4.1 Python 侧(参考项目现状)

| 项目 | 状态 | 对本决策的意义 |
|------|------|----------------|
| [Evil0ctal/Douyin_TikTok_Download_API](https://github.com/Evil0ctal/Douyin_TikTok_Download_API) | 活跃(2026),FastAPI + REST/MCP + Docker,自带 Python a_bogus 与身份池 | 现有 signer 的 cloak 即改编自它;仍是最佳上游参照 |
| [Johnserf-Seed/f2](https://github.com/Johnserf-Seed/f2) | 活跃,a_bogus 算法参考实现 | 纯算路线的跟版源头(signing.py 的出处) |
| JoeanAmier/DouK-Downloader(TikTokDownloader) | 项目仍更新,但**官方声明加密参数算法不再维护**(合规原因,需用户自备) | 重要信号:**纯算跟版负担之重,连头部项目都主动卸掉了**——不建自建纯算主线 |

### 4.2 Node 侧(本项目的候选生态)

| 路线 | 代表 | 评估 |
|------|------|------|
| 社区 JS 纯算 | `ylcangel/a_bogus`(a_bogus / x-bogus / msToken,版本钉在 V 1.0.1.19-fix.01) | 可用作降级件,但**无权威 npm 包**、社区维护、跟版滞后于平台灰度——只配当 fallback |
| 补环境(在 Node 里跑 SDK 字节码 + 伪造浏览器环境) | 看雪/知乎多篇逆向文(haloowhite bdms_1.0.1.19_fix 等) | 工程量与脆弱度双高:环境检测对抗无止境,平台一改即碎;**明确不推荐** |
| 浏览器承载 + Node 调用(Playwright / Sekiro-RPC 式) | 社区公认的稳态模式;Playwright 本身是 Node 原生库 | 与现有方案同构,Node 侧完全可行 |

## 5. 三条落地路线对比

| | A. 复用 Python signer sidecar(推荐) | B. Node 原生重写 Playwright signer | C. TS 纯算移植 |
|--|--|--|--|
| 正确性风险 | 零:已实战验证的代码原样搬运 | 中:需重实现槽位管理/ready 探测/暖页策略 | 高:纯算天然易碎 + 移植等价性验证成本 |
| 跟版成本 | 集中一处(shim 差集式返回,灰度免疫) | 同 A(逻辑相同)但双仓同步 | 每次平台变更都要重新逆向 |
| 语言纯度 | 破例引入一个 Python 容器 | 全 Node | 全 Node |
| 部署成本 | compose 多一个服务(镜像已在跑,照搬) | 新镜像 | 无 |
| 与 WAF 固定出口等运维事实的兼容 | 直接继承(固定出口 IP、常驻页驻留策略原样保留) | 需重新验证 | 无浏览器,出口策略需另建 |

**决策:A 为主路线。** B 在"团队长期只维护 Node"成为实际痛点时可再立项,且届时 A 的 shim 脚本可整体平移(它们就是 JS 字符串)。C 仅作为 sidecar 不可用时的应急降级,二期视需要从 `signing.py` 做字节级 TS 移植(有单测对拍即可,不追社区包)。

## 6. 落地形态(二期立项时执行)

```
aitech-hub/
├─ signer/                  # 自 ai-invest-assisstant 平移:FastAPI + Playwright 捕获式签名服务
│  ├─ Dockerfile            #   python:3.11-slim + chromium(构建期走代理装 playwright)
│  └─ app/signer/           #   main.py + shim.py(单点跟版层)
└─ compose:worker ──HTTP──▶ signer:8010(内网,/sign + /health;不暴露公网)
```

- Node 侧:`worker/src/lib/signer-client.ts`(≈ sign + 静态降级开关,对应 transport.py 双轨思路,先只做 A 轨)
- 部署纪律沿用范例:signer 与 crawler worker 同 compose 网络、固定出口 IP(WAF 白名单)、常驻页不销毁
- 一期**不引入**该服务(M1~M6 不含),避免为未启动的能力付运维成本;二期资讯/视频管道立项时随首个 crawler 一起上
- Cookie/身份池:沿用范例的运营方式(独立账号池 + msToken 随 Cookie 走),不在应用库里存抖音凭证

## 7. 风险与跟版策略

| 风险 | 对策 |
|------|------|
| 平台灰度变更参数集 | shim 采用**差集返回**(SDK 加了什么就透传什么),不硬编码参数名,天然免疫大部分灰度 |
| 算法大版本更换(JVMP 更新) | 单点跟版层 = `shim.py` 一个文件;上游参照 Evil0ctal 仓库变更日志 |
| sidecar 崩溃/页失效 | `/health` + compose 重启策略;Node 侧熔断:连续失败暂停 crawler 队列并告警,不用纯算硬扛(纯算失败即风控) |
| 合规 | 仅采集用于站内资讯聚合的公开数据,控制频率;参照 DouK 停维护信号,签名代码不对外开源传播 |

## 8. 对现有文档的影响

- `plan/development-plan.md` 二期池「AI 资讯管道」技术预案更新为:Crawlee/BullMQ `crawler` 队列 + **signer sidecar 复用(本文)**
- 其余 arch 文档不受影响(一期范围内无爬虫组件)
