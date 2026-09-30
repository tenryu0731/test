// Player settings persisted in localStorage: difficulty (preset id or 'custom' + per-aspect levels),
// graphics quality and sound volume. Look sensitivity is persisted by input.js itself.
// Storage can be blocked (private mode, file://): every access is wrapped in try/catch and the
// game simply runs with defaults.
import { DIFFICULTY, DIFFICULTY_ORDER, DEFAULT_DIFFICULTY, makeCustomDifficulty } from './difficulty.js';

const KEY = 'sg-fps-settings-v2';

// Per-aspect sliders of the custom difficulty. Each level 0..4 matches DIFFICULTY_ORDER
// (0 = story … 4 = expert). `steps` are the labels shown under the slider.
export const CUSTOM_ASPECTS = [
  { key: 'enemyCount', label: '敵の数', steps: ['とても少ない', '少ない', '標準', '多い', 'とても多い'] },
  { key: 'enemyStrength', label: '敵の強さ', steps: ['とても弱い', '弱い', '標準', '強い', 'とても強い'] },
  { key: 'damageTaken', label: '被ダメージ', steps: ['とても小さい', '小さい', '標準', '大きい', 'とても大きい'] },
  { key: 'recovery', label: '回復', steps: ['体力200・高速回復', '体力150・回復', '体力100・ゆっくり回復', '体力100・回復なし', '体力80・回復なし'] },
  { key: 'ammo', label: '弾薬', steps: ['とても多い', '多い', '標準', '少ない', 'とても少ない'] },
];
export const DIFFICULTY_CHOICES = [...DIFFICULTY_ORDER, 'custom'];
export const QUALITY_CHOICES = [['low', '低'], ['medium', '中'], ['high', '高']];

const DEFAULT_CUSTOM = { enemyCount: 2, enemyStrength: 2, damageTaken: 2, recovery: 2, ammo: 2 };

function read() {
  try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); if (v && typeof v === 'object') return v; } catch { /* blocked / corrupt */ }
  return {};
}

export class Settings {
  constructor() {
    const s = read();
    this.difficulty = DIFFICULTY_CHOICES.includes(s.difficulty) ? s.difficulty : DEFAULT_DIFFICULTY;
    this.custom = { ...DEFAULT_CUSTOM };
    if (s.custom && typeof s.custom === 'object') {
      for (const k of Object.keys(DEFAULT_CUSTOM)) {
        const v = Math.round(+s.custom[k]);
        if (v >= 0 && v <= 4) this.custom[k] = v;
      }
    }
    this.quality = ['low', 'medium', 'high'].includes(s.quality) ? s.quality : null;
    this.volume = Number.isFinite(+s.volume) && s.volume !== null && s.volume !== undefined ? Math.max(0, Math.min(1, +s.volume)) : 0.8;
    this.mode = ['campaign', 'trench', 'cqb'].includes(s.mode) ? s.mode : 'campaign';
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ difficulty: this.difficulty, custom: this.custom, quality: this.quality, volume: this.volume, mode: this.mode }));
    } catch { /* storage blocked: keep the in-memory values */ }
  }

  set(key, value) { this[key] = value; this.save(); }

  /** The preset object for an id ('custom' uses the stored levels unless `custom` is given). */
  preset(id = this.difficulty, custom = this.custom) {
    if (id === 'custom') return makeCustomDifficulty(custom);
    return DIFFICULTY[id] || DIFFICULTY[DEFAULT_DIFFICULTY];
  }

  static label(id, custom) {
    if (id === 'custom') return makeCustomDifficulty(custom).label;
    return (DIFFICULTY[id] || DIFFICULTY[DEFAULT_DIFFICULTY]).label;
  }
}
