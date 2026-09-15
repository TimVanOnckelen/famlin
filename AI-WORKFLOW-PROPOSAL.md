# Proposal — Famlin's AI engineering flow

**Status:** proposal (v2), not adopted. Nothing here is implemented yet.
**Supersedes:** v1 of this file, which had triage as a backlog-grooming stage at the front.

A single, documented, enforced flow that any AI-assisted contributor follows — regardless of
which assistant they use:

```
SPEC ──▶ GRILL ──▶ IMPLEMENT ──▶ TRIAGE
 │        │          │             │
 │        │          │             └── every finding gets a disposition; follow-ups become
 │        │          │                 the next SPEC
 │        │          └── the PR, bound to the spec
 │        └── adversarial pass; findings recorded in the spec
 └── specs/NNN-slug.md
```

---

## 0. One interpretation to confirm

Putting triage **last** reframes it, and I've designed to that reframing:

> **Triage is not backlog grooming. It is the disposition of everything the work produced.**

After implementation you are holding a pile of loose ends — grill findings, CI results, review
comments, out-of-scope things you discovered mid-build, a regression class you now know about.
Triage is the stage where every one of those resolves to exactly one of `fixed`,
`guard added`, `follow-up #NNN`, or `wontfix: <reason>`. Nothing is allowed to evaporate.

That makes the loop closed: triage's follow-ups are the input to the next spec. It also makes
triage the **only stage that is fully mechanically enforceable**, because "every finding has a
disposition, and every disposition resolves to something real" is a property a script can check.

Backlog grooming is still a thing that needs doing — 20 open dependency PRs, §7 — but it's a
maintainer chore on a schedule, not a stage in a contributor's flow. I've moved it out.

**If you meant something else by triage-last, this is the one thing worth correcting before
anything gets built.** Everything else in this document stands either way.

---

## 1. The two requirements, taken seriously

### "Works for every AI engineer"

This rules out building the flow out of Claude Code skills. A contributor on Cursor, Copilot,
Codex, Gemini or plain chat has to be able to follow the identical process, and a maintainer has
to be able to verify they did without knowing or caring which tool they used.

So the design rule is:

> **The artifacts are the contract. The tooling is interchangeable.**

The flow is defined by **files in the repo** and **checks in CI**. Every assistant gets a thin
adapter that points at the same canonical, tool-neutral stage documents. One source of truth,
many adapters:

```
docs/developers/ai-workflow/     ← canonical, tool-neutral. The only place the flow is defined.
  ├── index.md            the contract, the four stages, what is enforced and how
  ├── 1-spec.md
  ├── 2-grill.md
  ├── 3-implement.md
  ├── 4-triage.md
  ├── traps.md            Famlin's accumulated failure classes — the grill's input
  └── example.md          issue #118 walked end to end, all four artifacts

AGENTS.md                        ← cross-tool convention; ~15 lines, points at the above
.claude/skills/{spec,grill,implement,triage}/SKILL.md
                                 ← thin adapters: "follow docs/developers/ai-workflow/N-*.md",
                                   plus the Claude-specific mechanics (which tools, how to run
                                   the local validator)
.github/copilot-instructions.md  ← pointer
.cursor/rules/ai-workflow.mdc    ← pointer
```

If a stage document and an adapter ever disagree, the stage document wins. Adapters carry
mechanics only — never policy.

### "Enforced"

Enforcement is where processes like this usually die, in one of two ways: it's too weak to
matter, or it's strong enough to produce checkbox theatre. Both are worth designing against
explicitly, so §4 splits enforcement into three honest tiers, and §6 is about theatre.

The blunt version: **you cannot mechanically enforce that someone thought.** You can enforce
that the artifact of thinking exists, is well-formed, is bound to the thing it describes, and
resolves to something real — and you can make a shallow pass *visible*. That is the actual
ceiling, and the design aims at it rather than pretending to more.

---

## 2. Proportionality — the thing that keeps it alive

A four-stage flow applied uniformly to a typo fix will be abandoned inside a month. The flow
scales with the change:

