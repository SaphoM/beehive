// Entry point RoomPage.tsx calls to get a segmentation engine. Tries the
// modern MediaPipe Tasks Vision engine first; if it fails to initialize for
// any reason (model URL unreachable, browser/GPU incompatibility, WASM load
// failure), falls back to the proven legacy engine — a permanent safety net,
// not a temporary migration shim, since a video call should never break over
// a segmentation-engine hiccup.
import { createTasksVisionEngine } from './tasksVisionEngine'
import { createLegacyEngine } from './legacyEngine'
import type { SegmentationEngine } from './types'

export async function createSegmentationEngine(): Promise<SegmentationEngine> {
  try {
    const engine = await createTasksVisionEngine()
    console.log('[segmentation] using MediaPipe Tasks Vision (GPU/CPU delegate)')
    return wrapWithPerfLogging(engine, 'tasks-vision')
  } catch (e) {
    console.warn('[segmentation] Tasks Vision unavailable, falling back to legacy engine:', e)
    const engine = await createLegacyEngine()
    return wrapWithPerfLogging(engine, 'legacy')
  }
}

// Dev-only breadcrumb, not a UI feature: logs a rolling average frame time
// every ~2s so a human tester can capture real before/after numbers for
// either engine (e.g. by temporarily forcing the legacy path) without
// needing any dashboard or BackgroundMenu.tsx change.
function wrapWithPerfLogging(engine: SegmentationEngine, label: string): SegmentationEngine {
  let samples: number[] = []
  let lastLog = performance.now()

  return {
    ...engine,
    async send(video) {
      const start = performance.now()
      await engine.send(video)
      samples.push(performance.now() - start)

      const now = performance.now()
      if (now - lastLog >= 2000 && samples.length > 0) {
        const avg = samples.reduce((a, b) => a + b, 0) / samples.length
        console.log(`[segmentation:${label}] avg frame time: ${avg.toFixed(1)}ms (${(1000 / avg).toFixed(1)} fps)`)
        samples = []
        lastLog = now
      }
    },
  }
}
