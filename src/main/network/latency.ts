import { connect } from 'node:net'
import type { NetworkInterfaceInfo } from '../../shared/types'

const PROBE_HOST = '1.1.1.1'
const PROBE_PORT = 443
const TIMEOUT_MS = 2000

/** Rough per-interface latency: time to open a TCP connection to a reliable
 * host, sourced from that interface's local address. null means unreachable. */
function measureLatency(localAddress: string): Promise<number | null> {
  return new Promise((resolve) => {
    const start = Date.now()
    const socket = connect({ host: PROBE_HOST, port: PROBE_PORT, localAddress, family: 4 })
    let settled = false

    const finish = (result: number | null): void => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(result)
    }

    socket.setTimeout(TIMEOUT_MS)
    socket.once('connect', () => finish(Date.now() - start))
    socket.once('timeout', () => finish(null))
    socket.once('error', () => finish(null))
  })
}

export async function measureLatencies(
  interfaces: NetworkInterfaceInfo[]
): Promise<Record<string, number | null>> {
  const entries = await Promise.all(
    interfaces.map(async (iface) => [iface.id, await measureLatency(iface.address)] as const)
  )
  return Object.fromEntries(entries)
}
