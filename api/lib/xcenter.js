import soap from 'soap';

/**
 * Validate an employee ID against Leslie's xCenter POS API.
 * The WSDL URL is configured via process.env.XCENTER_WSDL_URL.
 *
 * @param {string} employeeId
 * @returns {{ valid: boolean, firstName?: string, lastName?: string, error?: string }}
 */
export async function validateEmployee(employeeId) {
  if (process.env.XCENTER_ENABLED === 'false') {
    console.log('[xCenter] Disabled via XCENTER_ENABLED=false — skipping SOAP call');
    return { valid: true, firstName: '', lastName: '' };
  }

  const wsdlUrl = process.env.XCENTER_WSDL_URL;
  if (!wsdlUrl) {
    console.warn('[xCenter] XCENTER_WSDL_URL environment variable is not set — skipping SOAP call');
    return { valid: true, firstName: '', lastName: '' };
  }

  try {
    const client = await soap.createClientAsync(wsdlUrl);
    const [result] = await client.checkPasswordAsync({
      employeeId: String(employeeId).trim(),
      password: '',
    });

    const emp = result?.checkPasswordResult;
    if (!emp) {
      return { valid: false, error: 'No response from xCenter' };
    }

    const isValid =
      emp.PasswordValid === true ||
      String(emp.PasswordValid).toLowerCase() === 'true';

    if (!isValid) {
      return { valid: false };
    }

    return {
      valid: true,
      firstName: emp.FirstName || '',
      lastName: emp.LastName || '',
    };
  } catch (err) {
    console.error('[xCenter] SOAP call failed:', err?.message || err);
    return { valid: false, error: 'xCenter service unavailable' };
  }
}
