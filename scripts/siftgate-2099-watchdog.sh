#!/bin/bash
# 探活自愈：launchd 的 KeepAlive 只看进程是否存活，无法发现
# 「进程活着但监听已关、不再接受请求」的哑火状态（2026-09-07 发生过一次）。
# 本脚本用 /health 作为真实可用性判据，连续失败达阈值才重启，避免启动期误杀。

set -uo pipefail

readonly LABEL="com.sean.siftgate-2099"
readonly HEALTH_URL="http://127.0.0.1:2099/health"
readonly LOG_FILE="$HOME/Library/Logs/siftgate-2099/watchdog.log"
readonly STATE_FILE="/tmp/siftgate-2099-watchdog.fails"
readonly TIMEOUT=8
readonly FAIL_THRESHOLD=2

mkdir -p "$(dirname "$LOG_FILE")"

log() {
  printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" >>"$LOG_FILE"
}

http_code=$(curl -sS -m "$TIMEOUT" -o /dev/null -w '%{http_code}' "$HEALTH_URL" 2>/dev/null)

if [ "$http_code" = "200" ]; then
  # 恢复正常，清空失败计数
  [ -f "$STATE_FILE" ] && rm -f "$STATE_FILE"
  exit 0
fi

fails=0
[ -f "$STATE_FILE" ] && fails=$(cat "$STATE_FILE" 2>/dev/null || echo 0)
case "$fails" in
  ''|*[!0-9]*) fails=0 ;;
esac
fails=$((fails + 1))
printf '%s' "$fails" >"$STATE_FILE"

log "健康检查失败（HTTP ${http_code:-无响应}），连续第 ${fails} 次，阈值 ${FAIL_THRESHOLD}"

if [ "$fails" -lt "$FAIL_THRESHOLD" ]; then
  exit 0
fi

pid_before=$(launchctl list | awk -v l="$LABEL" '$3 == l {print $1}')
log "达到阈值，重启服务（重启前 PID: ${pid_before:-无}）"

if launchctl kickstart -k "gui/$(id -u)/${LABEL}" >>"$LOG_FILE" 2>&1; then
  sleep 12
  recheck=$(curl -sS -m "$TIMEOUT" -o /dev/null -w '%{http_code}' "$HEALTH_URL" 2>/dev/null)
  pid_after=$(launchctl list | awk -v l="$LABEL" '$3 == l {print $1}')
  if [ "$recheck" = "200" ]; then
    log "重启成功，服务已恢复（新 PID: ${pid_after:-未知}）"
    rm -f "$STATE_FILE"
  else
    log "重启后仍不健康（HTTP ${recheck:-无响应}，PID: ${pid_after:-未知}），需人工介入"
  fi
else
  log "kickstart 执行失败，需人工介入"
fi
