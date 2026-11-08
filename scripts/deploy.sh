#!/usr/bin/env bash
# ============================================================
# 统一部署脚本 —— CI/CD 的唯一部署入口(standard/02-cicd-deployment §5)
#
# 用法:
#   bash scripts/deploy.sh --env staging --tag develop-<sha>
#   sudo bash scripts/deploy.sh --env prod --tag main-<sha>
#
# 流程:参数校验 → 预检 → env 文件备份轮转 + 钉镜像 tag → 拉镜像 → 数据库迁移(先行)
#       → 换容器 → 健康检查 → 落 .deploy-state → 失败自动回滚 → 镜像清理
#
# 与 ai-invest-assisstant 的差异(本项目是单体 + 三 sidecar,无独立迁移镜像):
#   - 迁移载体就是应用镜像本身(生产 entrypoint 即跑 prisma migrate deploy)。
#     「迁移先行」= 用新镜像的容器跑一次 migrate deploy(绕开 entrypoint,只跑迁移),
#     失败即中止发布,旧容器继续服务——与独立 migrate 镜像同语义。
#   - 三个镜像各自钉 tag,写进 env 文件的 APP_IMAGE / GATEWAY_IMAGE / CARD_RENDERER_IMAGE
#     (compose 已按这三个变量插值),回滚 = 退回上一份 env 文件再起一次。
#   - staging 与 prod 共用 docker-compose.prod.yml;staging 与开发态共用同一个仓库
#     工作副本,靠三处隔离:COMPOSE_PROJECT_NAME、独立 env 文件(.env.staging)、
#     独立数据目录(workspace-staging/),且不起 nginx(无 SSL 证书)。
#
# 依赖:docker + docker compose v2;生产机需 root(docker 组权限不足)
# ============================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

ENV_NAME=""
IMAGE_TAG=""
KEEP_IMAGES="${DEPLOY_KEEP_IMAGES:-3}"
DISK_MIN_FREE_GB="${DEPLOY_DISK_MIN_FREE_GB:-5}"
HEALTH_TIMEOUT="${DEPLOY_HEALTH_TIMEOUT:-300}"
STATE_FILE="$REPO_ROOT/.deploy-state"
COMMIT_FILE="$REPO_ROOT/.deploy-commit"
ENV_FILE=""          # 本次环境使用的 env 文件(validate() 按 --env 决定)
WORKSPACE_ROOT=""    # 宿主持久化数据根(测试环境与开发态分目录)
ENV_OWNER=""
REGISTRY="${DEPLOY_REGISTRY:-ccr.ccs.tencentyun.com}"

log()  { printf '[deploy %s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
warn() { printf '[deploy %s] WARN: %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >&2; }
fail() { printf '[deploy %s] ERROR: %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >&2; exit 1; }

usage() {
    cat <<'EOF'
用法: bash scripts/deploy.sh --env <staging|prod> --tag <image-tag>

  --env   staging = 本机测试环境(与开发态同一工作副本:独立 project/env/数据目录,不起 nginx)
          prod    = 生产环境(docker-compose.prod.yml,nginx 全栈)
  --tag   staging 期望 develop-<sha>;prod 期望 main-<sha>(短 sha 或完整 sha)
EOF
}

# ---------------------------------------------------------------- 参数解析

parse_args() {
    while [ "$#" -gt 0 ]; do
        case "$1" in
            --env) ENV_NAME="${2:-}"; shift 2 ;;
            --tag) IMAGE_TAG="${2:-}"; shift 2 ;;
            -h|--help) usage; exit 0 ;;
            *) fail "未知参数：$1（-h 看用法）" ;;
        esac
    done
    [ -n "$ENV_NAME" ] || { usage >&2; fail "缺少 --env"; }
    [ -n "$IMAGE_TAG" ] || { usage >&2; fail "缺少 --tag"; }
}

