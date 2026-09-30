// World layout shared by every module: where the town, roads, river, lake and countryside
// landmarks are. Units are metres, Y up, the town's piazza is near the origin.
// The map is a semi-open world of 1.4 km × 1.4 km around the walled hill town.

export const MAP_HALF = 700;          // playable area x,z ∈ [-MAP_HALF, MAP_HALF]
export const PLAY_HALF = 680;         // player/enemy clamp (invisible limit a little inside the edge)

// The walled town sits on a flat hilltop plateau at y = 0. Everything inside TOWN.rect (walls included)
// is built by city.js on its own flat ground; the terrain stays just below it (y = -0.25) there and
// blends down the hill outside PLATEAU_MARGIN.
export const TOWN = {
  rect: [-120, 120, -150, 150],       // x0, x1, z0, z1 of the outer face of the town walls
  y: 0,
  plateauMargin: 18,                  // flat ground ring outside the walls before the slope starts
  // Gate openings in the walls (centre of the opening on the outer wall face; width ≥ 5 m).
  gates: [
    { id: 'north', x: 0, z: -150, dir: 'N' },
    { id: 'south', x: 0, z: 150, dir: 'S' },
    { id: 'east', x: 120, z: 0, dir: 'E' },
    { id: 'west', x: -120, z: 0, dir: 'W' },
  ],
};

// Countryside landmarks. y = ground elevation of the flat building pad; r = pad radius.
// terrain.js must make the ground flat at exactly `y` within `r` and blend smoothly outside.
// landmarks.js builds each site on its pad. Names are shown on the map.
export const SITES = [
  { id: 'pieve', type: 'pieve', name: 'サンタ・マリア教区教会', x: -420, z: 300, y: 4, r: 48 },
  { id: 'rocca', type: 'rocca', name: 'モンテ・ロッソ城塞', x: 440, z: -420, y: 46, r: 62 },
  { id: 'abbey', type: 'abbey', name: 'サン・ヴィヴァルド修道院', x: -420, z: -430, y: 12, r: 62 },
  { id: 'villa', type: 'villa', name: 'ヴィラ・ベルヴェデーレ', x: 420, z: 330, y: -8, r: 70 },
  { id: 'mill', type: 'mill', name: '水車小屋と石橋', x: 70, z: 520, y: -34, r: 38 },
  { id: 'farm-w', type: 'farm', name: 'ポデーレ・ラ・クエルチャ', x: -250, z: 540, y: -18, r: 42 },
  { id: 'farm-e', type: 'farm', name: 'ポデーレ・イル・ポッジョ', x: 320, z: 60, y: -22, r: 42 },
  { id: 'farm-n', type: 'farm', name: 'ポデーレ・カンポ・ヴェッキオ', x: -150, z: -560, y: 2, r: 42 },
  { id: 'chapel', type: 'chapel', name: '丘の礼拝堂', x: 580, z: 60, y: 32, r: 26 },
  { id: 'watchtower', type: 'watchtower', name: '見張りの塔', x: -580, z: -40, y: 36, r: 26 },
  { id: 'quarry', type: 'quarry', name: 'トラバーチン採石場', x: 190, z: -580, y: -12, r: 48 },
  // Arenas of the other game modes (mode: only populated in that mode). Trench line on the east
  // hill (own trench to the south, the training enemy's to the north); walled training compound west.
  { id: 'trenches', type: 'trenches', name: '塹壕演習場', x: 540, z: -200, y: 23, r: 75, mode: 'trench' },
  { id: 'compound', type: 'compound', name: '屋内戦闘訓練施設', x: -560, z: 200, y: 4, r: 40, mode: 'cqb' },
];

// Game modes (main.js). `site`: the arena SITES id; `spawn`: player start in the arena's local frame.
export const MODES = {
  campaign: { id: 'campaign', label: '制圧作戦', desc: '街と田園の全ロボット部隊と敵車両を撃破する。戦車とヘリも使える。' },
  trench: { id: 'trench', label: '塹壕戦', desc: '掘られた塹壕に陣取り、押し寄せる訓練ロボットの波を 4 回しのぐ。2 波目からは敵戦車（1・2・3 両）が敵の塹壕の後ろから砲撃してくる。', site: 'trenches', spawn: [0, 44], yaw: 0 },
  cqb: { id: 'cqb', label: '室内制圧戦', desc: '訓練施設に突入し、部屋ごとに潜む訓練ロボットを制限時間内に全滅させる。', site: 'compound', spawn: [0, 25], yaw: 0, timeLimit: 300 },
};
export const MODE_ORDER = ['campaign', 'trench', 'cqb'];

// Lake (water surface y) and river (polyline of bed centre points; water flows along the list).
export const LAKE = { x: -330, z: 110, r: 50, y: -32 };
export const RIVER = {
  width: 12,
  points: [[700, 250, -26], [480, 430, -30], [260, 500, -33], [70, 520, -36], [-140, 600, -39], [-420, 650, -42], [-700, 670, -45]],
};

// "Strade bianche" (white gravel roads). Polylines in x,z; terrain.js grades the ground along them
// and paints the road surface. Width in metres.
export const ROADS = [
  { id: 'south', width: 5, points: [[0, 152], [8, 250], [30, 350], [60, 450], [70, 520], [52, 600], [20, 700]] },
  { id: 'west', width: 5, points: [[-122, 0], [-230, 8], [-300, -8], [-400, -30], [-500, -40], [-580, -40]] },
  { id: 'west-abbey', width: 4, points: [[-300, -8], [-330, -150], [-370, -300], [-420, -430]] },
  { id: 'west-pieve', width: 4, points: [[-230, 8], [-260, 150], [-330, 240], [-420, 300]] },
  { id: 'pieve-farm', width: 3.5, points: [[-420, 300], [-360, 420], [-250, 540]] },
  { id: 'east', width: 5, points: [[122, 0], [230, 20], [320, 60], [440, 50], [580, 60]] },
  { id: 'east-villa', width: 4, points: [[320, 60], [360, 200], [420, 330]] },
  { id: 'east-rocca', width: 4, points: [[230, 20], [300, -150], [380, -300], [440, -420]] },
  { id: 'north', width: 5, points: [[0, -152], [-20, -260], [-90, -420], [-150, -560]] },
  { id: 'north-quarry', width: 4, points: [[-20, -260], [80, -420], [190, -580]] },
];

// Helipad on the flat ring outside the south wall, west of the gate road (the helicopter starts there).
export const HELIPAD = { x: -32, z: 161, r: 8, yaw: Math.PI * 0.8 };

// Motor pool on the flat ring outside the east wall, south of the east road (the player's tank).
export const TANK_DEPOT = { x: 133, z: -26, r: 9, yaw: -Math.PI / 2 };

// Where the player starts: inside the south gate, looking north up the main street.
export const PLAYER_START = { x: 0, z: 128, yaw: 0 };
