import { L, localeTag } from '../core/i18n';
import { confirmSheet, noticeSheet } from '../ui/sheet';
import { dayStreak, exportProfile, getProfile, importProfile, prefs, resetProfile, stats, update } from '../core/store';
import { LEVEL_NAMES, LEVELS, type GameDef } from '../core/types';
import { btn, fmtTime, h } from '../ui/dom';
import { starRow } from '../ui/result';

export function renderStats(el: HTMLElement, defs: GameDef[]) {
  const p = getProfile();
  const all = defs.map((d) => ({ d, s: stats(d.id), pr: prefs(d.id) }));
  const played = all.reduce((a, x) => a + x.s.played, 0);
  const cleared = all.reduce((a, x) => a + x.s.cleared, 0);
  const time = all.reduce((a, x) => a + x.s.time, 0);
  const stars = all.reduce((a, x) => a + LEVELS.reduce((n, l) => n + (x.s.stars[l] ?? 0), 0), 0);

  const tile = (label: string, value: string | number) =>
    h('div', { class: 'stat' }, h('div', { class: 'stat-v' }, value), h('div', { class: 'stat-l' }, label));

  const nameInput = h('input', {
    class: 'input inline',
    value: p.name,
    placeholder: L('Your name', 'Votre nom'),
    'aria-label': L('Your name', 'Votre nom'),
    maxlength: 32,
    onchange: () => update({ name: nameInput.value.trim() }),
  });

  const rows = all
    .sort((a, b) => b.s.played - a.s.played || a.d.name.localeCompare(b.d.name, localeTag()))
    .map(({ d, s, pr }) => {
      const best = s.best[pr.level];
      return h(
        'tr',
        { 'data-puzzle': d.id },
        h(
          'td',
          null,
          h('a', { href: `/game/${d.id}`, title: `${L('Open', 'Ouvrir')} ${d.name}` }, h('span', { class: 'swatchlet' }), d.name),
        ),
        h('td', null, LEVEL_NAMES[pr.level], h('span', { class: 'muted' }, pr.manual ? L(' · fixed', ' · fixe') : ' · auto')),
        h('td', null, starRow(s.stars[pr.level] ?? 0, 'lvl-stars')),
        h('td', { class: 'num' }, s.cleared),
        h('td', { class: 'num' }, s.played ? `${Math.round((100 * s.cleared) / s.played)}%` : '—'),
        h('td', { class: 'num' }, best ?? '—'),
      );
    });

  const fileInput = h('input', { type: 'file', accept: 'application/json', hidden: true });
  const importFile = async () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    try {
      importProfile(await f.text());
      renderStats(el, defs);
    } catch (e) {
      noticeSheet(
        L('Import failed', 'Importation impossible'),
        `${L('That file isn’t an arcade feed profile.', 'Ce fichier n’est pas un profil arcade feed.')} (${(e as Error).message})`,
      );
    }
  };
  fileInput.addEventListener('change', () => void importFile());

  el.replaceChildren(
    h(
      'div',
      { class: 'page' },
      h('div', { class: 'page-head' }, h('h1', null, L('Profile', 'Profil')), nameInput),
      h(
        'p',
        { class: 'muted' },
        L(
          `Playing since ${new Date(p.created).toLocaleDateString(localeTag())}. Everything is stored on this device.`,
          `Vous jouez depuis le ${new Date(p.created).toLocaleDateString(localeTag())}. Tout est stocké sur cet appareil.`,
        ),
      ),
      h(
        'div',
        { class: 'stats' },
        tile(L('cleared', 'réussis'), cleared),
        tile(L('played', 'joués'), played),
        tile(L('clear rate', 'taux de réussite'), played ? `${Math.round((100 * cleared) / played)}%` : '—'),
        tile(L('stars', 'étoiles'), stars),
        tile(L('play time', 'temps de jeu'), fmtTime(time)),
        tile(L('day streak', 'jours de suite'), dayStreak()),
      ),
      h('h3', null, L('By game', 'Par jeu')),
      h(
        'div',
        { class: 'table-wrap pinned' },
        h(
          'table',
          null,
          h(
            'thead',
            null,
            h(
              'tr',
              null,
              ...[
                L('Game', 'Jeu'),
                L('Difficulty', 'Difficulté'),
                L('Stars', 'Étoiles'),
                L('Cleared', 'Réussis'),
                L('Rate', 'Taux'),
                L('Best', 'Record'),
              ].map((x, i) => h('th', { class: i > 2 ? 'num' : '' }, x)),
            ),
          ),
          h('tbody', null, ...rows),
        ),
      ),
      h(
        'p',
        { class: 'muted small' },
        L(
          'Stars and best score are for the current level. Tap a game to open it.',
          'Les étoiles et le record sont ceux du niveau actuel. Touchez un jeu pour l’ouvrir.',
        ),
      ),
      h(
        'div',
        { class: 'row' },
        btn(
          L('Export', 'Exporter'),
          () => {
            const a = h('a', {
              href: URL.createObjectURL(new Blob([exportProfile()], { type: 'application/json' })),
              download: 'arcade-feed-profile.json',
            });
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 1000);
          },
          'ghost',
        ),
        btn(L('Import', 'Importer'), () => fileInput.click(), 'ghost'),
        btn(L('Reset everything', 'Tout effacer'), () => void resetEverything(), 'ghost'),
        fileInput,
      ),
    ),
  );

  async function resetEverything() {
    const ok = await confirmSheet({
      title: L('Reset everything?', 'Tout effacer?'),
      message: L(
        'This erases your profile, stats and settings on this device. It can’t be undone. Export first to keep a copy.',
        'Cela efface votre profil, vos statistiques et vos réglages sur cet appareil. C’est irréversible. Exportez d’abord pour en garder une copie.',
      ),
      action: L('Erase everything', 'Tout effacer'),
      danger: true,
    });
    if (!ok) return;
    resetProfile();
    renderStats(el, defs);
  }
}