validate() {
    case "$ENV_NAME" in
        prod)    TAG_RE='^main-[0-9a-f]{7,40}$' ;;
        staging) TAG_RE='^develop-[0-9a-f]{7,40}$' ;;
        *) fail "--env 只能是 prod 或 staging，收到：$ENV_NAME" ;;
    esac
    # tag 同时是镜像引用的一部分，只放行白名单正则，杜绝注入与误传 latest
    echo "$IMAGE_TAG" | grep -Eq "$TAG_RE" \
        || fail "非法镜像 tag：${IMAGE_TAG}（${ENV_NAME} 要求匹配 ${TAG_RE}）"

    COMPOSE_PATHS=(docker-compose.prod.yml)
    COMPOSE_F=(-f docker-compose.prod.yml)
    export COMPOSE_FILE="docker-compose.prod.yml"
    if [ "$ENV_NAME" = "prod" ]; then
        UP_ARGS=(--remove-orphans)
        # 全栈:nginx 唯一对外,必须一起起
        UP_SERVICES=(web worker douyin-gateway card-renderer postgres redis nginx)
        ENV_FILE=".env"
        WORKSPACE_ROOT="./workspace"
    else
        # staging:与开发态同处一个仓库工作副本——用独立 compose project、
        # 独立 env 文件与独立数据目录隔开,不起 nginx(无 SSL 证书)
        export COMPOSE_PROJECT_NAME="aitech-hub-staging"
        UP_ARGS=()
        UP_SERVICES=(web worker douyin-gateway card-renderer postgres redis)
        ENV_FILE=".env.staging"
        WORKSPACE_ROOT="./workspace-staging"
    fi
    # compose 插值与容器 env_file 同源:同一个文件,不会插值用一套、容器用另一套
    export APP_ENV_FILE="$ENV_FILE"
    export WORKSPACE_ROOT
}

compose() { docker compose --env-file "$ENV_FILE" "${COMPOSE_F[@]}" "$@"; }

# ---------------------------------------------------------------- 小工具

stat_owner() {
    stat -c '%u:%g' "$1" 2>/dev/null || stat -f '%u:%g' "$1" 2>/dev/null || echo ""
}

env_get() {
    # 读 env 文件的某个键(不做 shell 求值，避免 .env 里的 ${VAR} 被提前展开)
    local key="$1" default="${2:-}" val
    val="$(grep -E "^${key}=" "$ENV_FILE" 2>/dev/null | tail -n 1 | cut -d= -f2- || true)"
    if [ -n "$val" ]; then printf '%s' "$val"; else printf '%s' "$default"; fi
}

rotate_env_backup() {
    # env 文件 → .bak → .bak.1 → .bak.2(最多 3 份,超出删最旧)
    rm -f "${ENV_FILE}.bak.2"
    [ -f "${ENV_FILE}.bak.1" ] && mv "${ENV_FILE}.bak.1" "${ENV_FILE}.bak.2" || true
    [ -f "${ENV_FILE}.bak" ] && mv "${ENV_FILE}.bak" "${ENV_FILE}.bak.1" || true
    cp "$ENV_FILE" "${ENV_FILE}.bak"
}

set_env_var() {
    local key="$1" val="$2" tmp
    tmp="$(mktemp "${TMPDIR:-/tmp}/deploy-env.XXXXXX")"
    if grep -qE "^${key}=" "$ENV_FILE" 2>/dev/null; then
        awk -v k="$key" -v v="$val" '
            $0 ~ "^"k"=" { print k"="v; next }
            { print }
        ' "$ENV_FILE" > "$tmp"
    else
        cat "$ENV_FILE" > "$tmp"
        printf '%s=%s\n' "$key" "$val" >> "$tmp"
    fi
    cat "$tmp" > "$ENV_FILE"
    rm -f "$tmp"
}

restore_owner() {
    # 生产机以 root 执行本脚本,env 文件属主须还原给部署用户(否则后续编辑/git 受阻)
    local owner="$1"
    [ -n "$owner" ] || return 0
    chown "$owner" "$ENV_FILE" "${ENV_FILE}.bak" "${ENV_FILE}.bak.1" "${ENV_FILE}.bak.2" 2>/dev/null || true
}

restore_prev_env() {
    # 退回上一份 env 文件:三个镜像的 tag 一并回退(只退 APP_IMAGE 会让网关/卡片渲染
    # 停在本次的 tag 上,组合版本错位)。
    local owner="$1"
    [ -f "${ENV_FILE}.bak" ] || { warn "无 ${ENV_FILE}.bak 可回退"; return 1; }
    cp "${ENV_FILE}.bak" "$ENV_FILE"
    restore_owner "$owner"
    warn "已退回上一份 ${ENV_FILE}(镜像 tag 一并回退)"
}

# ---------------------------------------------------------------- 镜像坐标

