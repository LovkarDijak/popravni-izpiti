export const meta = {
  name: 'ekipa-tandem-chunk',
  description: 'Build one chunk of any project with a model per role (Haiku 5.5 scout/runner, Sonnet 5.5 builder/auditors, Opus 5.5 hard builds/review/fix), an optional design panel and an independent verify',
  whenToUse: 'One well-specified chunk with a written brief. args: {repo, chunk, branch, brief, base?, buildCmd?, testCmd?, verifySteps?, scout?, specFile?, context?, env?, reviewChecks?, privateTerms?, builderModel?, rigor?, judgeModel?, visible?, deterministic?, styleGuide?, shotsDir?, note?}',
  phases: [
    { title: 'Scout', detail: 'Haiku 5.5: the spec sections the brief touches and a file:line map', model: 'haiku' },
    { title: 'Design', detail: 'rigor high only: three Sonnet 5.5 designs, a Fable 5.1 judge (Opus 5.5 fallback)', model: 'sonnet' },
    { title: 'Build', detail: 'Sonnet 5.5, or Opus 5.5 for hard chunks' },
    { title: 'Review', detail: 'Opus 5.5 review-fix', model: 'opus' },
    { title: 'Verify', detail: 'Haiku 5.5 runner + Sonnet 5.5 audit lenses' },
    { title: 'Fix', detail: 'Opus 5.5: one fix round, then the runner again, a Sonnet 5.5 regression lens and, when the fixer disputes findings, an Opus 5.5 meeting (meet:<chunk>) that settles them', model: 'opus' },
  ],
}

// Roles, models and effort:
//   scout      Haiku 5.5   medium  read-only: the spec sections the brief touches, a code map, the real commands
//   builder    Sonnet 5.5  high    well-specified chunks (default)
//              Opus 5.5    xhigh   hard chunks (design risk, concurrency, data formats, core models)
//   designers  Sonnet 5.5  high    rigor high: three angles; judge Fable 5.1 high (Opus 5.5 xhigh fallback)
//   reviewer   Opus 5.5    xhigh   review-fix, the main quality gate (high for a Sonnet-built normal-rigor chunk)
//   runner     Haiku 5.5   low     mechanical: build, full tests, verify steps
//   auditors   Sonnet 5.5  high    one lens (normal) or three lenses (rigor high), plus a look lens for visible work
//   fixer      Opus 5.5    xhigh   one round on runner failures, blocking findings and unmet requirements
//   regression Sonnet 5.5  high    after the fix round: audits only the fixer's diff
//   arbiter    Opus 5.5    high    the meeting (label meet:<chunk>): only when the fixer calls blocking or unmet findings
//                                  not real; settles each one in the code; an upheld finding blocks the merge
// Meetings: the design judge (design-judge:<chunk>) and the arbiter (meet:<chunk>) weigh what others brought; the
// Agentska vas shows both at the well, with the agents whose work they weigh standing around it.
//
// args:
//   repo         absolute path of the git repo (required; backslashes are fine, commands get forward slashes)
//   chunk        short name used in labels and commit prefixes (required)
//   branch       branch to build on; created from base if missing (required)
//   brief        the chunk brief: goal, files, tests, done when, out of scope (required; the primary source)
//   base         base branch (default "main")
//   buildCmd     build command run in the repo (optional)
//   testCmd      test command run in the repo (optional; without -v so runners read summaries)
//   verifySteps  extra commands the runner must run and pass: every command-shaped "done when" line (array)
//   scout        task for the scout (omit to skip the scout); the scout always gets the brief and the label rule
//   specFile     repo-relative plan/spec file; the scout copies the sections the brief touches, every gate may read it
//   context      project-specific rules for every agent (language, style, forbidden things)
//   env          facts about this PC for every agent (default ENV_DEFAULT below; "" turns it off)
//   reviewChecks extra checks for the reviewer (best: the context's hard rules as grep-able checks)
//   privateTerms words that must never appear in added lines (e.g. the Windows user name); reviewer and regression check
//   builderModel "sonnet" (default) | "opus"
//   rigor        "high" | "normal" (default: high when builderModel is opus)
//   judgeModel   "fable" (default) | "opus"
//   visible      true when the chunk shows something on screen (adds the look lens)
//   deterministic true when the project must stay deterministic (adds determinism to the lenses)
//   styleGuide   repo-relative style/art guide for the look lens
//   shotsDir     repo-relative folder where the builder saves screenshots of visible work (default docs/screenshots)
//   note         context for the builder (e.g. an interrupted earlier attempt, a busy machine)
//   outsideLens  true (gpt-6.1-sol) or an OpenAI model name: one more audit lens from another model family, run by a
//                Haiku agent through D:/Claude/OpenAI-API/review.py (about 0.05-0.30 USD a chunk, logged and capped there)
//
// Result: { chunk, branch, ok, why, rigor, missingLenses, specSilences, scout, design, build, review, verify, fix, reverify, regression, meeting }
// ok is the merge gate: the review passed (ok or fixed, tests green), at least one audit lens answered, and either the
// verify was clean (runner ok, no blocking, nothing unmet) or, after the one fix round, the re-verify passed, the fixer's
// tests are green, no stillOpen item has severity blocking, the regression lens found nothing blocking and, if the fixer
// disputed findings, the meeting upheld none of them.
// Minor stillOpen items, deferred gates, ownerChoices, ownerQuestions and specSilences never block; they go to the report.
// why says in one line why ok is false ('' when ok).
const A = args || {}
if (!A.repo || !A.chunk || !A.branch || !A.brief) throw new Error('ekipa-chunk needs args {repo, chunk, branch, brief}')
const REPO = A.repo
const REPO_SH = String(A.repo).replace(/\\/g, '/')
const GIT = `git -C "${REPO_SH}"`
const BASE = A.base || 'main'
const BUILDER = A.builderModel === 'opus' ? 'opus' : 'sonnet'
const BUILDER_EFFORT = BUILDER === 'opus' ? 'xhigh' : 'high'
const RIGOR = A.rigor === 'high' || (A.rigor !== 'normal' && BUILDER === 'opus')
// On a Sonnet-built normal-rigor chunk an xhigh review out-worked the builder and hardened far past the brief.
const REVIEW_EFFORT = BUILDER === 'sonnet' && !RIGOR ? 'high' : 'xhigh'
// Design judge: Opus 5.5 by default (Fable 5.1 is not on every plan; pass judgeModel: 'fable' where it is).
const JUDGE_MODEL = A.judgeModel || 'opus'
const JUDGE_NAME = JUDGE_MODEL === 'fable' ? 'Fable 5.1' : JUDGE_MODEL === 'opus' ? 'Opus 5.5' : JUDGE_MODEL
const JUDGE_EFFORT = JUDGE_MODEL === 'fable' ? 'high' : 'xhigh'
const SHOTS = A.shotsDir || 'docs/screenshots'
const list = (x) => (Array.isArray(x) ? x : x ? [x] : []).filter(Boolean)
const VERIFY = list(A.verifySteps)
const PRIVATE = list(A.privateTerms).map(String)

