# 町・都市 3D 素材の調査と取得テスト（2026-11-26）

目的: アメリカの都市をイメージした、GTA のように自由に動き回れるゲーム向けの素材（建物・道路・信号・街灯・車・木・小物）を探す。商用利用でき、条件を守れるものを対象にする。

表記のルール
- 「確認済」: 配布元ページの原文、または配布物同梱のライセンスファイルを、このセッションで直接読んだもの。
- 「計測」: このセッションで実際にダウンロードし、ツールで測った値。
- 「要確認」: 配布元の原文を読めなかったもの。
- 「推測です」: 根拠が間接的なもの。

---

## 1. 比較表（無料・商用利用可の候補）

### 1-1. まとめ表

| # | 名前 / URL | 内容 | 点数・ポリゴン | スタイル | 形式 | ライセンス / 商用 | クレジット | 改変・再配布 | 自動取得 | 道路と建物の規格 |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Kenney City Kit (Roads) <https://kenney.nl/assets/city-kit-roads> | 道路タイル（直線・交差点・ラウンドアバウト・橋・坂）、信号、街灯、標識、工事用品、電柱 | ページ表記 90 ファイル。GLB 95 個、三角形 12〜1,636（中央値 112）【計測】 | ローポリ、単色パレット | GLB / FBX / OBJ【計測: zip の中身】 | CC0【確認済: ページと同梱 License.txt】/ 商用可 | 不要（「Support by crediting 'Kenney' ... (this is not a requirement)」） | 制限なし（CC0） | **可**: curl で 2 段階（ページ → `/download-link/<id>` を Referer 付き → 署名付き zip）【計測】 | 1 マス = 1 単位。Commercial の建物は 1 マスに収まる【計測】 |
| 2 | Kenney City Kit (Commercial) <https://kenney.nl/assets/city-kit-commercial> | 商業ビル 14 種、高層ビル 5 種、遠景用の簡易ビル 16 種、日よけ・パラソル | ページ表記 50 ファイル。GLB 41 個、三角形 40〜5,246【計測】 | 同上 | GLB / FBX / OBJ【計測】 | CC0【確認済】 | 不要 | 制限なし | 可（同上）【計測】 | Roads と同じ 1 単位グリッド【計測】 |
| 3 | Kenney City Kit (Suburban) <https://kenney.nl/assets/city-kit-suburban> | 郊外の住宅 | ページ表記 40 ファイル | ローポリ | 要確認（推測です: 1・2 と同じ GLB/FBX/OBJ） | CC0【確認済: ページ】 | 不要 | 制限なし | 可（推測です: 1 と同じ方式） | 推測です: 同じ City Kit シリーズなので合う |
| 4 | Kenney City Kit (Industrial) <https://kenney.nl/assets/city-kit-industrial> | 工場・倉庫、太陽光・風力 | ページ表記 40 ファイル | ローポリ | 要確認 | CC0【確認済: ページ】 | 不要 | 制限なし | 可（推測です） | 推測です: 合う |
| 5 | Kenney Car Kit <https://kenney.nl/assets/car-kit> | 車両、残骸、カート | ページ表記 45 ファイル | ローポリ | 要確認 | CC0【確認済: ページ】 | 不要 | 制限なし | 可（推測です） | 要確認（City Kit との縮尺は未計測） |
| 6 | Kenney Modular Buildings <https://kenney.nl/assets/modular-buildings> | モジュール式の建物パーツ | ページ表記 100 ファイル | ローポリ | 要確認 | CC0【確認済: ページ】 | 不要 | 制限なし | 可（推測です） | 要確認 |
| 7 | Kenney Retro Urban Kit <https://kenney.nl/assets/retro-urban-kit> | レトロ調の都市パーツ | ページ表記 120 ファイル | レトロ（低解像度テクスチャ調） | 要確認 | CC0【確認済: ページ】 | 不要 | 制限なし | 可（推測です） | 要確認 |
| 8 | KayKit City Builder Bits <https://github.com/KayKit-Game-Assets/KayKit-City-Builder-Bits-1.0> （itch: <https://kaylousberg.itch.io/city-builder-bits>） | 道路 6 種、建物 A〜H（土台あり/なし）、車 5 台（ハッチバック・パトカー・セダン・ワゴン・タクシー）、信号 3 種、街灯、消火栓、ゴミ箱、ベンチ、茂み、給水塔 | README「32+」。glTF 41 個、三角形 18〜1,885（中央値 586）【計測】 | スタイライズ・ローポリ（1024px グラデーションアトラス 1 枚） | OBJ / FBX / glTF【計測】 | CC0【確認済: LICENSE.txt】/ 商用可 | 不要（「this is not mandatory」） | CC0。ただし itch ページで「無改変のまま再販しない・自作と偽らない」よう依頼あり | **可**: GitHub から `git clone`【計測】 | 道路も建物も 2×2 単位で一致。車・信号も同じ縮尺【計測・画像】 |
| 9 | Quaternius Downtown City MegaKit <https://quaternius.com/packs/downtowncitymegakit.html> （itch: <https://quaternius.itch.io/downtown-city-megakit>） | ボストン/NYC 風の街区を組む 300 超のモジュール（建物ファサード、道路、歩道、交差点、小物、内装） | サイト表記 315 モデル。ポリゴン数は要確認 | スタイライズ寄りのテクスチャ付きローポリ（推測です: 画像からの判断） | サイト: FBX / Blend / glTF、itch: FBX / OBJ / glTF | **要確認（表記が矛盾）**: パックページと itch は CC0。一方 <https://quaternius.com/license.html> は独自の「Quaternius Asset License (QAL) v1.0、Last updated 8/28/2026」 | 不要（CC0 でも QAL でも） | QAL なら「素材そのものの再配布・再販は禁止（改変しても不可）」。完成した製品に組み込むのは可 | itch 経由（無料は Standard 223 MB。「name your own price」）。curl での取得は未テスト | 推測です: 同じキット内で統一 |
| 10 | Quaternius Cars / Public Transport / Modular Streets / Buildings | 車 8、公共交通 12、道路 25、建物 9 | サイト表記の値 | ローポリ | FBX / OBJ / Blend（glTF の記載なし） | ページ表記は CC0（QAL との関係は 9 と同じく要確認） | 不要 | 9 と同じ | itch / サイト経由（未テスト） | 要確認 |
| 11 | Poly Haven <https://polyhaven.com/models>（API: <https://api.polyhaven.com>） | 建物丸ごとはない。ファサードのパーツ（Modular Urban Apartments Facade、Factory Facade）、非常階段、消火栓、街灯 2 種、電柱、配電箱、コンクリート障壁、マンホール、シート付きの車など（コレクション hidden_alley が 39 点） | 例: ファサード 118,215 ポリ / 街灯 30,610 ポリ（API の値）。1k テクスチャで 16.5 MB / 2.2 MB | リアル（PBR、実測スケール） | glTF / FBX / Blend / USD（API の値） | CC0【確認済: <https://polyhaven.com/license>】 | 不要（「You do not need to give credit」） | 制限なし | **可**: 公開 API。ファイルごとに MD5 あり【計測】 | 単位はメートル。道路はない |
| 12 | Sketchfab <https://sketchfab.com>（Data API） | 個人作品の集まり。ライセンスはモデルごとに違う | モデルごと（例は 1-3） | さまざま | glb / gltf / source / usdz（API の archives の値） | CC0 / CC-BY / CC-BY-SA / CC-BY-ND / CC-BY-NC… を API で絞り込める【確認済: `/v3/licenses`】 | CC-BY 系は必要 | BY-SA は継承、BY-ND は改変版の配布不可、NC は商用不可 | 検索は認証なしで可。**ダウンロードは認証が必要**（`/download` は 401）【計測】 | モデルごとにバラバラ |
| 13 | OpenGameArt <https://opengameart.org> | 個人作品。都市系の例は 1-4 | 要確認 | さまざま | ページごと（.blend、zip、FBX など） | ページごとに CC0 / CC-BY など【確認済: 各ページ】 | CC-BY は必要 | ページごと | 可: `sites/default/files/...` の直リンク（取得は未テスト） | 揃わない |
| 14 | itch.io 無料アセット <https://itch.io/game-assets/free/tag-3d/tag-city> | 個人・小規模作者のパック | — | さまざま | — | ページごと | ページごと | ページごと | タグ一覧は **Cloudflare のチャレンジで取得できず**。個別ページは取得可。ダウンロードは itch の手順が必要（未テスト） | — |
| 15 | Fab <https://www.fab.com> | Epic のマーケット | — | 主にリアル | 素材ごと | Fab Standard License【確認済: <https://www.fab.com/eula> の要約部分】: 商用可、「usage is not limited to Unreal Engine」、単体での再配布・転売は不可。CC-BY 素材は CC の条件に従う | Standard は不要（「You are not required to give credit」） | 単体での再配布不可 | 個別素材の検索・取得は未調査（サイトが JS 主体）。エンジン限定の素材があるかは素材ごとに要確認 | — |
| 16 | CGTrader <https://www.cgtrader.com> | マーケット（無料モデルあり） | — | さまざま | 素材ごと | Royalty Free License【確認済: 利用規約 21A】。「Royalty Free License, No AI」（AI 学習禁止）、「editorial」表示の素材は報道用途のみ | 規約上の必須記載は見当たらず（要確認） | 「video games ... you must take all commercially reasonable measures to prevent the end user from gaining access to the Product」（ゲームから素材を取り出せないようにする義務）。単体の転売・再配布禁止 | 未テスト（推測です: ログインが必要） | — |
| 17 | Free3D <https://free3d.com> | — | — | — | — | **要確認**（サイトのボット対策 DataDome で 403） | 要確認 | 要確認 | 不可（403） | — |
| 18 | TurboSquid <https://www.turbosquid.com> | — | — | — | — | **要確認**（DataDome で 403） | 要確認 | 要確認 | 不可（403） | — |
| 19 | Poly Pizza <https://poly.pizza> | — | — | ローポリ | — | **要確認**（Cloudflare のチャレンジで 403） | 要確認 | 要確認 | API `https://api.poly.pizza/v1.1/search/...` は 401。推測です: API キーが必要 | — |