# 镜像仓库前缀(registry/namespace)从 compose 推导,避免脚本里再写一份地址。
# config --images 的输出顺序是散列序,不能取第一行——第一行可能是 nginx:1.28-alpine
# 这类两段式三方镜像。只认「registry/namespace/repo」三段式,本项目自有镜像才符合。
image_namespace() {
    local img rest
    img="$(compose config --images 2>/dev/null \
        | grep -E '^[^/]+/[^/]+/[^/]+:' | head -n 1 || true)"
    [ -n "$img" ] || return 0
    # registry/namespace/repo:tag → 去掉末段 repo:tag,再剥掉与 REGISTRY 相同的首段,
    # 剩下的才是命名空间(此前误剥两段,只剥到 registry,拼出 registry/registry/repo)
    rest="$(printf '%s' "$img" | sed -E 's|/[^/:]+:[^/:]+$||')"
    case "$rest" in
        "$REGISTRY"/*) printf '%s' "${rest#"$REGISTRY"/}" ;;
        *) printf '%s' "${rest##*/}" ;;
    esac
}

namespace() {
    if [ -n "${DEPLOY_NAMESPACE:-}" ]; then printf '%s' "$DEPLOY_NAMESPACE"; return 0; fi
    local ns
    ns="$(image_namespace)"
    [ -n "$ns" ] || fail "无法推导镜像命名空间(请显式设置 DEPLOY_NAMESPACE)"
    printf '%s' "$ns"
}

# 镜像仓库全路径(registry/namespace):docker images 的过滤参数必须是全路径——
# 只给命名空间过滤不到(短前缀匹配不上含 registry 的完整仓库名),
# 过滤落空 → 清理步骤静默空转,旧镜像无限堆积。
image_repo_path() {
    printf '%s/%s' "$REGISTRY" "$(namespace)"
}

image_ref() {
    # image_ref <repo 名> → registry/namespace/repo
    printf '%s/%s' "$(image_repo_path)" "$1"
}

# 坐标必须是 registry/namespace/repo 三段式,且 registry 不得重复出现
# (剥路径段数写错时会拼成 registry/registry/repo,仍是三段,靠段数查不出)。
# 校验放在调用点(主 shell)而非 image_ref 内部——命令替换里的 exit 只退子 shell,
# 报错会被吞掉,护栏形同虚设。
assert_image_ref() {
    local ref="$1" segs hits
    segs="$(printf '%s' "$ref" | tr -cd '/' | wc -c | tr -d ' ')"
    [ "$segs" = "2" ] || fail "镜像坐标非法(应为 registry/namespace/repo 三段):$ref"
    hits="$(printf '%s' "$ref" | grep -oF "$REGISTRY" | wc -l | tr -d ' ' || true)"
    [ "$hits" -le 1 ] || fail "镜像坐标非法(registry 重复出现):$ref"
}

# compose 各版本旗标面不同(run 的 --pull 是较新版本才有):按实际能力决定传不传。
# 生产机 compose v2.29.6 的 run 子命令无此旗标,直接带会报 unknown flag: --pull。
compose_run_pull_opt() {
    local help
    help="$(compose run --help 2>&1 || true)"
    case "$help" in
        *--pull*) printf -- '--pull never' ;;
    esac
}

# ---------------------------------------------------------------- 预检

