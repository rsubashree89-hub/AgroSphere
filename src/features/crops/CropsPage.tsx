import { useEffect, useState, type FormEvent } from 'react'
import { request } from '../../lib/api'

type FieldOption = { id: string; fieldName: string; farmName: string }
type CropRecord = {
  id: string
  fieldId: string
  fieldName: string
  farmName: string
  cropName: string
  variety: string | null
  plantingDate: string | null
  expectedHarvestDate: string | null
  growthStage: string
  notes: string | null
}

const stages = ['planned', 'seedling', 'vegetative', 'flowering', 'fruiting', 'maturing', 'harvested']

function CropsPage() {
  const [fields, setFields] = useState<FieldOption[]>([])
  const [crops, setCrops] = useState<CropRecord[]>([])
  const [editing, setEditing] = useState<CropRecord | null>(null)
  const [form, setForm] = useState({ fieldId: '', cropName: '', variety: '', plantingDate: '', expectedHarvestDate: '', growthStage: 'planned', notes: '' })
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    Promise.all([
      request<{ fields: FieldOption[] }>('/fields'),
      request<{ crops: CropRecord[] }>('/crops'),
    ])
      .then(([fieldResult, cropResult]) => {
        if (!active) return
        setFields(fieldResult.fields)
        setCrops(cropResult.crops)
        setForm((current) => ({ ...current, fieldId: fieldResult.fields[0]?.id ?? '' }))
      })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Unable to load crop records.') })
      .finally(() => { if (active) setIsLoading(false) })
    return () => { active = false }
  }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setIsSaving(true)
    const body = {
      ...form,
      variety: form.variety.trim() || null,
      plantingDate: form.plantingDate || null,
      expectedHarvestDate: form.expectedHarvestDate || null,
      notes: form.notes.trim() || null,
    }
    try {
      if (editing) {
        const result = await request<{ crop: CropRecord }>(`/crops/${editing.id}`, { method: 'PUT', body: JSON.stringify(body) })
        setCrops((current) => current.map((crop) => crop.id === result.crop.id ? result.crop : crop))
      } else {
        const result = await request<{ crop: CropRecord }>('/crops', { method: 'POST', body: JSON.stringify(body) })
        setCrops((current) => [result.crop, ...current])
      }
      setEditing(null)
      setForm({ fieldId: fields[0]?.id ?? '', cropName: '', variety: '', plantingDate: '', expectedHarvestDate: '', growthStage: 'planned', notes: '' })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save crop.')
    } finally {
      setIsSaving(false)
    }
  }

  async function remove(crop: CropRecord) {
    if (!window.confirm(`Delete ${crop.cropName} from ${crop.fieldName}? Its history will also be deleted.`)) return
    try {
      await request(`/crops/${crop.id}`, { method: 'DELETE' })
      setCrops((current) => current.filter((entry) => entry.id !== crop.id))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to delete crop.')
    }
  }

  function edit(crop: CropRecord) {
    setEditing(crop)
    setForm({ fieldId: crop.fieldId, cropName: crop.cropName, variety: crop.variety ?? '', plantingDate: crop.plantingDate ?? '', expectedHarvestDate: crop.expectedHarvestDate ?? '', growthStage: crop.growthStage, notes: crop.notes ?? '' })
  }

  return (
    <section className="module-page">
      <header className="module-heading"><div><span className="eyebrow">SEASON TRACKING</span><h1>Crops</h1><p>Track varieties, planting dates, growth stages and harvest timing.</p></div></header>
      {error && <div className="farm-alert" role="alert">{error}</div>}
      {!fields.length && !isLoading ? <div className="farm-empty-state"><span className="empty-icon">!</span><h3>Create a field first</h3><p>Crop records are assigned to a field within one of your farms.</p></div> : (
        <div className="module-two-column">
          <form className="dashboard-panel module-form" onSubmit={(event) => void submit(event)}>
            <h2>{editing ? 'Edit crop record' : 'Add a crop'}</h2>
            <label className="farm-field"><span>Field</span><select required value={form.fieldId} onChange={(event) => setForm({ ...form, fieldId: event.target.value })}>{fields.map((field) => <option key={field.id} value={field.id}>{field.farmName} · {field.fieldName}</option>)}</select></label>
            <label className="farm-field"><span>Crop name</span><input required minLength={2} maxLength={100} value={form.cropName} onChange={(event) => setForm({ ...form, cropName: event.target.value })} placeholder="e.g. Wheat" /></label>
            <label className="farm-field"><span>Variety <span className="optional-label">Optional</span></span><input maxLength={100} value={form.variety} onChange={(event) => setForm({ ...form, variety: event.target.value })} placeholder="Cultivar or variety" /></label>
            <div className="farm-form-row">
              <label className="farm-field"><span>Planting date</span><input type="date" value={form.plantingDate} onChange={(event) => setForm({ ...form, plantingDate: event.target.value })} /></label>
              <label className="farm-field"><span>Expected harvest</span><input type="date" min={form.plantingDate || undefined} value={form.expectedHarvestDate} onChange={(event) => setForm({ ...form, expectedHarvestDate: event.target.value })} /></label>
            </div>
            <label className="farm-field"><span>Growth stage</span><select value={form.growthStage} onChange={(event) => setForm({ ...form, growthStage: event.target.value })}>{stages.map((stage) => <option key={stage} value={stage}>{stage[0].toUpperCase() + stage.slice(1)}</option>)}</select></label>
            <label className="farm-field"><span>Notes <span className="optional-label">Optional</span></span><textarea rows={3} maxLength={2000} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>
            <div className="farm-form-actions"><button className="secondary-button" type="button" onClick={() => { setEditing(null); setForm({ fieldId: fields[0]?.id ?? '', cropName: '', variety: '', plantingDate: '', expectedHarvestDate: '', growthStage: 'planned', notes: '' }) }}>Clear</button><button className="primary-button farm-save-button" type="submit" disabled={isSaving}>{isSaving ? 'Saving…' : editing ? 'Save changes' : 'Add crop'}</button></div>
          </form>
          <section className="dashboard-panel module-list">
            <header className="panel-heading"><div><h2>Crop records</h2><p>Planting and growth timeline</p></div><span className="farm-count">{crops.length} records</span></header>
            {isLoading ? <div className="panel-placeholder">Loading crop records…</div> : !crops.length ? <div className="panel-placeholder">No crops yet. Add a crop to begin your seasonal records.</div> : <div className="record-list">{crops.map((crop) => <article className="record-row" key={crop.id}><div className="record-icon crop-record-icon">♧</div><div className="record-main"><strong>{crop.cropName}{crop.variety ? ` · ${crop.variety}` : ''}</strong><span>{crop.farmName} · {crop.fieldName}</span><small>{crop.growthStage} · {crop.plantingDate || 'Planting date not set'}{crop.expectedHarvestDate ? ` → ${crop.expectedHarvestDate}` : ''}</small></div><div className="record-actions"><button className="text-button" type="button" onClick={() => edit(crop)}>Edit</button><button className="danger-button" type="button" onClick={() => void remove(crop)}>Delete</button></div></article>)}</div>}
          </section>
        </div>
      )}
    </section>
  )
}

export default CropsPage
