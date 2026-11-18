import { lazy, Suspense, useState } from 'react'
import BrandMark from '../components/BrandMark'

const FarmsPage = lazy(() => import('../features/farms/FarmsPage'))
const FieldsPage = lazy(() => import('../features/fields/FieldsPage'))
const CropsPage = lazy(() => import('../features/crops/CropsPage'))
const DashboardPage = lazy(() => import('../features/dashboard/DashboardPage'))
const WeatherPage = lazy(() => import('../features/operations/OperationsPages').then((module) => ({ default: module.WeatherPage })))
const IrrigationPage = lazy(() => import('../features/operations/OperationsPages').then((module) => ({ default: module.IrrigationPage })))
const CropHealthPage = lazy(() => import('../features/operations/OperationsPages').then((module) => ({ default: module.CropHealthPage })))
const MarketsPage = lazy(() => import('../features/operations/OperationsPages').then((module) => ({ default: module.MarketsPage })))
const NotificationsPage = lazy(() => import('../features/operations/OperationsPages').then((module) => ({ default: module.NotificationsPage })))
const ReportsPage = lazy(() => import('../features/operations/OperationsPages').then((module) => ({ default: module.ReportsPage })))
const AdminPage = lazy(() => import('../features/operations/OperationsPages').then((module) => ({ default: module.AdminPage })))

type User = {
  id: string
  name: string
  email: string
  role?: 'farmer' | 'admin'
}

type WorkspacePage =
  | 'dashboard'
  | 'farms'
  | 'fields'
  | 'crops'
  | 'weather'
  | 'irrigation'
  | 'health'
  | 'market'
  | 'notifications'
  | 'reports'
  | 'admin'

const navigation: Array<{ id: WorkspacePage; label: string; icon: string; section: string }> = [
  { id: 'dashboard', label: 'Overview', icon: '⌂', section: 'WORKSPACE' },
  { id: 'farms', label: 'My farms', icon: '▰', section: 'LAND & CROPS' },
  { id: 'fields', label: 'Fields', icon: '▤', section: 'LAND & CROPS' },
  { id: 'crops', label: 'Crops', icon: '♧', section: 'LAND & CROPS' },
  { id: 'weather', label: 'Weather', icon: '☼', section: 'INSIGHTS' },
  { id: 'irrigation', label: 'Irrigation', icon: '≈', section: 'INSIGHTS' },
  { id: 'health', label: 'Crop health', icon: '✳', section: 'INSIGHTS' },
  { id: 'market', label: 'Market prices', icon: '↗', section: 'INSIGHTS' },
  { id: 'notifications', label: 'Notifications', icon: '◉', section: 'INSIGHTS' },
  { id: 'reports', label: 'Reports', icon: '▧', section: 'INSIGHTS' },
  { id: 'admin', label: 'Administration', icon: '◇', section: 'PLATFORM' },
]

function Workspace({
  user,
  isSigningOut,
  signOutError,
  onSignOut,
}: {
  user: User
  isSigningOut: boolean
  signOutError: string
  onSignOut: () => void
}) {
  const [page, setPage] = useState<WorkspacePage>('dashboard')
  const visibleNavigation = navigation.filter((item) => item.id !== 'admin' || user.role === 'admin')
  const sections = [...new Set(visibleNavigation.map((item) => item.section))]

  function renderPage() {
    switch (page) {
      case 'dashboard': return <DashboardPage />
      case 'farms': return <FarmsPage />
      case 'fields': return <FieldsPage />
      case 'crops': return <CropsPage />
      case 'weather': return <WeatherPage />
      case 'irrigation': return <IrrigationPage />
      case 'health': return <CropHealthPage />
      case 'market': return <MarketsPage />
      case 'notifications': return <NotificationsPage />
      case 'reports': return <ReportsPage />
      case 'admin': return <AdminPage />
    }
  }

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <a className="brand sidebar-brand" href="/" aria-label="AgroSphere home">
          <BrandMark />
          <span>AgroSphere</span>
        </a>
        <div className="sidebar-farm-label">
          <span className="sidebar-label">FARM OPERATIONS</span>
          <span className="sidebar-status"><span className="status-dot" /> Workspace active</span>
        </div>
        <nav className="side-navigation" aria-label="Main navigation">
          {sections.map((section) => (
            <div className="navigation-section" key={section}>
              <span className="navigation-heading">{section}</span>
              {visibleNavigation.filter((item) => item.section === section).map((item) => (
                <button
                  type="button"
                  className={`navigation-link ${page === item.id ? 'is-active' : ''}`}
                  key={item.id}
                  onClick={() => setPage(item.id)}
                  aria-current={page === item.id ? 'page' : undefined}
                >
                  <span className="navigation-icon" aria-hidden="true">{item.icon}</span>
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-season"><span className="season-icon">✳</span><span><strong>Grow at your pace</strong><small>One season at a time.</small></span></div>
          <span className="sidebar-version">AGROSPHERE · FARM WORKSPACE</span>
        </div>
      </aside>
      <div className="workspace-main">
        <header className="workspace-header">
          <div className="workspace-breadcrumb"><span>Workspace</span><span aria-hidden="true">/</span><strong>{navigation.find((item) => item.id === page)?.label}</strong></div>
          <div className="workspace-user">
            <span className="user-avatar" aria-hidden="true">{user.name.trim().charAt(0).toUpperCase()}</span>
            <span className="user-name">{user.name}</span>
            <span className="header-divider" />
            <button className="text-button" type="button" onClick={onSignOut} disabled={isSigningOut}>{isSigningOut ? 'Signing out…' : 'Sign out'}</button>
          </div>
        </header>
        <main className="workspace-content">
          {signOutError && <div className="farm-alert" role="alert">{signOutError}</div>}
          <Suspense fallback={<div className="panel-placeholder" role="status">Loading workspace module…</div>}>
            {renderPage()}
          </Suspense>
          <footer className="farms-footer"><span>© {new Date().getFullYear()} AgroSphere</span><span>Built for the people who grow.</span></footer>
        </main>
      </div>
    </div>
  )
}

export default Workspace
