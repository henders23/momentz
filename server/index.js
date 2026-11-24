// The Momentz web server: serves the pages in public/ and the /api routes
// they call. Claude is only ever called from here (see coach.js).

import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './store.js';
import {
  CATEGORIES,
  CoachError,
  MODEL,
  buildUserMessage,
  coachTurn,
  describeError,
  helpSay,
  summarise,
  toDisplay
} from './coach.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const store = await new Store(process.env.MOMENTZ_DATA || path.join(root, 'data', 'momentz.json')).load();

const app = express();
app.use(express.json({ limit: '200kb' }));
app.use(express.static(path.join(root, 'public'), { extensions: ['html'] }));

const clean = (value, max = 2000) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

function findMoment(req) {
  const moment = store.moment(req.params.id);
  if (!moment) throw new CoachError(404, "That moment doesn't exist any more.");
  return moment;
}

function findMove(req) {
  const move = store.move(req.params.id);
  if (!move) throw new CoachError(404, "That playbook entry doesn't exist any more.");
  return move;
}

/** Earlier moments the coach may compare this one with. */
function earlierMoments(moment) {
  return store.moments.filter((m) => m.id !== moment.id && m.summary && (m.summary.what_got_in_the_way || m.summary.when));
}

function momentListing(m) {
  return {
    id: m.id,
    title: m.summary?.short_title || m.title,
    createdAt: m.createdAt,
    started: m.messages.length > 0,
    hasAction: Boolean(m.summary?.when && m.summary?.will)
  };
}

function momentDetail(m) {
  return {
    id: m.id,
    title: m.title,
    mode: m.mode,
    createdAt: m.createdAt,
    minutes: Math.max(1, Math.round((new Date(m.updatedAt) - new Date(m.createdAt)) / 60000)),
    items: toDisplay(m),
    summary: m.summary,
    summaryStale: m.summaryAtLength !== m.messages.length,
    comparedWith: m.comparedEarlier ? earlierMoments(m).length : 0,
    takeaway: m.takeaway,
    checkIn: m.checkIn,
    tryDate: m.tryDate,
    playbookId: m.playbookId
  };
}

// --- Home, sidebar and profile ---------------------------------------------

app.get('/api/state', (req, res) => {
  res.json({
    profile: store.profile,
    moments: store.moments.map(momentListing),
    playbook: store.playbook,
    categories: CATEGORIES
  });
});

app.put('/api/profile', async (req, res) => {
  store.profile.name = clean(req.body.name, 60);
  store.profile.course = clean(req.body.course, 80);
  await store.save();
  res.json(store.profile);
});

// --- Moments ----------------------------------------------------------------

app.post('/api/moments', async (req, res) => {
  const title = clean(req.body.title, 300);
  if (!title) throw new CoachError(400, 'Note which moment you want to go through first.');
  const moment = store.createMoment({ title, mode: req.body.mode });
  await store.save();
  res.status(201).json(momentDetail(moment));
});

app.get('/api/moments/:id', (req, res) => {
  res.json(momentDetail(findMoment(req)));
});

app.patch('/api/moments/:id', async (req, res) => {
  const moment = findMoment(req);
  const body = req.body;
  if (body.mode === 'type' || body.mode === 'speak') moment.mode = body.mode;
  if (typeof body.takeaway === 'string') moment.takeaway = clean(body.takeaway, 600);
  if (typeof body.checkIn === 'boolean') moment.checkIn = body.checkIn;
  if (typeof body.tryDate === 'string') moment.tryDate = /^\d{4}-\d{2}-\d{2}$/.test(body.tryDate) ? body.tryDate : '';
  if (moment.summary) {
    for (const field of ['when', 'will', 'try_at']) {
      if (typeof body[field] === 'string') moment.summary[field] = clean(body[field], 400);
    }
  }
  await store.save();
  res.json(momentDetail(moment));
});

app.delete('/api/moments/:id', async (req, res) => {
  store.deleteMoment(findMoment(req).id);
  await store.save();
  res.status(204).end();
});

// One coach turn. The student's message goes in; the coach's reply is streamed
// back as server-sent events:
//   event: delta  {"text": "..."}     a piece of the reply, as it is written
//   event: done   {"items": [...]}    the whole conversation, ready to render
//   event: error  {"message": "..."}
const busy = new Set();

app.post('/api/moments/:id/messages', async (req, res) => {
  const moment = findMoment(req);
  if (busy.has(moment.id)) throw new CoachError(409, 'The coach is still replying.');

  const earlier = earlierMoments(moment);
  const { message, meta } = buildUserMessage(
    moment,
    { text: clean(req.body.text, 8000), choice: clean(req.body.choice, 100) },
    earlier
  );
  if (Number.isFinite(req.body.spokenSeconds)) meta.spoken = Math.round(req.body.spokenSeconds);

  // Remember where the conversation stood, so a failed turn can be undone and
  // the student can simply send again.
  const before = { length: moment.messages.length, compared: moment.comparedEarlier };
  moment.messages.push(message);
  moment.meta[before.length] = meta;
  if (meta.comparedEarlier) moment.comparedEarlier = true;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no'
  });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  // Stop generating (and paying) if the student closes the page mid-reply.
  const abort = new AbortController();
  res.on('close', () => abort.abort());

  busy.add(moment.id);
  try {
    const reply = await coachTurn({
      moment,
      profile: store.profile,
      hasEarlierMoments: earlier.length > 0,
      onText: (text) => send('delta', { text }),
      signal: abort.signal
    });
    // Store the reply's content exactly as the API returned it, thinking
    // blocks included: the API expects them back unchanged on the next turn.
    moment.messages.push({ role: 'assistant', content: reply.content });
    moment.updatedAt = new Date().toISOString();
    await store.save();
    send('done', { items: toDisplay(moment), usage: reply.usage });
  } catch (err) {
    moment.messages.length = before.length;
    delete moment.meta[before.length];
    moment.comparedEarlier = before.compared;
    if (!abort.signal.aborted) {
      console.error('Coach turn failed:', err);
      send('error', { message: describeError(err).message });
    }
  } finally {
    busy.delete(moment.id);
    res.end();
  }
});

