#!/bin/sh
# next build 包装(2026-10-05 版本追踪需求):向客户端 bundle 注入构建信息,Footer 展示。
# @status ops
# CI(docker/Dockerfile builder)经 ARG BUILD_REF/BUILD_TIME 传入显式值;
# 本地直跑无 CI 变量时回退 git describe(--dirty 标记未提交改动),均缺省则 Footer 显示 dev。
# NEXT_PUBLIC_ 前缀 = Next.js 约定的构建期内联,运行时零开销。
set -e

BUILD_REF="${BUILD_REF:-$(git describe --always --dirty 2>/dev/null || true)}"
BUILD_TIME="${BUILD_TIME:-$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || true)}"
export NEXT_PUBLIC_BUILD_REF="$BUILD_REF"
export NEXT_PUBLIC_BUILD_TIME="$BUILD_TIME"

exec next build "$@"
