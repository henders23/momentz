// Shared by every page: talking to the server, building DOM, icons, the sidebar.

import { saveProfile } from './store.js';

// --- Server -----------------------------------------------------------------

export async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
  } catch {
    throw new Error("Couldn't reach the coach. Check your connection and try again.");
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // An error without a message of ours didn't come from the Momentz server.
    throw new Error(data.error || (res.status === 404 ? "The coach isn't set up at this address: only the pages are being served." : 'Something went wrong. Please try again.'));
  }
  return data;
}

export const param = (name) => new URLSearchParams(location.search).get(name);

// --- DOM --------------------------------------------------------------------

/**
 * h('button.btn.primary', { onclick, 'aria-pressed': true }, 'Save')
 * Children may be strings, nodes, arrays, or null/false (skipped).
 */
export function h(spec, props, ...children) {
  const [tag, ...classes] = spec.split('.');
  const el = document.createElement(tag || 'div');
  if (classes.length) el.className = classes.join(' ');
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key in el && !key.includes('-')) el[key] = value;
    else el.setAttribute(key, String(value));
  }
  el.append(...children.flat(Infinity).filter((c) => c != null && c !== false));
  return el;
}

const ICONS = {
  mark: '<path d="M7 17L17 7"/><path d="M9 7h8v8"/>',
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 21V5"/><path d="M9 8h6"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/>',
  arrow: '<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>',
  up: '<path d="M12 19V5"/><path d="M6 11l6-6 6 6"/>',
  close: '<path d="M18 6L6 18"/><path d="M6 6l12 12"/>',
  chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  download: '<path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
  dots: '<circle cx="6" cy="17" r="2"/><circle cx="12" cy="7" r="2"/><circle cx="18" cy="14" r="2"/><path d="M7.4 15.4l3.4-6.6"/><path d="M13.6 8.4l3.2 4.4"/>'
};

export function icon(name, size = 16, stroke = 2) {
  const span = h('span.icon', { 'aria-hidden': 'true' });
  span.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
  return span;
}

let toastTimer;
export function toast(message, kind = 'error') {
  document.querySelector('.toast')?.remove();
  const el = h(`div.toast${kind === 'info' ? '.info' : ''}`, { role: 'alert' }, message);
  document.body.append(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 8000);
}

/** Grow a textarea to fit what is typed in it. */
export function autosize(textarea) {
  const fit = () => {
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight + 2}px`;
  };
  textarea.addEventListener('input', fit);
  requestAnimationFrame(fit);
  return fit;
}

// --- Dates ------------------------------------------------------------------

export function dayLabel(iso) {
  const date = new Date(iso);
  const days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(date).setHours(0, 0, 0, 0)) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return date.toLocaleDateString(undefined, { weekday: 'short' });
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

// --- Sidebar ----------------------------------------------------------------

export const momentHref = (m) => `${m.hasAction ? 'summary' : 'chat'}.html?id=${m.id}`;

function profileDialog(profile, onSaved) {
  const name = h('input.field', { value: profile.name, maxLength: 60, placeholder: 'e.g. Mei' });
  const course = h('input.field', { value: profile.course, maxLength: 80, placeholder: 'e.g. Global Development, Y1' });
  const dialog = h(
    'dialog',
    null,
    h(
      'form',
      {
        method: 'dialog',
        onsubmit: (event) => {
          event.preventDefault();
          try {
            onSaved(saveProfile({ name: name.value, course: course.value }));
            dialog.close();
          } catch (err) {
            toast(err.message);
          }
        }
      },
      h('h2', null, 'About you'),
      h('p.note', null, 'Optional. The coach uses this to make sense of your moments.'),
      h('label', null, 'Your name', name),
      h('label', null, 'What you study', course),
      h(
        'div.row',
        null,
        h('button.btn.quiet', { type: 'button', onclick: () => dialog.close() }, 'Cancel'),
        h('button.btn.primary', { type: 'submit' }, 'Save')
      )
    )
  );
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}

/**
 * Build the sidebar. `page` is 'home', 'playbook' or null; `currentId` marks
 * the moment being viewed.
 */
export function sidebar(state, { page = null, currentId = null } = {}) {
  const aside = h('aside.sidebar');
  const draw = () => {
    const { profile } = state;
    aside.replaceChildren(
      h('a.logo', { href: 'index.html' }, h('span.mark', null, icon('mark', 16, 2.6)), 'Momentz'),
      h(
        'nav.nav',
        null,
        h('a', { href: 'index.html', 'aria-current': page === 'home' && 'page' }, icon('home', 18), 'Home'),
        h('a', { href: 'playbook.html', 'aria-current': page === 'playbook' && 'page' }, icon('book', 18), 'Playbook')
      ),
      h(
        'div.recent',
        null,
        h('span.eyebrow', null, 'Recent moments'),
        state.moments.length
          ? state.moments.slice(0, 8).map((m) =>
              h(
                'a',
                { href: momentHref(m), 'aria-current': m.id === currentId && 'page', title: m.title },
                h('b', null, m.title),
                h('small', null, `${dayLabel(m.createdAt)} · ${m.hasAction ? '1 thing to try' : m.started ? 'In progress' : 'Not started'}`)
              )
            )
          : h('span.empty', null, 'Your moments will show up here.')
      ),
      h('div.spacer'),
      h(
        'button.profile',
        {
          'aria-label': 'Edit your details',
          onclick: () =>
            profileDialog(profile, (saved) => {
              state.profile = saved;
              draw();
            })
        },
        h('span.avatar', null, (profile.name || '?').charAt(0).toUpperCase()),
        h('span', null, h('b', null, profile.name || 'Add your name'), h('small', null, profile.course || 'and what you study'))
      )
    );
  };
  draw();
  return aside;
}
