-- SYNTHETIC seed data for development/preview databases only. Never run on production.
-- Supabase Branching runs this automatically after migrations on each new branch.
-- Mirrors production's shape (open → closed store pairs, admin store 9999) with fake values.

INSERT INTO loc_rtl_loc
    (rtl_loc_id, store_nbr, store_name, address1, city, state, postal_code, country, telephone1, store_manager, email_addr)
VALUES
    ('LOC-215',  '215',  'Dev Store 215',  '100 Sample Ave',   'Phoenix',   'AZ', '85001', 'US', '555-0100', 'Dev Manager A', 'store215@example.com'),
    ('LOC-216',  '216',  'Dev Store 216',  '110 Sample Ave',   'Mesa',      'AZ', '85201', 'US', '555-0101', 'Dev Manager B', 'store216@example.com'),
    ('LOC-1330', '1330', 'Dev Store 1330', '120 Sample Ave',   'Tempe',     'AZ', '85281', 'US', '555-0102', 'Dev Manager C', 'store1330@example.com'),
    ('LOC-887',  '887',  'Dev Store 887',  '200 Example Blvd', 'Tampa',     'FL', '33601', 'US', '555-0103', 'Dev Manager D', 'store887@example.com'),
    ('LOC-888',  '888',  'Dev Store 888',  '210 Example Blvd', 'Clearwater','FL', '33755', 'US', '555-0104', 'Dev Manager E', 'store888@example.com'),
    ('LOC-997',  '997',  'Dev Store 997',  '300 Test St',      'Austin',    'TX', '73301', 'US', '555-0105', 'Dev Manager F', 'store997@example.com'),
    ('LOC-998',  '998',  'Dev Store 998',  '310 Test St',      'Round Rock','TX', '78664', 'US', '555-0106', 'Dev Manager G', 'store998@example.com')
ON CONFLICT (store_nbr) DO NOTHING;

INSERT INTO store_assignment (open_store, closed_store) VALUES
    ('888', '887'),
    ('998', '997'),
    ('216', '1330')
ON CONFLICT (open_store, closed_store) DO NOTHING;

-- Employees log in with Employee ID + their open store; admins use store 9999.
INSERT INTO employees (employee_id, store_number, employee_name) VALUES
    ('DEV001',   '888',  'Dev Employee One'),
    ('DEV002',   '888',  'Dev Employee Two'),
    ('DEV003',   '998',  'Dev Employee Three'),
    ('DEV004',   '216',  'Dev Employee Four'),
    ('ADMIN001', '9999', 'Dev Admin')
ON CONFLICT (employee_id) DO NOTHING;

-- 8 fake customers per closed store; a few pre-resolved so the dashboard has data.
-- customer_assignment has no unique key, so guard re-runs with NOT EXISTS.
INSERT INTO customer_assignment
    (store_number, customer_name, phone_number, contacted_to_store, attempted_to_store, do_not_attempt, notes)
SELECT s.store, format('Test Customer %s-%s', s.store, lpad(n::text, 2, '0')),
       format('555-%s', lpad((n + s.offset_)::text, 4, '0')),
       CASE WHEN n = 1 THEN 'Y' ELSE 'N' END,
       CASE WHEN n IN (1, 2) THEN 'Y' ELSE 'N' END,
       CASE WHEN n = 3 THEN 'Y' ELSE 'N' END,
       CASE WHEN n = 1 THEN 'Sample note: customer will visit the new store.' END
FROM (VALUES ('887', 1000), ('997', 2000), ('1330', 3000)) AS s(store, offset_)
CROSS JOIN generate_series(1, 8) AS n
WHERE NOT EXISTS (
    SELECT 1 FROM customer_assignment ca
    WHERE ca.store_number = s.store
      AND ca.customer_name = format('Test Customer %s-%s', s.store, lpad(n::text, 2, '0'))
);

-- Today's claims for the pre-resolved customers, so date-filtered views aren't empty.
INSERT INTO employee_daily_assignments (employee_id, customer_name, store_number)
SELECT e.employee_id, ca.customer_name, ca.store_number
FROM customer_assignment ca
JOIN store_assignment sa ON sa.closed_store = ca.store_number
JOIN LATERAL (
    SELECT employee_id FROM employees WHERE store_number = sa.open_store ORDER BY employee_id LIMIT 1
) e ON true
WHERE ca.customer_name LIKE 'Test Customer %'
  AND (ca.contacted_to_store = 'Y' OR ca.attempted_to_store = 'Y' OR ca.do_not_attempt = 'Y')
ON CONFLICT (customer_name, store_number, assigned_date) DO NOTHING;
