// Everything that talks to the Claude API lives in this file.
//
// There are three calls:
//   coachTurn()  the conversation itself, streamed word by word, with three
//                tools the coach can use to put buttons in front of the student
//   summarise()  turns a finished conversation into the "Your moment" page,
//                as structured JSON
//   helpSay()    the "Aa" button: sentence starters or clearer wordings

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

export const MODEL = process.env.MOMENTZ_MODEL || 'claude-opus-5-5';

// The client reads ANTHROPIC_API_KEY from the environment. The key stays on
// the server; the browser only ever talks to our own /api routes.
let client;
function anthropic() {
  client ??= new Anthropic();
  return client;
}

// ---------------------------------------------------------------------------
// The coach's instructions
// ---------------------------------------------------------------------------

export const OPENING_LINE =
  "Walk me through it, from just before the moment to just after. Don't tidy it up: the messy version has the useful bits in it.";

const COACH_PROMPT = `You are the coach in Momentz, an online study coach for university students. A student has picked one moment from their week of studying (a seminar, a lab, a piece of feedback, some individual study) and is talking it through with you. They leave with one small thing to try next time, written in their own words.

Many students think "reflective writing" is vague and pointless, and Momentz exists to get past that. So this is a conversation about one concrete moment, and it ends in a concrete, testable action. Never use the words "reflection", "reflect", "reflective" or "debrief".

# The shape of the conversation

The conversation follows an After Action Review, one step at a time:

1. What happened. The app has already asked the student to walk you through the moment, so their first message is their answer. If it is thin, ask for the part that is missing. Messy is fine.
2. What they expected to happen before it started. Then ask them to name the difference between that and what happened, in a few words of their own.
3. What got in the way, in that exact moment. Go for the specific second, not a general explanation of what kind of student they are.
4. What they will try next time: one small thing, in the form "When… I'll…", and when they will next get the chance to try it.

Move on when the student has given you something real for a step. You don't need a perfect answer, and you can skip a step the student has already covered.

# Signpost, don't supply

This is the rule that matters most. You can point the student towards places worth looking, but you never state the insight, the cause or the action for them. Everything the student keeps must be something they said.

In practice:
- Ask, don't tell. Don't interpret what happened, diagnose the student, or tell them what their problem "really" is.
- Don't suggest what they should do next time, even if they ask you to. If they ask, say that it works better when it's theirs, and help them get there with a smaller question (for example, what the first two seconds of doing it differently would look like).
- Use the student's own words back to them. When they have named something, keep their name for it.
- A good action is small, the student will notice when it's time to do it, someone could see them do it, and they can try it this week. If what they offer is vague ("be more confident", "prepare better"), ask what it would look like in the moment, or what the cue would be. Don't rewrite it for them.
- Don't praise or evaluate their answers ("great insight"). A short acknowledgement ("Got it.") is enough.

# How to write

- One question per message. Short: usually one to three sentences.
- Plain, warm, everyday words. Many students are working in a second language, so avoid idioms and academic vocabulary.
- Plain text only. No markdown, lists, headings or emoji.
- If the student writes in mixed or imperfect English, don't correct it. Respond to what they mean.

# Your tools

You have tools that put buttons in front of the student. Use at most one per message, and always write your message text before the tool call. The buttons appear directly under your message, so your text should lead into them.

- offer_places_to_look: when the student is stuck on what got in the way (answers like "I don't know" or "I just didn't"), offer a few places people often start looking. They are places, not explanations.
- offer_earlier_moments: only available when the student has earlier moments. Once they have named what got in the way, you may ask once whether they want to see if something like it has come up before. If they say yes you will be given their earlier moments. Point at what looks similar and ask what they make of it; don't draw the conclusion for them.
- offer_wrap_up: when the student has said a "When… I'll…" action in their own words and when they will try it. Say one short closing line first. The app then builds their summary page from the conversation.

# Staying in your lane

You are a study coach, not a tutor or a counsellor. If the student asks you to explain course content or write their work, say that's not what this is for and return to the moment. If the student describes serious distress or says anything that suggests they may be at risk, stop the coaching steps, respond with care, and encourage them to contact their university's student support or wellbeing service, or emergency services if they are in immediate danger.`;

const TOOLS = [
  {
    name: 'offer_places_to_look',
    description:
      'Show the student a few buttons naming places worth looking for what got in the way. Use this when they are stuck on that question. Each place is a short, neutral label of two to five words (for example "Timing", "How ready the idea felt", "Finding the words", "What others were doing"), fitted to this student\'s moment. A place names somewhere to look and must not contain an explanation or a judgement. The app adds a "Something else" button itself. You will be told which one the student picked, and should then ask one question that looks more closely at that place.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        places: {
          type: 'array',
          items: { type: 'string' },
          description: 'Three or four short labels.'
        }
      },
      required: ['places'],
      additionalProperties: false
    }
  },
  {
    name: 'offer_wrap_up',
    description:
      'Show the student a button that opens their summary page. Use this once the student has stated a "When… I\'ll…" action in their own words and said when they will try it. The student can still carry on talking instead.',
    strict: true,
    input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false }
  }
];

