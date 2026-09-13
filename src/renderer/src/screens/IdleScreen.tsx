import type { ProbeResult } from '@shared/types'
import { useEffect, useRef, useState } from 'react'
import { ConnectionRow } from '../components/ConnectionRow'
import { FieldsSection } from '../components/FieldsSection'
import { useNetworkPolling } from '../hooks/useNetworkPolling'
import { useAppStore } from '../store/useAppStore'
import {
  disabledPrimaryButtonStyle,
  footerStyle,
  footerTextStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  sectionHeaderLabelStyle,
  sectionHeaderMetaStyle
} from '../theme'
import { formatBytes, toDisplayPath } from '../utils/format'

type ProbeState =
  | { status: 'idle' }
  | { status: 'probing' }
  | { status: 'ready'; result: ProbeResult; multiConnectionAllowed: boolean }
  | { status: 'error'; message: string }

const PROBE_DEBOUNCE_MS = 600
const MIN_CONNECTIONS_PER_INTERFACE = 1
const MAX_CONNECTIONS_PER_INTERFACE = 8

const stepperButtonStyle: React.CSSProperties = {
  width: 20,
  height: 20,
  borderRadius: 5,
  border: '0.5px solid #b9b9bb',
  background: 'linear-gradient(#fefefe, #f3f3f3)',
  color: '#1d1d1f',
  font: '13px/1 -apple-system, sans-serif',
  cursor: 'pointer'
}

