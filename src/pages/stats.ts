import { L, P, localeTag } from '../core/i18n';
import { confirmSheet, noticeSheet } from '../ui/sheet';
import { dayKey, dayStreak, exportProfile, getProfile, importProfile, prefs, resetProfile, stats, update } from '../core/store';
import { LEVELS, type GameDef } from '../core/types';
import { btn, fmtTime, h, s } from '../ui/dom';
import { levelTag, starRow } from '../ui/result';
import { gameArt } from '../app/art';

const DAYS = 14;

/** Small stroked icons for the stat tiles (24×24, currentColor). */
const ICONS: Record<string, string[]> = {
  cleared: ['M5 12.5l4.5 4.5L19 7.5'],
  played: ['M8 5.5v13l10.5-6.5z'],
  rate: ['M11 4a8 8 0 1 0 9 9h-9z', 'M14 2.5a8 8 0 0 1 7.5 7.5H14z'],
  stars: ['M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z'],
  time: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 7v5l3 2'],
  streak: [
    'M12 22c4 0 7-2.7 7-6.6 0-3.2-2-5.4-3.6-7.2-.4 1.6-1.2 2.6-2.4 3C13.4 7.6 11.6 4.4 8.6 2c.3 3.2-1.3 5.3-2.8 7.3C4.8 10.8 5 12.6 5 15.4 5 19.3 8 22 12 22z',
  ],
};
const icon = (k: string) =>
  s('svg', { viewBox: '0 0 24 24', class: 'stat-icon', 'aria-hidden': 'true' }, ...(ICONS[k] ?? []).map((d) => s('path', { d })));

