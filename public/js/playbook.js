// The playbook: everything the student has decided to try, and how it's going.

import { autosize, dayLabel, h, sidebar, toast } from './common.js';
import { deleteMove, getState, logMove, updateMove } from './store.js';

const state = getState();
let filter = 'All';
// Which card has its log form, history or editor open: { id, panel }.
let open = location.hash ? { id: location.hash.slice(1), panel: null } : null;

const head = h('div.page-head');
const list = h('div.moves');

const STATUS = { new: 'New', trying: 'Trying', working: 'Working' };
const OUTCOME = { worked: 'It worked', partly: 'Partly', not: "Didn't work" };

function change(action) {
  try {
    action();
    Object.assign(state, getState());
  } catch (err) {
    toast(err.message);
  }
  draw();
}

function logForm(move) {
  let outcome = null;
  const note = h('textarea.field', { rows: 2, placeholder: 'What happened when you tried it? (optional)' });
  const buttons = Object.entries(OUTCOME).map(([value, label]) =>
    h(
      'button.chip',
      {
        'aria-pressed': 'false',
        onclick: (event) => {
          outcome = value;
          buttons.forEach((b) => b.setAttribute('aria-pressed', String(b === event.currentTarget)));
        }
      },
      label
    )
  );
  return h(
    'div.logform',
    null,
    h('div.row', { role: 'group', 'aria-label': 'How did it go?' }, buttons),
    note,
    h(
      'div.row',
      null,
      h(
        'button.btn.primary',
        {
          onclick: () => {
            if (!outcome) return toast('Pick how it went first.', 'info');
            open = { id: move.id, panel: 'history' };
            change(() => logMove(move.id, { outcome, note: note.value }));
          }
        },
        'Save'
      ),
      h('button.btn.quiet', { onclick: () => toggle(move, null) }, 'Cancel')
    )
  );
}

const history = (move) =>
  h(
    'div.history',
    null,
    move.log.length
      ? move.log.map((entry) => h('div', null, h('time', null, dayLabel(entry.at)), h('span', null, h('b', null, OUTCOME[entry.outcome]), entry.note && ` · ${entry.note}`)))
      : h('span.none', null, 'Nothing logged yet.')
  );

function toggle(move, panel) {
  open = open?.id === move.id && open.panel === panel ? null : { id: move.id, panel };
  draw();
}

function card(move) {
  const panel = open?.id === move.id ? open.panel : null;
  const editing = panel === 'edit';
  const when = editing && h('textarea.field', { rows: 1, value: move.when, 'aria-label': 'When' });
  const will = editing && h('textarea.field', { rows: 1, value: move.will, 'aria-label': "I'll" });
  if (editing) [when, will].forEach(autosize);

  return h(
    'article.card.move',
    { id: move.id },
    h('div.top', null, h('span.eyebrow', null, move.category || 'Other'), h(`span.pill.${move.status}`, null, move.status === 'new' && move.tryAt ? `New · try ${move.tryAt}` : STATUS[move.status])),
    h('h2', null, move.title),
    h('div.whenwill', null, h('div', null, h('b', null, 'When'), editing ? when : h('span', null, move.when)), h('div', null, h('b', null, "I'll"), editing ? will : h('span', null, move.will))),
    h(
      'div.foot',
      null,
      move.momentId ? h('a', { href: `summary.html?id=${move.momentId}` }, `From: ${move.source}`) : h('span', null, `From: ${move.source}`),
      editing
        ? h(
            'div.row',
            null,
            h('button.btn.danger', { onclick: () => confirm('Remove this from your playbook?') && change(() => deleteMove(move.id)) }, 'Remove'),
            h('button.btn.quiet', { onclick: () => toggle(move, 'edit') }, 'Cancel'),
            h(
              'button.btn.primary',
              {
                onclick: () => {
                  open = null;
                  change(() => updateMove(move.id, { when: when.value, will: will.value }));
                }
              },
              'Save'
            )
          )
        : h(
            'div.row',
            null,
            h('button.btn.quiet', { onclick: () => toggle(move, 'edit') }, 'Tweak'),
            h('button.btn.quiet', { 'aria-expanded': String(panel === 'history'), onclick: () => toggle(move, 'history') }, `History${move.log.length ? ` (${move.log.length})` : ''}`),
            h('button.btn', { 'aria-expanded': String(panel === 'log'), onclick: () => toggle(move, 'log') }, 'Log how it went')
          )
    ),
    panel === 'log' && logForm(move),
    panel === 'history' && history(move)
  );
}

function draw() {
  const moves = state.playbook;
  const categories = [...new Set(moves.map((m) => m.category || 'Other'))];
  if (!categories.includes(filter)) filter = 'All';
  const working = moves.filter((m) => m.status === 'working').length;

  head.replaceChildren(
    h(
      'div',
      null,
      h('span.eyebrow', { style: 'font-size: 12px' }, `${moves.length} thing${moves.length === 1 ? '' : 's'} to try · ${working} working`),
      h('h1', null, 'Your playbook'),
      h('p', null, "Things you've worked out from your own experience. Try them, keep what works, tweak what doesn't.")
    ),
    categories.length > 1
      ? h(
        'div.filters',
        null,
        ['All', ...categories].map((label) =>
          h(
            'button.chip.solid',
            {
              'aria-pressed': String(filter === label),
              onclick: () => {
                filter = label;
                draw();
              }
            },
            label
          )
        )
      )
      : ''
  );

  const shown = moves.filter((m) => filter === 'All' || (m.category || 'Other') === filter);
  list.replaceChildren(
    ...(shown.length
      ? shown.map(card)
      : [
          h(
            'div.card.blank',
            null,
            h('span.title', null, 'Nothing here yet'),
            h('p', null, 'Go through a moment from your week. The one small thing you decide to try at the end lands here.'),
            h('a.btn.primary', { href: 'index.html' }, 'Go through a moment')
          )
        ])
  );
}

document.body.append(h('div.shell', null, sidebar(state, { page: 'playbook' }), h('main.main', null, h('div.inner', null, head, list))));
draw();
if (open) document.getElementById(open.id)?.scrollIntoView({ block: 'center' });
