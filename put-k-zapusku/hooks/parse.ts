import type { Plan, Stage, Step, Tag, Zone } from '../types'

const TAGS: Tag[] = ['горит', 'ждёт', 'решение', 'клод', 'потом']
const STAGE_RE = /^##\s+(\d+)\s*·\s*(.+?)(?:\s*·\s*([^·]+))?\s*$/
const STEP_RE = /^\s*-\s*\[( |x|X|\/)\]\s+(.*)$/
const END = '(?=\\s|$)'
const STRIP = new RegExp(`\\s*(#(горит|ждёт|решение|клод|потом|сегодня|n8n|сервер)|@[a-z0-9]{6,12})${END}`, 'gu')

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
export const has = (raw: string, token: string) => new RegExp(`(^|\\s)${esc(token)}${END}`, 'u').test(raw)

function readMeta(lines: string[]): { meta: Record<string, string>; body: number } {
  const meta: Record<string, string> = {}
  if (lines[0]?.trim() !== '---') return { meta, body: 0 }
  let i = 1
  for (; i < lines.length && lines[i].trim() !== '---'; i++) {
    const m = lines[i].match(/^\s*([^:]+?)\s*:\s*(.*)$/)
    if (m) meta[m[1]] = m[2].trim()
  }
  return { meta, body: i + 1 }
}

// Разбирает ЭТАПЫ.md: свойства в шапке (--- … ---), этапы «## N · Имя · запуск N», шаги «- [x] …».
export function parsePlan(text: string): Plan {
  const lines = text.replace(/\r/g, '').split('\n')
  const { meta, body } = readMeta(lines)
  const stages: Stage[] = []
  let cur: Stage | null = null
  for (let i = body; i < lines.length; i++) {
    const line = lines[i]
    const sm = line.match(STAGE_RE)
    if (sm) {
      cur = { num: Number(sm[1]), title: sm[2].trim(), launch: (sm[3] ?? '').trim(), steps: [] }
      stages.push(cur)
      continue
    }
    if (/^#{1,2}\s/.test(line)) {
      cur = null
      continue
    }
    const st = cur ? line.match(STEP_RE) : null
    if (st && cur) cur.steps.push(parseStep(st[1], st[2]))
  }
  const queue = (meta['очередь'] ?? '')
    .split(/[,\s→]+/)
    .map(Number)
    .filter(n => Number.isInteger(n) && n > 0)
  return {
    project: meta['проект'] ?? '',
    launch1: meta['запуск_1'] ?? '',
    launch2: meta['запуск_2'] ?? '',
    roadmap: meta['роадмап'] ?? '',
    roadmap1: meta['роадмап_запуск_1'] ?? '',
    refresh: meta['обновить_роадмап'] ?? '',
    queue,
    approved: meta['очередь_утверждена'] ?? '',
    today: meta['сегодня'] ?? '',
    stages,
  }
}

function parseStep(mark: string, raw: string): Step {
  const tag = TAGS.find(t => has(raw, `#${t}`)) ?? null
  const zone: Zone | null = has(raw, '#n8n') ? 'n8n' : has(raw, '#сервер') ? 'сервер' : null
  const owner = raw.match(new RegExp(`(?:^|\\s)@([a-z0-9]{6,12})${END}`, 'u'))?.[1] ?? null
  return {
    text: raw.replace(STRIP, '').trim(),
    isDone: mark === 'x' || mark === 'X',
    isInWork: mark === '/',
    tag,
    isToday: has(raw, '#сегодня'),
    zone,
    owner,
  }
}

export const isLeft = (s: Step) => !s.isDone && s.tag !== 'потом'

export function stagePct(st: Stage): number {
  if (st.steps.length === 0) return 0
  return Math.round((st.steps.filter(s => s.isDone).length / st.steps.length) * 100)
}

export function sumSteps(stages: Stage[]): { done: number; total: number; pct: number } {
  let done = 0
  let total = 0
  for (const st of stages) {
    total += st.steps.length
    done += st.steps.filter(s => s.isDone).length
  }
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 }
}

// Этапы в утверждённой очереди; не попавшие в очередь — в конце по номеру.
export function ordered(plan: Plan): Stage[] {
  const byNum = new Map(plan.stages.map(s => [s.num, s]))
  const out: Stage[] = []
  for (const n of plan.queue) {
    const s = byNum.get(n)
    if (s && !out.includes(s)) out.push(s)
  }
  for (const s of [...plan.stages].sort((a, b) => a.num - b.num)) if (!out.includes(s)) out.push(s)
  return out
}

