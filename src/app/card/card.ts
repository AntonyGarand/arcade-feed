import { telemetry } from '../../core/analytics';
import { L, P } from '../../core/i18n';
import { Rng } from '../../core/rng';
import { getProfile, prefs, record, setLevel, stats, type Outcome } from '../../core/store';
import { LEVEL_IDS, LEVEL_NAMES, starsFor, type Difficulty, type GameDef, type GameInstance } from '../../core/types';
import { confetti } from '../../ui/confetti';
import { cogIcon, h, s } from '../../ui/dom';
import { helpButton } from '../../ui/help';
import { levelTag, resultCard, starRow } from '../../ui/result';
import { gameArt } from '../art';
import { Clock } from './clock';
import { fitBoard } from './fit';
import { FrameLoop } from './loop';
import { PadView } from './pad';
import { openGameSettings } from './settings-sheet';
import { haptic, sfx } from '../../kits/sound/sound';

export interface CardOptions {
  /** Games tab: fixed level (doesn't touch feed prefs), no auto-advance, "New level" instead of "Next". */
  lab?: boolean;
  /** Start at this level instead of the game's current level. */
  level?: Difficulty | undefined;
  /** Play this exact seed on the first mount. */
  seed?: number | undefined;
}

/**
 * Where a run is: `ready` shows the start gate over the level, `playing` runs the frame loop while the
 * card is on screen, `paused` shows the gate again (scrolled away, a sheet, the tab hidden, P / Esc),
 * `over` shows the result.
 */
type Phase = 'ready' | 'playing' | 'paused' | 'over';

/**
 * One arcade card: header (level, lives, score, help, settings), the game on its stage with the
 * start / pause gate over it, and the footer (status, result actions). Owns the run around the game:
 * the frame loop, pausing, timing, recording the result.
 */
export class Card {
  readonly el: HTMLElement;
  private stage!: HTMLElement;
  private gate!: HTMLElement;
  private foot!: HTMLElement;
  private statusEl!: HTMLElement;
  private levelEl!: HTMLElement;
  private scoreEl!: HTMLElement;
  private scoreVal!: HTMLElement;
  private livesEl!: HTMLElement;
  private pad: PadView | null = null;
  private inst: GameInstance = {};
  private root: HTMLElement | null = null;
  private resize = new ResizeObserver(() => {
    this.fit();
    this.inst.draw?.();
  });
  private loop = new FrameLoop((dt) => this.inst.frame?.(dt));
  private clock = new Clock();

  level: Difficulty = 1;
  mounted = false;
  phase: Phase = 'ready';
  private active = false;
  private score = 0;
  /** Bumped for every mount: callbacks from an older game instance are ignored. */
  private gen = 0;
  /** `gen` of the run already reported as left (scrolled past), so it's reported once. */
  private leftGen = -1;
  private seed = 0;
  private advanceTimer = 0;
  private first: { level?: Difficulty | undefined; seed?: number | undefined } | null;

  constructor(
    readonly def: GameDef,
    private readonly onNext: (card: Card) => void,
    private readonly opts: CardOptions = {},
  ) {
    this.first = { level: opts.level, seed: opts.seed };
    this.el = h('article', { class: 'card', 'data-puzzle': def.id });
    (this.el as HTMLElement & { card?: Card }).card = this;
    this.build();
  }

  get done() {
    return this.phase === 'over';
  }

  /** Not started yet: safe to regenerate or drop. */
  get pristine() {
    return this.phase === 'ready';
  }

  /** Seed of the level on this card (with `level`, enough to deal the same level again). */
  get levelSeed() {
    return this.seed;
  }