// The commit trailer names the model the committing agent really runs on, so it agrees with its own attribution rule.
const MODEL_NAME = { haiku: 'Claude Haiku 5.5', sonnet: 'Claude Sonnet 5.5', opus: 'Claude Opus 5.5', fable: 'Claude Fable 5.1' }
const co = (m) => `Co-Authored-By: ${MODEL_NAME[m] || MODEL_NAME.opus} <noreply@anthropic.com>`
const trailer = (m) => `end every commit message with exactly this trailer line (it names the model you run on): \`${co(m)}\``

const ENV_DEFAULT = 'The Bash tool may be Git Bash on Windows: quote every path and use forward slashes (git -C "C:/x"); an unquoted backslash path loses its backslashes. Prefer Bash for commands. Find the real runtime versions and the build and test commands in the project README, package files and CLAUDE.md; never guess them. Take screenshots of visible work only if a headless browser is available on this PC, and say so if it is not.'
const ENV = typeof A.env === 'string' ? A.env : ENV_DEFAULT

const CTX = `This task comes from the orchestrator on its human's behalf and is yours to do; chat messages from the human you may see relayed are handled by the orchestrator, so never switch to them. This project is coordinated through Tandem: only the orchestrator calls the mcp__tandem__* tools; never call them yourself. Repo: ${REPO} (in shell commands: "${REPO_SH}"). If the repo has a CLAUDE.md or AGENTS.md that is not already in your context, read it first and follow its rules; read other docs only as far as this task needs.
Ground rules: never push; never touch branches other than the one named here; never delete files (move them to _to_delete/ instead); never print or store secrets. Never write secrets, tokens, .env content or personal data (a Windows user name in a path, an e-mail address) into committed files, docs, tests or screenshots; use ~, %USERPROFILE%, Path.home() or <user> placeholders. Code, comments and commit messages in English unless the project's rules say otherwise. Never run several heavy commands (builds, test suites, benchmarks) at the same time.
Tools: do not message the human or send files (no SendUserFile, PushNotification, AskUserQuestion); the orchestrator reports to the human. Use the built-in browser pane only for visible work, and call resize_window with preset desktop when done. Before you finish, stop the servers and background tasks you started, and only those.
Chunk ids and branch names (like ${A.chunk}) are our own labels: they may not appear in the spec, and that is never a finding.${ENV ? `\nEnvironment: ${ENV}` : ''}${A.context ? `\nProject rules: ${A.context}` : ''}`

