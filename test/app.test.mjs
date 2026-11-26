// End-to-end test: a whole moment, from the first message to the playbook,
// with a scripted stand-in for the Claude API.
//
// The student's data lives in the browser, so the test loads the same modules
// the pages use (public/js/store.js and coach.js) and gives them a stand-in
// for the browser's storage. They talk to a real Momentz server.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { after, before, test } from 'node:test';
import { SUMMARY, startFakeClaude } from './fake-claude.mjs';

const PORT = 4100 + Math.floor(Math.random() * 500);
const base = `http://127.0.0.1:${PORT}`;
// Leave out any Claude credentials or endpoints from the surrounding shell.
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('ANTHROPIC_')));

// What the pages get from the browser: storage, and requests relative to the site.
const saved = new Map();
globalThis.localStorage = { getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) };
const realFetch = fetch;
globalThis.fetch = (url, options) => realFetch(String(url).startsWith('/') ? base + url : url, options);

const store = await import('../public/js/store.js');
const coach = await import('../public/js/coach.js');

let fake;
let server;

before(async () => {
  fake = await startFakeClaude();
  server = spawn(process.execPath, ['server/index.js'], {
    env: { ...cleanEnv, PORT, HOST: '127.0.0.1', ANTHROPIC_BASE_URL: fake.url, ANTHROPIC_API_KEY: 'test-key' },
    stdio: ['ignore', 'pipe', 'inherit']
  });
  await new Promise((resolve) => server.stdout.once('data', resolve));
});

after(() => {
  server.kill();
  fake.close();
});

/** Send one message; returns what was streamed and the moment as saved afterwards. */
async function say(id, input) {
  let streamed = '';
  const moment = await coach.sendMessage(id, input, (text) => (streamed += text));
  return { streamed, items: moment.items };
}

