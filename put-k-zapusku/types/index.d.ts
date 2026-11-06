export type Tag = 'горит' | 'ждёт' | 'решение' | 'клод' | 'потом'
export type Zone = 'n8n' | 'сервер'

export type Step = {
  text: string
  isDone: boolean
  isInWork: boolean
  tag: Tag | null
  isToday: boolean
  zone: Zone | null
  owner: string | null
}

export type Stage = { num: number; title: string; launch: string; steps: Step[] }

export type Plan = {
  project: string
  launch1: string
  launch2: string
  roadmap: string
  roadmap1: string
  refresh: string
  queue: number[]
  approved: string
  today: string
  stages: Stage[]
}

export type Loaded =
  | { status: 'ok'; plan: Plan; path: string }
  | { status: 'missing'; cwd: string }
  | { status: 'error'; message: string }

export type Goal = { title: string; stage: number; done: number; total: number; next: string }

declare module 'claude-code' {
  interface PluginState {
    'put-k-zapusku': {
      loaded: Shaped<Loaded | null>
      goal: Shaped<Goal | null>
      sid: Shaped<string>
      openStages: Shaped<number[]>
      roadFilter: Shaped<string>
      isMini: boolean
      isStageOpen: boolean
      isAllOpen: boolean
    }
  }
}
