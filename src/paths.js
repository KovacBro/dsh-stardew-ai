/**
 * 路径解析：游戏在哪、SMAPI 在哪、mod 在哪、卡片写哪、skill 在哪。
 *
 * 这是插件里「路径」的唯一真源。patch 里的 `!!js` 只能读环境变量和已注册
 * 的服务，所以 skill 目录也由这里提供，patch 只写 `ctx.stardewPaths.skillDir`。
 *
 * @module dsh-stardew-ai/paths
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const here = dirname(fileURLToPath(import.meta.url))
/** 包根目录（src/ 的上一级）。 */
export const packageRoot = resolve(here, '..')

/** 默认端口与 Stardew MCP 一致。**必须**用 localhost，127.0.0.1 会被 Windows HTTP.sys 拒。 */
export const DEFAULT_PORT = 8770
export const DEFAULT_API_URL = `http://localhost:${DEFAULT_PORT}`

/** 解析 Steam 的 libraryfolders.vdf，拿到所有库根目录。 */
function steamLibraries() {
  const roots = []
  const vdfPlaces = [
    'C:\\Program Files (x86)\\Steam\\steamapps\\libraryfolders.vdf',
    'C:\\Program Files\\Steam\\steamapps\\libraryfolders.vdf',
  ]
  for (const vdf of vdfPlaces) {
    if (!existsSync(vdf)) continue
    try {
      const text = readFileSync(vdf, 'utf8')
      for (const m of text.matchAll(/"path"\s+"([^"]+)"/g)) roots.push(m[1].replace(/\\\\/g, '\\'))
    } catch {
      // 读不到就当没有，不影响其它探测路径。
    }
  }
  return roots
}

/** 常见盘符下的 Steam 库。 */
function guessGameDirs() {
  const dirs = []
  if (process.env.STARDEW_GAME_DIR) dirs.push(process.env.STARDEW_GAME_DIR)
  for (const lib of steamLibraries()) dirs.push(join(lib, 'steamapps', 'common', 'Stardew Valley'))
  for (const drive of ['C:', 'D:', 'E:', 'F:']) {
    dirs.push(`${drive}\\SteamLibrary\\steamapps\\common\\Stardew Valley`)
    dirs.push(`${drive}\\Steam\\steamapps\\common\\Stardew Valley`)
  }
  dirs.push('C:\\Program Files (x86)\\Steam\\steamapps\\common\\Stardew Valley')
  return dirs
}

function firstExisting(candidates) {
  const list = candidates.filter(x => typeof x === 'string' && x.length > 0)
  return { hit: list.find(p => existsSync(p)), list }
}

/** 读 mod 的 config.json，拿 HttpPort / LogDir。读不到就给默认值。 */
function readModConfig(modDir) {
  const file = join(modDir, 'config.json')
  if (!existsSync(file)) return {}
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return {}
  }
}

/**
 * 解析全部路径。每次调用都重新探测——插件跑在长会话里，用户可能中途装 SMAPI。
 * @returns {{
 *   packageRoot: string,
 *   skillDir: string,
 *   cardDir: string,
 *   gameDir: string | undefined,
 *   gameDirCandidates: string[],
 *   smapiPath: string | undefined,
 *   modDir: string | undefined,
 *   logDir: string | undefined,
 *   apiUrl: string,
 *   httpPort: number,
 * }}
 */
export function resolvePaths() {
  const { hit: gameDir, list: gameDirCandidates } = firstExisting(guessGameDirs())
  const smapiPath = gameDir ? join(gameDir, 'StardewModdingAPI.exe') : undefined
  const modDir = gameDir ? join(gameDir, 'Mods', 'StardewMCP') : undefined
  const cfg = modDir ? readModConfig(modDir) : {}
  const httpPort = Number(process.env.STARDEW_HTTP_PORT || cfg.HttpPort || DEFAULT_PORT)
  const apiUrl = process.env.STARDEW_API_URL || `http://localhost:${httpPort}`
  const logDir = modDir ? (cfg.LogDir ? resolve(modDir, cfg.LogDir) : join(modDir, 'logs')) : undefined

  return {
    packageRoot,
    skillDir: join(packageRoot, 'skills'),
    cardDir: join(homedir(), '.dsh', 'stardew', 'cards'),
    gameDir,
    gameDirCandidates,
    smapiPath,
    modDir,
    logDir,
    apiUrl,
    httpPort,
  }
}
