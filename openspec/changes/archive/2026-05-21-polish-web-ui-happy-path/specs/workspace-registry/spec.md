## ADDED Requirements

### Requirement: Filesystem directory browse endpoint

The server SHALL expose `GET /api/fs/browse` for the attach-repo modal. It returns the immediate subdirectories of an absolute path on the host filesystem, with git-repo detection per entry.

**Request:**

| Param | Required | Description |
|---|---|---|
| `path` | optional | Absolute path to list. If omitted, defaults to the server process's `homedir()`. |

**Response (200):**

```json
{
  "path": "/Users/lup1bg/Documents",
  "parent": "/Users/lup1bg",
  "entries": [
    { "name": "BoschProjects", "path": "/Users/lup1bg/Documents/BoschProjects", "isGitRepo": true },
    { "name": "Notes",         "path": "/Users/lup1bg/Documents/Notes",         "isGitRepo": false }
  ]
}
```

`parent` is `null` when `path` equals the filesystem root.

**Errors:**

- `400` — `path` was provided but is not absolute.
- `403` — path exists but is not readable by the server process (EACCES).
- `404` — path does not exist or its real-path cannot be resolved (ENOENT, ELOOP).
- `500` — any other fs failure, with a sanitised message.

#### Scenario: Default path is the server's home directory

- **WHEN** the client calls `GET /api/fs/browse` with no `path` query
- **THEN** the response's `path` field equals `os.homedir()` for the server process

#### Scenario: Lists only directories

- **WHEN** the target path contains a mix of files and directories
- **THEN** the response's `entries` array contains only directory entries; files are omitted

#### Scenario: Marks git repos

- **WHEN** an entry directory contains a `.git` child (file or directory)
- **THEN** that entry's `isGitRepo` field is `true`

#### Scenario: Hides dotfiles unless parent itself is dotted

- **WHEN** the target path does NOT have a name beginning with `.` and a child entry name begins with `.`
- **THEN** that child is omitted from the response
- **AND WHEN** the target path's basename DOES begin with `.` (e.g. `/Users/lup1bg/.config`)
- **THEN** dot-prefixed children are included

#### Scenario: Caps entries to prevent UI lockup

- **WHEN** the target path contains more than 500 subdirectories
- **THEN** the response's `entries` array contains at most 500 items (any 500-stable sort)

#### Scenario: Rejects relative paths

- **WHEN** the client calls `GET /api/fs/browse?path=../foo`
- **THEN** the response status is 400 with body `{ "error": "path must be absolute" }`

#### Scenario: Surfaces permission errors as 403

- **WHEN** the target path is real but the server process lacks read permission
- **THEN** the response status is 403 with body `{ "error": "Permission denied" }`

#### Scenario: Surfaces missing paths as 404

- **WHEN** the target path does not exist
- **THEN** the response status is 404 with body `{ "error": "Not found" }`

#### Scenario: Returns parent for navigation up

- **WHEN** the target path is `/Users/lup1bg/Documents`
- **THEN** the response's `parent` field is `/Users/lup1bg`
- **AND WHEN** the target path is the filesystem root (`/`)
- **THEN** the response's `parent` field is `null`

#### Scenario: Resolves symlinks safely

- **WHEN** the target path is a symlink chain that eventually resolves
- **THEN** the response's `path` is the canonical real-path (`fs.realpath` result), not the symlink path
- **AND WHEN** the target is a broken or looping symlink
- **THEN** the response is 404
