import { expect, test } from 'claude-code/testing'

import {
  appLink,
  currentStage,
  editStep,
  hotSteps,
  lockedBy,
  parsePlan,
  stagePct,
  sumSteps,
  todaySteps,
} from '../hooks/parse'

const SAMPLE = `---
проект: Тест
запуск_1: Работает на меня
запуск_2: Для других
роадмап: https://claude.ai/artifact/37EWfXHPPeDwCqkCAyqKNk
роадмап_запуск_1: https://example.com/l1
обновить_роадмап: python3 -I tools/obnovit.py
очередь: 3, 1, 2
очередь_утверждена: 2026-11-06
---
# ЭТАПЫ

## 1 · Инфра · запуск 1
- [x] a
- [x] b
- [x] c
- [x] d
- [x] e
- [x] f
- [x] g
- [ ] Копии Qdrant #горит #сервер
- [ ] i
- [ ] j

## 2 · Мини · запуск 2
- [ ] m1

## 3 · Агенты · запуск 1
- [x] сделанный шаг
- [ ] Кредиты кончились #горит #n8n
- [ ] Пополнить ключ #ждёт
- [ ] Чинить персоны? #решение
- [ ] Отложенный шаг #потом
- [/] Шаг в работе
- [ ] Ступень 2 #клод
`

const DAY_MS = Date.UTC(2026, 10, 6, 12)
const DAY = '2026-11-06'

const pane = (requestId: string) =>
  ({
    plugin: 'put-k-zapusku',
    component: 'Pane',
    requestId,
    props: { title: 'x', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
  }) as const
const PANE = pane('put-k-zapusku')
const ROAD = pane('put-k-zapusku-roadmap')

const pathOf = (e: any) => String(e?.path ?? e?.[0] ?? e)

type Box = { file: string | null; submitted: string[]; toasts: string[]; opened: string[]; up: boolean }

// Движок под модом: файл в памяти, сеанс с номером, часы на 6 ноября.
function engine(on: any, box: Box, sessionId = 'aaaa1111-xxxx') {
  on('command.register', () => ({ value: { command: 'zapusk' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__put-k-zapusku__session_goal' } }))
  on('ui.open', (_: any, e: any) => {
    box.opened.push(String(e?.id))
    return { value: { isPlaced: box.up } }
  })
  on('ui.panes', () => ({
    value: box.opened.includes('put-k-zapusku')
      ? [{ id: 'put-k-zapusku', title: 'x', isShown: box.up, isFocused: false, isPlaced: box.up }]
      : [],
  }))
  on('ui.toast', (_: any, e: any) => {
    box.toasts.push(String(e?.text ?? e))
    return { value: undefined }
  })
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('session.end', () => ({ sessionId }))
  on('session.cwd', () => ({ value: '/proj' }))
  on('session.id', () => ({ value: sessionId }))
  on('clock.now', () => ({ value: DAY_MS }))
  on('fs.exists', (_: any, e: any) => ({ value: box.file !== null && pathOf(e) === '/proj/ЭТАПЫ.md' }))
  on('fs.read', () => ({ value: box.file ?? '' }))
  on('fs.write', (_: any, e: any) => {
    box.file = String(e?.text ?? e?.[1])
    return { value: undefined }
  })
  on('prompt.submit', (_: any, e: any) => {
    box.submitted.push(String(e.text))
    return { text: String(e.text) }
  })
}
const newBox = (file: string | null = SAMPLE): Box => ({ file, submitted: [], toasts: [], opened: [], up: true })

async function start($: any, on: any, box: Box, surface: any = 'desktop', id?: string) {
  engine(on, box, id)
  await $.session.start({ cwd: '/proj', surface, isInteractive: true })
}

test('проценты считаются по галочкам, метки убираются из текста', () => {
  const plan = parsePlan(SAMPLE)
  expect(stagePct(plan.stages.find(s => s.num === 1)!)).toBe(70)
  expect(plan.queue).toEqual([3, 1, 2])
  expect(sumSteps(plan.stages).total).toBe(18)
  const st3 = plan.stages.find(s => s.num === 3)!
  expect(st3.steps.map(s => s.text)).toContain('Кредиты кончились')
  expect(st3.steps.find(s => s.text === 'Кредиты кончились')!.zone).toBe('n8n')
})

test('текущий этап — первый по очереди, горящее — по одному каждого вида, отложенное не горит', () => {
  const cur = currentStage(parsePlan(SAMPLE))!
  expect(cur.num).toBe(3)
  expect(hotSteps(cur).map(s => s.tag)).toEqual(['горит', 'ждёт', 'решение'])
  expect(hotSteps(cur).some(s => s.text === 'Отложенный шаг')).toBe(false)
})

test('замок: n8n и сервер — одна зона', () => {
  const src = editStep(SAMPLE, 1, 'Копии Qdrant', l => `${l} @bbbb2222`)!
  const plan = parsePlan(src)
  const st3 = plan.stages.find(s => s.num === 3)!
  const n8nStep = st3.steps.find(s => s.text === 'Кредиты кончились')!
  const plain = st3.steps.find(s => s.text === 'Пополнить ключ')!
  expect(lockedBy(plan, n8nStep, 'aaaa1111')).toBe('bbbb2222')
  expect(lockedBy(plan, plain, 'aaaa1111')).toBe(null)
  expect(lockedBy(plan, n8nStep, 'bbbb2222')).toBe(null)
})

test('панель: проценты, этап, горящее, стрелка открывает роадмап', async ($, on) => {
  const box = newBox()
  await start($, on, box)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Этап 3 · Агенты/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: 'Кредиты кончились' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: 'Отложенный шаг' })).toBeFalsy()
  await ui.press({ key: 'road-all' })
  expect(box.opened).toContain('put-k-zapusku-roadmap')
  await ui.unmount()
})

test('«Делаем» ставит цель сеанса, метку сеанса в файле и пишет Клоду', async ($, on) => {
  const box = newBox()
  await start($, on, box)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'do-3-0' })
  expect(box.submitted.some(t => /берём в работу «Кредиты кончились»/.test(t))).toBe(true)
  expect(box.file).toContain('Кредиты кончились #горит #n8n @aaaa1111')
  expect(await ui.find({ type: 'Text', text: /В работе/ })).toBeTruthy()
  await ui.press({ key: 'min' })
  expect(await ui.find({ type: 'Text', text: /Сеанс · 0 из/ })).toBeTruthy()
  await ui.press({ key: 'max' })
  await ui.unmount()
})