  private build() {
    this.scoreVal = h('strong', null, '0');
    this.scoreEl = h('span', { class: 'score', title: L('Score', 'Score') }, h('small', null, L('Score', 'Score')), this.scoreVal);
    this.livesEl = h('span', { class: 'lives', title: L('Lives', 'Vies'), hidden: true });
    this.levelEl = h('span', { class: 'level-label' });
    this.stage = h('div', { class: 'stage' });
    this.gate = h('div', { class: 'gate' });
    this.gate.addEventListener('click', () => this.go());
    this.statusEl = h('span', { class: 'status' });
    this.foot = h('footer', { class: 'card-foot' });
    const settings = h(
      'button',
      {
        type: 'button',
        class: 'icon-btn',
        'data-action': 'settings',
        title: L('Game settings', 'Réglages du jeu'),
        'aria-label': L('Game settings', 'Réglages du jeu'),
      },
      cogIcon(),
    );
    settings.addEventListener('click', () => this.openSettings());
    let resume = () => {};
    const help = helpButton(this.def, { onOpen: () => (resume = this.pauseWhile()), onClose: () => resume() });
    const pad = this.def.pad?.();
    this.pad = pad ? new PadView(pad, { key: (e) => this.padKey(e) }) : null;
    this.el.replaceChildren(
      h(
        'header',
        { class: 'card-head' },
        h('div', { class: 'title' }, h('h2', null, this.def.name), this.levelEl),
        h('div', { class: 'meta' }, this.livesEl, this.scoreEl, help, settings),
      ),
      this.stage,
      ...(this.pad ? [this.pad.el] : []),
      this.foot,
    );
    this.resize.observe(this.stage);
  }

  /** Pause while a sheet (help, settings) is open. Returns the function that puts things back. */
  private pauseWhile(): () => void {
    const was = this.phase === 'playing';
    if (was) this.pause();
    return () => {
      if (was && this.active) this.syncGate();
    };
  }

  private openSettings() {
    const lab = !!this.opts.lab;
    openGameSettings({
      def: this.def,
      level: this.level,
      lab,
      done: this.done,
      pause: () => this.pauseWhile(),
      pickLevel: (v) => {
        if (lab) return this.mount({ level: v });
        setLevel(this.def.id, v); // picking a level turns Auto off
        this.mount(); // the feed also regenerates untouched upcoming cards
      },
      skip: () => this.finish('skipped'),
    });
  }

  private syncLevelLabel() {
    const auto = !this.opts.lab && !prefs(this.def.id).manual;
    const best = stats(this.def.id).stars[this.level] ?? 0;
    this.levelEl.replaceChildren(levelTag(this.level, auto), starRow(best, 'lvl-stars'));
  }

  /** Re-sync the level label without regenerating (e.g. auto→manual elsewhere). */
  refreshLevelLabel() {
    this.syncLevelLabel();
  }

  private syncLives(count: number, max: number) {
    const left = Math.max(0, Math.min(max, count));
    const el = this.livesEl;
    const lost = el.dataset['left'] !== '' && left < Number(el.dataset['left']);
    el.dataset['left'] = String(left);
    el.hidden = false;
    el.setAttribute('aria-label', P(left, ['life left', 'lives left'], ['vie restante', 'vies restantes']));
    // Up to five hearts in a row; more than that would crowd the header, so it becomes one heart and a count.
    if (max > 5) el.replaceChildren(h('i', { class: left ? 'on' : '' }), h('b', null, `${left}`));
    else el.replaceChildren(...Array.from({ length: max }, (_, i) => h('i', { class: i < left ? 'on' : '' })));
    if (lost) {
      bump(el);
      sfx('hurt');
      haptic(60);
    }
  }

  private syncScore(n: number) {
    const up = n > this.score;
    this.score = n;
    this.scoreVal.textContent = String(n);
    if (up) bump(this.scoreEl);
  }

  /** Size the game to the space left between header and footer. */
  fit() {
    fitBoard(this.stage);
  }

