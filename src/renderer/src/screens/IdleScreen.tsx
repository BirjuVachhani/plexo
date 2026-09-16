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
const PRESET_STREAMS = [1, 2, 4, 8] as const

const fieldLabelStyle: React.CSSProperties = {
  font: `500 10px/1 ${FONT_MONO}`,
  letterSpacing: '0.14em',
  color: 'var(--text-tertiary)',
  flexShrink: 0
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
  const [deselectedInterfaceIds, setDeselectedInterfaceIds] = useState<string[]>([])
  const [chunksPerNetwork, setChunksPerNetwork] = useState(2)
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const [fileNameOverride, setFileNameOverride] = useState<string | null>(null)

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
      setFileNameOverride(null)
      return
    }

    const requestId = ++probeRequestId.current
    setProbe({ status: 'probing' })
    setFileNameOverride(null)
    const timer = setTimeout(async () => {
      try {
        const result = await window.plexo.probeUrl(trimmed)
        if (probeRequestId.current !== requestId) return
        const multiChunkAllowed = result.supportsRanges && result.totalBytes !== null
        setProbe({ status: 'ready', result, multiChunkAllowed })
      } catch (error) {
        if (probeRequestId.current !== requestId) return
        setProbe({ status: 'error', message: describeError(error) })
      }
    }, PROBE_DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [url])

  const isSingleRangeServer = probe.status === 'ready' && !probe.multiChunkAllowed

  const activeDetectedIds = interfaces.map((iface) => iface.id)
  const rawSelectedIds = activeDetectedIds.filter((id) => !deselectedInterfaceIds.includes(id))
  const selectedInterfaceIds = isSingleRangeServer ? rawSelectedIds.slice(0, 1) : rawSelectedIds

  const handleToggleInterface = (id: string): void => {
    if (isSingleRangeServer) {
      // Single-range servers can only download through 1 interface at a time
      setDeselectedInterfaceIds(activeDetectedIds.filter((otherId) => otherId !== id))
      return
    }

    setDeselectedInterfaceIds((prev) => {
      const isCurrentlySelected = !prev.includes(id)
      if (isCurrentlySelected) {
        // Deselecting: keep at least 1 interface selected
        const remainingCount = activeDetectedIds.filter(
          (otherId) => !prev.includes(otherId) && otherId !== id
        ).length
        if (remainingCount === 0) return prev
        return [...prev, id]
      } else {
        return prev.filter((entry) => entry !== id)
      }
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
        suggestedFileName: fileNameOverride?.trim() || probe.result.suggestedFileName,
        totalBytes: probe.result.totalBytes ?? 0,
        supportsRanges: probe.multiChunkAllowed,
        interfaceIds: selectedInterfaceIds,
        chunkCount: probe.multiChunkAllowed ? selectedInterfaceIds.length * chunksPerNetwork : 1,
        connectionsPerNetwork: probe.multiChunkAllowed ? chunksPerNetwork : 1,
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
  const effectiveNetworkCount = Math.max(1, selectedInterfaceIds.length)
  const totalChunks = isSingleRangeServer ? 1 : effectiveNetworkCount * chunksPerNetwork

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
              border:
                probe.status === 'error'
                  ? `0.5px solid ${DANGER}`
                  : '0.5px solid var(--border-strong)'
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
              PASTE {window.plexo.platform === 'darwin' ? '⌘V' : 'Ctrl+V'}
            </button>
          </div>
          <button
            type="button"
            onClick={handleStart}
            disabled={!canStart}
            style={{
              ...(canStart ? primaryButtonStyle : disabledPrimaryButtonStyle),
              boxSizing: 'border-box',
              width: 112,
              padding: '8px 14px',
              textAlign: 'center'
            }}
          >
            {starting ? 'Starting…' : probe.status === 'probing' ? 'Checking…' : 'Start'}
          </button>
        </div>

        {probe.status === 'error' && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              font: `12px/1.4 ${FONT_UI}`,
              color: DANGER
            }}
          >
            <span style={{ flexShrink: 0 }}>⚠</span>
            {probe.message}
          </div>
        )}

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 9,
            padding: '7px 12px',
            borderRadius: 9,
            background: 'var(--bg-secondary)',
            border:
              probe.status === 'ready' ? '0.5px solid var(--border)' : '0.5px dashed var(--border)',
            opacity: probe.status === 'ready' ? 1 : 0.5
          }}
        >
          <div style={fieldLabelStyle}>SAVE AS</div>
          <input
            type="text"
            value={
              probe.status === 'ready' ? (fileNameOverride ?? probe.result.suggestedFileName) : ''
            }
            onChange={(event) => setFileNameOverride(event.target.value)}
            disabled={probe.status !== 'ready'}
            placeholder="—"
            style={{
              flex: 1,
              minWidth: 0,
              border: 'none',
              outline: 'none',
              background: 'transparent',
              font: `12.5px/1.3 ${FONT_MONO}`,
              color: 'var(--text)'
            }}
          />
          {probe.status === 'ready' && probe.result.totalBytes !== null && (
            <div
              style={{
                font: `500 11px/1 ${FONT_MONO}`,
                color: 'var(--text-tertiary)',
                whiteSpace: 'nowrap',
                flexShrink: 0
              }}
            >
              {formatBytes(probe.result.totalBytes)} (est.)
            </div>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 9,
            padding: '7px 12px',
            borderRadius: 9,
            background: 'var(--bg-secondary)',
            border: '0.5px solid var(--border)'
          }}
        >
          <div style={fieldLabelStyle}>TO</div>
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
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '8px 12px',
            borderRadius: 9,
            background: 'var(--bg-secondary)',
            border: '0.5px solid var(--border)',
            opacity: isSingleRangeServer ? 0.6 : 1
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={fieldLabelStyle}>PARALLEL STREAMS</div>
            <div style={{ display: 'flex', gap: 4 }}>
              {PRESET_STREAMS.map((preset) => {
                const isSelected = chunksPerNetwork === preset
                return (
                  <button
                    key={preset}
                    type="button"
                    disabled={isSingleRangeServer}
                    onClick={() => setChunksPerNetwork(preset)}
                    style={{
                      border: isSelected
                        ? '0.5px solid var(--color-accent)'
                        : '0.5px solid var(--border)',
                      borderRadius: 5,
                      background: isSelected ? 'var(--color-usb-bg)' : 'var(--track-bg)',
                      color: isSelected ? 'var(--color-usb-text)' : 'var(--text-secondary)',
                      font: `600 10.5px/1 ${FONT_MONO}`,
                      padding: '4px 8px',
                      cursor: isSingleRangeServer ? 'not-allowed' : 'pointer',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    {preset}×
                  </button>
                )
              })}
            </div>
          </div>

          <div
            style={{
              font: `500 11px/1 ${FONT_MONO}`,
              color: isSingleRangeServer ? 'var(--text-tertiary)' : 'var(--text-secondary)',
              textAlign: 'right',
              whiteSpace: 'nowrap'
            }}
          >
            {isSingleRangeServer ? (
              '1 stream (server does not support ranges)'
            ) : selectedInterfaceIds.length > 0 ? (
              <>
                <span style={{ color: 'var(--text)', fontWeight: 600 }}>{chunksPerNetwork}</span> /
                network ·{' '}
                <span style={{ color: 'var(--text)', fontWeight: 600 }}>{totalChunks}</span> total
                parallel streams
              </>
            ) : (
              <>
                <span style={{ color: 'var(--text)', fontWeight: 600 }}>{chunksPerNetwork}</span> /
                network
              </>
            )}
          </div>
        </div>

        {isSingleRangeServer && (
          <div style={{ font: `11.5px/1.4 ${FONT_UI}`, color: 'var(--text-tertiary)' }}>
            This server doesn&apos;t support multi-chunk downloads for this file — using a single
            network.
          </div>
        )}
        {startError && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              font: `11.5px/1.4 ${FONT_UI}`,
              color: DANGER
            }}
          >
            <span style={{ flexShrink: 0 }}>⚠</span>
            {startError}
          </div>
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
          <div style={sectionHeaderLabelStyle}>Connected Networks</div>
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
          {selectedInterfaceIds.length > 0
            ? ` · ${totalChunks} ${totalChunks === 1 ? 'stream' : 'parallel streams'}`
            : ''}
          {probe.status === 'ready' && probe.result.totalBytes !== null
            ? ` · ${formatBytes(probe.result.totalBytes)}`
            : ''}
        </div>
      </div>
    </div>
  )
}
