You are initializing the development workflow for a software project — new, already under way, or already partly initialized (Step 1 tells you which). Follow this process step by step, asking questions and waiting for my explicit confirmation before moving to the next step. Do not skip ahead.

## GLOBAL CONSTRAINTS (apply to every step)

**Tool agnosticism**
- Stay fully agnostic to the specific AI CLI tool in use (Claude Code, Aider, Cursor CLI, Codex CLI, etc.). Never assume tool-specific mechanisms exist (e.g. "sub-agents", "skills folders", "MCP as a native concept") unless I confirm the tool and its actual capabilities.
- Never create tool-specific **context** files (CLAUDE.md, .claude/, .cursorrules, .aider.conf, or equivalents). Project knowledge must not be locked to one tool.
- **One exception: runtime wiring.** Connecting MCP servers, hooks, or CLI wrappers necessarily uses the chosen tool's own config format (`.mcp.json` or equivalent), and that is allowed — it is plumbing, not project context. The condition is that the wiring is also described in portable form in `docs/workflow.md`: which server or tool, what it is for, and what it needs to run (endpoints, env vars, required scopes), so the same setup can be reproduced under a different CLI. Secrets stay out of it and go through `.env`.
- The canonical, portable home for project context is **AGENTS.md** at the repo root — the cross-tool convention read by most AI CLIs. All shared project context goes there or in plain `docs/` files, never in a vendor-specific location.

**Question cadence**
- Default: ask **one question at a time** and confirm each answer before the next.
- Single exception: STEP 0 is an environment check, not elicitation — there you may ask its questions as one grouped block.

**Task tracking**
- Do NOT create any internal or custom kanban board, backlog file, or task-tracking substitute. Tracking relies exclusively on an **external system reachable via MCP** (Linear, GitHub Projects, Jira, Trello, …). If none is available, ask which one to configure — never build a replacement.

**Context & token discipline**
- Query the code index for structure and symbols instead of reading whole files; never dump entire files into context when a targeted query suffices.
- Route shell/tool output through the token-optimizing proxy when available.

**Decision hygiene**
- Every decision I defer ("decide later") must be recorded as an open entry in `docs/decisions/` (lightweight ADR: context, options, status, date). Nothing deferred may silently disappear.
- Never invent answers on my behalf. If information is missing, ask.

**Safety**
- Never commit credentials, tokens, or secrets; plan for `.env.example` + gitignored `.env`.
- Ask which license applies before creating any LICENSE file.

**Resumability**
- Maintain `docs/project-init.md` recording which step is complete, what was confirmed, and what is still open, so this process can be resumed in a fresh session.

---

## STEP 0 — Environment & tooling baseline
(Ask as one grouped block; confirm before proceeding.)
- Which AI CLI tool(s) will be used for this project, or is it tool-agnostic/undecided?
- Is `rtk` (or an equivalent token-optimizing CLI proxy) installed and available? Should we plan for it?
- Is a code-indexing tool (codegraph, tgrep, or equivalent semantic/structural code search) available? Should we plan for it?
- Which **external** task-tracking system, reachable via MCP, will hold the backlog (Linear, GitHub Projects, Jira, …)?
- **Track**: full process, or **fast lane** (see below)? Recommend fast lane if this looks like a single-developer project, a prototype/spike, a small tool or script, or fewer than roughly 5 features; recommend the full process for multi-person, long-lived, or integration-heavy projects. I decide — you only advise.

Record any "decide later" answers in `docs/decisions/`. Then confirm with me before Step 1.

## FAST LANE (only if I selected it in Step 0)
A compressed path for small projects. It changes the *ceremony*, never the *guarantees*.

**Still mandatory, unchanged:** tool agnosticism and the AGENTS.md rule; external MCP tracker only (no internal board); no invented answers; secrets hygiene; the Step 5 manifest and single final go-ahead.

