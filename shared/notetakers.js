// Known AI note-taker bots — the ONE list, shared by client and server
// (same pattern as icsBuilder.js / meetingExpiry.js) so the lobby's
// "Allow AI note-takers" explanation and the token endpoint's bypass can
// never disagree about who counts as a bot.
//
// Matching is deliberately conservative. Every commercial note-taker joins
// a meeting by driving a headless browser through the normal join page and
// names itself "<Product> Notetaker" / "<Product> Assistant" / "<Product>
// Bot" — so we require BOTH a known product word AND a bot-ish suffix
// (or the generic "AI Notetaker"/"Note Taker" phrasing). A bare product
// word is NOT enough: a human named Otter, Fathom, or Fireflies must never
// skip the waiting room. This is an opt-in convenience for the host, not a
// security boundary — a human could still type a matching name, which is
// exactly why the flag is off by default and per-room.
//
// Names come from the vendors' own join behaviour as of Sep 2026. Add a
// product here and both sides pick it up.

const PRODUCTS = [
  'fathom', 'otter', 'fireflies', 'read\\.?ai', 'tl;?dv', 'tldv', 'gong', 'chorus',
  'avoma', 'grain', 'fellow', 'sembly', 'tactiq', 'notta', 'krisp', 'supernormal',
  'circleback', 'bluedot', 'jamie', 'nyota', 'meetgeek', 'airgram', 'colibri',
  'zoom ai', 'copilot', 'gemini', 'clockwise', 'rewatch', 'vowel',
]

const SUFFIXES = [
  'note[\\s-]?taker', 'notetaker', 'notes?', 'assistant', 'bot', 'recorder', 'ai', 'scribe', 'meeting[\\s-]?assistant',
]

// "<product> ... <suffix>" in either order, case-insensitive, OR the
// vendor-agnostic phrasings bots use when unbranded. GAP allows a
// possessive and up to two filler words between the two halves, so
// "Fellow's Notetaker" and "Zoom AI Companion assistant" both match while
// the product word must still be present.
const GAP = `(?:'s|’s)?(?:[\\s'’.-]+\\w+){0,2}[\\s'’.-]*`
const PRODUCT_WITH_SUFFIX = new RegExp(
  `(?:\\b(?:${PRODUCTS.join('|')})\\b${GAP}(?:${SUFFIXES.join('|')})\\b)|(?:\\b(?:${SUFFIXES.join('|')})\\b${GAP}(?:${PRODUCTS.join('|')})\\b)`,
  'i',
)
const GENERIC = /\b(?:ai|meeting)[\s-]?(?:note[\s-]?taker|notetaker|notes|assistant|recorder|scribe)\b/i

/**
 * True if a joiner's display name identifies it as an AI note-taker bot.
 * @param {string|null|undefined} displayName
 */
export function isNotetakerName(displayName) {
  const n = String(displayName ?? '').trim()
  if (!n) return false
  return PRODUCT_WITH_SUFFIX.test(n) || GENERIC.test(n)
}
