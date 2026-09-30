.PHONY: setup dev worker lint typecheck test check build migrate seed format

setup:            ## 初始化:cp .env / 装依赖 / 起 pg,redis / 迁移 / 种子
	bash scripts/setup-local.sh

dev:              ## 启动 web(next dev :3000)
	npm run dev

worker:           ## 启动 BullMQ worker(dev,tsx 直跑)
	npm run worker

lint:             ## eslint
	npm run lint

typecheck:        ## tsc --noEmit
	npm run typecheck

test:             ## vitest 单测(无外部依赖;CI 同款)
	npm run test:unit

test-integration: ## vitest 集成测试(需 dev compose 的 pg/redis:make setup 后可用)
	npm run test:integration

build:            ## next build(standalone)+ worker 编译
	npm run build && npm run worker:build

check: lint typecheck test  ## 提交前门禁(三件套全绿)
	@echo "✅ make check 全绿"

migrate:          ## prisma migrate deploy(起库健康后、起应用前必须执行)
	npm run migrate:deploy

seed:             ## 种子数据(幂等)
	npm run seed

format:           ## prettier 全量格式化
	npm run format
