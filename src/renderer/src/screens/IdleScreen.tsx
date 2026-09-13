import type { ProbeResult } from '@shared/types'
import { useEffect, useRef, useState } from 'react'
import { NetworkCard } from '../components/NetworkCard'
import { useNetworkPolling } from '../hooks/useNetworkPolling'
import { useAppStore } from '../store/useAppStore'
import {
  DANGER,
  FONT_MONO,
  FONT_UI,
  disabledPrimaryButtonStyle,
  primaryButtonStyle,
  sectionHeaderLabelStyle,
  sectionHeaderMetaStyle
} from '../theme'
import { describeError, formatBytes, toDisplayPath } from '../utils/format'

type ProbeState =
  | { status: 'idle' }
  | { status: 'probing' }
  | { status: 'ready'; result: ProbeResult; multiChunkAllowed: boolean }
  | { status: 'error'; message: string }

const PROBE_DEBOUNCE_MS = 600
const MIN_CHUNKS_PER_NETWORK = 1
const MAX_CHUNKS_PER_NETWORK = 8

const fieldLabelStyle: React.CSSProperties = {
  font: `500 10px/1 ${FONT_MONO}`,
  letterSpacing: '0.14em',
  color: 'var(--text-tertiary)',
  flexShrink: 0
}

const stepperArrowStyle: React.CSSProperties = {
  border: 'none',
  background: 'none',
  color: 'var(--text-secondary)',
  font: `600 13px/1 ${FONT_UI}`,
  cursor: 'pointer',
  padding: '0 2px'
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
  const [chunksPerNetwork, setChunksPerNetwork] = useState(1)
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
        const multiChunkAllowed = result.supportsRanges && result.totalBytes !== null
        setProbe({ status: 'ready', result, multiChunkAllowed })
        setSelectedInterfaceIds(
          (multiChunkAllowed ? interfaces : interfaces.slice(0, 1)).map((iface) => iface.id)
        )
        setChunksPerNetwork(1)
      } catch (error) {
        if (probeRequestId.current !== requestId) return
        setProbe({ status: 'error', message: describeError(error) })
      }
    }, PROBE_DEBOUNCE_MS)

    return () => clearTimeout(timer)
    // interfaces is intentionally omitted: we only want this to re-run when the URL changes,
    // using whatever interface list is current at the moment the probe resolves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url])

  const handleToggleInterface = (id: string): void => {
    const multiChunkAllowed = probe.status === 'ready' && probe.multiChunkAllowed
    setSelectedInterfaceIds((prev) => {
      if (!multiChunkAllowed) return [id]
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
        supportsRanges: probe.multiChunkAllowed,
        interfaceIds: selectedInterfaceIds,
        chunkCount: probe.multiChunkAllowed ? selectedInterfaceIds.length * chunksPerNetwork : 1,
        etag: probe.result.etag,
        lastModified: probe.result.lastModified
      })
    } catch (error) {
      setStartError(describeError(error))
    } finally {
      setStarting(false)
    }
  }

  const canStart =
    probe.status === 'ready' &&
    selectedInterfaceIds.length > 0 &&
    Boolean(destinationDir) &&
    !starting
  const multiChunkAllowed = probe.status === 'ready' && probe.multiChunkAllowed
  const totalChunks = multiChunkAllowed ? selectedInterfaceIds.length * chunksPerNetwork : 1

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg)' }}
    >
      <div style={{ padding: '16px 20px 14px', display: 'flex', flexDirection: 'column', gap: 9 }}>
        <div style={{ display: 'flex', gap: 9, alignItems: 'center' }}>
          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 9,
              padding: '9px 12px',
              borderRadius: 9,
              background: 'var(--input-bg)',
              border: '0.5px solid var(--border-strong)'
            }}
          >
            <div style={fieldLabelStyle}>LINK</div>
            <input
              type="text"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://"
              style={{
                flex: 1,
                minWidth: 0,
                border: 'none',
                outline: 'none',
                background: 'transparent',
                font: `13px/1.3 ${FONT_MONO}`,
                color: 'var(--text)'
              }}
            />
            <button
              type="button"
              onClick={handlePaste}
              style={{
                border: 'none',
                borderRadius: 5,
                background: 'var(--track-bg)',
                padding: '3px 8px',
                font: `500 9.5px/1 ${FONT_MONO}`,
                color: 'var(--text-secondary)',
                whiteSpace: 'nowrap',
                cursor: 'pointer',
                flexShrink: 0
              }}
            >
              PASTE ⌘V
            </button>
          </div>
          <button
            type="button"
            onClick={handleStart}
            disabled={!canStart}
            style={canStart ? primaryButtonStyle : disabledPrimaryButtonStyle}
          >
            {starting ? 'Starting…' : 'Start'}
          </button>
        </div>

        <div style={{ display: 'flex', gap: 9, alignItems: 'center' }}>
          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 9,
              padding: '7px 12px',
              borderRadius: 9,
              background: 'var(--bg-secondary)',
              border: '0.5px solid var(--border)'
            }}
          >
            <div style={fieldLabelStyle}>SAVE TO</div>
            <div
              style={{
                flex: 1,
                minWidth: 0,
                font: `12.5px/1.3 ${FONT_MONO}`,
                color: 'var(--text-secondary)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}
            >
              {toDisplayPath(destinationDir || downloadsDir, homeDir)}
            </div>
            <button
              type="button"
              onClick={handleBrowse}
              style={{
                border: 'none',
                background: 'none',
                font: `500 11px/1 ${FONT_MONO}`,
                color: 'var(--color-accent)',
                whiteSpace: 'nowrap',
                cursor: 'pointer',
                flexShrink: 0
              }}
            >
              Browse…
            </button>
          </div>
          <div
            style={{
              width: 122,
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              padding: '7px 0',
              borderRadius: 9,
              background: 'var(--bg-secondary)',
              border: '0.5px solid var(--border)',
              opacity: multiChunkAllowed ? 1 : 0.5
            }}
          >
            <button
              type="button"
              onClick={() =>
                setChunksPerNetwork((count) => Math.max(MIN_CHUNKS_PER_NETWORK, count - 1))
              }
              disabled={!multiChunkAllowed || chunksPerNetwork <= MIN_CHUNKS_PER_NETWORK}
              style={stepperArrowStyle}
            >
              −
            </button>
            <div
              style={{
                font: `11px/1 ${FONT_MONO}`,
                color: 'var(--text-secondary)',
                whiteSpace: 'nowrap'
              }}
            >
              {totalChunks} chunk{totalChunks === 1 ? '' : 's'}
            </div>
            <button
              type="button"
              onClick={() =>
                setChunksPerNetwork((count) => Math.min(MAX_CHUNKS_PER_NETWORK, count + 1))
              }
              disabled={!multiChunkAllowed || chunksPerNetwork >= MAX_CHUNKS_PER_NETWORK}
              style={stepperArrowStyle}
            >
              +
            </button>
          </div>
        </div>

        {probe.status === 'error' && (
          <div style={{ font: `12px/1.4 ${FONT_UI}`, color: DANGER }}>{probe.message}</div>
        )}
        {probe.status === 'ready' && !probe.multiChunkAllowed && (
          <div style={{ font: `11.5px/1.4 ${FONT_UI}`, color: 'var(--text-tertiary)' }}>
            This server doesn&apos;t support multi-chunk downloads for this file — using a single
            network.
          </div>
        )}
        {startError && (
          <div style={{ font: `11.5px/1.4 ${FONT_UI}`, color: DANGER }}>{startError}</div>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px 14px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            paddingBottom: 8,
            borderBottom: '0.5px solid var(--border)'
          }}
        >
          <div style={sectionHeaderLabelStyle}>Networks</div>
          <div style={sectionHeaderMetaStyle}>
            {interfaces.length} detected · {selectedInterfaceIds.length} selected
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
            gap: 10,
            paddingTop: 12
          }}
        >
          {interfaces.map((iface) => (
            <NetworkCard
              key={iface.id}
              iface={iface}
              selected={selectedInterfaceIds.includes(iface.id)}
              latencyMs={latencies[iface.id]}
              onToggle={() => handleToggleInterface(iface.id)}
            />
          ))}
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '11px 20px',
          background: 'var(--bg-tertiary)',
          borderTop: '0.5px solid var(--footer-border)'
        }}
      >
        <div style={{ font: `11px/1.4 ${FONT_MONO}`, color: 'var(--text-tertiary)' }}>
          {selectedInterfaceIds.length} {selectedInterfaceIds.length === 1 ? 'network' : 'networks'}{' '}
          selected
          {probe.status === 'ready' && probe.result.totalBytes !== null
            ? ` · ${formatBytes(probe.result.totalBytes)}`
            : ''}
        </div>
      </div>
    </div>
  )
}
