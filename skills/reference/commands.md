# Relay CLI — command reference (L3)

> The full command surface, taught. Load this only when a task falls outside the three happy paths in `SKILL.md`.
>
> **L3** is the reference layer of progressive disclosure: never loaded at startup, read only on demand.
>
> This file is **hand-maintained prose, not generated**. `relay tools schema` is the machine-readable source of truth for *what exists*; this file is where the *why*, the *rules*, and the *relationships between flags* live — none of which a schema can express.

## Global flags (valid on every command)

| Flag | Effect |
|------|--------|
| `--json` | structured result on stdout — use it whenever a script or another agent will parse the output |
| `--debug` | diagnostics on stderr |
| `--no-color` | strip ANSI color and style codes |
| `--profile <name>` | run this one command against a named profile instead of the active one |

### How to read the tables

Each row answers one question: *what do I type for this command?*

- **Command** is the minimal callable form — everything **required** is already in it.
- **Flags** lists only the **optional** flags that broaden that command.
- **Rules and traps** (mutual exclusivity, path grammar, lifecycle, who must do what) live in the prose *beneath* each table. They are deliberately not repeated in rows: a table cell is the wrong shape for a conditional.

### Non-interactive use

Anything that prompts needs an explicit flag when there is no terminal — and an agent never has one:

- `bundle delete`, `folder delete` and `ws delete` ask for confirmation → pass `--yes`.
- `ws message set` opens an editor → pass `--file <path>` or `--stdin`.
- `relay login` and `relay signup` read the password — and the device name — from the terminal. These **cannot** be made non-interactive by an agent; hand them to the human. See `error-recovery.md`.

## Contents