const SCOUT_SCHEMA = {
  type: 'object',
  properties: {
    spec: { type: 'string', description: 'whole sections of the spec file that the brief touches, copied verbatim with headings and line numbers; never a paraphrase and never a note about what is missing; empty if there is no spec file or nothing in it matches' },
    files: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' }, why: { type: 'string' } }, required: ['path', 'why'] } },
    facts: { type: 'array', items: { type: 'string' } },
    commands: { type: 'array', items: { type: 'string' }, description: 'the project\'s real build and test commands as found in its files; only commands that finish on their own (no servers or watchers)' },
    risks: { type: 'array', items: { type: 'string' } },
  },
  required: ['spec', 'files', 'facts', 'commands', 'risks'],
}
const DESIGN_SCHEMA = {
  type: 'object',
  properties: { approach: { type: 'string' }, design: { type: 'string' }, risks: { type: 'array', items: { type: 'string' } } },
  required: ['approach', 'design', 'risks'],
}
const JUDGE_SCHEMA = {
  type: 'object',
  properties: {
    chosen: { type: 'string' },
    why: { type: 'string' },
    design: { type: 'string', description: 'the final design for the builder, at most about 2,500 words: section A Binding, section B Advisory' },
  },
  required: ['chosen', 'why', 'design'],
}
const BUILD_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    commits: { type: 'array', items: { type: 'string' } },
    testsGreen: { type: 'boolean' },
    testDetail: { type: 'string' },
    screenshots: { type: 'array', items: { type: 'string' } },
    ownerQuestions: { type: 'array', items: { type: 'string' }, description: 'look or feel choices the brief did not settle: the options and the one you built' },
    open: { type: 'array', items: { type: 'string' }, description: 'deviations from the design (with why) and anything left unfinished' },
  },
  required: ['summary', 'commits', 'testsGreen', 'testDetail', 'screenshots', 'ownerQuestions', 'open'],
}
const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['ok', 'fixed', 'needs_owner', 'failed'] },
    fixes: { type: 'array', items: { type: 'string' } },
    commits: { type: 'array', items: { type: 'string' } },
    testsGreen: { type: 'boolean' },
    testDetail: { type: 'string' },
    builderQuality: { type: 'string' },
    notes: { type: 'array', items: { type: 'string' } },
  },
  required: ['verdict', 'fixes', 'commits', 'testsGreen', 'testDetail', 'builderQuality', 'notes'],
}
const RUN_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean', description: 'true only if every step passed' },
    head: { type: 'string', description: 'the short hash printed by git rev-parse --short HEAD right after the checkout' },
    steps: { type: 'array', items: { type: 'object', properties: { step: { type: 'string' }, output: { type: 'string', description: 'exit status and the summary lines only' }, ok: { type: 'boolean' } }, required: ['step', 'output', 'ok'] } },
  },
  required: ['ok', 'head', 'steps'],
}
const MEET_SCHEMA = {
  type: 'object',
  properties: {
    rulings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          finding: { type: 'string', description: 'the disputed finding in a few words (where and what)' },
          ruling: { type: 'string', enum: ['upheld', 'dismissed'], description: 'upheld = the defect is real and still in the code; dismissed = the fixer\'s reason holds' },
          why: { type: 'string', description: 'one or two sentences of evidence with file:line' },
        },
        required: ['finding', 'ruling', 'why'],
      },
    },
    summary: { type: 'string', description: 'one line: what the meeting agreed' },
  },
  required: ['rulings', 'summary'],
}
const AUDIT_SCHEMA = {
  type: 'object',
  properties: {
    blocking: { type: 'array', items: { type: 'object', properties: { where: { type: 'string' }, problem: { type: 'string' }, why: { type: 'string' } }, required: ['where', 'problem', 'why'] }, description: 'defects verified in the code or the images' },
    unmet: {
      type: 'array',
      description: 'requirements the brief or the spec states that the code does not meet',
      items: { type: 'object', properties: { quote: { type: 'string', description: 'the exact words of the brief or spec that ask for it' }, where: { type: 'string', description: 'file:line, or "missing"' }, problem: { type: 'string' } }, required: ['quote', 'where', 'problem'] },
    },
    minor: { type: 'array', items: { type: 'string' } },
    specSilences: { type: 'array', items: { type: 'string' }, description: 'things the brief and the spec do not say; informational, never a defect' },
  },
  required: ['blocking', 'unmet', 'minor', 'specSilences'],
}
const FIX_SCHEMA = {
  type: 'object',
  properties: {
    fixed: { type: 'array', items: { type: 'string' } },
    notReal: { type: 'array', items: { type: 'string' } },
    stillOpen: {
      type: 'array',
      description: 'real defects in the code that remain unfixed; blocking = it breaks a brief item, a ground rule or data, or crashes; minor = small and safe to merge',
      items: { type: 'object', properties: { what: { type: 'string' }, severity: { type: 'string', enum: ['blocking', 'minor'] } }, required: ['what', 'severity'] },
    },
    deferred: { type: 'array', items: { type: 'string' }, description: 'gates that cannot be shown now for reasons outside the code (a busy machine for timing gates, a later chunk), each with the reason and the measured numbers; not code problems' },
    ownerChoices: { type: 'array', items: { type: 'string' }, description: 'open choices about how the product looks or feels that belong to the owner, each with the options and a recommendation; not code problems' },
    commits: { type: 'array', items: { type: 'string' } },
    testsGreen: { type: 'boolean' },
  },
  required: ['fixed', 'notReal', 'stillOpen', 'deferred', 'ownerChoices', 'commits', 'testsGreen'],
}