export function renderStats(el: HTMLElement, defs: GameDef[]) {
  const p = getProfile();
  const all = defs.map((d) => ({ d, s: stats(d.id), pr: prefs(d.id) }));
  const played = all.reduce((a, x) => a + x.s.played, 0);
  const cleared = all.reduce((a, x) => a + x.s.cleared, 0);
  const time = all.reduce((a, x) => a + x.s.time, 0);
  const starsOf = (x: (typeof all)[number]) => LEVELS.reduce((n, l) => n + (x.s.stars[l] ?? 0), 0);
  const stars = all.reduce((a, x) => a + starsOf(x), 0);
  const streak = dayStreak();

  const tile = (k: string, label: string, value: string | number) =>
    h('div', { class: 'stat', 'data-stat': k }, icon(k), h('div', { class: 'stat-v' }, value), h('div', { class: 'stat-l' }, label));

  const nameInput = h('input', {
    class: 'input inline',
    value: p.name,
    placeholder: L('Your name', 'Votre nom'),
    'aria-label': L('Your name', 'Votre nom'),
    maxlength: 32,
    onchange: () => {
      update({ name: nameInput.value.trim() });
      avatar.textContent = initial();
    },
  });
  const initial = () => [...(nameInput.value.trim() || '?')][0].toUpperCase();
  const avatar = h('div', { class: 'avatar', 'aria-hidden': 'true' }, initial());

  // The last two weeks, one square per day, shaded by the number of clears.
  const dayCounts = Array.from({ length: DAYS }, (_, i) => {
    const t = Date.now() - (DAYS - 1 - i) * 86_400_000;
    return { t, n: p.days[dayKey(t)] ?? 0 };
  });
  const activeLabel = P(dayCounts.filter((x) => x.n > 0).length, ['active day', 'active days'], ['jour actif', 'jours actifs']);
  const days = dayCounts.map(({ t, n }, i) => {
    const date = new Date(t).toLocaleDateString(localeTag(), { weekday: 'short', day: 'numeric', month: 'short' });
    return h('span', {
      class: ['day', n ? 'on' : '', i === DAYS - 1 ? 'today' : ''].filter(Boolean).join(' '),
      style: `--v:${n ? Math.min(1, 0.3 + n / 8).toFixed(2) : 0}`,
      title: `${date}: ${P(n, ['clear', 'clears'], ['réussite', 'réussites'])}`,
    });
  });

  const rows = all
    .sort((a, b) => b.s.played - a.s.played || a.d.name.localeCompare(b.d.name, localeTag()))
    .map((x) => {
      const { d, s: st, pr } = x;
      const best = st.best[pr.level];
      const rate = st.played ? Math.round((100 * st.cleared) / st.played) : null;
      return h(
        'a',
        { class: `game-row ${st.played ? '' : 'unplayed'}`.trim(), href: `/game/${d.id}`, 'data-puzzle': d.id },
        h('span', { class: 'row-art' }, gameArt(d)),
        h(
          'span',
          { class: 'row-main' },
          h('strong', { class: 'row-name' }, d.name),
          h('span', { class: 'row-level' }, levelTag(pr.level, !pr.manual), starRow(st.stars[pr.level] ?? 0, 'lvl-stars')),
          h(
            'span',
            { class: 'row-rate' },
            h('span', { class: 'meter', 'aria-hidden': 'true' }, h('i', { style: `width:${rate ?? 0}%` })),
            st.played
              ? L(`${st.cleared} of ${st.played} cleared`, `${st.cleared} sur ${st.played} réussis`)
              : L('Not played yet', 'Pas encore joué'),
          ),
        ),
        h(
          'span',
          { class: 'row-side' },
          h('small', null, L('best', 'record')),
          h('strong', null, best ?? '—'),
          h(
            'small',
            { class: 'row-total', title: L('Stars over all levels', 'Étoiles sur tous les niveaux') },
            `★ ${starsOf(x)}/${LEVELS.length * 3}`,
          ),
        ),
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
      { class: 'page profile' },
      h('h1', null, L('Profile', 'Profil')),
      h(
        'div',
        { class: 'profile-card' },
        avatar,
        h(
          'div',
          { class: 'profile-id' },
          nameInput,
          h(
            'p',
            { class: 'muted small' },
            L(
              `Playing since ${new Date(p.created).toLocaleDateString(localeTag(), { dateStyle: 'long' })}. Everything is stored on this device.`,
              `Vous jouez depuis le ${new Date(p.created).toLocaleDateString(localeTag(), { dateStyle: 'long' })}. Tout est stocké sur cet appareil.`,
            ),
          ),
        ),
      ),
      h(
        'div',
        { class: 'stats' },
        tile('cleared', L('cleared', 'réussis'), cleared),
        tile('played', L('played', 'joués'), played),
        tile('rate', L('clear rate', 'taux de réussite'), played ? `${Math.round((100 * cleared) / played)}%` : '—'),
        tile('stars', L('stars', 'étoiles'), stars),
        tile('time', L('play time', 'temps de jeu'), fmtTime(time)),
        tile('streak', L('day streak', 'jours de suite'), streak),
      ),
      h(
        'section',
        { class: 'panel activity' },
        h(
          'div',
          { class: 'panel-head' },
          h('h3', null, L('Last two weeks', 'Deux dernières semaines')),
          h('span', { class: 'muted small' }, activeLabel),
        ),
        h(
          'div',
          { class: 'days', role: 'img', 'aria-label': `${L('Last two weeks', 'Deux dernières semaines')}: ${activeLabel}` },
          ...days,
        ),
      ),
      h('h3', null, L('By game', 'Par jeu')),
      h('div', { class: 'game-rows' }, ...rows),
      h(
        'p',
        { class: 'muted small' },
        L(
          'Level, stars and best score are for the current level. Tap a game to open it.',
          'Le niveau, les étoiles et le record sont ceux du niveau actuel. Touchez un jeu pour l’ouvrir.',
        ),
      ),
      h('h3', null, L('Your data', 'Vos données')),
      h(
        'div',
        { class: 'row data-row' },
        btn(L('Export', 'Exporter'), () => {
          const a = h('a', {
            href: URL.createObjectURL(new Blob([exportProfile()], { type: 'application/json' })),
            download: 'arcade-feed-profile.json',
          });
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        }),
        btn(L('Import', 'Importer'), () => fileInput.click()),
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
