---
name: relay
description: Use this skill whenever the user needs to hand off files and tasks between devices — send work to another machine, pass a task to a server or HPC to keep working on it, or trace which device handed off what and when. It drives the `relay` CLI to push/pull bundles that carry an intent note and a permanent audit trail. Trigger on phrases like "send this to my laptop/server", "put this on the HPC", "let the other machine continue this", "交接", "传到服务器", "跨设备传文件" — use it even when the user does not name Relay explicitly. Do NOT use for ordinary file sync or cloud-storage uploads, version control (git), or work that stays on a single device.
---

# Relay

Relay moves files and tasks between devices with identity, an intent note, and an audit trail. This skill teaches how to use the `relay` CLI — it does NOT do the transfer itself; the CLI does. The skill's only job is to know which command to run, when.

## Core concept (one sentence)

A **Bundle** is one atomic handoff: files + a required note + the source device, always traceable. Pushing creates it; `inbox`/`pull` receive it; `history` audits it.

## Decision tree — start here every time

Determine the task, then follow exactly one branch:

1. **Hand OFF to another device** (push files/tasks out) → "Push a bundle" below
2. **Receive from another device** (this machine gets something) → "Receive" below
3. **Audit / trace** (who handed what, when) → "Trace" below
4. **Anything else** (workspaces, folders, devices, storage) → see `reference/commands.md`

## Pre-flight — three checks, one command

Before any transfer, run:

```bash
relay whoami --json
```

Read all three preconditions off that single result:

| What you see | What is missing | Who must fix it |
|---|---|---|
| the command itself does not exist | the CLI is not installed | **you** can fix this |
| `No active Relay session for the configured service` (exit code 2) | no session | **the human** — sign-in is terminal-only |
| `"defaultWorkspace": null` | no workspace selected | **the human** — the first workspace is human-only |

A later `No workspace selected` (`WORKSPACE_REQUIRED`) error means the third row was missed. Never attempt a transfer until all three are resolved — and when scripting, branch on the machine-readable `error.code` rather than on the message text (`reference/commands.md` → "Errors and exit codes"). Per-symptom detail: `reference/error-recovery.md`.

### Installing the CLI — you may do this

Two scripts — `setup` and `doctor` — ship with this skill in `scripts/`, each in a Windows and a Unix flavor. Run the matching one from the skill directory:

```powershell
.\scripts\setup.ps1 -RelayUrl "<relay-service-url>"     # Windows
```

```bash
RELAY_URL="<relay-service-url>" ./scripts/setup.sh       # Linux / macOS
```

This installs the CLI and points it at the service. It then **stops with exit code 4 at the login step** — that is expected, not a broken install: signing in needs the human. Ask the person for the service URL if you do not have it, and ask them to complete the login, then re-run `relay whoami --json`. The script is idempotent, so re-running it after that is safe.

`scripts/doctor.ps1` (or `doctor.sh`) is a plain readiness check you can run at any time: exit `0` means installed and signed in. It does **not** check for a workspace, so a `0` alone does not mean transfers can run.

### Human-only steps — never attempt these yourself

Three things must be done by the person. Each happens once per machine, and each is gated because it is an identity or ownership decision rather than a mechanical one:

1. **Sign up / sign in.** `relay login` and `relay signup` read the password from an interactive terminal and refuse to run headless — an agent cannot complete them, and must not try.
2. **Create the first workspace.** A fresh install has no default workspace, and every bundle command fails until one exists. Ask the person to run `relay ws create <name> --use`; `--use` also makes it the default.
3. **Deciding which workspace a handoff belongs in.** Once a default exists, commands work without `--workspace`. If the task clearly belongs somewhere else, ask rather than guess — a human can pass `--workspace <id-or-name>`, or make it the default with `relay ws use <id-or-name>`.

## Push a bundle

```bash
relay bundle push <path-or-glob> --note "<intent>" --add-folder <path>
```

The `--note` flag is the whole point of Relay: it's the intent that tells the receiving agent *why* these files arrived and *what to do next* — e.g. `"please continue the codegen from this draft"`. Without it, a bundle is just anonymous file sync, the opposite of what Relay is for. This is the one flag that must never be omitted.

Other flags, and when they matter:
- `--add-folder <path>` auto-creates a folder path (e.g. `/design/review`); `--folder <path>` only works when the folder already exists. When unsure, prefer `--add-folder`.
- Globs work for multiple files: `relay bundle push ./dist/*.tar.gz --note "..."`.
- Add `--json` when the output will be parsed by a script or another agent.
- Run `--dry-run` first to preview the upload plan before a real push.

## Receive

```bash
relay bundle inbox --json            # unread bundles for THIS device
relay bundle list --limit 5 --json   # all bundles in the workspace
relay bundle pull <bundle-id> --output <dir>
```

- `inbox` shows only bundles sent by *other* devices (unread). Use it first to see what's waiting.
- `pull` requires `--output <dir>` and never overwrites existing files.

## Trace

```bash
relay history --limit 20 --json
```

Returns the audit trail: which device, when, handed what, and who downloaded it.

## Full command reference

- All commands and exact flags: see `reference/commands.md` (hand-maintained; `relay tools schema` gives the live machine-readable version).
- Failure modes and recovery: see `reference/error-recovery.md`.
