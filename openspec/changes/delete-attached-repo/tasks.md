## 1. Create DeleteRepoModal component

- [x] 1.1 Create `ui/src/components/Project/DeleteRepoModal.tsx` with props: `project: Project`, `siblingNames: string[]`, `onConfirm: () => void`, `onCancel: () => void`.
- [x] 1.2 Render a modal overlay (follow the pattern from `AttachRepoModal`) with title "Delete repository?".
- [x] 1.3 Show message: "This will remove **{name}** and all its tracked data from your workspace. The files on disk are not affected."
- [x] 1.4 If `siblingNames.length > 0`, show a warning: "This workspace contains {N} other repositor{y/ies} that will also be removed: {comma-separated names}."
- [x] 1.5 Add a text input with label: `Type "{project.name}" to confirm`. Track input state, compare to `project.name` (case-sensitive).
- [x] 1.6 Render "Cancel" and "Delete" buttons. "Delete" is disabled until the input matches. Style "Delete" as a danger button (red).
- [x] 1.7 Add CSS in `DeleteRepoModal.css` — overlay backdrop, centered card, danger button style. Reuse existing modal/overlay patterns.

## 2. Wire up Project detail header

- [x] 2.1 Add `projects: Project[]` and `onDeleteProject: (workspaceId: string) => void` props to the `ProjectProps` interface in `Project.tsx`.
- [x] 2.2 Add a "Delete" button in the `project__head` section, next to the status chip. Style as a ghost danger button.
- [x] 2.3 Add state `deleteModalOpen` to Project. The "Delete" button sets it to `true`.
- [x] 2.4 Compute `siblingNames`: filter `projects` by same `workspaceId`, exclude the current project, map to `.name`.
- [x] 2.5 Render `<DeleteRepoModal>` when `deleteModalOpen` is true. On confirm, call `onDeleteProject(project.workspaceId)`. On cancel, close the modal.

## 3. Wire up App routing and data flow

- [x] 3.1 Add `handleDeleteProject` function in `App.tsx`: calls `api.deleteWorkspace(workspaceId)`, then `refreshProjects()`, then `setRoute('dashboard')`.
- [x] 3.2 Pass `projects` and `onDeleteProject={handleDeleteProject}` to the `<ProjectView>` render in `renderMain()`.

## 4. Verify

- [ ] 4.1 Start the dev server, attach a repo, navigate to its project page, click Delete, verify the modal appears.
- [ ] 4.2 Confirm the Delete button is disabled until the name is typed correctly.
- [ ] 4.3 Confirm deletion navigates back to Dashboard and the repo is gone from the list.
- [ ] 4.4 Verify that attaching a multi-repo workspace and deleting from one project shows the sibling warning.