**What collapses:**
- **Steps 2 and 3 merge into one round.** Ask a single batch of at most 6 questions covering both product and technical sides: problem + who it is for; core features for v1; explicit non-goals; stack (or "you recommend"); storage and deployment target; testing/CI expectations; Git & delivery conventions (integration branch, branch naming, commit convention, PR required or not) — this last one is required even on the fast lane, because it feeds the baseline skills in 4b. Then produce a combined draft covering both `prd.md` and `docs/architecture.md` and ask for **one** confirmation instead of two.
- **Roles reduce to three**: coder, reviewer, and scrum-master (absorbing analyst, architect, and dev-ops responsibilities). Document them in a single `docs/roles.md` rather than one file per role.
- **Skills start at the baseline only, and the loop stays live.** The mandatory baseline skills in 4b are still created (minus the two foldable ones); beyond those, `docs/skills/INDEX.md` starts otherwise empty, and the write rule in 4c applies from the very first task so the project accumulates skills as it goes.
- **Decisions and ADRs** collapse into a single running `docs/decisions.md` instead of a directory.
- **`docs/project-init.md`** is optional — propose it only if I expect the setup to span multiple sessions.

**Escalation:** if during the merged round the answers reveal multiple integrations, more than one contributor, or non-trivial architectural contention, say so and ask whether to switch back to the full process before continuing.

## STEP 1 — Detect the situation (greenfield, brownfield, or already initialized)
Inspect before asking. Determine which of three cases applies, tell me which one you concluded and on what evidence, and confirm with me before proceeding.

**1a. Already initialized** — `AGENTS.md`, `docs/roles*`, or `docs/skills/` already exist.
Do **not** overwrite anything. Read what is there, report what already exists and what is missing or stale, and propose an **incremental update as a diff** — additions and amendments only, each confirmed individually. Existing skill files are accumulated project knowledge: never regenerate or replace them wholesale, and preserve their `History` sections. This rule holds even if the existing structure differs from what this prompt would have produced; propose migrating it, never silently replacing it.

**1b. Brownfield (code exists, workflow does not)** — infer instead of asking, then have me confirm your inferences. Cheaper and more accurate than interrogating me about facts the repo already states:
- **Stack** — from manifests and lockfiles (package.json, pyproject.toml, go.mod, Cargo.toml, …), plus config for test runners, linters, and CI.
- **Structure** — from the code index (never by reading whole files): entry points, modules, layering, integration points.
- **Git & delivery conventions** — from the repository itself: default and long-lived branches, branch naming patterns and commit message style from `git log`, merge strategy from the history shape, required checks from CI config and branch protection.
- **Product intent** — from README, existing docs, and issue/PR titles.
Present the inferences as a list with, for each, its evidence and your confidence. Then ask me **only** about what could not be inferred or where evidence conflicts. Anything you could not establish is asked in Steps 2–3 as usual; nothing is invented, and a low-confidence inference is asked, not assumed.

**1c. Greenfield (empty or near-empty repo)** — proceed with the full elicitation in Steps 2–3.

In all cases, check whether `prd.md` (or `PRD.md`) exists; if it does, read it and summarize your understanding back to me for confirmation, and treat Steps 2–3 as validating and filling gaps in it rather than rewriting it.

## STEP 2 — Product clarification (one question at a time, confirm each)
On brownfield, skip whatever Step 1b already established and confirmed; ask only about the gaps. Ask until the project is clear, covering at least:
- What problem does this solve, and for whom?
- Core features / user stories for a first version?
- What is explicitly out of scope (non-goals)?
- Existing systems, APIs, or constraints it must integrate with?
- What does success look like?

For acceptance criteria: derive them **per feature**, each independently testable and observable (given/when/then or an equivalent checkable statement) — not one generic block for the whole product. Include measurable targets where they exist.

Summarize into a draft `prd.md` and ask me to confirm before continuing.

