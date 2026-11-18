import { useEffect, useState, type FormEvent } from 'react'
import { request } from '../../lib/api'

type Farm = { id: string; farmName: string; location: string }
type Field = { id: string; fieldName: string; farmName: string; farmId: string }
type Crop = { id: string; cropName: string; fieldName: string }
type WeatherResult = {
  location: { name: string; country: string | null }
  attribution: string
  current: { temperatureC: number; humidityPercent: number; rainfallMm: number; condition: string }
  forecast: Array<{ date: string; highC: number; lowC: number; rainfallMm: number; rainProbabilityPercent: number }>
  suggestion: string
}
type WeatherFarm = Farm & {
  totalArea: number
  areaUnit: string
  soilType: string | null
  description: string | null
  createdAt: string
  updatedAt: string
}

function useRecords<T>(url: string, key: string) {
  const [records, setRecords] = useState<T[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let active = true
    request<Record<string, T[]>>(url)
      .then((result) => { if (active) setRecords(result[key] ?? []) })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Unable to load records.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [url, key])
  return { records, setRecords, error, setError, loading }
}

export function WeatherPage() {
  const { records: farms, error: farmError, loading } = useRecords<WeatherFarm>('/farms', 'farms')
  const [farmId, setFarmId] = useState('')
  const [weather, setWeather] = useState<WeatherResult | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function load(id: string) {
    setFarmId(id)
    if (!id) return
    setBusy(true); setError('')
    try { setWeather(await request<WeatherResult>(`/weather/${id}`)) }
    catch (cause) { setWeather(null); setError(cause instanceof Error ? cause.message : 'Weather is unavailable.') }
    finally { setBusy(false) }
  }
  return <section className="module-page"><header className="module-heading"><div><span className="eyebrow">LIVE PROVIDER</span><h1>Weather</h1><p>Current conditions and five-day forecast for your farm.</p></div></header>{(error || farmError) && <div className="farm-alert" role="alert">{error || farmError}</div>}{!loading && !farms.length ? <Empty title="Add a farm to check its weather" message="Weather lookup uses the saved farm location through Open-Meteo geocoding." /> : <section className="dashboard-panel weather-page-panel"><div className="weather-controls"><label className="farm-field"><span>Select farm</span><select value={farmId} onChange={(event) => void load(event.target.value)}><option value="">Choose a farm</option>{farms.map((farm) => <option key={farm.id} value={farm.id}>{farm.farmName} · {farm.location}</option>)}</select></label><button className="secondary-button" type="button" disabled={busy || !farmId} onClick={() => void load(farmId)}>{busy ? 'Refreshing…' : 'Refresh forecast'}</button></div>{busy && <div className="panel-placeholder">Looking up live weather…</div>}{weather && !busy && <><div className="weather-current"><span className="weather-sun">☼</span><div><span className="eyebrow">{weather.location.name}{weather.location.country ? ` · ${weather.location.country}` : ''}</span><h2>{Math.round(weather.current.temperatureC)}°C <small>{weather.current.condition}</small></h2><p>Humidity {weather.current.humidityPercent}% · Rainfall {weather.current.rainfallMm} mm</p></div></div><div className="forecast-grid">{weather.forecast.map((day) => <article className="forecast-day" key={day.date}><span>{new Date(`${day.date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' })}</span><strong>{Math.round(day.highC)}° <small>{Math.round(day.lowC)}°</small></strong><span>{day.rainfallMm} mm rain</span><small>{day.rainProbabilityPercent}% chance</small></article>)}</div><div className="suggestion-box">{weather.suggestion}</div><p className="data-provenance">{weather.attribution}. Suggestions are general observations, not agronomic advice.</p></>}{!weather && !busy && !error && <div className="panel-placeholder">Select a farm to load live conditions.</div>}</section>}</section>
}

type Irrigation = { id: string; field_id: string; field_name: string; farm_name: string; moisture_percent: number; moisture_source: string; water_liters: number; recommendation: string; recorded_at: string }
export function IrrigationPage() {
  const { records: fields } = useRecords<Field>('/fields', 'fields')
  const { records, setRecords, error, setError, loading } = useRecords<Irrigation>('/irrigation', 'records')
  const [fieldId, setFieldId] = useState('')
  const [moisture, setMoisture] = useState('')
  const [water, setWater] = useState('0')
  const [simulator, setSimulator] = useState(false)
  const [busy, setBusy] = useState(false)
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const result = await request<{ record: Irrigation; simulatorNotice: string | null }>('/irrigation', { method: 'POST', body: JSON.stringify({ fieldId: fieldId || fields[0]?.id, moisturePercent: moisture ? Number(moisture) : undefined, waterLiters: Number(water), simulateMoisture: simulator }) })
      setRecords((current) => [result.record, ...current]); setError(result.simulatorNotice ?? '')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to save irrigation record.') }
    finally { setBusy(false) }
  }
  return <section className="module-page"><ModuleHeading eyebrow="FIELD WATER LOG" title="Irrigation" description="Record observed moisture and water usage per field." />{error && <div className="farm-alert" role="status">{error}</div>}{!fields.length ? <Empty title="Add a field first" message="Irrigation records are linked to your farm fields." /> : <div className="module-two-column"><form className="dashboard-panel module-form" onSubmit={(event) => void save(event)}><h2>Record irrigation</h2><label className="farm-field"><span>Field</span><select value={fieldId || fields[0]?.id} onChange={(event) => setFieldId(event.target.value)}>{fields.map((field) => <option key={field.id} value={field.id}>{field.farmName} · {field.fieldName}</option>)}</select></label><label className="farm-field"><span>Soil moisture (%)</span><input type="number" min="0" max="100" step="0.1" value={moisture} disabled={simulator} onChange={(event) => setMoisture(event.target.value)} placeholder="Measured value" /></label><label className="farm-field"><span>Water used (liters)</span><input type="number" min="0" value={water} onChange={(event) => setWater(event.target.value)} /></label><label className="simulator-toggle"><input type="checkbox" checked={simulator} onChange={(event) => setSimulator(event.target.checked)} /><span>Use labeled demo moisture simulator</span></label><p className="field-hint">Threshold-based observation only; not crop-specific advice.</p><button className="primary-button farm-save-button" disabled={busy}>{busy ? 'Saving…' : 'Save field record'}</button></form><section className="dashboard-panel module-list"><ModulePanelHeading title="Irrigation history" subtitle="Saved field observations" />{loading ? <Placeholder>Loading irrigation records…</Placeholder> : records.length ? <div className="record-list">{records.map((item) => <article className="record-row" key={item.id}><div className="record-icon">≈</div><div className="record-main"><strong>{item.field_name} · {item.farm_name}</strong><span>{item.moisture_percent}% moisture · {item.water_liters} L</span><small>{item.recommendation} · {item.moisture_source.toUpperCase()}</small></div></article>)}</div> : <Placeholder>No irrigation records yet.</Placeholder>}</section></div>}</section>
}

type Price = { id: string; crop_id: string; crop_name: string; market_name: string; price: string; currency: string; unit: string; source: string; observed_at: string }
export function MarketsPage() {
  const { records: crops } = useRecords<Crop>('/crops', 'crops')
  const { records, setRecords, error, setError, loading } = useRecords<Price>('/market-prices', 'prices')
  const [cropId, setCropId] = useState('')
  const [marketName, setMarketName] = useState('')
  const [price, setPrice] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [unit, setUnit] = useState('tonne')
  const [busy, setBusy] = useState(false)
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const result = await request<{ price: Price; dataNotice: string }>('/market-prices', { method: 'POST', body: JSON.stringify({ cropId: cropId || crops[0]?.id, marketName, price: Number(price), currency, unit }) })
      setRecords((current) => [result.price, ...current]); setPrice(''); setError(result.dataNotice)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to save observation.') }
    finally { setBusy(false) }
  }
  const chart = records.slice().reverse().slice(-16)
  const maxPrice = Math.max(...chart.map((item) => Number(item.price)), 1)
  return <section className="module-page"><ModuleHeading eyebrow="PRICE OBSERVATIONS" title="Market prices" description="Save and compare your reported market prices; no live feed is claimed." />{error && <div className="farm-alert" role="status">{error}</div>}{!crops.length ? <Empty title="Add a crop first" message="Price observations are attached to a crop in one of your fields." /> : <div className="module-two-column"><form className="dashboard-panel module-form" onSubmit={(event) => void save(event)}><h2>Add observation</h2><label className="farm-field"><span>Crop</span><select value={cropId || crops[0]?.id} onChange={(event) => setCropId(event.target.value)}>{crops.map((crop) => <option key={crop.id} value={crop.id}>{crop.cropName} · {crop.fieldName}</option>)}</select></label><label className="farm-field"><span>Market name</span><input required value={marketName} onChange={(event) => setMarketName(event.target.value)} /></label><div className="farm-form-row"><label className="farm-field"><span>Price</span><input type="number" min="0" step=".01" required value={price} onChange={(event) => setPrice(event.target.value)} /></label><label className="farm-field"><span>Currency</span><input required minLength={3} maxLength={3} value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase())} /></label></div><label className="farm-field"><span>Unit</span><input value={unit} onChange={(event) => setUnit(event.target.value)} /></label><button className="primary-button farm-save-button" disabled={busy}>{busy ? 'Saving…' : 'Save observation'}</button></form><section className="dashboard-panel module-list"><ModulePanelHeading title="Price history" subtitle="User-reported data" />{loading ? <Placeholder>Loading prices…</Placeholder> : !records.length ? <Placeholder>No price records have been added.</Placeholder> : <><div className="record-list">{records.map((item) => <article className="record-row" key={item.id}><div className="record-main"><strong>{item.crop_name} · {item.currency} {item.price}/{item.unit}</strong><span>{item.market_name}</span><small>{new Date(item.observed_at).toLocaleString()} · {item.source.replace('_', ' ')}</small></div></article>)}</div><div className="price-chart">{chart.map((item, index) => <div key={`${item.id}-${index}`} title={`${item.crop_name}: ${item.price}`} style={{ height: `${Math.max(8, Number(item.price) / maxPrice * 100)}%` }} />)}</div></>}</section></div>}</section>
}

type Notification = { id: string; notification_type: string; title: string; message: string; read_at: string | null; created_at: string }
export function NotificationsPage() {
  const { records, setRecords, error, setError, loading } = useRecords<Notification>('/notifications', 'notifications')
  async function read(item: Notification) {
    try { const result = await request<{ notification: Notification }>(`/notifications/${item.id}/read`, { method: 'PATCH' }); setRecords((current) => current.map((entry) => entry.id === item.id ? result.notification : entry)) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to update notification.') }
  }
  return <section className="module-page"><ModuleHeading eyebrow="FARM UPDATES" title="Notifications" description="Review alerts and mark them as read." />{error && <div className="farm-alert" role="alert">{error}</div>}<section className="dashboard-panel notification-page-list">{loading ? <Placeholder>Loading notifications…</Placeholder> : !records.length ? <Placeholder>No notifications yet. Connected services and reminders will appear here.</Placeholder> : records.map((item) => <article className={`notification-row ${item.read_at ? 'is-read' : 'unread'}`} key={item.id}><span className="notification-dot" /><div><span className="meta-label">{item.notification_type.replace('_', ' ')}</span><strong>{item.title}</strong><p>{item.message}</p><small>{new Date(item.created_at).toLocaleString()}</small></div>{!item.read_at && <button className="secondary-button" type="button" onClick={() => void read(item)}>Mark read</button>}</article>)}</section></section>
}

type Report = {
  farm_id: string
  farm_name: string
  total_area: number
  area_unit: string
  field_count: number
  crop_count: number
  harvested_crop_count: number
  recorded_water_liters: number
}
export function ReportsPage() {
  const [farms, setFarms] = useState<Report[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  async function loadReport(start = from, end = to) {
    setLoading(true); setError('')
    const query = new URLSearchParams()
    if (start) query.set('from', start)
    if (end) query.set('to', end)
    try {
      const suffix = query.size ? `?${query.toString()}` : ''
      const result = await request<{ farms: Report[] }>(`/reports/summary${suffix}`)
      setFarms(result.farms)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load report.')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    let active = true
    request<{ farms: Report[] }>('/reports/summary')
      .then((result) => { if (active) setFarms(result.farms) })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Unable to load report.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])
  function download(format: 'csv' | 'pdf') {
    const query = new URLSearchParams()
    if (from) query.set('from', from)
    if (to) query.set('to', to)
    const suffix = query.size ? `?${query.toString()}` : ''
    const anchor = document.createElement('a')
    anchor.href = `/api/reports/export/${format}${suffix}`
    anchor.download = `agrosphere-report.${format}`
    anchor.click()
  }
  return <section className="module-page"><header className="module-heading"><div><span className="eyebrow">FARM PERFORMANCE</span><h1>Reports</h1><p>Filter saved records by date and export your report.</p></div><div className="report-download-actions"><button className="secondary-button" type="button" onClick={() => download('csv')} disabled={loading}>Download CSV</button><button className="primary-button report-download" type="button" onClick={() => download('pdf')} disabled={loading}>Download PDF</button></div></header>{error && <div className="farm-alert" role="alert">{error}</div>}<section className="dashboard-panel report-filter-panel"><label className="farm-field"><span>From</span><input type="date" value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} /></label><label className="farm-field"><span>Through</span><input type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} /></label><button className="secondary-button" type="button" onClick={() => void loadReport()} disabled={loading}>{loading ? 'Applying…' : 'Apply date range'}</button><button className="text-button" type="button" onClick={() => { setFrom(''); setTo(''); void loadReport('', '') }} disabled={loading}>Clear dates</button></section><section className="dashboard-panel module-list"><ModulePanelHeading title="Farm summary" subtitle="Area is a current snapshot; counts and irrigation totals follow the selected date range." />{loading ? <Placeholder>Preparing report…</Placeholder> : !farms.length ? <Placeholder>No farm records are available for this report.</Placeholder> : <div className="report-table-wrap"><table className="report-table"><thead><tr><th>Farm</th><th>Area</th><th>Fields added</th><th>Crops added</th><th>Harvested</th><th>Water (L)</th></tr></thead><tbody>{farms.map((farm) => <tr key={farm.farm_id}><td>{farm.farm_name}</td><td>{farm.total_area} {farm.area_unit.replace('_', ' ')}</td><td>{farm.field_count}</td><td>{farm.crop_count}</td><td>{farm.harvested_crop_count}</td><td>{farm.recorded_water_liters}</td></tr>)}</tbody></table></div>}</section></section>
}

type AdminUser = { id: string; name: string; email: string; role: string; is_active: boolean; farm_count: number; created_at: string }
type AdminEvent = { id: string; action: string; created_at: string; actor_email: string | null; target_email: string | null }
export function AdminPage() {
  const [overview, setOverview] = useState<Record<string, number> | null>(null)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [events, setEvents] = useState<AdminEvent[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busyUser, setBusyUser] = useState('')
  useEffect(() => { let active = true; Promise.all([request<{ overview: Record<string, number> }>('/admin/overview'), request<{ users: AdminUser[] }>('/admin/users'), request<{ events: AdminEvent[] }>('/admin/activity')]).then(([summary, list, audit]) => { if (active) { setOverview(summary.overview); setUsers(list.users); setEvents(audit.events) } }).catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Unable to load admin view.') }).finally(() => { if (active) setLoading(false) }); return () => { active = false } }, [])
  async function setUserActive(user: AdminUser) {
    setBusyUser(user.id); setError('')
    try {
      const result = await request<{ user: AdminUser }>(`/admin/users/${user.id}/active`, { method: 'PATCH', body: JSON.stringify({ active: !user.is_active }) })
      setUsers((current) => current.map((entry) => entry.id === user.id ? result.user : entry))
      const audit = await request<{ events: AdminEvent[] }>('/admin/activity')
      setEvents(audit.events)
      setOverview((current) => current ? { ...current, active_user_count: current.active_user_count + (user.is_active ? -1 : 1), disabled_user_count: current.disabled_user_count + (user.is_active ? 1 : -1) } : current)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to update account access.')
    } finally {
      setBusyUser('')
    }
  }
  return <section className="module-page"><ModuleHeading eyebrow="RESTRICTED AREA" title="Administration" description="Platform health, user access, and recent audited actions." />{error && <div className="farm-alert" role="alert">{error}</div>}{loading ? <Placeholder>Checking administrator access…</Placeholder> : overview && <><div className="dashboard-stats">{Object.entries(overview).map(([label, count]) => <article className="stat-card" key={label}><span className="stat-icon stat-green">◈</span><span className="stat-copy"><span>{label.replaceAll('_', ' ')}</span><strong>{count}</strong></span></article>)}</div><section className="dashboard-panel module-list"><ModulePanelHeading title="User management" subtitle="Disable or restore farmer accounts; disabling revokes active sessions." />{users.map((user) => <article className="record-row admin-user-row" key={user.id}><div className="record-main"><strong>{user.name} · {user.role} · {user.is_active ? 'Active' : 'Disabled'}</strong><span>{user.email}</span><small>{user.farm_count} farms · joined {new Date(user.created_at).toLocaleDateString()}</small></div><button className={user.is_active ? 'secondary-button' : 'primary-button'} type="button" disabled={busyUser === user.id || (user.role === 'admin' && user.is_active && (overview.active_user_count ?? 0) <= 1)} onClick={() => void setUserActive(user)}>{busyUser === user.id ? 'Saving…' : user.is_active ? 'Disable account' : 'Restore account'}</button></article>)}</section><section className="dashboard-panel module-list"><ModulePanelHeading title="Administrator activity" subtitle="Recent account-access changes from the audit log." />{events.length ? events.map((event) => <article className="record-row" key={event.id}><div className="record-main"><strong>{event.action.replace('.', ' ')}</strong><span>Actor: {event.actor_email ?? 'bootstrap process'} · Target: {event.target_email ?? 'removed account'}</span><small>{new Date(event.created_at).toLocaleString()}</small></div></article>) : <Placeholder>No administrator actions recorded.</Placeholder>}</section></>}</section>
}

export function CropHealthPage() {
  const { records: crops } = useRecords<Crop>('/crops', 'crops')
  const [cropId, setCropId] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{
    status: string
    provider: string
    disease_name: string | null
    confidence: number | null
    is_healthy: boolean | null
    description: string | null
    treatment: string | null
    message: string | null
  } | null>(null)
  const [busy, setBusy] = useState(false)
  async function analyze(event: FormEvent) {
    event.preventDefault(); if (!file) return; setBusy(true); setError(''); setResult(null)
    const data = new FormData(); data.append('image', file)
    try {
      const response = await fetch(`/api/crop-health/${cropId || crops[0]?.id}`, { method: 'POST', credentials: 'include', body: data })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(body.error ?? 'Analysis is unavailable.')
      setResult(body.analysis.result)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to analyze image.') }
    finally { setBusy(false) }
  }
  return <section className="module-page"><ModuleHeading eyebrow="AI-ASSISTED OBSERVATION" title="Crop health" description="Optional Plant.id analysis through the FastAPI service; credentials are never stored in the browser." />{!crops.length ? <Empty title="Add a crop first" message="Crop health analyses are associated with your crop records." /> : <form className="dashboard-panel module-form health-form" onSubmit={(event) => void analyze(event)}><h2>Submit a crop image</h2><label className="farm-field"><span>Crop</span><select value={cropId || crops[0]?.id} onChange={(event) => setCropId(event.target.value)}>{crops.map((crop) => <option key={crop.id} value={crop.id}>{crop.cropName} · {crop.fieldName}</option>)}</select></label><label className="farm-field"><span>Image (JPEG, PNG or WebP, max 5 MB)</span><input type="file" accept="image/jpeg,image/png,image/webp" required onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label><p className="field-hint">Configure `AI_SERVICE_URL` in `server/.env` and `PLANT_ID_API_KEY` in `ai-service/.env`. See README setup instructions. Analysis may be uncertain and is not a diagnosis.</p>{error && <div className="farm-alert" role="alert">{error}</div>}{result && <div className="suggestion-box"><strong>{result.status === 'uncertain' ? 'Uncertain provider result' : result.disease_name ?? (result.is_healthy ? 'No issue identified by provider' : 'Analysis complete')}</strong><span>Provider: {result.provider}{result.confidence !== null ? ` · ${Math.round(result.confidence * 100)}% provider confidence` : ''}</span>{result.description && <span>{result.description}</span>}{result.treatment && <span>Possible guidance: {result.treatment}</span>}<span>{result.message ?? 'AI output is informational. Verify with a qualified agronomist.'}</span></div>}<button className="primary-button farm-save-button" disabled={busy || !file}>{busy ? 'Analyzing…' : 'Analyze image'}</button></form>}</section>
}

function ModuleHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <header className="module-heading"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div></header>
}

function ModulePanelHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return <header className="panel-heading"><div><h2>{title}</h2><p>{subtitle}</p></div></header>
}

function Placeholder({ children }: { children: string }) {
  return <div className="panel-placeholder">{children}</div>
}

function Empty({ title, message }: { title: string; message: string }) {
  return <div className="farm-empty-state"><span className="empty-icon">!</span><h3>{title}</h3><p>{message}</p></div>
}