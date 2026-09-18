# Relay CLI — failure modes and recovery (error memory)

> Load when a command fails. Each entry: symptom → cause → fix.
>
> Entries marked **HUMAN STEP** cannot be completed by an agent. Stop, give the person the exact command, and wait for them to confirm.
>
> **First, check WHERE the error is.** Every failure writes to **stderr** and leaves **stdout empty** — success is the only thing that writes to stdout. What varies is the format of stderr: the CLI emits a JSON envelope (`{"error":{"code":...}}`), while a missing required option, an unknown option or an unknown command is rejected by the argument parser first and arrives as plain prose even when `--json` was passed. If stderr is not JSON, read it as text and do not look for `error.code`.

## "command not found" / "relay is not recognized"

- **Cause:** CLI not installed (or not on PATH).
- **Fix — you can do this yourself:** run the setup script shipped with this skill, which installs the CLI and points it at the service:

  ```powershell
  .\scripts\setup.ps1 -RelayUrl "<relay-service-url>"    # Windows
  ```

  ```bash
  RELAY_URL="<relay-service-url>" ./scripts/setup.sh      # Linux / macOS
  ```

  It is idempotent, so re-running is always safe. It will **stop at the login step with exit code 4** — that is expected rather than a broken install, because signing in is a human step (next entry). Manual equivalent if you prefer:

  ```bash
  npm install -g github:Telescop-Lab/Relay-CLI
  relay config set url https://<your-relay-service>
  relay whoami
  ```

## "Relay service URL is not configured" (`CONFIG_ERROR`) on any command

- **Cause:** the active profile has no service URL. This is normal on a fresh install — the CLI ships without a default — and it blocks *every* authenticated command.
- **Fix:** `relay config set url https://<your-relay-service>`, then re-run the failed command. Use `http://127.0.0.1:<port>` instead for a local development service (`localhost` is rejected; the port is required). Confirm with `relay config profile list`.

## "No active Relay session for the configured service" (`AUTH_REQUIRED`, exit 2) — **HUMAN STEP**

- **Cause:** the profile has no session, or it expired. This is also what the doctor scripts report as "not logged in", and a bare HTTP 401/403 surfaces as `AUTH_REQUIRED` too.
- **Fix:** you cannot complete this. `relay login` reads the password from an interactive terminal and refuses to run headless. Ask the person to run one of:

  ```bash
  relay login --identifier <username-or-email>   # already has an account
  relay signup --username <u> --device <name>    # first time on this account
  ```

  Or hand them the guided script: `scripts/setup.ps1 -RelayUrl "<url>" -RelayUser "<username>"` (`RELAY_URL=... RELAY_USER=... ./setup.sh`). Re-run the failed command after they confirm.
- If `login` reports "service URL is not configured", fix that first (see above).

## "This login requires a device name" / "requires an interactive terminal"

- **Cause:** `login` or `signup` ran without a terminal (from a script, CI, or an agent) and without the flags that replace its prompts. "requires an interactive terminal" means `--password-stdin` was omitted; "requires a device name" means the server asked for a new device attachment and no `--device` was given.
- **Fix:** do not retry — sign-in is human by design. Ask the person to run it in a terminal. Only a scripted pipeline that supplies **both** `--password-stdin` **and** `--device <name>` can complete a headless `login`.

## "No workspace selected" (`WORKSPACE_REQUIRED`) — **HUMAN STEP**

- **Cause:** no `--workspace` was passed and the profile has no default workspace. **A fresh install always starts in this state**, because the first workspace is deliberately created by a person.
- **Fix:** ask the person to create it once — `--use` also makes it the default:

  ```bash
  relay ws create <name> --use
  ```

  Then re-run the failed command. If a workspace already exists but is not the default, the person can run `relay ws use <id-or-name>`, or once they tell you which workspace to use you can pass `--workspace <id-or-name>` for a single command. Never pick a workspace yourself.

## `bundle push` fails: `error: required option '--note <text>' not specified`

- **Cause:** `--note` is required and was omitted. This is an argument-parser error, so it is **plain text on stderr** — stdout is empty and there is no `error.code`, even with `--json`.
- **Fix:** add `--note "<intent>"`.

## `bundle push` / `bundle edit` fails: `Use either --folder or --add-folder, not both`

- **Cause:** the two flags are mutually exclusive, and the CLI rejects the pair at runtime — `--help` does not warn about it. Returns `RUNTIME_ERROR` (exit 1).
- **Fix:** keep exactly one. Use `--add-folder` when unsure, since it also creates missing path segments.

## `bundle push` fails: folder not found

- **Cause:** `--folder <p>` points at a non-existent path.
- **Fix:** use `--add-folder <p>` to create it, or `relay folder create` first.

## `bundle pull` fails: `error: required option '--output <dir>' not specified`

- **Cause:** `--output <dir>` is required and was omitted. Plain text on stderr, stdout empty — see the note at the top.
- **Fix:** provide a local output directory. Pull never overwrites existing files, so to re-pull into a used directory you must clear the conflicting files or pick an empty one.

## upload fails mid-push (403 / network)

- **Cause:** transient network or expired presigned URL.
- **Fix:** re-run the same `bundle push`; the CLI retries the upload (registration is not duplicated).

## quota / storage full on push

- **Cause:** workspace storage exhausted.
- **Fix:** `relay storage stats` to see usage; delete or restore stale bundles (`relay bundle delete <id>` moves to trash, freeing space after cleanup).

## "workspace not found" / ambiguity

- **Cause:** `--workspace` value wrong, or no local default set.
- **Fix:** `relay ws list` to find the id/name, then pass `--workspace <id-or-name>` explicitly or `relay ws use <id-or-name>`.

## "inbox is empty" but you expected a handoff

- **Cause:** `inbox` shows only *unread* bundles from *other* devices; your own pushes are excluded.
- **Fix:** use `relay bundle list` (all bundles) or `relay bundle inbox --include-mine`.
