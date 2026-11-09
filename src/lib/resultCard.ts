import type { Candidate, ScoreMark } from '../types'

const WIDTH = 1760
const HEADER_HEIGHT = 290
const TABLE_HEADER_HEIGHT = 68
const ROW_HEIGHT = 92
const BOTTOM_PADDING = 28
const MAX_ROWS = 100
const QUESTION_START = 370
const QUESTION_STEP = 41

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  context.beginPath()
  context.roundRect(x, y, width, height, radius)
}

function statusColor(status: Candidate['status']) {
  if (status === 'Passed') return '#34d399'
  if (status === 'Borderline') return '#fbbf24'
  if (status === 'Failed' || status === 'Disqualified') return '#fb7185'
  if (status === 'Did Not Attend (DNA)') return '#94a3b8'
  return '#22d3ee'
}

function markColor(mark: ScoreMark | null | undefined) {
  if (mark === 1) return { text: '#a7f3d0', fill: 'rgba(16, 185, 129, .20)', border: 'rgba(52, 211, 153, .52)' }
  if (mark === 0.5) return { text: '#fde68a', fill: 'rgba(245, 158, 11, .20)', border: 'rgba(251, 191, 36, .52)' }
  if (mark === 0) return { text: '#fecdd3', fill: 'rgba(244, 63, 94, .19)', border: 'rgba(251, 113, 133, .48)' }
  if (mark === 'SKIP') return { text: '#cbd5e1', fill: 'rgba(100, 116, 139, .18)', border: 'rgba(148, 163, 184, .38)' }
  return { text: '#64748b', fill: 'rgba(51, 65, 85, .25)', border: 'rgba(100, 116, 139, .24)' }
}

function markText(mark: ScoreMark | null | undefined) {
  if (mark === 1) return '1'
  if (mark === 0.5) return '.5'
  if (mark === 0) return '0'
  return mark === 'SKIP' ? '0' : '—'
}

function pointsText(candidate: Candidate) {
  const marks = candidate.question_marks ?? []
  const savedMarks = Object.values(candidate.scores ?? {})
  if (!marks.some((mark) => mark !== null) && !savedMarks.length) return '—'
  const points = marks.some((mark) => mark !== null)
    ? marks.reduce<number>((total, mark) => total + (typeof mark === 'number' ? mark : 0), 0)
    : savedMarks.reduce<number>((total, mark) => total + (typeof mark === 'number' ? mark : 0), 0)
  return points.toFixed(1)
}

function resultText(candidate: Candidate) {
  return candidate.status === 'Did Not Attend (DNA)' ? 'DID NOT ATTEND' : candidate.status.toUpperCase()
}

function clippedText(context: CanvasRenderingContext2D, value: string, maxWidth: number) {
  let text = value
  while (text.length > 1 && context.measureText(`${text}…`).width > maxWidth) text = text.slice(0, -1)
  return text === value ? text : `${text}…`
}

function drawPill(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, color: string) {
  context.fillStyle = color
  context.globalAlpha = 0.10
  roundedRect(context, x, y, width, height, 12)
  context.fill()
  context.globalAlpha = 1
  context.strokeStyle = color
  context.globalAlpha = 0.42
  context.stroke()
  context.globalAlpha = 1
}