let scout = null
// Commands the builder is told about: the given ones, else the scout's.
const knownCommands = () => {
  if (A.buildCmd || A.testCmd) return [A.buildCmd, A.testCmd].filter(Boolean)
  return scout && scout.commands && scout.commands.length ? scout.commands : []
}
// Steps the runner executes: build, full tests, then every verify step.
const runSteps = () => {
  const s = []
  if (A.buildCmd || A.testCmd) {
    if (A.buildCmd) s.push(`\`${A.buildCmd}\``)
    s.push(A.testCmd ? `\`${A.testCmd}\`` : 'the full test suite (find its command in the project\'s files)')
  } else if (scout && scout.commands && scout.commands.length) {
    scout.commands.forEach(c => s.push(`\`${c}\``))
  } else {
    s.push('Find the project\'s build and test commands in its files (README, package.json, *.sln, build.gradle, Makefile, pyproject.toml, CLAUDE.md) and run the build, then the full test suite.')
  }
  VERIFY.forEach(c => s.push(`\`${c}\``))
  return s
}
const runnerPrompt = (label) => `${CTX}

You are a runner (Haiku). Do not edit or commit anything. First run \`${GIT} checkout ${A.branch}\` and \`${GIT} rev-parse --short HEAD\` (report that hash as head). Then run these steps from the repo root (\`cd "${REPO_SH}" && <step>\`), one at a time:
${runSteps().map((s, i) => `${i + 1}. ${s}`).join('\n')}
For each step report the exit status and only the summary lines of its output, exactly as printed (warning and error counts, passed/failed/skipped counts, numbers), plus the first failure if there is one. "Ran 0 tests" or "no tests found" is a failure. If a step creates or changes files inside the repo, add the output of \`${GIT} status --short\` to that step. ok is true only if every step passed with no failures and no build errors. (${label})`
const failedSteps = (run) => !run ? 'runner returned nothing' : (run.steps || []).filter(s => !s.ok).map(s => s.step).join(' | ') || 'runner says not ok'

if (A.scout) {
  phase('Scout')
  scout = await agent(`${CTX}

You are a read-only scout (never edit or commit; do not switch branches). Read the code of \`${BASE}\`: if \`${GIT} branch --show-current\` is not ${BASE}, read files with \`${GIT} show ${BASE}:<path>\`.
The brief below is the primary source.${A.specFile ? ` The spec is ${A.specFile}. Put in spec, verbatim with headings and line numbers, every whole section of it that the brief touches, including ground rules that apply to all work (language, privacy, naming, formats); never a paraphrase. Find sections by topic: our chunk ids and names may not appear in it. If nothing in it matches the brief, leave spec empty; never report that an id or a section is missing.` : ' There is no spec file: leave spec empty.'}
Task: ${A.scout}

Then list the exact files a builder must open (with why), compact facts with path:line, the project's real build and test commands (only ones that finish on their own), and risks you noticed.

## Brief
${A.brief}`,
    { label: `scout:${A.chunk}`, phase: 'Scout', model: 'haiku', effort: 'medium', schema: SCOUT_SCHEMA })
  if (!scout) log(`scout:${A.chunk} returned nothing; going on without it`)
}
if (scout) {
  // A "nothing found" note in place of an extract spread through a whole chunk once; drop it, the brief stays the source.
  const NO_SPEC = /\bno (section|heading|mention)s?\b|\bnot found\b|\bdoes not (exist|contain|mention)\b/i
  const NO_SECTION = /\bno (section|heading)s?\b|\b(section|heading)s?\b[^.]{0,60}\b(missing|not found|does not exist)\b/i
  if (typeof scout.spec !== 'string') scout.spec = ''
  if (scout.spec && NO_SPEC.test(scout.spec.slice(0, 300))) {
    log(`scout:${A.chunk}: the spec extract reads as a "not found" note; dropped it`)
    scout.spec = ''
  }
  scout.risks = list(scout.risks).filter(r => !NO_SECTION.test(String(r)))
  scout.facts = list(scout.facts).filter(f => !NO_SECTION.test(String(f)))
}

// What every gate judges against: the brief always, the scout's extract when there is one, and where the full spec is.
const SPEC = `## Brief (the acceptance criteria: anything it lists is in scope)
${A.brief}${scout && scout.spec ? `

## Spec extract from the scout (verbatim, may be incomplete)
${scout.spec}` : ''}${A.specFile ? `

The full spec is ${A.specFile}; read it with \`${GIT} show ${BASE}:${A.specFile}\` when the brief or the extract leaves something unclear.` : ''}`

let design = null
if (RIGOR) {
  phase('Design')
  const ANGLES = [
    ['robustness', `Correctness and robustness first: edge cases, failure modes, data and API compatibility${A.deterministic ? ', determinism (same input, same output, at any thread count and across save/load)' : ''}.`],
    ['performance', 'Performance first: data layout, hot paths, allocations, what scales to the project\'s largest real case.'],
    ['simplicity', 'Simplicity first: the smallest design that fully meets the brief and that later work can build on easily (clear seams, stable names, few moving parts).'],
  ]
  const facts = scout ? JSON.stringify({ files: scout.files, facts: scout.facts, risks: scout.risks }, null, 1) : 'none'
  const proposals = (await parallel(ANGLES.map(([name, angle]) => () => agent(`${CTX}

