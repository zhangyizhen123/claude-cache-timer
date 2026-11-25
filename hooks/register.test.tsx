import { expect, test } from 'claude-code/testing'

const T0 = 1_700_000_000_000

const HINT = {
  plugin: 'cache-timer',
  component: 'SessionMode',
  props: { modes: [] as string[] },
} as const

function usage(w5: number, w1: number) {
  return {
    input_tokens: 10,
    output_tokens: 10,
    cache_read_input_tokens: 5000,
    cache_creation_input_tokens: w5 + w1,
    ephemeral_5m_input_tokens: w5,
    ephemeral_1h_input_tokens: w1,
    model: 'claude-opus-5-5',
  }
}

/** 模拟引擎：时钟返回 clock.t，模型回复带指定的缓存写入，然后跑一次请求。 */
async function setup($: any, on: any, w5: number, w1: number) {
  const clock = { t: T0 }
  on('clock.now', () => ({ value: clock.t }))
  on('turn.step', async function* () {
    return {
      turnId: 't',
      index: 0,
      answer: '',
      toolUses: [],
      stopReason: 'end_turn' as const,
      usage: usage(w5, w1),
    }
  })
  const s = $.turn.step({ turnId: 't', index: 0, model: 'opus', messageCount: 3 })
  for await (const _ of s) {
    // drain
  }
  await s.result
  return clock
}

/** 进度条：[彩色格数, 灰色格数]。 */
async function bar(ui: any): Promise<[number, number]> {
  const all = await ui.findAll({ type: 'Text', text: /^━+$/ })
  let on = 0
  let off = 0
  for (const t of all) {
    if (t.props.dimColor) off += t.text.length
    else on += t.text.length
  }
  return [on, off]
}

async function texts(ui: any): Promise<string> {
  return (await ui.findAll({ type: 'Text' })).map((t: any) => t.text.trim()).join(' | ')
}

for (const surface of ['desktop', 'terminal'] as const) {
  test(`${surface}：1 小时缓存满格，只显示时间`, async ($, on) => {
    await setup($, on, 0, 800)
    const ui = await $.ui.mount({ ...HINT, surface })
    expect(await bar(ui)).toEqual([5, 0])
    expect(await texts(ui)).toMatch(/\| 60:00$/)
    await ui.unmount()
  })
}

test('超额模式：标出 5m', async ($, on) => {
  await setup($, on, 800, 0)
  const ui = await $.ui.mount({ ...HINT, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^ 5:00 5m $/ })).toBeDefined()
  await ui.unmount()
})

test('过了一半时进度条剩一半', async ($, on) => {
  const clock = await setup($, on, 0, 800)
  clock.t = T0 + 1_800_000
  const ui = await $.ui.mount({ ...HINT, surface: 'desktop' })
  expect(await bar(ui)).toEqual([3, 2])
  expect(await ui.find({ type: 'Text', text: /30:00/ })).toBeDefined()
  await ui.unmount()
})

test('快过期时变黄', async ($, on) => {
  const clock = await setup($, on, 0, 800)
  clock.t = T0 + 3_400_000
  const ui = await $.ui.mount({ ...HINT, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /3:20/ }))?.props.color).toBe('warning')
  await ui.unmount()
})

test('过期后显示 COLD 和全灰的条', async ($, on) => {
  const clock = await setup($, on, 800, 0)
  clock.t = T0 + 301_000
  const ui = await $.ui.mount({ ...HINT, surface: 'desktop' })
  expect(await bar(ui)).toEqual([0, 5])
  expect((await ui.find({ type: 'Text', text: /COLD/ }))?.props.color).toBe('error')
  await ui.unmount()
})

test('还没有请求时显示占位', async $ => {
  const ui = await $.ui.mount({ ...HINT, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /--:--/ })).toBeDefined()
  await ui.unmount()
})

test('引擎自己的模式标签保留在后面', async ($, on) => {
  on('ui.render', ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)
    return <Text>focus</Text>
  })
  await setup($, on, 0, 800)
  const ui = await $.ui.mount({ ...HINT, props: { modes: ['focus'] }, surface: 'desktop' })
  expect(await texts(ui)).toMatch(/60:00 \| focus$/)
  await ui.unmount()
})

test('选项 showBar=false 时只显示时间', { options: { showBar: false } }, async ($, on) => {
  await setup($, on, 0, 800)
  const ui = await $.ui.mount({ ...HINT, surface: 'desktop' })
  expect(await bar(ui)).toEqual([0, 0])
  expect(await ui.find({ type: 'Text', text: /60:00/ })).toBeDefined()
  await ui.unmount()
})
