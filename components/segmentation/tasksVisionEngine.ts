// Adapter for Google's current MediaPipe Tasks Vision ImageSegmenter,
// wrapped behind the same SegmentationEngine interface the legacy engine
// implements. This is the engine createSegmentationEngine() tries first —
// GPU-delegated inference, actively maintained by Google (the legacy
// SelfieSegmentation API this replaces is discontinued).
//
// The one piece of real adapter work: ImageSegmenter's result shape is not
// a drawable CanvasImageSource like the legacy engine's segmentationMask —
// it's an MPMask exposing raw confidence floats via getAsFloat32Array().
// This module converts that into a small canvas (alpha channel = confidence)
// so everything downstream (processMask() in RoomPage.tsx) keeps working
// unchanged, exactly as it does today with the legacy engine's mask.
import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision'
import type { SegmentationEngine } from './types'

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
// Google's established hosting convention for MediaPipe Tasks models. Not
// independently verified against a live fetch — if this URL is wrong or
// moves, createFromOptions() below throws, and createSegmentationEngine()
// falls back to the legacy engine automatically. That fallback is the
// safety net for exactly this kind of external-URL risk.
const SELFIE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite'

async function createImageSegmenter(): Promise<ImageSegmenter> {
  const vision = await FilesetResolver.forVisionTasks(WASM_URL)
  const baseOptions = { modelAssetPath: SELFIE_MODEL_URL }
  try {
    return await ImageSegmenter.createFromOptions(vision, {
      baseOptions: { ...baseOptions, delegate: 'GPU' },
      outputConfidenceMasks: true,
      outputCategoryMask: false,
      runningMode: 'VIDEO',
    })
  } catch (gpuErr) {
    // Some environments lack a usable WebGL2/compute setup for the GPU
    // delegate — retry once on CPU before giving up entirely (at which
    // point createSegmentationEngine() falls back to the legacy engine).
    console.warn('[segmentation] Tasks Vision GPU delegate failed, retrying on CPU:', gpuErr)
    return await ImageSegmenter.createFromOptions(vision, {
      baseOptions: { ...baseOptions, delegate: 'CPU' },
      outputConfidenceMasks: true,
      outputCategoryMask: false,
      runningMode: 'VIDEO',
    })
  }
}

export async function createTasksVisionEngine(): Promise<SegmentationEngine> {
  const segmenter = await createImageSegmenter()

  const maskCanvas = document.createElement('canvas')
  const maskCtx = maskCanvas.getContext('2d')!
  let lastTimestamp = -1
  let userCallback: ((mask: CanvasImageSource) => void) | null = null

  return {
    onResults(callback) {
      userCallback = callback
    },
    async send(video) {
      if (!userCallback) return
      // segmentForVideo requires strictly increasing timestamps; performance.now()
      // is monotonic but guard against two frames landing on the same millisecond.
      const ts = Math.max(performance.now(), lastTimestamp + 1)
      lastTimestamp = ts

      await new Promise<void>((resolve) => {
        segmenter.segmentForVideo(video, ts, (result) => {
          const confidence = result.confidenceMasks?.[0]
          if (!confidence) { resolve(); return }

          const w = confidence.width, h = confidence.height
          if (maskCanvas.width !== w || maskCanvas.height !== h) {
            maskCanvas.width = w; maskCanvas.height = h
          }
          const floats = confidence.getAsFloat32Array()
          const imageData = maskCtx.createImageData(w, h)
          const d = imageData.data
          for (let i = 0; i < floats.length; i++) {
            const a = Math.round(Math.max(0, Math.min(1, floats[i])) * 255)
            const o = i * 4
            // RGB unused by the downstream alpha-only mask pipeline — only
            // the alpha channel carries the confidence value.
            d[o] = d[o + 1] = d[o + 2] = 255
            d[o + 3] = a
          }
          maskCtx.putImageData(imageData, 0, 0)
          result.confidenceMasks?.forEach(m => m.close())

          userCallback!(maskCanvas)
          resolve()
        })
      })
    },
    close() {
      try { segmenter.close() } catch { /* already closed */ }
    },
  }
}
