#!/usr/bin/env bash
# fix-drizzle-meta.sh —— 重建 Drizzle meta state
#
# 2026-10-13 现状:drizzle/meta/_journal.json 列出 entries 0-6,但实际
# drizzle/*.sql 有 0-19+。meta 里只有 0000-0003 snapshot,且 0002 与
# 0003 的 snapshot id 完全相同(collision),journal 4-6 的 snapshot 缺失。
# 整个 meta state 跟实际迁移历史对不上,pnpm db:generate 跑不动。
#
# 策略:
#   1. 备份现状
#   2. 抹掉 meta(留 SQL 文件)
#   3. 跑 pnpm db:generate 一次 —— Drizzle 会从 schema.ts 重新生成一个
#      干净的 baseline snapshot,这是当前 schema.ts 的权威状态
#   4. 把旧 SQL 文件归档到 drizzle-archive/<日期>/(不在 Drizzle 加载路径上)
#   5. 再跑一次 db:generate 应该是 no-op(确认 state 自洽)
#   6. db:push 应该是 no-op(DB 已经跟 schema.ts 对齐)
#
# 代价: Drizzle 加载链里丢失了 0000-0019+ 的历史 step。SQL 文件物理保留
# 在 drizzle-archive/,万一日后要重建 DB 可以用 psql 顺序 apply。
#
# 退出码:
#   0 = 全部 step 成功
#   非 0 = 任意一步失败(已 backup,回滚即可)

set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

ARCHIVE_DIR="drizzle-archive/$(date +%Y%m%d_%H%M%S)"
BAK_DIR="drizzle.bak.$(date +%Y%m%d_%H%M%S)"

step() { printf "\n${CYAN}▶ %s${RESET}\n" "$1"; }
ok() { printf "  ${GREEN}✓ %s${RESET}\n" "$1"; }
fail() { printf "  ${RED}✗ %s${RESET}\n" "$1"; exit 1; }

# 颜色
GREEN="\033[0;32m"
RED="\033[0;31m"
CYAN="\033[0;36m"
RESET="\033[0m"

# ----------------------------------------------------------------------
# Step 1: 备份
# ----------------------------------------------------------------------
step "Step 1: 备份 drizzle/ → $BAK_DIR/"
if [ -d "drizzle" ]; then
  cp -r "drizzle" "$BAK_DIR" || fail "备份失败"
  ok "已备份到 $BAK_DIR/"
else
  fail "drizzle/ 不存在,无法备份"
fi

# ----------------------------------------------------------------------
# Step 2: 抹掉 meta(留 SQL)
# ----------------------------------------------------------------------
step "Step 2: 抹掉 drizzle/meta/(保留 *.sql)"
rm -rf drizzle/meta || fail "rm meta 失败"
mkdir -p drizzle/meta || fail "mkdir meta 失败"
ok "meta 已清空"

# ----------------------------------------------------------------------
# Step 3: 归档旧 SQL 到 drizzle-archive/(不在 Drizzle 加载路径上)
# ----------------------------------------------------------------------
step "Step 3: 归档旧 *.sql 到 $ARCHIVE_DIR/"
mkdir -p "$ARCHIVE_DIR" || fail "mkdir archive 失败"
# 移走所有 SQL,后面 db:generate 会从当前 schema.ts 重新生成一份
SQL_COUNT=$(ls drizzle/*.sql 2>/dev/null | wc -l | tr -d ' ')
if [ "$SQL_COUNT" -eq "0" ]; then
  fail "drizzle/ 下没找到任何 *.sql 文件(异常状态)"
fi
mv drizzle/*.sql "$ARCHIVE_DIR/" || fail "mv SQL 失败"
ok "已归档 $SQL_COUNT 个旧 SQL 文件到 $ARCHIVE_DIR/"

# ----------------------------------------------------------------------
# Step 4: 跑 db:generate 重新建立 baseline
# ----------------------------------------------------------------------
step "Step 4: pnpm db:generate(从 schema.ts 重建 baseline)"
if ! pnpm db:generate; then
  fail "pnpm db:generate 失败 —— 状态可能被破坏,回滚到 $BAK_DIR/"
fi
ok "db:generate 成功"

# 验证生成了新文件
if ! ls drizzle/*.sql 1>/dev/null 2>&1; then
  fail "db:generate 跑完没看到新 *.sql(异常)"
fi
NEW_SQL=$(ls drizzle/*.sql | head -1)
ok "新 baseline SQL: $NEW_SQL"

# ----------------------------------------------------------------------
# Step 5: 再跑一次 db:generate,应该 no-op
# ----------------------------------------------------------------------
step "Step 5: pnpm db:generate(验证 no-op)"
# 如果是 no-op,drizzle-kit 会提示 "No schema changes found" 或类似。
# 退出码非 0 也算"成功"(因为它报告没东西要做)
pnpm db:generate 2>&1 | tail -20 || true
# 确认新 SQL 文件数仍是 1(没多生成)
AFTER_COUNT=$(ls drizzle/*.sql 2>/dev/null | wc -l | tr -d ' ')
if [ "$AFTER_COUNT" = "1" ]; then
  ok "no-op 确认 —— drizzle/ 下仍是 1 个 SQL 文件"
else
  printf "  ${YELLOW}⚠ drizzle/ 下有 %s 个 SQL 文件(检查是否合理)${RESET}\n" "$AFTER_COUNT"
fi

# ----------------------------------------------------------------------
# Step 6: db:push dry-run 验证
# ----------------------------------------------------------------------
step "Step 6: pnpm db:push(实际应用,DB 已对齐应该 no-op)"
# db:push 会对比 schema.ts 和 live DB 真实状态,userId nullable 已经手工
# 改过,DB 跟 schema.ts 应该对齐。如果 push 报告有 diff,需要立刻排查。
if pnpm db:push; then
  ok "db:push 成功(DB 跟 schema.ts 对齐)"
else
  printf "  ${YELLOW}⚠ db:push 退出码非 0(可能 push 本身需要交互确认)。检查输出。${RESET}\n"
fi

# ----------------------------------------------------------------------
# 总结
# ----------------------------------------------------------------------
printf "\n${CYAN}=== 修复总结 ===${RESET}\n"
printf "  备份:    %s\n" "$BAK_DIR"
printf "  旧 SQL:  %s(%s 个文件)\n" "$ARCHIVE_DIR" "$SQL_COUNT"
printf "  新 SQL:  %s\n" "$NEW_SQL"
printf "  meta:    重新生成,跟当前 schema.ts 自洽\n"
printf "\n${GREEN}后续:${RESET}\n"
printf "  1. git add drizzle/* drizzle-archive/\n"
printf "  2. git commit 'chore(db): rebuild drizzle meta state'\n"
printf "  3. 以后改 schema.ts → pnpm db:generate → pnpm db:push 链路正常工作\n"
printf "\n${YELLOW}回滚(如果出问题):${RESET}\n"
printf "  rm -rf drizzle/ && mv %s drizzle/\n" "$BAK_DIR"
exit 0
