# PDF ツール

ブラウザで動作する、プライベートな PDF 処理ツール。画像から PDF への変換、PDF の結合・圧縮、画像への変換などが全てブラウザ内で完結。**データはサーバーに送信されません。**

[https://images-to-pdf.pages.dev](https://images-to-pdf.pages.dev)

## 機能

### 画像 → PDF

複数の画像ファイルを 1 つの PDF に変換。以下の設定が可能：

- **ページの向き**: 縦向き / 横向き
- **ページサイズ**: A3 / A4 / A5 / B5 / レター / 画像に合わせる
- **余白**: なし / 小 / 大
- **品質**: 高品質 / 標準 / 小サイズ
- **ページ番号**: 追加可否、位置、フォーマット設定
- **画像編集**: クロップ・回転機能付き
- **一括操作**: 回転・並び替え・削除

### PDF → 画像

PDF を PNG、JPG、WebP などの画像形式に変換。

- ページごとに個別ダウンロード可能
- 品質・解像度を指定可能
- 複数ページを一括処理

### PDF 結合

複数の PDF ファイルを 1 つに結合。

- ページごとに順序変更可能
- 一部ページのみ抽出可能

### PDF 圧縮

PDF ファイルサイズを削減。

- 圧縮レベル調整（高圧縮 / 標準 / 低圧縮）
- スキャン PDF も対応

## 対応フォーマット

### 入力

- **画像**: JPG / PNG / WebP / GIF / BMP / TIFF / HEIC / HEIF
- **PDF**: 標準的な PDF ファイル

### 出力

- **PDF**: 標準準拠の PDF
- **画像**: PNG / JPG / WebP

## セットアップ

### ブラウザで直接使用
オンラインで利用可能。インストール不要。

### ローカル開発

```bash
# リポジトリをクローン
git clone https://github.com/harry2480/images-to-pdf.git
cd images-to-pdf

# ローカルサーバーで起動（例：VS Code Live Server）
# または簡単な HTTP サーバーを起動
python3 -m http.server 8000
# ブラウザで http://localhost:8000 を開く
```

## 開発

### プロジェクト構成

```
images-to-pdf/
├── index.html              # メインページ
├── style.css               # スタイル定義
├── js/
│   ├── jpg-to-pdf.js       # 画像→PDF変換モジュール
│   ├── pdf-to-image.js     # PDF→画像変換モジュール
│   ├── merge-pdf.js        # PDF結合モジュール
│   ├── compress-pdf.js     # PDF圧縮モジュール
│   ├── crop-editor.js      # 画像クロップ編集モジュール
│   └── shared.js           # 共有ユーティリティ
├── libs/                   # 外部ライブラリ
├── .github/workflows/      # GitHub Actions ワークフロー
└── AGENTS.md              # 開発ガイドライン
```

### 使用ライブラリ

- **jspdf**: PDF 生成
- **canvas**: 画像処理・レイアウト
- **pdf.js**: PDF 読み込み・画像変換
- **fflate**: ZIP/DEFLATE 圧縮
- **Cropper.js**: 画像クロップ・回転編集
- **UTIF.js**: TIFF 画像サポート
- **heic2any**: HEIC/HEIF デコード

### 新機能追加時の手順

1. **ブランチを作成**
   ```bash
   git checkout -b feature/<機能名>
   ```

2. **機能実装**
   - 新規モジュールは `js/` 配下に `<機能名>.js` として作成
   - HTML に UI セクション・スクリプト読み込みを追加
   - ナビゲーションボタンを追加

3. **ローカルテスト**
   - ブラウザで `index.html` を開いて動作確認
   - コンソールエラーがないか確認
   - エッジケース（大容量ファイル、未サポート形式）をテスト

4. **コミット・PR**
   ```bash
   git add .
   git commit -m "feat: <説明>"
   git push origin feature/<機能名>
   gh pr create --title "<タイトル>" --body "<説明>"
   ```

### 開発ガイドライン

詳細は [AGENTS.md](./AGENTS.md) を参照。主要なルール：

- **セルフレビュー必須**: 実装後、明らかな問題を修正してから PR 作成
- **動作確認必須**: HTML・CSS・JS 変更時はブラウザで動作確認
- **コミットメッセージ**: 短い命令形（例：`feat: HEIC対応`）
- **PR テンプレート**: スコープ、動作確認方法、スクリーンショット（UI変更時）

## デプロイメント

### Cloudflare Pages

GitHub へ push すると自動デプロイ：

- **develop へのマージ**: 本番環境にデプロイ
- **PR 作成**: プレビュー環境にデプロイ、PR にコメント追加

**セットアップ**:

1. Cloudflare Pages で新規プロジェクト作成
2. リポジトリシークレット設定:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
3. ワークフロー実行確認: `gh pr checks <番号>`

詳細は [PR #8](https://github.com/harry2480/images-to-pdf/pull/8) を参照。

## トラブルシューティング

### PDF 生成に時間がかかる

大容量の画像や高品質設定の場合、処理時間が増加します。進捗インジケーターを参照。

### HEIC 画像が読み込めない

古いブラウザでは HEIC サポートが限定的です。Chrome / Safari の最新版を使用してください。

### PDF が破損している

品質設定が低すぎる、またはメモリ不足の可能性。キャッシュをクリアして再度実行してください。

### JavaScript エラーが出ている

ブラウザのコンソールでエラーメッセージを確認。[GitHub Issues](https://github.com/harry2480/images-to-pdf/issues) で既存レポートを検索または新規投稿してください。

## セキュリティ

- **プライベート**: すべての処理はブラウザ内で完結。データはサーバーに送信されません
- **オープンソース**: ソースコードは公開・監査可能
- **サードパーティ依存ゼロ**: 信頼できるライブラリのみ使用

## ライセンス

MIT License

## 貢献

バグ報告、機能提案、PR を歓迎します。詳細は [GitHub Issues](https://github.com/harry2480/images-to-pdf/issues) を参照。
