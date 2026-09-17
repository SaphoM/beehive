// Entry point RoomPage.tsx calls to get a segmentation engine. Tries the
// modern MediaPipe Tasks Vision engine first; if it fails to initialize for
// any reason (model URL unreachable, browser/GPU incompatibility, WASM load
// failure), falls back to the proven legacy engine — a permanent safety net,
// not a temporary migration shim, since a video call should never break over
// a segmentation-engine hiccup.
//
// That init-time fallback alone isn't enough: if Tasks Vision initializes
// fine but then fails on later frames (a model/GPU-driver quirk that can't
// be ruled out without a live camera), RoomPage.tsx's per-frame loop wraps
// send() in a blanket try/catch — so a failure there is silently swallowed
// with zero visibility and zero recovery, which looks exactly like "the
// background effect doesn't work at all" with no clue why. The wrapper below
// is a runtime circuit breaker: after a few consecutive per-frame failures,
// it transparently swaps the active engine to the proven legacy one, logs
// clearly why, and carries over the already-registered onResults callback —
// RoomPage.tsx never knows the swap happened.
import { createTasksVisionEngine } from './tasksVisionEngine'
import { createLegacyEngine } from './legacyEngine'
import type { SegmentationEngine } from './types'

const MAX_CONSECUTIVE_FAILURES = 3

export async function createSegmentationEngine(): Promise<SegmentationEngine> {
  try {
    const engine = await createTasksVisionEngine()
    console.log('[segmentation] using MediaPipe Tasks Vision (GPU/CPU delegate)')
    return withResilience(engine, 'tasks-vision')
  } catch (e) {
    console.warn('[segmentation] Tasks Vision unavailable at init, falling back to legacy engine:', e)
    const engine = await createLegacyEngine()
    return withResilience(engine, 'legacy')
  }
}

function withResilience(initialEngine: SegmentationEngine, initialLabel: string): SegmentationEngine {
  let active = initialEngine
  let label = initialLabel
  let consecutiveFailures = 0
  let downgradeInFlight: Promise<void> | null = null
  let registeredCallback: ((mask: CanvasImageSource) => void) | null = null

  // Perf breadcrumb (see Round 3 plan) — rolling average frame time logged
  // every ~2s, restarts cleanly whenever the active engine changes so the
  // numbers are never a blend of two different engines.
  let samples: number[] = []
  let lastLog = performance.now()

  async function downgradeToLegacy(reason: unknown) {
    console.warn(`[segmentation] ${label} failing repeatedly (${MAX_CONSECUTIVE_FAILURES} frames in a row), downgrading to legacy engine:`, reason)
    try { active.close() } catch { /* already broken, nothing to clean up */ }
    active = await createLegacyEngine()
    label = 'legacy'
    consecutiveFailures = 0
    samples = []
    if (registeredCallback) active.onResults(registeredCallback)
  }

  return {
    onResults(callback) {
      registeredCallback = callback
      active.onResults(callback)
    },
    async send(video) {
      if (downgradeInFlight) { await downgradeInFlight; }

      const start = performance.now()
      try {
        await active.send(video)
        consecutiveFailures = 0
      } catch (e) {
        consecutiveFailures++
        console.warn(`[segmentation:${label}] frame failed (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}):`, e)
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES && label !== 'legacy') {
          downgradeInFlight = downgradeToLegacy(e).finally(() => { downgradeInFlight = null })
          await downgradeInFlight
        }
        return // this frame is lost either way; the next one uses whichever engine is now active
      }

      samples.push(performance.now() - start)
      const now = performance.now()
      if (now - lastLog >= 2000 && samples.length > 0) {
        const avg = samples.reduce((a, b) => a + b, 0) / samples.length
        console.log(`[segmentation:${label}] avg frame time: ${avg.toFixed(1)}ms (${(1000 / avg).toFixed(1)} fps)`)
        samples = []
        lastLog = now
      }
    },
    close() {
      active.close()
    },
  }
}