- [Config & profiles](#config--profiles) — where the service URL and session live
- [Auth & device](#auth--device)
- [Workspace (`ws`)](#workspace-ws)
- [Folder](#folder)
- [Bundle](#bundle)
- [History / storage / export](#history--storage--export)
- [Errors and exit codes](#errors-and-exit-codes)
- [Discovery](#discovery)

## Config & profiles

A **profile** is a named bundle of *service URL + session + default workspace*. Exactly one profile is active at a time; the global `--profile <name>` overrides it for a single command.

**The service URL is not baked into the CLI.** A fresh install has none, and *every* authenticated command fails until one is set. This is the most common first-run failure — see `error-recovery.md`.

```bash
relay config set url https://relay.example.com   # once, before the first login
relay config profile list                        # * marks the active profile
```

| Command | Purpose | Flags |
|---------|---------|-------|
| `relay config set url <url>` | set the service URL for the active profile | `--profile` |
| `relay config profile list` | list profiles — name, service URL, default workspace | — |
| `relay config profile use <name>` | switch the active profile | — |
| `relay config profile remove <name>` | delete a profile | — |

Rules a schema cannot show you:

- **The URL must be `https://`.** The only exception is `http://127.0.0.1:<port>` for local development — the port is required, and `localhost` is rejected as a hostname.
- Profile names may contain only letters, digits, `.`, `_` and `-`. The built-in profile is named `default`.
- **You rarely create profiles by hand:** `relay login` creates and activates a profile named after the lowercased username, unless `--profile` was passed.
- `relay config profile remove` refuses to delete the **active** profile — switch away with `config profile use` first.

## Auth & device

| Command | Purpose | Flags |
|---------|---------|-------|
| `relay signup --username <u> --device <name>` | register and enroll this environment as a device | `--password-stdin` |
| `relay login --identifier <username\|email>` | log in; re-activates the matching profile | `--device` `--password-stdin` |
| `relay logout` | end the session | `--forget-device` |
| `relay whoami` | service, user, device, default workspace, binding state | — |
| `relay devices list` | every device on the account | — |
| `relay devices add --name <n>` | register a new device | `--no-switch` |
| `relay devices rename <device-id> --name <n>` | rename a device | — |
| `relay devices revoke <device-id>` | revoke a device | — |

Rules a schema cannot show you:

- **`signup` always needs `--device`** — it is a required option.
- **`login` needs `--device` only when the server replies `DEVICE_NAME_REQUIRED`** — i.e. there is no usable remembered binding. In the normal case omit it; the existing binding is reused. Headless, that reply becomes the error "This login requires a device name".
- **`--password-stdin` is what makes either command headless at all.** Without it they read the password from a terminal and fail with "This login requires an interactive terminal". With it, `signup` also skips the password confirmation.
- **Both commands are still human steps** — hand them over rather than attempting them.
- `logout --forget-device` also clears the local device binding; `devices add --no-switch` registers a device without switching the current session.

Device identity outlives its name: `devices revoke` is a soft delete, and that name stays frozen — and unavailable for reuse — until it is renamed.

## Workspace (`ws`)

Every command that accepts `--workspace` resolves its target in this order:

```
--workspace <id|name>   →   the local default   →   error
```

**A fresh install has no default workspace**, and until one is set every bundle and history command fails with `WORKSPACE_REQUIRED`. Creating the first workspace is a human step, and `relay ws create <name> --use` both creates it and makes it the default. Do not guess which workspace to use — ask.

| Command | Purpose | Flags |
|---------|---------|-------|
| `relay ws list` | all workspaces; the default is prefixed `*` | — |
| `relay ws use <id-or-name>` | set the local default | — |
| `relay ws create <name>` | create a workspace | `--desc` `--use` |
| `relay ws info [<id-or-name>]` | name, description, usage, bundle count, device count | — |
| `relay ws rename <id-or-name>` | rename and/or re-describe | `--name` `--desc` |
| `relay ws delete <id-or-name> --confirm-name <name>` | delete the workspace and all its data | `--yes` |
| `relay ws message show` | read the shared workspace note | `--workspace` |
| `relay ws message set` | write the shared workspace note | `--workspace` `--file` `--stdin` `--force` |

Rules a schema cannot show you:

- `ws create --use` also makes the new workspace the default.
- `ws rename` accepts `--name` and `--desc` independently, or both (alias **`relay ws edit`**).
- `ws delete` requires `--confirm-name <name>` to match the real name exactly; `--yes` only skips the prompt (aliases **`rm`**, **`remove`**).
- `ws message set` needs its content from `--file <path>` or `--stdin` — **not both** — and `--force` overrides optimistic locking when the note changed remotely.
- `ws delete` is destructive and **not recoverable** — unlike deleting a bundle.

## Folder

A folder is a **virtual partition inside a workspace**; it does not map to a local directory. Path rules:

- `/` is the root, and `/a/b` nests.
- `a/b` ≡ `/a/b` — the leading slash is optional.
- Empty, `.` and `..` segments are rejected.

| Command | Purpose | Flags |
|---------|---------|-------|
| `relay folder list` | list folders in the workspace | `--workspace` `--tree` |
| `relay folder create <name>` | create a folder | `--parent` (default `/`) `--workspace` |
| `relay folder rename <path> --name <n>` | rename a folder | `--workspace` |
| `relay folder move <path> --parent <p>` | re-parent a folder | `--workspace` |
| `relay folder delete <path>` | delete a folder and its subfolders | `--workspace` `--yes` |

Rules a schema cannot show you:

- `folder list --tree` prints the hierarchy as a tree.
- `--parent` **defaults to `/` on `create`, but is required on `move`** — pass `/` to move a folder back to the root.
- `folder delete --yes` skips the prompt (aliases **`rm`**, **`remove`**).

## Bundle

A **bundle** is one complete handoff: files + a required intent note + the source device. It is not a zip and not a sync session.

| Command | Purpose | Flags |
|---------|---------|-------|
| `relay bundle inbox` | **unread** `READY` bundles for the current device | `--workspace` `--folder` `--limit` (20) `--long` `--include-mine` |
| `relay bundle list` | every bundle in the workspace | `--workspace` `--folder` `--limit` (20) `--long` |
| `relay bundle show <bundle-id>` | metadata and file list | `--workspace` |
| `relay bundle push <path-or-glob> --note <text>` | create → upload → finalize | `--workspace` `--folder` `--add-folder` `--dry-run` |
| `relay bundle pull <bundle-id> --output <dir>` | download; never overwrites existing files | `--workspace` |
| `relay bundle edit <bundle-id>` | change the note and/or move to another folder | `--workspace` `--note` `--folder` `--add-folder` |
| `relay bundle restore <bundle-id>` | restore from trash | `--workspace` |
| `relay bundle delete <bundle-id>` | move to trash | `--workspace` `--yes` |

**`--folder` has two different meanings — read it from the row, not the flag name:**

| On this command | `--folder <p>` means |
|-----------------|---------------------|
| `bundle inbox`, `bundle list` | **filter** the listing to that folder |
| `bundle push`, `bundle edit` | **target** that folder — it must already exist |

On `push`/`edit` it pairs with `--add-folder <p>`, which instead **creates** missing segments. **The two are mutually exclusive** on both commands, enforced at runtime — `--help` does not warn. Prefer `--add-folder` when unsure.

Other rules a schema cannot show you:

- `--long` adds `filesCount` and `createdAt` to the JSON output of `inbox`/`list`; `--include-mine` (inbox only) also shows bundles this device created.
- `bundle delete --yes` skips the confirmation prompt (aliases **`rm`**, **`remove`**).

### `bundle push`

```bash
relay bundle push ./dist --note "continue the codegen from this draft" --add-folder /design/review
```

- `--note <text>` is **required**, it carries the intent telling the receiving agent *why* these files arrived and *what to do next*.
- `--dry-run` resolves and prints the upload plan **without** creating a bundle or uploading anything. Run it first on a large path.
- Globs work: `relay bundle push ./dist/*.tar.gz --note "..."`. Add `--json` when the output will be parsed.

### Lifecycle notes

- `bundle pull` requires `--output <dir>` and refuses to overwrite existing files.
- `bundle edit` needs at least one of `--note`, `--folder` or `--add-folder`; the latter two are mutually exclusive here as well.
- `bundle delete` is a soft delete into a **30-day-recoverable trash**, and `bundle restore` brings it back. The bytes are only released once the trash is purged, so deleting a stale bundle does not immediately free quota.

## History / storage / export

| Command | Purpose | Flags |
|---------|---------|-------|
| `relay history` | recent audit events — which device handed off what, and when | `--workspace` `--limit` (20) |
| `relay storage stats` | current storage consumption against quota | — |
| `relay export <id-or-name>` | export a workspace snapshot to a local JSON file | `--output` |

Rules a schema cannot show you:

- `export --output <file>` writes to a specific path instead of the default.
- `storage stats` covers every workspace, so it accepts no `--workspace` — unlike `history`.

## Errors and exit codes

There are **two** failure shapes, and they go to different places. Check the exit code first, then decide where to read:

| Stream | When | Content |
|--------|------|---------|
| **stdout** | exit `0` only | the result — JSON under `--json`, else a table |
| **stderr** | any non-zero exit | the error: a **JSON envelope** from the CLI, or **plain prose** from the argument parser |

**Failures never write to stdout.** On a non-zero exit, stdout is empty and the error is on stderr. What varies is only the *format* of stderr:

| Exit | stderr format | Parseable? |
|------|---------------|------------|
| `1`, `2`, `3` | JSON envelope | yes — read `error.code` |
| `1` | plain prose | no — read it as text |

The envelope, for anything the CLI itself rejects:

```json
{
  "error": {
    "message": "No active Relay session for the configured service",
    "code": "AUTH_REQUIRED",
    "exitCode": 2,
    "hint": "Run relay login to start a session."
  }
}
```

**Argument errors are the exception, and `--json` does not change them.** A missing required option, an unknown option, or an unknown command is rejected by the argument parser *before* the CLI's error handler ever runs, so stderr carries a bare line instead of the envelope:

```
$ relay bundle pull bundle-002 --json
error: required option '--output <dir>' not specified      # stderr is PROSE; stdout empty; exit 1
```

So the safe pattern is:

1. Exit `0` → parse **stdout** as the result.
2. Exit non-zero → the result is on no stream; parse **stderr**. If it looks like JSON, read `error.code`; otherwise treat it as text.

Never read `error.code` from stdout, and never assume it exists at all.

Exit codes:

| Code | Meaning |
|------|---------|
| `0` | success |
| `1` | runtime error — bad flags, missing workspace, not found, HTTP failure |
| `2` | **auth failure** (`AUTH_REQUIRED`) — no session, or it expired |
| `3` | **quota exceeded** (`QUOTA_EXCEEDED`) — workspace storage is full |

Codes worth branching on, and who can resolve each:

| `code` | Meaning | Who fixes it |
|--------|---------|--------------|
| `AUTH_REQUIRED` | no session, or it expired | **the human** — sign-in is terminal-only |
| `CONFIG_ERROR` | no service URL configured | you — `relay config set url` |
| `WORKSPACE_REQUIRED` | no `--workspace` given and no default | **the human** — the first workspace is human-only |
| `WORKSPACE_AMBIGUOUS` | the name matched more than one workspace | you — retry with the workspace **id**, not the name |
| `WORKSPACE_NOT_FOUND` | no such workspace | you — `relay ws list` |
| `QUOTA_EXCEEDED` | workspace storage is full | a human decision — delete or restore bundles |
| `INVALID_FOLDER_PATH` | malformed folder path | you — see the path rules above |
| `INVALID_SERVICE_URL` | rejected by `config set url` | you — see the rules under Config & profiles |
| `PROFILE_NOT_FOUND` / `PROFILE_IN_USE` | profile misuse | you — `relay config profile list` |
| `RUNTIME_ERROR` | generic — **also what a mutually exclusive flag pair returns** | read `message` and `hint` |

`COMMAND_ERROR`, `HTTP_ERROR` and `EDITOR_ERROR` are likewise generic: read `message` and `hint` rather than switching on them.

## Discovery

| Command | Purpose | Flags |
|---------|---------|-------|
| `relay tools schema` | complete machine-readable JSON Schema of every command, argument and flag | — |
