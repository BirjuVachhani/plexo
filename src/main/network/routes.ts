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

export async function resolveTarget(
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
  const routes = routesFor(iface, await resolveTarget(target, resolveHost))
  if (routes.length === 0) throw new NoCompatibleRouteError(targetHost(target))
  const deadline = Date.now() + timeoutMs
  let lastError: Error = new Error('Connection failed')

  for (const route of routes) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const remaining = deadline - Date.now()
    if (remaining <= 0) break

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
            clearTimeout(timer)
            signal?.removeEventListener('abort', onAbort)
            resolve({ req, res, sentAt })
          }
        )
        const onAbort = (): void => {
          req.destroy(new DOMException('Aborted', 'AbortError'))
        }
        const timer = setTimeout(
          () => req.destroy(new Error('Connection stalled: no response from server')),
          remaining
        )
        req.once('error', (error) => {
          clearTimeout(timer)
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
