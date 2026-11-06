import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Goal, Loaded, Plan, Stage, Step } from '../types'
import {
  addToken,
  appLink,
  currentStage,
  editStep,
  getMeta,
  has,
  hotSteps,
  isLeft,
  launchStages,
  localDate,
  lockedBy,
  mapSteps,
  niceDate,
  ordered,
  parsePlan,
  removeToken,
  setMeta,
  stagePct,
  sumSteps,
  todaySteps,
} from './parse'

const PANE = 'put-k-zapusku'
const ROAD = 'put-k-zapusku-roadmap'
const TITLE = 'Путь к запуску'
const FILE = 'ЭТАПЫ.md'

const loaded = atom({ plugin: 'put-k-zapusku', key: 'loaded' } as const, null, { shape: 'loaded-2' })
const goal = atom({ plugin: 'put-k-zapusku', key: 'goal' } as const, null, { shape: 'goal-1' })
const sid = atom({ plugin: 'put-k-zapusku', key: 'sid' } as const, '', { shape: 'sid-1' })
const openStages = atom({ plugin: 'put-k-zapusku', key: 'openStages' } as const, [], { shape: 'open-1' })
const roadFilter = atom({ plugin: 'put-k-zapusku', key: 'roadFilter' } as const, 'all', { shape: 'filter-1' })
const isMini = atom({ plugin: 'put-k-zapusku', key: 'isMini' } as const, false)
const isStageOpen = atom({ plugin: 'put-k-zapusku', key: 'isStageOpen' } as const, false)
const isAllOpen = atom({ plugin: 'put-k-zapusku', key: 'isAllOpen' } as const, false)
const isGoalOpen = atom({ plugin: 'put-k-zapusku', key: 'isGoalOpen' } as const, false)

const BLUE = '#378ADD'
const GRAY = '#888780'
const TRACK = 'rgba(136,135,128,0.25)'

// ЭТАПЫ.md ищется рядом с проектом: в папке сеанса, в 01_Память-Клода, и так же на 2 уровня выше.
async function findFile($: any): Promise<string | null> {
  const cwd: string = await $.session.cwd()
  const dirs = [cwd]
  let d = cwd
  for (let k = 0; k < 2; k++) {
    const up = d.replace(/\/[^/]+\/?$/, '')
    if (!up || up === d) break
    dirs.push(up)
    d = up
  }
  for (const dir of dirs) {
    for (const p of [`${dir}/${FILE}`, `${dir}/01_Память-Клода/${FILE}`]) {
      if (await $.fs.exists(p)) return p
    }
  }
  return null
}

async function reload($: any): Promise<void> {
  let next: Loaded
  try {
    const path = await findFile($)
    if (!path) {
      next = { status: 'missing', cwd: await $.session.cwd() }
    } else {
      const text: string = await $.fs.read(path)
      next = { status: 'ok', plan: parsePlan(text), path }
    }
  } catch (err) {
    next = { status: 'error', message: String((err as Error)?.message ?? err).slice(0, 200) }
  }
  await update($, loaded, () => next)
}

// Точечная правка ЭТАПЫ.md: читаем свежий файл, меняем строки, пишем, перечитываем.
async function mutate($: any, fn: (src: string) => string | null): Promise<boolean> {
  const d = await read($, loaded)
  if (!d || d.status !== 'ok') return false
  const src: string = await $.fs.read(d.path)
  const out = fn(src)
  if (out !== null && out !== src) await $.fs.write(d.path, out)
  await reload($)
  return out !== null
}

const today = async ($: any) => localDate(await $.clock.now())

async function toggleToday($: any, stageNum: number, text: string) {
  const day = await today($)
  await mutate($, src => {
    let s = src
    if (getMeta(s, 'сегодня') !== day) {
      s = mapSteps(s, l => removeToken(l, '#сегодня'))
      s = setMeta(s, 'сегодня', day)
    }
    return editStep(s, stageNum, text, l => (has(l, '#сегодня') ? removeToken(l, '#сегодня') : addToken(l, '#сегодня')))
  })
}

const releaseOwner = ($: any, owner: string) => (owner ? mutate($, src => mapSteps(src, l => removeToken(l, `@${owner}`))) : null)