## STEP 3 — Technical clarification (one question at a time, confirm each)
On brownfield, most of this was inferred in Step 1b — present those inferences for confirmation instead of re-asking, and question only what is missing, ambiguous, or about to change. Once the product side is confirmed, ask about:
- Preferred language(s) and framework(s), or should you recommend one?
- Architecture style (monolith, microservices, serverless, …)?
- Database / storage requirements?
- Deployment target (cloud, on-prem, local)?
- Testing and CI/CD expectations?
- **Git & delivery conventions** — these drive the baseline skills in Step 4b, so ask them explicitly: which branching model and what is the integration branch (`develop`, `main`, trunk)? Branch naming convention (e.g. `feature/<ticket-id>-<slug>`, `fix/…`)? Commit message convention (Conventional Commits or other)? Is a PR always required, who opens it, and who merges? Merge strategy (squash, merge commit, rebase)? Any required checks before merge?

Summarize the technical decisions (destined for `docs/architecture.md`, with any contested choice as an ADR in `docs/decisions/`) and ask me to confirm before continuing.

## STEP 4 — Roles, skills, escalation, integrations, and the workflow itself
Propose the following, and ask for my explicit confirmation on each item before creating anything.

**4a. Process roles** — tool-agnostic role descriptions in plain markdown (`docs/roles/<role>.md`), not vendor agent configs: analyst, architect, scrum-master, coder, reviewer, dev-ops. Each role doc states its responsibilities, its inputs/outputs, and which skills it owns.

**4b. Baseline skills (pre-seeded, mandatory)** — some behaviour must be standardized from day one, not learned by accident. Propose creating these skill files immediately, filled in with the Git and delivery conventions confirmed in Step 3, using the same schema as 4c. They are the default operating procedure for their role; deviating from one requires saying so explicitly.

- `analyst/refine-requirements` — **Trigger**: a new feature, change request, or an unclear area of `prd.md` enters the pipeline. **Procedure**: restate the requirement in terms of the problem it solves and for whom; derive acceptance criteria that are independently testable and observable; identify affected areas using the code index; list open questions and contradictions with `prd.md` explicitly. **A blocking ambiguity is a question to me, never an assumption** — stop and ask.
- `architect/technical-decisions` — **Trigger**: refined requirements imply a choice not already settled in `docs/architecture.md` or the ADRs. **Procedure**: make the decisions that must exist *before* work can be decomposed (data model, API/interface contracts, integration points, migration impact); record each as an ADR with context, options considered, and consequences; flag anything that invalidates an existing decision. Decisions that only emerge during implementation are not forced here — but nothing gets decomposed on top of an unmade one.
- `analyst/decompose-to-backlog` — **Trigger**: requirements are refined and the architectural decisions they depend on exist. **Procedure**: break the work into tasks **created directly in the external tracker** (never in a local file); each task carries its acceptance criteria, priority, a size estimate, and its dependencies on other tasks; sequence them so dependencies are respected; keep tasks small enough to complete in one working session, splitting anything larger. This skill is the **entry point of the whole workflow** — every task the coder later picks up originates here.

- `coder/start-of-work` — **Trigger**: a task moves to "in progress". **Procedure**: confirm the task id and acceptance criteria from the external tracker; ensure a clean working tree (no uncommitted leftovers from a previous task); sync the integration branch (fetch + fast-forward `develop`/`main` as confirmed); create the branch using the agreed naming convention including the ticket id; consult `docs/skills/INDEX.md` for skills relevant to the task area; confirm the tracker item is actually in the working state.
- `coder/end-of-work` — **Trigger**: implementation is complete and tests pass locally. **Procedure**: run the project's test and lint commands; review your own diff before staging; stage deliberately and verify nothing secret or unrelated is included; commit using the agreed message convention referencing the ticket id; push the branch; open a PR against the integration branch, with a body linking the tracker item, listing what changed, and carrying a **Verification** section (see below); move the tracker item to the review state; hand off to the reviewer.
- `reviewer/review-and-merge` — **Trigger**: a PR is opened or re-requested. **Procedure**: verify the change against the PR's stated acceptance criteria; **reject a PR whose Verification section is missing, vague, or not reproducible** — that is a review finding like any other; check required checks are green; review for correctness, security, and consistency with `prd.md` and `docs/architecture.md`; request changes or approve; merge with the agreed strategy; delete the branch; then apply the skill write rule from 4c.
- `scrum-master/state-sync` — **Trigger**: any status change in the external tracker. **Procedure**: verify the transition is legal under the status model in 4e, that its Definition of Done is met, and that the work is reflected where it should be; flag stalled or skipped transitions.
- `dev-ops/release` — **Trigger**: changes reach the integration branch and a release is intended. **Procedure**: as confirmed in Step 3 (versioning, tagging, migrations, deploy, rollback). Propose a placeholder to be filled in if release details are still undecided.

