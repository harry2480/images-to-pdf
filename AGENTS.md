# Repository Guidelines

> **Note**: AGENTS.md は images-to-pdf プロジェクトの開発ルールガイドです。

## 必須ルール

### セルフレビュー必須
実装完了後（コミット前）に、変更コードを確認して明らかな問題を潰しておく。その後コミット → push → PR作成まで一気に進める。

### UI変更時の動作確認必須
PR作成後、変更差分に UI 関連ファイル（`*.html`, `*.css`, `*.js`）が含まれる場合は、必ず実装が正常に動作するか確認すること。

### 計画実行時の承認フロー
`/goal` で目標を設定し `/plan` で計画を立てた場合、実装完了後に勝手にマージしない。
- **実装フェーズ**: 計画に従って実装を進める
- **PR作成**: コミット → push → PR作成（`gh pr create`）まで一気に進める
- **マージ**: ユーザーが PR を確認して承認するまで待つ。ユーザーからの明示的な指示（「merge して」「大丈夫」等）を待ってマージする

### 実装完了後は即PR作成
計画がない通常の実装では、実装完了後は「コミットしますか？」等の確認を挟まず、コミット → push → PR作成（`gh pr create`）まで一気に進めること。

## Project Structure

```
images-to-pdf/
├── index.html              # メインページ
├── style.css               # グローバルスタイル
├── js/
│   ├── jpg-to-pdf.js       # 画像→PDF変換モジュール
│   ├── merge-pdf.js        # PDF結合モジュール
│   ├── pdf-to-image.js     # PDF→画像変換モジュール
│   ├── compress-pdf.js     # PDF圧縮モジュール
│   ├── crop-editor.js      # 画像クロップ編集モジュール
│   ├── shared.js           # 共有ユーティリティ
│   └── [support libraries] # UTIF.js, fflate, etc.
├── .github/workflows/      # GitHub Actions ワークフロー
├── AGENTS.md              # このファイル
└── README.md
```

## JavaScript Module Organization

- **モジュール分離**: 機能ごとに専用の JS ファイルを作成し、単一責任に従う
- **DOM マニピュレーション**: グローバル変数の使用は最小限に。必要な場合は `window.appState` 等で一元管理
- **イベントリスナー**: HTML（`onclick`）での直接指定は避け、JS から `addEventListener` で登録
- **エラーハンドリング**: ユーザーに対して親切なエラーメッセージを表示。技術的エラーはコンソール出力
- **ファイルサイズ最適化**: 不要な依存を避け、バンドルサイズを意識した実装

### Feature ディレクトリ構造（新機能追加時）

新しいツール（例：`分割-pdf.js`）を追加する際の構成：

```
js/
├── split-pdf.js            # 分割機能の実装
├── split-pdf.css           # 分割機能のスタイル（必要に応じて style.css に統合）
└── shared.js               # 共有関数（既存）
```

HTML 側で：
1. 新しいツールへのナビゲーションボタンを追加
2. `<script>` タグで新モジュールをロード
3. DOM に UI セクションを追加

## Coding Style & Naming Conventions

- **JavaScript**: ファイル名はケバブケース（`jpg-to-pdf.js`）、変数・関数はキャメルケース（`convertImageToPdf`）
- **CSS**: クラス名はケバブケース（`.pdf-tool-section`）、BEM 方式を参考に階層構造を反映
- **変数命名**: ファイルハンドル（`selectedFile`）、DOM 要素（`uploadContainer`）、状態（`isProcessing`）で区別しやすく
- **コメント**: **WHY** が非自明な場合のみ記載。WHAT は実装コードで自明であること
- **色・サイズ**: CSS 変数（`:root { --color-primary: ... }`）を活用し、ハードコード化を避ける

## HTML / CSS Guidelines

- **セマンティック HTML**: `<div>` で囲むだけでなく、`<section>`, `<header>`, `<footer>`, `<form>` 等の適切なタグを使用
- **Accessibility**: `alt` テキスト、`label` 要素、ボタンの役割明記（ARIA 属性）
- **レスポンシブデザイン**: CSS Grid / Flexbox で モバイル対応。`@media` クエリで必要に応じて調整

## Deployment & GitHub Actions

- **PR 作成時**: プレビュー環境にデプロイ、PR にコメント追加
- **develop/main へのマージ時**: 本番環境にデプロイ

### ワークフロー実行確認

PR 作成後、必ず以下を確認すること：

```bash
# ワークフローの実行状況確認
gh pr checks <PR番号>

# 失敗時は詳細ログを確認
gh pr checks <PR番号> --watch
```

## Commit & Pull Request Guidelines

- **コミットメッセージ**: 短い命令形主体（日本語可）。例：`feat: HEIC入力対応`, `fix: PDF圧縮のバグ修正`
- **スコープ厳守**: PR には現在のタスクに関係する変更のみを含める
- **PR 本文**: スコープ概要、動作確認方法（例：「ローカルで index.html を開いて〜」）、UI 変更時のスクリーンショットを添付
- **PR 作成前チェック**:
  - `gh pr list` で既存PR状態を確認
  - ブランチに無関係な変更がないか確認
  - JS・CSS の構文エラーがないか確認（ブラウザコンソール）

## Testing & Validation

### 動作確認の実施

実装完了後、必ず以下を確認すること：

1. **ローカル確認**: ブラウザで index.html を開き、機能が期待通りに動作するか確認
2. **エッジケース**: 大容量ファイル、形式外のファイル、ネットワーク遅延環境での動作確認
3. **ブラウザ互換性**: Chrome, Safari, Firefox での動作確認（必要に応じて）
4. **コンソール確認**: 予期しない警告・エラーがないか確認

### UI 変更時

UI 関連の変更が含まれる場合、以下を PR 本文に含める：

- 変更内容の説明
- スクリーンショット（新機能の場合）
- 動作確認済みブラウザ・OS のリスト

## Development Commands

```bash
# ローカルでの確認
# index.html をブラウザで開く（例：Live Server 拡張使用）

# Git 操作
git checkout -b feature/<機能名>
git add .
git commit -m "<メッセージ>"
git push origin feature/<機能名>

# PR 作成
gh pr create --title "機能名" --body "詳細説明"

# PR 確認
gh pr view <番号>
gh pr checks <番号>
```

## Known Tools & Libraries

現在使用中のライブラリ：

- **pdf.js**: PDF → 画像変換、PDF 読み込み
- **fflate**: ZIP/DEFLATE 圧縮（PDF圧縮に使用）
- **Cropper.js**: 画像クロップ・回転編集
- **UTIF.js**: TIFF 画像サポート
- **heic2any**: HEIC/HEIF 画像サポート（ブラウザ組み込み機能の利用）

これら以外の外部ライブラリを追加する際は、バンドルサイズへの影響を確認すること。

## Troubleshooting

### Cloudflare Pages デプロイ失敗時

1. `gh pr checks <番号>` でエラーログを確認
2. `.github/workflows/cloudflare-pages.yml` の設定を確認
3. リポジトリシークレット（`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`）が設定済みか確認

### JavaScript 構文エラー

1. ブラウザの開発者ツール（コンソール）でエラーメッセージを確認
2. 該当行の構文を修正
3. ページをリロード

### 新機能が表示されない

1. HTML の `<script>` タグでモジュールが読み込まれているか確認
2. DOM にセクションが追加されているか確認
3. CSS が正しく読み込まれているか確認（`<link rel="stylesheet">`）