app.post('/api/moments/:id/help-say', async (req, res) => {
  const moment = findMoment(req);
  res.json({ suggestions: await helpSay(moment, clean(req.body.draft, 4000)) });
});

// Build (or rebuild) the summary page from the conversation. It is only
// regenerated when the conversation has moved on since the last time.
app.post('/api/moments/:id/summary', async (req, res) => {
  const moment = findMoment(req);
  if (!moment.messages.length) throw new CoachError(400, "There's no conversation to sum up yet.");
  if (!moment.summary || moment.summaryAtLength !== moment.messages.length) {
    moment.summary = await summarise(moment);
    moment.summaryAtLength = moment.messages.length;
    await store.save();
  }
  res.json(momentDetail(moment));
});

app.post('/api/moments/:id/playbook', async (req, res) => {
  const moment = findMoment(req);
  const s = moment.summary;
  if (!s?.when || !s?.will) throw new CoachError(400, 'Fill in both "When…" and "I\'ll…" first.');
  const fields = {
    title: s.action_title || s.short_title || moment.title,
    category: s.category,
    when: s.when,
    will: s.will,
    tryAt: s.try_at,
    tryDate: moment.tryDate,
    checkIn: moment.checkIn,
    source: s.short_title || moment.title
  };
  let move = moment.playbookId && store.move(moment.playbookId);
  if (move) Object.assign(move, fields);
  else move = store.createMove({ momentId: moment.id, ...fields });
  moment.playbookId = move.id;
  await store.save();
  res.json(move);
});

app.get('/api/moments/:id/export', (req, res) => {
  const moment = findMoment(req);
  const s = moment.summary;
  const lines = [`# ${s?.short_title || moment.title}`, '', `${moment.createdAt.slice(0, 10)} · ${moment.title}`, ''];
  if (s) {
    if (s.when || s.will) lines.push("## What I'll try", '', `When ${s.when || '…'}, I'll ${s.will || '…'}.`, '');
    if (s.try_at) lines.push(`Try it at: ${s.try_at}`, '');
    if (moment.takeaway) lines.push('## The main thing for me', '', moment.takeaway, '');
    lines.push('## How I got there', '');
    if (s.what_happened) lines.push(`**What happened:** ${s.what_happened}`, '');
    if (s.expected_vs_happened) lines.push(`**Expected vs. what happened:** ${s.expected_vs_happened}`, '');
    if (s.what_got_in_the_way) lines.push(`**What got in the way:** ${s.what_got_in_the_way}`, '');
  }
  lines.push('## The conversation', '');
  for (const item of toDisplay(moment)) {
    if (item.text) lines.push(`**${item.role === 'coach' ? 'Coach' : 'Me'}:** ${item.text}`, '');
    if (item.widget?.picked && item.widget.options) lines.push(`*(I picked: ${item.widget.picked})*`, '');
  }
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="momentz-notes.md"');
  res.send(lines.join('\n'));
});

// --- Playbook ---------------------------------------------------------------

app.patch('/api/playbook/:id', async (req, res) => {
  const move = findMove(req);
  for (const field of ['title', 'when', 'will']) {
    if (typeof req.body[field] === 'string' && clean(req.body[field])) move[field] = clean(req.body[field], 400);
  }
  await store.save();
  res.json(move);
});

app.post('/api/playbook/:id/log', async (req, res) => {
  const move = findMove(req);
  const outcome = ['worked', 'partly', 'not'].includes(req.body.outcome) ? req.body.outcome : null;
  if (!outcome) throw new CoachError(400, 'Say how it went first.');
  move.log.unshift({ at: new Date().toISOString(), outcome, note: clean(req.body.note, 600) });
  move.status = outcome === 'worked' ? 'working' : 'trying';
  await store.save();
  res.json(move);
});

app.delete('/api/playbook/:id', async (req, res) => {
  store.deleteMove(findMove(req).id);
  await store.save();
  res.status(204).end();
});

// --- Errors -----------------------------------------------------------------

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const { status, message } = describeError(err);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: message });
});

const port = Number(process.env.PORT) || 3000;
// No accounts yet, so by default only this computer can reach the app.
const host = process.env.HOST || '127.0.0.1';
app.listen(port, host, () => {
  console.log(`Momentz is running at http://${host === '0.0.0.0' ? 'localhost' : host}:${port} (model: ${MODEL})`);
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    console.log('No ANTHROPIC_API_KEY set: the pages will load, but the coach cannot reply. See README.md.');
  }
});