test('«В работе» раскрывается кнопкой и показывает шаги этапа цели, повторное нажатие скрывает', async ($, on) => {
  const box = newBox()
  await start($, on, box)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'do-3-0' })
  expect(await ui.find({ type: 'Text', text: 'Отложенный шаг' })).toBeFalsy()
  await ui.press({ key: 'goal' })
  expect(await ui.find({ type: 'Text', text: /Этап 3 · Агенты · 1 из 7/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: 'Отложенный шаг' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: '✓ сделанный шаг' })).toBeTruthy()
  await ui.press({ key: 'goal' })
  expect(await ui.find({ type: 'Text', text: 'Отложенный шаг' })).toBeFalsy()
  await ui.unmount()
})

test('«Обновить роадмап» просит Клода запустить станок из шапки и переиздать страницы', async ($, on) => {
  const box = newBox()
  await start($, on, box)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'refresh' })
  expect(box.submitted.some(t => /обнови роадмап/.test(t) && t.includes('python3 -I tools/obnovit.py'))).toBe(true)
  await ui.unmount()
  const road = await $.ui.mount({ ...ROAD, surface: 'desktop' })
  await road.press({ key: 'refresh-road' })
  expect(box.submitted.filter(t => /обнови роадмап/.test(t)).length).toBe(2)
  await road.unmount()
  const mini = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await mini.press({ key: 'min' })
  await mini.press({ key: 'refresh-mini' })
  expect(box.submitted.filter(t => /обнови роадмап/.test(t)).length).toBe(3)
  await mini.unmount()
})

test('без строки «обновить_роадмап» кнопки нет', async ($, on) => {
  const box = newBox(SAMPLE.replace(/обновить_роадмап:.*\n/, ''))
  await start($, on, box)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ key: 'refresh' })).toBeFalsy()
  await ui.unmount()
})

test('«Потом» просит Клода отложить пункт', async ($, on) => {
  const box = newBox()
  await start($, on, box)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'later-3-1' })
  expect(box.submitted.some(t => /отложи пункт «Пополнить ключ»/.test(t))).toBe(true)
  await ui.unmount()
})

test('«+ Сегодня» ставит метку и дату, блок «Сегодня» появляется; повторное нажатие снимает', async ($, on) => {
  const box = newBox()
  await start($, on, box)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'stage' })
  expect(await ui.find({ type: 'Text', text: /Осталось · 5/ })).toBeTruthy()
  await ui.press({ key: 'pt-3-2' })
  expect(box.file).toContain('Пополнить ключ #ждёт #сегодня')
  expect(box.file).toContain(`сегодня: ${DAY}`)
  expect(await ui.find({ type: 'Text', text: /Сегодня · 6 ноября/ })).toBeTruthy()
  await ui.press({ key: 'pt-3-2' })
  expect(box.file).not.toContain('#сегодня')
  await ui.unmount()
})

test('вчерашний список «Сегодня» сбрасывается при первом выборе нового дня', async ($, on) => {
  const old = SAMPLE.replace('очередь_утверждена: 2026-11-06', 'очередь_утверждена: 2026-11-06\nсегодня: 2026-11-05').replace(
    '- [ ] i',
    '- [ ] i #сегодня',
  )
  expect(todaySteps(parsePlan(old), DAY)).toEqual([])
  const box = newBox(old)
  await start($, on, box)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Сегодня ·/ })).toBeFalsy()
  await ui.press({ key: 'stage' })
  await ui.press({ key: 'pt-3-6' })
  expect(box.file).toContain('- [ ] i\n')
  expect(box.file).toContain('Ступень 2 #клод #сегодня')
  expect(box.file).toContain(`сегодня: ${DAY}`)
  await ui.unmount()
})

