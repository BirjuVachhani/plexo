import { lookup } from 'node:dns/promises'
import {
  Agent as HttpAgent,
  request as httpRequest,
  type ClientRequest,
  type ClientRequestArgs,
  type IncomingMessage
} from 'node:http'
import { Agent as HttpsAgent, request as httpsRequest } from 'node:https'
import { isIP, type Socket } from 'node:net'
import type { Duplex } from 'node:stream'
import type { IpFamily, NetworkInterfaceInfo } from '../../shared/types'
import { connectRoute } from './deviceBinding'

export interface NetworkRoute {
  device: string
  localAddress: string
  remoteAddress: string
  family: IpFamily
}

export type RemoteAddress = { address: string; family: IpFamily }

/** Test seam for an AAAA-only hostname without modifying system DNS. */
type ResolveHost = (host: string) => Promise<RemoteAddress[]>

/** URL.hostname brackets IPv6 literals; sockets and isIP expect the unbracketed address. */
export function targetHost(target: URL): string {
  return target.hostname.replace(/^\[|\]$/g, '')
}

async function resolveTarget(
  host: string,
  resolveHost: ResolveHost = async (name) =>
    (await lookup(name, { all: true, order: 'verbatim' })) as RemoteAddress[]
): Promise<RemoteAddress[]> {
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

/** DNS is part of opening a connection, so it must not outlive the connection's deadline. */
export function resolveTargetWithin(
  host: string,
  timeoutMs: number,
  signal?: AbortSignal,
  resolveHost?: ResolveHost
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
    const onAbort = (): void => finish(() => reject(abortError()))
    const timer = setTimeout(
      () => finish(() => reject(new Error('Could not resolve the download host in time'))),
      timeoutMs
    )
    if (signal?.aborted) return onAbort()
    signal?.addEventListener('abort', onAbort, { once: true })
    void resolveTarget(host, resolveHost).then(
      (addresses) => finish(() => resolve(addresses)),
      (error) => finish(() => reject(error))
    )
  })
}

const abortError = (): DOMException => new DOMException('Aborted', 'AbortError')

/**
 * A socket to `host` through `iface`, trying each compatible route in DNS order until one
 * completes its handshake. `secure` wraps the TCP socket in TLS before that point, so a route
 * whose TLS handshake never finishes is given up on just like one that never connects.
 */
async function connectOnInterface(
  iface: NetworkInterfaceInfo,
  host: string,
  port: number,
  secure: ((socket: Socket) => Socket) | null,
  timeoutMs: number,
  signal: AbortSignal,
  resolveHost?: ResolveHost
): Promise<Socket> {
  const deadline = Date.now() + timeoutMs
  const routes = routesFor(iface, await resolveTargetWithin(host, timeoutMs, signal, resolveHost))
  if (routes.length === 0) throw new NoCompatibleRouteError(host)
  let lastError: Error = new Error('Connection failed')

  for (const [index, route] of routes.entries()) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) break
    // A stale address gets a short window, so the next can still be tried; the last route gets
    // all that remains.
    const window =
      index === routes.length - 1 ? remaining : Math.min(3_000, Math.max(1, remaining / 2))
    const tcp = connectRoute(route, port)
    const socket = secure ? secure(tcp) : tcp
    try {
      await new Promise<void>((resolve, reject) => {
        const settle = (error?: Error): void => {
          clearTimeout(timer)
          signal.removeEventListener('abort', onAbort)
          socket.off(secure ? 'secureConnect' : 'connect', onConnected)
          socket.off('error', settle)
          tcp.off('error', settle)
          if (error) reject(error)
          else resolve()
        }
        const onConnected = (): void => settle()
        const onAbort = (): void => settle(abortError())
        const timer = setTimeout(
          () => settle(new Error('Connection stalled: could not connect')),
          window
        )
        socket.once(secure ? 'secureConnect' : 'connect', onConnected)
        // A refused TCP connection is reported on the raw socket, not always on its TLS wrapper.
        socket.once('error', settle)
        tcp.once('error', settle)
        if (signal.aborted) onAbort()
        else signal.addEventListener('abort', onAbort, { once: true })
      })
      return socket
    } catch (error) {
      socket.destroy()
      tcp.destroy()
      if (signal.aborted) throw abortError()
      lastError = error instanceof Error ? error : new Error(String(error))
    }
  }
  throw lastError
}

/** What a request passes its agent: Node hands a request's options to the agent's
 * createConnection, so a connection opened for a request can be dropped with it. */
type ConnectOptions = ClientRequestArgs & { connectSignal?: AbortSignal }

