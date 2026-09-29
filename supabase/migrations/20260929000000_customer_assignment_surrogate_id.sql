-- Converges any database that applied the FIRST version of
-- 20260928000000_add_keys_for_prisma.sql — PRIMARY KEY (customer_name, store_number),
-- pushed on the feature branch before production turned out to have customers sharing
-- a name at a store — to the surrogate id key. No-op where id is already the key.

DO $$
DECLARE
    pk_name text;
BEGIN
    SELECT c.conname INTO pk_name
    FROM pg_constraint c
    WHERE c.conrelid = 'customer_assignment'::regclass
      AND c.contype = 'p'
      AND NOT EXISTS (
          SELECT 1 FROM pg_attribute a
          WHERE a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey) AND a.attname = 'id'
      );

    IF pk_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE customer_assignment DROP CONSTRAINT %I', pk_name);
    END IF;
END $$;

ALTER TABLE customer_assignment ADD COLUMN IF NOT EXISTS id SERIAL PRIMARY KEY;
