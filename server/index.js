// The Momentz web server: serves the pages in public/ and the three /api
// routes that ask Claude for something (see coach.js).
//
// It keeps nothing. Moments and the playbook live in the student's browser
// (public/js/store.js), which sends the conversation along with each request.

import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { CoachError, MODEL, coachTurn, describeError, helpSay, summarise } from './coach.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const app = express();
// Room for a long conversation: Claude's replies come back with every request.
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(root, 'public'), { extensions: ['html'] }));

// --- What the browser sends -------------------------------------------------

// The messages go to the Claude API as they are, so only let through the
// shapes a Momentz conversation is made of.
const Block = z.looseObject({ type: z.enum(['text', 'thinking', 'redacted_thinking', 'tool_use', 'tool_result']) });
const Message = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.union([z.string().min(1).max(8000), z.array(Block).min(1).max(20)])
});
const Conversation = z.object({
  title: z.string().trim().min(1).max(300),
  createdAt: z.iso.datetime(),
  messages: z.array(Message).max(300),
  meta: z.record(z.string(), z.looseObject({})).default({})
});
const Profile = z.object({ name: z.string().max(60).default(''), course: z.string().max(80).default('') });

function read(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw new CoachError(400, "That conversation couldn't be read. Reload the page and try again.");
  return result.data;
}

// --- Routes -----------------------------------------------------------------

// One coach turn. The conversation comes in, ending with the student's new
// message; the coach's reply is streamed back as server-sent events:
//   event: delta  {"text": "..."}      a piece of the reply, as it is written
//   event: done   {"content": [...]}   the finished reply, for the browser to keep
//   event: error  {"message": "..."}
app.post('/api/turn', async (req, res) => {
  const moment = read(Conversation, req.body.moment);
  const profile = read(Profile, req.body.profile ?? {});
  if (moment.messages.at(-1)?.role !== 'user') throw new CoachError(400, 'Write a message first.');

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no'
  });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  // Stop generating (and paying) if the student closes the page mid-reply.
  const abort = new AbortController();
  res.on('close', () => abort.abort());

  try {
    const reply = await coachTurn({
      moment,
      profile,
      hasEarlierMoments: req.body.hasEarlierMoments === true,
      onText: (text) => send('delta', { text }),
      signal: abort.signal
    });
    // The reply's content goes back exactly as the API returned it, thinking
    // blocks included: the API expects them unchanged on the next turn.
    send('done', { content: reply.content, usage: reply.usage });
  } catch (err) {
    if (!abort.signal.aborted) {
      console.error('Coach turn failed:', err);
      send('error', { message: describeError(err).message });
    }
  } finally {
    res.end();
  }
});

app.post('/api/summary', async (req, res) => {
  const moment = read(Conversation, req.body.moment);
  if (!moment.messages.length) throw new CoachError(400, "There's no conversation to sum up yet.");
  res.json({ summary: await summarise(moment) });
});

app.post('/api/help-say', async (req, res) => {
  const draft = typeof req.body.draft === 'string' ? req.body.draft.trim().slice(0, 4000) : '';
  res.json({ suggestions: await helpSay(read(Conversation, req.body.moment), draft) });
});

// --- Errors -----------------------------------------------------------------

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const { status, message } = describeError(err);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: message });
});

export default app;

// On Vercel the app runs as a function (see api/index.js) and nothing listens
// on a port.
if (!process.env.VERCEL) {
  const port = Number(process.env.PORT) || 3000;
  // No sign-in, so by default only this computer can reach the app.
  const host = process.env.HOST || '127.0.0.1';
  app.listen(port, host, () => {
    console.log(`Momentz is running at http://${host === '0.0.0.0' ? 'localhost' : host}:${port} (model: ${MODEL})`);
    if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
      console.log('No ANTHROPIC_API_KEY set: the pages will load, but the coach cannot reply. See README.md.');
    }
  });
}