preflight() {
    command -v docker >/dev/null 2>&1 || fail "docker 不存在"
    docker compose version >/dev/null 2>&1 || fail "docker compose v2 不可用(需 compose plugin)"
    docker info >/dev/null 2>&1 || fail "无权访问 docker daemon(生产机请用 sudo 执行本脚本)"

    local compose_file
    for compose_file in "${COMPOSE_PATHS[@]}"; do
        [ -f "$compose_file" ] || fail "缺少 compose 文件：$compose_file"
    done
    [ -f "$ENV_FILE" ] || fail "缺少 $ENV_FILE(部署前须先准备)"
    # 迁移靠应用镜像内的 prisma CLI 跑,compose 必须定义 web 服务
    compose config --services 2>/dev/null | grep -x web >/dev/null \
        || fail "compose 未定义 web 服务(迁移载体是应用镜像)"

    # 磁盘余量:Docker Desktop 的 DockerRootDir 在虚拟机内(宿主机无此路径),
    # 此时改看工程目录所在卷(镜像与 workspace 数据都在这一侧增长)
    local root free_gb disk_path="$REPO_ROOT"
    root="$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || true)"
    [ -n "$root" ] && [ -d "$root" ] && disk_path="$root"
    free_gb="$(df -Pk "$disk_path" | awk 'NR==2 {printf "%d", $4/1048576}')"
    if [ "${free_gb:-0}" -lt "$DISK_MIN_FREE_GB" ]; then
        fail "磁盘剩余 ${free_gb}G < 阈值 ${DISK_MIN_FREE_GB}G(${disk_path}),先清理磁盘"
    fi
    log "预检通过：磁盘剩余 ${free_gb}G(${disk_path}),compose=$COMPOSE_FILE"

    # 迁移要连库,预检要求库在线。首次部署(测试环境)库里还没有容器——就地拉起,
    # 不要求人手工先起一遍基础设施(部署入口只有脚本一个)。
    local pg_id pg_health
    pg_id="$(compose ps -q postgres 2>/dev/null || true)"
    if [ -z "$pg_id" ]; then
        log "postgres 未部署,先拉起数据库容器"
        compose up -d --wait postgres || fail "postgres 拉起失败(检查 TCR 凭证与磁盘)"
        pg_id="$(compose ps -q postgres 2>/dev/null || true)"
    fi
    [ -n "$pg_id" ] || fail "postgres 容器未运行(先执行 compose up -d postgres --wait)"
    pg_health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$pg_id")"
    case "$pg_health" in
        healthy|running) ;;
        *) fail "postgres 未就绪：$pg_health" ;;
    esac
}

# ---------------------------------------------------------------- 迁移

run_migrations() {
    # 迁移载体 = 应用镜像内的 prisma CLI(生产 entrypoint 即走这条路)。
    # --entrypoint npx:绕开 entrypoint.sh,只跑迁移不起服;
    # --no-deps:postgres 已在跑(预检已确认健康),不让 compose 再动它;
    # --pull never:镜像已在拉取阶段到位,现场绝不联网拉取;-T:非交互不分配 TTY。
    log "执行数据库迁移(应用镜像内 prisma migrate deploy,先行,失败即中止)"
    # compose run 的 --pull 旗标是较新版本才有的:生产机 compose v2.29.6 无此旗标,
    # 直接带会报 unknown flag: --pull,卡在迁移先行这一步。探测后按需带上。
    local run_pull_opt
    run_pull_opt="$(compose_run_pull_opt)"
    compose run --rm --no-deps ${run_pull_opt:+$run_pull_opt} -T --entrypoint npx web prisma migrate deploy
}

# ---------------------------------------------------------------- 健康检查

wait_healthy() {
    # 只看本次要起的服务(UP_SERVICES):扫全项目容器会被历史遗留的已退出容器
    # 拖成永远不健康(--all 含 exited 容器)。--all 是为了看见「服务已停」——
    # 不带它 compose ps 只列运行中的,停掉的服务会被漏判为健康。
    local timeout="$1" deadline bad name running health svc cid
    deadline=$(( $(date +%s) + timeout ))
    while :; do
        bad=""
        for svc in "${UP_SERVICES[@]}"; do
            cid="$(compose ps -q --all "$svc" 2>/dev/null | sed -n 1p)"
            [ -n "$cid" ] || continue
            name="$(docker inspect -f '{{.Name}}' "$cid" 2>/dev/null | sed 's|^/||')"
            running="$(docker inspect -f '{{.State.Running}}' "$cid" 2>/dev/null || echo unknown)"
            health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2>/dev/null || echo unknown)"
            if [ "$running" != "true" ]; then
                bad="$bad ${name}(running=$running)"
            elif [ "$health" != "healthy" ] && [ "$health" != "running" ] && [ "$health" != "none" ]; then
                bad="$bad ${name}(health=$health)"
            fi
        done
        [ -z "$bad" ] && return 0
        if [ "$(date +%s)" -ge "$deadline" ]; then
            warn "超时 ${timeout}s 仍未健康：$bad"
            return 1
        fi
        sleep 5
    done
}

# ---------------------------------------------------------------- 状态与回滚

read_state_field() {
    [ -f "$STATE_FILE" ] || return 0
    grep -E "^$1=" "$STATE_FILE" | tail -n 1 | cut -d= -f2- || true
}

