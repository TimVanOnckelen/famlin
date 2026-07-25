# AI-Assisted Development Guidelines

This document provides guidance on how to effectively and responsibly use AI tools when contributing to Famlin.

## When to Use AI

### Ideal use cases
- **Scaffolding** — generating boilerplate code (components, routes, types, schemas)
- **Testing** — writing unit tests, fixtures, and test utilities
- **Documentation** — drafting comments, README sections, API documentation
- **Refactoring** — suggesting code improvements, finding unused code, simplifying logic
- **Search & navigation** — finding files, functions, or patterns across the codebase
- **Repetitive tasks** — bulk edits, renaming, migration scripts
- **Exploration** — understanding unfamiliar code, summarizing complex logic

### Exercise caution
- **Business logic** — AI should draft, not decide; requires human review and understanding
- **Security** — auth, permissions, data validation must be reviewed by someone who understands the implications
- **Database migrations** — careful review required; data loss is irreversible
- **Breaking changes** — API changes must be intentional and documented
- **Performance-critical code** — benchmarking and profiling should guide optimization
- **Architecture decisions** — should come from human judgment; AI can explore options

### Not recommended
- **Direct policy decisions** — what data to collect, how to store it, privacy trade-offs
- **Feature design** — UX decisions, product direction; AI is a tool, not a designer
- **Commit messages** — must be written by the author and reflect genuine intent

## Before Starting

1. **Read CLAUDE.md** — understand the project structure, conventions, and architecture
2. **Check the codebase** — understand existing patterns (folder structure, naming, testing)
3. **Know the constraints** — ESM modules, TypeScript strict mode, i18n requirement, permission model
4. **Review recent PRs** — see what's been done, what was rejected, and why
5. **Understand the context** — why are you making this change? What's the scope?

## Working with AI

### Prompt effectively
- **Be specific** — describe the exact file, function, or problem
- **Give context** — link to related code, explain constraints, mention edge cases
- **Show examples** — if style matters, show an existing pattern to follow
- **State assumptions** — what should remain unchanged? What's out of scope?

Example: "In `backend/src/routes/posts.ts`, add a `GET /on-this-day` endpoint that returns posts created on today's month/day in prior years, filtered to the caller's groups, cursor-paginated like `/api/posts`. Follow the pagination pattern in `services/pagination.ts`."

### Review everything
- **Don't assume correctness** — AI-generated code can have bugs, security holes, or style mismatches
- **Check against the spec** — does it match what you asked for? Does it cover edge cases?
- **Read the full diff** — understand what changed and why
- **Run tests locally** — generated tests might not catch real issues
- **Type check** — `npx tsc --noEmit` in affected packages

### Test thoroughly
- **Happy path** — does the feature work as expected?
- **Edge cases** — empty arrays, null values, permission boundaries, concurrent requests
- **Integration** — does it work with the rest of the system? (esp. auth, i18n, error handling)
- **No regressions** — did it break anything else?

For significant changes, run the full test suite:
```bash
npm test                  # workspace packages
npm run test:docker       # backend (needs Docker)
npm run test:mobile       # mobile
```

## Code Quality Standards

### TypeScript
- **No `any`** — types must be explicit or inferred from context
- **Strict mode enabled** — the tsconfig is strict; AI should follow it
- **Named exports** — especially in `packages/api-client` (see CLAUDE.md)

### Style & conventions
- **Follow existing patterns** — if a codebase pattern conflicts with what AI suggests, stick with the pattern
- **No unnecessary comments** — default to no comments; only add one when the WHY is non-obvious
- **Clear naming** — functions/variables should be self-documenting
- **No premature abstraction** — write what's needed now, not for hypothetical future use

### Testing
- **Always include tests** — new logic must have coverage
- **Use shared fixtures** — avoid duplicating test setup
- **Test one thing per test** — clarity over coverage numbers
- **Don't mock inappropriately** — integration tests should hit real databases/APIs where safe

### i18n
- **No hardcoded UI strings** — add keys to `en.json`, then `nl.json`
- **Structured keys** — use dot notation (`errors.unauthorized`, `labels.groupName`)
- **Both languages** — every new string needs both English and Dutch

### Security
- **Validate at boundaries** — user input, external APIs, files
- **Don't leak details** — no `err.message` to clients; use translated error codes
- **Check permissions** — every mutation needs auth/authorization logic
- **Review the data model** — understand cascades, foreign keys, what gets deleted

## Common Pitfalls

### Over-abstraction
> "I made a helper function for this pattern"

❌ Three similar lines don't need a helper yet. Keep it simple.

✅ If you're writing the same thing a fourth time, then abstract.

### Missing error handling
> "This API call should always succeed"

❌ Assume failures will happen (network, auth, data validation).

✅ Return meaningful errors; propagate to the global handler, or handle explicitly.

### Forgetting the mobile side
> "I updated the web route"

❌ The mobile app might also call it; check before changing response shapes.

✅ If it's a public API endpoint, coordinate changes and test on mobile.

### Skipping documentation
> "The code is self-documenting"

❌ User-facing features need docs; breaking API changes need release notes.

✅ Check the CLAUDE.md "## Documentation" table; update the relevant files.

