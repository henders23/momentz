// End-to-end test of the server: a whole moment, from the first message to
// the playbook, with a scripted stand-in for the Claude API.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { SUMMARY, startFakeClaude } from './fake-claude.mjs';

const PORT = 4100 + Math.floor(Math.random() * 500);
const base = `http://127.0.0.1:${PORT}`;
// Leave out any Claude credentials or endpoints from the surrounding shell.
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('ANTHROPIC_')));
let fake;
let server;
let dataFile;

before(async () => {
  fake = await startFakeClaude();
  dataFile = path.join(await mkdtemp(path.join(tmpdir(), 'momentz-')), 'store.json');
  server = spawn(process.execPath, ['server/index.js'], {
    env: { ...cleanEnv, PORT, HOST: '127.0.0.1', MOMENTZ_DATA: dataFile, ANTHROPIC_BASE_URL: fake.url, ANTHROPIC_API_KEY: 'test-key' },
    stdio: ['ignore', 'pipe', 'inherit']
  });
  await new Promise((resolve) => server.stdout.once('data', resolve));
});

after(() => {
  server.kill();
  fake.close();
});

async function call(pathname, method = 'GET', body) {
  const res = await fetch(`${base}/api${pathname}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: res.status, data: res.status === 204 ? null : await res.json() };
}

/** Send one message and collect the streamed events. */
async function say(id, body) {
  const res = await fetch(`${base}/api/moments/${id}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) return { status: res.status, ...(await res.json()) };
  const events = (await res.text())
    .split('\n\n')
    .filter(Boolean)
    .map((chunk) => ({ event: chunk.match(/^event: (.*)$/m)[1], data: JSON.parse(chunk.match(/^data: (.*)$/m)[1]) }));
  return {
    streamed: events.filter((e) => e.event === 'delta').map((e) => e.data.text).join(''),
    done: events.find((e) => e.event === 'done')?.data,
    error: events.find((e) => e.event === 'error')?.data.message
  };
}

async function walkThrough(title) {
  const { data: moment } = await call('/moments', 'POST', { title, mode: 'type' });
  await say(moment.id, { text: "I'd done the reading but someone else always got in first." });
  await say(moment.id, { text: 'Prepared, but silent. I just did not speak.' });
  return moment.id;
}

test('serves the pages', async () => {
  for (const page of ['/', '/chat.html', '/summary.html', '/playbook.html', '/js/chat.js', '/css/app.css']) {
    assert.equal((await fetch(base + page)).status, 200, page);
  }
});

test('a moment needs a title', async () => {
  assert.equal((await call('/moments', 'POST', { title: '  ' })).status, 400);
});

