import { AGENT_SERVICE_URL } from '../config/constants';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Streams a chat turn through p360-local-ai's agent-service instead of
// Azure OpenAI. All prompt-building, tool selection, and FHIR tool execution
// now happen server-side (the `carebridge` agent config) — this just sends
// the running conversation and renders whatever text streams back.
//
// `messages` is plain {role, content} history (no system prompt, no
// tool_calls bookkeeping — that's all internal to agent-service now).
// `onPatientContext` fires once per turn if the server resolves a single
// patient via its searchFhirPatient tool call, replacing the old
// currentPatientRef-from-raw-tool-result wiring.
export async function sendToAgentChat(messages, onTextChunk = null, onPatientContext = null, onRetryWait = null, retryCount = 0) {
  const token = localStorage.getItem('cb_token') || '';
  const res = await fetch(`${AGENT_SERVICE_URL}/v1/agents/carebridge/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ messages })
  });

  if (!res.ok && res.status >= 500 && retryCount < 2) {
    // No guarantee agent-service/vLLM returns Azure's "try again in Ns"
    // shape, so just back off with a fixed delay instead of parsing one.
    const waitSec = 3;
    if (onRetryWait) onRetryWait(waitSec);
    await sleep(waitSec * 1000);
    if (onRetryWait) onRetryWait(0);
    return sendToAgentChat(messages, onTextChunk, onPatientContext, onRetryWait, retryCount + 1);
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Chat request failed (${res.status}): ${errText.slice(0, 300)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let fullContent = '';
  let buffer = '';
  let pendingEvent = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      if (line.startsWith('event: ')) {
        pendingEvent = line.slice(7).trim();
        continue;
      }
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (!data) { pendingEvent = null; continue; }
      if (data === '[DONE]') { pendingEvent = null; continue; }

      try {
        const parsed = JSON.parse(data);
        if (pendingEvent === 'patient_context') {
          if (onPatientContext) onPatientContext(parsed);
        } else if (parsed.error) {
          throw new Error(parsed.error);
        } else if (parsed.content) {
          fullContent += parsed.content;
          if (onTextChunk) onTextChunk(parsed.content);
        }
      } catch (e) {
        if (e instanceof SyntaxError) continue;
        throw e;
      }
      pendingEvent = null;
    }
  }

  return { content: fullContent };
}

// Single-shot, non-streaming completion for the dashboard's non-agentic
// prompts (care-gap JSON extraction, outreach message drafts, fallback
// action generation) — same /v1/chat/completions contract P360 frontend's
// services/ai.js#callAI already uses against this same service.
export async function callAI(systemPrompt, userMessage, { temperature = 0.4, maxTokens = 500 } = {}) {
  const token = localStorage.getItem('cb_token') || '';
  const res = await fetch(`${AGENT_SERVICE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      system_prompt: systemPrompt,
      user_message: userMessage,
      temperature,
      max_tokens: maxTokens,
    }),
  });

  if (!res.ok) throw new Error(`AI call failed (${res.status})`);
  const data = await res.json();
  return (data.content || '').trim();
}
