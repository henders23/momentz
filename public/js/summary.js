// "Your moment": what the student worked out, in their words, ready to edit.

import { api, autosize, h, icon, param, sidebar, toast } from './common.js';

const id = param('id');
const main = h('main.main', null, h('div.loading', null, h('span.dots', null, h('i'), h('i'), h('i')), h('p', null, 'Pulling together what you said…')));
const shell = h('div.shell');
document.body.append(shell);

let state;
let moment;
try {
  shell.append(main);
  // Built by Claude from the conversation the first time, and again only if
  // the conversation has moved on since.
  moment = await api(`/moments/${id}/summary`, { method: 'POST' });
  state = await api('/state');
  shell.prepend(sidebar(state, { currentId: id }));
} catch (err) {
  main.replaceChildren(
    h('div.loading', null, h('p', null, err.message), h('a.btn', { href: id ? `chat.html?id=${id}` : 'index.html' }, id ? 'Back to the chat' : 'Back to home'))
  );
  throw err;
}

const s = moment.summary;

// Save edits a moment after the student stops typing.
let saveTimer;
let pending = {};
function save(patch) {
  Object.assign(pending, patch);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 500);
}
async function flush() {
  clearTimeout(saveTimer);
  if (!Object.keys(pending).length) return;
  const body = pending;
  pending = {};
  try {
    await api(`/moments/${id}`, { method: 'PATCH', body });
  } catch (err) {
    toast(err.message);
  }
}

function editable(key, value, props, target = s) {
  const el = h(props.type ? 'input.field' : 'textarea.field', { value, ...props });
  if (!props.type) autosize(el);
  el.addEventListener('input', () => {
    target[key] = el.value;
    save({ [key]: el.value });
  });
  return el;
}

const when = editable('when', s.when, { id: 'when', rows: 1, placeholder: 'something you will notice happening' });
const will = editable('will', s.will, { id: 'will', rows: 1, placeholder: 'one small thing you will do' });
const tryAt = editable('try_at', s.try_at, { type: 'text', placeholder: 'e.g. Week 7 seminar' });
const tryDate = editable('tryDate', moment.tryDate, { type: 'date' }, moment);
const takeaway = editable('takeaway', moment.takeaway, { id: 'takeaway', rows: 2, placeholder: 'In your own words' }, moment);

const checkLabel = h('span');
const checkSwitch = h(
  'button.switch',
  {
    'aria-label': 'Check in with me afterwards',
    onclick: () => {
      moment.checkIn = !moment.checkIn;
      save({ checkIn: moment.checkIn });
      drawCheck();
    }
  },
  h('i')
);
function drawCheck() {
  checkSwitch.setAttribute('aria-pressed', String(moment.checkIn));
  checkLabel.textContent = moment.checkIn ? 'Check in with me afterwards' : 'No check-in';
}
drawCheck();

const sumBody = h(
  'div.stack',
  { hidden: !moment.takeaway },
  h('label', { htmlFor: 'takeaway' }, 'So the main thing for me is…'),
  takeaway,
  s.own_words.length > 0 &&
    h(
      'div.words',
      null,
      'Your words from the chat:',
      s.own_words.map((quote) =>
        h(
          'button.btn.small',
          {
            onclick: () => {
              takeaway.value = `${takeaway.value}${takeaway.value && !/\s$/.test(takeaway.value) ? ' ' : ''}${quote}`;
              takeaway.dispatchEvent(new Event('input'));
              takeaway.focus();
            }
          },
          `“${quote}”`
        )
      )
    )
);
const sumToggle = h(
  'button',
  {
    'aria-expanded': String(!sumBody.hidden),
    onclick: () => {
      sumBody.hidden = !sumBody.hidden;
      sumToggle.setAttribute('aria-expanded', String(!sumBody.hidden));
      if (!sumBody.hidden) takeaway.focus();
    }
  },
  h('span', null, h('b', null, 'Want to sum it up in a line?'), h('small', null, "Optional. Handy if you're writing a reflective assignment later.")),
  icon('chevron', 18)
);

