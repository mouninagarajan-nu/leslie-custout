// Imports a store feed CSV (e.g. store_feed.csv) into loc_rtl_loc.
//
//   node scripts/import-stores.js <path-to-csv>                     # dry run: parse + report only
//   TARGET_DATABASE_URL=... node scripts/import-stores.js <csv> --apply
//
// Only loc_rtl_loc columns are imported; everything else in the feed (bank account
// numbers, tax rates, coordinates, ...) is ignored. Rows are upserted on store_nbr,
// so re-running with a newer feed updates existing stores in place.
const fs = require('fs');
const { Client } = require('pg');

const COLUMNS = [
  'rtl_loc_id', 'store_nbr', 'store_name', 'address1', 'address2', 'address3', 'address4',
  'city', 'state', 'postal_code', 'country', 'neighborhood', 'county', 'telephone1',
  'store_manager', 'email_addr', 'record_state', 'create_date', 'update_date'
];
const BATCH_SIZE = 200;

// RFC 4180 parser: quoted fields, "" escapes, commas/newlines inside quotes.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((v) => v !== '')) rows.push(row);
  return rows;
}

function toRecords(rows) {
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const index = Object.fromEntries(header.map((h, i) => [h, i]));
  const missing = ['rtl_loc_id', 'store_nbr'].filter((c) => !(c in index));
  if (missing.length) throw new Error(`CSV is missing required columns: ${missing.join(', ')}`);

  const byStoreNbr = new Map();
  for (const r of rows.slice(1)) {
    const rec = {};
    for (const col of COLUMNS) {
      const v = col in index ? (r[index[col]] ?? '').trim() : '';
      rec[col] = v === '' ? null : v;
    }
    if (!rec.rtl_loc_id || !rec.store_nbr) continue;
    rec.record_state = rec.record_state || 'ACTIVE';
    byStoreNbr.set(rec.store_nbr, rec); // last row wins on duplicate store numbers
  }
  return [...byStoreNbr.values()];
}

async function main() {
  const [csvPath] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const apply = process.argv.includes('--apply');
  if (!csvPath) {
    console.error('Usage: node scripts/import-stores.js <path-to-csv> [--apply]');
    process.exit(1);
  }

  const records = toRecords(parseCsv(fs.readFileSync(csvPath, 'utf8')));
  console.log(`Parsed ${records.length} stores from ${csvPath}`);
  console.log('Sample:', records.slice(0, 2).map((r) => `${r.store_nbr} ${r.store_name} (${r.city}, ${r.state})`).join(' | '));

  if (!apply) {
    console.log('Dry run only. Re-run with TARGET_DATABASE_URL=... and --apply to write.');
    return;
  }
  const url = process.env.TARGET_DATABASE_URL;
  if (!url) {
    console.error('Set TARGET_DATABASE_URL to the database to import into.');
    process.exit(1);
  }

  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  const client = new Client({ connectionString: url, ssl: local ? undefined : { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query('BEGIN');
    const updates = COLUMNS.filter((c) => c !== 'store_nbr' && c !== 'create_date')
      .map((c) => `${c} = excluded.${c}`)
      .join(', ');
    let written = 0;
    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const batch = records.slice(i, i + BATCH_SIZE);
      const values = batch
        .map((_, r) => `(${COLUMNS.map((__, c) => `$${r * COLUMNS.length + c + 1}`).join(', ')})`)
        .join(', ');
      const params = batch.flatMap((rec) => COLUMNS.map((c) => rec[c]));
      const res = await client.query(
        `insert into loc_rtl_loc (${COLUMNS.join(', ')}) values ${values}
         on conflict (store_nbr) do update set ${updates}`,
        params
      );
      written += res.rowCount;
    }
    await client.query('COMMIT');
    const { rows } = await client.query('select count(*)::int as n from loc_rtl_loc');
    console.log(`Upserted ${written} rows. loc_rtl_loc now has ${rows[0].n} rows.`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`Failed: ${error.message}`);
  process.exit(1);
});
