# aitech-hub

一起AI技术(17aitech.com)全新重建:Next.js 15 全栈单体 + Prisma/PostgreSQL + Redis/BullMQ。
替换现有 WordPress 站,SEO 无损迁移为最高优先级约束(中文 percent-encoded slug 原样可用)。

## 快速开始

```bash
make setup   # cp .env(自动生成 AUTH_SECRET)/ npm install / 起 pg(5434)+redis(6380)/ 迁移 / 种子
make dev     # http://localhost:3000(健康检查:/api/health)
```

## 常用命令

| 命令           | 说明                                               |
| -------------- | -------------------------------------------------- |
| `make check`   | lint + typecheck + 单测(提交前门禁)                |
| `make migrate` | `prisma migrate deploy`(forward-only,禁止 db push) |
| `make worker`  | BullMQ worker(dev,tsx 直跑)                        |
| `make build`   | next build(standalone)+ worker 编译                |

## 结构速览

- `src/app/(site|user|admin)/` 页面;`src/app/api/` Route Handlers;`src/lib/` 业务库
- `prisma/` schema 唯一真相源 + 迁移 SQL;`worker/` 异步任务;`scripts/migrate-wp/` WP 迁移(二期 M2)
- `docs/` 设计文档(requirement 需求基准 / arch 终态方案 / plan 迭代状态)

## 文档

从 [docs/README.md](docs/README.md) 进入;新会话先读根 [CLAUDE.md](CLAUDE.md)。
