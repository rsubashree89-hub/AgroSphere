import { useCallback, useEffect, useState } from 'react'
import { ApiError, request } from '../../lib/api'
import FarmCard from './FarmCard'
import FarmForm from './FarmForm'
import type { Farm, FarmInput } from './types'

function FarmsPage() {
  const [farms, setFarms] = useState<Farm[]>([])
  const [selectedFarm, setSelectedFarm] = useState<Farm | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [formFarm, setFormFarm] = useState<Farm | null | undefined>(undefined)
  const [formError, setFormError] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  function getLoadError(cause: unknown) {
    if (cause instanceof ApiError && cause.status === 401) {
      return 'Your session has expired. Sign in again to view your farms.'
    }
    return cause instanceof Error ? cause.message : 'Unable to load your farms.'
  }

  const loadFarms = useCallback(async () => {
    setLoadError('')
    try {
      const { farms: records } = await request<{ farms: Farm[] }>('/farms')
      setFarms(records)
    } catch (cause) {
      setLoadError(getLoadError(cause))
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    request<{ farms: Farm[] }>('/farms')
      .then(({ farms: records }) => {
        if (active) setFarms(records)
      })
      .catch((cause: unknown) => {
        if (active) setLoadError(getLoadError(cause))
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  function openCreateForm() {
    setFormError('')
    setFormFarm(null)
  }

  function openEditForm(farm: Farm) {
    setFormError('')
    setFormFarm(farm)
  }

  async function saveFarm(input: FarmInput) {
    setFormError('')
    setIsSaving(true)
    const farmToEdit = formFarm || null
    const isEditing = farmToEdit !== null
    const path = isEditing ? `/farms/${farmToEdit.id}` : '/farms'
    try {
      const result = await request<{ farm: Farm }>(path, {
        method: isEditing ? 'PUT' : 'POST',
        body: JSON.stringify(input),
      })
      setFarms((current) =>
        isEditing
          ? current.map((farm) => (farm.id === result.farm.id ? result.farm : farm))
          : [result.farm, ...current],
      )
      setFormFarm(undefined)
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'Unable to save this farm.')
    } finally {
      setIsSaving(false)
    }
  }

  async function deleteFarm(farm: Farm) {
    if (!window.confirm(`Delete "${farm.farmName}"? This action cannot be undone.`)) {
      return
    }
    setLoadError('')
    setDeletingId(farm.id)
    try {
      await request<{ message: string }>(`/farms/${farm.id}`, { method: 'DELETE' })
      setFarms((current) => current.filter((record) => record.id !== farm.id))
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : 'Unable to delete this farm.')
    } finally {
      setDeletingId(null)
    }
  }

  const totalAreaByUnit = farms.reduce<Record<Farm['areaUnit'], number>>(
    (totals, farm) => {
      totals[farm.areaUnit] += farm.totalArea
      return totals
    },
    { hectares: 0, acres: 0, square_meters: 0 },
  )
  const areaSummary = (Object.entries(totalAreaByUnit) as [
    Farm['areaUnit'],
    number,
  ][])
    .filter(([, area]) => area > 0)
    .map(([unit, area]) => {
      const label = { hectares: 'ha', acres: 'ac', square_meters: 'm²' }[unit]
      return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(area)} ${label}`
    })
    .join(' · ')

  return (
    <div className="farms-workspace">
      <div className="farms-content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Workspace</span>
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="m6 3 5 5-5 5" />
          </svg>
          <strong>My farms</strong>
        </nav>

        <section className="farms-hero">
          <div>
            <span className="eyebrow">YOUR LAND, IN ONE PLACE</span>
            <h1>My farms</h1>
            <p>Keep your farm properties organized and ready for the season ahead.</p>
          </div>
          <button className="primary-button add-farm-button" type="button" onClick={openCreateForm}>
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M10 4v12M4 10h12" />
            </svg>
            Add a farm
          </button>
        </section>

        <section className="farm-overview" aria-label="Farm overview">
          <div className="overview-card">
            <span className="overview-icon overview-icon-green" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M4 20V9l8-5 8 5v11H4Z" />
                <path d="M9 20v-6h6v6M8 10h.01M16 10h.01" />
              </svg>
            </span>
            <span className="overview-copy">
              <span>FARM PROPERTIES</span>
              <strong>{isLoading ? '—' : farms.length}</strong>
            </span>
          </div>
          <div className="overview-card">
            <span className="overview-icon overview-icon-sage" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M3 19c4-7 9-11 18-14M5 19c4-3 8-5 14-6M9 19l4-3" />
              </svg>
            </span>
            <span className="overview-copy">
              <span>REGISTERED LAND AREA</span>
              <strong>{isLoading ? '—' : areaSummary || '0'} <small>by unit</small></strong>
            </span>
          </div>
          <div className="overview-note">
            <span className="overview-note-dot" />
            <span>One connected view of the land you care for.</span>
          </div>
        </section>

        {loadError && (
          <div className="farm-alert" role="alert">
            <span>{loadError}</span>
            {loadError && (
              <button className="text-button" type="button" onClick={() => void loadFarms()}>
                Try again
              </button>
            )}
          </div>
        )}

        <section className="farm-list-section" aria-labelledby="farm-list-heading">
          <div className="farm-list-header">
            <div>
              <h2 id="farm-list-heading">Your properties</h2>
              <p>Farm details and land information</p>
            </div>
            {!isLoading && farms.length > 0 && (
              <span className="farm-count">{farms.length} {farms.length === 1 ? 'farm' : 'farms'}</span>
            )}
          </div>

          {isLoading ? (
            <div className="farms-loading" role="status" aria-live="polite">
              <span className="loading-spinner" />
              <span>Loading your farms…</span>
            </div>
          ) : loadError ? (
            <div className="farm-empty-state">
              <span className="empty-icon" aria-hidden="true">!</span>
              <h3>We couldn’t load your farms</h3>
              <p>Check your connection and try again.</p>
            </div>
          ) : farms.length === 0 ? (
            <div className="farm-empty-state">
              <span className="empty-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none">
                  <path d="M4 20V9l8-5 8 5v11H4ZM9 20v-6h6v6" />
                </svg>
              </span>
              <h3>Your farm portfolio starts here</h3>
              <p>Add your first property to keep its land, location and soil details together.</p>
              <button className="secondary-button" type="button" onClick={openCreateForm}>
                Add your first farm
              </button>
            </div>
          ) : (
            <div className="farm-grid">
              {farms.map((farm) => (
                <FarmCard
                  key={farm.id}
                  farm={farm}
                  isDeleting={deletingId === farm.id}
                  onView={() => setSelectedFarm(farm)}
                  onEdit={() => openEditForm(farm)}
                  onDelete={() => void deleteFarm(farm)}
                />
              ))}
            </div>
          )}
        </section>

        <footer className="farms-footer">
          <span>© {new Date().getFullYear()} AgroSphere</span>
          <span>Built for the people who grow.</span>
        </footer>
      </div>

      {formFarm !== undefined && (
        <FarmForm
          farm={formFarm ?? undefined}
          isSaving={isSaving}
          error={formError}
          onCancel={() => {
            if (!isSaving) setFormFarm(undefined)
          }}
          onSave={(input) => void saveFarm(input)}
        />
      )}
      {selectedFarm && (
        <div className="farm-modal-backdrop">
          <section className="farm-modal farm-detail-modal" aria-labelledby="farm-detail-title">
            <header className="farm-modal-header">
              <div>
                <span className="eyebrow">FARM DETAILS</span>
                <h2 id="farm-detail-title">{selectedFarm.farmName}</h2>
              </div>
              <button
                className="icon-button modal-close"
                type="button"
                onClick={() => setSelectedFarm(null)}
                aria-label="Close farm details"
              >
                ×
              </button>
            </header>
            <dl className="farm-detail-list">
              <div><dt>Location</dt><dd>{selectedFarm.location}</dd></div>
              <div><dt>Total area</dt><dd>{selectedFarm.totalArea} {selectedFarm.areaUnit.replace('_', ' ')}</dd></div>
              <div><dt>Soil type</dt><dd>{selectedFarm.soilType || 'Not specified'}</dd></div>
              <div><dt>Description</dt><dd>{selectedFarm.description || 'No description added.'}</dd></div>
              <div><dt>Created</dt><dd>{new Date(selectedFarm.createdAt).toLocaleString()}</dd></div>
              <div><dt>Last updated</dt><dd>{new Date(selectedFarm.updatedAt).toLocaleString()}</dd></div>
            </dl>
            <footer className="farm-form-actions">
              <button className="secondary-button" type="button" onClick={() => setSelectedFarm(null)}>Close</button>
              <button
                className="primary-button farm-save-button"
                type="button"
                onClick={() => {
                  setSelectedFarm(null)
                  openEditForm(selectedFarm)
                }}
              >
                Edit farm
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  )
}

export default FarmsPage