### 1-2. 候補から外したもの・注意が必要なもの

Sketchfab の検索結果から、次は外します。
- 実在の建物・地名をそのまま再現したもの: 「[FREE] Atlanta, Corperate Office Building」（99.Miles）、「Realistic chicago buildings」（99.Miles）、「New York blvd.」（matousekfoto、フォトスキャンの可能性。推測です）、「Eagle Sculpture」（Sioux Falls の銀行の彫刻。タグからの判断）
- 他社ゲームからの再現: 「Silent Hill 3 cathedral」（Katydid.）。商標・著作権の問題があるので外します。
- 日本の交通設備: 「Japanese Traffic Assets」。米国の街には合いません。

Quaternius Downtown City MegaKit はタグに「nyc」「boston」があり、説明文は「Boston/NYC style city blocks」です。特定の実在建物の再現かどうかは確認できていません（要確認）。

AI 生成について: 取得した 3 系統（Kenney、KayKit、Poly Haven）は、作者名の付いた手作りの配布物です。Sketchfab・CGTrader の個別モデルは、AI 生成かどうかを採用時に 1 点ずつ確認する必要があります（CGTrader のトップには「Create with AI」の機能があります）。

### 1-3. Sketchfab で見つかった CC-BY 候補（採用時は 1 点ずつ要確認）

