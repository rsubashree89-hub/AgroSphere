ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS event_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS notifications_user_event_key_idx
  ON notifications (user_id, event_key)
  WHERE event_key IS NOT NULL;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS admin_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES users (id) ON DELETE SET NULL,
  target_user_id UUID REFERENCES users (id) ON DELETE SET NULL,
  action VARCHAR(64) NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS admin_audit_events_created_at_idx
  ON admin_audit_events (created_at DESC);

CREATE OR REPLACE FUNCTION generate_harvest_reminders(target_user_id UUID DEFAULT NULL)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  inserted_count INTEGER;
BEGIN
  INSERT INTO notifications (user_id, notification_type, title, message, event_key)
  SELECT farms.user_id,
         'harvest',
         'Harvest window approaching',
         format('%s is expected to be ready on %s. Check field conditions and plan harvest activities.',
                crops.crop_name, crops.expected_harvest_date),
         format('harvest:%s:%s', crops.id, crops.expected_harvest_date)
  FROM crops
  JOIN fields ON fields.id = crops.field_id
  JOIN farms ON farms.id = fields.farm_id
  WHERE crops.growth_stage <> 'harvested'
    AND crops.expected_harvest_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 7
    AND (target_user_id IS NULL OR farms.user_id = target_user_id)
  ON CONFLICT (user_id, event_key) WHERE event_key IS NOT NULL DO NOTHING;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count;
END;
$$;

CREATE OR REPLACE FUNCTION notify_harvest_window()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  owner_id UUID;
  reminder_key TEXT;
BEGIN
  SELECT farms.user_id INTO owner_id
  FROM fields
  JOIN farms ON farms.id = fields.farm_id
  WHERE fields.id = NEW.field_id;

  IF NEW.growth_stage = 'harvested'
     OR NEW.expected_harvest_date IS NULL
     OR NEW.expected_harvest_date < CURRENT_DATE
     OR NEW.expected_harvest_date > CURRENT_DATE + 7 THEN
    UPDATE notifications
    SET read_at = COALESCE(read_at, NOW())
    WHERE user_id = owner_id
      AND event_key LIKE format('harvest:%s:%%', NEW.id);
    RETURN NEW;
  END IF;

  reminder_key := format('harvest:%s:%s', NEW.id, NEW.expected_harvest_date);
  UPDATE notifications
  SET read_at = COALESCE(read_at, NOW())
  WHERE user_id = owner_id
    AND event_key LIKE format('harvest:%s:%%', NEW.id)
    AND event_key <> reminder_key;

  INSERT INTO notifications (user_id, notification_type, title, message, event_key)
  VALUES (
    owner_id,
    'harvest',
    'Harvest window approaching',
    format('%s is expected to be ready on %s. Check field conditions and plan harvest activities.',
           NEW.crop_name, NEW.expected_harvest_date),
    reminder_key
  )
  ON CONFLICT (user_id, event_key) WHERE event_key IS NOT NULL DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS crops_harvest_notification ON crops;
CREATE TRIGGER crops_harvest_notification
AFTER INSERT OR UPDATE OF field_id, crop_name, expected_harvest_date, growth_stage
ON crops
FOR EACH ROW
EXECUTE FUNCTION notify_harvest_window();

CREATE OR REPLACE FUNCTION notify_low_moisture()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.moisture_percent IS NOT NULL AND NEW.moisture_percent < 30 THEN
    INSERT INTO notifications (user_id, notification_type, title, message, event_key)
    SELECT farms.user_id,
           'irrigation',
           'Low soil-moisture reading',
           format('%s recorded %s%% moisture. Inspect the field and decide whether irrigation is needed.',
                  fields.field_name, to_char(NEW.moisture_percent, 'FM990.0')),
           format('irrigation:%s', NEW.id)
    FROM fields
    JOIN farms ON farms.id = fields.farm_id
    WHERE fields.id = NEW.field_id
    ON CONFLICT (user_id, event_key) WHERE event_key IS NOT NULL DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS irrigation_low_moisture_notification ON irrigation_records;
CREATE TRIGGER irrigation_low_moisture_notification
AFTER INSERT ON irrigation_records
FOR EACH ROW
EXECUTE FUNCTION notify_low_moisture();

CREATE OR REPLACE FUNCTION notify_crop_health_result()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IN ('analyzed', 'uncertain')
     AND (NEW.disease_name IS NOT NULL OR NEW.status = 'uncertain') THEN
    INSERT INTO notifications (user_id, notification_type, title, message, event_key)
    SELECT farms.user_id,
           'crop_health',
           CASE WHEN NEW.disease_name IS NULL
             THEN 'Crop health result needs review'
             ELSE 'Crop health finding available'
           END,
           CASE WHEN NEW.disease_name IS NULL
             THEN 'An image analysis could not identify a definite condition. Review the result with a qualified agronomist.'
             ELSE format('An image analysis reported "%s". Verify the result before taking action.', NEW.disease_name)
           END,
           format('crop-health:%s', NEW.id)
    FROM crops
    JOIN fields ON fields.id = crops.field_id
    JOIN farms ON farms.id = fields.farm_id
    WHERE crops.id = NEW.crop_id
    ON CONFLICT (user_id, event_key) WHERE event_key IS NOT NULL DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS crop_health_result_notification ON crop_health_analyses;
CREATE TRIGGER crop_health_result_notification
AFTER INSERT ON crop_health_analyses
FOR EACH ROW
EXECUTE FUNCTION notify_crop_health_result();

CREATE OR REPLACE FUNCTION notify_severe_weather()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  weather_condition TEXT := NEW.raw_data->>'condition';
BEGIN
  IF COALESCE(NEW.rainfall_mm, 0) >= 20 OR weather_condition = 'Thunderstorm' THEN
    INSERT INTO notifications (user_id, notification_type, title, message, event_key)
    SELECT farms.user_id,
           'weather',
           'Severe weather observation',
           format('%s reported %s and %s mm of current rainfall. Check local conditions and protect exposed crops as appropriate.',
                  farms.farm_name, COALESCE(weather_condition, 'heavy rainfall'),
                  to_char(COALESCE(NEW.rainfall_mm, 0), 'FM999999990.0')),
           format('weather:%s:%s', NEW.farm_id, NEW.observed_at::date)
    FROM farms
    WHERE farms.id = NEW.farm_id
    ON CONFLICT (user_id, event_key) WHERE event_key IS NOT NULL DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS weather_severe_notification ON weather_records;
CREATE TRIGGER weather_severe_notification
AFTER INSERT ON weather_records
FOR EACH ROW
EXECUTE FUNCTION notify_severe_weather();
