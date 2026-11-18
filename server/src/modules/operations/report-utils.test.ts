import { describe, expect, it } from 'vitest'
import { buildReportCsv, buildReportPdf, reportDateRangeSchema } from './report-utils.js'

const row = {
  farm_id: 'farm-1',
  farm_name: '=HYPERLINK("https://example.test")',
  total_area: 10,
  area_unit: 'hectares',
  field_count: 2,
  crop_count: 3,
  harvested_crop_count: 1,
  recorded_water_liters: 200,
}

describe('report utilities', () => {
  it('accepts inclusive ISO date ranges and rejects reversed ranges', () => {
    expect(reportDateRangeSchema.safeParse({ from: '2026-01-01', to: '2026-01-31' }).success).toBe(true)
    expect(reportDateRangeSchema.safeParse({ from: '2026-02-01', to: '2026-01-31' }).success).toBe(false)
  })

  it('quotes CSV and neutralizes spreadsheet formulas in text fields', () => {
    const csv = buildReportCsv([row], '2026-01-01', '2026-01-31')
    expect(csv).toContain('"\'=HYPERLINK(""https://example.test"")"')
    expect(csv).toContain('"2026-01-01"')
  })

  it('creates a valid PDF document with escaped text and a cross-reference table', () => {
    const pdf = buildReportPdf([row], '2026-01-01', '2026-01-31')
    const content = pdf.toString('ascii')
    expect(content.startsWith('%PDF-1.4')).toBe(true)
    expect(content).toContain('farm performance report')
    expect(content).toContain('=HYPERLINK\\("https://example.test"\\)')
    expect(content).toContain('xref')
    expect(content.endsWith('%%EOF\n')).toBe(true)
  })
})