test('второй сеанс видит задачу первого как «в другом сеансе», замок n8n не даёт её взять', async ($, on) => {
  const taken = editStep(SAMPLE, 3, 'Кредиты кончились', l => `${l} #сегодня @bbbb2222`)!.replace(
    'очередь_утверждена: 2026-11-06',
    `очередь_утверждена: 2026-11-06\nсегодня: ${DAY}`,
  )
  const box = newBox(taken)
  await start($, on, box, 'desktop', 'aaaa1111-yyyy')
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /В работе в другом сеансе/ })).toBeTruthy()
  await ui.press({ key: 'road-all' })
  const road = await $.ui.mount({ ...ROAD, surface: 'desktop' })
  await road.press({ key: 'ro-1' })
  await road.press({ key: 'rs-1-7' })
  expect(box.toasts.some(t => /Занято/.test(t))).toBe(true)
  expect(box.file).not.toContain('@aaaa1111')
  await road.unmount()
  await ui.unmount()
})

test('закрытие сеанса снимает его метки', async ($, on) => {
  const box = newBox()
  await start($, on, box)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'do-3-0' })
  expect(box.file).toContain('@aaaa1111')
  await ui.unmount()
  await $.session.end({ reason: 'exit' } as any)
  expect(box.file).not.toContain('@aaaa1111')
})

test('роадмап-панель: фильтр, раскрытие этапа, «В сеанс» и «+ Сегодня»', async ($, on) => {
  const box = newBox()
  await start($, on, box)
  const road = await $.ui.mount({ ...ROAD, surface: 'desktop' })
  expect(await road.find({ type: 'Link', text: /Красивая страница/ })).toBeTruthy()
  await road.press({ key: 'f-1' })
  expect(await road.find({ type: 'Text', text: /2 · Мини/ })).toBeFalsy()
  await road.press({ key: 'ro-1' })
  await road.press({ key: 'rt-1-8' })
  expect(box.file).toContain('- [ ] i #сегодня')
  await road.press({ key: 'rs-1-9' })
  expect(box.file).toContain('- [ ] j @aaaa1111')
  expect(box.submitted.some(t => /берём в работу «j»/.test(t))).toBe(true)
  await road.unmount()
})

test('нет ЭТАПЫ.md — подсказка', async ($, on) => {
  const box = newBox(null)
  await start($, on, box)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /заведи этапы/ })).toBeTruthy()
  await ui.unmount()
})

test('без ЭТАПЫ.md панель сама не открывается, а с файлом открывается', async ($, on) => {
  const empty = newBox(null)
  await start($, on, empty)
  expect(empty.opened).toEqual([])
})

test('с ЭТАПЫ.md панель открывается сама при старте сеанса', async ($, on) => {
  const box = newBox()
  await start($, on, box)
  expect(box.opened).toContain('put-k-zapusku')
})

test('в терминале без рисунков тоже рисуется', async ($, on) => {
  const box = newBox()
  await start($, on, box, 'terminal')
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Этап 3/ })).toBeTruthy()
  await ui.unmount()
})

test('короткая ссылка на страницу превращается в ту, что открывается в приложении', () => {
  expect(appLink('https://claude.ai/artifact/37EWfXHPPeDwCqkCAyqKNk')).toBe(
    'https://claude.ai/code/artifact/11111111-2222-4333-8444-555555555555',
  )
  expect(appLink('https://example.com/x')).toBe('https://example.com/x')
})

const BAND = { plugin: 'put-k-zapusku', component: 'AbovePrompt', props: { hasSurvey: false } } as const

const bandTest = (surface: 'terminal' | 'desktop') =>
  test(`кнопка над полем ввода (${surface}): видна, пока панели нет; нажатие открывает панель`, async ($, on) => {
    const box = newBox()
    box.up = false
    await start($, on, box, surface)
    const ui = await $.ui.mount({ ...BAND, surface } as any)
    expect(await ui.find({ key: 'open-pane' } as any)).toBeTruthy()
    box.up = true
    const before = box.opened.length
    await ui.press({ key: 'open-pane' })
    expect(box.opened.length).toBe(before + 1)
    await ui.unmount()
  })
bandTest('terminal')
bandTest('desktop')

test('кнопки нет, когда панель на экране', async ($, on) => {
  const box = newBox()
  on('ui.render', { component: 'AbovePrompt' }, ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)
    return <Text>под модом</Text>
  })
  await start($, on, box)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' } as any)
  expect(await ui.find({ key: 'open-pane' } as any)).toBeFalsy()
  expect(await ui.find({ type: 'Text', text: 'под модом' })).toBeTruthy()
  await ui.unmount()
})
