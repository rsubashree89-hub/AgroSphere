import { z } from 'zod'

export const reportDateRangeSchema = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
}).strict().refine(
  (range) => !range.from || !range.to || range.from <= range.to,
  { path: ['to'], message: 'End date must be on or after start date.' },
)

export type FarmReportRow = {
  farm_id: string
  farm_name: string
  total_area: number
  area_unit: string
  field_count: number
  crop_count: number
  harvested_crop_count: number
  recorded_water_liters: number
}

const columns: Array<{ key: keyof FarmReportRow; label: string; text: boolean }> = [
  { key: 'farm_name', label: 'Farm', text: true },
  { key: 'total_area', label: 'Total area', text: false },
  { key: 'area_unit', label: 'Area unit', text: true },
  { key: 'field_count', label: 'Fields added in period', text: false },
  { key: 'crop_count', label: 'Crops added in period', text: false },
  { key: 'harvested_crop_count', label: 'Crops harvested in period', text: false },
  { key: 'recorded_water_liters', label: 'Water recorded (liters)', text: false },
]

function csvCell(value: string | number, text: boolean) {
  let cell = String(value)
  if (text && /^[\t\r ]*[=+\-@]/.test(cell)) cell = `'${cell}`
  return `"${cell.replaceAll('"', '""')}"`
}

export function buildReportCsv(rows: FarmReportRow[], from?: string, to?: string) {
  const metadata = [
    ['Report', 'AgroSphere farm performance'],
    ['Period start', from ?? 'All available dates'],
    ['Period end', to ?? 'All available dates'],
    [],
  ]
  const csvRows = [
    ...metadata.map((row) => row.map((value) => csvCell(value ?? '', true)).join(',')),
    columns.map((column) => csvCell(column.label, true)).join(','),
    ...rows.map((row) => columns
      .map((column) => csvCell(row[column.key], column.text))
      .join(',')),
  ]
  return `\uFEFF${csvRows.join('\r\n')}\r\n`
}

function pdfText(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e]/g, '?')
    .replaceAll('\\', '\\\\')
    .replaceAll('(', '\\(')
    .replaceAll(')', '\\)')
}

export function buildReportPdf(rows: FarmReportRow[], from?: string, to?: string) {
  const reportLines = [
    'AgroSphere farm performance report',
    `Period start: ${from ?? 'All available dates'}`,
    `Period end: ${to ?? 'All available dates'}`,
    'Farm | Area | Unit | Fields added | Crops added | Harvested | Water (L)',
    ...rows.map((row) => [
      row.farm_name,
      row.total_area,
      row.area_unit,
      row.field_count,
      row.crop_count,
      row.harvested_crop_count,
      row.recorded_water_liters,
    ].join(' | ')),
    '',
    'Area is a current farm snapshot; other counts and water are filtered to the selected period.',
    `Generated: ${new Date().toISOString()}`,
  ]
  const pages: string[][] = []
  for (let index = 0; index < reportLines.length; index += 48) {
    pages.push(reportLines.slice(index, index + 48))
  }
  if (!pages.length) pages.push(['AgroSphere farm performance report', 'No farms were recorded for the selected period.'])

  const pageObjectIds = pages.map((_, index) => 3 + index * 2)
  const fontObjectId = 3 + pages.length * 2
  const objects: string[] = []
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objects[2] = `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`
  pages.forEach((lines, index) => {
    const pageId = pageObjectIds[index]
    const contentId = pageId + 1
    const stream = [
      'BT',
      '/F1 9 Tf',
      '50 790 Td',
      '14 TL',
      ...lines.map((line) => `(${pdfText(line.slice(0, 115))}) Tj T*`),
      'ET',
    ].join('\n')
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontObjectId} 0 R >> >> /Contents ${contentId} 0 R >>`
    objects[contentId] = `<< /Length ${Buffer.byteLength(stream, 'ascii')} >>\nstream\n${stream}\nendstream`
  })
  objects[fontObjectId] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'

  let document = '%PDF-1.4\n'
  const offsets = [0]
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = Buffer.byteLength(document, 'ascii')
    document += `${id} 0 obj\n${objects[id]}\nendobj\n`
  }
  const xrefOffset = Buffer.byteLength(document, 'ascii')
  document += `xref\n0 ${objects.length}\n0000000000 65535 f \n`
  for (let id = 1; id < objects.length; id += 1) {
    document += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`
  }
  document += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return Buffer.from(document, 'ascii')
}