You are a designer (read-only: never edit, build or commit; do not switch branches; read the code of \`${BASE}\`, with \`${GIT} show ${BASE}:<path>\` if another branch is checked out). Propose a design for chunk "${A.chunk}" from one angle. ${angle}

${SPEC}

Facts from the scout:
${facts}

Read the code the design builds on before you propose: open at least every file you cite and quote one line from each (path:line). Be concrete (types, functions, files, the order of work, the tests that prove it), at most about 1,200 words.`,
    { label: `design-${name}:${A.chunk}`, phase: 'Design', model: 'sonnet', effort: 'high', schema: DESIGN_SCHEMA })))).filter(Boolean)
  if (proposals.length) {
    const judgePrompt = `${CTX}

You are the design judge (${JUDGE_NAME}; read-only: never edit, build or commit; do not switch branches; read the code of \`${BASE}\`, with \`${GIT} show ${BASE}:<path>\` if another branch is checked out). Designers proposed designs for chunk "${A.chunk}" from different angles. Check each against the brief and the real code, take the best as the base, graft in the best ideas of the others, fix anything wrong and drop anything the brief does not ask for.
Write the final design in at most about 2,500 words, in two sections:
A. Binding: interfaces, the file list, the behaviour table, the tests that prove it. The builder follows this.
B. Advisory: visual tuning, constants, implementation hints. The builder may change these freely.

${SPEC}

Proposals:
${JSON.stringify(proposals, null, 1)}`
    design = await agent(judgePrompt, { label: `design-judge:${A.chunk}`, phase: 'Design', model: JUDGE_MODEL, effort: JUDGE_EFFORT, schema: JUDGE_SCHEMA })
    if (!design && JUDGE_MODEL !== 'opus') {
      log(`${JUDGE_NAME} judge returned nothing; falling back to Opus 5.5`)
      design = await agent(judgePrompt.replace(JUDGE_NAME, 'Opus 5.5'), { label: `design-judge-opus:${A.chunk}`, phase: 'Design', model: 'opus', effort: 'xhigh', schema: JUDGE_SCHEMA })
    }
  }
}

phase('Build')
const factsText = scout ? `\n\n## Facts from the scout (trust them, but verify anything you change)\n${JSON.stringify({ files: scout.files, facts: scout.facts, commands: scout.commands, risks: scout.risks }, null, 1)}` : ''
const designText = design ? `\n\n## Design (from the design judge: follow section A unless the code proves it wrong, and then say so in open; section B is advice you may change)\n${design.design}` : ''
const noteText = A.note ? `\n\n## Note\n${A.note}` : ''
const known = knownCommands()
const build = await agent(`${CTX}

You are the builder for chunk "${A.chunk}".
Branch: run \`${GIT} checkout ${A.branch}\`; if it does not exist, \`${GIT} checkout -b ${A.branch} ${BASE}\`. Work only there.

${SPEC}${factsText}${designText}${noteText}

## Finish
- The project's build and full test suite pass${known.length ? ` (${known.join(' ; ')})` : ''}, with no new warnings.${VERIFY.length ? `\n- The independent verify will also run these, so they must pass: ${VERIFY.map(c => `\`${c}\``).join(' ; ')}` : ''}
- Commit in small steps; ${trailer(BUILDER)}.${A.visible ? `\n- When something visible first looks right, save a screenshot to ${SHOTS}/ with the date in the file name and list the files in screenshots.` : ''}
- If a choice changes how the product looks or feels and the brief does not settle it, choose the option you recommend, keep it easy to change (one constant or flag), and list it in ownerQuestions with the options and your pick. Stop only if there is no sensible default.
- List in open every deviation from the design (with why) and anything left unfinished.`,
  { label: `build:${A.chunk}`, phase: 'Build', model: BUILDER, effort: BUILDER_EFFORT, schema: BUILD_SCHEMA })

const RIGOR_NAME = RIGOR ? 'high' : 'normal'
if (!build) {
  log('Builder returned nothing; stopping this chunk.')
  return { chunk: A.chunk, branch: A.branch, ok: false, why: 'builder returned nothing', rigor: RIGOR_NAME, scout, design, build: null }
}