### Committing generated code as-is
> "AI wrote it, so it must be good"

❌ Every line of code is your responsibility.

✅ Understand what you're committing; modify or reject as needed.

## Commit Messages

- **Written by you** — describe why you made the change, not what the code does
- **Follow conventions** — `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`
- **Mark breaking changes** — `feat!:` or `BREAKING CHANGE:` footer
- **Reference issues** — `fixes #123` when resolving a specific issue
- **Be honest** — if you're not 100% sure about something, say so in the PR description

Example:
```
feat: add collaborative ALBUM post type

Members can create album posts and add photos via interactions,
with author-only close. Cross-posting supported. Fixes #45.
```

## PR Review

When requesting review:
1. **Describe the change** — what, why, how
2. **Call out AI-generated sections** — mark any substantial AI involvement
3. **Explain trade-offs** — why this approach over alternatives
4. **List testing steps** — how did you verify it works?

Example PR description:
```
## Summary
Adds a `GET /api/posts/on-this-day` endpoint to surface posts from prior years on today's date.

AI generated the initial route scaffolding and test structure; I reviewed for correctness against the permission model and extended edge-case coverage.

## Testing
- [x] Posts from different years show on the correct anniversary date
- [x] Non-member posts are filtered out
- [x] Pagination works correctly
- [x] `npm run test:docker` passes
```

## Tools & Workflows

### Claude Code (CLI & IDE extensions)
- Use `/code-review` for inline feedback on pending changes
- Use `/help` for documentation on Claude Code features
- Use `/graphify` to understand codebase structure
- Use `/verify` to test changes in a real browser

### Chat interfaces
- Provide file context via copy/paste or "attach file"
- Reference line numbers: `file.ts:42` is clear and clickable
- Ask follow-up questions to clarify if something seems off

### Best practices
- **One task at a time** — breaking work into focused PRs is easier to review
- **Use workspaces** — when making parallel changes to related packages
- **Commit early** — save work frequently; easier to recover from mistakes
- **Ask for help** — if AI generates something you don't understand, ask for an explanation

## When to Escalate

Ask a human reviewer before merging if:
- You're modifying auth, permissions, or encryption
- You're changing the data model or adding migrations
- The change touches multiple packages or layers
- You're not 100% confident in the correctness
- The diff is large (>500 lines) or complex

## Red Flags

If you see these in AI-generated code, investigate before committing:

- **Missing error handling** — catch/throw without explanation
- **Hardcoded values** — strings, URLs, IDs that should be configurable
- **No tests** — generated logic without coverage
- **Confusing naming** — variables like `x`, `temp`, `data`
- **Copy-paste code** — similar functions instead of reuse
- **Outdated patterns** — uses deprecated libraries or old conventions
- **Performance concerns** — N+1 queries, unnecessary loops, large arrays in memory

## Questions to Ask Yourself

Before hitting "commit":

1. **Do I understand this code?** ✅ Yes / ❌ No
2. **Does it follow the project's patterns?** ✅ Yes / ❌ No
3. **Have I tested it?** ✅ Yes / ❌ No
4. **Would I be comfortable supporting this in production?** ✅ Yes / ❌ No
5. **Is it documented or self-documenting?** ✅ Yes / ❌ No

If any are ❌, rework it or ask for help.

## Learning & Growth

- **Read the generated code** — understand the patterns AI uses
- **Compare versions** — see how AI's approach differs from your usual style
- **Ask why** — when AI suggests something, understand the reasoning
- **Challenge it** — if something seems off, it probably is
- **Contribute back** — share useful patterns you discover with the team

## Contributing with AI

If you're contributing to Famlin as an open-source developer, here's how to work with AI tools responsibly:

### Before you start
1. **Read CONTRIBUTING.md** — understand the contribution process and guidelines
2. **Check open issues** — is this something the maintainer wants help with?
3. **Discuss first** — for large features or API changes, open an issue to get feedback before investing time
4. **Follow this guide** — especially the commit message and code quality sections

### When opening a PR
- **Be transparent** — disclose if AI generated a significant portion of the work
- **Explain your changes** — don't rely on the code to speak for itself
- **Show you understand it** — answer questions about the implementation
- **Include testing** — verify locally before submitting
- **Link to related issues** — `fixes #123` in the description

Example PR:
```
## Summary
Adds support for custom post types via a plugin registry system.

This change was developed with AI assistance; I've reviewed all generated code
and added comprehensive tests. The registry pattern is modeled on the existing
`MediaProvider` and `NotificationChannel` systems.

## Testing
- [x] Existing tests still pass
- [x] New post type can be created and retrieved
- [x] Cross-posting works with custom types
- [x] Permissions enforced correctly

Fixes #89
```

### Code review process
- **Respond to feedback** — maintainers may ask for clarification or changes
- **Don't defend the AI** — if code needs to change, change it
- **Be open to suggestions** — maintainers know the codebase better than AI does
- **Iterate** — good PRs often take multiple rounds of review

### After merging
- Monitor for issues in production (CI, automated tests, user feedback)
- Be available to fix bugs or regressions you introduced
- Help document the feature if needed

---

**Responsible AI use makes better code.** The goal is leverage AI to be more productive, not to abdicate responsibility. Every line of code is yours.