  /** Deal a level: a fresh game behind the start gate. */
  mount(launch = this.first) {
    this.first = null; // the launch options only apply to the first mount
    const gen = ++this.gen;
    clearTimeout(this.advanceTimer);
    this.pad?.releaseAll();
    this.loop.stop();
    this.clock.reset();
    this.inst.destroy?.();
    this.inst = {};
    this.level = launch?.level ?? (this.opts.lab && this.mounted ? this.level : prefs(this.def.id).level);
    this.seed = launch?.seed ?? (Math.random() * 2 ** 32) >>> 0;
    this.mounted = true;
    this.phase = 'ready';
    this.score = 0;
    this.scoreVal.textContent = '0';
    this.el.classList.remove('is-cleared', 'is-lost', 'is-skipped');
    this.livesEl.hidden = true;
    this.livesEl.dataset['left'] = '';
    this.statusEl.textContent = '';
    this.foot.replaceChildren(this.statusEl);
    this.syncLevelLabel();

    if (this.root) this.resize.unobserve(this.root);
    const root = h('div', { class: 'puzzle' });
    this.root = root;
    this.stage.replaceChildren(root, this.gate);
    const live = () => gen === this.gen && this.phase !== 'over';
    this.inst =
      this.def.create({
        difficulty: this.level,
        rng: new Rng(this.seed),
        root,
        score: (n) => live() && this.syncScore(n),
        lives: (left, max) => live() && this.syncLives(left, max),
        status: (t) => {
          if (live()) this.statusEl.textContent = t;
        },
        win: () => live() && this.finish('cleared'),
        lose: () => live() && this.finish('lost'),
      }) || {};
    this.resize.observe(root);
    this.fit();
    this.inst.draw?.();
    this.syncGate();
  }

  /** Start or resume the run (the gate's tap, Space or Enter). */
  go() {
    if (this.phase !== 'ready' && this.phase !== 'paused') return;
    if (this.phase === 'ready') {
      telemetry.track('game.start', this.trackAttrs());
      sfx('start');
    }
    this.phase = 'playing';
    this.syncGate();
  }

  /** Pause a live run (scrolled away, a sheet, P / Esc). */
  pause() {
    if (this.phase !== 'playing') return;
    this.phase = 'paused';
    this.syncGate();
  }

  /** Run the loop and the clock only while the run is live and on screen; show the gate otherwise. */
  private syncGate() {
    const live = this.phase === 'playing' && this.active;
    if (live) {
      this.loop.start();
      this.clock.start();
    } else {
      this.loop.stop();
      this.clock.stop();
    }
    const show = this.phase === 'ready' || this.phase === 'paused';
    this.gate.hidden = !show;
    this.pad?.el.classList.toggle('idle', !live);
    if (this.root) this.root.inert = !live;
    if (show) this.gate.replaceChildren(this.phase === 'ready' ? this.readyGate() : this.pauseGate());
  }

  private readyGate() {
    const best = stats(this.def.id).best[this.level];
    const [two, three] = this.def.stars(this.level);
    const goal = (label: string, value: number | string, cls = '') =>
      h('span', { class: `gate-goal ${cls}`.trim() }, h('small', null, label), h('strong', null, value));
    return h(
      'div',
      { class: 'gate-card ready' },
      h('div', { class: 'gate-art' }, gameArt(this.def)),
      h('p', { class: 'gate-name' }, this.def.name),
      h('p', { class: 'gate-rules' }, this.def.rules),
      h(
        'p',
        { class: 'gate-goals' },
        goal('★★', two, 'stars'),
        goal('★★★', three, 'stars'),
        best != null ? goal(L('Best', 'Record'), best, 'best') : null,
      ),
      h(
        'p',
        { class: 'gate-meta' },
        LEVEL_NAMES[this.level],
        ' · ',
        L(`about ${fmtPar(this.def.par(this.level))}`, `environ ${fmtPar(this.def.par(this.level))}`),
      ),
      h('button', { type: 'button', class: 'btn primary gate-go' }, playGlyph(), L('Play', 'Jouer')),
      h('p', { class: 'gate-hint' }, L('or press Space', 'ou appuyez sur Espace')),
    );
  }

