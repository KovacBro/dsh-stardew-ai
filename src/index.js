/**
 * dsh-stardew-ai 插件入口。
 *
 * 它不实现任何游戏玩法——所有工具来自 mod 的 MCP Server，由
 * `@deepseek-ai/dsh-mcp-client` 以 `mcp__stardew__*` 桥接。本插件补四件
 * MCP 协议够不到的事：
 *
 *   1. 提供 `stardewPaths` 服务，让 patch 里的 `!!js` 拿到 skill 目录
 *   2. 往系统提示词注入「星露谷操作纪律」，防止模型重踩时序与存档的坑
 *   3. 注册原生工具：doctor / focus / launch / card / days
 *   4. 周期卡片：把一天压成 ≤2k 字符，跨天记忆只带卡，不带全历史
 *
 * @module dsh-stardew-ai
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { resolvePaths } from './paths.js'
import { runDoctor } from './doctor.js'
import { focusGameWindow, launchGame, requireWindows } from './game.js'
import { buildCard, listDays } from './card.js'

export const name = 'stardew'

/** 提示词纪律要落进 systemPrompt，工具要落进 tools。 */
export const inject = ['tools', 'systemPrompt']

/** 文本工具结果的统一渲染。 */
const textOutput = {
  schema: { type: 'string' },
  render: (_args, value) => [{ type: 'text', text: value }],
}

function rulesText(paths, modReady) {
  const bridge = modReady
    ? '星露谷工具已挂载：调用名为 `mcp__stardew__<工具名>`（如 mcp__stardew__status）。'
    : '星露谷工具**可能没挂载**：先调 `stardew_doctor` 看是哪一环没接上，别假装能操作游戏。'

  return `## 星露谷物语操作

${bridge} 数据流：工具 → mod 的 HTTP MCP（${paths.apiUrl}/mcp）→ 游戏。路径、时序、游戏侧校验都在 mod 里，你只管调工具。

先跑 \`stardew_doctor\` 再动手（一次看清游戏目录 / SMAPI / mod / 端口 / 存档哪一环没接上）。

纪律（违反会丢进度）：

1. **收尾必睡**。只有 \`go_to_bed\` 会存档；干完活不睡就结束 = 当天全部回滚。要么睡，要么明确告诉用户「尚未存档」。
2. **看 reason，别硬刚**。工具结果带 \`reason\`（\`no_path\` / \`low_energy\` / \`menu_open\` / \`no_money\` …）和 \`partial\`。报 partial 就是只做了一部分，按 \`remaining\` / \`skipped\` 处理，不要原样重试。
3. **优先批量工具**。\`water_all\` / \`harvest_all\` / \`clear_area\` / \`till_area\` / \`plant(area=…)\` 一次一片；不要一格一格调。动手前 \`inventory\` 确认背包有空位。
4. **菜单和剧情不自动跳**。带选项的问题框、商店、箱子会把原文和序号写进结果；用 \`menu\` 读、\`respond\` 选。剧情是内容，读一次就没了，不要替用户跳过。
5. **时间冻结是正常的**。模型思考时世界会停（\`FreezeTimeWhileThinking\`），不代表卡死。真要挂机才 \`pause\`，收尾 \`resume\`。
6. **移动失败就是真到不了**。\`walk_to\` 报 \`no_path\` 不要穿墙式重试；换目标或 \`travel_to\` 换地图。
7. **跨天只带周期卡**。mod 在 12:00 / 18:00 和 150 次调用后会提示 \`Session break:\`；看到就调 \`stardew_card\` 写卡，然后让用户/你新开一个会话。新会话开场只贴卡，不要带昨天的完整日志。
8. **别自己加延时、别连发动作**。每次调用会阻塞到动作真正发生；报成功 = 游戏里真发生了，报错 = 真没发生。

周期卡：\`stardew_card { day?: N }\` 读 \`/api/day?n=N\` + \`/api/memory\` + \`/api/stats?n=N\`，压成 ≤2k 字符写到 \`${paths.cardDir}\`。一天一张，跨天只读卡。`
}

function run(ctx, paths, fn) {
  try {
    return fn()
  } catch (error) {
    return `失败：${error instanceof Error ? error.message : String(error)}`
  }
}

export function apply(ctx) {
  const paths = resolvePaths()

  // patch 里的 skill provider 行 inject 了这个服务，所以 skill 目录只在这里算一次。
  ctx.provide('stardewPaths', paths)

  const modReady = Boolean(paths.modDir)
  ctx.systemPrompt.section({
    name: 'stardew:rules',
    order: 9000,
    text: rulesText(paths, modReady),
  })

  ctx.tools.register(
    defineTool({
      name: 'stardew_doctor',
      description:
        '诊断星露谷链路：游戏目录、SMAPI、StardewMCP mod、8770 端口、/api/state、日志天数、本机存档。只读，不修任何东西。开始操作游戏前先跑这个。',
      parameters: {},
      output: textOutput,
      async execute() {
        return await runDoctor(paths)
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'stardew_focus',
      description: '把星露谷窗口切到前台。SDV 失焦会暂停，菜单点击会静默失效——驱动 UI 前先调用。',
      parameters: {},
      output: textOutput,
      async execute() {
        const blocked = requireWindows()
        if (blocked) return blocked
        const res = await focusGameWindow()
        return res.ok ? `已聚焦：${res.detail}` : `聚焦失败：${res.detail}`
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'stardew_launch',
      description:
        '启动游戏（用 StardewModdingAPI.exe，不是 Steam——Steam 直启加载不到 mod），然后等 /api/state 响应。游戏已在跑时不会重复启动。',
      parameters: {
        waitSeconds: {
          type: 'number',
          description: '等待 mod 响应的上限秒数，默认 90',
        },
      },
      output: textOutput,
      async execute(args) {
        const blocked = requireWindows()
        if (blocked) return blocked
        const seconds = typeof args?.waitSeconds === 'number' ? args.waitSeconds : 90
        return run(ctx, paths, async () => {
          const res = await launchGame(paths, seconds * 1000)
          return res.ok ? `启动成功：${res.detail}` : `启动失败：${res.detail}`
        })
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'stardew_card',
      description:
        '生成一天的周期卡片：读 /api/day + /api/memory + /api/stats，压成 ≤2k 字符，写到 ~/.dsh/stardew/cards/day-NNN.md 并返回全文。不传 day 就取最后一天。跨天记忆只带这张卡。',
      parameters: {
        day: {
          type: 'number',
          description: '游戏日序号（1 起）。不传 = 最后一天',
        },
      },
      output: textOutput,
      async execute(args) {
        return await run(ctx, paths, async () => {
          let day = typeof args?.day === 'number' ? Math.floor(args.day) : undefined
          if (!day) {
            const listed = await listDays(paths)
            if (!listed.ok) return `读不到日志天数：${listed.error}。先跑 stardew_doctor。`
            if (!listed.days.length) return '还没有日志。先玩一天并 go_to_bed 入睡，day_001.jsonl 才会出现。'
            day = listed.days[listed.days.length - 1]
          }
          const res = await buildCard(paths, day)
          if (!res.ok) return res.error
          return `周期卡已写入 ${res.file}\n\n${res.md}`
        })
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'stardew_days',
      description: '列出有日志的游戏日（/api/days）。挑一天给 stardew_card 用。',
      parameters: {},
      output: textOutput,
      async execute() {
        const res = await listDays(paths)
        if (!res.ok) return `读不到：${res.error}。先跑 stardew_doctor。`
        if (!res.days.length) return '还没有日志。先玩一天并入睡。'
        return `有日志的天：${res.days.join('、')}`
      },
    }),
  )
}
