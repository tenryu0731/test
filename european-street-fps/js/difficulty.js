// Difficulty presets shared by the game loop (player side) and the enemies (robot side).
// Multipliers are relative to "normal".
export const DIFFICULTY = {
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
};
export const DEFAULT_DIFFICULTY = 'normal';
