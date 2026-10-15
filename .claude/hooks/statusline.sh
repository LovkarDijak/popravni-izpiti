#!/usr/bin/env bash
# Tandem status line (K15, docs/HOOKS.md "The plan limit and statusline.sh").
#
# Usage: Claude Code runs it as the project's statusLine command (.claude/settings.json) with the session's JSON on stdin:
#   "statusLine": { "type": "command", "command": "bash \"${CLAUDE_PROJECT_DIR:-.}/.claude/hooks/statusline.sh\"", "refreshInterval": 60 }
# It prints ONE short line for the terminal and nothing else:
#   "Tandem · 5 h 23 % · teden 41 %" from the JSON's rate_limits (Pro and Max plans; either window may be missing), else "Tandem".
# At most once a minute it also sends the two windows to the hub, in the background (POST /agent/usage, stored as source cli):
#   {"five_hour":{"used_percentage":23.5,"resets_at":1738425600},"seven_day":{"used_percentage":41.2,"resets_at":1738857600}}
# and nothing else of the session's JSON. The time of the last send is kept in a file in the temp folder whose name holds a
# SHA-256 of the hub address and the token, never the token itself; several terminals of one agent share it, and a claim file
# created with noclobber lets only one of them report per minute. Without curl, HUB_TOKEN, a hub address, rate_limits or a
# SHA-256 program it only prints the line. It always exits 0 and never waits for the hub: curl runs in the background with short
# timeouts, its output discarded.
#
# Environment: HUB_TOKEN (the agent token: it only ever goes to curl's Authorization header through stdin, never into the
# command line, a URL or the output), TANDEM_URL (the hub address; the installer renders the default below) and TMPDIR.
#
# The JSON: with node on the PATH it is read with JSON.parse; without node a bash fallback reads only used_percentage and
# resets_at inside "five_hour" and "seven_day" of the "rate_limits" object (compact or pretty JSON) with the shell's own pattern
# matching. The input is never evaluated, and every number is checked again here before it is printed or sent.
#
# Fast: Claude Code runs it after every assistant message, and starting a program costs about 0.1 s on Windows, so the script
# starts at most two (node, or the hash program and date without node) besides curl in the background.
# Portable: bash 3.2 (macOS), Git Bash on Windows and Linux; POSIX tools, node and curl when present.

IFS= read -r -d '' input || true
five_pct=""
five_at=""
week_pct=""
week_at=""
now=""
key=""

# Where a report would go, checked before anything is parsed: a hub address (http or https) and a token of Tandem's alphabet.
base="${TANDEM_URL:-https://teamclaude.lovkarsquid.com}"
base="${base%/}"
can_send=1
case "$base" in
  http://*|https://*) ;;
  *) can_send=0 ;; # not configured (the placeholder was never rendered)
esac
case "${HUB_TOKEN:-}" in
  ''|*[!A-Za-z0-9_-]*) can_send=0 ;;
esac
command -v curl >/dev/null 2>&1 || can_send=0

vals=""
if command -v node >/dev/null 2>&1; then
  # Six words: the 5-hour percent and reset, the weekly percent and reset ("-" for anything missing or not a plain number), the
  # time now in Unix seconds and, when a report can be sent, the hash for the file name (the token itself is never printed).
  vals="$(TANDEM_BASE="$base" TANDEM_KEY="$can_send" node -e '
    let s = "";
    process.stdin.on("data", (c) => { s += c; });
    process.stdin.on("end", () => {
      const win = (o) => {
        if (o === null || typeof o !== "object") return "- -";
        let p = o.used_percentage;
        if (typeof p !== "number" || !Number.isFinite(p) || p < 0) return "- -";
        p = Math.round(Math.min(p, 100) * 10) / 10;
        // The hub takes a reset time from 2001 to 2100 and refuses the whole report otherwise: one outside that is left out alone.
        const t = o.resets_at;
        const at = typeof t === "number" && Number.isFinite(t) && t >= 1e9 && t <= 4102444800 ? String(Math.floor(t)) : "-";
        return String(p) + " " + at;
      };
      let out = "- - - -";
      try {
        const r = JSON.parse(s).rate_limits;
        if (r !== null && typeof r === "object") out = win(r.five_hour) + " " + win(r.seven_day);
      } catch {}
      let key = "-";
      if (process.env.TANDEM_KEY === "1") {
        const h = require("crypto").createHash("sha256");
        key = h.update(process.env.TANDEM_BASE + "\n" + process.env.HUB_TOKEN).digest("hex").slice(0, 16);
      }
      process.stdout.write(out + " " + Math.floor(Date.now() / 1000) + " " + key);
    });
  ' 2>/dev/null <<< "$input")" || vals=""
  read -r five_pct five_at week_pct week_at now key _ <<< "$vals"
