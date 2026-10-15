#!/usr/bin/env bash
# Tandem wake monitor (G1, docs/HOOKS.md "The wake endpoint and wake.sh").
#
# Usage: run by the agent's own Claude Code session as a Monitor (the /tandem skill, "Start of a session"):
#   Monitor({ command: "bash .claude/hooks/wake.sh", description: "Tandem mail for <agent_id>", timeout_ms: 1800000 })
# Every line it prints to stdout starts a new turn in that session, so it prints only these lines:
#   - "Tandem: <n> unread message(s) for <agent>, newest #<id> from <sender> (<kind>). Call read_messages, ... max_id=<id>"
#     when mail arrived (at most one every 20 s), checked against the hub's grammar before it is printed;
#   - "Tandem wake is off for <agent> on the board: do not re-arm the monitor. wake=off", then it exits 0;
#   - "Tandem wake: the hub refused HUB_TOKEN (HTTP <code>); stop and tell your human.", then it exits 1;
#   - one line when HUB_TOKEN, TANDEM_URL or curl is missing, then it exits 1;
#   - "Tandem wake: hub unreachable for 10 min, still retrying." once per outage.
# An unreachable hub, a 5xx or a 429 prints nothing: it retries after 5 s, doubling up to 60 s.
#
# Environment: HUB_TOKEN (the agent token: it only ever goes to curl's Authorization header through stdin, never into the
# command line, a URL or the output) and TANDEM_URL (the hub address; K8 renders the default below when the repo is set up).
# For tests only: TANDEM_WAKE_PAUSE_S (the pause after an event, default 20), TANDEM_WAKE_BACKOFF_S (the first retry
# delay, default 5) and TANDEM_WAKE_NOTICE_S (the outage notice, default 600).
#
# Portable: bash 3.2 (macOS), Git Bash on Windows and Linux; POSIX tools and curl only.

base="${TANDEM_URL:-https://teamclaude.lovkarsquid.com}"
base="${base%/}"
case "$base" in
  http://*|https://*) ;;
  *) echo "Tandem wake: TANDEM_URL is not set; stop and tell your human."; exit 1 ;;
esac
if [ -z "${HUB_TOKEN:-}" ]; then
  echo "Tandem wake: HUB_TOKEN is empty; stop and tell your human."
  exit 1
fi
case "$HUB_TOKEN" in
  *[!A-Za-z0-9_-]*) echo "Tandem wake: HUB_TOKEN is not a Tandem token; stop and tell your human."; exit 1 ;;
esac
if ! command -v curl >/dev/null 2>&1; then
  echo "Tandem wake: curl is not installed; stop and tell your human."
  exit 1
fi

digits_or() {
  case "$1" in
    ''|*[!0-9]*) echo "$2" ;;
    *) echo "$1" ;;
  esac
}
pause_s="$(digits_or "${TANDEM_WAKE_PAUSE_S:-}" 20)"
backoff_first="$(digits_or "${TANDEM_WAKE_BACKOFF_S:-}" 5)"
notice_s="$(digits_or "${TANDEM_WAKE_NOTICE_S:-}" 600)"
[ "$backoff_first" -ge 1 ] || backoff_first=1

# The hub's two lines, exactly (src/wake.mjs); anything else is never printed.
mail_re='^Tandem: [0-9]+ unread message\(s\) for [a-z0-9-]+, newest #[0-9]+ from [a-z0-9-]+ \([a-z_]+\)\. Call read_messages, then handle them by the /tandem rules\. max_id=[0-9]+$'
off_re='^Tandem wake is off for [a-z0-9-]+ on the board: do not re-arm the monitor\. wake=off$'

tmp="$(mktemp 2>/dev/null || mktemp -t tandem-wake 2>/dev/null)" || tmp=""
if [ -z "$tmp" ] || [ ! -f "$tmp" ]; then
  echo "Tandem wake: cannot create a temp file; stop and tell your human."
  exit 1
fi
child=""
cleanup() {
  if [ -n "$child" ]; then kill "$child" 2>/dev/null; fi
  rm -f "$tmp"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

# A child in the background and `wait`, so a stop signal ends the script (and its curl or sleep) at once.
nap() {
  sleep "$1" &
  child=$!
  wait "$child"
  child=""
}

after=0
fail_since=""
noticed=0
backoff="$backoff_first"

healthy() {
  fail_since=""
  noticed=0
  backoff="$backoff_first"
}

failed() {
  if [ -z "$fail_since" ]; then fail_since=$SECONDS; fi
  if [ "$noticed" -eq 0 ] && [ $((SECONDS - fail_since)) -ge "$notice_s" ]; then
    echo "Tandem wake: hub unreachable for 10 min, still retrying."
    noticed=1
  fi
  nap "$backoff"
  backoff=$((backoff * 2))
  if [ "$backoff" -gt 60 ]; then backoff=60; fi
}

while :; do
  : > "$tmp"
  # -K - reads the header from stdin (curl's config syntax), so the token is never an argument anyone can list.
  printf 'header = "Authorization: Bearer %s"\n' "$HUB_TOKEN" \
    | curl -s --connect-timeout 10 --max-time 60 -w '\n%{http_code}' -K - "$base/agent/wake?after=$after&wait=50" >"$tmp" 2>/dev/null &
  child=$!
  wait "$child"
  child=""
  out="$(cat "$tmp" 2>/dev/null)"
  code="${out##*$'\n'}"
  body="${out%$'\n'*}"
  [ "$body" != "$out" ] || body=""
  line="${body%%$'\n'*}"
  line="${line%$'\r'}"

  case "$code" in
    200)
      if [[ $line =~ $off_re ]]; then
        echo "$line"
        exit 0
      fi
      # The hub names the same id twice (newest #<id> and max_id=<id>); a line where they differ is not the hub's.
      newest="${line#*, newest #}"
      newest="${newest%% from *}"
      if [[ $line =~ $mail_re ]] && [ "$newest" = "${line##*max_id=}" ]; then
        echo "$line"
        after="${line##*max_id=}"
        healthy
        nap "$pause_s"
      else
        failed
      fi
      ;;
    204)
      # The hold ran to its deadline: poll again at once (the brief). The hub answers 204 only at the end of a hold, and its
      # wake bucket (30 a minute, then 429 and the quiet back-off below) bounds any faster loop against it (D-212).
      healthy
      ;;
    401|403)
      echo "Tandem wake: the hub refused HUB_TOKEN (HTTP $code); stop and tell your human."
      exit 1
      ;;
    *)
      failed
      ;;
  esac
done
