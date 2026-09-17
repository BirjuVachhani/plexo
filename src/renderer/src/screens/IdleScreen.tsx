import type { ProbeResult } from '@shared/types'
import { AlertTriangle, ClipboardPaste } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { NetworkCard } from '../components/NetworkCard'
import { Alert, AlertDescription } from '../components/ui/alert'
import { Button } from '../components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '../components/ui/toggle-group'
import { useNetworkPolling } from '../hooks/useNetworkPolling'
import { cn } from '../lib/utils'
import { useAppStore } from '../store/useAppStore'
import { describeError, formatBytes, toDisplayPath } from '../utils/format'

type ProbeState =
  | { status: 'idle' }
  | { status: 'probing' }
  | { status: 'ready'; result: ProbeResult; multiChunkAllowed: boolean }
  | { status: 'error'; message: string }

const PROBE_DEBOUNCE_MS = 600
const PRESET_STREAMS = [1, 2, 4, 8] as const

const fieldLabelClass =
  'shrink-0 font-mono text-[10px] tracking-[0.14em] text-[var(--text-tertiary)]'

export function IdleScreen(): React.JSX.Element {
  useNetworkPolling(true)

  const interfaces = useAppStore((store) => store.interfaces)
  const homeDir = useAppStore((store) => store.homeDir)
  const downloadsDir = useAppStore((store) => store.downloadsDir)
  const latencies = useAppStore((store) => store.latencies)
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
    <div className="flex h-full flex-col bg-background">
      <div className="flex flex-col gap-[9px] px-5 pt-4 pb-3.5">
        <div className="flex items-center gap-[9px]">
          <div
            className={cn(
              'flex h-9 min-w-0 flex-1 items-center gap-[9px] rounded-[9px] border bg-[var(--input-bg)] px-3',
              probe.status === 'error'
                ? 'border-[var(--color-danger)]'
                : 'border-[var(--border-strong)]'
            )}
          >
            <div className={fieldLabelClass}>LINK</div>
            <input
              type="text"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://"
              className="min-w-0 flex-1 border-none bg-transparent font-mono text-[13px] text-foreground outline-none"
            />
            <Button
              type="button"
              variant="secondary"
              size="xs"
              onClick={handlePaste}
              className="shrink-0 gap-1 font-mono text-[9.5px] uppercase tracking-wide"
            >
              <ClipboardPaste className="size-3" />
              Paste {window.plexo.platform === 'darwin' ? '⌘V' : 'Ctrl+V'}
            </Button>
          </div>
          <Button
            type="button"
            onClick={handleStart}
            disabled={!canStart}
            className="h-9 w-28 shrink-0"
          >
            {starting ? 'Starting…' : probe.status === 'probing' ? 'Checking…' : 'Start'}
          </Button>
        </div>

        {probe.status === 'error' && (
          <Alert variant="destructive" className="py-1.5">
            <AlertTriangle />
            <AlertDescription className="text-[var(--color-danger)]">
              {probe.message}
            </AlertDescription>
          </Alert>
        )}

        <div
          className={cn(
            'flex h-9 items-center gap-[9px] rounded-[9px] border px-3',
            probe.status === 'ready'
              ? 'border-[var(--border)] opacity-100'
              : 'border-dashed border-[var(--border)] opacity-50'
          )}
        >
          <div className={fieldLabelClass}>SAVE AS</div>
          <input
            type="text"
            value={
              probe.status === 'ready' ? (fileNameOverride ?? probe.result.suggestedFileName) : ''
            }
            onChange={(event) => setFileNameOverride(event.target.value)}
            disabled={probe.status !== 'ready'}
            placeholder="—"
            className="min-w-0 flex-1 border-none bg-transparent font-mono text-[12.5px] text-foreground outline-none"
          />
          {probe.status === 'ready' && probe.result.totalBytes !== null && (
            <div className="shrink-0 whitespace-nowrap font-mono text-[11px] font-medium text-[var(--text-tertiary)]">
              {formatBytes(probe.result.totalBytes)} (est.)
            </div>
          )}
        </div>

        <div className="flex h-9 items-center gap-[9px] rounded-[9px] border border-[var(--border)] px-3">
          <div className={fieldLabelClass}>TO</div>
          <div className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-[var(--text-secondary)]">
            {toDisplayPath(destinationDir || downloadsDir, homeDir)}
          </div>
          <Button
            type="button"
            variant="link"
            size="xs"
            onClick={handleBrowse}
            className="h-auto shrink-0 px-0 font-mono text-[11px]"
          >
            Browse…
          </Button>
        </div>

        <div
          className={cn(
            'flex min-h-9 items-center justify-between gap-3 rounded-[9px] border border-[var(--border)] px-3 py-1.5',
            isSingleRangeServer && 'opacity-60'
          )}
        >
          <div className="flex flex-wrap items-center gap-2">
            <div className={fieldLabelClass}>PARALLEL STREAMS</div>
            <ToggleGroup
              value={[String(chunksPerNetwork)]}
              onValueChange={(values) => {
                if (values.length === 0) return
                setChunksPerNetwork(Number(values[0]))
              }}
              disabled={isSingleRangeServer}
              variant="default"
              spacing={1}
            >
              {PRESET_STREAMS.map((preset) => (
                <ToggleGroupItem
                  key={preset}
                  value={String(preset)}
                  size="sm"
                  className="h-5 border border-[var(--border)] bg-[var(--track-bg)] px-1.5 font-mono text-[10px] font-semibold text-[var(--text-secondary)] aria-pressed:!border-[var(--color-accent)] aria-pressed:!bg-primary aria-pressed:!text-primary-foreground"
                >
                  {preset}×
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>

          <div
            className={cn(
              'text-right font-mono text-[11px] whitespace-nowrap',
              isSingleRangeServer ? 'text-[var(--text-tertiary)]' : 'text-[var(--text-secondary)]'
            )}
          >
            {isSingleRangeServer ? (
              '1 stream (server does not support ranges)'
            ) : selectedInterfaceIds.length > 0 ? (
              <>
                <span className="font-semibold text-foreground">{chunksPerNetwork}</span> / network
                · <span className="font-semibold text-foreground">{totalChunks}</span> total
                parallel streams
              </>
            ) : (
              <>
                <span className="font-semibold text-foreground">{chunksPerNetwork}</span> / network
              </>
            )}
          </div>
        </div>

        {isSingleRangeServer && (
          <div className="text-[11.5px] text-[var(--text-tertiary)]">
            This server doesn&apos;t support multi-chunk downloads for this file — using a single
            network.
          </div>
        )}
        {startError && (
          <Alert variant="destructive" className="py-1.5">
            <AlertTriangle />
            <AlertDescription className="text-[var(--color-danger)]">{startError}</AlertDescription>
          </Alert>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-3.5">
        <div className="flex items-baseline justify-between border-b border-[var(--border)] pb-2">
          <div className="font-mono text-[10px] tracking-[0.16em] text-[var(--text-tertiary)] uppercase">
            Connected Networks
          </div>
          <div className="shrink-0 font-mono text-[10.5px] text-[var(--text-tertiary)]">
            {interfaces.length} detected · {selectedInterfaceIds.length} selected
          </div>
        </div>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-2.5 pt-3">
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

      <div className="flex items-center gap-2.5 border-t border-[var(--footer-border)] bg-[var(--bg-tertiary)] px-5 py-[11px]">
        <div className="font-mono text-[11px] text-[var(--text-tertiary)]">
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