type Open = (
  options: ConnectOptions,
  secure: ((socket: Socket) => Socket) | null
) => Promise<Socket>

type OnCreate = (err: Error | null, stream: Duplex) => void

// Node's agents keep sockets alive and pool them; these only change how a new one is opened.
class RoutedHttpAgent extends HttpAgent {
  constructor(private readonly open: Open) {
    super({ keepAlive: true })
  }

  override createConnection(options: ConnectOptions, callback?: OnCreate): undefined {
    this.open(options, null).then(
      (socket) => callback?.(null, socket),
      (error: Error) => callback?.(error, undefined as never)
    )
    return undefined
  }
}

class RoutedHttpsAgent extends HttpsAgent {
  constructor(private readonly open: Open) {
    super({ keepAlive: true })
  }

  override createConnection(options: ConnectOptions, callback?: OnCreate): undefined {
    // The agent's own TLS setup, around our routed socket: it verifies the certificate against
    // the URL's host and caches the TLS session, so a reconnect resumes it instead of redoing
    // the full handshake.
    this.open(
      options,
      (socket) => super.createConnection({ ...options, socket } as ClientRequestArgs) as Socket
    ).then(
      (socket) => callback?.(null, socket),
      (error: Error) => callback?.(error, undefined as never)
    )
    return undefined
  }
}

export interface ResponseStart {
  req: ClientRequest
  res: IncomingMessage
  /** When the request was sent. */
  sentAt: number
}

/**
 * One download stream's connection to the server, through one network. Requests reuse a single
 * kept-alive socket, so a stream pays for DNS, the TCP and TLS handshakes and TCP slow start once
 * rather than on every block. A new socket is only opened when there is none to reuse: the first
 * request, after the server closes an idle one, or after an abort destroyed it, which is how a
 * stuck connection gets swapped for a fresh one.
 */
export class StreamConnection {
  private readonly lifetime = new AbortController()
  private readonly http: HttpAgent
  private readonly https: HttpsAgent

  constructor(
    readonly iface: NetworkInterfaceInfo,
    /** How long a request may take to get its response headers, connecting included. */
    private readonly timeoutMs: number,
    resolveHost?: ResolveHost
  ) {
    const open: Open = (options, secure) =>
      connectOnInterface(
        iface,
        options.host ?? '',
        Number(options.port),
        secure,
        timeoutMs,
        // Given up on when its request is, not only when the stream closes: a request abandoned
        // mid-connect (a stuck connection being replaced) shouldn't leave a handshake running.
        options.connectSignal
          ? AbortSignal.any([this.lifetime.signal, options.connectSignal])
          : this.lifetime.signal,
        resolveHost
      )
    this.http = new RoutedHttpAgent(open)
    this.https = new RoutedHttpsAgent(open)
  }

  request(
    target: URL,
    headers: Record<string, string>,
    signal?: AbortSignal
  ): Promise<ResponseStart> {
    return this.send(target, headers, signal, true)
  }

  /** Closes its sockets, and gives up on any still connecting. */
  close(): void {
    this.lifetime.abort()
    this.http.destroy()
    this.https.destroy()
  }

  private send(
    target: URL,
    headers: Record<string, string>,
    signal: AbortSignal | undefined,
    retryStale: boolean
  ): Promise<ResponseStart> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(abortError())
      const secure = target.protocol === 'https:'
      const sentAt = Date.now()
      let answered = false
      let timedOut = false
      const options: ConnectOptions = {
        method: 'GET',
        hostname: targetHost(target),
        port: target.port || undefined,
        path: `${target.pathname}${target.search}`,
        headers,
        agent: secure ? this.https : this.http,
        connectSignal: signal
      }
      const req = (secure ? httpsRequest : httpRequest)(options, (res) => {
        answered = true
        settle()
        resolve({ req, res, sentAt })
      })
      const onAbort = (): void => void req.destroy(abortError())
      const timer = setTimeout(() => {
        timedOut = true
        req.destroy(new Error('Connection stalled: no response from server'))
      }, this.timeoutMs)
      const settle = (): void => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
      }
      req.on('error', (error) => {
        if (answered) return // The response's owner handles errors from here on.
        settle()
        // A kept-alive socket the server closed while it sat idle only fails once used, so the
        // request gets one more go on a new socket (the retry Node documents for `reusedSocket`).
        if (retryStale && req.reusedSocket && !timedOut && !signal?.aborted) {
          resolve(this.send(target, headers, signal, false))
        } else {
          reject(error)
        }
      })
      signal?.addEventListener('abort', onAbort, { once: true })
      req.end()
    })
  }
}