API: `https://api.sketchfab.com/v3/search?type=models&q=<語>&downloadable=true&license=by`

| モデル | 作者 | 面数 | URL |
|---|---|---|---|
| Low-poly City Buildings | smooth998 | 7,166 | <https://sketchfab.com/3d-models/e0209ac5bb684d2d85e5ade96c92d2ff> |
| CCity Building Set 1 | neberkenezer | 18,372 | <https://sketchfab.com/3d-models/a2d5c7bfcc2148fb8994864c43dfcc97> |
| Low Poly Night City Building Skyline | 99.Miles | 6,078 | <https://sketchfab.com/3d-models/b0035b8713b048bb8ddf311ee67c28c8> |
| American Road / American Road Intersection | jimbogies | 51,360 / 81,184 | <https://sketchfab.com/3d-models/179a1e6a0a154031a60f300fc73d9dd8> / <https://sketchfab.com/3d-models/4db8a073e970450aa4f0cfd3ee00d84c> |
| Road pack (not including the road) | drcrazzie | 130,188 | <https://sketchfab.com/3d-models/021707f910d04907ab576c856a749628> |
| Traffic Cones | notanotherapocalypticco | 18,966 | <https://sketchfab.com/3d-models/e03b1d2dfdc0416bb8324d15573ea60c> |

`license=cc0` で同じ語を検索すると、都市系はほぼ出ませんでした（「city buildings」で 1 件、関係のない彫刻のみ）。

### 1-4. OpenGameArt の都市系（ページの License 欄を確認済）