export function IdleScreen(): React.JSX.Element {
  useNetworkPolling(true)

  const interfaces = useAppStore((store) => store.interfaces)
  const homeDir = useAppStore((store) => store.homeDir)
  const downloadsDir = useAppStore((store) => store.downloadsDir)
  const latencies = useAppStore((store) => store.latencies)
  const loadInitialPaths = useAppStore((store) => store.loadInitialPaths)
  const url = useAppStore((store) => store.draftUrl)
  const setUrl = useAppStore((store) => store.setDraftUrl)
  const destinationDir = useAppStore((store) => store.draftDestinationDir)
  const setDestinationDir = useAppStore((store) => store.setDraftDestinationDir)

  const [probe, setProbe] = useState<ProbeState>({ status: 'idle' })
  const [selectedInterfaceIds, setSelectedInterfaceIds] = useState<string[]>([])
  const [connectionsPerInterface, setConnectionsPerInterface] = useState(1)
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)

  const probeRequestId = useRef(0)

  useEffect(() => {
    loadInitialPaths()
  }, [loadInitialPaths])

  useEffect(() => {
    if (!destinationDir && downloadsDir) setDestinationDir(downloadsDir)
  }, [destinationDir, downloadsDir, setDestinationDir])

  useEffect(() => {
    const trimmed = url.trim()
    if (!trimmed) {
      // Resetting derived probe state when its trigger (the URL) is cleared.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setProbe({ status: 'idle' })
      return
    }

    const requestId = ++probeRequestId.current
    setProbe({ status: 'probing' })
    const timer = setTimeout(async () => {
      try {
        const result = await window.plexo.probeUrl(trimmed)
        if (probeRequestId.current !== requestId) return
        const multiConnectionAllowed = result.supportsRanges && result.totalBytes !== null
        setProbe({ status: 'ready', result, multiConnectionAllowed })
        setSelectedInterfaceIds(
          (multiConnectionAllowed ? interfaces : interfaces.slice(0, 1)).map((iface) => iface.id)
        )
        setConnectionsPerInterface(1)
      } catch (error) {
        if (probeRequestId.current !== requestId) return
        setProbe({
          status: 'error',
          message: error instanceof Error ? error.message : String(error)
        })
      }
    }, PROBE_DEBOUNCE_MS)

    return () => clearTimeout(timer)
    // interfaces is intentionally omitted: we only want this to re-run when the URL changes,
    // using whatever interface list is current at the moment the probe resolves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url])

  const handleToggleInterface = (id: string): void => {
    const multiConnectionAllowed = probe.status === 'ready' && probe.multiConnectionAllowed
    setSelectedInterfaceIds((prev) => {
      if (!multiConnectionAllowed) return [id]
      return prev.includes(id) ? prev.filter((entry) => entry !== id) : [...prev, id]
    })
  }

  const handleBrowse = async (): Promise<void> => {
    const chosen = await window.plexo.chooseDestinationFolder(destinationDir || downloadsDir)
    if (chosen) setDestinationDir(chosen)
  }

  const handlePaste = async (): Promise<void> => {
    const text = await window.plexo.readClipboardText()
    if (text.trim()) setUrl(text.trim())
  }

  const handleStart = async (): Promise<void> => {
    if (probe.status !== 'ready' || selectedInterfaceIds.length === 0 || !destinationDir) return
    setStarting(true)
    setStartError(null)
    try {
      await window.plexo.startDownload({
        url: probe.result.finalUrl,
        destinationDir,
        suggestedFileName: probe.result.suggestedFileName,
        totalBytes: probe.result.totalBytes ?? 0,
        supportsRanges: probe.multiConnectionAllowed,
        interfaceIds: selectedInterfaceIds,
        connectionCount: probe.multiConnectionAllowed
          ? selectedInterfaceIds.length * connectionsPerInterface
          : 1,
        etag: probe.result.etag,
        lastModified: probe.result.lastModified
      })
    } catch (error) {
      setStartError(error instanceof Error ? error.message : String(error))
    } finally {
      setStarting(false)
    }
  }

  const canStart =
    probe.status === 'ready' &&
    selectedInterfaceIds.length > 0 &&
    Boolean(destinationDir) &&
    !starting

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#fff' }}>
      <FieldsSection
        url={url}
        onUrlChange={setUrl}
        displayDestinationDir={toDisplayPath(destinationDir || downloadsDir, homeDir)}
        onBrowse={handleBrowse}
      />

      {probe.status === 'error' && (
        <div
          style={{
            margin: '0 20px 10px',
            font: '12px/1.4 -apple-system, sans-serif',
            color: 'oklch(0.55 0.2 25)'
          }}
        >
          {probe.message}
        </div>
      )}

      <div
        style={{
          borderTop: '0.5px solid #e0e0e2',
          background: '#fafafa',
          flex: 1,
          overflowY: 'auto'
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            padding: '12px 20px 8px'
          }}
        >
          <div style={sectionHeaderLabelStyle}>Connections</div>
          <div style={sectionHeaderMetaStyle}>{interfaces.length} detected</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {interfaces.map((iface) => (
            <ConnectionRow
              key={iface.id}
              iface={iface}
              selected={selectedInterfaceIds.includes(iface.id)}
              latencyMs={latencies[iface.id]}
              onToggle={() => handleToggleInterface(iface.id)}
            />
          ))}
        </div>

        {probe.status === 'ready' &&
          probe.multiConnectionAllowed &&
          selectedInterfaceIds.length > 0 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 20px',
                borderTop: '0.5px solid #ececee'
              }}
            >
              <div style={{ font: '12.5px/1 -apple-system, sans-serif', color: '#1d1d1f' }}>
                Connections per link
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  type="button"
                  onClick={() =>
                    setConnectionsPerInterface((count) =>
                      Math.max(MIN_CONNECTIONS_PER_INTERFACE, count - 1)
                    )
                  }
                  disabled={connectionsPerInterface <= MIN_CONNECTIONS_PER_INTERFACE}
                  style={stepperButtonStyle}
                >
                  −
                </button>
                <div
                  style={{
                    font: `12.5px/1 ${'"SF Mono", ui-monospace, Menlo, monospace'}`,
                    color: '#1d1d1f',
                    width: 14,
                    textAlign: 'center'
                  }}
                >
                  {connectionsPerInterface}
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setConnectionsPerInterface((count) =>
                      Math.min(MAX_CONNECTIONS_PER_INTERFACE, count + 1)
                    )
                  }
                  disabled={connectionsPerInterface >= MAX_CONNECTIONS_PER_INTERFACE}
                  style={stepperButtonStyle}
                >
                  +
                </button>
              </div>
              <div style={{ flex: 1 }} />
              <div style={{ font: '11.5px/1.4 -apple-system, sans-serif', color: '#8a8a8e' }}>
                {selectedInterfaceIds.length * connectionsPerInterface} connections total
              </div>
            </div>
          )}

        {probe.status === 'ready' && !probe.multiConnectionAllowed && (
          <div
            style={{
              margin: '0 20px 10px',
              font: '11.5px/1.4 -apple-system, sans-serif',
              color: '#8a8a8e'
            }}
          >
            This server doesn&apos;t support multi-connection downloads for this file — pick a
            single connection.
          </div>
        )}
      </div>

      <div style={footerStyle}>
        <div style={footerTextStyle}>
          {selectedInterfaceIds.length} selected
          {probe.status === 'ready' && probe.result.totalBytes !== null
            ? ` · ${formatBytes(probe.result.totalBytes)}`
            : ''}
        </div>
        {startError && (
          <div
            style={{ font: '11.5px/1.4 -apple-system, sans-serif', color: 'oklch(0.55 0.2 25)' }}
          >
            {startError}
          </div>
        )}
        <div style={{ flex: 1 }} />
        <button type="button" onClick={handlePaste} style={secondaryButtonStyle}>
          Paste from Clipboard
        </button>
        <button
          type="button"
          onClick={handleStart}
          disabled={!canStart}
          style={canStart ? primaryButtonStyle : disabledPrimaryButtonStyle}
        >
          Start
        </button>
      </div>
    </div>
  )
}
