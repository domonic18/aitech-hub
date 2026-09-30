# 测试策略

> 本文属 `docs/standard/`(稳定规范:内容不轻易变更,随实现漂移的过程细节回 arch 文档)。
> 原则承袭范例项目:测试先行、单测为主无外部依赖、网络/IO 必须 mock、`tmp_path` 隔离文件系统。迁移数据对账是本项目特有的测试主战场。

## 1. 测试分层总览

| 层 | 框架 | 位置 | 依赖 | CI |
|----|------|------|------|-----|
| 单测 | Vitest | `src/**/*.test.ts`、`scripts/migrate-wp/**/*.test.ts` | 无 | 每次提交 |
| 集成/API | Vitest | 与单测同层 `src/**/*.integration.test.ts`(M4 引入;vitest include 天然覆盖,`test:unit` 按文件名排除) | dev compose 的 PG/Redis | 本地跑;CI 接入随 M4 |
| E2E 冒烟 | Playwright | `e2e/` | 本地全栈(web+worker+pg+redis) | 本地 + 切换日前必跑;CI 接入随 M6 |
| 迁移对账 | verify.ts | `scripts/migrate-wp/` | 源 WP 库 + 目标 PG | 切换日前必跑(人工触发) |
| 迁移重放守卫 | CI job | `.github/workflows/ci.yml` | 临时 PG 容器 | 每次 push/PR(无条件,同范例 db-migration-guard) |

## 2. 单测(Vitest,质量红线,缺一不绿)

1. **`normalizeSlug` 全边界**(编码↔解码往返、二次编码、`%` 字面量、`+`/空格)——arch/07-frontend §2 红线;`scripts/migrate-wp` 引用同一实现,天然同源
2. **HTML 清洗每条规则**(src/lib/content/clean-html.ts 白名单规则):Gutenberg 注释剥离、短码转换、标签/属性白名单、内链相对化——正例+反例各一;测试数据用 WP 导出真实切片(脱敏 fixtures)
3. 会话:签发/校验/轮换/吊销(jose + mock Redis);频控计数边界
4. 引用解析 `lib/media/refs.ts`:从 md/html 提取媒体路径、封面纳入、去重
5. legacy 映射:命中 301 / NULL→410 / 未命中 404
6. Zod schemas:输入边界(超长/非法字符/类型混用)

## 3. 集成与 API 测试(`*.integration.test.ts`)

- 环境:dev compose 的 PG/Redis;每个用例事务回滚或 `truncate` 隔离;测试前后 `prisma migrate deploy` 确保 schema 最新
- 覆盖:post service 保存钩子(slug 唯一冲突/引用解析/revalidate 触发——revalidatePath mock 断言调用参数)、媒体上传白名单、auth 全流程(sms-code 频控 → login → session → logout)、view 计数 UPSERT、legacy 路由查表
- Route Handler 测试:构造 `NextRequest` 直调 handler 函数(不起服务器)

## 4. E2E(Playwright,冒烟级,6 条以内)

1. 首页 200 且含最新文章卡
2. 从 sitemap 取一个中文编码 slug 直开文章页:200、标题匹配、正文图片无 broken(naturalWidth>0 抽查)
3. 弃用 slug → 301 到 /articles(route 截断断言 Location)
4. 登录流:admin 密码登录(M4,UI 全流;含爆破模糊提示与会话吊销复放)
5. sitemap.xml / feed.xml 可访问且含条目
6. 后台发布 → 前台闭环(M5-a:新建/存草稿/发布/on-demand revalidate 列表与详情可见/软删 404)

## 5. 迁移重放守卫(CI)

`prisma/migrations/**` 有变更的 PR:

```
起 postgres:16 容器 → npx prisma migrate deploy 全量 → 再 deploy 一次(exactly-once 台账幂等)
→ npx prisma migrate diff --from-url <CI库> --to-schema-datamodel prisma/schema.prisma --exit-code
  (实际库与 schema.prisma 有差异即非零退出;以 migrate diff 替代 db pull,免额外库权限)
```

> seed 不在 CI 门禁内:幂等性由 upsert 实现保证,本地 `make seed` 重复执行可验证(2026-09-30 与 ci.yml 对齐)。

## 6. 迁移对账(scripts/migrate-wp/verify.ts)

- 带**退出码的验收脚本**:PASS→0,FAIL→非 0,报告落 `artifacts/verify_report.json`
- 与 requirement §7 七条验收一一对应;`run.ts` 实跑后全绿才允许 M6 切换
- 抽样可复现:`--seed` 固定随机种子,报告记录种子与命中清单

## 7. 发布门槛(与范例同款口径)

- **验收全绿**:`npm run typecheck + lint + test:unit + build`;CI 迁移重放通过;husky pre-push 跑 `make check`
- E2E 与迁移对账在**切换日前**人工触发全量跑一次,结果贴进 development-plan.md 对应里程碑行
