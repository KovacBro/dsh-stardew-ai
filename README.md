# dsh-stardew-ai

把《星露谷物语》接进 **DeepSeek Harness**：模型用 `mcp__stardew__*` 工具实时操控农场，
插件补上诊断、窗口、启动和「周期卡片」跨天记忆。

> **底层 mod 来自 [duckxy166/stardew-ai-agent](https://github.com/duckxy166/stardew-ai-agent)（MIT，作者 Duckxy）。**
> 没有他写的 SMAPI mod、MCP Server 和 HTTP API，这个插件什么也做不了。感谢原作者。
> 本仓库只做 DSH 侧的接线、纪律和记忆层，**不修改、不分发上游 mod**。

## 它解决什么

上游 mod 已经能玩：70 个工具、时间冻结、日记、stats、overlay。缺的是 DSH 侧的几件事：

1. **自动接线**：把 mod 的 Streamable HTTP MCP（`localhost:8770/mcp`）挂成 `mcp__stardew__*`。
2. **链路诊断**：`stardew_doctor` 一次看清游戏 / SMAPI / mod / 端口 / 存档哪一环没接上。
3. **生命周期**：`stardew_focus` 切前台（SDV 失焦会暂停），`stardew_launch` 用 SMAPI 启动。
4. **周期卡片**：一天压成 ≤2k 字符，跨天只带卡，不带全历史——这是省 token 的关键。
5. **操作纪律**：收尾必睡、看 `reason`、批量农活、Session break 的处理，写进系统提示。

## 架构

```
DSH 模型
  │  mcp__stardew__*（70 个游戏工具）
  ▼
@deepseek-ai/dsh-mcp-client  ──streamable-http──▶  http://localhost:8770/mcp
  ▲                                                      │
  │  原生工具：doctor / focus / launch / card / days      ▼
dsh-stardew-ai（本插件）                          StardewMCP mod（游戏内）
  │                                                      │
  └── 周期卡：/api/day + /api/memory + /api/stats ◀──────┘
```

## 安装

### 1. 游戏侧（一次性）

1. 星露谷 1.6+，装 [SMAPI 4.5+](https://smapi.io/)。
2. 下载 [StardewMCP Releases](https://github.com/duckxy166/stardew-ai-agent/releases) 的 zip，解压到 `Stardew Valley/Mods/`，得到 `Mods/StardewMCP/`。
3. 用 `StardewModdingAPI.exe` 启动一次，生成 `Mods/StardewMCP/config.json`。
4. 把要由 DSH 驱动的座位设成 `Brain: "none"`（否则内置 AI 会抢同一个座位）。
5. 想自动读档就设 `AutoLoadSave: "<存档文件夹名>"`。

### 2. DSH 侧

```bash
# 从 GitHub 安装（推荐）
dsh plugin --profile <你的 profile> add github:KovacBro/dsh-stardew-ai

# 或本地开发
dsh plugin --profile <你的 profile> add link:/path/to/dsh-stardew-ai/plugin
```

装完重启 DSH，模型会看到：

- `mcp__stardew__status`、`mcp__stardew__look`、`mcp__stardew__walk_to` …（70 个）
- `stardew_doctor`、`stardew_focus`、`stardew_launch`、`stardew_card`、`stardew_days`
- skill：`星露谷实时操控`

## 周期卡片

一天是一个天然大周期：睡觉存档、日记落盘、stats 结算都在这个边界上。

```
stardew_card { day: 12 }
```

读 `/api/day?n=12` + `/api/memory` + `/api/stats?n=12`，压成 ≤2k 字符，写到
`~/.dsh/stardew/cards/day-012.md`，并返回全文。卡片只有五块：做成 / 错误 / 能力 / 明天 / 怎么用。

新会话开场只贴卡。需要细节再读 `day_NNN.jsonl`。这比带完整历史省 90% 以上的输入 token。

## 工具

| 工具 | 作用 |
|---|---|
| `stardew_doctor` | 链路诊断（只读） |
| `stardew_focus` | 切前台 |
| `stardew_launch` | 用 SMAPI 启动并等 API |
| `stardew_card` | 生成某天的周期卡片 |
| `stardew_days` | 列出有日志的天 |

游戏内工具全部来自上游 mod，见 [references/tools.md](skills/stardew/references/tools.md)。

## 与原库的关系

- 本仓库是**独立仓库**，不 push 到 `duckxy166/stardew-ai-agent`，不会影响原库。
- 上游 mod 升级时，本插件不需要跟着改（只依赖 `/mcp` 和 `/api/*` 的稳定契约）。
- 如果你 fork 本仓库再改，也请保留 `NOTICE` 里的上游署名。

## License

MIT（本仓库新增代码）。上游 mod 为 MIT，Copyright (c) 2026 Duckxy。
游戏版权归 ConcernedApe，本仓库不分发游戏文件。

## 版本

- `v0.1.0`：首个可用版本。doctor / focus / launch / card / days + skill + 周期卡片。
