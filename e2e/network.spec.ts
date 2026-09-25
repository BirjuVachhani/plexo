import { expect, test } from '@playwright/test'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { NetworkInterfaceInfo } from '../src/shared/types'
import { requestOnInterface, resolveTarget, routesFor } from '../src/main/network/routes'

const iface: NetworkInterfaceInfo = {
  id: 'wifi',
  device: 'wifi',
  displayName: 'Wi-Fi',
  kind: 'wifi',
  addresses: [
    { address: '192.0.2.2', family: 4 },
    { address: '2001:db8::2', family: 6 }
  ]
}

test('AAAA-only host uses the matching IPv6 address', async () => {
  const remote = await resolveTarget(new URL('https://ipv6.example.test/file'), async (host) => {
    expect(host).toBe('ipv6.example.test')
    return [{ address: '2001:db8::10', family: 6 }]
  })
  expect(routesFor(iface, remote)).toEqual([
    { device: 'wifi', localAddress: '2001:db8::2', remoteAddress: '2001:db8::10', family: 6 }
  ])
})

test('IPv4 and bracketed IPv6 literals bypass DNS', async () => {
  const failLookup = async (): Promise<never> => {
    throw new Error('DNS should not run for a literal')
  }
  expect(await resolveTarget(new URL('http://127.0.0.1/'), failLookup)).toEqual([
    { address: '127.0.0.1', family: 4 }
  ])
  expect(await resolveTarget(new URL('http://[::1]/'), failLookup)).toEqual([
    { address: '::1', family: 6 }
  ])
})

test('AAAA-only hostname connects over IPv6 and keeps its HTTP Host header', async () => {
  let seenHost = ''
  const server = createServer((req, res) => {
    seenHost = req.headers.host ?? ''
    res.end('ok')
  })
  await new Promise<void>((resolve) => server.listen(0, '::1', resolve))
  try {
    const port = (server.address() as AddressInfo).port
    const target = new URL(`http://ipv6.example.test:${port}/file`)
    const source: NetworkInterfaceInfo = {
      ...iface,
      addresses: [{ address: '::1', family: 6 }]
    }
    const { res } = await requestOnInterface({
      target,
      iface: source,
      headers: {},
      timeoutMs: 2000,
      resolveHost: async () => [{ address: '::1', family: 6 }]
    })
    let body = ''
    for await (const chunk of res) body += chunk
    expect(body).toBe('ok')
    expect(seenHost).toBe(`ipv6.example.test:${port}`)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('falls back to IPv6 when an IPv4 connection fails before headers', async () => {
  const server = createServer((_req, res) => res.end('ipv6'))
  await new Promise<void>((resolve) => server.listen(0, '::1', resolve))
  try {
    const port = (server.address() as AddressInfo).port
    const { res } = await requestOnInterface({
      target: new URL(`http://dual.example.test:${port}/`),
      iface: {
        ...iface,
        addresses: [
          { address: '127.0.0.1', family: 4 },
          { address: '::1', family: 6 }
        ]
      },
      headers: {},
      timeoutMs: 2000,
      resolveHost: async () => [
        { address: '127.0.0.1', family: 4 },
        { address: '::1', family: 6 }
      ]
    })
    let body = ''
    for await (const chunk of res) body += chunk
    expect(body).toBe('ipv6')
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('a silent route leaves time to try another address', async () => {
  const silent = createServer(() => {})
  await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', resolve))
  const port = (silent.address() as AddressInfo).port
  const working = createServer((_req, res) => res.end('ok'))
  await new Promise<void>((resolve) => working.listen(port, '::1', resolve))
  try {
    const { res } = await requestOnInterface({
      target: new URL(`http://dual.example.test:${port}/`),
      iface: {
        ...iface,
        addresses: [
          { address: '127.0.0.1', family: 4 },
          { address: '::1', family: 6 }
        ]
      },
      headers: {},
      timeoutMs: 2000,
      resolveHost: async () => [
        { address: '127.0.0.1', family: 4 },
        { address: '::1', family: 6 }
      ]
    })
    let body = ''
    for await (const chunk of res) body += chunk
    expect(body).toBe('ok')
  } finally {
    await Promise.all([
      new Promise<void>((resolve) => silent.close(() => resolve())),
      new Promise<void>((resolve) => working.close(() => resolve()))
    ])
  }
})