Ask me to confirm, adjust, or drop each baseline skill. On the fast lane, `dev-ops/release` and `scrum-master/state-sync` may be folded into the other files, and the three analysis skills may collapse into a single `decompose-to-backlog`; but `coder/start-of-work`, `coder/end-of-work`, `reviewer/review-and-merge` and an entry point into the backlog always remain.


**Verification evidence (required in every PR)** — "done" must state *how it was verified*, not assert that it works. Every PR body carries a `Verification` section listing the exact commands run (tests, lint, type-check, build, manual steps) with their outcome, and mapping each acceptance criterion to what demonstrates it. Unverified criteria are listed as such rather than omitted. A change is never done because it compiles, because types check, or because an ad-hoc manual test happened to work.

**4b-bis. Stop conditions and escalation (applies to every role)** — autonomy without a brake burns tokens and causes damage. State these once, in `AGENTS.md`, as binding on all roles: **stop and ask me rather than guess** when any of these holds.
- Acceptance criteria are ambiguous, contradictory, or conflict with `prd.md` or an existing ADR.
- The task requires a decision not covered by `docs/architecture.md` or the ADRs — escalate to the architect role, or to me if it changes product scope.
- Tests or checks still fail after a small number of genuine attempts (agree the number with me) — report what was tried and what the failure actually is, instead of trying variations indefinitely.
- The work needs an irreversible or destructive action: force push, history rewrite, deleting branches or data, data migrations, touching secrets, production or infrastructure changes.
- Scope is growing beyond the ticket — split it back to the backlog rather than quietly expanding the change.
- A precondition of the workflow is missing: no tracker item, no acceptance criteria, a dirty working tree, or a stale skill whose preconditions no longer hold.

When stopping, state what was attempted, what blocks it, and the options as you see them — a bare "I'm blocked" is not an escalation.

**4c. Self-improving skill system** — this is a closed loop, not an aspiration. Propose:
- **Storage**: `docs/skills/<role>/<skill>.md`, portable markdown, no tool-specific format.
- **Schema** — every skill file has exactly these sections:
  - `Trigger` — the situation in which this skill applies
  - `Procedure` — the concrete steps
  - `Pitfalls` — known failure modes observed in practice
  - `Example` — a real instance from this project
  - `History` — date + what changed and why
