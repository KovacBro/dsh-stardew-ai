---
name: 星露谷实时操控
description: 用 Stardew MCP（duckxy166/stardew-ai-agent 的 mod）在 DeepSeek Harness 里实时玩《星露谷物语》：先诊断链路，再按「看 → 走 → 做 → 睡」的节奏调用 mcp__stardew__* 工具，一天结束用周期卡收尾。适合让 AI 自己经营农场、做养成系实况、或测试农场自动化。
---

# 星露谷实时操控

> 底层是 [duckxy166/stardew-ai-agent](https://github.com/duckxy166/stardew-ai-agent) 的 SMAPI mod（MIT）。
> 本 skill 只写「怎么用」，不复制游戏逻辑。完整 70 个工具见 `references/tools.md`，HTTP API 见 `references/api.md`。

## 什么时候用

- 用户要让 AI 自己玩星露谷、做农场实况、或测试农场自动化。
- 用户说「种种地」「去矿洞」「跟村民说话」「睡觉存档」这类游戏内指令。
- 要做「AI 经营农场」的长期系列（配合周期卡跨天记忆）。

## 先决条件（缺一不可）

1. 星露谷 1.6+，**通过 SMAPI 启动**（`StardewModdingAPI.exe`，不是 Steam 直启）。
2. `Mods/StardewMCP/` 已安装（[Releases](https://github.com/duckxy166/stardew-ai-agent/releases) 的 zip 解压进去）。
3. `config.json` 里对应座位 `Brain: "none"`，让外部 MCP 驱动；否则内置 AI 会抢同一个座位。
4. 游戏里已读档（或设 `AutoLoadSave` 自动读档）。
5. DSH 侧装了 `dsh-stardew-ai` 插件，工具以 `mcp__stardew__*` 出现。

**第一件事永远是 `stardew_doctor`。** 它一次告诉你哪一环没接上，别猜。

## 一天的标准节奏

```
status / look          ← 先看：日期、天气、体力、周围
farm_summary           ← 农场全貌：熟没熟、浇没浇、有没有枯
→ 规划 3–5 个动作
walk_to / travel_to    ← 走
use_tool / plant / harvest / water_all / clear_area / till_area
→ 每 5–8 个动作回一次 status（或看结果里的状态速报）
go_to_bed              ← 收尾必睡，只有它会存档
stardew_card           ← 写当天周期卡
```

### 三条硬规矩

1. **不睡 = 白干**。只有 `go_to_bed` 会存档；当天不睡，进度全回滚。
2. **看 `reason` 和 `partial`**。`no_path` 是真到不了，`low_energy` 是真没体力，`menu_open` 是真有菜单挡着。不要原样重试。
3. **优先批量**。`water_all` / `harvest_all` / `clear_area` / `till_area` / `plant(area=…)` 一次一片；一格一格调又慢又费 token。

## 高频工具（先记这 20 个）

| 场景 | 工具 |
|---|---|
| 看状态 | `status`、`look`、`inventory`、`farm_summary` |
| 走 | `walk_to`、`travel_to` |
| 农活 | `use_tool`、`plant`、`harvest`、`water_all`、`harvest_all`、`clear_area`、`till_area` |
| 钱 | `shop_list`、`buy`、`ship`、`sell` |
| 社交 | `talk_to`、`villagers`、`calendar` |
| 收尾 | `go_to_bed`、`journal` |

其余（矿洞、钓鱼、烹饪、动物、社区中心、节日、博物馆）见 `references/tools.md`。

## 周期卡（跨天只带这张）

一天是一个天然大周期：睡觉存档、日记落盘、stats 结算都在这个边界上。

```
stardew_card { day: 12 }
```

它读 `/api/day?n=12` + `/api/memory` + `/api/stats?n=12`，压成 ≤2k 字符，写到
`~/.dsh/stardew/cards/day-012.md`，并返回全文。内容只有五块：

- **做成**：当天日记（≤600 字）
- **错误**：按 `reason` 聚合的失败（最多 6 条）
- **能力/解锁**：日记和 lessons 里带「解锁/学会/第一次」的行
- **明天**：`plan.md` 的前几行
- **怎么用**：把卡贴进开场，不带昨天的完整日志

新会话开场只贴卡。需要细节再读 `day_NNN.jsonl`。

## Session break

mod 在 12:00 / 18:00 游戏时间、或 150 次工具调用后，会在结果里写 `Session break:`。
看到就：

1. `stardew_card` 写卡；
2. 告诉用户「今天先到这，下个会话从卡继续」；
3. 新会话开场贴卡，不要带旧日志。

## 常见坑

| 现象 | 原因 | 怎么办 |
|---|---|---|
| 工具全 404 / 没挂载 | 游戏没开、mod 没加载、端口不对 | `stardew_doctor` |
| 点击/菜单没反应 | 窗口失焦，SDV 自动暂停 | `stardew_focus`，再操作 |
| 时间不动 | 模型思考时冻结（正常）；或按了 F8 | 看 `/api/state.paused`；收尾 `resume` |
| `no_path` 反复 | 目标不可达 / 地图不对 | 换目标或 `travel_to` |
| 背包满 | `inventory_full` | 先 `chest` 存东西或 `ship` |
| 剧情卡住 | 带选项的对话框 | `menu` 读，`respond` 选；不要自动跳 |
| 一天没存档 | 没 `go_to_bed` | 补睡；或明确告诉用户进度未存 |

## 字幕 / 实况用

- mod 自带 `/overlay`（想法 + 动作）和 `/replay`（按天回放），可以直接加 OBS 浏览器源。
- `think` 是给观众看的私有想法；`say` 是游戏内聊天（只有同屏的人听得到）。
- 每个动作的 `reason` 会显示在 overlay 上——这就是实况的「她在想什么」。

## 来源与许可

- 上游 mod：[duckxy166/stardew-ai-agent](https://github.com/duckxy166/stardew-ai-agent)，MIT，作者 duckxy166（fork 自 [Hunter-Thompson/stardew-mcp](https://github.com/Hunter-Thompson/stardew-mcp)）。
- 本 skill / 插件：[KovacBro/dsh-stardew-ai](https://github.com/KovacBro/dsh-stardew-ai)，MIT。
- 游戏内素材版权归 ConcernedApe；本 skill 不分发游戏文件。