fi
if [ -z "$vals" ]; then
  # No node, or node gave nothing: the shell's own matching, no program started. Only the "rate_limits" object counts (a
  # "five_hour" anywhere else in the session's JSON is not a usage report, D-238): its inside may hold objects but none within
  # them, as Claude Code sends it; anything deeper is not read at all. A window is the inside of its object in there (it holds no
  # braces). A name counts only as a key, never as an escaped quote inside a string; a field is the plain number after its name,
  # followed by a comma or the end.
  flat="${input//$'\r'/ }"
  flat="${flat//$'\n'/ }"
  limits_re='(^|[^\\])"rate_limits"[[:space:]]*:[[:space:]]*[{](([^{}]*[{][^{}]*[}])*[^{}]*)[}]'
  win_re='(^|[^\\])"WIN"[[:space:]]*:[[:space:]]*[{]([^{}]*)[}]'
  field_re='"FIELD"[[:space:]]*:[[:space:]]*([0-9]+([.][0-9]+)?)[[:space:]]*(,|$)'
  limits=""
  if [[ $flat =~ $limits_re ]]; then limits="${BASH_REMATCH[2]}"; fi
  for w in five_hour seven_day; do
    [ -n "$limits" ] || break
    re="${win_re/WIN/$w}"
    [[ $limits =~ $re ]] || continue
    inner="${BASH_REMATCH[2]}"
    re="${field_re/FIELD/used_percentage}"
    p=""
    a=""
    if [[ $inner =~ $re ]]; then p="${BASH_REMATCH[1]}"; fi
    re="${field_re/FIELD/resets_at}"
    if [[ $inner =~ $re ]]; then a="${BASH_REMATCH[1]}"; fi
    if [ "$w" = five_hour ]; then five_pct="$p"; five_at="$a"; else week_pct="$p"; week_at="$a"; fi
  done
fi

# A percent: digits with at most one dot, at most 100 (more is read as 100, as Claude Code's own bar would show it full). Sets
# the variable named by $1 with printf -v (no subshell: each one would cost a fork; nothing is evaluated).
check_pct() {
  local v="$2" int
  case "$v" in
    ''|*[!0-9.]*|.*|*.|*.*.*) v="" ;;
  esac
  if [ -n "$v" ]; then
    int="${v%%.*}"
    if [ "${#int}" -gt 3 ] || [ "$int" -gt 100 ] || { [ "$int" -eq 100 ] && [ "$int" != "$v" ]; }; then v=100; fi
  fi
  printf -v "$1" '%s' "$v"
}
# A reset time: whole Unix seconds from 2001 to 2100, the hub's range (outside it the hub would refuse the whole report, so the
# reset time alone is left out).
check_at() {
  local v="$2"
  case "$v" in
    ''|*[!0-9]*) v="" ;;
  esac
  [ "${#v}" -le 11 ] || v=""
  if [ -n "$v" ]; then
    v=$((10#$v))
    if [ "$v" -lt 1000000000 ] || [ "$v" -gt 4102444800 ]; then v=""; fi
  fi
  printf -v "$1" '%s' "$v"
}
check_pct five_pct "$five_pct"
check_at five_at "$five_at"
check_pct week_pct "$week_pct"
check_at week_at "$week_at"
[ -n "$five_pct" ] || five_at=""
[ -n "$week_pct" ] || week_at=""

line="Tandem"
[ -z "$five_pct" ] || line="$line · 5 h ${five_pct%%.*} %"
[ -z "$week_pct" ] || line="$line · teden ${week_pct%%.*} %"
printf '%s\n' "$line"

# ------------------------------------------------------------------------------------- the report to the hub (at most once a minute)
[ -n "$five_pct$week_pct" ] || exit 0
[ "$can_send" = 1 ] || exit 0
dir="${TMPDIR:-/tmp}"
dir="${dir%/}"
[ -n "$dir" ] && [ -d "$dir" ] && [ -w "$dir" ] || exit 0

# The file name holds a SHA-256 of the hub address and the token (node above, else sha256sum or shasum, whichever is there;
# without either nothing is sent): nobody can guess it, and the token is never in it. The token reaches the hash program only
# through a pipe.
case "$key" in
  ''|-) key="" ;;
