ALTER TABLE users
  ADD COLUMN IF NOT EXISTS role VARCHAR(16) NOT NULL DEFAULT 'farmer'
  CHECK (role IN ('farmer', 'admin'));

CREATE TABLE IF NOT EXISTS fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id UUID NOT NULL REFERENCES farms (id) ON DELETE CASCADE,
  field_name VARCHAR(100) NOT NULL,
  area NUMERIC(12, 2) NOT NULL CHECK (area > 0),
  area_unit VARCHAR(20) NOT NULL CHECK (area_unit IN ('hectares', 'acres', 'square_meters')),
  soil_type VARCHAR(80),
  status VARCHAR(16) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'fallow', 'planning', 'harvested')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (farm_id, field_name)
);

CREATE INDEX IF NOT EXISTS fields_farm_id_idx ON fields (farm_id);

CREATE TABLE IF NOT EXISTS crops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  field_id UUID NOT NULL REFERENCES fields (id) ON DELETE CASCADE,
  crop_name VARCHAR(100) NOT NULL,
  variety VARCHAR(100),
  planting_date DATE,
  expected_harvest_date DATE,
  growth_stage VARCHAR(24) NOT NULL DEFAULT 'planned'
    CHECK (growth_stage IN ('planned', 'seedling', 'vegetative', 'flowering', 'fruiting', 'maturing', 'harvested')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (expected_harvest_date IS NULL OR planting_date IS NULL OR expected_harvest_date >= planting_date)
);

CREATE INDEX IF NOT EXISTS crops_field_id_idx ON crops (field_id);

CREATE TABLE IF NOT EXISTS crop_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  crop_id UUID NOT NULL REFERENCES crops (id) ON DELETE CASCADE,
  record_type VARCHAR(32) NOT NULL
    CHECK (record_type IN ('created', 'stage_change', 'note', 'harvest')),
  details TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS crop_records_crop_id_recorded_at_idx
  ON crop_records (crop_id, recorded_at DESC);

CREATE TABLE IF NOT EXISTS weather_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id UUID NOT NULL REFERENCES farms (id) ON DELETE CASCADE,
  provider VARCHAR(40) NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  temperature_c NUMERIC(6, 2),
  humidity_percent NUMERIC(5, 2) CHECK (humidity_percent BETWEEN 0 AND 100),
  rainfall_mm NUMERIC(8, 2) CHECK (rainfall_mm >= 0),
  raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (farm_id, provider, observed_at)
);

CREATE INDEX IF NOT EXISTS weather_records_farm_observed_idx
  ON weather_records (farm_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS irrigation_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  field_id UUID NOT NULL REFERENCES fields (id) ON DELETE CASCADE,
  moisture_percent NUMERIC(5, 2) CHECK (moisture_percent BETWEEN 0 AND 100),
  moisture_source VARCHAR(20) NOT NULL DEFAULT 'manual'
    CHECK (moisture_source IN ('manual', 'simulator')),
  water_liters NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (water_liters >= 0),
  recommendation TEXT,
  notes TEXT,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS irrigation_records_field_recorded_idx
  ON irrigation_records (field_id, recorded_at DESC);

CREATE TABLE IF NOT EXISTS crop_health_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  crop_id UUID NOT NULL REFERENCES crops (id) ON DELETE CASCADE,
  image_path TEXT NOT NULL,
  provider VARCHAR(40) NOT NULL,
  status VARCHAR(24) NOT NULL
    CHECK (status IN ('pending', 'analyzed', 'unavailable', 'uncertain', 'failed')),
  disease_name VARCHAR(160),
  confidence NUMERIC(5, 4) CHECK (confidence BETWEEN 0 AND 1),
  result JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS health_analyses_crop_created_idx
  ON crop_health_analyses (crop_id, created_at DESC);

CREATE TABLE IF NOT EXISTS market_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  crop_id UUID NOT NULL REFERENCES crops (id) ON DELETE CASCADE,
  market_name VARCHAR(120) NOT NULL,
  price NUMERIC(12, 2) NOT NULL CHECK (price >= 0),
  currency CHAR(3) NOT NULL,
  unit VARCHAR(32) NOT NULL,
  source VARCHAR(24) NOT NULL DEFAULT 'user_reported'
    CHECK (source IN ('user_reported', 'provider')),
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS market_prices_crop_observed_idx
  ON market_prices (crop_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  notification_type VARCHAR(32) NOT NULL
    CHECK (notification_type IN ('weather', 'irrigation', 'crop_health', 'harvest', 'system')),
  title VARCHAR(160) NOT NULL,
  message TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS notifications_user_unread_created_idx
  ON notifications (user_id, read_at, created_at DESC);
