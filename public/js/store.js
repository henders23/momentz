// Everything the student saves: their details, their moments and their
// playbook. It is kept in this browser's own storage, on this device, and is
// never sent anywhere as a whole. Only the conversation of the moment in hand
// goes to the server, to get the coach's replies (see coach.js).

import { toDisplay } from './conversation.js';

const KEY = 'momentz';
const EMPTY = { profile: { name: '', course: '' }, moments: [], playbook: [] };

function read() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(KEY));
  } catch {
    // Storage is switched off, or holds something unreadable: start empty.
  }
  return { ...structuredClone(EMPTY), ...saved };
}

function write(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    throw new Error("Couldn't save in this browser. Its storage may be full or switched off.");
  }
}

/** Read, change, save. Reading afresh each time keeps two open tabs from overwriting each other. */
function update(change) {
  const data = read();
  const result = change(data);
  write(data);
  return result;
}

const clean = (value, max = 2000) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

function find(list, id, what) {
  const found = list.find((entry) => entry.id === id);
  if (!found) throw new Error(`That ${what} doesn't exist any more.`);
  return found;
}
const findMoment = (data, id) => find(data.moments, id, 'moment');
const findMove = (data, id) => find(data.playbook, id, 'playbook entry');

/** Earlier moments the coach may compare this one with. */
const earlier = (data, id) => data.moments.filter((m) => m.id !== id && m.summary && (m.summary.what_got_in_the_way || m.summary.when));

function detail(data, m) {
  return {
    id: m.id,
    title: m.title,
    mode: m.mode,
    createdAt: m.createdAt,
    minutes: Math.max(1, Math.round((new Date(m.updatedAt) - new Date(m.createdAt)) / 60000)),
    items: toDisplay(m),
    summary: m.summary,
    comparedWith: m.comparedEarlier ? earlier(data, m.id).length : 0,
    takeaway: m.takeaway,
    checkIn: m.checkIn,
    tryDate: m.tryDate,
    playbookId: m.playbookId
  };
}

// --- Home, sidebar and profile ---------------------------------------------

export function getState() {
  const data = read();
  return {
    profile: data.profile,
    moments: data.moments.map((m) => ({
      id: m.id,
      title: m.summary?.short_title || m.title,
      createdAt: m.createdAt,
      started: m.messages.length > 0,
      hasAction: Boolean(m.summary?.when && m.summary?.will)
    })),
    playbook: data.playbook
  };
}

export function saveProfile({ name, course }) {
  return update((data) => (data.profile = { name: clean(name, 60), course: clean(course, 80) }));
}

// --- Moments ----------------------------------------------------------------

export function createMoment({ title, mode }) {
  title = clean(title, 300);
  if (!title) throw new Error('Note which moment you want to go through first.');
  return update((data) => {
    const now = new Date().toISOString();
    const moment = {
      id: crypto.randomUUID(),
      title,
      mode: mode === 'speak' ? 'speak' : 'type',
      createdAt: now,
      updatedAt: now,
      // The conversation exactly as it is sent to the Claude API.
      messages: [],
      // Per-message display details the API doesn't need, keyed by message index.
      meta: {},
      comparedEarlier: false,
      summary: null,
      summaryAtLength: 0,
      takeaway: '',
      checkIn: true,
      tryDate: '',
      playbookId: null
    };
    data.moments.unshift(moment);
    return moment.id;
  });
}

export function getMoment(id) {
  const data = read();
  return detail(data, findMoment(data, id));
}

/** What the coach needs to carry a moment on: the stored conversation and what it may be compared with. */
export function forCoach(id) {
  const data = read();
  return { moment: findMoment(data, id), earlier: earlier(data, id), profile: data.profile };
}

export function updateMoment(id, patch) {
  return update((data) => {
    const moment = findMoment(data, id);
    if (patch.mode === 'type' || patch.mode === 'speak') moment.mode = patch.mode;
    if (typeof patch.takeaway === 'string') moment.takeaway = clean(patch.takeaway, 600);
    if (typeof patch.checkIn === 'boolean') moment.checkIn = patch.checkIn;
    if (typeof patch.tryDate === 'string') moment.tryDate = /^\d{4}-\d{2}-\d{2}$/.test(patch.tryDate) ? patch.tryDate : '';
    if (moment.summary) {
      for (const field of ['when', 'will', 'try_at']) {
        if (typeof patch[field] === 'string') moment.summary[field] = clean(patch[field], 400);
      }
    }
    return detail(data, moment);
  });
}

/**
 * Add one finished turn: the student's message and the coach's reply. They are
 * saved together, so a turn that fails leaves the conversation as it was and
 * the student can simply send again. `length` is how long the conversation was
 * when the message was sent.
 */
export function addTurn(id, { length, message, meta, reply }) {
  return update((data) => {
    const moment = findMoment(data, id);
    if (moment.messages.length !== length) throw new Error('This chat has moved on in another tab. Reload the page to carry on.');
    moment.meta[length] = meta;
    if (meta.comparedEarlier) moment.comparedEarlier = true;
    // The reply is stored exactly as the API returned it, thinking blocks
    // included: the API expects them back unchanged on the next turn.
    moment.messages.push(message, { role: 'assistant', content: reply });
    moment.updatedAt = new Date().toISOString();
    return detail(data, moment);
  });
}

export function setSummary(id, summary, length) {
  return update((data) => {
    const moment = findMoment(data, id);
    moment.summary = summary;
    moment.summaryAtLength = length;
    return detail(data, moment);
  });
}

export function addToPlaybook(id) {
  return update((data) => {
    const moment = findMoment(data, id);
    const s = moment.summary;
    if (!s?.when || !s?.will) throw new Error('Fill in both "When…" and "I\'ll…" first.');
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
    let move = data.playbook.find((p) => p.id === moment.playbookId);
    if (move) Object.assign(move, fields);
    else {
      move = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), status: 'new', log: [], momentId: moment.id, ...fields };
      data.playbook.unshift(move);
    }
    moment.playbookId = move.id;
    return move;
  });
}

/** The student's notes on one moment, as a Markdown file they can keep. */
export function exportNotes(id) {
  const moment = findMoment(read(), id);
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
  return lines.join('\n');
}

// --- Playbook ---------------------------------------------------------------

export function updateMove(id, patch) {
  return update((data) => {
    const move = findMove(data, id);
    for (const field of ['title', 'when', 'will']) {
      if (clean(patch[field])) move[field] = clean(patch[field], 400);
    }
    return move;
  });
}

export function logMove(id, { outcome, note }) {
  if (!['worked', 'partly', 'not'].includes(outcome)) throw new Error('Say how it went first.');
  return update((data) => {
    const move = findMove(data, id);
    move.log.unshift({ at: new Date().toISOString(), outcome, note: clean(note, 600) });
    move.status = outcome === 'worked' ? 'working' : 'trying';
    return move;
  });
}

export function deleteMove(id) {
  update((data) => {
    findMove(data, id);
    data.playbook = data.playbook.filter((p) => p.id !== id);
    for (const moment of data.moments) {
      if (moment.playbookId === id) moment.playbookId = null;
    }
  });
}
