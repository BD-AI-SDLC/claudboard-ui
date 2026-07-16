# Contributing

This project runs an **AI-native contribution process** — an "AI software
factory." Your core job as a contributor is to author and review a single intent
artifact: an **OpenSpec change**. The labor of implementation is done by AI.

Contribution flows through **two pull requests**:

```
PR #1  OpenSpec change  ─▶  TEAM CHANGE REVIEW  ─▶  approve ─┐
        (intent artifact)                                    │  hand-off
                                                             ▼
PR #2  implementation   ─▶  code review        ─▶  merge   (the factory)
        (code, tests, docs)
```

> **Scope of this document.** This guide defines **PR #1 — the OpenSpec change
> PR** and everything that happens on it. **PR #2 (the implementation and its
> code review) is out of scope here** and is governed by a separate process. The
> only thing this guide says about PR #2 is *when it is triggered*.

---

## Roles

| Role | Responsibility |
|------|----------------|
| **Contributor** | Authors the OpenSpec change and opens PR #1. |
| **Reviewing team** | Reviews the full change on PR #1 and approves the intent. |
| **Factory (AI)** | Triggered by approval of PR #1; produces the implementation as PR #2 (out of scope here). |

---

## 1. Author a change (through AI)

You author a change by **describing what you want to an AI authoring agent** — not
by running OpenSpec commands yourself. The AI is your interface to OpenSpec: it
creates the change, generates the artifacts, and refines them as you steer in
natural language.

```text
You:  "I want to add rate limiting to the public API."
AI:   creates the change on the `ai-factory` schema, drafts the artifacts,
      and works with you to refine them.
```

Under the hood the AI uses the OpenSpec CLI with the **`ai-factory`** schema (the
repository default); your job is to steer and review what it produces. A change is
**apply-ready** only when `tasks` and `migration` both exist.

| Artifact | What it captures |
|----------|------------------|
| `proposal.md` | Why + what. States the compatibility class and semver bump. |
| `specs/<capability>/spec.md` | Delta requirements (`ADDED`/`MODIFIED`/`REMOVED`/`RENAMED`) with Given/When/Then scenarios. |
| `design.md` | How. Shows conformance to existing architecture patterns; justifies deviations. |
| `tasks.md` | Implementation checklist, including one verification task per declared constraint. |
| `migration.md` | Outbound migration plan for downstream consumers (or "N/A — additive only"). |

The AI authors against the project `context` and per-artifact `rules` in
`openspec/config.yaml` — these are injected into the OpenSpec instructions. Your
responsibility is that the resulting artifacts are correct.

**PR #1 contains only the change artifacts.** It MUST NOT contain application
code; a change PR that touches code outside `openspec/changes/<name>/` is
rejected in review.

---

## 2. The guardrails

Every change is evaluated against three guardrails **on the artifact**, before
any code exists.

### Backward compatibility

Compatibility is derived mechanically from your delta headers:

```
ADDED only        →  minor   (backward compatible)
safe MODIFIED     →  minor / patch
REMOVED           ┐
RENAMED           ├─▶ major  (BREAKING)
breaking MODIFIED ┘
```

The declared public surfaces (HTTP/API, DB schema, CLI, config keys, events) are
listed in [`openspec/specs/compatibility-contract/spec.md`](openspec/specs/compatibility-contract/spec.md).
A change that affects a declared surface is subject to the gate below.

**The gate is fail-closed:** a `major` change **cannot be approved** until it
carries a non-trivial migration plan. Declaring explicit **MAJOR-version intent**
legitimizes a break but **never waives** the migration requirement.

### Migration (outbound)

Migration is **outbound** — it tells *downstream consumers* how to move from the
previous version to the new one. Every change carries a `migration.md`:

- **Additive changes** may state `N/A — additive only`.
- **Breaking (`major`) changes** MUST provide an AI-executable, idempotent plan
  with: compatibility class + affected surfaces, ordered **forward steps**, a
  **dry-run / validation** step, ordered **rollback steps**, and a **deprecation
  window**.

### Architecture patterns

Patterns live in the living catalog
[`openspec/specs/architecture-patterns/spec.md`](openspec/specs/architecture-patterns/spec.md).

- **Reference before invent:** reference existing patterns before introducing a
  new one. Introducing a new pattern is an explicit `ADDED` requirement in the
  catalog, reviewed like any other change.
- **Self-governing:** removing or renaming a pattern is a breaking change and
  triggers the compatibility + migration machinery.

---

## 3. Change review (PR #1)

### 3a. AI pre-review (runs first)

When PR #1 is opened or updated, an automated **AI pre-review** analyzes the
change and posts its findings to the PR so reviewers walk in with the machine's
analysis in hand.

**Inputs:** the full change (proposal, specs, design, tasks, migration) plus the
`compatibility-contract` and `architecture-patterns` catalogs.

**Outputs (posted as a PR comment):**
- Derived **compatibility class** and **semver bump**, and whether they match the
  author's declaration in `proposal.md`.
- **Migration status:** present / adequate / missing, and whether the fail-closed
  gate is satisfied.
- **Pattern conflicts:** unreferenced or violated patterns, and any newly
  introduced pattern.
- **Underspecified requirements:** requirements without testable scenarios or
  without a stated completion check.

> The delivery mechanism (CI action vs. bot) is deferred; the requirement that a
> pre-review runs and posts these findings on every PR #1 stands regardless.

### 3b. Team review

The team reviews the **entire change** — all artifacts — with the pre-review
findings available as context.

### 3c. Request-changes loop

If a reviewer requests changes, the contributor (or the AI) revises the affected
artifacts, and the **AI pre-review re-runs** before the change returns for review.

### 3d. Approval

A change PR is approvable **only when all guardrails pass**:

- [ ] Compatibility gate satisfied (breaking → adequate migration present)
- [ ] Migration artifact present and adequate for the compatibility class
- [ ] Applicable patterns referenced and conformed to (deviations justified)
- [ ] Every requirement has testable scenarios and a stated completion check

---

## 4. Hand-off to the factory

**Approval of PR #1 is the single trigger** that hands off to the factory to
produce the implementation (PR #2). The factory does not begin before approval.

Everything after this point — the implementation, its code review, code gates,
and post-implementation spec sync + archive — is **out of scope for this guide**.

---

## Author checklist (before opening PR #1)

- [ ] Change authored via the AI on the `ai-factory` schema
- [ ] `proposal.md` states the compatibility class and semver bump
- [ ] Specs use Given/When/Then; each requirement states its completion check
- [ ] `design.md` shows pattern conformance and justifies any deviation
- [ ] `tasks.md` includes a verification task per constraint
- [ ] `migration.md` present (full plan if breaking, else `N/A — additive only`)
- [ ] Change passes `openspec validate` (the AI runs this)
- [ ] PR #1 contains only the change artifacts (no application code)

---

## This process is evolving

The process hardens over time: whenever a human catches something in review that
a check could catch, that catch becomes a new rule or catalog entry, and the
review surface shrinks. Two decisions are still being finalized:

- **Hand-off trigger:** currently on **approval** of PR #1 — whether to move it to
  **merge** of PR #1 is under review.
- **Pattern seed:** the concrete architectural patterns are stack-dependent and
  will be filled in once the application tech stack is chosen.