  private pauseGate() {
    return h(
      'div',
      { class: 'gate-card paused' },
      h('div', { class: 'gate-pause', 'aria-hidden': 'true' }, h('i'), h('i')),
      h('p', { class: 'gate-title' }, L('Paused', 'Pause')),
      h('p', { class: 'gate-meta' }, `${L('Score', 'Score')} ${this.score}`),
      h('button', { type: 'button', class: 'btn primary gate-go' }, playGlyph(), L('Resume', 'Reprendre')),
      h('p', { class: 'gate-hint' }, L('Space or Enter to resume', 'Espace ou Entrée pour reprendre')),
    );
  }

  setActive(on: boolean) {
    if (on === this.active) return;
    this.active = on;
    if (!this.mounted) this.mount();
    // Scrolling away (or hiding the tab) mid-run pauses: coming back shows the Resume gate.
    if (!on && this.phase === 'playing') this.phase = 'paused';
    if (on) this.fit();
    this.syncGate();
    if (!on) {
      const f = document.activeElement as HTMLElement | null;
      if (f && this.el.contains(f)) f.blur();
    }
  }

  onKey(e: KeyboardEvent): boolean {
    const down = e.type === 'keydown';
    if (this.phase === 'ready' || this.phase === 'paused') {
      if (down && (e.key === ' ' || e.key === 'Enter')) {
        this.go();
        return true;
      }
      return false;
    }
    if (this.phase !== 'playing') return false;
    if (down && (e.key === 'Escape' || e.key.toLowerCase() === 'p')) {
      this.pause();
      return true;
    }
    return this.inst.onKey?.(e) ?? false;
  }

  /**
   * A key from the on-screen pad. Before the run (or while paused) a press starts it, like Space. A
   * release always reaches a run that isn't over, so a button let go while paused doesn't stay held.
   */
  private padKey(e: KeyboardEvent) {
    if (e.type === 'keydown') {
      if (this.phase === 'ready' || this.phase === 'paused') {
        if (!e.repeat) this.go();
      } else if (this.phase === 'playing') this.inst.onKey?.(e);
    } else if (this.phase !== 'over') this.inst.onKey?.(e);
  }

  private trackAttrs() {
    return {
      'game.id': this.def.id,
      'game.difficulty': this.level,
      'game.difficulty_name': LEVEL_IDS[this.level],
      'game.mode': this.opts.lab ? 'lab' : 'feed',
    };
  }

  /** The feed scrolled away from a started run that isn't over. Reported once per run. */
  left() {
    if (!this.mounted || this.phase === 'ready' || this.done || this.leftGen === this.gen) return;
    this.leftGen = this.gen;
    telemetry.track('game.leave', { ...this.trackAttrs(), 'game.duration_ms': Math.round(this.clock.time()), 'game.score': this.score });
  }

