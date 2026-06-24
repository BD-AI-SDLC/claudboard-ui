## Context

The Bosch SDLC UI is a React SPA with a flat route model managed by state in `App.tsx` (`route`, `projectId`, etc.). The `Project` component renders a detail view for a single project. The API client at `ui/src/api/client.ts` already exposes `deleteWorkspace(id)` which calls `DELETE /api/workspaces/:id`. The backend soft-deletes (sets `status = 'detached'` on both the workspace and its child projects). No backend changes are needed.

## Goals / Non-Goals

**Goals:**

- Let users delete an attached repository from the Project detail page.
- Require explicit confirmation by typing the repo name to prevent accidental deletion.
- Warn when a multi-repo workspace has sibling projects that will also be removed.
- Navigate back to the Dashboard after successful deletion.

**Non-Goals:**

- Bulk delete from the Dashboard (one repo at a time via its detail page).
- Undo/restore UI for detached workspaces (data stays in SQLite but no UI to resurface it).
- Delete button on the Dashboard repo rows (only on the Project detail header).

## Decisions

### D1. Delete operates at workspace level

**Choice:** The delete button appears on the Project page but calls `api.deleteWorkspace(project.workspaceId)`. This detaches the entire workspace including all sibling projects.

**Why:** The backend API only supports workspace-level detach. Project-level detach would require a new endpoint and leave orphan workspaces. Workspace-level is the correct semantic — the user attached a directory, they're un-attaching that directory.

### D2. Type-to-confirm with repo name

**Choice:** The confirmation modal requires typing the exact project name (case-sensitive) to enable the "Delete" button.

**Why:** This is a destructive action (from the user's perspective). The type-to-confirm pattern is well-established (GitHub repo deletion, AWS resource deletion) and prevents accidental clicks.

### D3. Props flow from App, no extra API calls

**Choice:** App passes `projects` and an `onDeleteProject(workspaceId)` callback to the Project component. The modal filters `projects` by `workspaceId` locally to find siblings.

**Why:** App already holds the full project list and the refresh function. No extra network request needed. The callback handles the API call, navigation, and refresh in one place.

### D4. DeleteRepoModal is a standalone component

**Choice:** New file `ui/src/components/Project/DeleteRepoModal.tsx` with its own CSS, co-located with the Project component.

**Why:** Follows the existing modal pattern (`AttachRepoModal` under `Attach/`). The modal is only used from the Project page, so co-location makes sense.

## Risks

- **Multi-repo workspace surprise.** A user might not realize deleting one project removes siblings. Mitigated by the explicit warning listing all affected repos by name.
- **Stale project list.** If another tab attached repos after the list was loaded, the sibling warning might be incomplete. Acceptable: the workspace-level delete still works correctly, and the Dashboard refreshes on return.

## Component Diagram

```
App.tsx
├── projects: Project[]           (already exists)
├── refreshProjects()             (already exists)
├── handleDeleteProject(wsId)     (NEW — calls api.deleteWorkspace, refreshes, navigates)
│
└── <ProjectView>
      ├── projectId               (existing prop)
      ├── projects                (NEW prop — for sibling lookup)
      ├── onDeleteProject(wsId)   (NEW prop)
      │
      └── <DeleteRepoModal>       (NEW component)
            ├── project: Project
            ├── siblingNames: string[]
            ├── onConfirm()
            └── onCancel()
```
