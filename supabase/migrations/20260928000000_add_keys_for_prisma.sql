-- Keys Prisma needs to address rows (api/prisma/postgres/schema.prisma):
--   customer_assignment: PRIMARY KEY (customer_name, store_number) — it had no key at all.
--   store_assignment:    open_store / closed_store NOT NULL, so uq_store_assignment_pair
--                        can act as its identifier.
-- Idempotent. Fails loudly (rather than deleting anything) if existing data has
-- duplicate customers per store or NULL store mappings — clean those up first.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM customer_assignment
        GROUP BY customer_name, store_number
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'customer_assignment has duplicate (customer_name, store_number) rows; dedupe before adding the primary key';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'customer_assignment'::regclass AND contype = 'p'
    ) THEN
        ALTER TABLE customer_assignment
            ADD CONSTRAINT customer_assignment_pkey PRIMARY KEY (customer_name, store_number);
    END IF;
END $$;

ALTER TABLE store_assignment ALTER COLUMN open_store   SET NOT NULL;
ALTER TABLE store_assignment ALTER COLUMN closed_store SET NOT NULL;
