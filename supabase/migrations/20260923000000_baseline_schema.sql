-- Baseline schema for the Leslie's Customer Connect & Support app.
-- Mirrors the production schema as of 2026-09-23 (introspected, schema only).
-- Idempotent (IF NOT EXISTS everywhere), so it's safe on a database that already
-- has these objects — e.g. production, if Supabase Branching is linked to `main`.

-- ── Customers to contact, per closed store ───────────────────────────────
CREATE TABLE IF NOT EXISTS customer_assignment (
    store_number       VARCHAR(20)  NOT NULL,
    customer_name      VARCHAR(200) NOT NULL,
    phone_number       VARCHAR(30),
    contacted_to_store CHAR(1)      NOT NULL DEFAULT 'N'
        CONSTRAINT customer_assignment_contacted_to_store_check CHECK (contacted_to_store IN ('Y', 'N')),
    attempted_to_store CHAR(1)      NOT NULL DEFAULT 'N'
        CONSTRAINT customer_assignment_attempted_to_store_check CHECK (attempted_to_store IN ('Y', 'N')),
    updated_timestamp  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    do_not_attempt     CHAR(1)      DEFAULT 'N',
    notes              TEXT
);

-- ── Open store → closed store mapping ────────────────────────────────────
CREATE TABLE IF NOT EXISTS store_assignment (
    open_store        VARCHAR(50),
    closed_store      VARCHAR(50),
    updated_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_store_assignment_pair UNIQUE (open_store, closed_store)
);

-- ── Employees (store_number 9999 = admin) ────────────────────────────────
CREATE TABLE IF NOT EXISTS employees (
    employee_id   VARCHAR(50)  PRIMARY KEY,
    store_number  VARCHAR(20)  NOT NULL,
    employee_name VARCHAR(200),
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── Per-employee daily customer claims ───────────────────────────────────
CREATE TABLE IF NOT EXISTS employee_daily_assignments (
    id            SERIAL       PRIMARY KEY,
    employee_id   VARCHAR(50)  NOT NULL,
    customer_name VARCHAR(200) NOT NULL,
    store_number  VARCHAR(20)  NOT NULL,
    assigned_date DATE         NOT NULL DEFAULT CURRENT_DATE,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    -- Stops two employees claiming the same customer on the same day.
    CONSTRAINT uq_customer_per_day UNIQUE (customer_name, store_number, assigned_date)
);

CREATE INDEX IF NOT EXISTS idx_eda_employee_date
    ON employee_daily_assignments (employee_id, assigned_date);
CREATE INDEX IF NOT EXISTS idx_eda_assigned_date
    ON employee_daily_assignments (assigned_date, store_number, customer_name);

-- ── Store location reference ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS loc_rtl_loc (
    rtl_loc_id    VARCHAR(50) PRIMARY KEY,
    store_nbr     VARCHAR(50) NOT NULL UNIQUE,
    store_name    VARCHAR(100),
    address1      VARCHAR(150),
    address2      VARCHAR(150),
    address3      VARCHAR(150),
    address4      VARCHAR(150),
    city          VARCHAR(100),
    state         VARCHAR(50),
    postal_code   VARCHAR(20),
    country       VARCHAR(50),
    neighborhood  VARCHAR(100),
    county        VARCHAR(100),
    telephone1    VARCHAR(20),
    store_manager VARCHAR(100),
    email_addr    VARCHAR(100),
    record_state  VARCHAR(20) DEFAULT 'ACTIVE',
    create_date   TIMESTAMP DEFAULT NOW(),
    update_date   TIMESTAMP DEFAULT NOW()
);
