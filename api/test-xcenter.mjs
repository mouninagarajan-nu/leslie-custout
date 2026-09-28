// Quick test for xCenter SOAP employee validation
// Usage: node test-xcenter.mjs <employeeId>
// Example: node test-xcenter.mjs 12345

import soap from 'soap';

const WSDL_URL = 'https://posapidev.lesl.com/POSApiServices.asmx?WSDL';
const employeeId = process.argv[2];

if (!employeeId) {
    console.error('Usage: node test-xcenter.mjs <employeeId>');
    process.exit(1);
}

console.log(`Testing xCenter with Employee ID: ${employeeId}`);
console.log(`WSDL: ${WSDL_URL}\n`);

try {
    const client = await soap.createClientAsync(WSDL_URL);
    console.log('✅ Connected to xCenter SOAP service');

    const [result] = await client.checkPasswordAsync({ employeeId, password: '' });
    const emp = result?.checkPasswordResult;

    console.log('\nRaw response:', JSON.stringify(emp, null, 2));

    if (emp?.PasswordValid === true || String(emp?.PasswordValid).toLowerCase() === 'true') {
        console.log(`\n✅ Employee VALID: ${emp.FirstName} ${emp.LastName}`);
    } else {
        console.log(`\n❌ Employee NOT found or inactive`);
    }
} catch (err) {
    console.error('\n❌ SOAP call failed:', err.message);
}