const EARLIER_MOMENTS_TOOL = {
  name: 'offer_earlier_moments',
  description:
    'Show the student "Yes, show me" and "Not now" buttons, asking whether they want to see if something like this has come up in their earlier moments. Use this at most once in a conversation, after the student has named what got in the way. If they say yes, you receive their earlier moments in their own words.',
  strict: true,
  input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false }
};

export const SOMETHING_ELSE = 'Something else';

// ---------------------------------------------------------------------------
// Reading and extending a stored conversation
// ---------------------------------------------------------------------------

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
    if (!text) throw new CoachError(400, 'Write a message first.');
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
  if (!text && !meta.picked) throw new CoachError(400, 'Pick an option or write a message.');
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

// ---------------------------------------------------------------------------
// Call 1: the conversation
// ---------------------------------------------------------------------------

function contextBlock(moment, profile) {
  const lines = [`The moment the student chose to go through: "${moment.title}"`, `Today's date: ${moment.createdAt.slice(0, 10)}`];
  if (profile.name) lines.push(`The student's name: ${profile.name}`);
  if (profile.course) lines.push(`What they study: ${profile.course}`);
  lines.push(`The app opened the conversation for you with: "${OPENING_LINE}"`);
  return lines.join('\n');
}

/**
 * Ask Claude for the coach's next message and stream it.
 *
 * `moment.messages` must already end with the student's message. `onText` is
 * called with each piece of text as it arrives. Returns the finished message,
 * whose `content` the caller appends to the conversation unchanged.
 */
export async function coachTurn({ moment, profile, hasEarlierMoments, onText, signal }) {
  const stream = anthropic().messages.stream(
    {
      model: MODEL,
      max_tokens: 16000,
      // Thinking is always on for this model; effort sets how much of it there
      // is. Coach replies are short questions, so favour a quick response.
      output_config: { effort: 'low' },
      system: [
        { type: 'text', text: COACH_PROMPT },
        { type: 'text', text: contextBlock(moment, profile) }
      ],
      tools: hasEarlierMoments ? [...TOOLS, EARLIER_MOMENTS_TOOL] : TOOLS,
      tool_choice: { type: 'auto', disable_parallel_tool_use: true },
      // Cache the conversation so far, so each turn only pays full price for
      // what is new.
      cache_control: { type: 'ephemeral' },
      messages: moment.messages
    },
    { signal }
  );

  let textBlocks = 0;
  for await (const event of stream) {
    if (event.type === 'content_block_start' && event.content_block.type === 'text') {
      if (textBlocks++ > 0) onText('\n\n');
    } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      onText(event.delta.text);
    }
  }

  const message = await stream.finalMessage();

  // Always look at stop_reason before using the content.
  if (message.stop_reason === 'refusal') {
    throw new CoachError(422, "The coach couldn't respond to that. Try putting it another way.");
  }
  let content = message.content;
  if (message.stop_reason === 'max_tokens') {
    // A tool call that was cut off part-way can't be trusted, so drop it.
    content = content.filter((block) => block.type !== 'tool_use');
  }
  if (!content.some((block) => block.type === 'text' || block.type === 'tool_use')) {
    throw new CoachError(502, 'The coach sent an empty reply. Please try again.');
  }
  return { ...message, content };
}

// ---------------------------------------------------------------------------
// Call 2: the summary page, as structured output
// ---------------------------------------------------------------------------

export const CATEGORIES = ['Seminars', 'Lectures', 'Writing', 'Exams', 'Group work', 'Labs', 'Independent study', 'Placement', 'Other'];

const Summary = z.object({
  short_title: z.string().describe('A two to four word label for the moment, e.g. "Week 6 seminar" or "Essay 2 feedback".'),
  category: z.enum(CATEGORIES),
  what_happened: z.string().describe("One sentence on what happened, built from the student's own phrases."),
  expected_vs_happened: z.string().describe("The student's own few-word name for the difference between what they expected and what happened."),
  what_got_in_the_way: z.string().describe("What got in the way, in the student's words, as closely as possible to how they said it."),
  when: z.string().describe('The cue of the action: what completes "When…". Lower case, no leading "when", no full stop.'),
  will: z.string().describe('The action: what completes "I\'ll…". Lower case, no leading "I\'ll", no full stop.'),
  action_title: z.string().describe('A two to five word name for the action, e.g. "Read feedback twice".'),
  try_at: z.string().describe('Where and when the student said they will next try it, e.g. "Week 7 seminar, Tuesday 10:00".'),
  phrases: z.array(z.string()).describe('Only if the action involves saying something out loud: up to three short opening phrases the student could use. Otherwise empty.'),
  own_words: z.array(z.string()).describe('Up to four short, memorable phrases the student said, copied exactly from their messages.')
});