resolve_commit() {
    # 本次发布的 commit:CI 同步时落盘的 .deploy-commit 最准(服务器可能没有 git 仓库);
    # 其次用 tag 里的 sha 反查本地 git;最后退化为 tag 的 sha 片段
    local tag="$1" sha
    sha="${tag#*-}"
    if [ -f "$COMMIT_FILE" ]; then
        cat "$COMMIT_FILE"
        return 0
    fi
    git rev-parse --verify "$sha" 2>/dev/null || echo "$sha"
}

write_state() {
    local status="$1" current="$2" previous="$3" commit="$4"
    cat > "$STATE_FILE" <<EOF
current_tag=$current
previous_tag=$previous
commit=$commit
deployed_at=$(date '+%Y-%m-%dT%H:%M:%SZ')
status=$status
EOF
}

rollback_to() {
    local prev="$1" prev_commit="$2"
    if [ -z "$prev" ]; then
        warn "没有可回滚的版本(${ENV_FILE}.bak 中无 APP_IMAGE),保持现场等待人工处理"
        return 1
    fi
    [ -n "$prev_commit" ] || prev_commit="${prev#*-}"
    warn "开始回滚到 $prev"
    restore_prev_env "$ENV_OWNER" || return 1
    if compose up -d --wait ${UP_ARGS[@]+"${UP_ARGS[@]}"} --no-build --pull never "${UP_SERVICES[@]}" >/dev/null 2>&1; then
        if wait_healthy 180; then
            warn "回滚成功：当前运行 $prev"
            write_state ROLLED_BACK "$prev" "" "$prev_commit"
            return 0
        fi
    fi
    warn "回滚失败,需人工介入"
    write_state FAILED_ROLLED_BACK_FAILED "$prev" "" "$prev_commit"
    return 1
}

# ---------------------------------------------------------------- 镜像拉取与清理

pull_images() {
    # sha 短 tag 不可变:拉取失败但本地已有同 tag 镜像时继续走(回滚场景下仓库不可达)。
    # compose pull 默认策略 missing:同 tag 已在本地则不再联网拉(回滚目标即靠这条)。
    local svc repo failed=""
    for svc in web worker douyin-gateway card-renderer; do
        case "$svc" in
            web|worker)             repo="aitech-hub" ;;
            douyin-gateway)          repo="aitech-hub-gateway" ;;
            card-renderer)           repo="aitech-hub-card-renderer" ;;
        esac
        if compose pull "$svc"; then
            continue
        fi
        if docker image inspect "$(image_ref "$repo"):$IMAGE_TAG" >/dev/null 2>&1; then
            warn "$svc 拉取失败,本地已有同 tag 镜像,继续"
        else
            failed="$failed $svc"
        fi
    done
    [ -z "$failed" ] || { warn "镜像拉取失败且本地无对应镜像：$failed"; return 1; }

    # postgres / redis 的镜像与本次 tag 无关(pgvector 自编译镜像固定 pg16、redis 固定 7-alpine),
    # 但换容器时用 --pull never——镜像本地没有就起不来。故这里一并拉:
    # 拉失败不直接中止(回滚场景下仓库可能不可达),本地已有则照样能起。
    compose pull postgres redis >/dev/null 2>&1 \
        || warn "postgres/redis 镜像拉取失败,若本地无镜像则换容器会失败"
    return 0
}

cleanup_images() {
    local current_tag="$1" protect_tag="$2" repo_path repo tags i
    repo_path="$(image_repo_path)"
    [ -n "$repo_path" ] || { warn "无法推导镜像仓库路径,跳过镜像清理"; return 0; }
    for repo in aitech-hub aitech-hub-gateway aitech-hub-card-renderer; do
        # 过滤参数必须是 registry/namespace/repo 全路径:只给命名空间匹配不到
        # (docker images 按完整仓库名匹配),过滤落空会让整个清理静默空转。
        tags="$(docker images --format '{{.Tag}}\t{{.CreatedAt}}' "$repo_path/$repo" 2>/dev/null \
            | awk -F'\t' '$1 ~ /^(main|develop)-[0-9a-f]{7,40}$/' \
            | sort -k2 -r | cut -f1)"
        # 落空即报警:此前这里是无声 continue,清理从未生效却照样打印「清理完成」。
        [ -n "$tags" ] || { warn "镜像清理过滤未命中:$repo_path/$repo(仓库路径不对,旧镜像不会被清理)"; continue; }
        i=0
        for t in $tags; do
            i=$((i + 1))
            # 当前版本与上一个版本(回滚目标)永不删除
            if [ "$i" -gt "$KEEP_IMAGES" ] && [ "$t" != "$current_tag" ] && [ "$t" != "$protect_tag" ]; then
                docker image rm "$repo_path/$repo:$t" >/dev/null 2>&1 \
                    || warn "镜像删除失败(可能被容器引用)：$repo_path/$repo:$t"
            fi
        done
    done
    # 只清悬空层:docker image prune -a 会连回滚目标一起删掉
    docker image prune -f >/dev/null 2>&1 || true
    log "镜像清理完成(每仓库保留最新 $KEEP_IMAGES 个)"
}

