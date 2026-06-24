## Context

The sidebar today is two visually-equivalent sections stacked vertically: a Workflow section (real, routed) on top, and a Project section (four permanently-disabled "Coming soon" placeholders) on the bottom. The placeholders predate any concrete plan for the surfaces they label. They are dead scaffolding in the same sense as the recently-removed Kickoff "Recent in this repo" panel and the recently-removed Clone-from-Git-URL flow.

The decision in this change is narrow: delete the placeholder section cleanly, decline to replace it with anything, and leave the surrounding sidebar architecture intact. The motivation, scoping, and out-of-scope items live in `proposal.md`; this document captures the design choices that aren't already obvious from "delete dead UI."

## Goals / Non-Goals

**Goals:**

- The sidebar SHALL no longer render the "Project" section header or any of its four "Coming soon" items.
- The deletion SHALL be surgical: only the lines exclusive to the placeholder section are removed. Imports, CSS, the Workflow section, the project switcher, the theme toggle, and the sidebar's flex/scroll layout SHALL remain visually and behaviourally unchanged.
- The change SHALL be reversible by a single revert commit (one component file plus one new test file; no migrations, no protocol changes, no API changes, no CSS deletions).
- A regression test SHALL guard against the items being silently re-introduced (e.g. via cherry-pick from an old branch, or via a future developer reinstating the `LOWER_ITEMS` constant out of habit).

**Non-Goals:**

- Designing or building any of the four removed surfaces (Run history, Skills, Rules, Settings). When real, each lands through its own proposal with its own UX questions answered explicitly.
- Restructuring `Sidebar.tsx` beyond the deletion (no extract-component, no prop reshuffle, no rename of `LOWER_ITEMS`'s sibling structures).
- Re-syncing the `ui/designs/*.html` mockups. They are frozen design references and not part of the build.
- Renaming the `Project · health` Workflow entry to disambiguate it now that the lower "Project" section is gone. The label is still meaningful in context, and renaming it adds scope without proportionate benefit.
- Dropping the surviving "Workflow" section label now that only one section remains. See D3.

## Decisions

### D1: Delete, do not replace

The placeholders communicate intent ("we're building toward these") but deliver nothing. After enough sessions, the intent reads as either abandonment or theatre. Both are worse for trust than the items not existing at all. Removal eliminates the asymmetry between sidebar entries that route and sidebar entries that don't.

A real Settings / Rules / Skills / Run-history surface, when built, is additive against this clean baseline — and benefits from deciding its UX questions explicitly (where in the IA, what the empty state is, what the entry-point label says) rather than inheriting them from a placeholder shape that was never reasoned about. The placeholder labels themselves were never spec'd and are not load-bearing on any naming convention.

### D2: No spec delta

The live `openspec/specs/web-ui/spec.md` sidebar section enumerates the Workflow nav routes, the project switcher, and the theme toggle. It never described the placeholder section. Adding a `specs/web-ui/spec.md` delta with a REMOVED requirement would be inventing a prior requirement to remove. The correct OpenSpec posture for "delete UI that was never spec'd" is no spec delta, and the proposal documents the deliberate absence so a future reviewer doesn't read it as oversight. This mirrors `remove-kickoff-recent-runs` and `remove-clone-from-git-url`.

### D3: Keep the "Workflow" section label

After deletion, the sidebar has exactly one section. A reader might reasonably ask: why label the only section? Two reasons to keep it:

- **Strict subtraction.** The proposal's whole posture is "remove what's dead, change nothing else." Dropping a still-functional label because it's now redundant is a positive design change that belongs in its own (very small) proposal, not bundled into a removal.
- **Future-proofing.** If a real Settings or Run-history surface lands next quarter, it likely wants its own section — and the section label needs to come back. Keeping it now means the next proposal doesn't have to re-add CSS that we just removed.

If the team later decides that a one-section sidebar should drop its label, the change is mechanical (one JSX deletion) and can ride along with whatever proposal adds the second section.

### D4: Keep `.sidebar__item--disabled` in CSS

`.sidebar__item--disabled` (`Sidebar.css:121-125`) was shared by the lower section's "Coming soon" items AND by Workflow items in their disabled state (e.g. `Project · health` when no repo is attached). After this change, only the Workflow disabled-state usage remains — but the class is still referenced, still serves a real purpose, and removing it would break those states. The CSS file is untouched as a result. This is documented here because a reviewer doing a casual scan might wonder why a "remove dead disabled placeholders" change leaves a `--disabled` modifier in CSS untouched.

### D5: Test by negative assertion, not snapshot

The test added in this change asserts the *absence* of the four removed labels and the absence of a `.sidebar__section-label` with text "Project". It does not snapshot the sidebar's DOM. Snapshots over-couple the test to incidental rendering details (icon-svg paths, class names, attribute ordering) and produce false positives on unrelated UI work. The negative assertions are narrow and stable: a future developer adds a real "Run history" route, the test fails, the developer either renames the new route to something else or deletes the test alongside the new addition — both are conscious choices. That's the failure mode we want.

### D6: One JSX block, deleted whole

`Sidebar.tsx:194-209` is the lower section: a single `<div className="sidebar__section">` containing the `.sidebar__section-label` and the `{LOWER_ITEMS.map(...)}` body. Delete the whole `<div>` and its children as one chunk. Do not refactor toward a `renderLowerItems()` helper that returns null — that's the same dead-code anti-pattern in a different shape. The deletion ends just before the closing `</nav>` tag.

### D7: Manual verification scope

Manual verification (per tasks.md §4.3) confirms:

- The sidebar renders one section ("Workflow"), no second section header, no greyed-out items below it.
- The theme toggle still sits at the bottom and is unaffected.
- The project switcher dropdown at the top is unaffected.
- The Workflow disabled-state styling (e.g. greying-out of `Active run` when none is active) still works — this confirms `.sidebar__item--disabled` survived correctly per D4.
- The sidebar's overflow-scroll behaviour (`.sidebar__nav { overflow-y: auto }`) is unchanged — with less content, scrolling is rarely triggered on the Workflow section alone, but the rule still applies if a future section is added.

The single screenshot for the PR description SHOULD be a side-by-side before/after (or a single after, with a one-line PR-body note that the deleted section had four greyed items below the Workflow section).
