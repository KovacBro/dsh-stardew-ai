/**
 * 周期卡片：把一天的工具日志、失败原因、日记、记忆压成一张 ≤2k 字符的卡片。
 *
 * 为什么是「一天」而不是「每轮」：星露谷的一天是一个天然的大周期——睡觉存档、
 * 日记落盘、stats 结算都在这个边界上。跨天记忆只需要这张卡，不需要带全部历史。
 *
 * 数据源全是 mod 自己写的文件（通过 HTTP API 读）：
 *   /api/day?n=N   → day_NNN.jsonl 的 entries + diary_NNN.md
 *   /api/memory    → lessons.md / plan.md / notes.md
 *   /api/stats?n=N → stats_NNN.json
 *
 * @module dsh-stardew-ai/card
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { apiGet } from './api.js'

const MAX_CHARS = 2200

/** 截断，保留结尾（错误原因常在结尾）。 */
function clip(text, n) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (s.length <= n) return s
  return s.slice(0, n - 1) + '…'
}

/** 从 entries 里按 reason 聚合失败。 */
function failureLines(entries) {
  const counts = new Map()
  for (const e of entries) {
    if (!e || typeof e !== 'object') continue
    const reason = typeof e.reason === 'string' ? e.reason : ''
    const partial = e.partial === true
    if (!reason && !partial) continue
    if (reason === 'ok' && !partial) continue
    const tool = String(e.tool ?? e.name ?? e.kind ?? '?')
    const key = `${tool} · ${partial && !reason ? 'partial' : reason || 'partial'}`
    const cur = counts.get(key) ?? { n: 0, sample: '' }
    cur.n += 1
    if (!cur.sample && typeof e.text === 'string') cur.sample = clip(e.text, 140)
    counts.set(key, cur)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1].n - a[1].n)
    .slice(0, 6)
    .map(([key, v]) => `- ${key} ×${v.n}${v.sample ? `：${v.sample}` : ''}`)
}

/** 从日记 / lessons 里抽「能力/解锁」的行。 */
function abilityLines(diary, lessons) {
  const text = `${diary ?? ''}\n${lessons ?? ''}`
  const hits = text
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => /解锁|学会|第一次|升级|获得|能做|可以|unlock|learn|upgrade|first/i.test(l))
    .slice(0, 5)
  return hits.map(l => `- ${clip(l, 160)}`)
}

/** 取记忆里的 plan / notes 前几行。 */
function planLines(memory) {
  const p1 = memory?.p1 ?? Object.values(memory ?? {})[0] ?? {}
  const plan = String(p1.plan ?? '').trim()
  const notes = String(p1.notes ?? '').trim()
  const lines = []
  if (plan) lines.push(...plan.split(/\r?\n/).filter(Boolean).slice(0, 4).map(l => `- ${clip(l, 160)}`))
  if (!lines.length && notes) lines.push(...notes.split(/\r?\n/).filter(Boolean).slice(0, 3).map(l => `- ${clip(l, 160)}`))
  return lines
}

/** 从 stats 里挑几个数字。 */
function statLine(stats, day) {
  const s = stats?.p1 ?? Object.values(stats ?? {})[0] ?? stats
  if (!s || typeof s !== 'object') return ''
  const pick = ['money', 'totalMoneyEarned', 'day', 'season', 'year', 'energy', 'health']
  const parts = []
  for (const k of pick) {
    if (s[k] !== undefined && s[k] !== null && typeof s[k] !== 'object') parts.push(`${k}=${s[k]}`)
  }
  return parts.length ? `Day ${day}：${parts.join(' · ')}` : ''
}

/** 把卡片裁到硬上限，宁可少写也不炸上下文。 */
function trimCard(md) {
  if (md.length <= MAX_CHARS) return md
  return md.slice(0, MAX_CHARS - 20) + '\n…（已截断）\n'
}

/**
 * 生成一天的周期卡片并落盘。
 * @param {ReturnType<import('./paths.js').resolvePaths>} paths
 * @param {number} day
 */
export async function buildCard(paths, day) {
  const [dayRes, memRes, statsRes] = await Promise.all([
    apiGet(paths.apiUrl, `/api/day?n=${day}`, 10_000),
    apiGet(paths.apiUrl, '/api/memory', 5000),
    apiGet(paths.apiUrl, `/api/stats?n=${day}`, 5000),
  ])

  if (!dayRes.ok) {
    return { ok: false, error: `读不到 day ${day} 的日志：${dayRes.error ?? '未知错误'}。先跑 stardew_doctor。` }
  }

  const data = dayRes.data ?? {}
  const entries = Array.isArray(data.entries) ? data.entries : []
  const diary = typeof data.diary === 'string' ? data.diary : ''
  const memory = memRes.ok ? memRes.data : {}
  const p1 = memory?.p1 ?? Object.values(memory ?? {})[0] ?? {}
  const lessons = typeof p1.lessons === 'string' ? p1.lessons : ''

  const failures = failureLines(entries)
  const abilities = abilityLines(diary, lessons)
  const plans = planLines(memory)
  const stat = statLine(statsRes.ok ? statsRes.data : null, day)

  const sections = [
    `# Day ${String(day).padStart(3, '0')} 周期卡`,
    stat ? `> ${stat}` : '',
    '',
    '## 做成',
    diary ? `- ${clip(diary, 600)}` : '- （没有日记；可能没睡，或 journal 没写）',
    '',
    '## 错误（按 reason 聚合，只留最重要的）',
    failures.length ? failures.join('\n') : '- 无',
    '',
    '## 能力 / 解锁',
    abilities.length ? abilities.join('\n') : '- 无记录',
    '',
    '## 明天',
    plans.length ? plans.join('\n') : '- 从「错误」里挑一条先修',
    '',
    '## 下个会话怎么用这张卡',
    '把这张卡贴进开场，不要带昨天的完整日志。需要细节再读 `day_NNN.jsonl`。',
  ]
    .filter(x => x !== undefined && x !== null)
    .join('\n')

  const md = trimCard(sections)
  await mkdir(paths.cardDir, { recursive: true })
  const file = join(paths.cardDir, `day-${String(day).padStart(3, '0')}.md`)
  await writeFile(file, md + '\n', 'utf8')

  return { ok: true, day, file, md, stats: stat, entries: entries.length }
}

/** 列出有日志的天。 */
export async function listDays(paths) {
  const res = await apiGet(paths.apiUrl, '/api/days', 5000)
  if (!res.ok) return { ok: false, error: res.error ?? '不可达' }
  const days = Array.isArray(res.data) ? res.data.filter(n => Number.isFinite(n)) : []
  return { ok: true, days }
}
