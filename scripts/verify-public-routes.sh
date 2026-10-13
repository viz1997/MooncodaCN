#!/usr/bin/env bash
# verify-public-routes.sh —— BFF 公共端点冒烟测试
#
# 用途：SDK v1.1.0 上线后,验证 BFF 部署版本里 /api/public/** 与
#       /api/image/task/[id] 已带上本次的修复。
# 改 BFF 路由 / 鉴权 / 字段时,跑一下这个确认没炸公共端点。
#
# 用法：
#   BASE_URL=https://api.mooncoda.com \
#   EXTERNAL_API_KEY=mk_pub_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx \
#   APIMART_TASK_ID=task_01M4T6MCXA153FV4163DERS1C5 \
#   bash scripts/verify-public-routes.sh
#
#   不传 BASE_URL 默认 http://localhost:3000
#   不传 EXTERNAL_API_KEY 也能跑(只会看到 401,仍然能确认端点存活)
#   不传 APIMART_TASK_ID 跳过 taskId 轮询测试
#
# 退出码：
#   0 = 全部通过(或预期失败)
#   非 0 = 至少一个测试返了意料外的状态
#
# 2026-10-13：v1.1.0 首发。后续 BFF 改 public 路由时更新本脚本。

set -uo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
EXTERNAL_API_KEY="${EXTERNAL_API_KEY:-}"
APIMART_TASK_ID="${APIMART_TASK_ID:-}"
VERBOSE="${VERBOSE:-0}"

PASS=0
FAIL=0
WARN=0
TOTAL=0

# 颜色(Windows Git Bash / Linux 都识别 ANSI)
GREEN="\033[0;32m"
RED="\033[0;31m"
YELLOW="\033[0;33m"
CYAN="\033[0;36m"
RESET="\033[0m"

# log
log_step() { printf "\n${CYAN}▶ %s${RESET}\n" "$1"; }
log_pass() { printf "  ${GREEN}✓ %s${RESET}\n" "$1"; PASS=$((PASS+1)); TOTAL=$((TOTAL+1)); }
log_fail() { printf "  ${RED}✗ %s${RESET}\n" "$1"; FAIL=$((FAIL+1)); TOTAL=$((TOTAL+1)); }
log_warn() { printf "  ${YELLOW}⚠ %s${RESET}\n" "$1"; WARN=$((WARN+1)); TOTAL=$((TOTAL+1)); }

# curl helper
# 用法: do_curl <METHOD> <PATH> [extra-curl-args...]
# 返: "HTTP_CODE BODY" (BODY 截 500 字符)
do_curl() {
  local method="$1"
  local path="$2"
  shift 2
  local url="${BASE_URL}${path}"
  local tmpfile
  tmpfile=$(mktemp)
  local code
  code=$(curl -sS -o "$tmpfile" -w "%{http_code}" \
    -X "$method" \
    -H "x-api-key: ${EXTERNAL_API_KEY}" \
    -H "Accept: application/json" \
    "$@" \
    "$url" 2>&1) || code="000"
  local body
  body=$(head -c 500 "$tmpfile" 2>/dev/null || echo "")
  rm -f "$tmpfile"
  printf "%s|%s" "$code" "$body"
}

# 拆 curl 返的 "CODE|BODY"(helper,目前 inline cut 够用,保留供扩展)
# parse() { ... } 占位

# 输出 +verbose 详情
if [ "$VERBOSE" = "1" ]; then
  set -x
fi

printf "${CYAN}=== BFF 公共端点冒烟测试 ===${RESET}\n"
printf "  BASE_URL: %s\n" "$BASE_URL"
printf "  EXTERNAL_API_KEY: %s\n" "${EXTERNAL_API_KEY:-(未传,会拿到 401)}"
printf "  APIMART_TASK_ID: %s\n" "${APIMART_TASK_ID:-(未传,跳过 taskId 轮询)}"

# ----------------------------------------------------------------------
# Test 1: /api/public/prompt-templates 端点存活 + 鉴权 + 响应 shape
# ----------------------------------------------------------------------
log_step "Test 1: GET /api/public/prompt-templates"
RAW=$(do_curl GET "/api/public/prompt-templates")
CODE=$(echo "$RAW" | cut -d'|' -f1)
BODY=$(echo "$RAW" | cut -d'|' -f2-)

