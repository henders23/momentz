// Home: name one moment, choose typing or speaking, start the chat.

import { api, autosize, h, icon, loadOrExplain, sidebar, toast } from './common.js';

const state = await loadOrExplain('/state');
let mode = localStorage.getItem('momentz-mode') === 'speak' ? 'speak' : 'type';

const moment = h('textarea.field', {
  id: 'moment',
  rows: 3,
  maxLength: 300,
  placeholder: "e.g. Tuesday's seminar, when I had a point but didn't say it"
});
autosize(moment);

const modeButton = (value, label, iconName) =>
  h(
    'button',
    {
      type: 'button',
      'aria-pressed': String(mode === value),
      onclick: (event) => {
        mode = value;
        localStorage.setItem('momentz-mode', mode);
        for (const b of event.currentTarget.parentNode.children) b.setAttribute('aria-pressed', String(b === event.currentTarget));
      }
    },
    icon(iconName),
    label
  );

const startButton = h('button.btn.primary.big', { type: 'submit' }, 'Start the chat', icon('arrow', 16, 2.2));

async function start(event) {
  event.preventDefault();
  if (!moment.value.trim()) {
    toast('Note which moment you want to go through first.', 'info');
    moment.focus();
    return;
  }
  startButton.disabled = true;
  try {
    const created = await api('/moments', { method: 'POST', body: { title: moment.value, mode } });
    location.href = `chat.html?id=${created.id}`;
  } catch (err) {
    startButton.disabled = false;
    toast(err.message);
  }
}

moment.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) start(event);
});

// The move the student is trying now, and how the playbook is doing.
const trying = state.playbook.find((p) => p.status !== 'working');
const working = state.playbook.filter((p) => p.status === 'working');

const tryingCard = trying
  ? h(
      'div.card',
      null,
      h('div.head', null, h('span.eyebrow.orange', null, trying.status === 'new' ? 'To try next' : 'Trying now'), trying.tryAt && h('span', null, trying.tryAt)),
      h('span.title', null, trying.title),
      h('p', null, `When ${trying.when}, I'll ${trying.will}.`),
      h('a.note', { href: `playbook.html#${trying.id}` }, trying.checkIn ? 'Tried it? Log how it went.' : 'Open in your playbook')
    )
  : h(
      'div.card',
      null,
      h('div.head', null, h('span.eyebrow.orange', null, 'To try next')),
      h('span.title', null, 'Nothing yet'),
      h('p', null, 'Each chat ends with one small thing to try. It will show up here.')
    );

const playbookCard = h(
  'a.card',
  { href: 'playbook.html' },
  h(
    'div.stack',
    null,
    h('span.eyebrow.accent', null, 'Your playbook'),
    h(
      'span.title',
      null,
      working.length
        ? `${working.length} thing${working.length === 1 ? '' : 's'} you've tried ${working.length === 1 ? 'is' : 'are'} working`
        : state.playbook.length
          ? `${state.playbook.length} thing${state.playbook.length === 1 ? '' : 's'} to try`
          : 'Empty for now'
    ),
    h(
      'p',
      null,
      (working.length ? working : state.playbook)
        .slice(0, 3)
        .map((p) => p.title)
        .join(' · ') || 'What you work out from your own moments collects here.'
    )
  ),
  h('span.go', null, 'Open playbook', icon('arrow', 16, 2.2))
);

document.body.append(
  h(
    'div.shell',
    null,
    sidebar(state, { page: 'home' }),
    h(
      'main.main',
      null,
      h(
        'div.inner',
        null,
        h(
          'div.stack',
          null,
          h('h1', null, state.profile.name ? `Let's go through a moment from this week's studying, ${state.profile.name}` : "Let's go through a moment from this week's studying"),
          h(
            'span.note',
            null,
            icon('lock', 14),
            state.temporary
              ? "This hosted copy only keeps your moments for a short while. Export anything you want to keep. Only the chat goes to Claude, to get the coach's replies."
              : "Your moments are saved on this computer. Only the chat goes to Claude, to get the coach's replies."
          )
        ),
        h(
          'form.card.start',
          { onsubmit: start },
          h(
            'div.stack',
            null,
            h('label', { htmlFor: 'moment' }, 'Which moment would you like to go through?'),
            h('span.hint', null, 'This could be a seminar, a lab, some individual study. Note what the moment was here.'),
            moment
          ),
          h(
            'div.bar',
            null,
            h(
              'div.mode',
              null,
              'Talk it through by',
              h('div.segmented', { role: 'group', 'aria-label': 'Input mode' }, modeButton('type', 'Typing', 'keyboard'), modeButton('speak', 'Speaking', 'mic'))
            ),
            startButton
          )
        ),
        h(
          'div.stack',
          null,
          h('span.eyebrow', null, 'What the chat will ask'),
          h(
            'div.steps',
            null,
            [
              ['What happened', 'Messy is fine.'],
              ['What you expected', 'The difference is the useful bit.'],
              ['What got in the way', 'In that exact moment.'],
              ["What you'll try", 'One small thing, and when.']
            ].map(([title, text]) => h('div', null, h('b', null, title), h('span', null, text)))
          )
        ),
        h('div.pair', null, tryingCard, playbookCard)
      )
    )
  )
);
moment.focus();
