import { lookup } from 'node:dns/promises'
import { request as httpRequest, type ClientRequest, type IncomingMessage } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { isIP } from 'node:net'
import type { IpFamily, NetworkInterfaceInfo } from '../../shared/types'
import { routeFrom } from './deviceBinding'

export interface NetworkRoute {
  device: string
  localAddress: string
  remoteAddress: string
  family: IpFamily
}

export type RemoteAddress = { address: string; family: IpFamily }

/** URL.hostname brackets IPv6 literals; sockets and isIP expect the unbracketed address. */
export function targetHost(target: URL): string {
  return target.hostname.replace(/^\[|\]$/g, '')
}

async function resolveTarget(
  target: URL,
  resolveHost: (host: string) => Promise<RemoteAddress[]> = async (host) =>
    (await lookup(host, { all: true, order: 'verbatim' })) as RemoteAddress[]
): Promise<RemoteAddress[]> {
  const host = targetHost(target)
  const literalFamily = isIP(host)
  if (literalFamily) return [{ address: host, family: literalFamily as IpFamily }]
  return resolveHost(host)
}

/** Preserve DNS and OS address order; each route always has matching IP families. */
export function routesFor(
  iface: NetworkInterfaceInfo,
  remoteAddresses: RemoteAddress[]
): NetworkRoute[] {
  return remoteAddresses.flatMap((remote) =>
    iface.addresses
      .filter((local) => local.family === remote.family)
      .map((local) => ({
        device: iface.device,
        localAddress: local.address,
        remoteAddress: remote.address,
        family: remote.family
      }))
  )
}

export function compatibleInterfaces(
  interfaces: NetworkInterfaceInfo[],
  remoteAddresses: RemoteAddress[]
): NetworkInterfaceInfo[] {
  return interfaces.filter((iface) => routesFor(iface, remoteAddresses).length > 0)
}

export class NoCompatibleRouteError extends Error {
  constructor(host: string) {
    super(`No selected network has an address compatible with ${host}`)
  }
}

/** DNS is part of opening a request, so it must not outlive the request's deadline. */
export function resolveTargetWithin(
  target: URL,
  timeoutMs: number,
  signal?: AbortSignal,
  resolveHost?: (host: string) => Promise<RemoteAddress[]>
): Promise<RemoteAddress[]> {
  return new Promise((resolve, reject) => {
    let done = false
    const finish = (complete: () => void): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      complete()
    }
    const onAbort = (): void => finish(() => reject(new DOMException('Aborted', 'AbortError')))
    const timer = setTimeout(
      () => finish(() => reject(new Error('Could not resolve the download host in time'))),
      timeoutMs
    )
    if (signal?.aborted) return onAbort()
    signal?.addEventListener('abort', onAbort, { once: true })
    void resolveTarget(target, resolveHost).then(
      (addresses) => finish(() => resolve(addresses)),
      (error) => finish(() => reject(error))
    )
  })
}

/** Try another compatible route only if no response headers have arrived yet. */
interface RequestOptions {
  target: URL
  iface: NetworkInterfaceInfo
  headers: Record<string, string>
  signal?: AbortSignal
  timeoutMs: number
  /** Test seam for an AAAA-only hostname without modifying system DNS. */
  resolveHost?: (host: string) => Promise<RemoteAddress[]>
}

export async function requestOnInterface({
  target,
  iface,
  headers,
  signal,
  timeoutMs,
  resolveHost
}: RequestOptions): Promise<{ req: ClientRequest; res: IncomingMessage; sentAt: number }> {
  const deadline = Date.now() + timeoutMs
  const routes = routesFor(iface, await resolveTargetWithin(target, timeoutMs, signal, resolveHost))
  if (routes.length === 0) throw new NoCompatibleRouteError(targetHost(target))
  let lastError: Error = new Error('Connection failed')

  for (const [index, route] of routes.entries()) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const remaining = deadline - Date.now()
    if (remaining <= 0) break
    // A stale address gets a short connection window, but a connected server keeps
    // the full remaining time to send headers. The final route gets all that remains.
    const connectTimeout =
      index === routes.length - 1 ? remaining : Math.min(3_000, Math.max(1, remaining / 2))

    try {
      return await new Promise((resolve, reject) => {
        const requester = target.protocol === 'https:' ? httpsRequest : httpRequest
        const sentAt = Date.now()
        const req = requester(
          {
            method: 'GET',
            hostname: targetHost(target),
            path: `${target.pathname}${target.search}`,
            headers,
            ...routeFrom(route, target)
          },
          (res) => {
            clearTimers()
            signal?.removeEventListener('abort', onAbort)
            resolve({ req, res, sentAt })
          }
        )
        const onAbort = (): void => {
          req.destroy(new DOMException('Aborted', 'AbortError'))
        }
        const connected = (): void => clearTimeout(connectTimer)
        const connectionEvent = target.protocol === 'https:' ? 'secureConnect' : 'connect'
        let socket: ClientRequest['socket']
        const clearTimers = (): void => {
          clearTimeout(connectTimer)
          clearTimeout(responseTimer)
          socket?.removeListener(connectionEvent, connected)
        }
        const connectTimer = setTimeout(
          () => req.destroy(new Error('Connection stalled: could not connect')),
          connectTimeout
        )
        const responseTimer = setTimeout(
          () => req.destroy(new Error('Connection stalled: no response from server')),
          remaining
        )
        req.once('socket', (assignedSocket) => {
          socket = assignedSocket
          if (req.reusedSocket) connected()
          else socket.once(connectionEvent, connected)
        })
        req.once('error', (error) => {
          clearTimers()
          signal?.removeEventListener('abort', onAbort)
          reject(error)
        })
        signal?.addEventListener('abort', onAbort, { once: true })
        req.end()
      })
    } catch (error) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      lastError = error instanceof Error ? error : new Error(String(error))
    }
  }
  throw lastError
}
