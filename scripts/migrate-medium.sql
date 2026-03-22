-- Medium 6: Persona Voice Settings
ALTER TABLE blogs ADD COLUMN IF NOT EXISTS voice JSONB;
