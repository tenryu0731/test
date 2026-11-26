# american-city-open-world — アメリカの都市オープンワールド（素材調査段階）

GTA のように自由に動き回れる、アメリカの都市をイメージしたゲームを作るための準備です。
いまは **3D 素材（建物・道路・信号・街灯・車・木・小物）の調査と取得テスト** の段階で、ゲーム本体はまだありません。

## 見るもの

- 調査レポート: [`docs/asset-survey.md`](docs/asset-survey.md) — 19 の配布元の比較表、取得テストの結果、おすすめの組み合わせ 3 案
- 縮尺の比較画像: `docs/img/scale-*.png`（赤い柱 = 身長 1.8 m）
- 素材の台帳: [`assets/ledger.json`](assets/ledger.json)
- クレジット: [`CREDITS.md`](CREDITS.md)

## 実行方法（このフォルダをカレントにする）

```bash
npm install                    # glTF の検証ツールと three.js
bash tools/fetch-assets.sh     # 素材を配布元から取り直す（assets/raw/ は git 管理外）
node tools/check.mjs assets/vendor/kaykit-city-builder-bits/gltf/*.gltf   # 検証とサイズ計測
python3 -m http.server 8765 &  # 縮尺比較の画面: http://127.0.0.1:8765/tools/scale.html?v=all|k|y|p
node tools/shot.cjs out.png y  # 上の画面を Playwright で撮影
```

## ファイル構成

```
assets/
  ledger.json              取得した素材の台帳
  vendor/                  取得した素材（GLB/glTF とライセンスファイルのみ）
    kenney-city-kit-roads/
    kenney-city-kit-commercial/
    kaykit-city-builder-bits/
    polyhaven/
docs/
  asset-survey.md          調査レポート
  img/                     縮尺比較の画像
tools/
  fetch-assets.sh          取得スクリプト（curl / git / Poly Haven API、MD5 照合つき）
  check.mjs                Khronos glTF-Validator での検証と、寸法・三角形数の計測
  scale.html, shot.cjs     three.js で並べて表示・撮影
CREDITS.md
package.json
```