phase('Review')
const privacyCheck = PRIVATE.length ? `\nPrivacy: no added line may contain ${PRIVATE.map(t => `"${t}"`).join(', ')} in any case. Check with \`${GIT} diff ${BASE}...${A.branch} | grep '^+' | grep -n -i -F ${PRIVATE.map(t => `-e '${t.replace(/'/g, '')}'`).join(' ')}\` and replace every hit with a placeholder.` : ''
const review = await agent(`${CTX}

You are the reviewer-fixer for chunk "${A.chunk}" on branch \`${A.branch}\` (base \`${BASE}\`). Run \`${GIT} checkout ${A.branch}\`.

${SPEC}

The builder (${MODEL_NAME[BUILDER]}) reported:
${JSON.stringify(build, null, 1)}

Start from \`${GIT} diff ${BASE}...${A.branch}\`, then read only the code around it. Do not trust the builder's numbers: re-run what proves the chunk works. Check in this order:
1. The ground rules and project rules above (privacy, read-only access where stated, allowed dependencies): a breach always gets fixed.
2. Every item of the brief is there and works; nothing it excludes crept in.
3. Bugs that lose or corrupt data, crash, hang or leak; compatibility of saved data, config and APIs${A.deterministic ? '; determinism' : ''}; whether the tests really test the change (a test that passes on broken code is a defect).
Hardening beyond that (rare inputs, defence in depth) goes into notes unless the fix is under about 10 lines.${privacyCheck}${A.reviewChecks ? `\nAlso: ${A.reviewChecks}` : ''}

Fix problems yourself and commit as \`${A.chunk} review: <what>\`; ${trailer('opus')}. At the end the build and the full test suite must pass. Verdict: ok (nothing to fix), fixed (you fixed things), needs_owner only if the chunk cannot be finished without an owner choice that has no sensible default (otherwise keep the builder's pick and add the choice to notes), failed only if the chunk cannot be made right in this pass.`,
  { label: `review:${A.chunk}`, phase: 'Review', model: 'opus', effort: REVIEW_EFFORT, schema: REVIEW_SCHEMA })

if (!review || !(review.verdict === 'ok' || review.verdict === 'fixed') || !review.testsGreen) {
  const why = !review ? 'reviewer returned nothing'
    : !(review.verdict === 'ok' || review.verdict === 'fixed') ? `review ${review.verdict}${list(review.notes).length ? `: ${list(review.notes).slice(0, 3).join(' | ')}` : ''}`
    : `review: tests not green (${review.testDetail})`
  log(`${A.chunk}: ${why}; not verifying.`)
  return { chunk: A.chunk, branch: A.branch, ok: false, why, rigor: RIGOR_NAME, scout, design, build, review }
}

