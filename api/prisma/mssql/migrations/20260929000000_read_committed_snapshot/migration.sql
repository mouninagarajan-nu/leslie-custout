-- Make READ COMMITTED use row versioning (Postgres-style MVCC): readers see the last
-- committed data instead of waiting on other transactions' uncommitted writes.
-- Without this, concurrent customer-contacts requests block each other's
-- "unclaimed customers" read until they deadlock or time out. On by default in Azure SQL.
-- ROLLBACK IMMEDIATE: the switch needs the database to itself, so open sessions are dropped.
ALTER DATABASE CURRENT SET READ_COMMITTED_SNAPSHOT ON WITH ROLLBACK IMMEDIATE;