const SUMMARY_PROMPT = `You fill in the summary page of Momentz, a study coach for university students. You are given a conversation between a student and the coach about one moment from the student's week.

The page shows the student what they worked out, so it must be written in their words, not yours. Build every field from what the student said. Quote or lightly trim their phrasing; don't paraphrase it into tidier or more academic language, and don't add insights, causes or advice they didn't state.

If the conversation ended before the student got to a field, leave that field as an empty string (or an empty list). Never invent an action the student didn't state.`;

function normalise(text) {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function summarise(moment) {
  const response = await anthropic().messages.parse({
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: 'medium', format: zodOutputFormat(Summary) },
    system: SUMMARY_PROMPT,
    messages: [
      {
        role: 'user',
        content: `The moment the student chose: "${moment.title}"\n\n<conversation>\n${toTranscript(moment)}\n</conversation>`
      }
    ]
  });

  if (response.stop_reason === 'refusal' || !response.parsed_output) {
    throw new CoachError(502, "Couldn't build the summary from this conversation. Please try again.");
  }

  // "In your words" is a promise the page makes, so check it: only keep
  // quotes that really appear in what the student wrote.
  const said = normalise(studentText(moment));
  const summary = response.parsed_output;
  summary.own_words = summary.own_words
    .map((quote) => quote.trim().replace(/^["“]+|["”]+$/g, ''))
    .filter((quote) => quote && said.includes(normalise(quote)))
    .slice(0, 4);
  summary.phrases = summary.phrases.slice(0, 3);
  return summary;
}

// ---------------------------------------------------------------------------
// Call 3: "Help me say it"
// ---------------------------------------------------------------------------

const Suggestions = z.object({ suggestions: z.array(z.string()) });

const HELP_SAY_PROMPT = `You power the "Help me say it" button in Momentz, a study coach for university students, many of whom are working in a second language. The student is answering the coach's latest question and wants help putting their answer into words.

If the student has written a draft, give three clearer ways to say what the draft already says, in simple everyday English and in the first person. Keep their meaning and their key words. Don't add ideas, reasons or details that aren't in the draft.

If there is no draft, give three short sentence starters that fit the coach's question and that the student could finish themselves, each ending with "…". A starter opens a sentence; it must not contain an answer.`;

export async function helpSay(moment, draft) {
  const response = await anthropic().messages.parse({
    model: MODEL,
    max_tokens: 4000,
    output_config: { effort: 'low', format: zodOutputFormat(Suggestions) },
    system: HELP_SAY_PROMPT,
    messages: [
      {
        role: 'user',
        content: `<conversation>\n${toTranscript(moment)}\n</conversation>\n\n<draft>\n${draft}\n</draft>`
      }
    ]
  });
  if (response.stop_reason === 'refusal' || !response.parsed_output) {
    throw new CoachError(502, "Couldn't come up with suggestions. Please try again.");
  }
  return response.parsed_output.suggestions.map((s) => s.trim()).filter(Boolean).slice(0, 3);
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** An error with an HTTP status and a message that is safe to show the student. */
export class CoachError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Map anything the SDK can throw to a status and a message for the student. */
export function describeError(err) {
  if (err instanceof CoachError) return { status: err.status, message: err.message };
  if (err instanceof Anthropic.AuthenticationError) {
    return { status: 500, message: 'The Claude API key was rejected. Check ANTHROPIC_API_KEY.' };
  }
  if (err instanceof Anthropic.PermissionDeniedError || err instanceof Anthropic.NotFoundError) {
    return { status: 500, message: `This API key can't use the model "${MODEL}". Check MOMENTZ_MODEL and your account's access.` };
  }
  if (err instanceof Anthropic.RateLimitError) {
    return { status: 429, message: 'The coach is busy right now. Give it a moment and try again.' };
  }
  if (err instanceof Anthropic.BadRequestError) {
    return { status: 500, message: `The Claude API rejected the request: ${err.message}` };
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return { status: 503, message: "Couldn't reach the Claude API. Check your internet connection and try again." };
  }
  if (err instanceof Anthropic.APIError) {
    return { status: 503, message: 'The Claude API had a problem. Please try again in a moment.' };
  }
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    return {
      status: 500,
      message: process.env.VERCEL
        ? "The coach isn't connected yet. Add your Claude API key as ANTHROPIC_API_KEY in the Vercel project's environment variables and redeploy."
        : "The coach isn't connected yet. Add your Claude API key as ANTHROPIC_API_KEY in a .env file and restart the server."
    };
  }
  return { status: 500, message: 'Something went wrong. Please try again.' };
}
