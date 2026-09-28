import type {
  IChartApi,
  ISeriesApi,
  ISeriesPrimitive,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  SeriesAttachedParameter,
  Time,
} from 'lightweight-charts'
import type { CanvasRenderingTarget2D } from 'fancy-canvas'

export type PhaseBox = {
  fromTime: string // 'YYYY-MM-DD'
  toTime: string
  priceLow: number
  priceHigh: number
  fillColor: string
  borderColor: string
  label: string
}

class PhaseBoxRenderer implements IPrimitivePaneRenderer {
  private box: PhaseBox
  private x1: number | null
  private x2: number | null
  private y1: number | null
  private y2: number | null

  constructor(box: PhaseBox, x1: number | null, x2: number | null, y1: number | null, y2: number | null) {
    this.box = box
    this.x1 = x1
    this.x2 = x2
    this.y1 = y1
    this.y2 = y2
  }

  private rect() {
    if (this.x1 == null || this.x2 == null || this.y1 == null || this.y2 == null) return null
    const x = Math.min(this.x1, this.x2)
    const w = Math.abs(this.x2 - this.x1)
    const y = Math.min(this.y1, this.y2)
    const h = Math.abs(this.y2 - this.y1)
    return { x, y, w, h }
  }

  // kotak fase digambar sebagai background — candlestick tetap di atasnya
  drawBackground(target: CanvasRenderingTarget2D) {
    const r = this.rect()
    if (!r) return
    target.useMediaCoordinateSpace(({ context: ctx }) => {
      ctx.fillStyle = this.box.fillColor
      ctx.fillRect(r.x, r.y, r.w, r.h)
      ctx.strokeStyle = this.box.borderColor
      ctx.lineWidth = 1
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1)
    })
  }

  // label ditulis di layer normal supaya tetap terbaca di atas candle
  draw(target: CanvasRenderingTarget2D) {
    const r = this.rect()
    if (!r || r.w < 20) return
    target.useMediaCoordinateSpace(({ context: ctx }) => {
      ctx.font = '600 11px ui-monospace, monospace'
      ctx.fillStyle = this.box.borderColor
      ctx.textBaseline = 'top'
      const pad = 4
      const maxWidth = r.w - pad * 2
      if (maxWidth <= 20) return
      let text = this.box.label
      const fullWidth = ctx.measureText(text).width
      if (fullWidth > maxWidth) {
        const charRatio = Math.max(0.1, maxWidth / fullWidth)
        const keepLen = Math.max(1, Math.floor(text.length * charRatio) - 1)
        text = text.slice(0, keepLen) + '…'
      }
      ctx.fillText(text, r.x + pad, r.y + pad)
    })
  }
}

class PhaseBoxPaneView implements IPrimitivePaneView {
  private source: PhaseBoxPrimitive

  constructor(source: PhaseBoxPrimitive) {
    this.source = source
  }

  renderer(): IPrimitivePaneRenderer | null {
    const { chart, series, box } = this.source
    if (!chart || !series) return null
    const x1 = chart.timeScale().timeToCoordinate(box.fromTime as Time)
    const x2 = chart.timeScale().timeToCoordinate(box.toTime as Time)
    const y1 = series.priceToCoordinate(box.priceHigh)
    const y2 = series.priceToCoordinate(box.priceLow)
    return new PhaseBoxRenderer(box, x1, x2, y1, y2)
  }
}

// Kotak fase akumulasi/distribusi digambar sebagai chart-series primitive —
// lightweight-charts v5 tidak punya API "box" bawaan (beda dari createShape
// TradingView yang dipakai bridge-extension), jadi ini menggantikannya lewat
// mekanisme plugin resminya.
export class PhaseBoxPrimitive implements ISeriesPrimitive<Time> {
  chart: IChartApi | null = null
  series: ISeriesApi<'Candlestick'> | null = null
  box: PhaseBox
  private paneView: PhaseBoxPaneView

  constructor(box: PhaseBox) {
    this.box = box
    this.paneView = new PhaseBoxPaneView(this)
  }

  attached({ chart, series, requestUpdate }: SeriesAttachedParameter<Time>): void {
    this.chart = chart
    this.series = series as ISeriesApi<'Candlestick'>
    // attachPrimitive() tidak otomatis memicu repaint kalau viewport tidak
    // berubah (mis. simbol/window/sensitivitas ganti tapi rentang tanggal
    // candle tetap sama) — tanpa ini kotak baru cuma tampak setelah user
    // pan/zoom chart secara manual.
    requestUpdate()
  }

  detached(): void {
    this.chart = null
    this.series = null
  }

  updateAllViews(): void {}

  paneViews(): readonly IPrimitivePaneView[] {
    return [this.paneView]
  }
}
