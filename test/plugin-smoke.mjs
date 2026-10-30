/**
 * 插件冒烟测试：不需要 DSH 宿主，mock 一个 ctx，验证 apply 能跑、
 * 系统提示注入、5 个工具都注册。
 *
 * 用法：node test/plugin-smoke.mjs
 */

const tools = []
const sections = []
const provided = {}

const ctx = {
  provide(name, value) {
    provided[name] = value
  },
  systemPrompt: {
    section(s) {
      sections.push(s)
    },
  },
  tools: {
    register(tool) {
      tools.push(tool)
    },
  },
}

const mod = await import('../src/index.js')
mod.apply(ctx)

console.log('name:', mod.name)
console.log('inject:', mod.inject)
console.log('provided:', Object.keys(provided))
console.log('sections:', sections.map(s => `${s.name}@${s.order}`))
console.log('tools:', tools.map(t => t.name))

const paths = provided.stardewPaths
console.log('paths:', {
  apiUrl: paths.apiUrl,
  gameDir: paths.gameDir,
  modDir: paths.modDir,
  cardDir: paths.cardDir,
  skillDir: paths.skillDir,
})

const expected = ['stardew_doctor', 'stardew_focus', 'stardew_launch', 'stardew_card', 'stardew_days']
const missing = expected.filter(n => !tools.some(t => t.name === n))
if (missing.length) {
  console.error('MISSING:', missing)
  process.exit(1)
}
if (!sections.some(s => s.name === 'stardew:rules')) {
  console.error('MISSING system prompt section')
  process.exit(1)
}
console.log('OK: apply() registered 5 tools and the rules section')
