// ============================================================
// providers/transcription.js
// Pluggable transcription-provider abstraction for the Meeting Intelligence
// pipeline. See meetingIntelligence.js for how runJob() consumes this.
// ============================================================
// Interface every adapter implements:
//   transcribe(audioBuffer: Buffer, opts: { mimeType: string }) =>
//     Promise<{ text: string, segments: Array<{ speaker?: string, start: number, end: number, text: string }> | null }>
//
// Speaker attribution: when the provider supports diarization, `segments`
// carries a `speaker` field per the raw provider labels (e.g. "0", "1" for
// Whisper via a diarization layer, or Deepgram's own speaker indices).
// Nothing in this module — or anywhere downstream — ever maps a raw speaker
// label to a real BeeHive participant name; per the mission's explicit
// "never fabricate identities" requirement, that mapping (only when
// confidence is high) is deliberately left as a documented future
// extension point, not implemented here. Until then, meeting_intelligence.js
// exposes segments exactly as "Speaker 0", "Speaker 1", etc.

// ------------------------------------------------------------
// createTranscriptionProvider — factory
// ------------------------------------------------------------
// Reads TRANSCRIPTION_PROVIDER + the matching API key from process.env.
// Returns null (not a throw) when unconfigured — the caller (runJob) treats
// null as "mark this job skipped_no_provider", a terminal-but-not-error
// state. Recording itself and meeting reliability are never affected by a
// missing/misconfigured provider; this factory's whole job is to make that
// graceful fallback trivial to reach from the one call site.
export function createTranscriptionProvider() {
  const kind = (process.env.TRANSCRIPTION_PROVIDER || '').toLowerCase()

  if (kind === 'whisper') {
    if (!process.env.OPENAI_API_KEY) return null
    return new WhisperProvider(process.env.OPENAI_API_KEY)
  }
  if (kind === 'deepgram') {
    if (!process.env.DEEPGRAM_API_KEY) return null
    return new DeepgramProvider(process.env.DEEPGRAM_API_KEY)
  }
  return null
}

// ------------------------------------------------------------
// OpenAI Whisper (REST /v1/audio/transcriptions)
// ------------------------------------------------------------
class WhisperProvider {
  constructor(apiKey) {
    this.apiKey = apiKey
    this.name = 'whisper'
  }

  async transcribe(audioBuffer, opts = {}) {
    const form = new FormData()
    form.append('file', new Blob([audioBuffer], { type: opts.mimeType || 'audio/ogg' }), 'meeting-audio.ogg')
    form.append('model', 'whisper-1')
    form.append('response_format', 'verbose_json')

    const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
    })
    if (!resp.ok) {
      const body = await resp.text().catch(() => '')
      throw new Error(`Whisper transcription failed (${resp.status}): ${body.slice(0, 300)}`)
    }
    const json = await resp.json()
    // Whisper's verbose_json includes per-segment timestamps but no speaker
    // diarization at all — segments carry timing only, no `speaker` field,
    // consistent with "never fabricate identities."
    const segments = Array.isArray(json.segments)
      ? json.segments.map(s => ({ start: s.start, end: s.end, text: s.text?.trim() ?? '' }))
      : null
    return { text: json.text ?? '', segments }
  }
}

// ------------------------------------------------------------
// Deepgram (REST /v1/listen, prerecorded)
// ------------------------------------------------------------
class DeepgramProvider {
  constructor(apiKey) {
    this.apiKey = apiKey
    this.name = 'deepgram'
  }

  async transcribe(audioBuffer, opts = {}) {
    const params = new URLSearchParams({ model: 'nova-2', diarize: 'true', punctuate: 'true', smart_format: 'true' })
    const resp = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
      method: 'POST',
      headers: {
        Authorization: `Token ${this.apiKey}`,
        'Content-Type': opts.mimeType || 'audio/ogg',
      },
      body: audioBuffer,
    })
    if (!resp.ok) {
      const body = await resp.text().catch(() => '')
      throw new Error(`Deepgram transcription failed (${resp.status}): ${body.slice(0, 300)}`)
    }
    const json = await resp.json()
    const alt = json.results?.channels?.[0]?.alternatives?.[0]
    const text = alt?.transcript ?? ''
    // Deepgram's diarize:true labels each word with a numeric speaker index —
    // group consecutive same-speaker words into segments. Real diarization
    // confidence, never a fabricated name (per module-level comment above).
    const words = alt?.words ?? []
    const segments = []
    let current = null
    for (const w of words) {
      const speaker = w.speaker != null ? `Speaker ${w.speaker}` : undefined
      if (current && current.speaker === speaker) {
        current.text += ` ${w.punctuated_word ?? w.word}`
        current.end = w.end
      } else {
        if (current) segments.push(current)
        current = { speaker, start: w.start, end: w.end, text: w.punctuated_word ?? w.word }
      }
    }
    if (current) segments.push(current)
    return { text, segments: segments.length > 0 ? segments : null }
  }
}
