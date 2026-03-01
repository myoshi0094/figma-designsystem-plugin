import {
  Button,
  Container,
  Divider,
  render,
  SegmentedControl,
  Text,
  VerticalSpace,
} from '@create-figma-plugin/ui'
import { emit, on } from '@create-figma-plugin/utilities'
import { useCallback, useEffect, useRef, useState } from 'preact/hooks'

// ─── イベントハンドラ型定義 ────────────────────────────────────────────────

type RenameLayersHandler = {
  name: 'RENAME_LAYERS'
  handler: () => void
}
type CheckBrandColorsHandler = {
  name: 'CHECK_BRAND_COLORS'
  handler: () => void
}
type ExtractColorsHandler = {
  name: 'EXTRACT_COLORS'
  handler: () => void
}
type RenameResultHandler = {
  name: 'RENAME_RESULT'
  handler: (result: { count: number; message: string }) => void
}
type ColorCheckResultHandler = {
  name: 'COLOR_CHECK_RESULT'
  handler: (result: { fixed: number; warnings: string[]; message: string }) => void
}

// main.ts と共有するカラートークンデータ
type ColorTokenData = {
  layerName: string
  hex: string
  opacity: number
  fillIndex: number
}

type ColorsExtractedHandler = {
  name: 'COLORS_EXTRACTED'
  handler: (result: { tokens: ColorTokenData[] }) => void
}

// ─── 出力フォーマット ────────────────────────────────────────────────────────

type OutputFormat = 'token' | 'css' | 'tailwind'

const FORMAT_OPTIONS: Array<{ value: OutputFormat; children: string }> = [
  { value: 'token', children: 'Design Token' },
  { value: 'css', children: 'CSS Vars' },
  { value: 'tailwind', children: 'Tailwind' },
]

// ─── カラー変換ユーティリティ ────────────────────────────────────────────────

