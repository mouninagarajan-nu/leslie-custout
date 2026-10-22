// POSAPI probe — VPN only (posapi*.lesl.com isn't reachable off-network).
//
// Calls both operations the login route uses and prints the RAW SOAP request and
// response XML, so the guessed operation/parameter/result names in lib/posapi.js
// can be checked and fixtures captured. It also lists every operation the WSDL
// declares, which settles the names even if a call below fails.
//
// Usage (from api/):
//   node test-posapi.mjs <employeeId> [ipAddress]
// Env overrides:
//   POSAPI_WSDL_URL   WSDL to use (default: the dev POSAPI)
//   POSAPI_PROBE_IP   IP to look up when no ipAddress argument is given
//
// Example:
//   node test-posapi.mjs 12345 10.20.30.40

import soap from 'soap';

const WSDL_URL = process.env.POSAPI_WSDL_URL || 'https://posapidev.lesl.com/POSApiServices.asmx?WSDL';
const employeeId = process.argv[2];
const ipAddress = process.argv[3] || process.env.POSAPI_PROBE_IP || '127.0.0.1';

if (!employeeId) {
  console.error('Usage: node test-posapi.mjs <employeeId> [ipAddress]');
  process.exit(1);
}

// Same calls lib/posapi.js makes. Edit here if the WSDL says otherwise, then fix posapi.js.
const CALLS = [
  { op: 'checkPassword', args: { employeeId, password: '' } },
  { op: 'getStoreNumber', args: { IPAddress: ipAddress } }
];

console.log(`WSDL: ${WSDL_URL}`);
console.log(`Employee ID: ${employeeId}   IP: ${ipAddress}\n`);

let client;
try {
  client = await soap.createClientAsync(WSDL_URL);
} catch (err) {
  console.error('Could not load the WSDL (are you on VPN?):', err.message);
  process.exit(1);
}

console.log('── Operations declared by the WSDL ──');
console.log(JSON.stringify(client.describe(), null, 2));

for (const { op, args } of CALLS) {
  console.log(`\n── ${op}(${JSON.stringify(args)}) ──`);
  if (typeof client[`${op}Async`] !== 'function') {
    console.log(`The WSDL has no operation named "${op}". See the list above.`);
    continue;
  }
  try {
    const [result, rawResponse, , rawRequest] = await client[`${op}Async`](args);
    console.log('Raw request XML:\n' + rawRequest);
    console.log('\nRaw response XML:\n' + rawResponse);
    console.log('\nParsed result:\n' + JSON.stringify(result, null, 2));
  } catch (err) {
    console.log('Call failed:', err.message);
    if (err.body) console.log('Raw fault body:\n' + err.body);
  }
}