esac
if [ -z "$key" ]; then
  if command -v sha256sum >/dev/null 2>&1; then
    key="$(printf '%s\n%s' "$base" "$HUB_TOKEN" | sha256sum 2>/dev/null)"
  elif command -v shasum >/dev/null 2>&1; then
    key="$(printf '%s\n%s' "$base" "$HUB_TOKEN" | shasum -a 256 2>/dev/null)"
  fi
  key="${key%% *}"
fi
# At least 16 hex digits of it (a SHA-256 has 64); anything else (no hash program, an error) sends nothing.
case "$key" in
  *[!0-9a-f]*) exit 0 ;;
esac
[ "${#key}" -ge 16 ] || exit 0
key="${key:0:16}"
stamp="$dir/tandem-usage-$key"

case "$now" in
  ''|*[!0-9]*) now="${EPOCHSECONDS:-}" ;;
esac
case "$now" in
  ''|*[!0-9]*) now="$(date +%s 2>/dev/null)" ;;
esac
case "$now" in
  ''|*[!0-9]*) exit 0 ;;
esac
now=$((10#$now))
# A time read from a file: digits only, at most 12, read as decimal (10# keeps a leading zero from reading as octal: that error
# would end the script with 1); anything else is empty.
read_time() {
  local v=""
  if [ -f "$2" ]; then
    read -r v 2>/dev/null < "$2" || true
  fi
  case "$v" in
    ''|*[!0-9]*) v="" ;;
  esac
  [ "${#v}" -le 12 ] || v=""
  [ -z "$v" ] || v=$((10#$v))
  printf -v "$1" '%s' "$v"
}
read_time last "$stamp"
if [ -n "$last" ] && [ "$now" -ge "$last" ] && [ $((now - last)) -lt 60 ]; then
  exit 0
fi

# Several terminals of one agent run this at the same moment, and reading the time above and writing it below are two steps.
# So the right to report after the state just read is a claim file named after it ($stamp.<last>, .0 when there was none),
# created only when it does not exist yet: with noclobber bash opens a new file with O_EXCL, so of two runs exactly one gets
# it (D-238). That one writes the new time and reports; every other run stops here. A claim stays until the next report, so a
# run that read the old time a moment too late finds it taken.
umask 077
claim="$stamp.${last:-0}"
set -C
if ! { printf '%s\n' "$now" > "$claim"; } 2>/dev/null; then
  set +C
  # Taken. If that was a minute ago or more and the time file still says $last, the run that took it was stopped before it
  # wrote the time (Claude Code ends a status line that is still running when the next update comes): write its time for it,
  # so the next run claims a new state instead of finding this one taken for ever. An empty claim is one being written.
  read_time held "$claim"
  if [ -z "$held" ] || { [ "$now" -ge "$held" ] && [ $((now - held)) -ge 60 ]; }; then
    printf '%s\n' "${held:-$now}" 2>/dev/null > "$stamp"
  fi
  exit 0
fi
set +C
# Written before the send, so a hub that is down is asked again a minute later, not on every status line update.
printf '%s\n' "$now" 2>/dev/null > "$stamp" || exit 0

body=""
add_window() {
  [ -n "$2" ] || return 0
  local w="\"used_percentage\":$2"
  [ -z "$3" ] || w="$w,\"resets_at\":$3"
  body="${body:+$body,}\"$1\":{$w}"
}
add_window five_hour "$five_pct" "$five_at"
add_window seven_day "$week_pct" "$week_at"
body="{$body}"

# -K - reads the header from stdin (curl's config syntax), so the token is never an argument anyone can list. The body holds only
# the numbers above. Everything of curl goes to /dev/null and it runs in the background: the status line never waits for it.
# The claims of older states go first, in the same background job: only a run that read the time file a minute ago could still
# want one.
{
  for old in "$stamp".*; do
    [ "$old" = "$claim" ] || [ ! -f "$old" ] || rm -f "$old"
  done
  printf 'header = "Authorization: Bearer %s"\n' "$HUB_TOKEN" \
    | curl -s -o /dev/null --connect-timeout 3 --max-time 5 -H 'Content-Type: application/json' --data-binary "$body" -K - "$base/agent/usage"
} </dev/null >/dev/null 2>&1 &
exit 0
