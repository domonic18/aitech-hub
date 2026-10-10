# 原型图设计规范(DESIGN-SPEC)

> 状态:v1.1(2026-10-02:品牌定稿「一起AI」+ 17 monogram logo 基线,原型同步 v0.5.0;初版 v1.0 随 2026-09-30 v0.4.0 定稿)。新增或修改 `docs/prototypes/*.html` 前必读;偏离本规范的实现一律视为缺陷。
> 范本:`ai-invest-assisstant` 仓(本机 `~/Code/ai_proj_agent/ai-invest-assisstant`,React + antd v5 管理端,原型见其 `docs/prototypes/`)——本项目的图标体系与后台组件形态均提炼自它,但**落地为纯 HTML 单文件**(零依赖、双击即开),不复刻其技术栈。

## 1. 定位与形态

- 原型是 M4/M5(前台/admin)与二期功能的**开发依据**(requirement 头部注记),不是草稿——字段、端点、状态形态都要能直接照抄进代码。
- **单文件自包含**:每页一个 HTML,内联 `<style>` 与 `<script>`;唯一外部引用是相对路径 `assets/*.jpg` 素材。禁止引入 CDN、npm 包、图标字体、外链 CSS/JS。
- 23 屏索引见 [index.html](index.html);新增屏必须同步 index 卡片(含分组、二期 tag、arch 引用),否则 CI 之外人工审不出断链。
- 版本号随批次升级 `v0.x.0`:改视觉体系升次版本(如 v0.4.0 图标体系),改单页内容升修订号。全部页面页脚 `PROTOTYPE v0.x.x` 与 index footer 同步。

## 2. 设计令牌(唯一真相源:common.css)

- 双主题 CSS 变量定义在 `common.css` `:root`(暗)与 `[data-theme="light"]`(亮)。**common.css 不被 link**——各页持有内联副本;改 token 先改 common.css,再同步所有页面(这是刻意的单文件自包含代价)。
- 核心令牌(暗/亮值见 common.css,此处禁自造色值):

