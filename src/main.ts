import { telemetry } from './core/analytics';
import { L, localeTag } from './core/i18n';
import '@fontsource-variable/space-grotesk';
import './styles/index.css';
import { Feed } from './app/feed';
import { dayStreak, getProfile, onChange } from './core/store';
import { cogIcon, h, s } from './ui/dom';
import { PlayView } from './pages/play';
import { renderGames } from './pages/games';
import { renderSettings } from './pages/settings';
import { renderStats } from './pages/stats';
import { GAMES } from './games';
import { setupUpdates } from './app/update';
import { closeSheet } from './ui/sheet';
import { onNavigate } from './app/nav';
import { isReload, sessionGet, sessionSet } from './core/session';

const app = document.getElementById('app')!;
telemetry.track('app.open', {
  'app.installed': matchMedia('(display-mode: standalone)').matches,
  'player.age_days': Math.floor((Date.now() - getProfile().created) / 86_400_000),
  'player.games_played': Object.values(getProfile().stats).reduce((n, st) => n + st.played, 0),
});

// Simple geometric tab icons (24×24, stroked with currentColor).
const icon = (...paths: string[]) =>
  s('svg', { viewBox: '0 0 24 24', class: 'tab-icon', 'aria-hidden': 'true' }, ...paths.map((d) => s('path', { d })));
const ICONS = {
  feed: () => icon('M5 4h14v7H5z', 'M5 15h14v5H5z'),
  games: () => icon('M6 9h12a4 4 0 0 1 0 8H6a4 4 0 0 1 0-8z', 'M8 11v4', 'M6 13h4', 'M15.5 12.5h.01', 'M17.5 14.5h.01'),
  stats: () => icon('M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M4 21c1-4 4-6 8-6s7 2 8 6'),
  settings: () => cogIcon('tab-icon'),
};
const flame = () =>
  s(
    'svg',
    { viewBox: '0 0 24 24', class: 'streak-icon', 'aria-hidden': 'true' },
    s('path', {
      d: 'M12 22c4 0 7-2.7 7-6.6 0-3.2-2-5.4-3.6-7.2-.4 1.6-1.2 2.6-2.4 3C13.4 7.6 11.6 4.4 8.6 2c.3 3.2-1.3 5.3-2.8 7.3C4.8 10.8 5 12.6 5 15.4 5 19.3 8 22 12 22z',
    }),
  );
const tab = (key: keyof typeof ICONS, href: string, label: string) =>
  h('a', { href, class: 'tab', 'data-tab': key, title: label }, ICONS[key](), h('span', null, label));
const tabs = {
  feed: tab('feed', '/', L('Feed', 'Fil')),
  games: tab('games', '/games', L('Games', 'Jeux')),
  stats: tab('stats', '/stats', L('Profile', 'Profil')),
  settings: tab('settings', '/settings', L('Settings', 'Réglages')),
};

document.documentElement.lang = localeTag();
const streak = h('span', { class: 'streak', title: L('Day streak', 'Jours consécutifs') });
const practice = h('a', { class: 'practice', href: '/', title: L('Back to the mixed feed', 'Retour au fil mélangé'), hidden: true });
const header = h(
  'header',
  { class: 'top' },
  h(
    'a',
    { class: 'brand', href: '/' },
    h('img', { class: 'logo', src: '/favicon.svg', alt: '', width: '25', height: '25' }),
    'arcade feed',
  ),
  h('div', { class: 'top-extra' }, streak, practice),
  h('nav', { class: 'tabs', 'aria-label': L('Main', 'Principal') }, ...Object.values(tabs)),
);
const feed = new Feed(GAMES);
const play = new PlayView();
const page = h('div', { class: 'page-wrap' });
app.append(header, feed.el, play.el, page);

function applyTheme() {
  const t = getProfile().theme;
  if (t === 'system') delete document.documentElement.dataset['theme'];
  else document.documentElement.dataset['theme'] = t === 'oled' ? 'dark' : t;
  // OLED is dark mode with pure-black surfaces (themes.css), so every dark rule still applies.
  if (t === 'oled') document.documentElement.dataset['oled'] = '';
  else delete document.documentElement.dataset['oled'];
  const style = getProfile().style ?? 'neo';
  if (style === 'neo') delete document.documentElement.dataset['style'];
  else document.documentElement.dataset['style'] = style;
  // Browser / status bar colour follows the page background of the current style and mode.
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg || '#fff6e5');
}
function updateStreak() {
  const n = dayStreak();
  streak.replaceChildren(...(n > 1 ? [flame(), h('span', null, L(`${n} day streak`, `${n} jours de suite`))] : []));
}

type View = 'feed' | 'games' | 'game' | 'stats' | 'settings';
let gameOpen: string | null = null;

function route() {
  const [r = 'feed', arg] = location.pathname.split('/').filter(Boolean);
  const def = GAMES.find((p) => p.id === arg);
  let view: View = r === 'stats' || r === 'settings' || r === 'games' ? r : 'feed';
  if (r === 'game' && def) view = 'game';

  // /play/<id>: a feed of that game only.
  const only = r === 'play' && def ? def.id : null;
  if (view === 'feed') feed.setOnly(only);
  practice.hidden = !(view === 'feed' && only);
  if (only && def)
    practice.replaceChildren(
      h('span', { class: 'swatchlet', 'data-puzzle': def.id }),
      h('span', { class: 'practice-name' }, def.name),
      h('span', { class: 'practice-x', 'aria-hidden': 'true' }, '✕'),
    );

  if (view === 'game' && def) {
    if (gameOpen !== def.id) play.open(def);
    gameOpen = def.id;
  } else if (gameOpen) {
    play.close();
    gameOpen = null;
  }

  const activeTab = view === 'game' ? 'games' : view;
  for (const [k, a] of Object.entries(tabs)) a.classList.toggle('on', k === activeTab && !(k === 'feed' && only));

  feed.el.hidden = view !== 'feed';
  play.el.hidden = view !== 'game';
  page.hidden = view === 'feed' || view === 'game';
  feed.setShown(view === 'feed');
  play.setShown(view === 'game');
  if (view === 'games') renderGames(page, GAMES);
  if (view === 'stats') renderStats(page, GAMES);
  if (view === 'settings') renderSettings(page, GAMES);
  if (!page.hidden) page.scrollTop = 0;
  updateStreak();
  sessionSet('route', location.pathname);
}

onChange((kind) => {
  if (kind === 'profile') applyTheme();
  updateStreak();
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
onNavigate(route);
// The system back button (installed app) closes an open sheet first.
(window as unknown as { __onBack: () => boolean }).__onBack = closeSheet;
applyTheme();
// A reload that dropped the route (e.g. the app reloading its start page) goes back to it.
const storedRoute = isReload && location.pathname === '/' ? sessionGet('route') : undefined;
if (typeof storedRoute === 'string' && storedRoute !== '/') history.replaceState(null, '', storedRoute);
route();
setupUpdates();
