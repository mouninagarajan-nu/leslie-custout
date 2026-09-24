const fs = require('fs');
const { Client } = require('pg');

// Load api/.env manually
const env = Object.fromEntries(
    fs.readFileSync('api/.env', 'utf8')
        .split('\n')
        .filter(l => l.includes('=') && !l.trim().startsWith('#'))
        .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const c = new Client({ connectionString: env.DATABASE_URL });
c.connect()
    .then(() => c.query(`ALTER TABLE loc_rtl_loc RENAME TO store_details`))
    .then(() => console.log('Success: loc_rtl_loc renamed to store_details'))
    .catch(e => {
        if (e.code === '42P01') console.log('Table loc_rtl_loc does not exist — already renamed or not created yet.');
        else if (e.code === '42P07') console.log('Table store_details already exists — rename skipped.');
        else console.error('Error:', e.message);
    })
    .finally(() => c.end());