phase('Verify')
const DET = A.deterministic ? ' Determinism: unordered iteration, floating point in deterministic state, wall clock or thread timing, random draws off the seeded streams, results that change with thread count or across save/load.' : ''
const BRIEF_LENS = 'everything the brief (and the spec sections it touches) asks of this chunk is there: list what is missing or wrong in unmet, quoting the words that ask for it; list what the brief and spec leave open in specSilences (not a defect); nothing out of scope crept in (anything the brief lists is in scope)'
const LENSES = RIGOR ? [
  ['correctness', `Correctness in depth: trace every new code path; edge cases (empty, huge, missing, concurrent), error handling, off-by-one, resource leaks, shared mutable state; breaches of the ground rules.${DET}`],
  ['compat-and-spec', `Compatibility and brief conformance: saved data, file formats, config and public APIs stay compatible (or are migrated as the brief says); versions bumped as the brief says; ${BRIEF_LENS}.`],
  ['performance-and-tests', 'Performance and tests: hot paths, allocations, accidental O(n^2), work done too often; and whether each new test would fail if the feature it covers were broken (name the tests that would not).'],
] : [['all', `1. Correctness: edge cases, error handling, shared state, breaches of the ground rules.${DET}\n2. Compatibility: saved data, formats, config and APIs.\n3. Brief conformance: ${BRIEF_LENS}.\n4. Tests: the new tests would fail if the feature were broken.`]]
if (A.visible) LENSES.push(['look', `How it looks and reads: open every screenshot the builder listed or saved in ${SHOTS}/ for this chunk (Read shows images); if there are none, say so as blocking.${A.styleGuide ? ` Check them against ${A.styleGuide}.` : ''} Check them against what the brief asks of the look, then layout, alignment, spacing, colours and contrast, readable text sizes, consistency with the existing screens, and empty/error/loading states in the code. Report what looks wrong with the file name and exactly what to change.`])
const READ_ONLY = `Read only: do not edit, commit, build or run tests (a runner is doing that now). The runner keeps \`${A.branch}\` checked out: never run git checkout, switch, stash, reset or anything else that changes the working tree; if \`${GIT} branch --show-current\` is not ${A.branch}, read files with \`${GIT} show ${A.branch}:<path>\`.`
const auditPrompt = (lens) => `${CTX}

You are an independent auditor (Sonnet) for chunk "${A.chunk}" on branch \`${A.branch}\`. ${READ_ONLY} Use \`${GIT} diff ${BASE}...${A.branch}\` and read the code around it.

${SPEC}

Judge against the brief first: anything the brief lists is in scope, not extra.

The reviewer (Opus 5.5) already passed it and reported:
${JSON.stringify(review, null, 1)}

Your lens (look hard for what a reviewer most easily misses):
${lens}

Put in blocking only defects you verified in the code or the images (with file:line and why). Put a requirement the brief or spec states that the code does not meet in unmet; put what the brief and spec simply do not say in specSilences; put style or doubtful points in minor. Empty lists are a fine answer when they are true.`
// The outside lens: an OpenAI model reviews the same diff against the brief (another model family has other blind
// spots). A Haiku agent only runs the script; the fixer checks its findings like any lens, and disputes go to the meeting.
const OUTSIDE = A.outsideLens ? (typeof A.outsideLens === 'string' ? A.outsideLens : 'gpt-6.1-sol') : ''
const OAI_DIR = 'D:/Claude/OpenAI-API'
const outsidePrompt = () => `You run the outside review for chunk "${A.chunk}". Never edit, commit or check out anything in the repo.
1. With the Write tool, save the text between the BRIEF lines below, exactly, to ${OAI_DIR}/briefs/${A.chunk}.md (create the folder if needed).
2. Run with the Bash tool (timeout 600000): python -I "${OAI_DIR}/review.py" --repo "${REPO_SH}" --base "${BASE}" --branch "${A.branch}" --brief-file "${OAI_DIR}/briefs/${A.chunk}.md" --model "${OUTSIDE}"${PRIVATE.length ? ` --private "${PRIVATE.join(',')}"` : ''} --format skill --out "${OAI_DIR}/briefs/${A.chunk}.review.json"
3. If it exits 0, return the JSON it printed on stdout exactly (blocking, unmet, minor, specSilences). If it fails (a spend cap, a private term, no network), return empty blocking, unmet and specSilences and one minor line "outside review not run: <the reason it printed>".
BRIEF
## Project rules
${A.context || '(none)'}

## Brief
${A.brief}
BRIEF`
const verifyResults = await parallel([
  () => agent(runnerPrompt('verify'), { label: `verify-run:${A.chunk}`, phase: 'Verify', model: 'haiku', effort: 'low', schema: RUN_SCHEMA }),
  ...LENSES.map(([name, lens]) => () => agent(auditPrompt(lens), { label: `verify-${name}:${A.chunk}`, phase: 'Verify', model: 'sonnet', effort: 'high', schema: AUDIT_SCHEMA })),
  ...(OUTSIDE ? [() => agent(outsidePrompt(), { label: `verify-outside:${A.chunk}`, phase: 'Verify', model: 'haiku', effort: 'low', schema: AUDIT_SCHEMA })] : []),
])
if (OUTSIDE && !verifyResults[LENSES.length + 1]) log('the outside lens returned nothing')
const run1 = verifyResults[0]
const audits = verifyResults.slice(1).filter(Boolean)
const missingLenses = LENSES.filter((_, i) => !verifyResults[i + 1]).map(([name]) => name)
if (missingLenses.length) log(`audit lens(es) returned nothing: ${missingLenses.join(', ')}`)
const audit = {
  blocking: audits.flatMap(a => a.blocking || []),
  unmet: audits.flatMap(a => a.unmet || []),
  minor: [...new Set(audits.flatMap(a => a.minor || []))],
  specSilences: [...new Set(audits.flatMap(a => a.specSilences || []))],
}

