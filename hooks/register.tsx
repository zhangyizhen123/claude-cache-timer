import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, TurnUsage } from 'claude-code'

import type { CacheMark } from '../types'

const last = atom({ plugin: 'cache-timer', key: 'last' } as const, null, {
  shape: 'mark-1',
})

const TTL_MS = { '5m': 300_000, '1h': 3_600_000 } as const
// 剩余多少时提醒一次：1 小时缓存提前 5 分钟，5 分钟缓存提前 1 分钟
const WARN_MS = { '5m': 60_000, '1h': 300_000 } as const

/** 从一次响应的用量判断这次写入的缓存时长；只读未写时沿用上一次的。 */
function ttlOf(usage: TurnUsage, previous: CacheMark | null): CacheMark['ttl'] | null {
  const w5 = usage.ephemeral_5m_input_tokens ?? 0
  const w1 = usage.ephemeral_1h_input_tokens ?? 0
  // 两种都写了时，以短的为准
  if (w5 > 0) return '5m'
  if (w1 > 0) return '1h'
  if (usage.cache_creation_input_tokens > 0) return '5m'
  if (usage.cache_read_input_tokens > 0) return previous?.ttl ?? '5m'
  return null
}

type Tone = 'success' | 'warning' | 'error'
const BAR_W = 5
const BAR_CH = '━'

function clock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

type Lang = 'zh' | 'en'

const TEXT = {
  zh: {
    cold: '❄️ 缓存已过期（COLD）：下一条消息会慢一点、多耗些额度',
    warn: (t: string) => `⏳ 缓存还剩 ${t}，要继续就趁现在发消息`,
  },
  en: {
    cold: '❄️ Prompt cache expired (COLD): the next message will be slower and use more quota',
    warn: (t: string) => `⏳ Prompt cache expires in ${t} — send a message now to keep it warm`,
  },
} as const

/** 把一段语言描述（设置值或界面文字）认成中文或英文；认不出返回 null。 */
function langOf(text: unknown): Lang | null {
  if (typeof text !== 'string' || text.trim() === '') return null
  if (/[一-鿿]|chinese|^zh/i.test(text)) return 'zh'
  if (/english|^en/i.test(text)) return 'en'
  return null
}

/** 计时器要读写的状态，放在 register 里创建，传给顶层的 startTicker。 */
type Ctx = {
  ticking: boolean
  warnedFor: number
  coldFor: number
  fixed: Lang | null
  fromSettings: Lang | null
}

function langNow(ctx: Ctx): Lang {
  return ctx.fixed ?? ctx.fromSettings ?? 'en'
}

/**
 * 每秒刷新一次并检查是否该提醒。由第一个拿到 $ 的钩子启动，只启动一次：
 * 不依赖 session.start，这样它没跑或出错时，倒计时也会在第一次回复后出现。
 */
function startTicker($: EngineInterface, ctx: Ctx): void {
  if (ctx.ticking) return
  ctx.ticking = true
  if (ctx.fixed === null) {
    void $.settings
      .read({ key: 'language' })
      .then(v => {
        ctx.fromSettings = langOf(v)
      })
      .catch(() => {})
  }
  $.clock.every(1000, () => {
    void (async () => {
      $.ui.invalidate('ui.render')
      const mark = await read($, last)
      if (mark === null) return
      const left = mark.at + TTL_MS[mark.ttl] - (await $.clock.now())
      if (left <= 0 && ctx.coldFor !== mark.at) {
        ctx.coldFor = mark.at
        $.ui.toast(TEXT[langNow(ctx)].cold)
      } else if (left > 0 && left <= WARN_MS[mark.ttl] && ctx.warnedFor !== mark.at) {
        ctx.warnedFor = mark.at
        $.ui.toast(TEXT[langNow(ctx)].warn(clock(left)), { timeoutMs: 8000 })
      }
    })().catch(() => {})
  })
}

export const register: Register = (on, options) => {
  // 语言：插件选项 zh/en 优先；auto 时看 Claude Code 的 language 设置；都没有就用英文
  const ctx: Ctx = {
    ticking: false,
    warnedFor: 0,
    coldFor: 0,
    fixed: langOf(String(options?.language ?? 'auto')),
    fromSettings: null,
  }
  // 选项：是否在时间前面画进度条，默认画
  const showBar = options?.showBar !== false
  // 主对话有请求正在进行时为 true（显示 HOT）
  let working = false

  on('session.start', async ($, e, next) => {
    try {
      startTicker($, ctx)
    } catch {
      ctx.ticking = false
    }
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    // 子代理有自己的缓存，不影响主对话
    if (e.agentId !== undefined) return yield* next(e)

    try {
      startTicker($, ctx)
    } catch {
      ctx.ticking = false
    }
    const at = await $.clock.now()
    working = true
    $.ui.invalidate('ui.render')
    let result
    try {
      result = yield* next(e)
    } finally {
      working = false
    }

    if (result.usage !== null) {
      const usage = result.usage
      await update($, last, previous => {
        const ttl = ttlOf(usage, previous)
        return ttl === null ? previous : { at, ttl }
      })
    }
    $.ui.invalidate('ui.render')

    return result
  })

  // 画在输入框下方那一行右侧的状态标签区（挨着模型和权限），引擎自己的标签接在后面
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const engine = await next(e)
    const { Box, Text } = $.ui.resolve(e)
    const mark = await read($, last)

    if (mark === null) {
      return (
        <Box flexDirection="row" alignItems="center" gap={1}>
          <Text dimColor>⏱ --:--</Text>
          {engine}
        </Box>
      )
    }

    const left = mark.at + TTL_MS[mark.ttl] - (await $.clock.now())
    // 只在超额模式（5 分钟）时标出来，平常的 1 小时不占地方
    const tag = mark.ttl === '5m' ? ' 5m' : ''

    let ratio: number
    let tone: Tone
    let caption: string
    if (working) {
      ratio = 1
      tone = 'success'
      caption = `HOT${tag}`
    } else if (left <= 0) {
      ratio = 0
      tone = 'error'
      caption = 'COLD'
    } else {
      ratio = left / TTL_MS[mark.ttl]
      tone = left <= WARN_MS[mark.ttl] ? 'warning' : 'success'
      caption = `${clock(left)}${tag}`
    }

    // 这个标签区在桌面版只画文字（SVG 会被丢掉），所以进度条用粗横线字符拼：
    // 剩下的部分用状态色，用掉的部分灰色
    const filled = Math.round(Math.min(1, Math.max(0, ratio)) * BAR_W)
    return (
      <Box flexDirection="row" alignItems="center">
        {showBar && filled > 0 && <Text color={tone}>{BAR_CH.repeat(filled)}</Text>}
        {showBar && filled < BAR_W && (
          <Text dimColor>{BAR_CH.repeat(BAR_W - filled)}</Text>
        )}
        <Text color={tone}> {caption} </Text>
        {engine}
      </Box>
    )
  })
}
