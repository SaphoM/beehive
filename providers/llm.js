// ============================================================
// providers/llm.js
// Pluggable LLM-provider abstraction for the Meeting Intelligence pipeline.
// See meetingIntelligence.js for how runJob() consumes this.
// ============================================================
// Interface every adapter implements:
//   generate(transcriptText: string, opts: { segments?: Array<...> }) =>
//     Promise<{ summaryMarkdown: string, actionItems: Array<{owner?, task, due_date?, priority?}> }>
//
// summaryMarkdown uses the exact bounded markdown subset FathomPanel.tsx (and
// the new LiteMarkdown component it shares with MeetingNotesPanel.tsx)
// already renders: ##/### headers, **bold**, [text](url) links, "- " bullets.
// The prompt below is written to stay inside that subset deliberately, so no
// new renderer capability is ever needed.

const PROMPT_INSTRUCTIONS = `You are summarizing a business meeting transcript. Produce a structured summary using ONLY this markdown subset: "## " and "### " headers, "**bold**", "[text](url)" links, and "- " bullet lists. Do not use any other markdown syntax (no tables, no numbered lists, no code blocks, no nested bullets).

Structure your response in this exact order, using "## " for each section header:

## Executive Summary
A short paragraph overview (2-4 sentences).

## Decisions Made
Bullet list of concrete decisions. Omit this section entirely if none were made.

## Action Items
Bullet list, one per item, format: "**Owner** — Task (Due: date if mentioned, Priority: level if inferable)". If no owner is stated, omit the "Owner —" prefix rather than guessing one.

## Questions Raised
Bullet list of open questions needing follow-up. Omit if none.

## Risks
Bullet list of potential blockers or risks mentioned. Omit if none.

## Timeline
Bullet list of chronological discussion highlights with approximate time markers if inferable from the transcript.

Never invent names, dates, or facts not present in the transcript. If speaker labels in the transcript are generic ("Speaker 0", "Speaker 1"), keep them generic — never assume or assign a real identity to a generic label.`

// ------------------------------------------------------------
// createLLMProvider — factory, same graceful-null contract as
// createTranscriptionProvider() in providers/transcription.js.
// ------------------------------------------------------------
export function createLLMProvider() {
  const kind = (process.env.LLM_PROVIDER || '').toLowerCase()

  if (kind === 'openai') {
    if (!process.env.OPENAI_API_KEY) return null
    return new OpenAILLMProvider(process.env.OPENAI_API_KEY)
  }
  if (kind === 'anthropic') {
    if (!process.env.ANTHROPIC_API_KEY) return null
    return new AnthropicLLMProvider(process.env.ANTHROPIC_API_KEY)
  }
  if (kind === 'azure') {
    if (!process.env.AZURE_OPENAI_API_KEY || !process.env.AZURE_OPENAI_ENDPOINT || !process.env.AZURE_OPENAI_DEPLOYMENT) return null
    return new AzureOpenAILLMProvider(process.env.AZURE_OPENAI_API_KEY, process.env.AZURE_OPENAI_ENDPOINT, process.env.AZURE_OPENAI_DEPLOYMENT)
  }
  return null
}

// Parses the LLM's "## Action Items" bullet section back into structured
// {owner?, task, due_date?, priority?} objects for meeting_intelligence
// .action_items (jsonb) — the UI's chip/list rendering wants structured
// data, not just markdown text, even though the full summary is stored as
// markdown too (summaryMarkdown is the source of truth for display;
// actionItems is a best-effort structured extraction of one section of it).
function extractActionItems(markdown) {
  const section = markdown.match(/## Action Items\n([\s\S]*?)(?=\n## |\n?$)/)
  if (!section) return []
  const lines = section[1].split('\n').map(l => l.trim()).filter(l => l.startsWith('- '))
  return lines.map(line => {
    const body = line.slice(2).trim()
    const ownerMatch = body.match(/^\*\*(.+?)\*\*\s*—\s*(.*)$/)
    const task = ownerMatch ? ownerMatch[2] : body
    const owner = ownerMatch ? ownerMatch[1] : undefined
    const dueMatch = task.match(/\(Due:\s*([^,)]+)/i)
    const priorityMatch = task.match(/Priority:\s*([^,)]+)\)/i)
    return {
      ...(owner ? { owner } : {}),
      task: task.replace(/\s*\((Due:[^)]*)?\)?\s*$/i, '').trim(),
      ...(dueMatch ? { due_date: dueMatch[1].trim() } : {}),
      ...(priorityMatch ? { priority: priorityMatch[1].trim() } : {}),
    }
  })
}

function buildUserPrompt(transcriptText) {
  return `${PROMPT_INSTRUCTIONS}\n\n---\nTRANSCRIPT:\n${transcriptText}`
}

// ------------------------------------------------------------
// OpenAI (Chat Completions)
// ------------------------------------------------------------
class OpenAILLMProvider {
  constructor(apiKey) {
    this.apiKey = apiKey
    this.name = 'openai'
  }

  async generate(transcriptText) {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: buildUserPrompt(transcriptText) }],
        temperature: 0.2,
      }),
    })
    if (!resp.ok) {
      const body = await resp.text().catch(() => '')
      throw new Error(`OpenAI summary generation failed (${resp.status}): ${body.slice(0, 300)}`)
    }
    const json = await resp.json()
    const summaryMarkdown = json.choices?.[0]?.message?.content ?? ''
    return { summaryMarkdown, actionItems: extractActionItems(summaryMarkdown) }
  }
}

// ------------------------------------------------------------
// Anthropic (Messages API)
// ------------------------------------------------------------
class AnthropicLLMProvider {
  constructor(apiKey) {
    this.apiKey = apiKey
    this.name = 'anthropic'
  }

  async generate(transcriptText) {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 2000,
        messages: [{ role: 'user', content: buildUserPrompt(transcriptText) }],
      }),
    })
    if (!resp.ok) {
      const body = await resp.text().catch(() => '')
      throw new Error(`Anthropic summary generation failed (${resp.status}): ${body.slice(0, 300)}`)
    }
    const json = await resp.json()
    const summaryMarkdown = json.content?.[0]?.text ?? ''
    return { summaryMarkdown, actionItems: extractActionItems(summaryMarkdown) }
  }
}

// ------------------------------------------------------------
// Azure OpenAI (Chat Completions, deployment-scoped endpoint)
// ------------------------------------------------------------
class AzureOpenAILLMProvider {
  constructor(apiKey, endpoint, deployment) {
    this.apiKey = apiKey
    this.endpoint = endpoint.replace(/\/$/, '')
    this.deployment = deployment
    this.name = 'azure-openai'
  }

  async generate(transcriptText) {
    const url = `${this.endpoint}/openai/deployments/${this.deployment}/chat/completions?api-version=2024-06-01`
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'api-key': this.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: buildUserPrompt(transcriptText) }],
        temperature: 0.2,
      }),
    })
    if (!resp.ok) {
      const body = await resp.text().catch(() => '')
      throw new Error(`Azure OpenAI summary generation failed (${resp.status}): ${body.slice(0, 300)}`)
    }
    const json = await resp.json()
    const summaryMarkdown = json.choices?.[0]?.message?.content ?? ''
    return { summaryMarkdown, actionItems: extractActionItems(summaryMarkdown) }
  }
}