// Взять шаг в этот сеанс: замок по зоне, метка @сеанс в файле, цель сеанса, сообщение Клоду.
async function take($: any, stage: Stage, step: Step) {
  const d = await read($, loaded)
  const me = await read($, sid)
  if (!d || d.status !== 'ok') return
  if (lockedBy(d.plan, step, me)) {
    void $.ui.toast(`Занято: ${step.zone} уже в работе в другом сеансе`)
    return
  }
  await mutate($, src => {
    const s = me ? mapSteps(src, l => removeToken(l, `@${me}`)) : src
    return me ? editStep(s, stage.num, step.text, l => addToken(l, `@${me}`)) : s
  })
  await update($, goal, () => ({ title: step.text, stage: stage.num, done: 0, total: 0, next: '' }))
  await $.prompt.submit({
    text: `Панель: берём в работу «${step.text}» (этап ${stage.num}). Разбей на маленькие шаги, вызови session_goal с total и веди меня по шагам, обновляя done и next. Когда сделаешь — поставь [x] в ${FILE}.`,
  })
}

// Кнопка «Обновить роадмап»: команду (станок) берём из шапки ЭТАПЫ, `обновить_роадмап:`. ИИ тут только курьер.
const refresh = ($: any, plan: Plan) =>
  $.prompt.submit({
    text:
      `Панель: обнови роадмап. Экономно, файлы не читай и не правь руками: ` +
      `1) в корне проекта выполни \`${plan.refresh}\`; ` +
      `2) переиздай по старым ссылкам страницы из строк «переиздать:» в её выводе (Artifact, publish того же файла с url); ` +
      `3) ответь 2–3 строками с цифрами из вывода.`,
  })

const bar = (pct: number, color: string, w = 300, h = 4) => {
  const fill = Math.max(0, Math.min(100, pct)) * (w / 100)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" rx="${h / 2}" fill="${TRACK}"/><rect width="${fill}" height="${h}" rx="${h / 2}" fill="${color}"/></svg>`
}

const textBar = (pct: number, cells = 20) => {
  const n = Math.round((Math.max(0, Math.min(100, pct)) / 100) * cells)
  return '█'.repeat(n) + '░'.repeat(cells - n)
}

const TAG_LOOK: Record<string, { label: string; color: string }> = {
  горит: { label: 'Горит', color: 'error' },
  ждёт: { label: 'Ждёт тебя', color: 'warning' },
  решение: { label: 'Решение', color: 'suggestion' },
  клод: { label: 'Клод сам', color: 'inactive' },
  потом: { label: 'Потом', color: 'inactive' },
}

const sameTitle = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

// Общие куски рисунка для малой панели и для роадмапа.
async function kit($: any, e: any) {
  const els = $.ui.resolve(e) as any
  const Svg = e.surface === 'terminal' ? null : els.Svg
  const width = Math.max(180, Math.min(520, ((e.props as any)?.bodyColumns ?? 40) * 8))
  const me: string = await read($, sid)
  const day = await today($)
  const Bar = ({ pct, color, w, thick }: { pct: number; color: string; w?: number; thick?: number }) =>
    Svg ? (
      <Svg source={bar(pct, color, w ?? width, thick ?? 4)} alt={`${pct}%`} width={w ?? width} height={thick ?? 4} />
    ) : (
      <els.Text dimColor>{textBar(pct)}</els.Text>
    )
  return { els, Bar, me, day, width }
}

