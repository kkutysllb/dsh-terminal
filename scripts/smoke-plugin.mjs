#!/usr/bin/env node
/**
 * 插件形态冒烟（node scripts/smoke-plugin.mjs）——npm publish 前由
 * prepack 自动执行，任何 FAIL 中断发布。
 *
 * 校验面：package.json 契约（name/version/main/dsh.bundle.patch/
 * dsh.manifestVersion/兼容 peer/exports["./client"]）、产物在位
 * （entry/client/['vendor']/）、模块 id 注册（__ModuleLoader__.load
 * ({id})）、cordis.patch.yml 的 name 指向、旧名/旧锚点零残留。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PKG_NAME = '@kkutysllb/dsh-terminal'
const HAS_CLIENT = true
const INTACT = ['vendor']
const KEEP_LEGACY = [] // 跨层持久化协议锚点（豁免旧名残留检查）
/** dsh 兼容范围（与 peerDependencies 一字不差；上界 <1.0.0 覆盖 0.2.x 全系
 * 含 prerelease——0.2.0 正式版落地后旧上界 <0.2.0 会把 0.2.1-alpha.1 误拒，
 * 该失配由 v1.2.2 修正，与家族其余插件同口径） */
const DSH_COMPAT_RANGE = '>=0.1.6-alpha.2 <1.0.0'
const DSH_PEERS = ['@deepseek-ai/dsh', '@deepseek-ai/dsh-host-webserver']

const src = (p) => (existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p), 'utf8') : null)

const checks = []
const ok = (name, pass, detail = '') => checks.push([name, pass, detail])

// 1) package.json 契约
const pkgRaw = src('package.json')
ok('package.json 存在', pkgRaw !== null)
const pkg = pkgRaw ? JSON.parse(pkgRaw) : {}
ok('name == ' + PKG_NAME, pkg.name === PKG_NAME, String(pkg.name))
ok('version 合法', /^\d+\.\d+\.\d+$/.test(String(pkg.version)), String(pkg.version))
ok('main 入口声明', pkg.main === 'entry.js', String(pkg.main))
ok('dsh.bundle.patch 声明', pkg.dsh?.bundle?.patch === './cordis.patch.yml')

// 1b) dsh 0.2.0 兼容声明（app-boot/plugin-manager 双检查器按
// peerDependencies + includePrerelease 评估；engines.dsh 仅为声明性文档）
ok('dsh.manifestVersion == 1', pkg.dsh?.manifestVersion === 1, String(pkg.dsh?.manifestVersion))
ok('engines.node >= 20', (() => {
  const raw = String(pkg.engines?.node ?? '')
  const floor = Number.parseFloat(raw.replace(/^\s*(>=|<=|>|<|\^|~)/, ''))
  return Number.isFinite(floor) && floor >= 20
})(), String(pkg.engines?.node))
ok('engines.dsh == 兼容范围', pkg.engines?.dsh === DSH_COMPAT_RANGE, String(pkg.engines?.dsh))
for (const peer of DSH_PEERS) {
  ok('peer 声明 ' + peer, pkg.peerDependencies?.[peer] === DSH_COMPAT_RANGE,
    String(pkg.peerDependencies?.[peer]))
}
ok('peer 无 @deepseek-ai/dsh* 以外的检查面键', Object.keys(pkg.peerDependencies ?? {})
  .every((name) => DSH_PEERS.includes(name)), Object.keys(pkg.peerDependencies ?? {}).join(', '))

// 2) 产物在位
ok('entry.js 存在', src('entry.js') !== null)
if (HAS_CLIENT) {
  ok('client.js 存在', src('client.js') !== null)
  ok('exports["./client"] 声明', Boolean(pkg.exports?.['./client']))
}
for (const f of INTACT) ok('intact: ' + f, existsSync(join(ROOT, f)))

// 3) 模块 id 注册
const entry = src('entry.js') ?? ''
ok('entry inject 导出', /export\s+const\s+inject/.test(entry))
const client = HAS_CLIENT ? (src('client.js') ?? '') : ''
if (HAS_CLIENT) {
  ok('ModuleLoader.load 注册', client.includes('window.__ModuleLoader__.load('))
  ok('模块 id == 包名', client.includes("id: '" + PKG_NAME + "'") || client.includes('id: "' + PKG_NAME + '"'))
}