async function addToPlaybook(event) {
  if (!s.when.trim() || !s.will.trim()) {
    toast('Fill in both "When…" and "I\'ll…" first.', 'info');
    (s.when.trim() ? will : when).focus();
    return;
  }
  event.currentTarget.disabled = true;
  try {
    await flush();
    const move = await api(`/moments/${id}/playbook`, { method: 'POST' });
    location.href = `playbook.html#${move.id}`;
  } catch (err) {
    event.currentTarget.disabled = false;
    toast(err.message);
  }
}

const how = (label, text, { name = false, extra = null, action = null } = {}) =>
  h(
    'div.card.how',
    null,
    h('div.label', null, label, action),
    h(`p${text ? (name ? '.name' : '') : '.none'}`, null, text || "You didn't get to this in the chat."),
    extra
  );

const gotAction = Boolean(s.when && s.will);

main.replaceChildren(
  h(
    'div.inner',
    null,
    h(
      'div.page-head',
      null,
      h(
        'div',
        null,
        h('span.eyebrow', null, `${s.short_title || moment.title} · ${moment.minutes} minute${moment.minutes === 1 ? '' : 's'}`),
        h('h1', null, "Here's what you worked out."),
        h('span.note', null, icon('lock', 14), 'Saved on this computer')
      ),
      h('a.btn.quiet', { href: `chat.html?id=${id}` }, icon('chat'), 'Back to the chat')
    ),
    h(
      'div.cols',
      null,
      h(
        'div.left',
        null,
        h(
          'div.card.action',
          null,
          h(
            'div.stack',
            { style: 'gap: 4px' },
            h('span.eyebrow.accent', null, "What you'll try"),
            h('span.sub', null, gotAction ? 'From your chat, in your words. Edit anything.' : "You didn't settle on this in the chat. Write it here, or go back to the chat.")
          ),
          h('label', null, 'When…', when),
          h('label', null, "I'll…", will),
          h('div.tips', null, 'Works best when:', h('span', null, "you'll notice when it's time"), h('span', null, 'someone could see you do it'), h('span', null, 'you can try it this week')),
          s.phrases.length > 0 && h('div.phrases', null, h('b', null, 'Phrases to try'), s.phrases.map((p) => h('span', null, `“${p.replace(/^["“]|["”]$/g, '')}”`))),
          h(
            'div.try',
            null,
            h('div.where', null, h('label', null, 'Try it at', tryAt), h('label', null, 'On', tryDate)),
            h('div.switch-row', null, checkLabel, checkSwitch)
          )
        ),
        h('div.card.sumline', null, sumToggle, sumBody),
        h(
          'div.actions',
          null,
          h('button.btn.primary', { onclick: addToPlaybook }, icon('plus', 18, 2.2), moment.playbookId ? 'Update my playbook' : 'Add to my playbook'),
          h('a.btn', { href: `/api/moments/${id}/export`, download: 'momentz-notes.md', onclick: flush }, icon('download'), 'Export my notes')
        )
      ),
      h(
        'div.right',
        null,
        h('span.eyebrow', null, 'How you got there'),
        how('What happened', s.what_happened, { action: h('a.btn.small.quiet', { href: `chat.html?id=${id}` }, 'Add more later?') }),
        how('Expected vs. what happened', s.expected_vs_happened, { name: true }),
        how('What got in the way', s.what_got_in_the_way && `“${s.what_got_in_the_way}”`, {
          extra:
            moment.comparedWith > 0 &&
            h('span.similar', null, icon('dots', 14, 2.2), `You looked at this next to ${moment.comparedWith} earlier moment${moment.comparedWith === 1 ? '' : 's'}`)
        })
      )
    )
  )
);

// Don't lose the last edit if the student leaves straight after typing.
addEventListener('pagehide', () => {
  if (Object.keys(pending).length) {
    fetch(`/api/moments/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pending), keepalive: true });
  }
});
