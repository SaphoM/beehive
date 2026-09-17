// Common contract both segmentation engines (legacy MediaPipe Solutions and
// the newer MediaPipe Tasks Vision) implement. Deliberately mirrors the
// legacy SelfieSegmentation API's shape almost exactly — RoomPage.tsx's
// call sites barely change, and processMask() already treats its input as
// an opaque CanvasImageSource, so it needs zero changes regardless of which
// engine produced the mask.
export interface SegmentationEngine {
  // Registers the per-frame result callback. Called once, mirrors the
  // legacy engine's seg.onResults(cb).
  onResults(callback: (mask: CanvasImageSource) => void): void
  // Feeds one video frame in. Mirrors seg.send({ image: video }) — resolves
  // once the registered callback has fired for this frame.
  send(video: HTMLVideoElement): Promise<void>
  // Releases WASM/GPU resources. Mirrors seg.close().
  close(): void
}