| Tier | What it covers | Spec | Grill | Triage |
| --- | --- | --- | --- | --- |
| `flow:trivial` | dependency bumps, lockfiles, typos, release-please PRs | — | — | — |
| **size:S** | one package, no API/schema/i18n change, clear repro | `## Spec` section in the PR body | trap-list checklist in the PR body | dispositions in the PR body |
| **size:M / size:L** | anything touching 2+ surfaces, or schema, API, auth, or a post type | `specs/NNN-slug.md` | grill log inside the spec | dispositions + follow-up issues |

CI picks the tier from labels and changed paths, and **auto-escalates**: a PR labelled `size:S`
whose diff touches `schema.prisma`, `docs/openapi/famlin.yaml`, `packages/api-client/src/`, or
any auth/permission path is bumped to M and told to produce a spec file. You can opt *up*
freely; opting *down* needs a CODEOWNER label (§5).

Trivial is auto-detected, not self-declared — path-based, so nobody can label their way out.

---

## 3. The four stages and their artifacts

### Stage 1 — SPEC → `specs/NNN-slug.md`

Repo-root `specs/`, **not** `docs/specs/` — `docs/` is the Docusaurus package root, and a
`docs/specs/` directory would sit inside it confusingly. Specs are working documents, not
published docs.

Numbered by issue. Required YAML front-matter:

```yaml
---
spec: 118
title: Family Wiki
issue: 118
status: draft | grilled | implementing | shipped | abandoned
size: S | M | L
areas: [backend, web, mobile, admin, docs, infra]
breaking: false
grilled_at: null          # sha256 of the spec body above the grill log; set by stage 2
---
```

Required sections. Each must be non-empty, **or** explicitly waived as `N/A — <reason>`:

| Section | Purpose |
| --- | --- |
| `## Problem` | What a family can't do today. User-facing, no implementation. |
| `## Proposal` | What changes, in behaviour terms. |
| `## Out of scope` | The section that stops an assistant inventing scope. |
| `## Surfaces touched` | Checklist, §4.2 — the one CI cross-checks against the diff. |
| `## Authorization` | Which group-membership rule applies; who reads, who mutates, cross-post implications. |
| `## Data model` | New tables/columns, cascades, uniques, identifiers that can never be renamed. |
| `## Breaking change` | yes/no; if yes, the marker and what an admin must do on upgrade. |
| `## Test plan` | Which existing test files extend; which new regression guard this needs. |
| `## Open questions` | |

The `N/A — <reason>` escape is deliberate: it makes both a blank section and mindless
boilerplate fail, while letting a genuinely inapplicable section be dismissed in a sentence.

A spec run **stops at the spec**. It never writes implementation code. That boundary is the
whole point of having the stage.

### Stage 2 — GRILL → a `## Grill log` section inside the same spec

One file, not two: the grill is *about* the spec, and keeping them together is what lets CI bind
them (§4.3).

```markdown
## Grill log

Grilled against: `a3f9c2…` · 2026-09-15 · claude-opus-5, reviewed by @TimVanOnckelen

### G1 — high · Check-in fan-out skips siblings the author left
**Scenario:** author cross-posts a trip to groups A and B, is removed from B, then checks in.
The spec's interaction writes one Comment per sibling without re-checking membership, so B's
members see a check-in from a non-member.
**Disposition:** fixed — membership re-checked inside the transaction

### G2 — medium · No guard for en/nl key drift
**Scenario:** wiki page titles add 6 keys to en.json; nl.json is updated by hand and misses one;
Dutch users see a raw key. tsc, lint and every test stay green.
**Disposition:** guard: .github/workflows/ci.yml (locale key-parity check)
```

Allowed dispositions — a closed set, because CI parses them:

```
fixed                        resolved in this change
guard: <path>                a regression guard was added at that path
follow-up: #NNN              deferred to a real, existing issue
wontfix: <reason>            deliberate, with the reason stated
```

The grill's job is to **find the reason this breaks**, not to evaluate the design. It works from
`traps.md` — Famlin's own accumulated failure classes (§8) — and every grill ends by asking:
*what regression guard would have caught this class?* That question is how `traps.md` grows.

`/grill` is deliberately distinct from `/code-review` (general correctness) and
`/security-review` (security). It runs in two modes: against a spec (on paper, before code) and
against a diff (before the PR opens).

### Stage 3 — IMPLEMENT → the PR, bound to the spec

The PR body must carry `Spec: specs/118-family-wiki.md`. That one line is what binds all the
downstream checks together. Everything else about implementation stays exactly as it is today —
the existing CI, the existing `/verify` skill, the existing guards. This stage adds no new
ceremony; it just has to be traceable.