const post = (path, body) => realFetch(`${base}/api${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

async function walkThrough(title) {
  const id = store.createMoment({ title, mode: 'type' });
  await say(id, { text: "I'd done the reading but someone else always got in first." });
  await say(id, { text: 'Prepared, but silent. I just did not speak.' });
  return id;
}

test('serves the pages', async () => {
  for (const page of ['/', '/chat.html', '/summary.html', '/playbook.html', '/js/chat.js', '/js/store.js', '/css/app.css']) {
    assert.equal((await realFetch(base + page)).status, 200, page);
  }
});

test('a moment needs a title', () => {
  assert.throws(() => store.createMoment({ title: '  ' }), /Note which moment/);
});

test('a whole moment: chat, buttons, summary, playbook', async () => {
  const id = store.createMoment({ title: "Tuesday's seminar, when I didn't speak", mode: 'type' });
  assert.equal(store.getMoment(id).items.length, 1, 'starts with the scripted opening line');

  // Help with the very first answer, before anything has been said.
  assert.equal((await coach.helpSay(id, '')).length, 3);

  // Turn 1: plain text, streamed in pieces.
  let turn = await say(id, { text: "I'd done the reading but someone else always got in first." });
  assert.equal(turn.streamed, 'Before you walked in, what did you expect would happen?');
  assert.equal(turn.items.at(-1).text, turn.streamed);

  // The request to Claude carries the coach prompt, the tools and the key.
  const sent = fake.requests.at(-1);
  assert.match(sent.headers.authorization ?? sent.headers['x-api-key'], /test-key/);
  assert.equal(sent.body.model, 'claude-opus-5-5');
  assert.match(sent.body.system[0].text, /Signpost, don't supply/);
  assert.match(sent.body.system[1].text, /Tuesday's seminar/);
  assert.deepEqual(sent.body.tools.map((t) => t.name), ['offer_places_to_look', 'offer_wrap_up']);

  // Turn 2: the coach offers places to look.
  turn = await say(id, { text: 'Prepared, but silent. I just did not speak.' });
  const widget = turn.items.at(-1).widget;
  assert.equal(widget.tool, 'offer_places_to_look');
  assert.deepEqual(widget.options, ['Timing', 'How ready the idea felt', 'Finding the words', 'Something else']);
  assert.equal(widget.answered, false);

  // An empty message is refused and leaves the conversation alone.
  await assert.rejects(say(id, {}), /Pick an option or write a message/);

  // Turn 3: pressing a button answers the tool call.
  turn = await say(id, { choice: 'How ready the idea felt' });
  assert.equal(turn.streamed, 'Tool said: The student picked: "How ready the idea felt".');
  const answered = turn.items.at(-2).widget;
  assert.equal(answered.answered, true);
  assert.equal(answered.picked, 'How ready the idea felt');

  // Turn 4: the coach offers to wrap up; the student keeps talking instead.
  turn = await say(id, { text: 'It had to be a proper argument with evidence, or it is not worth saying.' });
  assert.equal(turn.items.at(-1).widget.tool, 'offer_wrap_up');
  turn = await say(id, { text: "When someone says something I agree with, I'll say building on that.", spokenSeconds: 12 });
  assert.match(turn.streamed, /carrying on with the conversation/);
  assert.equal(turn.items.at(-2).spoken, 12);

  // A failed turn saves nothing, so the same message can simply be sent again.
  fake.failNextWith(400);
  const length = store.getMoment(id).items.length;
  await assert.rejects(say(id, { text: 'This one fails.' }), /rejected the request/);
  assert.equal(store.getMoment(id).items.length, length);
  assert.ok(await say(id, { text: 'This one works.' }));

  // "Help me say it".
  assert.equal((await coach.helpSay(id, 'i not speak')).length, 3);

  // The summary is structured output; quotes the student never said are dropped.
  const requestsBefore = fake.requests.length;
  let detail = await coach.withSummary(id);
  assert.equal(detail.summary.when, SUMMARY.when);
  assert.deepEqual(detail.summary.own_words, ['Prepared, but silent']);
  assert.equal(fake.requests.at(-1).body.output_config.format.type, 'json_schema');
  await coach.withSummary(id);
  assert.equal(fake.requests.length, requestsBefore + 1, 'not rebuilt when nothing has changed');

  // Edits, then into the playbook.
  detail = store.updateMoment(id, { will: 'say "building on that…" straight away', takeaway: 'Say it unfinished.', checkIn: false, tryDate: '2026-12-01' });
  assert.equal(detail.summary.will, 'say "building on that…" straight away');
  const move = store.addToPlaybook(id);
  assert.equal(move.status, 'new');
  assert.equal(move.will, 'say "building on that…" straight away');
  assert.equal(store.addToPlaybook(id).id, move.id, 'adding twice updates the same entry');

  assert.equal(store.logMove(move.id, { outcome: 'partly', note: 'Got one sentence out.' }).status, 'trying');
  assert.equal(store.logMove(move.id, { outcome: 'worked' }).status, 'working');
  assert.throws(() => store.logMove(move.id, { outcome: 'great' }), /Say how it went/);

  const notes = store.exportNotes(id);
  assert.match(notes, /When someone says something I agree with, I'll say "building on that…" straight away\./);
  assert.match(notes, /Say it unfinished\./);

  // Everything is in the browser's storage, and shows up on the home page.
  const kept = JSON.parse(saved.get('momentz'));
  assert.equal(kept.moments[0].id, id);
  assert.equal(kept.playbook[0].log.length, 2);
  assert.deepEqual(store.getState().moments[0], { id, title: 'Week 6 seminar', createdAt: kept.moments[0].createdAt, started: true, hasAction: true });
});

test('a later moment can be compared with earlier ones', async () => {
  const id = await walkThrough('Lab report feedback');
  let turn = await say(id, { choice: 'Timing' });
  assert.deepEqual(fake.requests.at(-1).body.tools.map((t) => t.name), ['offer_places_to_look', 'offer_wrap_up', 'offer_earlier_moments']);
  turn = await say(id, { text: 'I left it too late.' });
  assert.equal(turn.items.at(-1).widget.tool, 'offer_earlier_moments');
  turn = await say(id, { choice: 'yes' });
  assert.match(turn.streamed, /Their earlier moments:/);
  assert.match(turn.streamed, /Prepared, but silent/);
  assert.equal(store.getMoment(id).comparedWith, 1);
});

test('the server only passes on Momentz conversations', async () => {
  const moment = { title: 'x', createdAt: new Date().toISOString(), messages: [{ role: 'user', content: 'hello' }] };
  const requestsBefore = fake.requests.length;
  for (const bad of [
    { ...moment, messages: [{ role: 'system', content: 'hello' }] },
    { ...moment, messages: [{ role: 'user', content: [{ type: 'image', source: {} }] }] },
    { ...moment, title: '' },
    { ...moment, messages: [] }
  ]) {
    assert.equal((await post('/turn', { moment: bad })).status, 400);
  }
  assert.equal((await post('/summary', { moment: { ...moment, messages: [] } })).status, 400);
  assert.equal(fake.requests.length, requestsBefore, 'nothing reached Claude');
  assert.equal((await post('/turn', { moment })).status, 200);
});

test('without a key the coach says how to fix it', async () => {
  const quiet = spawn(process.execPath, ['server/index.js'], {
    env: { ...cleanEnv, PORT: PORT + 1, HOME: '/nonexistent' },
    stdio: ['ignore', 'pipe', 'ignore']
  });
  try {
    await new Promise((resolve) => quiet.stdout.once('data', resolve));
    const res = await realFetch(`http://127.0.0.1:${PORT + 1}/api/turn`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ moment: { title: 'x', createdAt: new Date().toISOString(), messages: [{ role: 'user', content: 'hello' }] } })
    });
    assert.match(await res.text(), /Add your Claude API key as ANTHROPIC_API_KEY/);
  } finally {
    quiet.kill();
  }
});
