import { useEffect, useState } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { request } from '../../lib/api'

type Summary = {
  farm_count: number
  total_area: number
  field_count: number
  crop_count: number
}

type DashboardData = {
  summary: Summary
  cropsByStage: Array<{ name: string; value: number }>
  activity: Array<{ kind: string; title: string; happened_at: string; context: string }>
  notifications: Array<{ id: string; title: string; message: string; read_at: string | null }>
}

function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let active = true
    request<DashboardData>('/dashboard')
      .then((result) => {
        if (active) setData(result)
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Unable to load dashboard.')
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  const stats = [
    { label: 'Farm properties', value: data?.summary.farm_count ?? 0, icon: '⌂', tone: 'green' },
    { label: 'Fields managed', value: data?.summary.field_count ?? 0, icon: '▤', tone: 'sage' },
    { label: 'Active crop records', value: data?.summary.crop_count ?? 0, icon: '♧', tone: 'gold' },
    { label: 'Land area registered', value: data?.summary.total_area ?? 0, suffix: ' mixed units', icon: '⌁', tone: 'blue' },
  ]

  return (
    <div className="dashboard-page">
      <section className="dashboard-welcome">
        <div>
          <span className="eyebrow">FARM OPERATIONS OVERVIEW</span>
          <h1>A good day to grow.</h1>
          <p>Your farm activity, organized in one place.</p>
        </div>
        <div className="today-pill">
          <span className="status-dot" />
          <span>{new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date())}</span>
        </div>
      </section>

      {error && <div className="farm-alert" role="alert">{error}</div>}

      <section className="dashboard-stats" aria-label="Farm statistics">
        {stats.map((stat) => (
          <article className="stat-card" key={stat.label}>
            <span className={`stat-icon stat-${stat.tone}`} aria-hidden="true">{stat.icon}</span>
            <span className="stat-copy">
              <span>{stat.label}</span>
              <strong>{isLoading ? '—' : new Intl.NumberFormat().format(stat.value)}{stat.suffix && <small>{stat.suffix}</small>}</strong>
            </span>
          </article>
        ))}
      </section>

      <div className="dashboard-grid">
        <section className="dashboard-panel chart-panel">
          <header className="panel-heading">
            <div>
              <h2>Crop growth stages</h2>
              <p>Current records across your farms</p>
            </div>
            <span className="live-data-tag">YOUR DATA</span>
          </header>
          {isLoading ? (
            <div className="panel-placeholder" role="status">Loading crop statistics…</div>
          ) : !data?.cropsByStage.length ? (
            <div className="panel-placeholder">Crop stage analytics will appear when you add crops.</div>
          ) : (
            <div className="chart-wrap">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.cropsByStage} margin={{ top: 14, right: 12, bottom: 0, left: -18 }}>
                  <defs>
                    <linearGradient id="stage-fill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#5d8c62" stopOpacity={0.24} />
                      <stop offset="100%" stopColor="#5d8c62" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#edf0ea" strokeDasharray="3 5" vertical={false} />
                  <XAxis dataKey="name" tick={{ fill: '#829084', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fill: '#9aa49b', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ borderRadius: 9, border: '1px solid #e6ebe3', fontSize: 12 }} />
                  <Area type="monotone" dataKey="value" name="Crop records" stroke="#4d7b55" strokeWidth={2.2} fill="url(#stage-fill)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>

        <section className="dashboard-panel activity-panel">
          <header className="panel-heading">
            <div>
              <h2>Recent activity</h2>
              <p>Latest changes on your farm</p>
            </div>
          </header>
          {isLoading ? (
            <div className="panel-placeholder" role="status">Loading activity…</div>
          ) : !data?.activity.length ? (
            <div className="panel-placeholder">Your farm activity will show here as you add fields and crops.</div>
          ) : (
            <ul className="activity-list">
              {data.activity.map((item, index) => (
                <li key={`${item.kind}-${item.happened_at}-${index}`}>
                  <span className={`activity-mark activity-${item.kind}`} />
                  <span className="activity-copy">
                    <strong>{item.title}</strong>
                    <span>{item.context} · {new Date(item.happened_at).toLocaleDateString()}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="dashboard-panel weather-teaser">
          <span className="weather-sun" aria-hidden="true">☼</span>
          <div>
            <span className="eyebrow">LOCAL WEATHER</span>
            <h2>Weather at your farm</h2>
            <p>Choose a farm in Weather to load a live Open-Meteo forecast.</p>
          </div>
          <span className="provider-note">Live provider · no API key required</span>
        </section>

        <section className="dashboard-panel notification-panel">
          <header className="panel-heading">
            <div>
              <h2>Notifications</h2>
              <p>Farm reminders and updates</p>
            </div>
          </header>
          {!data?.notifications.length ? (
            <div className="panel-placeholder compact-placeholder">No notifications yet.</div>
          ) : (
            <ul className="notification-preview">
              {data.notifications.map((item) => (
                <li key={item.id} className={item.read_at ? '' : 'unread'}>
                  <span className="notification-dot" />
                  <span><strong>{item.title}</strong><small>{item.message}</small></span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <p className="data-provenance">Dashboard metrics are calculated from your saved farm, field, crop, and irrigation records. No sample metrics are displayed.</p>
    </div>
  )
}

export default DashboardPage
