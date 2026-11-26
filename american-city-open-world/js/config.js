// 街の寸法（単位: メートル）と共通の小道具
export const PX = 90;          // 東西方向の交差点の間隔（南北に走る道路どうしの距離）
export const PZ = 70;          // 南北方向の交差点の間隔
export const NBX = 6;          // ブロック数（東西）
export const NBZ = 8;          // ブロック数（南北）
export const RH = 7;           // 道路の半幅（片側 2 車線 × 3.5 m）
export const SW = 4.5;         // 歩道の幅
export const CURB_H = 0.15;    // 歩道の段差
export const LANE = [1.75, 5.25]; // 車線の中心（道路中心から右側へのオフセット）
export const CITY_W = NBX * PX;
export const CITY_D = NBZ * PZ;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));

// クエリ文字列
export const params = new URLSearchParams(location.search);
export const isTouch = params.has('touch') || (('ontouchstart' in window || navigator.maxTouchPoints > 0) && matchMedia('(pointer: coarse)').matches);
