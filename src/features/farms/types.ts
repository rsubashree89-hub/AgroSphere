export type AreaUnit = 'hectares' | 'acres' | 'square_meters'

export type Farm = {
  id: string
  farmName: string
  location: string
  totalArea: number
  areaUnit: AreaUnit
  soilType: string | null
  description: string | null
  createdAt: string
  updatedAt: string
}

export type FarmInput = {
  farmName: string
  location: string
  totalArea: number
  areaUnit: AreaUnit
  soilType: string | null
  description: string | null
}