- **Index**: `docs/skills/INDEX.md`, one line per skill (role, name, trigger), kept current — skills that are not indexed do not get loaded.
- **Read rule**: before starting a task, a role consults the INDEX entries for its own area and loads the matching skills.
- **Staleness check**: a skill describes a moving codebase. Before applying one, verify that the files, commands, flags, or conventions it names still exist. If they do not, the skill is stale — correct it (and log the correction in `History`) before relying on it. Never follow a skill whose preconditions no longer hold.
- **Write rule (the trigger that closes the loop)**: at the end of every task or PR, the reviewer — or the scrum-master if no review occurred — decides whether a reusable pattern, a repeated mistake, or a non-obvious project constraint emerged, and creates or updates the corresponding skill file plus its INDEX line. If nothing emerged, that is stated explicitly rather than skipped silently.
- **Hygiene rules** — an accumulating skill set degrades without maintenance, so these are part of the write rule, not optional tidying:
  - *No duplicates*: before creating a skill, search the INDEX for one with an overlapping trigger. If one exists, **update it** rather than adding a near-twin.
  - *Resolve contradictions*: if a new lesson contradicts an existing skill, do not leave both standing — amend the existing skill and record what changed and why in `History`.
  - *Keep them short*: a skill is an operating procedure, not an essay. If one grows past roughly a page, split it by trigger or cut what has become obvious.
  - *Deprecate explicitly*: a skill that no longer applies is marked deprecated with the reason and date, and removed from the INDEX — never deleted silently, so the reasoning survives.
  - *Promote what generalizes*: a lesson that turns out to apply to every task belongs in the role's baseline skill (4b) or in `AGENTS.md`, not as a separate skill nobody thinks to load.

**4d. Integrations** — propose based on the confirmed stack, and note that each integrates by *whatever mechanism it actually supports* (CLI wrapper, shell hook, or MCP server — do not assume MCP for all):
- the external task-tracking system from Step 0 — MCP server (this replaces any internal board);
- `rtk` or equivalent token-optimizing proxy — typically a CLI wrapper or shell hook, not an MCP server;
- a code-indexing tool (codegraph, tgrep, or equivalent) — CLI and/or MCP depending on the tool;
- any stack-specific MCP servers justified by Step 3.
Ask before configuring any of them. Writing the chosen tool's own MCP/hook config is the permitted exception to the no-tool-specific-files rule above; record each integration portably in `docs/workflow.md` at the same time, and never commit tokens or credentials — reference them via `.env`.

**4e. Workflow states & Definition of Done** — agree an explicit status model mapped onto the chosen external tracker's real statuses (e.g. draft → in progress → done, or whatever that tool uses), with a written Definition of Done per status in `docs/roles/scrum-master.md` — the DoD for the review and done states includes the verification evidence required in 4b. Status changes in the external tracker are communicated to the scrum-master role — via that tool's webhook, notification, or MCP mechanism — so the workflow stays in sync.

**4f. The workflow document** — the skill files are each role's operating instructions; nobody can read the flow as a whole from them. Propose a single `docs/workflow.md` giving the end-to-end lifecycle in one readable page, short enough to be read in under a minute:
- A **transition table**: for each step of the lifecycle — from requirement to analysis, decomposition into the backlog, implementation, review, merge, release, and the retro that feeds 4c — give the *from → to* states, who triggers it, which skill executes it, and the Definition of Done that must hold for it to be legitimate.
- A statement of what is never skipped, and what "done" is not: a change is not done because it compiles, because types check, or because an ad-hoc manual test worked — it is done when its acceptance criteria are verified and the agreed review has happened.
- A pointer to the skills for the detail, so this document stays the map and never duplicates the procedures.
`AGENTS.md` links to it as the entry point for anyone — human or agent — opening the repo for the first time. Keep it generated from the decisions already confirmed in 4a–4e: if it says something those files do not, one of the two is wrong.

## STEP 5 — Final manifest and single go-ahead
Before writing anything to disk, list **every** file you intend to create or modify, with a one-line purpose each (expected: `AGENTS.md`, `prd.md`, `docs/architecture.md`, `docs/roles/*.md`, `docs/skills/INDEX.md`, `docs/workflow.md`, `docs/decisions/*.md`, `docs/project-init.md`, `.env.example`, `.gitignore`, plus the chosen tool's MCP/hook config if any integration was confirmed — on the fast lane: `docs/roles.md` and `docs/decisions.md` as single files, and `docs/project-init.md` only if proposed). Mark each as created, modified, or left untouched, and never list an existing file as a full rewrite — existing files are amended in place. Then ask for one final explicit go-ahead.

**Do not create any file or run any command until I have confirmed each step and given the final go-ahead in Step 5.**
