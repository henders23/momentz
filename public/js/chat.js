// The chat: nothing on screen but the conversation.

import { api, autosize, dayLabel, h, icon, param, toast } from './common.js';
import { Recorder, speechSupported } from './speech.js';

const id = param('id');
let moment;
try {
  moment = await api(`/moments/${id}`);
} catch (err) {
  document.body.append(h('div.loading', null, h('p', null, err.message), h('a.btn', { href: 'index.html' }, 'Back to home')));
  throw err;
}

let items = moment.items;
let mode = moment.mode === 'speak' && speechSupported ? 'speak' : 'type';
let busy = false;

const thread = h('div.thread', { 'aria-live': 'polite' });
const dock = h('div.dock');
const scrollDown = () => window.scrollTo({ top: document.body.scrollHeight });

// --- The conversation -------------------------------------------------------

const coachBubble = (...body) => h('div.coach', null, h('span.mark', null, icon('mark', 14, 2.8)), h('div.body', null, body));

function widget(item, isLast) {
  const w = item.widget;
  const open = isLast && !w.answered && !busy;
  if (w.tool === 'offer_wrap_up') {
    return h('div.choices', null, h('a.btn.primary', { href: `summary.html?id=${id}` }, 'See what you worked out', icon('arrow', 16, 2.2)));
  }
  const options =
    w.tool === 'offer_earlier_moments'
      ? [
          { label: 'Yes, show me', value: 'yes', style: '.outline' },
          { label: 'Not now', value: 'no', style: '' }
        ]
      : w.options.map((label) => ({ label, value: label, style: '' }));
  return h(
    'div.choices',
    { role: 'group', 'aria-label': w.tool === 'offer_earlier_moments' ? 'Look at earlier moments?' : 'Places to look' },
    options.map((o) =>
      h(`button.chip${o.style}`, { disabled: !open, 'aria-pressed': String(w.picked === o.value), onclick: () => send({ choice: o.value }) }, o.label)
    )
  );
}

function render() {
  thread.replaceChildren(
    ...items.map((item, i) => {
      if (item.role === 'student') {
        const spoken = item.spoken != null && h('span.eyebrow', null, `Spoken · ${clock(item.spoken)}`);
        return h('div.student', null, spoken, h('p', null, item.text));
      }
      return coachBubble(item.text && h('p', null, item.text), item.widget && widget(item, i === items.length - 1));
    })
  );
}

