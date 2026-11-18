import type { Farm } from './types'

type FarmCardProps = {
  farm: Farm
  isDeleting: boolean
  onView: () => void
  onEdit: () => void
  onDelete: () => void
}

function formatArea(area: number, unit: Farm['areaUnit']) {
  const label = {
    hectares: 'hectares',
    acres: 'acres',
    square_meters: 'm²',
  }[unit]
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(area)} ${label}`
}

function FarmCard({ farm, isDeleting, onView, onEdit, onDelete }: FarmCardProps) {
  return (
    <article className="farm-card">
      <div className="farm-card-art" aria-hidden="true">
        <span className="farm-card-art-badge">FARM</span>
        <svg viewBox="0 0 400 150" fill="none">
          <path d="M0 111c80-43 162-37 241-10 57 20 105 27 159 3v46H0v-39Z" fill="#75966e" />
          <path d="M0 129c75-33 153-24 220-3 72 22 116 22 180-4v28H0v-21Z" fill="#4e7856" />
          <path d="M-5 112c93-41 179-28 278 8M-5 126c89-33 165-20 247 3M5 140c62-18 126-13 185 0" stroke="#d7ddba" strokeOpacity=".75" strokeWidth="1.4" />
          <circle cx="326" cy="38" r="20" fill="#e7d99e" fillOpacity=".85" />
          <path d="M54 55v48m-8-29c2-13 17-17 17-17-1 14-7 20-17 20m1 9c-1-12-13-15-13-15 0 12 5 17 13 17" stroke="#e1e9cf" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </div>
      <div className="farm-card-content">
        <div className="farm-card-heading">
          <div>
            <h3>{farm.farmName}</h3>
            <p className="farm-location">
              <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M16 8.3c0 4.2-6 9.2-6 9.2S4 12.5 4 8.3a6 6 0 1 1 12 0Z" />
                <circle cx="10" cy="8" r="2" />
              </svg>
              {farm.location}
            </p>
          </div>
          <span className="farm-area">{formatArea(farm.totalArea, farm.areaUnit)}</span>
        </div>
        <div className="farm-card-meta">
          <span>
            <span className="meta-label">SOIL TYPE</span>
            <strong>{farm.soilType || 'Not specified'}</strong>
          </span>
          <span>
            <span className="meta-label">ADDED</span>
            <strong>
              {new Intl.DateTimeFormat(undefined, {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              }).format(new Date(farm.createdAt))}
            </strong>
          </span>
        </div>
        {farm.description && <p className="farm-description">{farm.description}</p>}
        <div className="farm-card-actions">
          <button className="secondary-button card-edit-button" type="button" onClick={onView}>
            View farm
          </button>
          <button className="secondary-button card-edit-button" type="button" onClick={onEdit}>
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="m12.8 4.2 3 3M4 16l3.3-.7 8.4-8.4a2.1 2.1 0 0 0-3-3l-8.4 8.4L4 16Z" />
            </svg>
            Edit details
          </button>
          <button
            className="danger-button"
            type="button"
            onClick={onDelete}
            disabled={isDeleting}
          >
            {isDeleting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </article>
  )
}

export default FarmCard
