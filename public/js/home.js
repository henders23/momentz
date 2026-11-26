// Home: a welcome each time the app is opened, then name one moment, choose typing or
// speaking, and start the chat.

import { autosize, h, icon, sidebar, toast } from './common.js';
import { createMoment, getState } from './store.js';

const state = getState();
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

function start(event) {
  event.preventDefault();
  if (!moment.value.trim()) {
    toast('Note which moment you want to go through first.', 'info');
    moment.focus();
    return;
  }
  try {
    location.href = `chat.html?id=${createMoment({ title: moment.value, mode })}`;
  } catch (err) {
    toast(err.message);
  }
}

moment.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) start(event);
});

const home =
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
          h('p.lead', null, "The chat asks four things: what happened, what you expected, what got in the way, and what you'll try next time."),
          h('span.note', null, icon('lock', 14), "Your moments are saved in this browser, on this device. Only the chat goes to Claude, to get the coach's replies.")
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
        )
      )
    )
  );

function showHome() {
  document.body.replaceChildren(home);
  moment.focus();
}

// Shown each time the app is opened. Coming back to Home from another page
// in the same visit skips it.
function showWelcome() {
  const start = h(
    'button.btn.primary.big',
    {
      onclick: () => {
        sessionStorage.setItem('momentz-welcomed', 'yes');
        showHome();
      }
    },
    "Let's start",
    icon('arrow', 16, 2.2)
  );
  document.body.replaceChildren(
    h(
      'main.welcome',
      null,
      h('span.mark', null, icon('mark', 24, 2.6)),
      h('h1', null, 'Welcome to Momentz!'),
      h('p', null, 'Momentz is a study coach. Pick one moment from your week of studying, such as a seminar, a lab or some time working on your own, and talk it through.'),
      h('p', null, 'You leave with one small thing to try next time, in your own words.'),
      start
    )
  );
  start.focus();
}

if (sessionStorage.getItem('momentz-welcomed')) showHome();
else showWelcome();
