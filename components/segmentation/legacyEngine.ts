// Wraps the legacy MediaPipe Solutions SelfieSegmentation API (CDN-loaded,
// window global) behind the SegmentationEngine interface. This is today's
// exact working code — Round 1/2's proven engine — extracted verbatim, not
// rewritten. It's the permanent fallback createSegmentationEngine() reaches
// for if the newer Tasks Vision engine fails to initialize.
import { ensureMediaPipe } from '../roomUtils'
import type { SegmentationEngine } from './types'

export async function createLegacyEngine(): Promise<SegmentationEngine> {
  await ensureMediaPipe()

  const seg = new (window as any).SelfieSegmentation({
    locateFile: (f: string) =>
      `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation@0.1/${f}`,
  })
  // Model 0 ("general", 256x256 internal) — more accurate on fine edges
  // (hair, fingers) than model 1 ("landscape"), which trades accuracy for
  // speed on wide/multi-person framing that doesn't apply to this app's
  // single close-up webcam view.
  seg.setOptions({ modelSelection: 0 })

  return {
    onResults(callback) {
      seg.onResults((results: any) => callback(results.segmentationMask))
    },
    async send(video) {
      await seg.send({ image: video })
    },
    close() {
      try { seg.close() } catch { /* already closed / never initialized */ }
    },
  }
}
