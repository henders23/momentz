// The three things the coach does, as the pages call them. Each one sends the
// conversation of one moment to our own server, which asks Claude and sends
// the answer back; what comes back is saved in this browser (store.js).

import { api } from './common.js';
import { buildUserMessage } from './conversation.js';
import { addTurn, forCoach, getMoment, setSummary } from './store.js';

const conversation = ({ title, createdAt, messages, meta }) => ({ title, createdAt, messages, meta });

/**
 * Send what the student typed, said or picked, and stream the coach's reply:
 * `onText` gets each piece as it is written. Returns the moment, with the new
 * turn saved. If anything fails, nothing is saved.
 */
export async function sendMessage(id, { text = '', choice = '', spokenSeconds }, onText) {
  const { moment, earlier, profile } = forCoach(id);
  const { message, meta } = buildUserMessage(moment, { text: text.trim().slice(0, 8000), choice }, earlier);
  if (Number.isFinite(spokenSeconds)) meta.spoken = Math.round(spokenSeconds);
  const length = moment.messages.length;

  let res;
  try {
    res = await fetch('/api/turn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        moment: conversation({ ...moment, messages: [...moment.messages, message] }),
        profile,
        hasEarlierMoments: earlier.length > 0
      })
    });
  } catch {
    throw new Error("Couldn't reach the coach. Check your connection and send that again.");
  }
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "The coach isn't available right now. Please try again.");

  // The reply arrives as server-sent events: "event: <name>\ndata: <json>\n\n".
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  let reply = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let end;
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const chunk = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const event = chunk.match(/^event: (.*)$/m)?.[1];
      const data = JSON.parse(chunk.match(/^data: (.*)$/m)?.[1] ?? '{}');
      if (event === 'delta') onText?.(data.text);
      else if (event === 'done') reply = data.content;
      else if (event === 'error') throw new Error(data.message);
    }
  }
  if (!reply) throw new Error('The connection dropped before the coach finished. Please send that again.');
  return addTurn(id, { length, message, meta, reply });
}

/**
 * The moment with its summary page filled in. Claude builds the summary from
 * the conversation the first time, and again only if the conversation has
 * moved on since.
 */
export async function withSummary(id) {
  const { moment } = forCoach(id);
  if (!moment.messages.length) throw new Error("There's no conversation to sum up yet.");
  if (moment.summary && moment.summaryAtLength === moment.messages.length) return getMoment(id);
  const { summary } = await api('/summary', { method: 'POST', body: { moment: conversation(moment) } });
  return setSummary(id, summary, moment.messages.length);
}

/** "Aa": sentence starters when there is no draft, clearer wordings when there is. */
export async function helpSay(id, draft) {
  const { moment } = forCoach(id);
  const { suggestions } = await api('/help-say', { method: 'POST', body: { moment: conversation(moment), draft } });
  return suggestions;
}