// 4) cordis.patch.yml name 指向
const patch = src('cordis.patch.yml') ?? ''
ok('patch name 指向新包名', patch.includes("name: '" + PKG_NAME + "'") || patch.includes('name: "' + PKG_NAME + '"'))
ok('YAML 无裸 @ 值（patch 行，@ 为 anchor 保留字须引号）', !/:\s+@/.test(patch))

// 5) 旧名/旧锚点零残留（scripts/release 不属于交付面，豁免）
const legacy = ['@kcoder/git-panel', '@kcoder/stats-panel', '@kcoder/terminal',
  '@kcoder/language-bundle', '@kcoder/skills-bundle', 'kc-git-panel', 'kc-stats-panel', 'kc-terminal']
  .filter((n) => !KEEP_LEGACY.includes(n))
const files = ['package.json', 'entry.js', 'cordis.patch.yml', 'README.md']
if (HAS_CLIENT) files.push('client.js')
let residue = []
for (const f of files) {
  const s = src(f)
  if (s === null) continue
  for (const n of legacy) if (s.includes(n)) residue.push(f + ' → ' + n)
}
ok('旧名/旧锚点零残留', residue.length === 0, residue.join('; '))

// 5b) 面板镀铬 + shell 徽标（v1.3.0）——纯 client 面改动，此前没有
// 任何断言覆盖；这几条钉住「服务端供名」与「拖条不实心」两条设计决定。
if (HAS_CLIENT) {
  ok('标签前置终端图标（icon → label → ×）',
    client.includes("el('span', 'kt-tab-icon')") && client.includes('tabEl.append(icon, label, x)'),
    '缺 icon 元素或未插到 label 之前')
  ok('图标随 active/exited 变淡',
    client.includes('.kt-tab[data-active="1"] .kt-tab-icon')
      && client.includes('.kt-tab[data-exited="1"] .kt-tab-icon'))
  ok('header 挂 shell 徽标', client.includes("el('span', 'kt-shell')") && client.includes('shellChip'))
  // 关键设计决定：shell 名取自服务端 tabOf().title（$SHELL → passwd →
  // bash 兜底链 / DSH_TERMINAL_SHELL 覆写的**实际落点**），客户端不得按
  // 平台猜（猜会在用户自定义 shell 或 spawn 回退 bash 时说谎）。
  ok('shell 名取自服务端 tabOf().title（客户端不猜平台）',
    client.includes("const shellNameOf = (tab) => (typeof tab?.title === 'string' ? tab.title : '')")
      && !/process\.platform/.test(client) && !/navigator\.platform/.test(client),
    '未接服务端字段，或 client 内出现平台探测')
  ok('徽标跟随活动标签 + 空桶收起',
    client.includes('syncShellChip(p)') && client.includes('chip.hidden = true'))
  // 用户报的「边框痕迹粗糙」根因就是这一行：上缘 4px 整条被刷成分隔色。
  ok('上缘拖条不再实心填色（灰杠根因）',
    !client.includes('panel.grip.style.background') && client.includes('.kt-grip::after'),
    'grip 仍被实心填色，或缺少悬停胶囊')
  ok('分隔线/徽标底色走 color-mix 派生（无硬编码）',
    client.includes('color-mix(in srgb, ${p.token.fg} 14%, transparent)')
      && !client.includes('token.border'),
    '分隔色未走 color-mix，或死 token border 回流')
  ok('面板上边框 + 圆角 + 投影（停靠区形态）',
    client.includes('border-top:1px solid var(--kt-hair,transparent)')
      && client.includes('border-top-left-radius:10px')
      && client.includes('box-shadow:var(--kt-shadow,none)'))
  // 降级卡此前从不调 applyPalette：暗色主题下它是一块 CSS 兜底的 #fff 白板。
  const depsFn = client.slice(client.indexOf('const ensureDepsPanel'), client.indexOf('const ensurePanel'))
  ok('降级卡同样吃 token（暗色不再白板）', depsFn.includes('applyPalette(panel)'))
}

// 6) 输出
let fail = 0
for (const [name, pass, detail] of checks) {
  console.log((pass ? '  ✓ ' : '  ✗ ') + name + (pass || !detail ? '' : ' — ' + detail))
  if (!pass) fail++
}
console.log('[smoke] ' + (checks.length - fail) + '/' + checks.length + ' 项通过')
process.exit(fail === 0 ? 0 : 1)
