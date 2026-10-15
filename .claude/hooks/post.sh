#!/usr/bin/env bash
# Tandem hook relay (the command-hook variant, docs/HOOKS.md).
#
# Usage: post.sh <route>   with the hook JSON on stdin, route one of
#   session-start | user-prompt-submit | stop | post-tool-use | session-end
#
# Environment: HUB_TOKEN (the agent token; never printed) and TANDEM_URL (the hub address, for example
# https://hub.example; K8 renders the default below when the repo is set up).
#
# What it sends: with node present, only session_id, hook_event_name, tool_name, stop_hook_active, source and reason
# (so tool_input, tool_response, prompt, cwd and transcript_path never leave this machine). Without node it sends
# the hook JSON as it is, and the hub drops everything else before storing anything (D-025).
#
# What it prints: the hub's reply (JSON that adds context or blocks a stop, or nothing) and nothing else.
# It always exits 0: a dead, slow or unreachable hub never blocks Claude Code.

route="${1:-}"
case "$route" in
  session-start|user-prompt-submit|stop|post-tool-use|session-end) ;;
  *) exit 0 ;;
esac

base="${TANDEM_URL:-https://teamclaude.lovkarsquid.com}"
base="${base%/}"
case "$base" in
  http://*|https://*) ;;
  *) exit 0 ;; # not configured (the placeholder was never rendered)
esac
[ -n "${HUB_TOKEN:-}" ] || exit 0
command -v curl >/dev/null 2>&1 || exit 0

input="$(cat 2>/dev/null)" || input=""

# Keep only the fields the hub uses. Any failure falls back to the unfiltered input.
filtered=""
if command -v node >/dev/null 2>&1; then
  filtered="$(printf '%s' "$input" | node -e '
    let s = "";
    process.stdin.on("data", (c) => { s += c; });
    process.stdin.on("end", () => {
      try {
        const b = JSON.parse(s);
        const out = {};
        for (const k of ["session_id", "hook_event_name", "tool_name", "stop_hook_active", "source", "reason"]) {
          if (b[k] !== undefined) out[k] = b[k];
        }
        process.stdout.write(JSON.stringify(out));
      } catch { process.stdout.write("{}"); }
    });
  ' 2>/dev/null)" || filtered=""
fi
[ -n "$filtered" ] || filtered="$input"

# Every route but session-start: the reply as it is.
# -f: an HTTP error (401, 404 ...) prints nothing instead of an error body Claude Code would try to read.
if [ "$route" != "session-start" ]; then
  printf '%s' "$filtered" | curl -s -f -m 5 \
    -H "Authorization: Bearer $HUB_TOKEN" \
    -H "Content-Type: application/json" \
    --data-binary @- "$base/hooks/$route" 2>/dev/null || true
  exit 0
fi

# session-start (K10, docs/HOOKS.md "Effort"): the same call, and the reply's X-Tandem-Effort header goes to a temp file. stdout
# stays exactly the reply. curl gets 4 s here, so the local step below still fits in the hook's 5 s.
hdr="$(mktemp 2>/dev/null)" || hdr=""
if [ -z "$hdr" ] || [ ! -f "$hdr" ]; then
  printf '%s' "$filtered" | curl -s -f -m 4 \
    -H "Authorization: Bearer $HUB_TOKEN" \
    -H "Content-Type: application/json" \
    --data-binary @- "$base/hooks/$route" 2>/dev/null || true
  exit 0
fi
ok=0
printf '%s' "$filtered" | curl -s -f -m 4 -D "$hdr" \
  -H "Authorization: Bearer $HUB_TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary @- "$base/hooks/$route" 2>/dev/null || ok=1