### Stage 4 — TRIAGE → dispositions, and the loop closing

At the end, every open loose end resolves:

- every grill finding has a disposition (enforced — §4.3)
- every `follow-up: #NNN` points at an issue that exists (enforced)
- every follow-up issue carries `from-spec:NNN` so the loop is traceable
- every unresolved PR review thread is either addressed or answered
- the spec's `status` moves to `shipped`
- any *new* failure class discovered gets a line in `traps.md` **and** a guard

The last bullet is the compounding one. Every trip through the flow should leave the next one
slightly better defended.

---

## 4. Enforcement, in three honest tiers

### Tier 1 — hard gate: CI fails the PR

Only machine-verifiable facts. One new workflow, `.github/workflows/flow.yml`, plus a script
`scripts/flow-check.mjs` that CI and humans run identically.

**4.1 Binding checks**

| # | Check | Failure mode it prevents |
| --- | --- | --- |
| 1 | PR body contains `Spec: specs/NNN-*.md` (tier M/L) or a `## Spec` section (tier S) | work with no stated scope |
| 2 | That spec file exists on the PR head | a dangling reference |
| 3 | Front-matter parses; required keys present; enum values valid | drifting spec formats |
| 4 | Every required section present and non-empty, or `N/A — <reason>` | blank-section theatre |
| 5 | `## Grill log` has ≥1 finding, each with a non-empty `**Scenario:**` and a `**Disposition:**` from the closed set | a grill that didn't happen |
| 6 | Zero findings is only valid on `size: S`, and needs a stated rationale | rubber-stamping a large spec |
| 7 | `grilled_at` hash matches the current spec body above the grill log | a spec rewritten after it was grilled |
| 8 | Every `follow-up: #NNN` resolves to an existing issue | deferring into the void |
| 9 | Every `guard: <path>` exists in the diff or the repo | a guard that was never written |
| 10 | `breaking: true` in front-matter ⇒ a conventional-commit breaking marker present | an unmarked breaking change |

**4.2 Surfaces-touched ↔ diff cross-check** — the highest-value checks, and the most
Famlin-specific. These mechanize the "completeness" traps that currently live as prose:

| If the diff contains | It must also contain |
| --- | --- |
| `backend/prisma/schema.prisma` | a new directory under `backend/prisma/migrations/` |
| `packages/api-client/src/**` | `packages/api-client/dist/**` |
| `docs/openapi/famlin.yaml` | `docs/developers/api-reference/**` (regenerated) |
| a new file in `backend/src/services/postTypes/` | `docs/developers/architecture.md` |
| any `**/locales/en.json` | the sibling `nl.json`, **with an identical key set** |

The last one deserves its own standalone job, because it needs no spec, no tier and no PR body
parsing — just walk every locale pair in the repo and compare key sets. It catches a documented
recurring class ("i18n is mandatory — no hardcoded UI strings"), it can run on `main` as well as
PRs, and it's about thirty lines. **It's the single cheapest enforcement win available here and
it should ship first, independent of everything else in this proposal.**

**4.3 Binding grill to spec**

`grilled_at` is `sha256` of the spec body above `## Grill log`. Edit the Problem or the Surfaces
list after grilling and the hash stops matching, so CI demands a re-grill. This is a speed bump
against drift, not a cryptographic guarantee — the hash is recomputed by the grill command, so
faking it means deliberately faking it. That's the correct level of force: it stops accidents
and makes evasion a conscious act.

### Tier 2 — soft gate: bot comments, never blocking

Judgment calls. Hard-failing a PR on a model's opinion is a bad gate and will get the whole flow
disabled the first time it's wrong.

- **Independent grill cross-check.** `claude-grill.yml` runs a grill on the diff and compares its
  findings against the spec's grill log. Findings the log doesn't mention get posted as a
  comment: *"the grill log doesn't cover X."* This is the honest answer to enforcing a thinking
  stage — you can't compel thought, but you can make its absence legible, to the author and to
  the reviewer.
- **Size/tier suggestion** from the diff's actual fan-out.
- **Doc-table check**: diff matches a row of the CLAUDE.md Documentation table with no
  corresponding doc edit.