  private finish(o: Outcome) {
    if (this.done) return;
    const prev = this.phase;
    this.pad?.releaseAll();
    this.phase = 'over';
    this.syncGate();
    this.gate.hidden = true;
    const ms = Math.round(this.clock.time());
    const cleared = o === 'cleared';
    const stars = starsFor(this.def, this.level, cleared, this.score);
    // A level skipped before it started isn't a result: just move on.
    const res =
      prev === 'ready' && o === 'skipped'
        ? null
        : record(this.def.id, { d: this.level, o, score: this.score, stars, ms, ...(this.opts.lab ? { lb: true as const } : {}) });
    if (res)
      telemetry.track('game.result', {
        ...this.trackAttrs(),
        'game.outcome': o,
        'game.score': this.score,
        'game.stars': stars,
        'game.duration_ms': ms,
        'game.personal_best': !!res.best,
        'game.level_change': res.levelChange ? res.levelChange.to - res.levelChange.from : 0,
      });
    this.el.classList.add(`is-${o}`);
    if (cleared) sfx('win');
    else if (o === 'lost') {
      sfx('lose');
      haptic([50, 60, 90]);
    }
    this.syncLevelLabel();
    if (o === 'skipped') {
      this.foot.replaceChildren(h('span', { class: 'status result' }, h('strong', null, L('Skipped', 'Passé'))));
      if (!this.opts.lab) this.onNext(this);
      else this.mount({ level: this.level });
      return;
    }

    const st = stats(this.def.id);
    const advance = !this.opts.lab && cleared && getProfile().autoAdvance;
    const advanceMs = res?.best || res?.firstClear || res?.levelChange ? 3600 : 2800;
    const levelUp = res?.levelChange && { up: res.levelChange.to > res.levelChange.from, to: LEVEL_NAMES[res.levelChange.to] };
    const panel = resultCard({
      cleared,
      name: this.def.name,
      level: LEVEL_NAMES[this.level],
      score: this.score,
      stars,
      ms,
      best: st.best[this.level],
      newBest: !!res?.best,
      firstClear: cleared && !!res?.firstClear,
      goals: this.def.stars(this.level),
      clears: st.cleared,
      levelUp,
      advanceMs: advance ? advanceMs : undefined,
    });
    // Tap the panel to peek at the finished board (and stop auto-advance). Only taps that start on the
    // panel count: the tap that ended the run may fire its click after the panel appears.
    let pressed = false;
    panel.addEventListener('pointerdown', () => (pressed = true));
    panel.addEventListener('click', () => {
      if (!pressed) return;
      pressed = false;
      panel.classList.toggle('peek');
      clearTimeout(this.advanceTimer);
    });
    this.stage.append(panel);
    if (cleared && (stars === 3 || res?.best || res?.firstClear)) {
      const r = this.stage.getBoundingClientRect();
      if (r.height) confetti(r.left + r.width / 2, r.top + r.height / 2, res?.best ? 90 : 50);
    }

    this.foot.replaceChildren(
      h(
        'span',
        { class: 'status result' },
        cleared ? h('strong', { class: 'good' }, L('Cleared', 'Réussi')) : h('strong', { class: 'bad' }, L('Game over', 'Partie terminée')),
        h('span', { class: 'status-pts' }, `${this.score} ${L('points', 'points')}`),
      ),
      h(
        'div',
        { class: 'actions' },
        h(
          'button',
          { type: 'button', class: 'btn again', onclick: () => this.mount({ level: this.level, seed: this.seed }) },
          glyph('M4 12a8 8 0 1 0 2.4-5.7', 'M4 4v4.5h4.5'),
          L('Again', 'Rejouer'),
        ),
        h(
          'button',
          { type: 'button', class: 'btn primary next', onclick: () => this.onNext(this) },
          this.opts.lab ? L('New level', 'Nouveau niveau') : L('Next', 'Suivant'),
          this.opts.lab ? glyph('M5 12h14', 'M13 6l6 6-6 6') : glyph('M12 5v14', 'M6 13l6 6 6-6'),
        ),
      ),
    );
    if (advance) {
      const gen = this.gen;
      this.advanceTimer = window.setTimeout(() => gen === this.gen && this.onNext(this), advanceMs);
    }
  }

  destroy() {
    clearTimeout(this.advanceTimer);
    this.loop.stop();
    this.resize.disconnect();
    this.inst.destroy?.();
    this.gen++;
  }
}

/** A typical run length, rounded for the start gate: "45 s", "2 min". */
const fmtPar = (sec: number) => (sec < 90 ? `${Math.round(sec / 5) * 5 || sec} s` : `${Math.round(sec / 60)} min`);

/** Small stroked icon for buttons (24×24 paths, currentColor). */
const glyph = (...paths: string[]) =>
  s('svg', { viewBox: '0 0 24 24', class: 'btn-icon', 'aria-hidden': 'true' }, ...paths.map((d) => s('path', { d })));
const playGlyph = () =>
  s('svg', { viewBox: '0 0 24 24', class: 'btn-icon fill', 'aria-hidden': 'true' }, s('path', { d: 'M8 5.5v13l10.5-6.5z' }));

/** Replay the little "bump" animation on a counter that just changed. */
function bump(el: HTMLElement) {
  el.classList.remove('bump');
  void el.offsetWidth; // restart the CSS animation
  el.classList.add('bump');
}