| 令牌 | 用途 |
| --- | --- |
| `--bg` / `--panel` / `--border` | 页面底 / 卡片 / 描边 |
| `--text` / `--text-2` / `--text-3` | 主 / 次 / 弱三级文字 |
| `--accent`(Indigo #5e6ad2)/ `--accent-hover` / `--accent-dim` | 主色 / hover / 淡底(选中态、徽标底) |
| `--green` / `--red` / `--amber` / `--blue` + 各 `*-hi` | 语义色;`*-hi` 是深底小字号高可读变体 |
| `--font-sans`(Inter)/ `--font-mono`(SF Mono) | 正文 / 终端与数据 |
| `--r-sm`(6px)/ `--r-md`(8px)/ `--r-lg` | 圆角 |
| `--glow` / `--shadow-sm` / `--shadow-lg` | logo 光块 / 两级投影 |

- 红线:任何页面不得出现未走变量的裸色值(代码块深底语法色除外,那是「亮模式下终端窗保持深底」的既定设计);不得新增第三主题。主题默认**跟随系统** `prefers-color-scheme`,用户显式切换后固定(2026-10-04 定调,推翻旧「禁跟随系统」;站点实现见 `src/app/layout.tsx` 预置脚本)。

## 3. 版式

- 内容统一宽 `--site-max-w`(1152px)居中;前台 hero 控制台、电报流带、双栏网格与全局 header 内容**同宽对齐**,禁止某区块单独加宽/收窄。
- 双栏 Hub 仪表盘:`grid-template-columns: 1fr 360px; gap: 24px`(M5-e 已将布局壳前置至一期:hero + 博主文章区已上线;电报流/GitHub 区按「三区可独立降级」暂不渲染,二期接入)。
- admin 布局:左侧固定 sidebar(220px)+ 右侧 crumb 头 + 内容卡;页脚一行 `PROTOTYPE v0.x.x · 阶段 · ← 原型索引`。窄屏降级(M13):<1024 sidebar 抽屉化——顶栏 hamburger 呼出,遮罩/Esc/路由切换自闭;≥1024 固定常驻原样;z 阶梯 topbar(10)< 侧栏/遮罩(20)< 抽屉类(30)< DialogShell(50)。
- 字号阶梯克制:页面标题 22-28px,区块标题 14-16px,正文 13-14px,辅助 12px,角标 10-11px;行高 1.5-1.6。数据/路径/端点一律 `--font-mono`。
- 终端风口吻:前台区块头用 mono 命令行式($ ls -la /articles、$ tail -f /telegram),这是品牌语言,新页面延续。

## 4. SVG 图标体系(v0.4.0 起,禁 emoji)

- **来源**:antd icons-svg(MIT,与范本 @ant-design/icons 5.x 同源),viewBox `0 0 1024 1024`、`fill: currentColor`。不引入整个图标库,按页裁剪。
- **每页 sprite**:页面 `<body>` 顶部内联隐藏容器,且**必须带机器可识别的标记注释**(工具按注释定位合并):

```html
<!--iconsprite: i-search i-moon i-sun i-user ...-->
<svg xmlns="http://www.w3.org/2000/svg" style="display:none" aria-hidden="true">
  <symbol id="i-search" viewBox="0 0 1024 1024"><path d="..."/></symbol>
</svg>
```

- **引用**:`<svg class="ic" aria-hidden="true"><use href="#i-xxx"/></svg>`;尺寸类:`.ic` 14px(默认)/ `.ic-sm` 12px / `.ic-lg` 18px,`vertical-align` 已在 common.css 校准,禁止内联再调。
- **命名**:`i-` + antd 原名小写连字(如 `i-checkcircle`、`i-clouddownload`)。已知易错名:下载是 `i-clouddownload` 不是 i-download;播放是 `i-play-square`;没有 i-clockcircle / i-customer。
- **语义映射**(常用):主题=i-moon/i-sun;搜索=i-search;外链=i-export;视频=i-play-circle/i-videocamera;浏览=i-eye;评论=i-message;AI=i-robot/i-api;采集=i-cloud-download;渠道=i-apartment;博主=i-team;模型=i-database;用量=i-piechart;会话=i-comment;密钥=i-key;错误=i-fire/i-warning;成功=i-check-circle。
- **新增图标步骤**:从范本仓 `~/Code/ai_proj_agent/ai-invest-assisstant/web/node_modules/@ant-design/icons-svg/es/asn/<Name>.js` 复制 path → 追加 symbol → 同步 iconsprite 注释清单 → 截图验证。禁止手绘 path、禁止混用其他图标体系。
- **emoji 禁令**:UI 全域不得出现 emoji(包括表格、按钮、KPI、说明文字)。**保留字符白名单**(prose 箭头 / 终端 / 几何符号,属字体不算 emoji):`→ ← ↔ › ▸ ▾ ▲ ▼ ➜ > $ ⏎ ¥`。审查用全 Unicode emoji 区段正则扫 `\p{Emoji}` 并对照白名单。
- 默认头像一律 SVG 矢量(圆形 `--accent-dim` 底 + 人形剪影 symbol `#i-user` 或专用 `#avatar-default`);`assets/avatar.jpg` 仅允许在 admin-media 作为「媒体素材」语义出现。UI 位禁止位图头像与 onerror 兜底图。

## 5. 主题切换与交互基线

- **主题胶囊**:44×24 分段控件,左月右日两个 SVG 图标,滑块 200ms 滑动;`aria-pressed` + `title`;状态存 `localStorage("proto-theme")`(站点实现为 `ah-theme`),优先级:显式选择 > 系统偏好 > 亮色;无显式选择时实时跟随系统变化。全站唯一实现(在 common.css),禁止页内自造变体。
- **Logo(品牌「一起AI」,2026-10-02 定稿)**:17 monogram 芯片(圆角方块 `var(--accent)` 底 + mono 粗体「17」白字 + `--glow` 光)+ 名称「一起AI」+ 弱色 mono tld(前台 `17aitech.com`、admin `admin`);尺寸三档 26/22/32px(footer 24px),全站唯一形态(site header / admin sb-logo / index head),规格见 common.css §Logo;静态无闪烁,闪烁 caret 只允许出现在控制台输入框(site-home/site-search:原生 `caret-color: var(--accent)` + 镜像 ▍ 随输入移动)。站点口号:**一起,看懂 AI**。
- **favicon 同源(2026-10-09)**:`src/app/icon.svg`(「17」以 64 网格几何描边路径绘制,笔画 7/64,不依赖设备字体)+ `favicon.ico`(16/32/48 三档,16px 档笔画 9/64 加粗补偿)+ `apple-icon.png`(180 全出血直角,iOS 自带遮罩);三者为同一芯片设计的再生成,改芯片形态须三处同步。
- **站点 header**(唯一形态):左 logo;右 nav `首页 / 电报流 / 文章` + 搜索图标按钮 + 主题胶囊 + 头像下拉(SVG 头像 + caret;菜单:个人设置 → account.html、退出登录 → login.html;点外关闭 + Esc)。**归档/关于不放 header**,固定在 footer。
- **admin 侧栏 v2**(唯一形态,消除漂移;M8-M14 陆续点亮,现状以 `AdminSidebar.tsx` 为准):`OVERVIEW 站点统计·站点设置 / 内容管理 文章管理·媒体库·电报流治理 / 采集 采集总览·渠道配置·博主管理·GitHub 仓库 / AI 服务 模型配置·用量统计·会话管理(二期) / 用户 用户管理 / 系统 PAT 令牌`;底部 sb-foot「返回前台站点」。图标全 SVG,禁占位项。
- 可交互元素最低要求:hover 态、`cursor:pointer`、下拉/弹窗支持点外关闭与 Esc;`alert()` 允许作为原型演示动作(标注真实交互由开发实现)。

## 6. 组件规范(后台组件形态照抄范本 antd,前台自绘终端风)

| 组件 | 规范 | 范本锚点 |
| --- | --- | --- |
| 页面骨架 | crumb(页名 / 分区·说明·阶段)→ info alert(可选)→ Tabs/工具栏 → 内容 → 页脚端点标注 | admin-models |
| Tabs | 下划线式,数字徽标可选(模型条目 5);Tab 切换为纯 JS class 切换 | admin-models |
| 表格 | thead 弱色小字;行 hover;操作列为文字链接组(主操作在前,危险操作红色右对齐);单元格防换行(名称/数值列 `white-space:nowrap`) | admin-users / admin-models |
| Tag 语言 | 类型/用途 `use-tag`(accent-dim);状态 `st-tag` 四色(ok 绿/run 蓝/skip 琥珀/fail 红);健康度 `st-healthy/st-degraded/st-error`;渠道类型 `tag-rss/tag-web/tag-api`;「二期」灰 tag 挂侧栏与卡片 | 全部 admin 页 |
| Modal | 遮罩 + 660px 卡;vertical 表单;分区小标题(「模型接入」);password 字段附「留空表示不修改;保存后加密落库,仅回显尾 4 位」;footer 左取消右 primary | admin-models |
| 表单 | label 150px 左侧(desc-grid)或垂直;`.sel/.ipt` 全宽是 bind-row 局部样式,其他页复用须 `width:auto` 覆盖;必填 `*` 红点 | admin-models / sessions |
| KPI 卡 | 4 列网格:图标+标签 → 大数(mono,单位 small)→ 说明行;同比用语义色小字 | admin-usage / spider |
| CSS 图表 | **禁图表库**:柱图(div 高度 + seeded rnd)、分布条(`.track/.fill` 必须display:block)、sparkline(14 柱)、热力图(84 格 color-mix 4 档 + 日期轴 space-between,**子元素禁 margin-left:auto**)、条带(24 格)。数据一律 mulberry32 种子伪随机,写死种子保证双主题截图一致 | admin-usage / spider |
| 抽屉 Drawer | 右侧 560px;头(单号+状态 tag)→ desc2 概要 → JSON pre(.k/.s/.n 语法色)→ 垂直时间线(节点圆点 + 耗时;终态节点用语义色);`body.drawer-open` 控制 | admin-sessions |
| 双状态卡 | 服务观测页页顶两卡并列(适配层 / 转写):状态点 + 4 指标 + 内嵌 alert | admin-bloggers |
| 两步武装删除 | 删除按钮:启用行 disabled + title「两步武装删除」;停用行可点;footer 注「仅允许对已停用账号物理删除,级联清理」 | admin-bloggers |
| 空态 | 图标 + 标题 + 说明 + hint 条;说明兜底语义(「AI 直接作答」) | site-search |
| 降级注记 | 不可用能力必须显式注记(降级策略 / 三期开放 / 二期开放 灰 tag),不静默消失 | 全站 |

## 7. 文案与数据

- 中文语境真实文案,**禁止 lorem、禁止「示例文字」占位**;mock 数据要能自洽讲出业务故事(与 requirement/arch 数 nailed:154 篇文章、296 用户、3314 弃用资讯、47 条今日入流等)。
- 每页页脚标注真实端点(`GET /api/...`),与 arch/05-services §5 清单对应;新页先在 arch 文档立锚点再出原型。
- AI 生成内容必须带标注(「✦ AI 生成 · …」);电报流 / 视频卡保留版权边界文案(原视频外链、版权归原作者)。
- 金额 `¥214.60` 写法:货币符号用 `<small>¥</small>` 降号,避免视觉割裂。
- 二期/三期功能:页面照常出原型,侧栏与卡片挂「二期」tag,正文注记触发条件,不另立占位页。

## 8. QA 门禁(新页/改页提交前全过)

1. **双主题截图**:每页暗 + 亮各一张逐屏目检(对比度、图标基线、胶囊滑块、nowrap);交互态(Modal/Drawer/下拉)用点击后截图验证。
2. **断链 0**:本地 href/src 全量存在性检查(文件系统版脚本)。
3. **emoji 扫描**:Unicode 区段正则 0 命中(白名单除外)。
4. **sprite 完整性**:iconsprite 注释清单 = 实际 symbol 集合 = 页面实际引用集合;`#i-xxx` 引用无悬空。
5. `npx prettier --check docs/prototypes/` 通过(html/md/css 全格式化)。
6. index.html 卡片收录 + 屏数表述一致;版本号三处一致(页脚 / index footer / requirement 引用)。
7. 无 JS 运行时错误(playwright 加载校验)。

## 9. 红线清单(违反即打回)

1. 禁 emoji 入 UI;禁新增图标体系;禁手绘 icon path。
2. 禁引入任何运行时依赖(CDN/npm/字体);原型保持零依赖单文件。
3. 禁图表库;禁未走 token 的裸色值;禁新造主题变体。
4. 禁占位文案与假数据裸奔(mock 必须种子确定性 + 业务自洽)。
5. 禁脱离 common.css 自造组件样式;新组件模式先进本规范 §6 再实现。
6. 禁改动已定稿交互基线(胶囊规格、header/侧栏构成、宽 1152)而不更新本规范。
7. 禁出「只有暗色」的页面;每屏亮色可读性同责。
8. 本规范变更随原型批次同 PR 提交,不单独滞后。
