## Why

Users can attach repositories to their workspace via the Dashboard, but there is no UI to remove them. The backend already supports detaching (`DELETE /api/workspaces/:id` soft-deletes by setting `status = 'detached'`), and the API client already has `deleteWorkspace()`, but no component exposes this action. Users who attach the wrong repo or want to clean up their workspace are stuck.

## What Changes

- **Project detail header**: A "Delete" button appears next to the status chip on the Project page.
- **`DeleteRepoModal`**: A new confirmation dialog that requires the user to type the repository name to confirm. For multi-repo workspaces, the modal warns that sibling repositories will also be removed. The dialog clarifies that files on disk are not affected.
- **App routing**: After a successful delete, the app navigates back to the Dashboard and refreshes the project list.

## Capabilities

### New Capabilities

- `delete-repo-modal`: Confirmation dialog with type-to-confirm pattern for deleting an attached repository/workspace.

### Modified Capabilities

- `project-detail`: The Project header gains a "Delete" button that opens the confirmation modal.
- `app-routing`: App passes the projects list and a delete handler down to the Project view; handles post-delete navigation.

## Impact

- **No backend changes.** The `DELETE /api/workspaces/:id` endpoint and `api.deleteWorkspace()` client method already exist.
- **UI only.** Three files touched: `App.tsx` (new props/callback), `Project.tsx` (button + modal trigger), and a new `DeleteRepoModal.tsx`.
- **No breaking changes.** Existing attach and project flows are unaffected.
