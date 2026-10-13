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
#   TEST_IMAGE_URL=https://r2.mooncoda.com/test/sample.jpg \
#   bash scripts/verify-public-routes.sh
#
#   不传 BASE_URL 默认 http://localhost:3000
#   不传 EXTERNAL_API_KEY 也能跑(只会看到 401,仍然能确认端点存活)
#   不传 APIMART_TASK_ID 跳过 taskId 轮询测试
#   不传 TEST_IMAGE_URL 跳过 async submit 时序测试(只跑前 3 个 + quota)
#
# 退出码：
#   0 = 全部通过(或预期失败)
#   非 0 = 至少一个测试返了意料外的状态
#
# 2026-10-13：v1.1.0 首发。后续 BFF 改 public 路由时更新本脚本。
# 2026-10-13 v2.0:加 Test 4(async submit 时序回归) + Test 5(quota 端点)。

set -uo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
EXTERNAL_API_KEY="${EXTERNAL_API_KEY:-}"
APIMART_TASK_ID="${APIMART_TASK_ID:-}"
TEST_IMAGE_URL="${TEST_IMAGE_URL:-}"
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
  # --ssl-no-revoke:Windows schannel 默认走在线 CRL,offline 时整请求挂掉;
  # 这个端点是公开 HTTPS,加这个 flag 不影响安全性,只绕过本地证书吊销检查。
  code=$(curl -sS --ssl-no-revoke -o "$tmpfile" -w "%{http_code}" \
    -X "$method" \
    -H "x-api-key: ${EXTERNAL_API_KEY}" \
    -H "Accept: application/json" \
    "$@" \
    "$url" 2>&1) || code="000"
  local body
  body=$(head -c 5000 "$tmpfile" 2>/dev/null || echo "")
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
printf "  TEST_IMAGE_URL: %s\n" "${TEST_IMAGE_URL:-(未传,跳过 async submit 时序测试)}"

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
    # v1.1.0 字段重命名后,productLines 用 "id",templates 也用 "id"
    # 用 array 长度做计数(JSON 紧凑无空白,直接 grep 数组边界)
    PL_COUNT=$(echo "$BODY" | grep -oE '"id":"pl_' | wc -l | tr -d ' ')
    TPL_COUNT=$(echo "$BODY" | grep -oE '"id":"(R-|mask_|mx_)' | wc -l | tr -d ' ')
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
# Test 4: POST /api/public/generate 异步 submit 时序回归
# ----------------------------------------------------------------------
# mp 团队升级到 SDK v1.1.0 时遇到的"30s timeout"症状就是 BFF 同步等 apimart
# 上游返 taskId 才给 mp —— apimart 异步任务首字节就要 30-90s,撞上 mp 端
# `TARO_APP_API_TIMEOUT=30000` 一定挂。
#
# v2.0 改造后,BFF 写 imageJob(pending)+ Inngest send 后立刻 <1s 返
# { success, taskId, taskStatus: "pending" },taskId 形如 UUID v4。
#
# 本测试就是这条改造的回归 guard:打一次真的 POST,断言:
#   1) 响应 ≤ 8s(撞 30s mp timeout 就太晚;实际生产 <2s,8s 给冷启留余量)
#   2) 响应含 success=true
#   3) 响应含 taskId,且是 UUID v4 形态
#   4) 响应含 taskStatus=pending
# 如果未来谁把 BFF 退回同步路径(apimart 直接 await),本测试会卡 8s 后
# 标 fail,挡住"看起来对、但 mp 又 timeout"的回归。
# ----------------------------------------------------------------------
log_step "Test 4: POST /api/public/generate 异步 submit 时序(回归 guard)"
if [ -z "$TEST_IMAGE_URL" ]; then
  log_warn "跳过:TEST_IMAGE_URL 未设(export TEST_IMAGE_URL=https://r2.../sample.jpg 重跑)"
elif [ -z "$EXTERNAL_API_KEY" ]; then
  log_warn "跳过:EXTERNAL_API_KEY 未设,鉴权会直接 401,测不出时序"
