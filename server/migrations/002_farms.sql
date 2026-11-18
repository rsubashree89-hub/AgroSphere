CREATE TABLE IF NOT EXISTS farms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  farm_name VARCHAR(100) NOT NULL,
  location VARCHAR(160) NOT NULL,
  total_area NUMERIC(12, 2) NOT NULL CHECK (total_area > 0),
  area_unit VARCHAR(20) NOT NULL CHECK (area_unit IN ('hectares', 'acres', 'square_meters')),
  soil_type VARCHAR(80),
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS farms_user_id_created_at_idx
  ON farms (user_id, created_at DESC);
