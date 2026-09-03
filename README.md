# Relay CLI

Relay 的命令行客户端。用于在设备之间投递文件 bundle、管理工作区、文件夹与账号设备。

## 环境要求

- Node.js 20+

## 安装

```bash
npm install -g relay-cli
```

## 快速上手

```bash
# 1. 配置 Relay 服务地址（仅支持 https，本地开发可用 http://127.0.0.1:<port>）
relay config set url https://relay-production-a6d7.up.railway.app

# 2. 登录（首次会登记当前环境为一台设备）
relay login --identifier <username-or-email>

# 3. 推送文件（示例：推送到自动创建的 /design/review 目录）
relay bundle push ./dist --note "v0.1.0 build" --add-folder /design/review
```

注册新账号使用 `relay signup`：

```bash
relay signup --username <name> --device <device-name>
```

## 多账号（Profile）

CLI 会自动按用户名建立独立的 profile，多个账号可并行共存、互不覆盖：

```bash
relay login --identifier alice   # 自动落到 profiles.alice
relay login --identifier bob     # 自动落到 profiles.bob

relay config profile list        # 查看所有 profile
relay config profile use alice   # 切换当前 profile
```

也可以显式指定 profile：

```bash
relay config set url <url> --profile work
relay --profile work login --identifier alice
```

## 全局选项

| 选项 | 说明 |
|------|------|
| `--json` | 以 JSON 输出到 stdout，适合脚本/Agent |
| `--debug` | 输出调试诊断到 stderr |
| `--no-color` | 禁用 ANSI 颜色与样式 |
| `--profile <name>` | 使用指定 profile |
| `-h, --help` | 显示帮助 |
| `-V, --version` | 显示版本 |

## 命令概览

| 命令 | 说明 |
|------|------|
| `relay config` | 配置服务地址与 profile |
| `relay signup / login / logout / whoami` | 注册、登录、退出、查看当前身份 |
| `relay devices` | 管理账号下的设备 |
| `relay ws` | 管理工作区（list/use/create/info/rename/delete） |
| `relay ws message` | 读写工作区共享笔记 |
| `relay folder` | 管理工作区文件夹（list/create/rename/move/delete） |
| `relay bundle` | 投递文件（inbox/list/show/push/pull/edit/restore/delete） |
| `relay history` | 查看历史事件 |
| `relay storage` | 查看存储配额 |
| `relay export` | 导出工作区数据 |
| `relay tools schema` | 输出全部命令的机器可读 JSON Schema |

用 `relay <command> --help` 查看任意命令的完整用法。

## 从源码构建

```bash
cd cli
npm install
node build.mjs        # 产出 dist/index.cjs（单文件）
```

## License

[Apache-2.0](./LICENSE)
