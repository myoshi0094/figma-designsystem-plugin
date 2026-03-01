# figma-designsystem-plugin

Figma プラグイン — デザインシステム管理ツール

## 機能

### Rename Layers
選択したレイヤーを `Design-System/Component-01` 形式で連番リネームします。

### Check Brand Colors
選択レイヤーの Solid Fill を検査し、ブランドカラー（`#00d1ff`）以外の色を自動修正します。
修正されたレイヤー名と変更前後の色が UI に一覧表示されます。

### Extract Colors
選択レイヤーから Solid Fill の色情報を抽出し、以下の 3 フォーマットでエクスポートします。

| フォーマット | 説明 |
|---|---|
| **Design Token** | W3C DTCG 形式（Style Dictionary / Tokens Studio 互換）|
| **CSS Vars** | CSS カスタムプロパティ（`:root { --color-xxx: ... }`）|
| **Tailwind** | `tailwind.config.js` の `theme.extend.colors` 形式 |

Figma レイヤー名の `/` 区切りはネスト構造として展開されます（例: `Brand/Primary` → `{ "Brand": { "Primary": { ... } } }`）。
`opacity < 1` の fill は `rgba()` 表記で出力されます。

## 技術スタック

- [@create-figma-plugin/build](https://github.com/yuanqing/create-figma-plugin) v3
- [@create-figma-plugin/ui](https://github.com/yuanqing/create-figma-plugin) v3
- [Preact](https://preactjs.com/) v10
- TypeScript v5

## セットアップ

```bash
npm install
```

## 開発

```bash
# ウォッチモード（型チェック付き）
npm run watch
```

1. Figma Desktop を開く
2. メニュー → **Plugins** → **Development** → **Import plugin from manifest...**
3. このリポジトリの `manifest.json` を選択

## ビルド

```bash
npm run build
```

`build/` ディレクトリにバンドル済みファイルが出力されます。

## ディレクトリ構成

```
src/
  main.ts   # Figma プラグインのメインロジック（Figma API 操作）
  ui.tsx    # プラグイン UI（Preact）
```
