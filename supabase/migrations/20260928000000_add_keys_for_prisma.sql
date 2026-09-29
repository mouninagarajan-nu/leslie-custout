-- Keys Prisma needs to address rows (api/prisma/postgres/schema.prisma):
--   customer_assignment: surrogate id PRIMARY KEY. It had no key, and
--                        (customer_name, store_number) can't be one: production has
--                        different customers sharing a name at the same store.
--                        Existing rows are numbered; nothing is removed.
--   store_assignment:    open_store / closed_store NOT NULL, so uq_store_assignment_pair
--                        can act as its identifier. Fails (changing nothing) if a
--                        mapping has a NULL store — fix that row first.
-- Idempotent.

ALTER TABLE customer_assignment ADD COLUMN IF NOT EXISTS id SERIAL PRIMARY KEY;

ALTER TABLE store_assignment ALTER COLUMN open_store   SET NOT NULL;
ALTER TABLE store_assignment ALTER COLUMN closed_store SET NOT NULL;
