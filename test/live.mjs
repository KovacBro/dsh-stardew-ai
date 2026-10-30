/**
 * 对着正在跑的游戏做一次真实调用：doctor → days → card。
 * 用法：node test/live.mjs
 */

import { resolvePaths } from '../src/paths.js'
import { runDoctor } from '../src/doctor.js'
import { listDays, buildCard } from '../src/card.js'

const paths = resolvePaths()
console.log('=== doctor ===')
console.log(await runDoctor(paths))

console.log('\n=== days ===')
const d = await listDays(paths)
console.log(d)

if (d.ok && d.days.length) {
  console.log('\n=== card ===')
  const c = await buildCard(paths, d.days[d.days.length - 1])
  console.log(c.ok ? `file: ${c.file}\n\n${c.md}` : c.error)
}
