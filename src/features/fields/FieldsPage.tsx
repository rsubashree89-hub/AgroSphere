import { useEffect, useState, type FormEvent } from 'react'
import { request } from '../../lib/api'

type FarmOption = { id: string; farmName: string }
type FieldRecord = {
  id: string
  farmId: string
  farmName: string
  fieldName: string
  area: number
  areaUnit: 'hectares' | 'acres' | 'square_meters'
  soilType: string | null
  status: 'active' | 'fallow' | 'planning' | 'harvested'
}

const initialForm = {
  farmId: '',
  fieldName: '',
  area: '',
  areaUnit: 'hectares' as FieldRecord['areaUnit'],
  soilType: '',
  status: 'active' as FieldRecord['status'],
}

function FieldsPage() {
  const [farms, setFarms] = useState<FarmOption[]>([])
  const [fields, setFields] = useState<FieldRecord[]>([])
  const [form, setForm] = useState(initialForm)
  const [editing, setEditing] = useState<FieldRecord | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    setError('')
    try {
      const [farmResult, fieldResult] = await Promise.all([
        request<{ farms: Array<FarmOption & { location: string; totalArea: number; areaUnit: string; soilType: string | null; description: string | null; createdAt: string; updatedAt: string }> }>('/farms'),
        request<{ fields: FieldRecord[] }>('/fields'),
      ])
      setFarms(farmResult.farms)
      setFields(fieldResult.fields)
      setForm((current) => ({ ...current, farmId: current.farmId || farmResult.farms[0]?.id || '' }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load fields.')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    let active = true
    Promise.all([
      request<{ farms: Array<FarmOption & { location: string; totalArea: number; areaUnit: string; soilType: string | null; description: string | null; createdAt: string; updatedAt: string }> }>('/farms'),
      request<{ fields: FieldRecord[] }>('/fields'),
    ])
      .then(([farmResult, fieldResult]) => {
        if (!active) return
        setFarms(farmResult.farms)
        setFields(fieldResult.fields)
        setForm((current) => ({ ...current, farmId: farmResult.farms[0]?.id ?? '' }))
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Unable to load fields.')
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })
    return () => { active = false }
  }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setIsSaving(true)
    const body = {
      ...form,
      area: Number(form.area),
      soilType: form.soilType.trim() || null,
    }
    try {
      if (editing) {
        const result = await request<{ field: FieldRecord }>(`/fields/${editing.id}`, { method: 'PUT', body: JSON.stringify(body) })
        setFields((current) => current.map((field) => field.id === result.field.id ? result.field : field))
      } else {
        const result = await request<{ field: FieldRecord }>('/fields', { method: 'POST', body: JSON.stringify(body) })
        setFields((current) => [result.field, ...current])
      }
      setEditing(null)
      setForm({ ...initialForm, farmId: farms[0]?.id ?? '' })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save field.')
    } finally {
      setIsSaving(false)
    }
  }

  async function remove(field: FieldRecord) {
    if (!window.confirm(`Delete "${field.fieldName}" and its crop records?`)) return
    setError('')
    try {
      await request(`/fields/${field.id}`, { method: 'DELETE' })
      setFields((current) => current.filter((entry) => entry.id !== field.id))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to delete field.')
    }
  }

  function edit(field: FieldRecord) {
    setEditing(field)
    setForm({ farmId: field.farmId, fieldName: field.fieldName, area: String(field.area), areaUnit: field.areaUnit, soilType: field.soilType ?? '', status: field.status })
  }

  return (
    <section className="module-page">
      <header className="module-heading">
        <div><span className="eyebrow">LAND ORGANIZATION</span><h1>Fields</h1><p>Divide your farm into manageable field records.</p></div>
      </header>
      {error && <div className="farm-alert" role="alert">{error}<button className="text-button" type="button" onClick={() => void load()}>Reload</button></div>}
      {!farms.length && !isLoading ? (
        <div className="farm-empty-state"><span className="empty-icon">!</span><h3>Add a farm first</h3><p>Fields belong to one of your farm properties.</p></div>
      ) : (
        <div className="module-two-column">
          <form className="dashboard-panel module-form" onSubmit={(event) => void submit(event)}>
            <h2>{editing ? 'Edit field' : 'Add a field'}</h2>
            <label className="farm-field"><span>Farm</span><select required value={form.farmId} onChange={(event) => setForm({ ...form, farmId: event.target.value })}>{farms.map((farm) => <option key={farm.id} value={farm.id}>{farm.farmName}</option>)}</select></label>
            <label className="farm-field"><span>Field name</span><input required minLength={2} maxLength={100} value={form.fieldName} onChange={(event) => setForm({ ...form, fieldName: event.target.value })} placeholder="e.g. North Field" /></label>
            <div className="farm-form-row">
              <label className="farm-field"><span>Area</span><input type="number" min="0.01" step="0.01" required value={form.area} onChange={(event) => setForm({ ...form, area: event.target.value })} /></label>
              <label className="farm-field"><span>Unit</span><select value={form.areaUnit} onChange={(event) => setForm({ ...form, areaUnit: event.target.value as FieldRecord['areaUnit'] })}><option value="hectares">Hectares</option><option value="acres">Acres</option><option value="square_meters">Square meters</option></select></label>
            </div>
            <label className="farm-field"><span>Soil type <span className="optional-label">Optional</span></span><input maxLength={80} value={form.soilType} onChange={(event) => setForm({ ...form, soilType: event.target.value })} placeholder="Loam, clay, sandy…" /></label>
            <label className="farm-field"><span>Status</span><select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as FieldRecord['status'] })}><option value="active">Active</option><option value="fallow">Fallow</option><option value="planning">Planning</option><option value="harvested">Harvested</option></select></label>
            <div className="farm-form-actions"><button className="secondary-button" type="button" onClick={() => { setEditing(null); setForm({ ...initialForm, farmId: farms[0]?.id ?? '' }) }}>Clear</button><button className="primary-button farm-save-button" type="submit" disabled={isSaving}>{isSaving ? 'Saving…' : editing ? 'Save changes' : 'Add field'}</button></div>
          </form>
          <section className="dashboard-panel module-list">
            <header className="panel-heading"><div><h2>Your fields</h2><p>{fields.length} records</p></div></header>
            {isLoading ? <div className="panel-placeholder">Loading fields…</div> : !fields.length ? <div className="panel-placeholder">No fields yet. Add one to start organizing a farm.</div> : <div className="record-list">{fields.map((field) => <article className="record-row" key={field.id}><div className="record-icon">▤</div><div className="record-main"><strong>{field.fieldName}</strong><span>{field.farmName} · {field.area} {field.areaUnit.replace('_', ' ')}</span><small>{field.soilType || 'Soil not specified'} · {field.status}</small></div><div className="record-actions"><button className="text-button" type="button" onClick={() => edit(field)}>Edit</button><button className="danger-button" type="button" onClick={() => void remove(field)}>Delete</button></div></article>)}</div>}
          </section>
        </div>
      )}
    </section>
  )
}

export default FieldsPage