test('a whole moment: chat, buttons, summary, playbook', async () => {
  const { data: moment } = await call('/moments', 'POST', { title: "Tuesday's seminar, when I didn't speak", mode: 'type' });
  const id = moment.id;
  assert.equal(moment.items.length, 1, 'starts with the scripted opening line');

  // Turn 1: plain text, streamed in pieces.
  let turn = await say(id, { text: "I'd done the reading but someone else always got in first." });
  assert.equal(turn.streamed, 'Before you walked in, what did you expect would happen?');
  assert.equal(turn.done.items.at(-1).text, turn.streamed);

  // The request to Claude carries the coach prompt, the tools and the key.
  const sent = fake.requests.at(-1);
  assert.match(sent.headers.authorization ?? sent.headers['x-api-key'], /test-key/);
  assert.equal(sent.body.model, 'claude-opus-5-5');
  assert.match(sent.body.system[0].text, /Signpost, don't supply/);
  assert.match(sent.body.system[1].text, /Tuesday's seminar/);
  assert.deepEqual(sent.body.tools.map((t) => t.name), ['offer_places_to_look', 'offer_wrap_up']);

  // Turn 2: the coach offers places to look.
  turn = await say(id, { text: 'Prepared, but silent. I just did not speak.' });
  const widget = turn.done.items.at(-1).widget;
  assert.equal(widget.tool, 'offer_places_to_look');
  assert.deepEqual(widget.options, ['Timing', 'How ready the idea felt', 'Finding the words', 'Something else']);
  assert.equal(widget.answered, false);

  // An empty message is refused and leaves the conversation alone.
  assert.equal((await say(id, {})).status, 400);

  // Turn 3: pressing a button answers the tool call.
  turn = await say(id, { choice: 'How ready the idea felt' });
  assert.equal(turn.streamed, 'Tool said: The student picked: "How ready the idea felt".');
  const answered = turn.done.items.at(-2).widget;
  assert.equal(answered.answered, true);
  assert.equal(answered.picked, 'How ready the idea felt');

  // Turn 4: the coach offers to wrap up; the student keeps talking instead.
  turn = await say(id, { text: 'It had to be a proper argument with evidence, or it is not worth saying.' });
  assert.equal(turn.done.items.at(-1).widget.tool, 'offer_wrap_up');
  turn = await say(id, { text: "When someone says something I agree with, I'll say building on that.", spokenSeconds: 12 });
  assert.match(turn.streamed, /carrying on with the conversation/);
  assert.equal(turn.done.items.at(-2).spoken, 12);

  // A failed turn is undone, so the same message can simply be sent again.
  fake.failNextWith(400);
  const length = (await call(`/moments/${id}`)).data.items.length;
  turn = await say(id, { text: 'This one fails.' });
  assert.match(turn.error, /rejected the request/);
  assert.equal((await call(`/moments/${id}`)).data.items.length, length);
  turn = await say(id, { text: 'This one works.' });
  assert.ok(turn.done);

  // "Help me say it".
  const help = await call(`/moments/${id}/help-say`, 'POST', { draft: '' });
  assert.equal(help.data.suggestions.length, 3);

  // The summary is structured output; quotes the student never said are dropped.
  const requestsBefore = fake.requests.length;
  let { data: detail } = await call(`/moments/${id}/summary`, 'POST');
  assert.equal(detail.summary.when, SUMMARY.when);
  assert.deepEqual(detail.summary.own_words, ['Prepared, but silent']);
  assert.equal(fake.requests.at(-1).body.output_config.format.type, 'json_schema');
  await call(`/moments/${id}/summary`, 'POST');
  assert.equal(fake.requests.length, requestsBefore + 1, 'not rebuilt when nothing has changed');

  // Edits, then into the playbook.
  ({ data: detail } = await call(`/moments/${id}`, 'PATCH', { will: 'say "building on that…" straight away', takeaway: 'Say it unfinished.', checkIn: false, tryDate: '2026-12-01' }));
  assert.equal(detail.summary.will, 'say "building on that…" straight away');
  const { data: move } = await call(`/moments/${id}/playbook`, 'POST');
  assert.equal(move.status, 'new');
  assert.equal(move.will, 'say "building on that…" straight away');
  assert.equal((await call(`/moments/${id}/playbook`, 'POST')).data.id, move.id, 'adding twice updates the same entry');

  const logged = await call(`/playbook/${move.id}/log`, 'POST', { outcome: 'partly', note: 'Got one sentence out.' });
  assert.equal(logged.data.status, 'trying');
  assert.equal((await call(`/playbook/${move.id}/log`, 'POST', { outcome: 'worked' })).data.status, 'working');
  assert.equal((await call(`/playbook/${move.id}/log`, 'POST', { outcome: 'great' })).status, 400);

  const notes = await (await fetch(`${base}/api/moments/${id}/export`)).text();
  assert.match(notes, /When someone says something I agree with, I'll say "building on that…" straight away\./);
  assert.match(notes, /Say it unfinished\./);

  // Everything is on disk.
  const saved = JSON.parse(await readFile(dataFile, 'utf8'));
  assert.equal(saved.moments[0].id, id);
  assert.equal(saved.playbook[0].log.length, 2);
});

test('a later moment can be compared with earlier ones', async () => {
  const id = await walkThrough('Lab report feedback');
  let turn = await say(id, { choice: 'Timing' });
  assert.deepEqual(fake.requests.at(-1).body.tools.map((t) => t.name), ['offer_places_to_look', 'offer_wrap_up', 'offer_earlier_moments']);
  turn = await say(id, { text: 'I left it too late.' });
  assert.equal(turn.done.items.at(-1).widget.tool, 'offer_earlier_moments');
  turn = await say(id, { choice: 'yes' });
  assert.match(turn.streamed, /Their earlier moments:/);
  assert.match(turn.streamed, /Prepared, but silent/);
  assert.equal((await call(`/moments/${id}`)).data.comparedWith, 1);
});

test('without a key the coach says how to fix it', async () => {
  const quiet = spawn(process.execPath, ['server/index.js'], {
    env: { ...cleanEnv, PORT: PORT + 1, MOMENTZ_DATA: `${dataFile}.none`, HOME: path.dirname(dataFile) },
    stdio: ['ignore', 'pipe', 'ignore']
  });
  try {
    await new Promise((resolve) => quiet.stdout.once('data', resolve));
    const other = `http://127.0.0.1:${PORT + 1}`;
    const moment = await (await fetch(`${other}/api/moments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'x' }) })).json();
    const res = await fetch(`${other}/api/moments/${moment.id}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'hello' }) });
    assert.match(await res.text(), /Add your Claude API key as ANTHROPIC_API_KEY/);
  } finally {
    quiet.kill();
  }
});