/** opacity < 1 のとき rgba 表記、それ以外は hex をそのまま返す */
function colorValue(token: ColorTokenData): string {
  const opacity = Math.min(1, Math.max(0, token.opacity))
  if (opacity >= 1) return token.hex
  const r = parseInt(token.hex.slice(1, 3), 16)
  const g = parseInt(token.hex.slice(3, 5), 16)
  const b = parseInt(token.hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${opacity.toFixed(2)})`
}

/**
 * レイヤー名をフラットな CSS キーに変換
 * "Brand/Primary" → "brand-primary"
 * fillIndex > 0 の場合は "-2", "-3"... を末尾に追加
 */
function toTokenKey(layerName: string, fillIndex: number): string {
  const parts = layerName
    .split('/')
    .map(p =>
      p
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
    )
    .filter(Boolean)
  const base = parts.length > 0 ? parts.join('-') : 'unnamed'
  return fillIndex > 0 ? `${base}-${fillIndex + 1}` : base
}

// ─── フォーマット変換 ────────────────────────────────────────────────────────

/**
 * W3C DTCG 形式 (Style Dictionary / Tokens Studio 互換)
 * Figma の "/" 区切りをネスト構造として展開する
 * "Brand/Primary" → { "Brand": { "Primary": { "$value": "#hex", "$type": "color" } } }
 */
function buildNestedTokens(tokens: ColorTokenData[]): Record<string, unknown> {
  const root: Record<string, unknown> = {}
  for (const token of tokens) {
    const parts = token.layerName
      .split('/')
      .map(p => p.trim())
      .filter(Boolean)

    let current = root
    for (let i = 0; i < parts.length - 1; i++) {
      if (current[parts[i]] === undefined) current[parts[i]] = {}
      current = current[parts[i]] as Record<string, unknown>
    }

    const leaf = parts[parts.length - 1]
    const key = token.fillIndex > 0 ? `${leaf}-${token.fillIndex + 1}` : leaf
    current[key] = { $value: colorValue(token), $type: 'color' }
  }
  return root
}

function formatDesignToken(tokens: ColorTokenData[]): string {
  return JSON.stringify(buildNestedTokens(tokens), null, 2)
}

function formatCssVars(tokens: ColorTokenData[]): string {
  const lines = tokens.map(
    t => `  --color-${toTokenKey(t.layerName, t.fillIndex)}: ${colorValue(t)};`
  )
  return `:root {\n${lines.join('\n')}\n}`
}

function formatTailwind(tokens: ColorTokenData[]): string {
  const entries = tokens
    .map(t => `        '${toTokenKey(t.layerName, t.fillIndex)}': '${colorValue(t)}',`)
    .join('\n')
  return (
    `/** @type {import('tailwindcss').Config} */\n` +
    `module.exports = {\n` +
    `  theme: {\n` +
    `    extend: {\n` +
    `      colors: {\n` +
    `${entries}\n` +
    `      },\n` +
    `    },\n` +
    `  },\n` +
    `}`
  )
}

function getOutput(format: OutputFormat, tokens: ColorTokenData[]): string {
  if (tokens.length === 0) return ''
  switch (format) {
    case 'token':    return formatDesignToken(tokens)
    case 'css':      return formatCssVars(tokens)
    case 'tailwind': return formatTailwind(tokens)
    default:         return ''
  }
}

// ─── コンポーネント ──────────────────────────────────────────────────────────

function Plugin() {
  const [renameMessage,  setRenameMessage]  = useState<string | null>(null)
  const [colorMessage,   setColorMessage]   = useState<string | null>(null)
  const [colorWarnings,  setColorWarnings]  = useState<string[]>([])
  const [tokens,         setTokens]         = useState<ColorTokenData[]>([])
  const [outputFormat,   setOutputFormat]   = useState<OutputFormat>('token')
  const [copied,         setCopied]         = useState(false)
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // main.ts からのイベントを購読
  useEffect(function () {
    const unsubRename = on<RenameResultHandler>('RENAME_RESULT', function ({ message }) {
      setRenameMessage(message)
    })
    const unsubColor = on<ColorCheckResultHandler>('COLOR_CHECK_RESULT', function ({ message, warnings }) {
      setColorMessage(message)
      setColorWarnings(warnings)
    })
    const unsubExtract = on<ColorsExtractedHandler>('COLORS_EXTRACTED', function ({ tokens: extracted }) {
      setTokens(extracted)
    })
    return function () {
      unsubRename()
      unsubColor()
      unsubExtract()
    }
  }, [])

  const handleRenameLayers = useCallback(function () {
    setRenameMessage(null)
    emit<RenameLayersHandler>('RENAME_LAYERS')
  }, [])

  const handleCheckBrandColors = useCallback(function () {
    setColorMessage(null)
    setColorWarnings([])
    emit<CheckBrandColorsHandler>('CHECK_BRAND_COLORS')
  }, [])

  const handleExtractColors = useCallback(function () {
    setTokens([])
    setCopied(false)
    emit<ExtractColorsHandler>('EXTRACT_COLORS')
  }, [])

  useEffect(function () {
    return function () {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
    }
  }, [])

  const handleCopy = useCallback(
    function () {
      const text = getOutput(outputFormat, tokens)
      if (!text) return
      navigator.clipboard.writeText(text).then(function () {
        if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
        setCopied(true)
        copiedTimerRef.current = setTimeout(function () { setCopied(false) }, 2000)
      })
    },
    [outputFormat, tokens]
  )

  const outputText = getOutput(outputFormat, tokens)

  // hex が重複しないスウォッチ一覧（デザイン確認用）
  const uniqueSwatches = tokens.filter(
    (t, i, arr) => arr.findIndex(s => s.hex === t.hex && s.opacity === t.opacity) === i
  )

  return (
    <Container space="medium">
      <VerticalSpace space="large" />
      <Text style={{ fontWeight: 700 }}>Design System Manager</Text>

      {/* ── Rename Layers ─────────────────────────────────────── */}
      <VerticalSpace space="medium" />
      <Button fullWidth onClick={handleRenameLayers}>
        Rename Layers
      </Button>
      {renameMessage !== null && (
        <div>
          <VerticalSpace space="extraSmall" />
          <Text>{renameMessage}</Text>
        </div>
      )}

      <VerticalSpace space="small" />
      <Divider />
      <VerticalSpace space="small" />

      {/* ── Check Brand Colors ────────────────────────────────── */}
      <Button fullWidth onClick={handleCheckBrandColors} secondary>
        Check Brand Colors
      </Button>
      {colorMessage !== null && (
        <div>
          <VerticalSpace space="extraSmall" />
          <Text>{colorMessage}</Text>
        </div>
      )}
      {colorWarnings.length > 0 && (
        <div>
          <VerticalSpace space="extraSmall" />
          {colorWarnings.map(function (warning, i) {
            return (
              <div key={i}>
                <Text style={{ opacity: 0.6 }}>{warning}</Text>
              </div>
            )
          })}
        </div>
      )}

      <VerticalSpace space="small" />
      <Divider />
      <VerticalSpace space="small" />

      {/* ── Extract Colors ────────────────────────────────────── */}
      <Button fullWidth onClick={handleExtractColors} secondary>
        Extract Colors
      </Button>

      {tokens.length > 0 && (
        <div>
          <VerticalSpace space="small" />

          {/* カラースウォッチ */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {uniqueSwatches.map(function (token, i) {
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <div
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: 3,
                      background: colorValue(token),
                      border: '1px solid var(--figma-color-border)',
                      flexShrink: 0,
                    }}
                  />
                  <Text style={{ fontSize: 11, fontFamily: 'monospace' }}>
                    {token.hex}
                    {token.opacity < 1 && ` / ${Math.round(token.opacity * 100)}%`}
                  </Text>
                </div>
              )
            })}
          </div>

          <VerticalSpace space="small" />

          {/* フォーマット選択 */}
          <SegmentedControl
            options={FORMAT_OPTIONS}
            value={outputFormat}
            onValueChange={function (v) {
              if (FORMAT_OPTIONS.some(o => o.value === v)) setOutputFormat(v as OutputFormat)
            }}
          />

          <VerticalSpace space="extraSmall" />

          {/* コード出力エリア（読み取り専用） */}
          <textarea
            readOnly
            value={outputText}
            rows={8}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              resize: 'none',
              fontFamily: '"Fira Code", "Consolas", "Monaco", monospace',
              fontSize: 11,
              lineHeight: 1.6,
              border: '1px solid var(--figma-color-border)',
              borderRadius: 2,
              padding: '8px',
              backgroundColor: 'var(--figma-color-bg-secondary)',
              color: 'var(--figma-color-text)',
              outline: 'none',
            }}
          />

          <VerticalSpace space="extraSmall" />

          {/* クリップボードコピー */}
          <Button fullWidth onClick={handleCopy}>
            {copied ? '✓  Copied!' : 'Copy to Clipboard'}
          </Button>
        </div>
      )}

      <VerticalSpace space="large" />
    </Container>
  )
}

export default render(Plugin)