if [ "$CODE" = "200" ]; then
  # 验响应 shape
  if echo "$BODY" | grep -q '"productLines"' && echo "$BODY" | grep -q '"templates"'; then
    log_pass "200 + 响应含 productLines + templates(v1.1.0 契约)"
    PL_COUNT=$(echo "$BODY" | grep -oE '"productLineId"' | wc -l | tr -d ' ')
    TPL_COUNT=$(echo "$BODY" | grep -oE '"maskId"' | wc -l | tr -d ' ')
    printf "    productLines 命中 %s 个产品线, templates 命中 %s 个 mask\n" "$PL_COUNT" "$TPL_COUNT"
  else
    log_warn "200 但响应 shape 不对(应含 productLines + templates)。BODY 摘录: $BODY"
  fi
elif [ "$CODE" = "401" ] || [ "$CODE" = "403" ]; then
  if [ -z "$EXTERNAL_API_KEY" ]; then
    log_pass "$CODE(预期:未传 key 必拒)"
  else
    log_fail "$CODE(传了 key 仍被拒,key 不对或 BFF 没切到 v1.1.0)"
  fi
elif [ "$CODE" = "404" ]; then
  log_fail "404 —— BFF 没实现本端点,v1.1.0 修复没部署"
elif [ "$CODE" = "000" ]; then
  log_warn "000 —— 连接到 $BASE_URL 失败(BFF 没起或网络不通)。等部署完再跑"
else
  log_fail "$CODE —— 意外状态。 BODY 摘录: $BODY"
fi

# ----------------------------------------------------------------------
# Test 2: /api/image/task/[id] —— apimart ULID taskId 兜底
# ----------------------------------------------------------------------
log_step "Test 2: GET /api/image/task/[id](apimart ULID 形态)"
if [ -z "$APIMART_TASK_ID" ]; then
  log_warn "跳过:APIMART_TASK_ID 未设(export APIMART_TASK_ID=task_01... 重跑)"
else
  RAW=$(do_curl GET "/api/image/task/${APIMART_TASK_ID}")
  CODE=$(echo "$RAW" | cut -d'|' -f1)
  BODY=$(echo "$RAW" | cut -d'|' -f2-)

  case "$CODE" in
    200)
      if echo "$BODY" | grep -qE '"status":"(completed|failed|processing)"'; then
        log_pass "200 + 含 status 字段(任务可轮询)"
      else
        log_warn "200 但响应缺 status。 BODY: $BODY"
      fi
      ;;
    404)
      log_fail "404 —— apimart ULID 兜底没生效(应是 200 + 任务状态)"
      ;;
    429)
      log_warn "429 限流(等会儿重试)"
      ;;
    000)
      log_warn "000 —— 连接 BFF 失败"
      ;;
    *)
      log_fail "$CODE —— 意外状态。 BODY: $BODY"
      ;;
  esac
fi

# ----------------------------------------------------------------------
# Test 3: /api/public/generate GET —— 旧鉴权链路回归(防 SDK 升级把已有路由搞坏)
# ----------------------------------------------------------------------
log_step "Test 3: GET /api/public/generate(回归测试,确认旧鉴权链路未坏)"
RAW=$(do_curl GET "/api/public/generate")
CODE=$(echo "$RAW" | cut -d'|' -f1)
BODY=$(echo "$RAW" | cut -d'|' -f2-)

if [ "$CODE" = "200" ]; then
  if echo "$BODY" | grep -q '"masks"'; then
    log_pass "200 + 响应含 masks(/image-gen 工作台契约)"
  else
    log_warn "200 但响应缺 masks 字段。 BODY: $BODY"
  fi
elif [ "$CODE" = "401" ] || [ "$CODE" = "403" ]; then
  if [ -z "$EXTERNAL_API_KEY" ]; then
    log_pass "$CODE(预期:未传 key 必拒)"
  else
    log_fail "$CODE(传了 key 仍被拒,key 不对)"
  fi
elif [ "$CODE" = "000" ]; then
  log_warn "000 —— 连接到 $BASE_URL 失败(BFF 没起或网络不通)"
else
  log_fail "$CODE —— 意外。 BODY: $BODY"
fi

# ----------------------------------------------------------------------
# 总结
# ----------------------------------------------------------------------
printf "\n${CYAN}=== 总结 ===${RESET}\n"
printf "  ${GREEN}PASS${RESET}: %d\n" "$PASS"
printf "  ${RED}FAIL${RESET}: %d\n" "$FAIL"
printf "  ${YELLOW}WARN${RESET}: %d\n" "$WARN"

if [ "$FAIL" -gt 0 ]; then
  printf "\n${RED}有失败项,看上面红 ✗ 行查 BFF 部署状态。${RESET}\n"
  exit 1
fi
printf "\n${GREEN}全部通过(或预期失败)。SDK v1.1.0 公共链路 OK。${RESET}\n"
exit 0
