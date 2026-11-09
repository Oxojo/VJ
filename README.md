# VJ System

4つ打ちを中心とした DJ セット向けの、Windows 用 VJ アプリです。APC Mini MK2 で動画・画像・内蔵図形を演奏し、専用 Output ウィンドウを会場画面と OBS のウィンドウキャプチャへ渡します。

現在は v0.1 の技術試作です。映像 Runtime、操作 UI、保存形式、MIDI・音声入力経路を実装済みです。本番投入前に、使用する Windows PC、APC Mini MK2、オーディオインターフェース、OBS の組み合わせで [実機検証](docs/manual-test.md) を完了してください。

## 実装済み

- Electron の操作ウィンドウと、固定タイトル `VJ System — Output` の出力ウィンドウ
- 1920×1080/60、1280×720/60、1280×720/30 の品質プロファイル
- WebGL 2 による L1/L2 メディア＋L3 図形の合成
- normal / add / screen、色、歪み、音声反応、残像、マスター明るさ
- 暗転、Freeze、B キーの緊急暗転
- 60〜300 BPM、Tap、Downbeat、Nudge、beat/bar/four-bars 量子化
- 素材の準備完了後に発火するスケジューラーと、古い読み込み完了の無効化
- APC Mini MK2 の 8×8 パッド、9フェーダー、pickup、補助ボタン、LED フィードバック
- Web Audio API による RMS / Low / Mid / High 解析。解析音は出力へ接続しない
- JSON プロジェクト、バックアップ付き保存、欠損・不正データの検証
- asset ID で登録したファイルだけを配信する `vjmedia://` プロトコルと Range 応答
- Scene の保存・全素材準備後の一括呼び出し
- 固定 Output ウィンドウを使う OBS 連携

## 開発を始める

Node.js 22.12 以降を使います。依存バージョンは `package-lock.json` に固定されています。

```bash
npm ci
npx install-electron
npm run dev
```

Electron 45 は実行バイナリの取得を別コマンドに分離しています。プロキシ環境では `ELECTRON_GET_USE_PROXY=1 npx install-electron` を使います。

確認コマンド:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Windows インストーラーは Windows または対応するクロスビルド環境で作成します。

```bash
npm run package:win
```

Wine のない Linux 環境では、展開済みアプリまたは ZIP を作成できます。

```bash
npm run package:win:dir
npm run package:win:zip
```

生成物は `release/` に出力されます。正式配布では専用アイコンとコード署名証明書を設定してください。

## 基本操作

1. `IMPORT MEDIA` から MP4/H.264、PNG、JPEG を登録します。
2. 8×8 グリッドの L1/L2 パッドでメディア、L3 パッドで内蔵図形を発火します。
3. BPM と量子化を選び、曲の小節頭で `DOWNBEAT` を押します。
4. 出力は起動時に暗転しています。素材を準備してから `BLACKOUT ON` を押して解除します。
5. 9本のフェーダーで3レイヤー、5マクロ、マスター明るさを操作します。
6. `CAPTURE SCENE` で現在のレイヤーとマクロをシーンへ保存します。
7. Output ウィンドウを外部画面へ移動し、`FULLSCREEN OUTPUT` を押します。
8. OBS で `VJ System — Output` をウィンドウキャプチャします。
9. 終演時に暗転し、プロジェクトを保存します。

プロジェクトを開くと、安全のため必ず暗転状態へ戻ります。Scene は BPM、暗転、Freeze、機器選択、マスター明るさを変更しません。

## APC Mini MK2

通常の Clip Launch / Session 系モードを使い、SysEx は要求しません。APC 名に一致する入出力が各1つだけなら自動選択します。複数ある場合は操作画面で選択してください。

- 列 1〜2: L1
- 列 3〜4: L2
- 列 5〜6: L3
- 列 7〜8: Scene
- フェーダー 1〜3: L1〜L3 opacity
- フェーダー 4〜8: Color / Motion / Distort / Reactive / Echo
- フェーダー 9: masterBrightness
- Scene 1〜8: Tap / Downbeat / Nudge− / Nudge＋ / Quantize / 予約 / Freeze / Blackout

詳しい構成は [architecture.md](docs/architecture.md)、本番前の確認は [manual-test.md](docs/manual-test.md)、検証記録は [performance-results.md](docs/performance-results.md) を参照してください。
