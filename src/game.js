/**
 * 游戏生命周期：MCP 工具够不到的三件事——聚焦、启动、等 API 起来。
 *
 * 进档不在这里做：mod 的 `AutoLoadSave` 能在标题界面自动读档，比模拟点击稳。
 *
 * @module dsh-stardew-ai/game
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { apiGet } from './api.js'

const sleep = ms => new Promise(r => setTimeout(r, ms))

function powershellPath() {
  const sysRoot = process.env.SystemRoot ?? process.env.windir ?? 'C:\\Windows'
  const full = join(sysRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  return existsSync(full) ? full : 'powershell.exe'
}

export function requireWindows() {
  return process.platform === 'win32' ? null : `仅支持 Windows（当前 ${process.platform}）`
}

function runPowerShell(script, timeoutMs = 15000) {
  return new Promise(resolve => {
    const child = spawn(powershellPath(), ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true,
    })
    let out = ''
    const timer = setTimeout(() => {
      child.kill()
      resolve({ ok: false, out: 'PowerShell 超时' })
    }, timeoutMs)
    child.stdout.on('data', chunk => (out += String(chunk)))
    child.stderr.on('data', chunk => (out += String(chunk)))
    child.once('error', err => {
      clearTimeout(timer)
      resolve({ ok: false, out: String(err) })
    })
    child.once('close', code => {
      clearTimeout(timer)
      resolve({ ok: code === 0, out: out.trim() })
    })
  })
}

/** 把星露谷窗口切到前台。 */
export async function focusGameWindow() {
  const blocked = requireWindows()
  if (blocked) return { ok: false, detail: blocked }

  const script = `
$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class StardewWin32 {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
}
"@
$p = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and ($_.ProcessName -like '*Stardew*') } | Select-Object -First 1
if (-not $p) { Write-Output 'NO_WINDOW'; exit 0 }
$h = $p.MainWindowHandle
[void][StardewWin32]::ShowWindow($h, 9)
[void][StardewWin32]::BringWindowToTop($h)
[void][StardewWin32]::SetForegroundWindow($h)
Write-Output ("OK " + $p.ProcessName + " | " + $p.MainWindowTitle)
`.trim()

  const res = await runPowerShell(script)
  if (!res.ok) return { ok: false, detail: res.out || 'PowerShell 执行失败' }
  if (res.out.startsWith('NO_WINDOW')) return { ok: false, detail: '没找到星露谷窗口——游戏可能没启动' }
  return { ok: res.out.startsWith('OK'), detail: res.out.replace(/^OK\s*/, '') }
}

/** 有没有星露谷相关进程在跑（SMAPI 与游戏本体两个进程名都算）。 */
async function anyStardewProcess() {
  const res = await runPowerShell(
    `$p = Get-Process | Where-Object { $_.ProcessName -like '*Stardew*' }; ` +
      `if ($p) { Write-Output ($p | ForEach-Object { $_.ProcessName } | Sort-Object -Unique) } else { Write-Output 'NONE' }`,
    8000,
  )
  return !res.out.includes('NONE')
}

/** 轮询 /api/state，直到 mod 响应。 */
export async function waitForApi(apiUrl, timeoutMs) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const res = await apiGet(apiUrl, '/api/state', 2000)
    if (res.ok) return { ready: true, waitedMs: Date.now() - started }
    await sleep(800)
  }
  return { ready: false, waitedMs: Date.now() - started }
}

/**
 * 启动游戏。必须是分离进程：宿主退出时游戏要能继续活着。
 *
 * SMAPI 是控制台程序，直接 spawn 可能秒退；shell:true 能活但会多一个控制台窗。
 * 这里用 shell:true，稳定优先——多一个窗不影响操作。
 */
export async function launchGame(paths, timeoutMs = 90_000) {
  const blocked = requireWindows()
  if (blocked) return { ok: false, detail: blocked }
  if (!paths.smapiPath) return { ok: false, detail: '没探测到游戏目录，设 STARDEW_GAME_DIR' }
  if (!existsSync(paths.smapiPath)) {
    return { ok: false, detail: `SMAPI 未安装：${paths.smapiPath}。Steam 直启加载不到 mod` }
  }

  try {
    spawn('"' + paths.smapiPath + '"', [], {
      cwd: dirname(paths.smapiPath),
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      shell: true,
    }).unref()
  } catch (error) {
    return { ok: false, detail: `启动失败：${error instanceof Error ? error.message : String(error)}` }
  }

  await sleep(3000)
  if (!(await anyStardewProcess())) {
    return {
      ok: false,
      detail: '进程启动后立刻消失。SMAPI 是控制台程序，直接 spawn 可能秒退；请手动双击 StardewModdingAPI.exe，然后再跑 stardew_doctor。',
    }
  }

  const waited = await waitForApi(paths.apiUrl, timeoutMs)
  if (!waited.ready) {
    return { ok: false, detail: `进程已拉起，但 ${Math.round(waited.waitedMs / 1000)}s 内 ${paths.apiUrl} 没响应。看 SMAPI 控制台是否报 mod 冲突。` }
  }
  return { ok: true, detail: `mod 已响应（${Math.round(waited.waitedMs / 1000)}s）。还需要进档（AutoLoadSave 或手动点 Load）` }
}