const runOk = !!(run1 && run1.ok)
const needFix = !runOk || audit.blocking.length > 0 || audit.unmet.length > 0
let fix = null
let run2 = null
let regression = null
let meeting = null
let disputed = false
if (audits.length && needFix) {
  phase('Fix')
  log(`Verify found problems (runner ok=${runOk}, blocking=${audit.blocking.length}, unmet=${audit.unmet.length}); one Opus fix round.`)
  const runnerText = runOk ? 'passed' : run1 ? JSON.stringify(run1, null, 1) : 'the runner returned nothing: run the build, the tests and the verify steps yourself'
  fix = await agent(`${CTX}

You are the fixer (Opus) for chunk "${A.chunk}" on branch \`${A.branch}\`. Run \`${GIT} checkout ${A.branch}\`. After review, an independent verify found the problems below. Check each one in the code and:
- fix what is real (fixed), with a test that fails on the old code where a test can show it;
- explain what is not real (notReal);
- list real defects you could not fix in stillOpen, with severity blocking (it breaks a brief item, a ground rule or data, or crashes) or minor (small and safe to merge);
- list gates that cannot be shown now for reasons outside the code, such as a timing gate on a busy machine or a later chunk (deferred, with the measured numbers);
- list look or feel choices that belong to the owner (ownerChoices, with the options and your recommendation).
An unmet brief requirement is a real defect: meet it, or list it in stillOpen as blocking. Work through Must fix; touch the Optional list only where a fix is trivial and safe. Add no behaviour the brief does not ask for.

## Must fix
Runner: ${runnerText}

Blocking:
${JSON.stringify(audit.blocking, null, 1)}

Unmet:
${JSON.stringify(audit.unmet, null, 1)}

## Optional (fix only if trivial and safe)
${JSON.stringify(audit.minor, null, 1)}

${SPEC}

Commit as \`${A.chunk} verify-fix: <what>\`; ${trailer('opus')}. The build and full test suite must pass at the end.`,
    { label: `fix:${A.chunk}`, phase: 'Fix', model: 'opus', effort: 'xhigh', schema: FIX_SCHEMA })
  if (fix) {
    const range = run1 && run1.head ? `\`${GIT} diff ${run1.head}..${A.branch}\`` : `the commits whose message starts with "${A.chunk} verify-fix:" (\`${GIT} log --oneline ${BASE}..${A.branch}\`)`
    // A meeting only when the fixer disputes findings: an Opus arbiter settles each one in the code (label meet:<chunk>).
    disputed = (audit.blocking.length + audit.unmet.length) > 0 && list(fix.notReal).length > 0
    const after = await parallel([
      () => agent(runnerPrompt('re-verify after fix'), { label: `reverify-run:${A.chunk}`, phase: 'Fix', model: 'haiku', effort: 'low', schema: RUN_SCHEMA }),
      () => agent(`${CTX}

You are the regression auditor (Sonnet) for chunk "${A.chunk}" on branch \`${A.branch}\`. ${READ_ONLY} After review and verify, a fixer (Opus) changed the branch. Audit only that change: ${range}. If the range is empty, return empty lists.

${SPEC}

The fixer reported:
${JSON.stringify({ fixed: fix.fixed, notReal: fix.notReal, stillOpen: fix.stillOpen, deferred: fix.deferred, ownerChoices: fix.ownerChoices }, null, 1)}

Check that each change is correct and breaks nothing the brief asks for${PRIVATE.length ? `, that no added line contains ${PRIVATE.map(t => `"${t}"`).join(', ')} (any case)` : ''}, that new tests would fail on the old code, and that nothing beyond the listed problems crept in (new behaviour the brief does not ask for goes in minor, or in blocking if it is risky). Put in blocking only defects you verified in the code (file:line and why); leave unmet and specSilences empty.`,
        { label: `verify-regression:${A.chunk}`, phase: 'Fix', model: 'sonnet', effort: 'high', schema: AUDIT_SCHEMA }),
      ...(disputed ? [() => agent(`${CTX}

You chair a short meeting (the arbiter, Opus) for chunk "${A.chunk}" on branch \`${A.branch}\`. ${READ_ONLY} The independent audit raised the findings below; the fixer (Opus) called some of them not real. Settle every finding the fixer neither fixed nor listed in stillOpen: read the code (and the images, when the finding is about the look) and rule upheld (the defect is real and still in the code) or dismissed (the fixer's reason holds), with one or two sentences of evidence (file:line). Judge on the code and the brief, not on who said it; when the evidence is truly even, uphold only a finding that breaks a brief item, a ground rule or data, or crashes. Add no new findings.

${SPEC}

Audit findings, blocking:
${JSON.stringify(audit.blocking, null, 1)}

Audit findings, unmet:
${JSON.stringify(audit.unmet, null, 1)}

The fixer called these not real:
${JSON.stringify(fix.notReal, null, 1)}

The fixer fixed:
${JSON.stringify(fix.fixed, null, 1)}

The fixer's stillOpen:
${JSON.stringify(fix.stillOpen, null, 1)}`,
        { label: `meet:${A.chunk}`, phase: 'Fix', model: 'opus', effort: 'high', schema: MEET_SCHEMA })] : []),
    ])
    run2 = after[0]
    regression = after[1]
    meeting = disputed ? after[2] || null : null
  }
}

const blockingOpen = fix ? list(fix.stillOpen).filter(s => typeof s === 'string' || s.severity !== 'minor') : []
let why = ''
if (!audits.length) why = 'no audit lens returned a result'
else if (!needFix) why = ''
else if (!fix) why = 'fixer returned nothing'
else if (!fix.testsGreen) why = 'fixer reports tests not green'
else if (!(run2 && run2.ok)) why = `re-verify failed: ${failedSteps(run2)}`
else if (blockingOpen.length) why = `stillOpen: ${blockingOpen.map(s => (typeof s === 'string' ? s : s.what)).join(' | ')}`
else if (!regression) why = 'regression lens returned nothing'
else if (list(regression.blocking).length) why = `regression: ${regression.blocking.map(b => `${b.where}: ${b.problem}`).join(' | ')}`
else if (disputed && !meeting) why = 'the meeting on disputed findings returned nothing'
else if (meeting && list(meeting.rulings).some(x => x.ruling === 'upheld')) why = `meeting upheld: ${list(meeting.rulings).filter(x => x.ruling === 'upheld').map(x => `${x.finding} (${x.why})`).join(' | ')}`
const ok = !why
log(`${A.chunk}: ${ok ? 'verified' : `NOT verified (${why})`}`)
return { chunk: A.chunk, branch: A.branch, ok, why, rigor: RIGOR_NAME, missingLenses, specSilences: audit.specSilences, scout, design, build, review, verify: { run: run1, audit }, fix, reverify: run2, regression, meeting }