prune_backups() {
    # (head -n -N 在 BSD head 上不支持,改用计数 + sed 取前 N 行;
    #  不用 head:head 提前退出会让上游吃 SIGPIPE,pipefail 下误判为失败)
    local files count
    files="$(ls -1 "${ENV_FILE}.bak*" 2>/dev/null | sort || true)"
    count="$(printf '%s' "$files" | grep -c . || true)"
    if [ "${count:-0}" -gt 3 ]; then
        printf '%s\n' "$files" | sed -n "1,$((count - 3))p" | while read -r f; do
            rm -f "$f"
        done
    fi
}

# ---------------------------------------------------------------- 主流程

main() {
    parse_args "$@"
    validate
    preflight

    local owner previous commit prev_commit
    owner="$(stat_owner "$ENV_FILE")"
    ENV_OWNER="$owner"
    # 上一个版本 = 当前 .env 里的 APP_IMAGE(改之前);空则退到 .env.bak / 状态文件
    # 统一只留 tag 段(状态文件字段是 previous_tag;回滚目标本体由 .env.bak 承担)
    previous="$(env_get APP_IMAGE '')"
    [ -n "$previous" ] || previous="$(grep -E '^APP_IMAGE=' "${ENV_FILE}.bak" 2>/dev/null | tail -n 1 | cut -d= -f2- || true)"
    [ -n "$previous" ] || previous="$(read_state_field previous_tag)"
    previous="${previous##*:}"
    prev_commit="$(read_state_field commit)"
    commit="$(resolve_commit "$IMAGE_TAG")"

    rotate_env_backup
    local app_ref gw_ref card_ref
    app_ref="$(image_ref aitech-hub):$IMAGE_TAG"
    gw_ref="$(image_ref aitech-hub-gateway):$IMAGE_TAG"
    card_ref="$(image_ref aitech-hub-card-renderer):$IMAGE_TAG"
    assert_image_ref "$app_ref"
    assert_image_ref "$gw_ref"
    assert_image_ref "$card_ref"
    set_env_var APP_IMAGE "$app_ref"
    set_env_var GATEWAY_IMAGE "$gw_ref"
    set_env_var CARD_RENDERER_IMAGE "$card_ref"
    restore_owner "$owner"
    log "镜像钉为 ${IMAGE_TAG}(上一个版本：${previous:-无})"

    # 拉镜像 / 迁移阶段失败时还没换容器,必须把 .env 退回上一个版本——
    # 否则 .env 会指向一个从未跑起来的 tag,下一次部署的回滚目标就错了
    if ! pull_images; then
        restore_prev_env "$owner"
        fail "镜像拉取失败：$IMAGE_TAG"
    fi

    if ! run_migrations; then
        restore_prev_env "$owner"
        fail "数据库迁移失败：已中止发布,旧版本继续服务(未换容器)"
    fi

    if ! compose up -d --wait ${UP_ARGS[@]+"${UP_ARGS[@]}"} --no-build --pull never "${UP_SERVICES[@]}"; then
        warn "容器更新失败"
        write_state FAILED "$IMAGE_TAG" "$previous" "$commit"
        rollback_to "$previous" "$prev_commit" || true
        fail "部署失败,已尝试回滚"
    fi

    if ! wait_healthy "$HEALTH_TIMEOUT"; then
        warn "健康检查未通过"
        write_state FAILED "$IMAGE_TAG" "$previous" "$commit"
        rollback_to "$previous" "$prev_commit" || true
        fail "部署失败(健康检查未通过),已尝试回滚"
    fi

    write_state OK "$IMAGE_TAG" "$previous" "$commit"
    log "部署成功：${IMAGE_TAG}(commit ${commit})"

    cleanup_images "$IMAGE_TAG" "$previous"
    prune_backups
    log "完成"
}

main "$@"