| 名前 | 作者 | ライセンス | 直リンク |
|---|---|---|---|
| 3D City <https://opengameart.org/content/3d-city> | zonked | CC0 | `city.blend` |
| LowPoly Modular Street Pack <https://opengameart.org/content/lowpoly-modular-street-pack> | quaternius | CC0 | `Street Pack by @Quaternius.zip` |
| Suburb Asset pt1 <https://opengameart.org/content/suburb-asset-pt1> | eracoon | CC0 | `suburb_assets_pt1.zip` |
| Vehicles Assets pt1 <https://opengameart.org/content/vehicles-assets-pt1> | eracoon | CC0 | `vehicle_asset_v1.zip` |
| Voxel Town Pack Lite <https://opengameart.org/content/voxel-town-pack-lite> | Glitch Squirrel | CC-BY 4.0 / CC-BY 3.0 | `VTPL_FBX+Textures.zip` |
| 3D Road Tile pack / Modular (3D) buildings | Kenney | CC0 | 旧版の転載（最新版は kenney.nl） |

### 1-5. 有料だが安いもの（参考・別枠）

| 名前 | 価格 | 中身 | ライセンス | 出典 |
|---|---|---|---|---|
| KayKit City Builder Bits — EXTRA / SOURCE | $3.95 以上 / $5.95 以上 | 追加アセット / .blend ソース | CC0 | <https://kaylousberg.itch.io/city-builder-bits> |
| Quaternius Downtown City MegaKit — Source | $14.99 以上（918 MB） | Unity・Godot・Unreal のプロジェクト、窓の中を偽装する室内シェーダー、頂点カラーの汚れ、コリジョン | 1 の矛盾と同じく要確認 | <https://quaternius.itch.io/downtown-city-megakit> |

---

## 2. 取得テスト（実際にやったこと）

選んだ 3 系統（スタイルがそれぞれ違う）:
1. **Kenney** — 単色のローポリ。City Kit (Roads) と City Kit (Commercial)。Kenney は道路と建物が別パックなので、縮尺を比べるために 2 パック取得した。
2. **KayKit City Builder Bits** — グラデーションアトラスのスタイライズ。1 パックに道路と建物が入っている。
3. **Poly Haven** — リアルな PBR。パック単位の配布がないため、建物（Modular Urban Apartments Facade）と街灯（Street Lamp 01）の 2 点を 1k 解像度で取得した。

| 確認項目 | Kenney | KayKit | Poly Haven |
|---|---|---|---|
| curl で取れるか | 取れる。ただしページの Cookie と `Referer` が必要。Referer がないと `/download-link/` は `{"error":"forbidden"}` を返す | `git clone` で取れる | 取れる（API → `dl.polyhaven.org`） |
| 壊れていないか | `unzip -t` でエラーなし。配布元が MD5 を出していないため照合はできない。取得時の sha256 を台帳に記録した | git のオブジェクト検証（clone 成功）。commit を記録した | **API の MD5 と 19 ファイルすべて一致** |
| glTF/GLB として読めるか | Khronos glTF-Validator: 136 ファイルでエラー 0・警告 0 | 41 ファイルでエラー 0・警告 0 | エラー 0。警告は `MESH_PRIMITIVE_GENERATED_TANGENT_SPACE` のみ（法線マップ用のタンジェントが入っておらず、読み込み時に自動生成される種類） |
| three.js r170 の GLTFLoader で表示 | 可（画像あり） | 可 | 可 |
| 道路と建物の縮尺 | 道路 1×1 単位、building-a は 0.88×1.29×0.94、高層ビル 1.36×2.88、信号 0.52 高。1 単位 ≈ 10 m とすると、建物 13 m・信号 5 m で破綻しない（推測です: 10 m は道路幅からの仮定） | 道路 2×2、building_A は 2×1.65×2、セダンの長さ 0.94、街灯 0.96、信号 0.73。セダンを 4.7 m とすると 1 単位 ≈ 5 m、道路 10 m・街灯 4.8 m で揃う（推測です: 車の長さからの仮定） | 実寸（メートル）。街灯 3.87 m、ファサードのパーツは高さ 17 m。パーツが並べて置かれた「部品シート」で、そのままでは建物にならない |
| シリーズ間の縮尺 | Kenney ×10、KayKit ×5 でメートルに揃う（推測です）。ただし色味と造形が違うので、混ぜると統一感が落ちる（推測です） | | |

画像（赤い柱 = 身長 1.8 m の目安）:
- `docs/img/scale-kenney.png`、`docs/img/scale-kaykit.png`、`docs/img/scale-polyhaven.png`、`docs/img/scale-overview.png`