const clock = (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

// --- Sending a message and streaming the reply -------------------------------

async function send({ text = '', choice = '', spokenSeconds } = {}) {
  if (busy) return false;
  busy = true;
  clearSuggestions();

  // Show the student's side straight away, then the coach "typing".
  const before = items;
  items = structuredClone(items);
  const last = items.at(-1);
  if (last?.widget && !last.widget.answered) {
    last.widget.answered = true;
    last.widget.picked = choice || null;
  }
  if (text) items.push({ role: 'student', text, spoken: spokenSeconds ?? null });
  render();
  const reply = h('p');
  const waiting = h('span.dots', { 'aria-label': 'The coach is writing' }, h('i'), h('i'), h('i'));
  const bubble = coachBubble(waiting);
  thread.append(bubble);
  scrollDown();

  let finished = false;
  try {
    const res = await fetch(`/api/moments/${id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, choice, spokenSeconds })
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Something went wrong. Please try again.');

    // The reply arrives as server-sent events: "event: <name>\ndata: <json>\n\n".
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
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
        if (event === 'delta') {
          if (waiting.isConnected) waiting.replaceWith(reply);
          reply.textContent += data.text;
          scrollDown();
        } else if (event === 'done') {
          items = data.items;
          finished = true;
        } else if (event === 'error') {
          throw new Error(data.message);
        }
      }
    }
    if (!finished) throw new Error('The connection dropped before the coach finished. Please send that again.');
  } catch (err) {
    items = before;
    toast(err.message);
  }
  busy = false;
  render();
  scrollDown();
  return finished;
}

// --- Typing ------------------------------------------------------------------

const input = h('textarea', { id: 'msg', rows: 2, placeholder: 'Type it however it comes…' });
const fit = autosize(input);
const suggestions = h('div.suggestions', { hidden: true });

function clearSuggestions() {
  suggestions.hidden = true;
  suggestions.replaceChildren();
}

async function sendTyped() {
  const text = input.value.trim();
  if (!text || busy) return;
  input.value = '';
  fit();
  if (!(await send({ text }))) {
    input.value = text;
    fit();
  }
  input.focus();
}

input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    sendTyped();
  }
});

// "Aa": sentence starters when the box is empty, clearer wordings of a draft.
async function helpMeSayIt(event) {
  const button = event.currentTarget;
  const draft = input.value.trim();
  button.disabled = true;
  try {
    const { suggestions: list } = await api(`/moments/${id}/help-say`, { method: 'POST', body: { draft } });
    suggestions.replaceChildren(
      draft ? 'Another way to say it:' : 'Ways to start:',
      ...list.map((s) =>
        h(
          'button.btn.small',
          {
            onclick: () => {
              input.value = draft ? s : `${s.replace(/\s*(…|\.\.\.)\s*$/, '')} `;
              clearSuggestions();
              fit();
              input.focus();
            }
          },
          s
        )
      ),
      h('button.btn.small.quiet', { 'aria-label': 'Close suggestions', onclick: clearSuggestions }, icon('close', 14))
    );
    suggestions.hidden = !list.length;
  } catch (err) {
    toast(err.message);
  }
  button.disabled = false;
}

function setMode(next) {
  if (next === 'speak' && !speechSupported) {
    toast('Speaking needs Chrome, Edge or Safari. You can type here instead.', 'info');
    return;
  }
  mode = next;
  api(`/moments/${id}`, { method: 'PATCH', body: { mode } }).catch(() => {});
  drawDock();
  if (mode === 'type') input.focus();
}

const typeComposer = () =>
  h(
    'div.composer',
    null,
    h('label.sr-only', { htmlFor: 'msg' }, 'Your message'),
    input,
    h('button.square.ghost', { 'aria-label': 'Help me say it', title: 'Help me say it', onclick: helpMeSayIt }, 'Aa'),
    h('button.square', { 'aria-label': 'Switch to speaking', title: 'Switch to speaking', onclick: () => setMode('speak') }, icon('mic', 18)),
    h('button.square.send', { 'aria-label': 'Send', onclick: sendTyped }, icon('up', 18, 2.2))
  );

// --- Speaking ----------------------------------------------------------------

const BARS = 48;
let recorder = null;

function speakComposer() {
  const bars = Array.from({ length: BARS }, () => h('i'));
  const levels = new Array(BARS).fill(0);
  const timer = h('span.timer', null, '0:00');
  const live = h('div.student.live', null, h('p'));
  const composer = h('div.composer.speak');
  let tick;

  const showText = (final, interim) => {
    live.firstChild.replaceChildren(final, final && interim ? ' ' : '', h('span.interim', null, interim), h('span.caret'));
    if (!live.isConnected) thread.append(live);
    scrollDown();
  };

  const idle = () => {
    clearInterval(tick);
    recorder = null;
    live.remove();
    composer.classList.remove('recording');
    composer.replaceChildren(
      h('button.square', { 'aria-label': 'Switch to typing', title: 'Switch to typing', onclick: () => setMode('type') }, icon('keyboard', 18)),
      h('span.rec-dot'),
      h('span.wave-hint', null, 'Say it however it comes.'),
      h('button.btn.primary', { style: 'height: 44px', disabled: busy, onclick: record }, icon('mic', 16), 'Start speaking')
    );
  };

  const record = () => {
    recorder = new Recorder({
      onText: showText,
      onLevel: (level) => {
        levels.push(level);
        levels.shift();
        bars.forEach((bar, i) => (bar.style.height = `${4 + Math.round(levels[i] * 28)}px`));
      },
      onError: (message) => {
        toast(message);
        setMode('type');
      }
    });
    recorder.start();
    const started = Date.now();
    tick = setInterval(() => (timer.textContent = clock(Math.round((Date.now() - started) / 1000))), 500);
    composer.classList.add('recording');
    composer.replaceChildren(
      h('button.square', { 'aria-label': 'Stop and switch to typing', title: 'Switch to typing', onclick: () => setMode('type') }, icon('keyboard', 18)),
      h('span.rec-dot'),
      h('div.wave', { 'aria-hidden': 'true' }, bars),
      timer,
      h('button.btn.primary', { style: 'height: 44px', 'aria-label': 'Finish speaking', onclick: done }, h('span', { style: 'width: 12px; height: 12px; border-radius: 2px; background: currentColor' }), 'Done')
    );
    showText('', '');
  };

  const done = async () => {
    const { text, seconds } = await recorder.stop();
    idle();
    if (!text) {
      toast("Didn't catch anything. Try again, or switch to typing.", 'info');
      return;
    }
    await send({ text, spokenSeconds: seconds });
    drawDock();
  };

  idle();
  return composer;
}

function drawDock() {
  recorder?.stop();
  recorder = null;
  document.querySelector('.student.live')?.remove();
  dock.replaceChildren(suggestions, mode === 'speak' ? speakComposer() : typeComposer());
}

// --- Page --------------------------------------------------------------------

document.body.append(
  h(
    'div.chat',
    null,
    h('header', null, h('a.btn.quiet', { href: 'index.html' }, icon('close'), 'Save & leave')),
    h(
      'main',
      null,
      h(
        'div.column',
        null,
        h('div.moment-head', null, h('span.eyebrow', null, `Your moment · ${dayLabel(moment.createdAt)}`), h('h1', null, moment.title)),
        thread,
        h('div.spacer'),
        dock
      )
    )
  )
);
render();
drawDock();
scrollDown();
if (mode === 'type') input.focus();
