/**
 * 链路诊断：一次看清「游戏 / SMAPI / mod / 端口 / 存档 / API」哪一环没接上。
 *
 * 只读，不修任何东西。模型在动手前先跑一次，能省掉大半「我以为连上了」。
 *
 * @module dsh-stardew-ai/doctor
 */

import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { apiGet, probePort, splitApiUrl } from './api.js'

/** @param {ReturnType<import('./paths.js').resolvePaths>} paths */
export async function runDoctor(paths) {
  const lines = []
  const ok = (label, detail) => lines.push(`✅ ${label}${detail ? `：${detail}` : ''}`)
  const bad = (label, detail) => lines.push(`❌ ${label}${detail ? `：${detail}` : ''}`)
  const warn = (label, detail) => lines.push(`⚠️ ${label}${detail ? `：${detail}` : ''}`)

  // 1. 游戏目录
  if (!paths.gameDir) {
    bad('游戏目录', `没找到。候选：${paths.gameDirCandidates.slice(0, 3).join(' | ')}；可设 STARDEW_GAME_DIR`)
  } else {
    ok('游戏目录', paths.gameDir)
  }

  // 2. SMAPI
  if (!paths.smapiPath || !existsSync(paths.smapiPath)) {
    bad('SMAPI', `未安装（${paths.smapiPath ?? '无游戏目录'}）。Steam 直启加载不到 mod`)
  } else {
    ok('SMAPI', paths.smapiPath)
  }

  // 3. mod
  if (!paths.modDir || !existsSync(paths.modDir)) {
    bad('StardewMCP mod', `未安装（${paths.modDir ?? '无游戏目录'}）`)
  } else {
    ok('StardewMCP mod', paths.modDir)
    const cfg = join(paths.modDir, 'config.json')
    warn('mod 配置', existsSync(cfg) ? `${cfg}（Brain 必须是 none，外部 MCP 才能驱动）` : '还没生成 config.json，启动一次游戏后会有')
  }

  // 4. 端口
  const { host, port } = splitApiUrl(paths.apiUrl)
  const listening = await probePort(host, port)
  if (!listening) {
    bad('MCP 端口', `${host}:${port} 没在听——游戏没启动，或 mod 没加载`)
    return lines.join('\n') + '\n\n下一步：先修上面标 ❌ 的项，再运行 stardew_launch。'
  }
  ok('MCP 端口', `${host}:${port} 在听`)

  // 5. 状态
  const state = await apiGet(paths.apiUrl, '/api/state', 5000)
  if (!state.ok) {
    bad('/api/state', state.error ?? '不可达')
  } else if (!state.data || typeof state.data !== 'object') {
    warn('/api/state', '返回了非 JSON，可能还在启动')
  } else {
    const s = state.data
    const players = Array.isArray(s.players) ? s.players : []
    const aiSeats = players.filter(x => x && (x.role === 'ai' || x.brain))
    ok(
      '/api/state',
      `ready=${s.ready} paused=${s.paused} frozen=${s.frozen} saveFolder=${s.saveFolder ?? '?'} players=${players.length || '?'} ai=${aiSeats.length || '?'}`,
    )
    if (s.saveFolder === undefined || s.saveFolder === null || s.saveFolder === '') {
      warn('存档', '还没进档。标题界面下只能读部分接口；用 AutoLoadSave 或手动读档')
    }
    if (s.paused === true) {
      warn('时间', '当前是暂停状态（F8 或 API pause）。模型思考时冻结是正常的')
    }
  }

  // 6. 日志 / 天数
  const days = await apiGet(paths.apiUrl, '/api/days', 5000)
  if (days.ok && Array.isArray(days.data) && days.data.length > 0) {
    ok('日志天数', `${days.data.length} 天（day ${days.data[0]}…${days.data[days.data.length - 1]}）`)
  } else {
    warn('日志天数', '还没有日志。第一天玩完并入睡后会生成 day_001.jsonl')
  }

  // 7. 存档
  const savesDir = join(process.env.APPDATA ?? '', 'StardewValley', 'Saves')
  if (existsSync(savesDir)) {
    try {
      const saves = readdirSync(savesDir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name)
      ok('本机存档', saves.length ? saves.slice(0, 5).join('、') + (saves.length > 5 ? ` 等 ${saves.length} 个` : '') : '空')
    } catch {
      warn('本机存档', `读不了 ${savesDir}`)
    }
  } else {
    warn('本机存档', `没有 ${savesDir}`)
  }

  return lines.join('\n')
}