# The board's effort setting for this person's agent (K10, K10b). The header value is one of low, medium, high, xhigh, max,
# ultracode or default; anything else changes nothing. What is written into "$CLAUDE_PROJECT_DIR/.claude/settings.local.json"
# (Claude Code reads it at its next start), touching ONLY these three Tandem-managed places:
#   low..xhigh -> effortLevel = value             max -> env.CLAUDE_CODE_EFFORT_LEVEL = "max" (every other env entry stays)
#   ultracode  -> effortLevel = "xhigh" and ultracode = true         default -> nothing of Tandem's
# ".claude/tandem-applied.json" (git-ignored) records exactly which of the three places Tandem wrote and with which value. Tandem
# changes or removes a place only while it still holds the recorded value; a value the person wrote, or changed later, is never
# overwritten and never removed. Every other key stays as it is. A file that is not a JSON object, a link (also .claude), a file
# with a second name or a folder outside the project is never touched. The step changes into the checked .claude and names every
# file relative to it, so a link put in place of .claude after the check redirects nothing. Files are written to a temp file in the
# same folder, then renamed. Needs node; without node nothing is written. Prints nothing; the token is not passed on.
if [ "$ok" = "0" ] && [ -n "${CLAUDE_PROJECT_DIR:-}" ] && command -v node >/dev/null 2>&1; then
  HUB_TOKEN="" TANDEM_HDR="$hdr" node -e '
    const fs = require("fs");
    const path = require("path");
    const LEVELS = ["low", "medium", "high", "xhigh"];
    const ALL = LEVELS.concat(["max", "ultracode"]);
    const ENVKEY = "CLAUDE_CODE_EFFORT_LEVEL";
    const quit = () => process.exit(0);
    const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
    const isObj = (o) => o !== null && typeof o === "object" && !Array.isArray(o);
    const temps = [];
    try {
      const raw = fs.readFileSync(process.env.TANDEM_HDR, "latin1");
      const blocks = raw.split(/\r?\n\r?\n/).map((b) => b.trim()).filter((b) => /^HTTP\//.test(b));
      const last = blocks.length > 0 ? blocks[blocks.length - 1] : "";
      if (!/^HTTP\/[0-9.]+ 200(\s|$)/.test(last)) quit();
      let value = null;
      for (const line of last.split(/\r?\n/)) {
        const m = /^x-tandem-effort:[ \t]*([^ \t]*)[ \t]*$/i.exec(line);
        if (m) value = m[1];
      }
      if (value !== "default" && !ALL.includes(value)) quit();
      // What this value asks for, by place: level = effortLevel, ultra = ultracode, env = env.CLAUDE_CODE_EFFORT_LEVEL.
      const want = {};
      if (LEVELS.includes(value)) want.level = value;
      if (value === "max") want.env = "max";
      if (value === "ultracode") { want.level = "xhigh"; want.ultra = true; }
      const fold = process.platform === "win32" || process.platform === "darwin" ? (p) => p.toLowerCase() : (p) => p;
      const project = fs.realpathSync(process.env.CLAUDE_PROJECT_DIR);
      const dir = path.join(project, ".claude");
      const big = { bigint: true };
      const same = (a, b) => a.dev === b.dev && a.ino === b.ino;
      // The step works INSIDE .claude: it changes into the folder it checked and from then on names every file relative to
      // it, never through the path ".claude/...". A .claude swapped for a link after the check cannot redirect a read, a write,
      // a rename or a delete: POSIX keeps the checked folder itself as the current directory, and Windows refuses to rename or
      // remove a folder that is a process current directory. Entering checks that the folder is the one inspected and inside.
      const enter = (info) => {
        if (info.isSymbolicLink() || !info.isDirectory()) quit();
        process.chdir(dir);
        if (!same(fs.statSync(".", big), info)) quit();
        if (fold(path.relative(project, fs.realpathSync("."))) !== ".claude") quit();
      };
      let dirInfo = null;
      try { dirInfo = fs.lstatSync(dir, big); } catch (e) { if (e.code !== "ENOENT") quit(); }
      if (dirInfo !== null) enter(dirInfo);
      // A plain file with one name inside .claude (cwd): {file, text (null when missing)}. It is read through a descriptor that
      // must be the very file inspected, so a file swapped for a link in between is not read either.
      const open = (name) => {
        if (dirInfo === null) return { file: name, text: null };
        let info = null;
        try { info = fs.lstatSync(name, big); } catch (e) { if (e.code !== "ENOENT") quit(); }
        if (info === null) return { file: name, text: null };
        if (info.isSymbolicLink() || !info.isFile() || info.nlink > 1n) quit();
        if (fold(path.relative(project, fs.realpathSync(name))) !== fold(path.join(".claude", name))) quit();
        const fd = fs.openSync(name, "r");
        try {
          if (!same(fs.fstatSync(fd, big), info)) quit();
          return { file: name, text: fs.readFileSync(fd, "utf8").replace(/^\uFEFF/, "") };
        } finally { fs.closeSync(fd); }
      };
      const settings = open("settings.local.json");
      const sidecar = open("tandem-applied.json");
      let obj = {};
      if (settings.text !== null) {
        obj = JSON.parse(settings.text);
        if (!isObj(obj)) quit();
      }
      // What Tandem wrote earlier, as far as the record says; anything unreadable counts as "nothing", so a value is never
      // taken for Tandem own by mistake.
      const applied = {};
      try {
        const s = sidecar.text === null ? null : JSON.parse(sidecar.text);
        if (isObj(s)) {
          if (LEVELS.includes(s.effortLevel)) applied.level = s.effortLevel;
          if (s.ultracode === true) applied.ultra = true;
          if (isObj(s.env) && s.env[ENVKEY] === "max") { applied.env = "max"; if (s.envCreated === true) applied.envCreated = true; }
        }
      } catch {}
      const envObj = () => (own(obj, "env") && isObj(obj.env) ? obj.env : null);
      const cur = {
        level: () => (own(obj, "effortLevel") ? obj.effortLevel : undefined),
        ultra: () => (own(obj, "ultracode") ? obj.ultracode : undefined),
        env: () => { const e = envObj(); return e !== null && own(e, ENVKEY) ? e[ENVKEY] : undefined; },
      };
      let envCreatedNow = false;
      const put = {
        level: (v) => { obj.effortLevel = v; return true; },
        ultra: (v) => { obj.ultracode = v; return true; },
        env: (v) => {
          let e = envObj();
          if (e === null) {
            if (own(obj, "env")) return false; // an env that is not an object belongs to the person: left alone
            obj.env = {};
            e = obj.env;
            envCreatedNow = true;
          }
          e[ENVKEY] = v;
          return true;
        },
      };
      const drop = {
        level: () => { delete obj.effortLevel; },
        ultra: () => { delete obj.ultracode; },
        env: () => {
          const e = envObj();
          delete e[ENVKEY];
          if (applied.envCreated === true && Object.keys(e).length === 0) delete obj.env;
        },
      };
      const next = {};
      let changed = false;
      let keptEnv = false;
      for (const slot of ["level", "ultra", "env"]) {
        const c = cur[slot]();
        const mine = own(applied, slot) && c !== undefined && c === applied[slot]; // still the value Tandem wrote
        const w = want[slot];
        if (w === undefined) {
          if (mine) { drop[slot](); changed = true; }
        } else if (c === undefined) {
          if (put[slot](w)) { next[slot] = w; changed = true; }
        } else if (c === w) {
          if (mine) next[slot] = w; // the identical value of the person is not recorded, so it is never removed
        } else if (mine) {
          put[slot](w);
          next[slot] = w;
          changed = true;
        }
        if (slot === "env" && next.env !== undefined) keptEnv = mine;
      }
      const record = {};
      if (next.level !== undefined) record.effortLevel = next.level;
      if (next.ultra !== undefined) record.ultracode = true;
      if (next.env !== undefined) {
        record.env = { [ENVKEY]: "max" };
        if (envCreatedNow || (keptEnv && applied.envCreated === true)) record.envCreated = true;
      }
      const recordText = Object.keys(record).length === 0 ? null : JSON.stringify(record, null, 2) + "\n";
      const sameRecord = recordText === sidecar.text;
      if (!changed && sameRecord) quit();
      if (dirInfo === null) {
        fs.mkdirSync(dir); // fails if anything (a link too) took the name since the check
        dirInfo = fs.lstatSync(dir, big);
        enter(dirInfo);
      }
      // From here every name is relative to the checked .claude (the current directory). wx never follows a link.
      const stamp = "." + process.pid + "." + Date.now() + ".tmp";
      const write = (target, text) => {
        const tmp = "." + target + stamp;
        temps.push(tmp);
        fs.writeFileSync(tmp, text, { flag: "wx", mode: 0o600 });
        fs.renameSync(tmp, target);
      };
      // The settings first, then the record: a failure in between leaves a value Tandem wrote unrecorded (it then counts as
      // the person own and is never removed), never the other way round.
      if (changed) write(settings.file, JSON.stringify(obj, null, 2) + "\n");
      if (!sameRecord) {
        if (recordText === null) { if (sidecar.text !== null) fs.unlinkSync(sidecar.file); }
        else write(sidecar.file, recordText);
      }
    } catch {
      for (const t of temps) { try { fs.unlinkSync(t); } catch {} }
    }
  ' >/dev/null 2>&1 || true
fi
rm -f "$hdr" 2>/dev/null || true
exit 0
