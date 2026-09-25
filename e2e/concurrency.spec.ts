import { expect, test } from '@playwright/test'
import {
  ConcurrencyController,
  type Action,
  type ConcurrencyPolicy
} from '../src/main/download/concurrency'

// M. How many streams each network runs. The controller is pure, so it's driven here against
// models of what limits a download — the server, the link, an uplink two networks share — and
// judged by where it settles.

const MB = 1e6
const POLICY: ConcurrencyPolicy = {
  maxPerNetwork: 16,
  windowMs: 2000,
  warmupMs: 2000,
  minGain: 0.15
}
const TICK_MS = 500

/** Bytes per second each network delivers, given how many streams each runs. */
type Model = (streams: Map<string, number>) => Map<string, number>

interface Run {
  streams: Map<string, number>
  /** Most streams each network had at once. */
  peak: Map<string, number>
  actions: Action[]
}

function simulate(
  model: Model,
  networks: string[],
  options: {
    seconds?: number
    spareWork?: number
    failing?: (id: string, streams: number) => boolean
  } = {}
): Run {
  const { seconds = 120, spareWork = 1000, failing = () => false } = options
  const controller = new ConcurrencyController(POLICY)
  const streams = new Map(networks.map((id) => [id, 4]))
  const peak = new Map(streams)
  const received = new Map(networks.map((id) => [id, 0]))
  const actions: Action[] = []
  let retiring = 0
  for (let now = 0; now <= seconds * 1000; now += TICK_MS) {
    const rates = model(streams)
    for (const id of networks)
      received.set(id, received.get(id)! + (rates.get(id)! * TICK_MS) / 1000)
    const action = controller.tick({
      now,
      networks: networks.map((id) => ({
        id,
        streams: streams.get(id)!,
        received: received.get(id)!,
        failing: failing(id, streams.get(id)!)
      })),
      spareWork,
      retiring
    })
    // Retired streams finish their block and are gone by the next look.
    retiring = 0
    if (!action) continue
    actions.push(action)
    const change = action.kind === 'add' ? action.count : -action.count
    streams.set(action.networkId, streams.get(action.networkId)! + change)
    peak.set(
      action.networkId,
      Math.max(peak.get(action.networkId)!, streams.get(action.networkId)!)
    )
    if (action.kind === 'retire') retiring = action.count
  }
  return { streams, peak, actions }
}

/** Each connection gets at most `perStream`, and the link at most `link`. */
const capped =
  (perStream: number, link: number): Model =>
  (streams) =>
    new Map([...streams].map(([id, count]) => [id, Math.min(count * perStream, link)]))

test.describe('stream count', () => {
  test('a server that caps each connection gets more of them, up to the limit', () => {
    const { streams, actions } = simulate(capped(1 * MB, 1000 * MB), ['a'])
    expect(streams.get('a')).toBe(16)
    // Doubling: two steps, not twelve.
    expect(actions).toEqual([
      { kind: 'add', networkId: 'a', count: 4 },
      { kind: 'add', networkId: 'a', count: 8 }
    ])
  })

  test('a full link keeps what it started with: the extra streams are tried, then retired', () => {
    const { streams, peak } = simulate(capped(10 * MB, 20 * MB), ['a'])
    expect(peak.get('a')).toBe(8)
    expect(streams.get('a')).toBe(4)
  })

  test('grows while it pays and stops where it stops paying', () => {
    // 4 streams: 4 MB/s. 8: 8 MB/s. 16 would be the 10 MB/s link: +25%, which still pays.
    expect(simulate(capped(1 * MB, 10 * MB), ['a']).streams.get('a')).toBe(16)
    // A 9 MB/s link: 16 streams would add 1 MB/s to 8, under the 15% a step has to earn.
    expect(simulate(capped(1 * MB, 9 * MB), ['a']).streams.get('a')).toBe(8)
  })

  test('streams that only take speed from a network sharing the same uplink are retired', () => {
    // Two networks behind one 8 MB/s uplink, each connection good for 1 MB/s.
    const sharedUplink: Model = (streams) => {
      const total = [...streams.values()].reduce((sum, count) => sum + count, 0)
      const delivered = Math.min(total * MB, 8 * MB)
      return new Map([...streams].map(([id, count]) => [id, (delivered * count) / total]))
    }
    const { streams, peak } = simulate(sharedUplink, ['wifi', 'ethernet'])
    expect(peak.get('wifi')).toBe(8)
    expect(peak.get('ethernet')).toBe(8)
    expect(streams).toEqual(
      new Map([
        ['wifi', 4],
        ['ethernet', 4]
      ])
    )
  })

  test("a slow network's real gain counts, however fast the network beside it", () => {
    const model: Model = (streams) =>
      new Map([
        ['ethernet', Math.min(streams.get('ethernet')! * 50 * MB, 100 * MB)],
        ['cellular', streams.get('cellular')! * 0.25 * MB]
      ])
    const { streams } = simulate(model, ['ethernet', 'cellular'])
    // Cellular's doubling is a 1 MB/s gain against 100 MB/s in total, and it is kept all the same.
    expect(streams.get('cellular')).toBe(16)
    expect(streams.get('ethernet')).toBe(4)
  })

  test('networks take turns', () => {
    const { actions } = simulate(capped(1 * MB, 1000 * MB), ['a', 'b'])
    expect(actions.map((action) => action.networkId)).toEqual(['a', 'b', 'a', 'b'])
  })

  test('new streams that fail are retired at once, and the network grows no further', () => {
    // The server turns away anything past the first four connections.
    const { streams, actions } = simulate(capped(1 * MB, 1000 * MB), ['a'], {
      failing: (_id, count) => count > 4
    })
    expect(streams.get('a')).toBe(4)
    expect(actions).toEqual([
      { kind: 'add', networkId: 'a', count: 4 },
      { kind: 'retire', networkId: 'a', count: 4 }
    ])
  })

  test('no growth without waiting blocks for the new streams to take', () => {
    expect(simulate(capped(1 * MB, 1000 * MB), ['a'], { spareWork: 0 }).actions).toEqual([])
    // Room for two more: the step is cut to fit.
    expect(simulate(capped(1 * MB, 1000 * MB), ['a'], { spareWork: 2 }).actions[0]).toEqual({
      kind: 'add',
      networkId: 'a',
      count: 2
    })
  })

  test('a network delivering nothing is not grown', () => {
    const { actions } = simulate(() => new Map([['a', 0]]), ['a'])
    expect(actions).toEqual([])
  })
})
