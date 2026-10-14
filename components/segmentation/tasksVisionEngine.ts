// Adapter for Google's current MediaPipe Tasks Vision ImageSegmenter,
// wrapped behind the same SegmentationEngine interface the legacy engine
// implements. This is the engine createSegmentationEngine() tries first —
// GPU-delegated inference, actively maintained by Google (the legacy
// SelfieSegmentation API this replaces is discontinued).
//
// The one piece of real adapter work: ImageSegmenter's result shape is not
// a drawable CanvasImageSource like the legacy engine's segmentationMask —
// it's an MPMask exposing raw confidence values. This module converts that
// into a small canvas (alpha channel = confidence) so everything downstream
// (processMask() in RoomPage.tsx) keeps working unchanged.
//
// Measured facts this implementation is built on (probed with the real
// engine, not assumed): the ImageSegmenter returns its confidence mask at
// the INPUT's resolution, and reading it back forces a GPU→CPU sync that
// Chrome itself flags as a high-severity "GPU stall due to ReadPixels".
// Feeding it the raw camera frame therefore meant a ~3.7 MB float readback
// + a fresh ImageData allocation + a ~921k-iteration conversion loop EVERY
// frame at 720p (worse at 1080p) — for zero quality benefit, since the
// model resizes its input to 256×256 internally no matter what we feed it.
// So: the video is first drawn (GPU-side) onto a small internal canvas
// capped at SEG_INPUT_W wide, which bounds the readback/conversion cost to
// ~1/6th of 720p — constant regardless of camera resolution — and lands the
// returned mask at almost exactly the ~480px working resolution
// processMask() downscales to anyway.
import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision'
import type { SegmentationEngine } from './types'

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
// Verified reachable (HTTP 200). If it ever moves, createFromOptions()
// throws and createSegmentationEngine() falls back to the legacy engine.
const SELFIE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite'

// Segmentation input width — the model's internal input is 256×256, so
// anything ≥ ~2× that preserves every bit of quality the model can deliver
// while keeping the mask readback small and camera-resolution-independent.
const SEG_INPUT_W = 512

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

  // Small input canvas the video is downscaled onto before inference (see
  // module comment). The mask canvas mirrors whatever the segmenter returns.
  const inputCanvas = document.createElement('canvas')
  const inputCtx = inputCanvas.getContext('2d')!
  const maskCanvas = document.createElement('canvas')
  const maskCtx = maskCanvas.getContext('2d')!

  // Persistent conversion buffers — allocating a multi-MB ImageData per
  // frame caused constant GC churn (visible as jitter during movement).
  // Reallocated only when the mask geometry changes, which in practice is
  // once per session.
  let imageData: ImageData | null = null
  let pixels32: Uint32Array | null = null

  let lastTimestamp = -1
  let userCallback: ((mask: CanvasImageSource) => void) | null = null

  return {
    onResults(callback) {
      userCallback = callback
    },
    async send(video) {
      if (!userCallback) return
      const vw = video.videoWidth || 1280
      const vh = video.videoHeight || 720
      const iw = Math.min(SEG_INPUT_W, vw)
      const ih = Math.round(iw * vh / vw)
      if (inputCanvas.width !== iw || inputCanvas.height !== ih) {
        inputCanvas.width = iw; inputCanvas.height = ih
      }
      inputCtx.drawImage(video, 0, 0, iw, ih)

      // segmentForVideo requires strictly increasing timestamps; performance.now()
      // is monotonic but guard against two frames landing on the same millisecond.
      const ts = Math.max(performance.now(), lastTimestamp + 1)
      lastTimestamp = ts

      await new Promise<void>((resolve) => {
        segmenter.segmentForVideo(inputCanvas, ts, (result) => {
          const confidence = result.confidenceMasks?.[0]
          if (!confidence) { resolve(); return }

          const w = confidence.width, h = confidence.height
          if (maskCanvas.width !== w || maskCanvas.height !== h || !imageData) {
            maskCanvas.width = w; maskCanvas.height = h
            imageData = maskCtx.createImageData(w, h)
            pixels32 = new Uint32Array(imageData.data.buffer)
          }
          // Uint8 view of the confidences (the getter converts from the
          // mask's native storage) — one byte per pixel, already 0–255.
          const bytes = confidence.getAsUint8Array()
          const px = pixels32!
          // One 32-bit store per pixel: alpha = confidence, RGB = white
          // (little-endian ABGR — downstream only ever reads the alpha).
          for (let i = 0; i < bytes.length; i++) {
            px[i] = (bytes[i] << 24) | 0x00ffffff
          }
          maskCtx.putImageData(imageData!, 0, 0)
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
