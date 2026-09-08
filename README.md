# Relay CLI

Relay 的命令行客户端。用于在设备之间投递文件 bundle、管理工作区、文件夹与账号设备。

The command-line client for Relay. It hands off file bundles between devices, and manages workspaces, folders, and account devices.

## 环境要求 / Requirements

- Node.js 20+

## 安装 / Install

```bash
npm install -g relay-cli
```

## 快速上手 / Quick start

```bash
# 1. 配置 Relay 服务地址（仅支持 https，本地开发可用 http://127.0.0.1:<port>）
#    Point the CLI at a Relay service URL (https only; local dev may use http://127.0.0.1:<port>)
relay config set url <your-relay-service-url>

# 2. 登录（首次会登记当前环境为一台设备）
#    Log in (the first login registers this environment as a device)
relay login --identifier <username-or-email>

# 3. 推送文件（示例：推送到自动创建的 /design/review 目录）
#    Push files (example: push into an auto-created /design/review folder)
relay bundle push ./dist --note "v0.1.0 build" --add-folder /design/review
```

注册新账号使用 `relay signup` / Use `relay signup` to create a new account:

```bash
relay signup --username <name> --device <device-name>
```

## 多账号（Profile）/ Multiple accounts

CLI 会自动按用户名建立独立的 profile，多个账号可并行共存、互不覆盖：

The CLI creates a separate profile per username automatically, so multiple accounts can coexist without overwriting each other:

```bash
relay login --identifier alice   # 自动落到 profiles.alice / lands in profiles.alice
relay login --identifier bob     # 自动落到 profiles.bob / lands in profiles.bob

relay config profile list        # 查看所有 profile / list all profiles
relay config profile use alice   # 切换当前 profile / switch the active profile
```

也可以显式指定 profile / You can also pass a profile explicitly:

```bash
relay config set url <url> --profile work
relay --profile work login --identifier alice
```

## 全局选项 / Global options

| 选项 Option | 说明 Description |
|------|------|
| `--json` | 以 JSON 输出到 stdout，适合脚本/Agent / Emit JSON to stdout for scripts and agents |
| `--debug` | 输出调试诊断到 stderr / Print debug diagnostics to stderr |
| `--no-color` | 禁用 ANSI 颜色与样式 / Disable ANSI color and styles |
| `--profile <name>` | 使用指定 profile / Use a named profile |
| `-h, --help` | 显示帮助 / Show help |
| `-V, --version` | 显示版本 / Show the CLI version |

## 命令概览 / Commands

| 命令 Command | 说明 Description |
|------|------|
| `relay config` | 配置服务地址与 profile / Configure service URL and profiles |
| `relay signup / login / logout / whoami` | 注册、登录、退出、查看当前身份 / Sign up, log in/out, show identity |
| `relay devices` | 管理账号下的设备 / Manage account devices |
| `relay ws` | 管理工作区（list/use/create/info/rename/delete）/ Manage workspaces |
| `relay ws message` | 读写工作区共享笔记 / Read/write the shared workspace note |
| `relay folder` | 管理工作区文件夹（list/create/rename/move/delete）/ Manage workspace folders |
| `relay bundle` | 投递文件（inbox/list/show/push/pull/edit/restore/delete）/ Hand off file bundles |
| `relay history` | 查看历史事件 / View the audit history |
| `relay storage` | 查看存储配额 / View storage quota |
| `relay export` | 导出工作区数据 / Export workspace data |
| `relay tools schema` | 输出全部命令的机器可读 JSON Schema / Emit a machine-readable schema of every command |

用 `relay <command> --help` 查看任意命令的完整用法。

Run `relay <command> --help` for the full usage of any command.

## 从源码构建 / Build from source

```bash
cd cli
npm install
node build.mjs        # 产出 dist/index.cjs（单文件）/ produces dist/index.cjs (single file)
```

## License

[Apache-2.0](./LICENSE)
