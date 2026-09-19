# Relay CLI

> **⚠️ 内测中 / In Alpha** — Relay 服务暂未对公众开放，敬请期待。To be released shortly. 

## Relay 是什么？/ What is Relay?

Relay 是跨设备的异步文件交接站。上传端投递时无需了解接收方状态，每个任务自带上下文；接收端一条命令拉取，全程结构化记录。

Relay 提供 CLI 和 Web UI 双入口，聚焦 Git 不适合承载、但需要随任务一起交付的文件。

Relay relays files across your devices, asynchronously. Push without needing to know the receiver's path or whether it's online — every task carries its own context; pull with a single command. Every handoff leaves a structured record.

Relay offers both a CLI and a Web UI, focused on files that don't belong in Git but still need to move with the task.


**四个核心概念 / Four core concepts**
- **Workspace (工作区)** — 以项目划分的交接空间：设备在同一工作区内交接文件。/ A project-scoped handoff space; devices hand off files within a workspace.
- **Bundle (交接件)** — 一次完整的交接单元（文件 + 意图 note + 来源设备）。/ One complete handoff unit (files + an intent note + the source device).
- **Device (设备)** — 一等身份：标识「谁在交接」/ A first-class identity: who is handing off.
- **History (历史)** — 一个工作区内只增不改的交接记录，形成审计链 / An append-only record of handoffs within a workspace, forming an audit trail. 

## 快速开始 / Quick start

**前提 / Requirements**：Node.js 20.x

### 安装 / Install

Windows（PowerShell）：

```powershell
.\skills\scripts\setup.ps1 -RelayUrl "<relay-service-url>" -RelayUser "<username>"
```

Linux / macOS：

```bash
RELAY_URL="<relay-service-url>" RELAY_USER="<username>" ./skills/scripts/setup.sh
```

> signup / login 为交互式，需人工输入账号密码。内测期间 `<relay-service-url>` 尚未开放。

### 诊断 / Verify

安装完成后，运行诊断脚本确认 CLI 已装好、已登录、服务可达：

After setup, run the doctor script to confirm the CLI is installed, logged in, and reachable:

Windows（PowerShell）：

```powershell
.\skills\scripts\doctor.ps1
```

Linux / macOS：

```bash
./skills/scripts/doctor.sh
```

退出码 `0` 表示就绪，可开始交接；非 `0` 会指出缺失项。

Exit code `0` means ready to go; any non-zero code indicates missing installation.

### 交接文件 / Hand off files

```bash
relay bundle push ./dist --note "v0.1.0 build" --add-folder /design/review   # 发送 / send
relay bundle inbox --json                                                      # 查看待接收 / see incoming
relay bundle pull <bundle-id> --output <dir>                                   # 接收 / receive
```

所有命令支持 `--json`，面向脚本与 agent；`relay tools schema` 输出机器可读的命令清单。

Every command supports `--json` for scripts and agents; `relay tools schema` emits a machine-readable command list.

### 命令参考 / Command reference

agent 可通过 [Relay Skill](skills/) 自动调用；完整命令与参数见 [skills/reference/commands.md](skills/reference/commands.md)（人工维护的参考文档；需要实时清单时运行 `relay tools schema`）。

Agents can use the [Relay Skill](skills/) to drive the CLI; the full command and flag reference is in [skills/reference/commands.md](skills/reference/commands.md) (hand-maintained; run `relay tools schema` for the live list).

## 完整协议 / Full protocol

术语、生命周期、非目标与对象示例见 [relay-concept-zh.md](docs/spec/relay-concept-zh.md)。

Terminology, lifecycle, non-goals, and object examples live in [relay-concept-en.md](docs/spec/relay-concept-en.md).

## License
[Apache-2.0](./LICENSE)