商標: 3 系統のテクスチャ（Kenney の `variation-a.png`、KayKit の `citybits_texture.png`、Poly Haven ファサードの diff）を目で確認し、文字やロゴはなかった。Kenney Roads の標識の名前は `road-sign-stop` / `sign-highway` などで、一般的な交通標識。すべてのモデルを 1 点ずつ確認したわけではない。

---

## 3. 確認できなかったこと

- Free3D・TurboSquid（DataDome）、Poly Pizza（Cloudflare）は、サイトのボット対策で 403 になり、ライセンス原文を読めなかった。WebFetch も DNS で失敗した。
- itch.io のタグ一覧は Cloudflare のチャレンジで読めなかった（個別のページは読めた）。
- Fab の個別の無料都市パックは調べていない。EULA は要約部分しか抽出できず、エンジン限定の条項が全文にあるかは確認していない。
- Quaternius のライセンス表記の矛盾（CC0 か QAL か）は解決していない。作者への確認が必要。
- Kenney の Suburban / Industrial / Car Kit / Modular Buildings / Retro Urban Kit は、ページは読んだが中身（形式・縮尺）は取得していない。
- Sketchfab のダウンロードは API トークンが必要なため、試していない。

---

## 4. 提案（どれにするかはユーザーが決める）

### 案 A: ローポリの見下ろし〜三人称シティ（最短で遊べる形にする）
- 組み合わせ: Kenney City Kit 一式（Roads + Commercial + Suburban + Industrial）+ Kenney Car Kit。すべて CC0 で、curl で自動取得できる。
- 長所: 規格が 1 単位グリッドで揃う。クレジット不要。軽いのでスマホでも動く（推測です）。
- 不足: 人物・歩行者、店の看板（文字入り）、店の内装、米国らしい細部（消火栓、郵便ポスト、非常階段）。
- 探し方: 人物は Quaternius「Universal Base Characters」（サイト一覧に掲載。ライセンスは 9 と同じく要確認）。看板は自作する（架空の店名のテクスチャを作り、実在企業の名前は使わない）。内装は KayKit Furniture Bits（GitHub に CC0 のリポジトリあり: `KayKit-Game-Assets/KayKit-Furniture-Bits-1.0`）。

### 案 B: スタイライズの米国ダウンタウン（GTA らしい街並みに一番近い）
- 組み合わせ: Quaternius Downtown City MegaKit（Standard 無料、必要なら Source $14.99）+ KayKit City Builder Bits（車・信号・小物、×2.5 前後で縮尺を合わせる。推測です）+ Poly Haven の小物を少し。
- 長所: 300 を超えるモジュールで NYC/Boston 風の街区を組める。
- 注意: **Quaternius のライセンス表記が矛盾している**。採用前に作者に確認し、取得日と、その時点のライセンス表記を台帳に残す（QAL の 7 条は「取得した時点の版が適用される」と書いている）。
- 不足: 車の種類（米国型のピックアップ、SUV、スクールバス）、歩行者、看板、信号の米国仕様（横に吊るす型）。
- 探し方: 車は Quaternius Cars / Public Transport、Kenney Car Kit。米国の標識は MUTCD の図案を参考に自作する（推測です: 米国連邦政府の著作物なのでパブリックドメインの可能性が高いが、要確認）。

### 案 C: リアル寄り（AAA の見た目を目指す）
- 組み合わせ: Poly Haven（ファサードのパーツ、街灯、消火栓、電柱、配電箱、障壁、マンホール、テクスチャ）+ Fab の無料・安価な素材 + Sketchfab の CC-BY を厳選。
- 長所: PBR で実寸。見た目の質が最も高い。
- 短所: 建物を丸ごと・道路・車の素材が揃わず、組み立てと最適化（LOD、テクスチャの統合）の作業量が最も多い。Sketchfab を使うと CC-BY のクレジット管理が増える。
- 不足: 建物一式、道路のモジュール、米国の車、人物、植栽。
- 探し方: Fab で「city」「modular building」の無料素材を、ライセンス欄（Standard / CC-BY）で 1 点ずつ確認。Poly Haven のテクスチャ（アスファルト、レンガ、コンクリート）で自作のファサードを作る。

推測です: 無料素材だけで AAA と同等の都市を作るのは現実的ではありません。案 A か B で遊べる形を先に作り、見た目は後から差し替えるのが安全です。
