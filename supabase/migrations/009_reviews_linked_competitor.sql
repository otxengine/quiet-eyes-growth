-- KAN-121: add linked_competitor column to reviews table
-- Null for own-business reviews; set for competitor review ingest
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS linked_competitor TEXT;
