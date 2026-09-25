// How many streams each network runs, decided while the download runs from what it measures.
//
// Another connection only helps when something limits each connection on its own — a server
// that caps a connection's speed, or TCP on a long or lossy path — and not once the network
// itself is full. Nothing outside says which, so the controller finds out the one way it can:
// it adds streams to a network and keeps them if the download got faster.
//
// - One network at a time, doubling its streams (4 → 8 → 16): the answer in a couple of steps.
// - A step is kept when total speed rose by at least `minGain` of what that network was doing
//   before it. Total, because two networks can share one uplink, and streams that only take
//   speed from the other network gain nothing. The network's own speed as the yardstick,
//   because a slow cellular link's real gain would otherwise vanish in a fast Ethernet's noise.
// - A step that doesn't pay is undone — its streams retire once their block is done — and that
//   network grows no further. Nor does one whose new streams fail: the server's way of saying
//   it wants fewer connections.
//
// No I/O and no clock of its own: it reads a snapshot and says what to do, so every rule can be
// checked against exact situations.

export interface NetworkSnapshot {
  id: string
  /** Its streams, not counting any retiring. */
  streams: number
  /** Everything its streams have received, ever. */
  received: number
  /** One of its streams is failing: retrying, or given up. */
  failing: boolean
}

export interface Snapshot {
  now: number
  networks: readonly NetworkSnapshot[]
  /** How many more streams the waiting blocks could keep busy. */
  spareWork: number
  /** Streams still winding down after a step that didn't pay. */
  retiring: number
}

export type Action = { kind: 'add' | 'retire'; networkId: string; count: number }

export interface ConcurrencyPolicy {
  maxPerNetwork: number
  /** How long each measurement runs. */
  windowMs: number
  /** How long streams get to connect and reach speed before they're measured. */
  warmupMs: number
  /** The least a step must add to total speed, as a share of its network's speed before it. */
  minGain: number
}

/** Bytes per second, overall and per network. */
interface Rates {
  total: number
  byNetwork: Map<string, number>
}

interface Mark {
  at: number
  received: Map<string, number>
}

type Phase =
  /** Letting streams reach speed before anything is measured. */
  | { kind: 'wait'; until: number }
  /** Measuring the streams as they are. */
  | { kind: 'measure'; from: Mark }
  /** Streams were just added to `networkId`; letting them connect and reach speed. */
  | { kind: 'warmup'; networkId: string; added: number; before: Rates; until: number }
  /** Measuring whether they paid. */
  | { kind: 'trial'; networkId: string; added: number; before: Rates; from: Mark }
  /** No network can grow any more. */
  | { kind: 'done' }

const mark = ({ now, networks }: Snapshot): Mark => ({
  at: now,
  received: new Map(networks.map((network) => [network.id, network.received]))
})

function ratesSince(from: Mark, { now, networks }: Snapshot): Rates {
  const seconds = Math.max(now - from.at, 1) / 1000
  const byNetwork = new Map<string, number>()
  let total = 0
  for (const network of networks) {
    const rate = (network.received - (from.received.get(network.id) ?? 0)) / seconds
    byNetwork.set(network.id, rate)
    total += rate
  }
  return { total, byNetwork }
}

export class ConcurrencyController {
  private phase: Phase | null = null
  /** Networks that grow no further. */
  private readonly settled = new Set<string>()
  /** Where the next look for a network to grow starts, so each gets its turn. */
  private next = 0

  constructor(private readonly policy: ConcurrencyPolicy) {}

  tick(snapshot: Snapshot): Action | undefined {
    const { policy } = this
    const phase = (this.phase ??= { kind: 'wait', until: snapshot.now + policy.warmupMs })
    switch (phase.kind) {
      case 'wait':
        if (snapshot.now >= phase.until) this.phase = { kind: 'measure', from: mark(snapshot) }
        return undefined

      case 'measure':
        // Streams on their way out would count towards a speed that's about to drop.
        if (snapshot.retiring > 0) {
          this.phase = { kind: 'measure', from: mark(snapshot) }
          return undefined
        }
        if (snapshot.now - phase.from.at < policy.windowMs) return undefined
        return this.grow(snapshot, ratesSince(phase.from, snapshot))

      case 'warmup':
        if (this.failing(snapshot, phase.networkId)) return this.undo(snapshot, phase)
        if (snapshot.now >= phase.until) {
          const { networkId, added, before } = phase
          this.phase = { kind: 'trial', networkId, added, before, from: mark(snapshot) }
        }
        return undefined

      case 'trial': {
        if (this.failing(snapshot, phase.networkId)) return this.undo(snapshot, phase)
        if (snapshot.now - phase.from.at < policy.windowMs) return undefined
        const after = ratesSince(phase.from, snapshot)
        const networkBefore = phase.before.byNetwork.get(phase.networkId) ?? 0
        if (after.total - phase.before.total < policy.minGain * networkBefore) {
          return this.undo(snapshot, phase)
        }
        // Kept: what was just measured is where the next step starts from.
        return this.grow(snapshot, after)
      }

      case 'done':
        return undefined
    }
  }

  /** Adds streams to the next network that can take them, or measures again if none can yet. */
  private grow(snapshot: Snapshot, before: Rates): Action | undefined {
    const { networks, spareWork } = snapshot
    let canGrowLater = false
    for (let i = 0; i < networks.length; i++) {
      const index = (this.next + i) % networks.length
      const network = networks[index]
      if (this.settled.has(network.id) || network.streams >= this.policy.maxPerNetwork) continue
      canGrowLater = true
      const count = Math.min(
        network.streams,
        this.policy.maxPerNetwork - network.streams,
        spareWork
      )
      // A network delivering nothing has no speed to improve on.
      if (network.failing || count < 1 || !((before.byNetwork.get(network.id) ?? 0) > 0)) continue

      this.next = (index + 1) % networks.length
      this.phase = {
        kind: 'warmup',
        networkId: network.id,
        added: count,
        before,
        until: snapshot.now + this.policy.warmupMs
      }
      return { kind: 'add', networkId: network.id, count }
    }
    this.phase = canGrowLater ? { kind: 'measure', from: mark(snapshot) } : { kind: 'done' }
    return undefined
  }

  private undo(snapshot: Snapshot, phase: Extract<Phase, { kind: 'warmup' | 'trial' }>): Action {
    this.settled.add(phase.networkId)
    this.phase = { kind: 'measure', from: mark(snapshot) }
    return { kind: 'retire', networkId: phase.networkId, count: phase.added }
  }

  private failing(snapshot: Snapshot, networkId: string): boolean {
    return snapshot.networks.find((network) => network.id === networkId)?.failing ?? true
  }
}