export function drawResultCard(canvas: HTMLCanvasElement, candidates: Candidate[], cycleDate: string) {
  if (candidates.length > MAX_ROWS) {
    throw new Error(`This detailed image supports up to ${MAX_ROWS} rows. Filter the roster and export smaller groups separately.`)
  }
  const height = HEADER_HEIGHT + TABLE_HEADER_HEIGHT + Math.max(candidates.length, 1) * ROW_HEIGHT + BOTTOM_PADDING
  canvas.width = WIDTH
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Your browser could not create the result image.')

  const background = context.createLinearGradient(0, 0, WIDTH, height)
  background.addColorStop(0, '#07101f')
  background.addColorStop(0.52, '#10102b')
  background.addColorStop(1, '#071a24')
  context.fillStyle = background
  context.fillRect(0, 0, WIDTH, height)

  const topGlow = context.createLinearGradient(24, 0, WIDTH - 24, 0)
  topGlow.addColorStop(0, '#22d3ee')
  topGlow.addColorStop(0.48, '#818cf8')
  topGlow.addColorStop(1, '#34d399')
  context.fillStyle = topGlow
  context.fillRect(24, 24, WIDTH - 48, 5)

  context.strokeStyle = 'rgba(129, 140, 248, .30)'
  context.lineWidth = 2
  roundedRect(context, 22, 22, WIDTH - 44, height - 44, 26)
  context.stroke()

  const glow = context.createRadialGradient(1310, 48, 20, 1310, 48, 480)
  glow.addColorStop(0, 'rgba(129, 140, 248, .19)')
  glow.addColorStop(1, 'rgba(129, 140, 248, 0)')
  context.fillStyle = glow
  context.fillRect(26, 26, WIDTH - 52, 235)

  context.fillStyle = '#f8fafc'
  context.font = '900 43px Inter, Arial, sans-serif'
  context.fillText('OFFICIAL INTERVIEW RESULTS', 72, 100)

  const subtitle = context.createLinearGradient(72, 0, 700, 0)
  subtitle.addColorStop(0, '#67e8f9')
  subtitle.addColorStop(1, '#c4b5fd')
  context.fillStyle = subtitle
  context.font = '800 31px Inter, Arial, sans-serif'
  context.fillText('CANDIDATE MARK SHEET', 72, 148)

  const evaluated = candidates.filter((candidate) => !['Pending', 'In Progress'].includes(candidate.status)).length
  const passed = candidates.filter((candidate) => candidate.status === 'Passed').length
  const stats = [
    { label: 'CANDIDATES', value: `${candidates.length}`, color: '#67e8f9' },
    { label: 'EVALUATED', value: `${evaluated}`, color: '#c4b5fd' },
    { label: 'PASSED', value: `${passed}`, color: '#6ee7b7' },
    { label: 'CYCLE DATE', value: cycleDate, color: '#fcd34d' },
  ]
  stats.forEach((stat, index) => {
    const x = 850 + index * 205
    drawPill(context, x - 12, 72, 180, 90, stat.color)
    context.fillStyle = '#94a3b8'
    context.font = '700 11px "DM Mono", monospace'
    context.fillText(stat.label, x, 103)
    context.fillStyle = stat.color
    context.font = '800 20px Inter, Arial, sans-serif'
    context.fillText(clippedText(context, stat.value, 150), x, 135)
  })

  context.fillStyle = '#94a3b8'
  context.font = '700 11px "DM Mono", monospace'
  context.fillText('MARK KEY', 72, 220)
  const legend = [
    { mark: 1 as const, text: 'FULL', x: 170 },
    { mark: 0.5 as const, text: 'PARTIAL', x: 300 },
    { mark: 0 as const, text: 'ZERO', x: 460 },
    { mark: 'SKIP' as const, text: 'SKIP', x: 590 },
  ]
  for (const item of legend) {
    const colors = markColor(item.mark)
    context.fillStyle = colors.fill
    roundedRect(context, item.x, 199, 44, 30, 8)
    context.fill()
    context.strokeStyle = colors.border
    context.stroke()
    context.fillStyle = colors.text
    context.font = '800 11px "DM Mono", monospace'
    context.fillText(markText(item.mark), item.x + 7, 219)
    context.fillStyle = '#cbd5e1'
    context.font = '600 11px Inter, Arial, sans-serif'
    context.fillText(item.text, item.x + 52, 219)
  }
  context.fillStyle = '#64748b'
  context.font = '12px Inter, Arial, sans-serif'
  context.fillText('Each skipped question counts as 0 points. Final totals are out of 15.', 72, 252)

  const tableTop = HEADER_HEIGHT
  const tableGradient = context.createLinearGradient(48, tableTop, WIDTH - 48, tableTop + TABLE_HEADER_HEIGHT)
  tableGradient.addColorStop(0, '#16263a')
  tableGradient.addColorStop(0.55, '#20203d')
  tableGradient.addColorStop(1, '#15313a')
  context.fillStyle = tableGradient
  roundedRect(context, 48, tableTop, WIDTH - 96, TABLE_HEADER_HEIGHT, 12)
  context.fill()

  context.fillStyle = '#a5b4fc'
  context.fillStyle = '#e0f2fe'
  context.font = '800 15px "DM Mono", monospace'
  context.fillText('CANDIDATE', 70, tableTop + 42)
  context.fillText('QUESTION MARKS · 1 POINT EACH', QUESTION_START, tableTop + 42)
  context.fillText('TOTAL / 15', 1040, tableTop + 42)
  context.fillText('FINAL RESULT', 1230, tableTop + 42)

  context.strokeStyle = 'rgba(125, 211, 252, .26)'
  context.lineWidth = 1
  for (const x of [340, 1018, 1208]) {
    context.beginPath()
    context.moveTo(x, tableTop + 12)
    context.lineTo(x, height - BOTTOM_PADDING)
    context.stroke()
  }

  candidates.forEach((candidate, index) => {
    const y = tableTop + TABLE_HEADER_HEIGHT + index * ROW_HEIGHT
    context.fillStyle = index % 2 === 0 ? 'rgba(16, 30, 49, .96)' : 'rgba(11, 23, 40, .96)'
    context.fillRect(48, y, WIDTH - 96, ROW_HEIGHT)

    context.fillStyle = statusColor(candidate.status)
    context.fillRect(48, y + 12, 4, ROW_HEIGHT - 24)

    context.fillStyle = '#f8fafc'
    context.font = '800 18px Inter, Arial, sans-serif'
    context.fillText(clippedText(context, candidate.name, 245), 70, y + 52)

    for (let questionIndex = 0; questionIndex < 15; questionIndex += 1) {
      const mark = candidate.question_marks?.[questionIndex] ?? null
      const colors = markColor(mark)
      const x = QUESTION_START + questionIndex * QUESTION_STEP
      context.fillStyle = colors.fill
      roundedRect(context, x, y + 18, 33, 56, 7)
      context.fill()
      context.strokeStyle = colors.border
      context.stroke()
      context.fillStyle = '#cbd5e1'
      context.font = '700 9px "DM Mono", monospace'
      context.textAlign = 'center'
      context.fillText(`Q${questionIndex + 1}`, x + 16.5, y + 34)
      context.fillStyle = colors.text
      context.font = '800 12px "DM Mono", monospace'
      context.fillText(markText(mark), x + 16.5, y + 59)
      context.textAlign = 'start'
    }

    context.fillStyle = '#67e8f9'
    context.font = '900 21px "DM Mono", monospace'
    context.fillText(pointsText(candidate), 1040, y + 53)

    const color = statusColor(candidate.status)
    const result = resultText(candidate)
    context.font = '900 13px "DM Mono", monospace'
    const badgeWidth = Math.min(430, context.measureText(result).width + 38)
    context.fillStyle = `${color}20`
    roundedRect(context, 1230, y + 25, badgeWidth, 44, 12)
    context.fill()
    context.strokeStyle = `${color}66`
    context.stroke()
    context.fillStyle = color
    context.fillText(result, 1248, y + 52)

    context.strokeStyle = 'rgba(129, 140, 248, .12)'
    context.beginPath()
    context.moveTo(48, y + ROW_HEIGHT)
    context.lineTo(WIDTH - 48, y + ROW_HEIGHT)
    context.stroke()
  })

  return canvas
}
