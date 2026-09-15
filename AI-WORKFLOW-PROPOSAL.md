# Proposal — optimizing Famlin's AI workflow

**Status:** proposal, not adopted. Nothing in here is implemented yet.
**Scope:** how AI assistants (Claude Code in CLI/web, and GitHub-triggered runs) participate in
Famlin's development loop — specifically the **triage → spec → grill** stages that currently
don't exist as artifacts.

---

## 1. Where things stand today

An audit of the repo as of `0.6.6` (`661bfbf`):

| Surface | State |
| --- | --- |
| `CLAUDE.md` | 64 KB, one file, loaded in full on **every** session regardless of what's being worked on |
| `AI-GUIDELINES.md` | 12 KB of prose aimed at humans; drifted (references a `/graphify` command that isn't part of this repo's setup) |
| `.claude/` | one skill (`verify`). No `settings.json`, no commands, no agents, no hooks |
| `.github/workflows/` | 5 workflows (`ci`, `docker-publish`, `pages`, `mobile-build`, `release-please`) — **none** invoke an AI stage |
| Open issues | 2, both one-paragraph feature asks (#118 Family Wiki, #75 Family Circles). No spec, no sizing, no area labels |
| Open PRs | 20, **all 20** are Dependabot dependency bumps |
| Dependency automation | `.github/dependabot.yml` **and** `renovate.json` are both checked in, both covering npm across the same five install trees |
| Test coverage | Healthy — 57 test files (32 backend, 11 web, 9 mobile, 5 api-client). *Not* a weak point |
| Regression guards | Strong and bespoke: `check-native-peer-deps.mjs`, `expo install --check`, `expo export` (Metro), `fastify-v5-compat.test.ts`, `api-breaking-changes` (oasdiff) |

### The four real problems

**A. Context is loaded indiscriminately.** `CLAUDE.md` is ~16k tokens of extremely dense,
hard-won architectural prose. A session bumping a docs dependency loads the entire cross-posting
fan-out contract, the trip check-in transaction semantics, and the HEIC rendition pipeline. Every
turn. This costs money, and — more importantly — dilutes attention: the eight rules that actually
prevent bugs are buried among two hundred facts that don't apply to the task at hand.

**B. There is no artifact between an issue and a PR.** Famlin features fan out further than
almost any codebase this size: adding a post type touches `schema.prisma` + a migration,
`services/postTypes/`, `routes/posts.ts`, `docs/openapi/famlin.yaml`, the generated API reference,
`packages/api-client`, `web/`, `mobile/`, `docs/developers/architecture.md`, the CLAUDE.md
architecture table, and `en.json` + `nl.json`. With a one-paragraph issue as the only input, the
assistant invents the scope — and the scope it invents is the part you then have to review hardest.

**C. Nothing systematically attacks a change before it ships.** Famlin's expensive historical bugs
share a signature: *green tsc, green Jest, green dev — broken in production.* The worklets 0.10.2
launch crash. The `tslib` Metro-only resolution failure. The `export *` barrel that only breaks
under Rollup. Fastify 5's `hostname` silently dropping the port. The bodyless-`DELETE`
`Content-Type` 400. Each one was fixed by adding a bespoke CI guard *after* it burned someone.
That knowledge now lives as comments scattered across `ci.yml`, `dependabot.yml` and `CLAUDE.md` —
it is never applied as a checklist to a *new* change.

**D. Triage debt is crowding out real work.** 20 open dependency PRs against 2 open feature issues.
Two dependency bots are configured against the same trees, so either Renovate isn't installed
(dead config that will produce duplicate PRs the day someone enables it) or it is and you're
already getting both. Nothing is labelled by area, size, or risk, so there's no way to ask
"what should I work on next" and get a useful answer — from a human or an assistant.

---

## 2. Proposed pipeline

```
issue/idea ──▶ TRIAGE ──▶ SPEC ──▶ GRILL ──▶ build ──▶ verify ──▶ GRILL(diff) ──▶ PR ──▶ ship
               label      docs/     attack    existing   existing   attack the
               size       specs/    the plan  workflow   /verify    diff
               route      *.md      on paper                        skill
```

Three new stages, each a Claude Code skill in `.claude/skills/`, each producing a
**reviewable artifact** rather than a conversation.

---

## 3. Phase 0 — Fix the context (do this first)

Highest ROI of anything in this document, and it makes every later phase work better.

### 3.1 Split `CLAUDE.md`

Claude Code loads a directory's `CLAUDE.md` when work touches that directory. Use it.

```
CLAUDE.md                        ~6 KB   repo map, commands, the non-negotiable rules
backend/CLAUDE.md               ~14 KB   routes table, data model, services, ESM/Prisma gotchas
backend/admin/CLAUDE.md          ~2 KB   admin UI conventions
mobile/CLAUDE.md                 ~4 KB   Expo native-dep rules, screens/navigation/stores
web/CLAUDE.md                    ~5 KB   web app structure, design tokens, BottomNav rules
packages/api-client/CLAUDE.md    ~3 KB   barrel/named-export rule, storage adapter seam
docs/CLAUDE.md                   ~3 KB   two-tab layout, OpenAPI regeneration, baseUrl rule
```

Deep reference that only matters when you're *in* that subsystem moves to progressively-disclosed
skills, loaded on demand instead of always:

- `.claude/skills/post-types/` — the `PostTypeHandler` contract, hook order, `typeData`
  mutability exceptions, cross-post fan-out and row-locking rules
- `.claude/skills/media-providers/` — the `MediaProvider` contract, `isAssetInAlbum` as a security
  requirement, Range-header relaying, the upload variants/HEIC pipeline
- `.claude/skills/notifications/` — the event bus, subscriber policy ownership, `NotifyType`,
  the dedupe pattern for cross-post siblings

**Target:** root `CLAUDE.md` under 8 KB. It should contain the repo map, the commands table, and a
short **"Rules that are never negotiable"** list — nothing else. Everything currently in it is
worth keeping; this is a relocation, not a deletion.

### 3.2 Rewrite `AI-GUIDELINES.md` as two documents

It currently mixes three audiences. Split it:

- **`AI-GUIDELINES.md`** — keep the human-facing half: when to use AI, disclosure in PRs, "every
  line of code is yours". Trim the generic advice (`no any`, `write tests`) that CLAUDE.md and the
  linter already enforce. Fix the `/graphify` reference. Target ~4 KB.
- **Machine-facing rules** → fold into the root `CLAUDE.md` "never negotiable" list, where an
  assistant will actually read them.

### 3.3 Add `.claude/settings.json`

Pre-allow the read-only and routine commands this repo runs constantly (`npm run lint`,
`npx tsc --noEmit`, `npx vitest run`, `git status/diff/log`, `docker ps`) so sessions stop
stalling on permission prompts. The `/fewer-permission-prompts` skill can generate the initial
allowlist from actual transcript history rather than guesswork.

---

## 4. Phase 1 — `/triage`

### 4.1 Clean up first (one-time, ~1 hour)

1. **Pick one dependency bot.** Recommend **Renovate** — `renovate.json` already encodes the
   Expo carve-out correctly, it groups better, it supports automerge rules Dependabot can't
   express, and it does lockfile maintenance. Delete `.github/dependabot.yml`, or delete
   `renovate.json` if Renovate was never actually installed. Do not keep both.
2. **Automerge the boring tier.** Patch and minor bumps for `docs/**` (build-time only, never
   reaches a deployment — `dependabot.yml` already says so) and for devDependencies across all
   trees: automerge on green CI. That alone would have closed roughly half of the current 20.
3. **Burn down the remaining 20**, grouped by risk tier (§4.3), majors last.

### 4.2 Label taxonomy

Three axes, applied to every issue and non-bot PR:

```
area:backend  area:web  area:mobile  area:admin  area:docs  area:infra
type:bug  type:feat  type:chore  type:security  type:breaking
size:S (<1 session)  size:M (1-3)  size:L (needs decomposition)
```

Plus workflow state: `needs-spec`, `spec-ready`, `blocked`, `wontfix`.

### 4.3 The skill

`.claude/skills/triage/SKILL.md` — takes an issue number, a PR number, or nothing (sweep the
whole backlog). For each item it produces:

- **Area labels**, derived from which parts of the repo the change would touch — not from the
  reporter's guess in the issue-template dropdown.
- **Size estimate**, explicitly counting the fan-out surfaces (backend / api-client / web /
  mobile / docs / OpenAPI / i18n). `size:L` is anything hitting four or more.
- **A duplicate check** against open and recently-closed issues.
- **A route**: `needs-spec` (anything `type:feat` or `size:L`), straight-to-build (`size:S` bug
  with a clear repro), or a question back to the reporter with the specific missing detail named.
- **For dependency PRs, a risk tier**:
  - *auto* — docs tree, devDependency, patch/minor → automerge
  - *review* — backend runtime dependency (fastify, prisma, sharp, jose, nodemailer), or any major
  - *hold* — anything in `mobile/`'s Expo surface, which must move via `npx expo install` and
    never via a bot PR

Output is a proposed label set and a one-paragraph rationale per item — posted as a comment or
printed locally, never applied silently.

### 4.4 Wire it up (optional, Phase 4)

`.github/workflows/claude-triage.yml`, on `issues: [opened]` — runs the skill and posts labels +
rationale as a comment. Keep it advisory at first; let it apply labels directly only once its
suggestions have been right for a few weeks.

---

## 5. Phase 2 — `/spec`

### 5.1 Why a spec file, not a chat

The spec is the thing you review *before* the diff exists, when changing your mind is free. It's
also the durable input that lets a fresh session (or a GitHub-triggered run, or you in three
weeks) pick the work up without re-deriving the scope.

### 5.2 Location and shape

`docs/specs/NNN-short-name.md`, numbered by issue. Kept out of the Docusaurus build — these are
working documents, not published docs. One template, derived from what Famlin features *actually*
need:

```markdown
# NNN — <title>

Issue: #NNN · Size: S/M/L · Areas: backend, web, mobile

## Problem
What can't a family do today. User-facing, no implementation.

## Proposal
What changes, in behaviour terms.

## Out of scope
Explicit. This is the section that stops scope invention.

## Surfaces touched
- [ ] `schema.prisma` + migration        (reversible? data loss?)
- [ ] backend routes / services
- [ ] `docs/openapi/famlin.yaml`         (+ regenerate API reference)
- [ ] `packages/api-client`              (+ rebuild + commit dist/)
- [ ] `web/`
- [ ] `mobile/`                          (min app version impact?)
- [ ] `backend/admin/`
- [ ] i18n: en + nl, both locale sets
- [ ] docs (which row of the CLAUDE.md Documentation table?)

## Authorization
Which group-membership check applies. Who may read, who may mutate.
Admin-only? Author-only? Cross-post sibling implications?

## Data model
New tables/columns, cascade behaviour, unique constraints.
Anything persisted whose identifier can never be renamed later?

## Breaking change?
yes/no. If yes: the `feat!:` marker and what an admin must do on upgrade.

## Test plan
Which existing test files extend; which new regression guard this needs.

## Open questions
```

### 5.3 The skill

`.claude/skills/spec/SKILL.md` — given an issue number, reads the issue, explores the relevant
subsystem, and drafts the spec file. It must fill **Out of scope** and **Surfaces touched**
from real code exploration rather than leaving them for the human. It ends by *stopping* — a spec
run never writes implementation code.

**Backlog test:** run it against #118 (Family Wiki) and #75 (Family Circles). Both are `size:L`
by the fan-out rule and both are exactly the kind of feature that goes wrong without one.

---

## 6. Phase 3 — `/grill`

The highest-value new stage, and the one most specific to this codebase.

### 6.1 What it is

An adversarial pass whose job is to **find the reason this will break**, not to praise the design.
It runs in two modes:

- `/grill spec docs/specs/118-family-wiki.md` — attack the plan on paper
- `/grill diff` — attack the working tree or a PR before it's opened

It deliberately does *not* overlap with `/code-review` (which hunts general correctness bugs) or
`/security-review`. `/grill` checks a change against **Famlin's own accumulated trap list** — the
things that have actually shipped broken here.

### 6.2 The trap list

Drawn verbatim from the incidents encoded in this repo's guards and comments:

**Ships green, breaks in production**
- Mobile native deps bumped by hand instead of `npx expo install` → mixed precompiled/source
  linkage → dyld crash at launch. tsc/Jest/dev all stay green.
- Module resolution that satisfies tsc and Jest but not Metro (the `tslib` incident).
- `export *` in `packages/api-client`'s barrel → Rollup can't statically resolve → web
  production build breaks, while `tsc --noEmit`, Jest and Metro all pass.
- `request.hostname` instead of `request.host` → port silently dropped from invite links and
  OIDC `redirect_uri` on any non-80/443 deployment.
- Removing `app.ts`'s bodyless-`Content-Type` hook → every axios `DELETE` 400s before reaching
  its handler, on every already-installed client.

**Authorization and data**
- A posts query that doesn't filter on the caller's group membership.
- `requireAdmin` called without `return` — handler keeps running after the 403 is sent.
- Loosening the `uploadedAssetUrls` / `assetUrl` zod regex to a bare string — that regex is what
  stops a post linking to an arbitrary external URL.
- A new media-provider path that skips `isAssetInAlbum()` — that check is the security boundary,
  not a cache optimization.
- `err.message` echoed to a client instead of a translated error code.
- A migration whose cascade deletes more than intended. There is no soft delete and no restore.

**Contracts that outlive the commit**
- Renaming a persisted identifier: post-type ids, media-provider ids (`immich`/`local`).
- Breaking a legacy mirror: `attachmentUrl` must stay `attachmentUrls[0]`; `/api/immich/*` URLs
  are stored in existing posts and still requested by shipped mobile builds.
- A new post-type interaction that doesn't fan out across `crossPostId` siblings, or doesn't take
  the row locks the trip handler takes.
- Bumping `minAppVersion` without a breaking marker.
- An API change to `docs/openapi/famlin.yaml` without a `feat!:` / `BREAKING CHANGE:` marker —
  CI catches this one, but only for spec changes, never for env vars or deploy steps.

**Completeness**
- i18n keys added to `en.json` but not `nl.json` (or vice versa).
- `packages/api-client/src/` changed without rebuilding and committing `dist/`.
- OpenAPI edited without regenerating the API reference.
- A change matching a row of the CLAUDE.md Documentation table with no matching doc edit.

### 6.3 Output contract

A grill produces findings ranked by severity, each with a **concrete failure scenario** — inputs
and state → wrong behaviour — not a vague concern. A finding with no scenario gets dropped.
Grilling a spec additionally asks: *what regression guard would have caught this class of bug?*
That question is how the trap list grows. When a grill surfaces a genuinely new class, the fix
is a new guard in `ci.yml` or a pinning test, **and a new line in the trap list.**

### 6.4 Keeping it honest

The list above should live in `.claude/skills/grill/references/traps.md` and be appended to
whenever an incident escapes to `main`. A grill that finds nothing on a large diff is a signal
the list is stale, not that the diff is clean.

---

## 7. Phase 4 — Wire into GitHub (optional)

Only after the skills have earned trust locally.

| Workflow | Trigger | Does |
| --- | --- | --- |
| `claude-triage.yml` | `issues: [opened]` | Labels + sizes + routes; comments the rationale |
| `claude-grill.yml` | `pull_request: [opened, synchronize]` | Runs `/grill diff`; posts findings as a review |

Both start advisory (comment only, never blocking). Cost control: skip on PRs labelled
`dependencies`, and on draft PRs.

---

## 8. Sequencing and effort

| Phase | Work | Effort | Unblocks |
| --- | --- | --- | --- |
| 0 | Split CLAUDE.md, trim AI-GUIDELINES, add settings.json | ~half a day | everything |
| 1a | Kill the duplicate dep bot, add automerge, burn down 20 PRs | ~1 hour + CI time | a readable PR list |
| 1b | Label taxonomy + `/triage` skill | ~half a day | 1a, 2 |
| 2 | `docs/specs/` + template + `/spec` skill | ~half a day | 3 |
| 3 | `/grill` skill + trap list | ~1 day | — |
| 4 | GitHub workflows | ~half a day | needs 1b + 3 |

**If only one thing gets done: Phase 0 + Phase 1a.** The context split improves every single
future session, and the dependency cleanup is an hour that removes 20 items of noise from the
one list you look at every day.

**If two: add Phase 3.** The trap list is knowledge that currently exists only in scattered code
comments and in your head, and it's the knowledge that would have prevented the incidents that
actually cost this project real time.

---

## 9. How to know it worked

Not vanity metrics — these are all observable from the repo:

- **Root `CLAUDE.md` under 8 KB.** Directly measurable.
- **Open dependency PRs stay under 5.** Currently 20.
- **Every `type:feat` issue merged has a spec file.** If a feature ships without one, either the
  spec stage isn't earning its keep or it's being skipped under pressure — both worth knowing.
- **New CI guards trace back to a grill finding**, not to a production incident. This is the real
  one: the trap list should start growing from *predicted* failures rather than experienced ones.
- **Time from issue-opened to first label**, as a proxy for whether triage is actually running.

---

## 10. What this proposal deliberately leaves alone

- **Test strategy.** 57 test files across four packages is healthy. The gap is guard classes,
  not coverage numbers, and that's §6.3's job.
- **CI structure.** `ci.yml` is well-factored, its path filtering is correct, and its bespoke
  guards are the best thing about this repo's engineering. Adding AI stages should not touch it.
- **`/verify`.** The existing skill is good and stays exactly as it is; `/grill diff` runs
  alongside it, not instead of it.
- **Commit-message authorship.** `AI-GUIDELINES.md` is right that these are the author's to write.
  Nothing here changes that.
