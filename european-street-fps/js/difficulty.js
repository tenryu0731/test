// Difficulty presets shared by the game loop (player side) and the enemies (robot side).
// Multipliers are relative to "normal". The settings UI can also build a custom preset with
// makeCustomDifficulty() from individual sliders.
export const DIFFICULTY = {
  story: {
    id: 'story', label: 'ストーリー', desc: '景色と探索を楽しむ。敵は少なく、体力はすぐ回復する。',
    playerHP: 200, regenDelay: 3, regenRate: 14, ammoScale: 2,
    enemyCount: 0.5, enemyHP: 0.6, enemyDamage: 0.4, enemyAccuracy: 0.55, enemyReaction: 1.9, enemyViewDist: 0.7,
  },
  easy: {
    id: 'easy', label: 'やさしい', desc: '敵が少なく弱い。体力が自然回復する。',
    playerHP: 150, regenDelay: 4, regenRate: 8, ammoScale: 1.5,
    enemyCount: 0.7, enemyHP: 0.8, enemyDamage: 0.6, enemyAccuracy: 0.7, enemyReaction: 1.5, enemyViewDist: 0.8,
  },
  normal: {
    id: 'normal', label: 'ふつう', desc: '標準の難しさ。体力は少しずつ回復する。',
    playerHP: 100, regenDelay: 6, regenRate: 4, ammoScale: 1,
    enemyCount: 1, enemyHP: 1, enemyDamage: 1, enemyAccuracy: 1, enemyReaction: 1, enemyViewDist: 1,
  },
  hard: {
    id: 'hard', label: 'むずかしい', desc: '敵が多く正確。体力は回復しない。',
    playerHP: 100, regenDelay: Infinity, regenRate: 0, ammoScale: 0.8,
    enemyCount: 1.35, enemyHP: 1.25, enemyDamage: 1.35, enemyAccuracy: 1.2, enemyReaction: 0.7, enemyViewDist: 1.2,
  },
  expert: {
    id: 'expert', label: 'エキスパート', desc: '一瞬の油断が命取り。敵は多く硬く、弾薬も少ない。',
    playerHP: 80, regenDelay: Infinity, regenRate: 0, ammoScale: 0.6,
    enemyCount: 1.7, enemyHP: 1.5, enemyDamage: 1.7, enemyAccuracy: 1.4, enemyReaction: 0.5, enemyViewDist: 1.4,
  },
};
export const DIFFICULTY_ORDER = ['story', 'easy', 'normal', 'hard', 'expert'];
export const DEFAULT_DIFFICULTY = 'normal';

// Custom preset from UI sliders. Each argument is a level 0..4 matching DIFFICULTY_ORDER
// (0 = story … 4 = expert) for one aspect of the game.
export function makeCustomDifficulty({ enemyCount = 2, enemyStrength = 2, damageTaken = 2, recovery = 2, ammo = 2 } = {}) {
  const at = (i) => DIFFICULTY[DIFFICULTY_ORDER[Math.max(0, Math.min(4, Math.round(i)))]];
  const c = at(enemyCount), s = at(enemyStrength), d = at(damageTaken), r = at(recovery), a = at(ammo);
  return {
    id: 'custom', label: 'カスタム', desc: '項目ごとに調整した難易度。',
    playerHP: r.playerHP, regenDelay: r.regenDelay, regenRate: r.regenRate, ammoScale: a.ammoScale,
    enemyCount: c.enemyCount, enemyHP: s.enemyHP, enemyDamage: d.enemyDamage,
    enemyAccuracy: s.enemyAccuracy, enemyReaction: s.enemyReaction, enemyViewDist: s.enemyViewDist,
    levels: { enemyCount, enemyStrength, damageTaken, recovery, ammo },
  };
}
