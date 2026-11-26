// How a conversation is stored, extended and shown. No DOM and no network in
// here: the pages use it to build and draw a chat, and the server imports the
// same file to read a chat it is sent.
//
// A moment's `messages` are kept exactly as the Claude API takes them, and
// `meta` holds display details the API doesn't need, keyed by message index.

export const OPENING_LINE =
  "Walk me through it, from just before the moment to just after. Don't tidy it up: the messy version has the useful bits in it.";

export const SOMETHING_ELSE = 'Something else';

function toolUses(message) {
  if (!message || message.role !== 'assistant' || !Array.isArray(message.content)) return [];
  return message.content.filter((block) => block.type === 'tool_use');
}

/** Tool calls in the coach's last message that the student hasn't answered yet. */
export function pendingToolUses(moment) {
  return toolUses(moment.messages.at(-1));
}

function placesFrom(toolUse) {
  const places = Array.isArray(toolUse.input?.places) ? toolUse.input.places : [];
  return places
    .filter((p) => typeof p === 'string' && p.trim())
    .map((p) => p.trim())
    .slice(0, 4);
}

function describeEarlierMoments(earlier) {
  if (!earlier.length) return 'The student has no earlier moments with a summary yet.';
  return earlier
    .map((m) => {
      const s = m.summary;
      const lines = [`Moment: ${s.short_title || m.title} (${m.createdAt.slice(0, 10)})`];
      if (s.expected_vs_happened) lines.push(`Their name for the difference: ${s.expected_vs_happened}`);
      if (s.what_got_in_the_way) lines.push(`What got in the way, in their words: ${s.what_got_in_the_way}`);
      if (s.when && s.will) lines.push(`What they decided to try: When ${s.when}, I'll ${s.will}`);
      return lines.join('\n');
    })
    .join('\n\n');
}

/**
 * Turn what the student just did (typed something, or pressed a button the
 * coach offered) into the next user message for the API.
 *
 * When the coach's last message ended in a tool call, the API requires the
 * next user message to answer it with a tool_result. A button press is that
 * answer. If the student typed instead, we say so and attach their text.
 */
export function buildUserMessage(moment, { text, choice }, earlier) {
  const pending = pendingToolUses(moment);
  const meta = {};

  if (!pending.length) {
    if (!text) throw new Error('Write a message first.');
    return { message: { role: 'user', content: text }, meta };
  }

  const content = pending.map((toolUse) => {
    let result = 'The student did not press a button. They wrote a reply instead.';
    if (toolUse.name === 'offer_places_to_look' && choice) {
      meta.picked = choice;
      result =
        choice === SOMETHING_ELSE
          ? 'The student picked "Something else": they have a different place in mind. Ask what it is.'
          : `The student picked: "${choice}".`;
    } else if (toolUse.name === 'offer_earlier_moments' && choice === 'yes') {
      meta.picked = 'yes';
      meta.comparedEarlier = true;
      result = `The student said yes. Their earlier moments:\n\n${describeEarlierMoments(earlier)}`;
    } else if (toolUse.name === 'offer_earlier_moments' && choice === 'no') {
      meta.picked = 'no';
      result = 'The student said not now. Carry on without it.';
    } else if (toolUse.name === 'offer_wrap_up') {
      result = 'The student is carrying on with the conversation.';
    }
    return { type: 'tool_result', tool_use_id: toolUse.id, content: result };
  });

  if (text) content.push({ type: 'text', text });
  if (!text && !meta.picked) throw new Error('Pick an option or write a message.');
  return { message: { role: 'user', content }, meta };
}

/** The conversation as the chat screen shows it. */
export function toDisplay(moment) {
  const items = [{ role: 'coach', text: OPENING_LINE }];
  const widgets = new Map();

  moment.messages.forEach((message, index) => {
    const meta = moment.meta?.[index] ?? {};
    const blocks = typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : message.content;

    if (message.role === 'user') {
      for (const block of blocks) {
        if (block.type === 'tool_result') {
          const widget = widgets.get(block.tool_use_id);
          if (widget) {
            widget.answered = true;
            widget.picked = meta.picked ?? null;
          }
        } else if (block.type === 'text') {
          items.push({ role: 'student', text: block.text, spoken: meta.spoken ?? null });
        }
      }
      return;
    }

    const text = blocks
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n\n')
      .trim();
    const item = { role: 'coach', text };
    for (const toolUse of toolUses(message)) {
      item.widget = { tool: toolUse.name, answered: false, picked: null };
      if (toolUse.name === 'offer_places_to_look') item.widget.options = [...placesFrom(toolUse), SOMETHING_ELSE];
      widgets.set(toolUse.id, item.widget);
    }
    if (item.text || item.widget) items.push(item);
  });

  return items;
}

/** The conversation as plain text, for the summary and "help me say it" calls. */
export function toTranscript(moment) {
  return toDisplay(moment)
    .map((item) => {
      if (item.role === 'student') return `STUDENT: ${item.text}`;
      let line = `COACH: ${item.text}`;
      if (item.widget?.tool === 'offer_places_to_look') {
        line += `\n[The coach offered places to look: ${item.widget.options.join(', ')}.`;
        line += item.widget.picked ? ` The student picked "${item.widget.picked}".]` : ']';
      }
      return line;
    })
    .join('\n\n');
}

export function studentText(moment) {
  return toDisplay(moment)
    .filter((item) => item.role === 'student')
    .map((item) => item.text)
    .join('\n');
}