Both skip on `dependencies`-labelled and draft PRs, for cost.

### Tier 3 — convention

Templates, the stage docs, the CLAUDE.md rule, `AGENTS.md`. No teeth, and that's fine — this
tier's job is to make the right thing the obvious thing, so Tier 1 rarely has to fire.

### Local parity — non-negotiable

```bash
npm run flow:check          # runs exactly what CI runs, against the working tree
npm run flow:check -- --fix # fills what can be filled: hashes, front-matter scaffolding
```

Enforcement you can only discover by pushing and waiting for CI is hostile, and it's the fastest
way to make contributors resent a process. Same script, same rules, both places.

---

## 5. Escape hatches (mandatory)

A process with no exit is a process people route around, and routing around it destroys the
signal the process exists to produce. So the exits are explicit, few, and logged:

| Hatch | Who | Effect |
| --- | --- | --- |
| `flow:exempt` label | CODEOWNER only | skips Tier 1 entirely; CI posts *why it was skipped* into the PR thread |
| `flow:trivial` | auto, path-based | no stages; not self-declarable |
| `N/A — <reason>` | anyone | waives one spec section, with the reason on record |
| `wontfix: <reason>` | anyone | closes a grill finding, with the reason on record |

Every hatch leaves a written reason. The goal isn't to prevent skipping — it's to make skipping
visible and attributable. An exemption rate worth worrying about will show up in the data
(§9) rather than being invisible.

---

## 6. How this fails, and what's designed against it

Worth writing down before building, because these are the realistic failure modes:

**Checkbox theatre.** Sections get filled with plausible nothing. *Designed against:* the
`N/A — <reason>` requirement makes empty and boilerplate both fail; dispositions must resolve to
real issues and real file paths; the Tier 2 cross-check surfaces shallow grills. *Residual risk:*
a determined contributor can still write a plausible-but-hollow scenario. Nothing fixes that but
review.

**Process weight.** Four stages on every change kills velocity on a repo with two open issues.
*Designed against:* the tiering in §2 — most PRs here are trivial or size:S and never touch a
spec file.

**Adapter drift.** `.claude/`, `.cursor/` and `copilot-instructions.md` slowly disagree.
*Designed against:* adapters contain mechanics only, never policy, and a Tier 1 check can assert
each adapter contains the canonical pointer line.

**Stale traps.** `traps.md` stops growing and the grill goes through the motions.
*Designed against:* it's a §9 metric — new guards should trace to grill findings, not to
incidents.

**Solo-maintainer overhead.** You end up writing specs to satisfy your own CI at 11pm.
*Designed against:* `flow:exempt` is yours, and using it is a legitimate outcome, not a defeat.
If the exemption rate is high, that's information about the tiering being wrong.

---

## 7. What moved out of this flow

Backlog grooming is real work but it isn't a contributor stage. Handle it separately:

1. **Pick one dependency bot.** `.github/dependabot.yml` and `renovate.json` are both checked in
   against the same five npm trees. All 20 open PRs are Dependabot's. Recommend keeping
   **Renovate** (it already encodes the Expo carve-out, groups better, supports automerge rules
   Dependabot can't express, does lockfile maintenance) and deleting the other. Keeping both is
   the worst option.
2. **Automerge the boring tier** on green CI: `docs/**` patch+minor (build-time only, never
   reaches a deployment) and devDependencies everywhere. That alone clears roughly half of the 20.
3. **A monthly grooming pass**, not a per-PR stage.

This is an hour of work and it's independent of everything else here. It should happen first
regardless of whether the flow is adopted.

---

## 8. `traps.md` — the grill's input

The grill is only as good as its checklist, and Famlin's checklist is unusually good because
it's been paid for. Drawn from the guards and comments already in the repo:

**Ships green, breaks in production**
- Mobile native deps bumped by hand instead of `npx expo install` → mixed precompiled/source
  linkage → dyld crash at launch, with tsc, Jest and dev all green.
- Module resolution that satisfies tsc and Jest but not Metro (the `tslib` incident).
- `export *` in the api-client barrel → Rollup can't statically resolve → web production build
  breaks while `tsc --noEmit`, Jest and Metro pass.
- `request.hostname` instead of `request.host` → port silently dropped from invite links and the
  OIDC `redirect_uri` on any deployment not on 80/443.
- Removing `app.ts`'s bodyless-`Content-Type` hook → every axios `DELETE` 400s before reaching
  its handler, on every already-installed client.

**Authorization and data**
- A posts query not filtered on the caller's group membership.
- `requireAdmin` called without `return` — the handler continues after the 403 is sent.
- Loosening the `uploadedAssetUrls` / `assetUrl` zod regex — that regex is what stops a post
  linking to an arbitrary external URL.
- A media path that skips `isAssetInAlbum()` — a security boundary, not a cache optimization.
- `err.message` echoed to a client instead of a translated code.
- A migration whose cascade deletes more than intended. There is no soft delete and no restore.

**Contracts that outlive the commit**
- Renaming a persisted identifier: post-type ids, provider ids (`immich`/`local`).
- Breaking a legacy mirror: `attachmentUrl` must stay `attachmentUrls[0]`; `/api/immich/*` URLs
  are stored in existing posts and still requested by shipped mobile builds.
- A post-type interaction that doesn't fan out across `crossPostId` siblings, or skips the row
  locks the trip handler takes.
- Bumping `minAppVersion` without a breaking marker.
- A breaking change outside the OpenAPI spec — env vars, deploy steps — which CI cannot detect.

**Completeness** — all mechanized by §4.2, and listed here so the grill catches them earlier:
i18n en/nl parity · api-client `dist/` rebuilt · API reference regenerated · schema change has a
migration · CLAUDE.md Documentation table row honoured.

---

## 9. Build order

| # | Work | Effort | Notes |
| --- | --- | --- | --- |
| 1 | Locale key-parity CI job | ~1 h | Standalone. Ship it regardless of the rest. |
| 2 | Dependency-bot cleanup + automerge (§7) | ~1 h | Independent; clears the PR list. |
| 3 | `docs/developers/ai-workflow/` + `specs/TEMPLATE.md` + sidebar entry | ~1 day | Sidebars are explicit, not autogenerated — `sidebars-developers.ts` needs the entry added by hand. |
| 4 | `scripts/flow-check.mjs` + `npm run flow:check` + `flow.yml` (Tier 1) | ~1–2 days | Land it **advisory-only** first; flip to blocking after it's been right for a couple of weeks. |
| 5 | `traps.md` + the four stage docs | ~1 day | |
| 6 | Adapters: `AGENTS.md`, `.claude/skills/*`, Copilot, Cursor | ~half a day | Thin. Mechanics only. |
| 7 | `example.md` — #118 walked end to end | ~half a day | Highest teaching value per hour in the whole list. |
| 8 | Tier 2 cross-check workflow | ~half a day | Last, and only once Tier 1 is trusted. |

Items 1 and 2 are two hours and are worth doing whatever happens to the rest.

**Prerequisite:** Tier 1 only actually gates if the checks are marked required in branch
protection on `main`. Without that it's advisory no matter what the script returns.

---

## 10. How to tell it's working

- **Exemption rate.** `flow:exempt` on >20% of eligible PRs means the tiering is wrong, not that
  contributors are lazy.
- **New guards trace to grill findings, not to incidents.** The real one. `traps.md` should start
  growing from predicted failures rather than experienced ones.
- **Tier 1 failures fall over time** — the convention layer is doing its job and the hard gate
  rarely has to fire.
- **Tier 2 cross-check disagreements fall** — grills are getting deeper.
- **Every shipped `type:feat` has a spec**, and specs are reachable from the PRs that implemented
  them.
- **Open dependency PRs stay under 5.** Currently 20.

---

## 11. Explicitly out of scope

- **Test strategy.** 57 test files across four packages is healthy. The gap is guard *classes*,
  which is §8's job, not coverage numbers.
- **`ci.yml`'s structure.** Its path filtering and bespoke guards are the best engineering in this
  repo. The flow adds workflows alongside it and changes nothing inside it.
- **`/verify`.** Stays exactly as it is. `/grill diff` runs alongside it, not instead of it.
- **Commit-message authorship.** `AI-GUIDELINES.md` is right that these are the author's to
  write. Nothing here changes that.
- **CLAUDE.md's 64 KB.** Still worth splitting into directory-scoped files (it loads in full on
  every session regardless of task), but that's a separate change and not a dependency of this
  flow. Carried over from v1 of this proposal.
