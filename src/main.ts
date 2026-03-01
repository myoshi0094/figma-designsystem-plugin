import { emit, on, showUI } from '@create-figma-plugin/utilities'

// --- イベントハンドラ型定義 ---
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
  handler: (result: {
    fixed: number
    warnings: string[]
    message: string
  }) => void
}

// UI と共有するカラートークンデータ
type ColorTokenData = {
  layerName: string // Figma レイヤー名（例: "Brand/Primary"）
  hex: string       // "#rrggbb" 形式
  opacity: number   // fill の opacity（0–1）
  fillIndex: number // 同一レイヤーに複数 fill がある場合のインデックス
}

type ColorsExtractedHandler = {
  name: 'COLORS_EXTRACTED'
  handler: (result: { tokens: ColorTokenData[] }) => void
}

// ブランドカラー: #00d1ff = RGB(0, 209, 255)
const BRAND_COLOR: RGB = { r: 0, g: 209 / 255, b: 255 / 255 }
const COLOR_EPSILON = 0.004 // 浮動小数点比較の許容誤差

/** SceneNode が fills プロパティを持ち、かつ figma.mixed でないか確認 */
function hasFills(
  node: SceneNode
): node is SceneNode & { fills: ReadonlyArray<Paint> } {
  return 'fills' in node && (node as { fills: unknown }).fills !== figma.mixed
}

/** SolidPaint かつ visible な塗りつぶしか確認 */
function isSolidPaint(paint: Paint): paint is SolidPaint {
  return paint.type === 'SOLID' && paint.visible !== false
}

/** ブランドカラーと一致するか確認 */
function isBrandColor(color: RGB): boolean {
  return (
    Math.abs(color.r - BRAND_COLOR.r) < COLOR_EPSILON &&
    Math.abs(color.g - BRAND_COLOR.g) < COLOR_EPSILON &&
    Math.abs(color.b - BRAND_COLOR.b) < COLOR_EPSILON
  )
}

/** RGB(0-1) を #rrggbb 形式に変換 */
function colorToHex(color: RGB): string {
  const r = Math.round(color.r * 255)
    .toString(16)
    .padStart(2, '0')
  const g = Math.round(color.g * 255)
    .toString(16)
    .padStart(2, '0')
  const b = Math.round(color.b * 255)
    .toString(16)
    .padStart(2, '0')
  return `#${r}${g}${b}`
}

export default function () {
  showUI({ height: 560, width: 400 })

  // --- RENAME_LAYERS: 選択レイヤーを連番でリネーム ---
  on<RenameLayersHandler>('RENAME_LAYERS', function () {
    const selection = figma.currentPage.selection

    if (selection.length === 0) {
      const message = 'レイヤーを選択してください'
      figma.notify(message)
      emit<RenameResultHandler>('RENAME_RESULT', { count: 0, message })
      return
    }

    selection.forEach(function (node, index) {
      const number = String(index + 1).padStart(2, '0')
      node.name = `Design-System/Component-${number}`
    })

    const message = `${selection.length} レイヤーをリネームしました`
    figma.notify(message)
    emit<RenameResultHandler>('RENAME_RESULT', {
      count: selection.length,
      message,
    })
  })

  // --- CHECK_BRAND_COLORS: ブランドカラー以外の塗りを検出・修正 ---
  on<CheckBrandColorsHandler>('CHECK_BRAND_COLORS', function () {
    const selection = figma.currentPage.selection

    if (selection.length === 0) {
      const message = 'レイヤーを選択してください'
      figma.notify(message)
      emit<ColorCheckResultHandler>('COLOR_CHECK_RESULT', {
        fixed: 0,
        warnings: [],
        message,
      })
      return
    }

    let fixedCount = 0
    const warnings: string[] = []

    for (const node of selection) {
      if (!hasFills(node)) continue

      const fills = [...node.fills] as Paint[]
      let hasNonBrand = false

      const updatedFills = fills.map(function (fill) {
        if (isSolidPaint(fill) && !isBrandColor(fill.color)) {
          const hex = colorToHex(fill.color)
          const warning = `"${node.name}": ${hex} → #00d1ff に変更`
          warnings.push(warning)
          console.warn(`[Brand Color Check] ${warning}`)
          hasNonBrand = true
          return { ...fill, color: BRAND_COLOR } as SolidPaint
        }
        return fill
      })

      if (hasNonBrand) {
        // fills への代入: GeometryMixin を持つノードは書き込み可能
        ;(node as GeometryMixin).fills = updatedFills
        fixedCount++
      }
    }

    const message =
      fixedCount > 0
        ? `${fixedCount} レイヤーをブランドカラー (#00d1ff) に修正しました`
        : '全レイヤーがブランドカラーを使用しています'

    figma.notify(message)
    emit<ColorCheckResultHandler>('COLOR_CHECK_RESULT', {
      fixed: fixedCount,
      warnings,
      message,
    })
  })

  // --- EXTRACT_COLORS: 選択レイヤーから Solid Fill の色情報を抽出 ---
  on<ExtractColorsHandler>('EXTRACT_COLORS', function () {
    const selection = figma.currentPage.selection

    if (selection.length === 0) {
      figma.notify('レイヤーを選択してください')
      emit<ColorsExtractedHandler>('COLORS_EXTRACTED', { tokens: [] })
      return
    }

    const tokens: ColorTokenData[] = []

    for (const node of selection) {
      if (!hasFills(node)) continue

      let solidFillIndex = 0
      for (const fill of node.fills) {
        if (isSolidPaint(fill)) {
          tokens.push({
            layerName: node.name,
            hex: colorToHex(fill.color),
            opacity: fill.opacity ?? 1,
            fillIndex: solidFillIndex,
          })
          solidFillIndex++
        }
      }
    }

    if (tokens.length === 0) {
      figma.notify('Solid Fill が見つかりませんでした')
    }

    emit<ColorsExtractedHandler>('COLORS_EXTRACTED', { tokens })
  })
}