// Текущий этап: первый по очереди, где остались неотложенные шаги.
export function currentStage(plan: Plan): Stage | null {
  return ordered(plan).find(s => s.steps.some(isLeft)) ?? null
}

export const launchStages = (plan: Plan, n: 1 | 2) =>
  plan.stages.filter(s => new RegExp(`запуск\\s*${n}`, 'i').test(s.launch))

// Горящее этапа: первые пункты с метками горит / ждёт / решение, по одному каждого вида.
export function hotSteps(st: Stage): Step[] {
  const out: Step[] = []
  for (const t of ['горит', 'ждёт', 'решение'] as const) {
    const s = st.steps.find(x => !x.isDone && x.tag === t)
    if (s) out.push(s)
  }
  return out
}

// «Сегодня» действует только в тот день, что записан в шапке.
export function todaySteps(plan: Plan, today: string): { stage: Stage; step: Step }[] {
  if (plan.today !== today) return []
  const out: { stage: Stage; step: Step }[] = []
  for (const stage of ordered(plan)) for (const step of stage.steps) if (step.isToday) out.push({ stage, step })
  return out
}

// n8n и сервер — одна зона: в ней одновременно работает только один сеанс.
export function lockedBy(plan: Plan, step: Step, sid: string): string | null {
  if (!step.zone) return null
  for (const st of plan.stages)
    for (const s of st.steps) if (s.zone && s.owner && s.owner !== sid && !s.isDone) return s.owner
  return null
}

export function localDate(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
export const niceDate = (iso: string) => {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}` : iso
}

// ——— правка файла: только точечные изменения строк, остальное как было ———

export const addToken = (line: string, token: string) => (has(line, token) ? line : `${line.trimEnd()} ${token}`)
export const removeToken = (line: string, token: string) =>
  line.replace(new RegExp(`\\s*${esc(token)}${END}`, 'gu'), '')

// Меняет строку шага: этап по номеру, шаг по тексту. null — шаг не найден.
export function editStep(src: string, stageNum: number, stepText: string, fn: (line: string) => string): string | null {
  const lines = src.split('\n')
  const { body } = readMeta(lines.map(l => l.replace(/\r$/, '')))
  let inStage = false
  for (let i = body; i < lines.length; i++) {
    const sm = lines[i].match(STAGE_RE)
    if (sm) {
      inStage = Number(sm[1]) === stageNum
      continue
    }
    if (/^#{1,2}\s/.test(lines[i])) {
      inStage = false
      continue
    }
    const st = inStage ? lines[i].match(STEP_RE) : null
    if (st && parseStep(st[1], st[2]).text === stepText) {
      lines[i] = fn(lines[i])
      return lines.join('\n')
    }
  }
  return null
}

export const mapSteps = (src: string, fn: (line: string) => string) =>
  src
    .split('\n')
    .map(l => (STEP_RE.test(l) ? fn(l) : l))
    .join('\n')

export function setMeta(src: string, key: string, value: string): string {
  const lines = src.split('\n')
  if (lines[0]?.trim() !== '---') return `---\n${key}: ${value}\n---\n${src}`
  for (let i = 1; i < lines.length && lines[i].trim() !== '---'; i++) {
    if (new RegExp(`^\\s*${esc(key)}\\s*:`).test(lines[i])) {
      lines[i] = `${key}: ${value}`
      return lines.join('\n')
    }
  }
  const close = lines.findIndex((l, i) => i > 0 && l.trim() === '---')
  lines.splice(close, 0, `${key}: ${value}`)
  return lines.join('\n')
}

export const getMeta = (src: string, key: string) => readMeta(src.split('\n')).meta[key] ?? ''

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

// Короткая ссылка claude.ai/artifact/<base58> открывается в браузере; та же страница по
// claude.ai/code/artifact/<uuid> открывается в приложении. id — это uuid в base58.
export function appLink(url: string): string {
  const m = url.trim().match(/^https:\/\/claude\.ai\/artifact\/([1-9A-HJ-NP-Za-km-z]{16,24})\/?$/)
  if (!m) return url.trim()
  let n = 0n
  for (const c of m[1]) n = n * 58n + BigInt(B58.indexOf(c))
  const h = n.toString(16).padStart(32, '0')
  if (h.length !== 32) return url.trim()
  return `https://claude.ai/code/artifact/${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}
