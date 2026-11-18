import { useState, type FormEvent } from 'react'
import type { Farm, FarmInput } from './types'

type FarmFormProps = {
  farm?: Farm
  isSaving: boolean
  error: string
  onCancel: () => void
  onSave: (input: FarmInput) => void
}

function FarmForm({ farm, isSaving, error, onCancel, onSave }: FarmFormProps) {
  const [farmName, setFarmName] = useState(farm?.farmName ?? '')
  const [location, setLocation] = useState(farm?.location ?? '')
  const [totalArea, setTotalArea] = useState(
    farm ? String(farm.totalArea) : '',
  )
  const [areaUnit, setAreaUnit] = useState<FarmInput['areaUnit']>(
    farm?.areaUnit ?? 'hectares',
  )
  const [soilType, setSoilType] = useState(farm?.soilType ?? '')
  const [description, setDescription] = useState(farm?.description ?? '')

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onSave({
      farmName,
      location,
      totalArea: Number(totalArea),
      areaUnit,
      soilType: soilType.trim() || null,
      description: description.trim() || null,
    })
  }

  return (
    <div className="farm-modal-backdrop">
      <section
        className="farm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="farm-form-title"
      >
        <header className="farm-modal-header">
          <div>
            <span className="eyebrow">{farm ? 'UPDATE DETAILS' : 'NEW PROPERTY'}</span>
            <h2 id="farm-form-title">{farm ? 'Edit farm' : 'Add a farm'}</h2>
          </div>
          <button
            className="icon-button modal-close"
            type="button"
            onClick={onCancel}
            aria-label="Close form"
            disabled={isSaving}
          >
            ×
          </button>
        </header>
        <form className="farm-form" onSubmit={handleSubmit}>
          <label className="farm-field farm-field-wide">
            <span>Farm name</span>
            <input
              autoFocus
              required
              minLength={2}
              maxLength={100}
              value={farmName}
              onChange={(event) => setFarmName(event.target.value)}
              placeholder="e.g. Green Valley Farm"
            />
          </label>
          <label className="farm-field farm-field-wide">
            <span>Location</span>
            <input
              required
              minLength={2}
              maxLength={160}
              value={location}
              onChange={(event) => setLocation(event.target.value)}
              placeholder="Town, region or address"
            />
          </label>
          <label className="farm-field">
            <span>Total area</span>
            <input
              type="number"
              required
              min="0.01"
              max="9999999999.99"
              step="0.01"
              value={totalArea}
              onChange={(event) => setTotalArea(event.target.value)}
              placeholder="e.g. 42.5"
            />
          </label>
          <label className="farm-field">
            <span>Area unit</span>
            <select
              value={areaUnit}
              onChange={(event) =>
                setAreaUnit(event.target.value as FarmInput['areaUnit'])
              }
            >
              <option value="hectares">Hectares</option>
              <option value="acres">Acres</option>
              <option value="square_meters">Square meters</option>
            </select>
          </label>
          <label className="farm-field farm-field-wide">
            <span>Soil type <span className="optional-label">Optional</span></span>
            <input
              maxLength={80}
              value={soilType}
              onChange={(event) => setSoilType(event.target.value)}
              placeholder="e.g. Loam, clay, sandy"
            />
          </label>
          <label className="farm-field farm-field-wide">
            <span>Description <span className="optional-label">Optional</span></span>
            <textarea
              rows={3}
              maxLength={2000}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="A few notes about this property"
            />
          </label>
          {error && (
            <p className="form-error farm-form-error" role="alert">
              {error}
            </p>
          )}
          <footer className="farm-form-actions">
            <button
              className="secondary-button"
              type="button"
              onClick={onCancel}
              disabled={isSaving}
            >
              Cancel
            </button>
            <button className="primary-button farm-save-button" type="submit" disabled={isSaving}>
              {isSaving ? 'Saving…' : farm ? 'Save changes' : 'Add farm'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  )
}

export default FarmForm