function StepRow(
  $: any,
  els: any,
  plan: Plan,
  me: string,
  stage: Stage,
  s: Step,
  idx: number,
  prefix: string,
) {
  const { Box, Text, Button } = els
  const lock = lockedBy(plan, s, me)
  const mine = s.owner && s.owner === me
  const other = s.owner && s.owner !== me
  const mark = s.isInWork ? '◐' : s.tag === 'горит' ? '🔥' : s.tag === 'ждёт' ? '🙋' : s.tag === 'решение' ? '❓' : '○'
  return (
    <Box key={`${prefix}row-${stage.num}-${idx}`} flexDirection="column" gap="xs">
      <Text size="footnote" dimColor={s.tag === 'потом'}>
        {mark} {s.text}
        {s.tag === 'клод' ? <Text dimColor> · Клод сам</Text> : null}
        {s.zone ? <Text dimColor> · {s.zone}</Text> : null}
      </Text>
      <Box flexDirection="row" justifyContent="flex-end" gap="xs">
        {mine ? <Text size="caption" color="suggestion">этот сеанс</Text> : null}
        {other ? <Text size="caption" color="warning">в другом сеансе</Text> : null}
        {other ? (
          <Button key={`${prefix}u-${stage.num}-${idx}`} plain dimColor label="Снять" onPress={() => releaseOwner($, s.owner!)} />
        ) : null}
        <Button
          key={`${prefix}t-${stage.num}-${idx}`}
          plain
          dimColor={!(s.isToday && plan.today)}
          label={s.isToday ? '✓ Сегодня' : '+ Сегодня'}
          onPress={() => toggleToday($, stage.num, s.text)}
        />
        {!mine && !other ? (
          <Button
            key={`${prefix}s-${stage.num}-${idx}`}
            plain
            dimColor={!!lock}
            label={lock ? 'Занято' : 'В сеанс'}
            onPress={() => take($, stage, s)}
          />
        ) : null}
      </Box>
    </Box>
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const ran = await next(e)
    const id = String(await $.session.id()).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8)
    await update($, sid, () => id)
    await $.command.register({ name: 'zapusk', description: 'Открыть панель «Путь к запуску»' })
    await $.tool.register({
      name: 'session_goal',
      description:
        'Панель «Путь к запуску»: задать или обновить цель этого сеанса. Вызывай, когда пользователь нажал «Делаем»/«В сеанс» (или сказал, что берём пункт): разбей пункт на шаги и передай total; после каждого сделанного шага передай done и next (следующий шаг коротко). clear=true снимает цель и освобождает пункт для других сеансов.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Пункт из ЭТАПЫ.md, как в файле' },
          stage: { type: 'integer', description: 'Номер этапа' },
          done: { type: 'integer', description: 'Сколько шагов сделано' },
          total: { type: 'integer', description: 'Сколько шагов всего' },
          next: { type: 'string', description: 'Следующий шаг, до 60 знаков' },
          clear: { type: 'boolean' },
        },
      },
      isDeferred: false,
    })
    await reload($)
    // Сама панель открывается только в проекте, где есть ЭТАПЫ.md; в остальных — по команде /zapusk.
    const found = await read($, loaded)
    if (found && found.status === 'ok') void $.ui.open({ id: PANE, title: TITLE })
    return ran
  })

  // Сеанс закрылся — его задачи свободны для других сеансов.
  on('session.end', async ($, e, next) => {
    try {
      await releaseOwner($, await read($, sid))
    } catch {}
    return next(e)
  })

  on('command.run', { command: 'zapusk' }, async $ => {
    await reload($)
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: 'Панель «Путь к запуску» открыта.' }
  })

  on('tool.call', { tool: 'mcp__put-k-zapusku__session_goal' }, async ($, e) => {
    const input = e as unknown as Partial<Goal> & { clear?: boolean }
    if (input.clear) {
      await update($, goal, () => null)
      await releaseOwner($, await read($, sid))
      return { result: 'Цель сеанса снята, пункт свободен для других сеансов.' }
    }
    const old = await read($, goal)
    const v: Goal = {
      title: String(input.title ?? old?.title ?? '').slice(0, 120),
      stage: Number(input.stage ?? old?.stage ?? 0),
      done: Math.max(0, Number(input.done ?? old?.done ?? 0)),
      total: Math.max(0, Number(input.total ?? old?.total ?? 0)),
      next: String(input.next ?? old?.next ?? '').slice(0, 80),
    }
    await update($, goal, () => v)
    if (v.total > 0 && v.done >= v.total) await releaseOwner($, await read($, sid))
    return { result: `Цель сеанса на панели: «${v.title}», ${v.done} из ${v.total}.` }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'Панель «Путь к запуску»: не смогла обновить цель сеанса.' }))

  on('turn.complete', async ($, e, next) => {
    const ran = await next(e)
    await reload($)
    return ran
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { els, Bar, me, day } = await kit($, e)
    const { Box, Text, Button } = els
    const data = await read($, loaded)
    const g = await read($, goal)
    const mini = await read($, isMini)
    const stageOpen = await read($, isStageOpen)
    const allOpen = await read($, isAllOpen)
    const goalOpen = await read($, isGoalOpen)

    if (!data || data.status !== 'ok') {
      return (
        <Box flexDirection="column" gap="sm" padding="sm">
          <Text weight="medium">{TITLE}</Text>
          {data?.status === 'error' ? (
            <Text color="error">Не прочитал {FILE}: {data.message}</Text>
          ) : (
            <Text dimColor>В этом проекте ещё нет {FILE}. Скажи Клоду: «заведи этапы».</Text>
          )}
        </Box>
      )
    }

    const plan: Plan = data.plan
    const all = sumSteps(plan.stages)
    const l1 = sumSteps(launchStages(plan, 1))
    const l2 = sumSteps(launchStages(plan, 2))
    const launchIs2 = l1.total > 0 && l1.done === l1.total && l2.total > 0
    const L = launchIs2 ? l2 : l1
    const launchName = launchIs2 ? `Запуск 2 · ${plan.launch2}` : `Запуск 1 · ${plan.launch1}`
    const cur = currentStage(plan)
    const todayList = todaySteps(plan, day)
    const todayDone = todayList.filter(x => x.step.isDone).length

    const openRoad = async (filter: string) => {
      await update($, roadFilter, () => filter)
      await $.ui.open({ id: ROAD, title: 'Роадмап' })
    }

    // Этап, к которому относится цель сеанса: его шаги показываются по кнопке ˅, как у «Сейчас».
    const goalStage = g ? plan.stages.find(st => st.num === g.stage) ?? null : null
    const GoalSteps = () =>
      goalStage ? (
        <Box flexDirection="column" gap="sm">
          <Text size="caption" dimColor>
            Этап {goalStage.num} · {goalStage.title} · {goalStage.steps.filter(s => s.isDone).length} из {goalStage.steps.length}
          </Text>
          <Text size="caption" dimColor>Осталось · {goalStage.steps.filter(isLeft).length}</Text>
          {goalStage.steps.map((s, i) => (isLeft(s) ? StepRow($, els, plan, me, goalStage, s, i, 'g') : null))}
          {goalStage.steps.some(s => !s.isDone && s.tag === 'потом') ? (
            <Text size="caption" dimColor>Отложено · {goalStage.steps.filter(s => !s.isDone && s.tag === 'потом').length}</Text>
          ) : null}
          {goalStage.steps.map((s, i) => (!s.isDone && s.tag === 'потом' ? StepRow($, els, plan, me, goalStage, s, i, 'g') : null))}
          <Text size="caption" dimColor>Сделано · {goalStage.steps.filter(s => s.isDone).length}</Text>
          {goalStage.steps
            .filter(s => s.isDone)
            .map((s, i) => (
              <Text key={`gd-${i}`} size="footnote" dimColor>✓ {s.text}</Text>
            ))}
        </Box>
      ) : (
        <Text size="footnote" dimColor>Этап {g?.stage} не найден в {FILE}: шаги цели ведёт сеанс.</Text>
      )
    const GoalBlock = ({ compact }: { compact: boolean }) =>
      g ? (
        <Box flexDirection="column" gap="xs">
          {compact ? (
            <Text size="caption" color="suggestion">Сеанс · {g.done} из {g.total || '?'}</Text>
          ) : (
            <Box flexDirection="row" justifyContent="space-between" alignItems="center">
              <Text size="caption" color="suggestion">В работе · {g.done} из {g.total || '?'}</Text>
              <Button key="goal" plain onPress={() => update($, isGoalOpen, v => !v)}>
                <Text size="footnote" dimColor>{goalOpen ? 'скрыть шаги ˄' : 'шаги ˅'}</Text>
              </Button>
            </Box>
          )}
          <Text weight="medium">{g.title}</Text>
          <Bar pct={g.total ? Math.round((g.done / g.total) * 100) : 0} color={BLUE} thick={3} />
          {g.next ? <Text size="footnote" dimColor>Дальше: {g.next}</Text> : null}
          {!compact && goalOpen ? <GoalSteps /> : null}
        </Box>
      ) : (
        <Text size="footnote" dimColor>Сеанс: нажми «Делаем» у пункта</Text>
      )

    if (mini) {
      return (
        <Box flexDirection="column" gap="sm" padding="sm">
          <Box flexDirection="row" justifyContent="space-between" alignItems="center">
            <Text size="caption" dimColor>{launchIs2 ? 'Запуск 2' : 'Запуск 1'}</Text>
            <Button key="max" plain dimColor label="Развернуть" onPress={() => update($, isMini, () => false)} />
          </Box>
          <Box flexDirection="row" gap="sm" alignItems="flex-end">
            <Text size="title" weight="medium" color="suggestion">{L.pct}%</Text>
            <Text size="footnote" dimColor>осталось {100 - L.pct}%</Text>
          </Box>
          <Bar pct={L.pct} color={BLUE} />
          <GoalBlock compact />
          {data.plan.refresh ? (
            <Button key="refresh-mini" label="↻ Обновить роадмап" onPress={() => refresh($, data.plan)} />
          ) : null}
          {todayList.length ? (
            <Text size="caption" dimColor>Сегодня · {todayDone} из {todayList.length} готово</Text>
          ) : null}
        </Box>
      )
    }

    const Progress = ({ label, pct, filter, color, k }: { label: string; pct: number; filter: string; color: string; k: string }) => (
      <Box key={k} flexDirection="column" gap="xs">
        <Box flexDirection="row" justifyContent="space-between" alignItems="flex-end">
          <Text size="footnote" dimColor>{label}</Text>
          <Box flexDirection="row" gap="sm" alignItems="center">
            <Text size="heading" weight="medium" color={color === BLUE ? 'suggestion' : undefined}>{pct}%</Text>
            <Button key={`road-${k}`} plain dimColor label="↗" onPress={() => openRoad(filter)} />
          </Box>
        </Box>
        <Bar pct={pct} color={color} />
      </Box>
    )

    const HotItem = ({ s, stage, idx }: { s: Step; stage: Stage; idx: number }) => {
      if (g && sameTitle(g.title, s.text)) return <GoalBlock compact={false} />
      const look = TAG_LOOK[s.tag ?? ''] ?? TAG_LOOK['клод']
      const lock = lockedBy(plan, s, me)
      const other = s.owner && s.owner !== me
      return (
        <Box key={`hot-${stage.num}-${idx}`} flexDirection="column" gap="xs">
          <Text size="caption" color={look.color}>● {look.label}</Text>
          <Text size="footnote">{s.text}</Text>
          <Box flexDirection="row" justifyContent="flex-end" gap="xs">
            {other ? <Text size="caption" color="warning">в другом сеансе</Text> : null}
            <Button
              key={`later-${stage.num}-${idx}`}
              plain
              dimColor
              label="Потом"
              onPress={() =>
                $.prompt.submit({
                  text: `Панель: отложи пункт «${s.text}» (этап ${stage.num}) — поставь ему метку #потом в ${FILE}.`,
                })
              }
            />
            {other ? null : (
              <Button key={`do-${stage.num}-${idx}`} label={lock ? 'Занято' : 'Делаем'} onPress={() => take($, stage, s)} />
            )}
          </Box>
        </Box>
      )
    }

    const TodayBlock = () => (
      <Box flexDirection="column" gap="sm">
        <Box flexDirection="row" justifyContent="space-between">
          <Text size="caption" dimColor>Сегодня · {niceDate(day)}</Text>
          <Text size="caption" dimColor>{todayDone} из {todayList.length} готово</Text>
        </Box>
        {todayList.map(({ stage, step }, i) => {
          const mine = step.owner && step.owner === me
          const other = step.owner && step.owner !== me && !step.isDone
          const lock = lockedBy(plan, step, me)
          const goalHere = g && sameTitle(g.title, step.text)
          return (
            <Box key={`td-${i}`} flexDirection="row" justifyContent="space-between" alignItems="center" gap="sm">
              <Box flexDirection="column" flexShrink={1}>
                <Text size="footnote" dimColor={step.isDone} strikethrough={step.isDone}>
                  {step.isDone ? '✓' : mine || goalHere ? '●' : other ? '◐' : '○'} {step.text}
                </Text>
                {mine || goalHere ? (
                  <Text size="caption" color="suggestion">
                    Этот сеанс{g && goalHere ? ` · ${g.done} из ${g.total || '?'}` : ''}
                  </Text>
                ) : other ? (
                  <Text size="caption" color="warning">В работе в другом сеансе</Text>
                ) : null}
              </Box>
              {step.isDone || mine || goalHere ? null : other ? (
                <Button key={`tdu-${i}`} plain dimColor label="Снять" onPress={() => releaseOwner($, step.owner!)} />
              ) : (
                <Button key={`tdo-${i}`} label={lock ? 'Занято' : 'Делаем'} onPress={() => take($, stage, step)} />
              )}
            </Box>
          )
        })}
      </Box>
    )

    return (
      <Box flexDirection="column" gap="md" padding="sm">
        <Box flexDirection="row" justifyContent="space-between" alignItems="center">
          <Text size="caption" dimColor>{plan.project}</Text>
          <Button key="min" plain dimColor label="Свернуть" onPress={() => update($, isMini, () => true)} />
        </Box>

        <Progress k="all" label="Весь продукт" pct={all.pct} filter="all" color={GRAY} />
        <Progress k="l" label={launchName} pct={L.pct} filter={launchIs2 ? '2' : '1'} color={BLUE} />
        {plan.refresh ? (
          <Box flexDirection="row" justifyContent="flex-end">
            <Button key="refresh" label="↻ Обновить роадмап" onPress={() => refresh($, plan)} />
          </Box>
        ) : null}
        {plan.approved && plan.approved !== 'нет' ? null : (
          <Text size="caption" color="warning">Очередь этапов ещё не утверждена</Text>
        )}

        {todayList.length ? <TodayBlock /> : null}

        {cur ? (
          <Box flexDirection="column" gap="sm">
            <Box flexDirection="column" gap="xs">
              <Text size="caption" dimColor>Сейчас</Text>
              <Box flexDirection="row" justifyContent="space-between" alignItems="center">
                <Text weight="medium">Этап {cur.num} · {cur.title}</Text>
                <Button key="stage" plain onPress={() => update($, isStageOpen, v => !v)}>
                  <Text size="footnote" dimColor>
                    {cur.steps.filter(s => s.isDone).length} из {cur.steps.length} {stageOpen ? '˄' : '˅'}
                  </Text>
                </Button>
              </Box>
              <Bar pct={stagePct(cur)} color={GRAY} />
            </Box>
            {stageOpen ? (
              <Box flexDirection="column" gap="sm">
                <Text size="caption" dimColor>Осталось · {cur.steps.filter(isLeft).length}</Text>
                {cur.steps.map((s, i) => (isLeft(s) ? StepRow($, els, plan, me, cur, s, i, 'p') : null))}
                {cur.steps.some(s => !s.isDone && s.tag === 'потом') ? (
                  <Text size="caption" dimColor>Отложено · {cur.steps.filter(s => !s.isDone && s.tag === 'потом').length}</Text>
                ) : null}
                {cur.steps.map((s, i) => (!s.isDone && s.tag === 'потом' ? StepRow($, els, plan, me, cur, s, i, 'p') : null))}
                <Text size="caption" dimColor>Сделано · {cur.steps.filter(s => s.isDone).length}</Text>
                {cur.steps
                  .filter(s => s.isDone)
                  .slice(-4)
                  .map((s, i) => (
                    <Text key={`d-${i}`} size="footnote" dimColor>✓ {s.text}</Text>
                  ))}
                {cur.steps.filter(s => s.isDone).length > 4 ? (
                  <Text size="caption" dimColor>и ещё {cur.steps.filter(s => s.isDone).length - 4}</Text>
                ) : null}
              </Box>
            ) : (
              <Box flexDirection="column" gap="md">
                {g && !cur.steps.some(s => sameTitle(s.text, g.title)) && !todayList.some(x => sameTitle(x.step.text, g.title)) ? (
                  <GoalBlock compact={false} />
                ) : null}
                {hotSteps(cur).map((s, idx) => (
                  <HotItem s={s} stage={cur} idx={idx} />
                ))}
                {hotSteps(cur).length === 0 && !g ? (
                  <Text size="footnote" dimColor>Горящего нет. Открой этап, чтобы выбрать шаг.</Text>
                ) : null}
              </Box>
            )}
          </Box>
        ) : (
          <Text color="success">Все этапы пройдены 🎉</Text>
        )}

        <Box flexDirection="row" justifyContent="space-between" alignItems="center">
          <Button key="all" plain onPress={() => update($, isAllOpen, v => !v)}>
            <Text size="caption" dimColor>Все этапы · {plan.stages.length} {allOpen ? '˄' : '˅'}</Text>
          </Button>
          <Text size="caption" dimColor>✓ {all.done} · осталось {all.total - all.done}</Text>
        </Box>
        {allOpen ? (
          <Box flexDirection="column" gap="xs">
            {ordered(plan).map(st => (
              <Box key={`st-${st.num}`} flexDirection="row" gap="sm" alignItems="center" justifyContent="space-between">
                <Text size="caption" weight={cur && st.num === cur.num ? 'medium' : 'regular'} dimColor={!(cur && st.num === cur.num)}>
                  {st.num} · {st.title}
                </Text>
                <Box flexDirection="row" gap="sm" alignItems="center">
                  <Bar pct={stagePct(st)} color={GRAY} w={60} thick={3} />
                  <Text size="caption" dimColor>{stagePct(st)}%</Text>
                </Box>
              </Box>
            ))}
          </Box>
        ) : null}
      </Box>
    )
  })

  // Большая панель «Роадмап»: все этапы, у каждого шага «+ Сегодня» и «В сеанс».
  on('ui.render', { component: 'Pane', requestId: ROAD }, async ($, e) => {
    const { els, Bar, me } = await kit($, e)
    const { Box, Text, Button, Link } = els
    const data = await read($, loaded)
    if (!data || data.status !== 'ok') {
      return (
        <Box padding="sm">
          <Text dimColor>Нет {FILE} в этом проекте.</Text>
        </Box>
      )
    }
    const plan: Plan = data.plan
    const filter = await read($, roadFilter)
    const opened = await read($, openStages)
    const cur = currentStage(plan)
    const stages = ordered(plan).filter(s =>
      filter === '1' ? /запуск\s*1/i.test(s.launch) : filter === '2' ? /запуск\s*2/i.test(s.launch) : true,
    )
    const sum = sumSteps(stages)
    const web = filter === '1' ? plan.roadmap1 : plan.roadmap
    const setFilter = (f: string) => update($, roadFilter, () => f)

    return (
      <Box flexDirection="column" gap="md" padding="sm">
        <Box flexDirection="row" justifyContent="space-between" alignItems="center">
          <Text size="caption" dimColor>Роадмап · {plan.project}</Text>
          <Box flexDirection="row" gap="sm" alignItems="center">
            {plan.refresh ? <Button key="refresh-road" label="↻ Обновить" onPress={() => refresh($, plan)} /> : null}
            {web ? <Link href={appLink(web)} label="Красивая страница ↗">Красивая страница ↗</Link> : null}
          </Box>
        </Box>
        <Box flexDirection="row" gap="sm">
          <Button key="f-all" plain dimColor={filter !== 'all'} label="Весь продукт" onPress={() => setFilter('all')} />
          <Button key="f-1" plain dimColor={filter !== '1'} label="Запуск 1" onPress={() => setFilter('1')} />
          <Button key="f-2" plain dimColor={filter !== '2'} label="Запуск 2" onPress={() => setFilter('2')} />
        </Box>
        <Box flexDirection="column" gap="xs">
          <Box flexDirection="row" gap="sm" alignItems="flex-end">
            <Text size="title" weight="medium" color={filter === 'all' ? undefined : 'suggestion'}>{sum.pct}%</Text>
            <Text size="footnote" dimColor>сделано {sum.done} из {sum.total} · осталось {sum.total - sum.done}</Text>
          </Box>
          <Bar pct={sum.pct} color={filter === 'all' ? GRAY : BLUE} />
        </Box>
        <Text size="caption" dimColor>«+ Сегодня» — в план на день для всех сеансов. «В сеанс» — задача этого сеанса.</Text>
        {stages.map(st => {
          const open = opened.includes(st.num)
          const d = st.steps.filter(s => s.isDone).length
          return (
            <Box key={`rs-${st.num}`} flexDirection="column" gap="sm">
              <Box flexDirection="row" justifyContent="space-between" alignItems="center">
                <Button
                  key={`ro-${st.num}`}
                  plain
                  onPress={() => update($, openStages, list => (list.includes(st.num) ? list.filter(n => n !== st.num) : [...list, st.num]))}
                >
                  <Text weight={cur && cur.num === st.num ? 'medium' : 'regular'}>
                    {open ? '˄' : '˅'} {st.num} · {st.title}
                    {cur && cur.num === st.num ? <Text size="caption" color="suggestion"> · сейчас</Text> : null}
                  </Text>
                </Button>
                <Text size="caption" dimColor>
                  {d} из {st.steps.length} · {stagePct(st)}%
                </Text>
              </Box>
              <Bar pct={stagePct(st)} color={cur && cur.num === st.num ? BLUE : GRAY} thick={3} />
              {open ? (
                <Box flexDirection="column" gap="sm">
                  {st.steps.map((s, i) => (s.isDone ? null : StepRow($, els, plan, me, st, s, i, 'r')))}
                  {d ? <Text size="caption" dimColor>Сделано · {d}</Text> : null}
                </Box>
              ) : null}
            </Box>
          )
        })}
      </Box>
    )
  })
}
