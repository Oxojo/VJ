# Performance and validation results

## Cloud development environment — 2026-11-09

対象: Linux cloud executor、Node.js 24.22.1、Electron 45.2.3。実機 GPU、APC Mini MK2、オーディオインターフェース、OBS は未接続。

| Check | Result | Evidence |
|---|---|---|
| TypeScript | Pass | `npm run typecheck` |
| ESLint | Pass | `npm run lint` |
| Unit tests | Pass | 4 files / 17 tests |
| Production build | Pass | Main、sandboxed CJS preload、Renderer を生成 |
| Windows x64 unpacked build | Pass | `release/win-unpacked` を生成 |
| Windows x64 ZIP | Pass | `release/VJ System-0.1.0-win.zip` を生成 |
| NSIS installer on cloud Linux | Blocked | Wine が環境にない。Windows 上では `npm run package:win` を使用 |
| Electron startup | Pass | Headless Ozone で2 Renderer が12秒継続。JS / preload error なし |
| Operator UI | Pass | CDP で app root、64 pads、Runtime text、PGM preview を確認 |
| Performance output | Pass | CDP で 1920×1080 Canvas と WebGL 2 context を確認 |
| Hardware MIDI | Pending | APC Mini MK2 が環境にない |
| Audio capture | Pending | 対象 IF が環境にない |
| OBS capture | Pending | Windows / OBS 実機試験が必要 |
| 60-minute 1080p60 | Pending | 対象 Windows PC と素材が未確定 |

クラウド試験では X11/GPU がないため SwiftShader を使用しました。プレビューの 5fps 読み出しで software renderer の `ReadPixels` stall 警告が出ました。これは実機 GPU 上の性能値ではありません。通常の PGM 描画経路には画素読み戻しを置いておらず、縮小プレビューだけが読み出します。

本番候補の性能判定は [manual-test.md](manual-test.md) の Windows 実機試験で行います。