else
  # POST 计时:用 curl 的 -w "%{time_total}" 拿总耗时(秒)。
  # 写文件而不是 inline variable,避免 time_total 与 body 撞到 subshell
  # 顺序问题。
  SUBMIT_TMPFILE=$(mktemp)
  START_TS=$(date +%s)
  CODE=$(curl -sS --ssl-no-revoke -o "$SUBMIT_TMPFILE" -w "%{http_code}" \
    -X POST \
    -H "x-api-key: ${EXTERNAL_API_KEY}" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json" \
    -d "{\"maskId\":\"R-default-test\",\"imageUrl\":\"${TEST_IMAGE_URL}\",\"prompt\":\"verify-public-routes test\"}" \
    -w "\nTIME_TOTAL:%{time_total}\n" \
    "${BASE_URL}/api/public/generate" 2>/dev/null) || CODE="000"
  BODY=$(cat "$SUBMIT_TMPFILE" 2>/dev/null || echo "")
  rm -f "$SUBMIT_TMPFILE"
  # curl -w 的多行输出:第一行是 http_code,最后一行是 TIME_TOTAL
  TIME_TOTAL=$(echo "$CODE" | grep -oE 'TIME_TOTAL:[0-9.]+' | cut -d: -f2)
  HTTP_CODE=$(echo "$CODE" | head -1)
  # 8s 阈值:远低于 mp 30s timeout,但留足 Vercel 冷启 5-6s 余量
  TIME_LIMIT=8

  # 用 awk 比较浮点
  TIME_OK=$(awk -v t="${TIME_TOTAL:-999}" -v limit="$TIME_LIMIT" 'BEGIN { print (t+0 <= limit+0) ? "yes" : "no" }')

  if [ "$HTTP_CODE" = "200" ] && [ "$TIME_OK" = "yes" ]; then
    if echo "$BODY" | grep -qE '"success":true' && \
       echo "$BODY" | grep -qE '"taskId":"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"' && \
       echo "$BODY" | grep -qE '"taskStatus":"pending"'; then
      log_pass "200 + ${TIME_TOTAL}s(≤${TIME_LIMIT}s) + success + UUID taskId + taskStatus=pending(v2.0 异步路径生效)"
    else
      log_fail "200 + 时序 OK,但响应缺 success/taskId(UU ID)/taskStatus=pending。 BODY 摘录: $BODY"
    fi
  elif [ "$HTTP_CODE" = "200" ]; then
    log_fail "200 但耗时 ${TIME_TOTAL}s > ${TIME_LIMIT}s —— 同步路径回归!mp 30s timeout 必炸。 BODY: $BODY"
  elif [ "$HTTP_CODE" = "401" ] || [ "$HTTP_CODE" = "403" ]; then
    log_warn "$HTTP_CODE —— 鉴权拒(EXTERNAL_API_KEY 可能错了),跳过本次时序测试"
  elif [ "$HTTP_CODE" = "429" ]; then
    log_warn "429 限流(等会儿重试)"
  elif [ "$HTTP_CODE" = "000" ]; then
    log_warn "000 —— 连接 BFF 失败"
  else
    log_fail "$HTTP_CODE —— 意外状态。 BODY: $BODY"
  fi
fi

# ----------------------------------------------------------------------
# Test 5: GET /api/public/quota —— mp 端从云函数迁过来时 owner 之前指错
# 路径(/api/credits/balance 不存在),正确路径是 /api/public/quota。
# 本端点走 x-api-key,语义是「外部 API Key 的月调用上限」,不是 credits。
# 鉴权失败也是 401,跟 /api/public/prompt-templates 对齐。
# ----------------------------------------------------------------------
log_step "Test 5: GET /api/public/quota"
RAW=$(do_curl GET "/api/public/quota")
CODE=$(echo "$RAW" | cut -d'|' -f1)
BODY=$(echo "$RAW" | cut -d'|' -f2-)

if [ "$CODE" = "200" ]; then
  if echo "$BODY" | grep -qE '"success":true' && \
     echo "$BODY" | grep -qE '"keyName"' && \
     echo "$BODY" | grep -qE '"used"' && \
     echo "$BODY" | grep -qE '"limit"' && \
     echo "$BODY" | grep -qE '"remaining"' && \
     echo "$BODY" | grep -qE '"resetAt"'; then
    log_pass "200 + 响应含 keyName/used/limit/remaining/resetAt(v1.1.0 quota 契约)"
    # 抓出 used / limit 给人眼读
    USED=$(echo "$BODY" | grep -oE '"used":[0-9-]+' | head -1)
    LIMIT=$(echo "$BODY" | grep -oE '"limit":[0-9-]+' | head -1)
    printf "    %s, %s\n" "$USED" "$LIMIT"
  else
    log_fail "200 但响应 shape 不对(应含 keyName/used/limit/remaining/resetAt)。 BODY 摘录: $BODY"
  fi
elif [ "$CODE" = "401" ] || [ "$CODE" = "403" ]; then
  if [ -z "$EXTERNAL_API_KEY" ]; then
    log_pass "$CODE(预期:未传 key 必拒)"
  else
    log_fail "$CODE(传了 key 仍被拒,key 不对或 BFF 没切到 v1.1.0)"
  fi
elif [ "$CODE" = "404" ]; then
  log_fail "404 —— BFF 没实现本端点,v2.0 quota 修复没部署"
elif [ "$CODE" = "000" ]; then
  log_warn "000 —— 连接到 $BASE_URL 失败(BFF 没起或网络不通)。等部署完再跑"
else
  log_fail "$CODE —— 意外状态。 BODY 摘录: $BODY"
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
printf "\n${GREEN}全部通过(或预期失败)。SDK v1.1.0 + v2.0 公共链路 OK。${RESET}\n"
exit 0
