import soap from 'soap';

/**
 * Leslie's POSAPI SOAP client — the same service Water Test uses for login.
 *
 * checkEmployee(employeeId)
 *   Calls checkPassword with an empty password. POSAPI checks the pair against
 *   LPM_XCENTER_HYBRID.dbo.hrs_employee_password; we ignore PasswordValid and only
 *   use the response to confirm the employee ID exists.
 *
 * getStoreByIp(ipAddress)
 *   Calls getStoreNumber with the client IP. POSAPI looks it up in
 *   fillableforms.dbo.storeRegister (SQLPROD01) and returns the store details.
 *
 * POSAPI_ENABLED=false skips both calls (off-VPN local dev).
 */

/** @returns {boolean} */
function isEnabled() {
  return process.env.POSAPI_ENABLED !== 'false' && process.env.XCENTER_ENABLED !== 'false';
}

/** @returns {string | undefined} XCENTER_WSDL_URL is the pre-rename name, still honoured. */
function wsdlUrl() {
  return process.env.POSAPI_WSDL_URL || process.env.XCENTER_WSDL_URL;
}

/** Store to use when the IP can't be resolved. Unset (the default) means reject the login. */
function defaultStore() {
  return process.env.POSAPI_DEFAULT_STORE?.trim() || null;
}

// Parsing the WSDL is the slow part of a SOAP call; reuse the client across requests.
let clientPromise = null;
function getClient(url) {
  if (!clientPromise) {
    clientPromise = soap.createClientAsync(url).catch((err) => {
      clientPromise = null;
      throw err;
    });
  }
  return clientPromise;
}

/**
 * @param {string} employeeId
 * @returns {Promise<{ valid: boolean, skipped?: boolean, firstName?: string, lastName?: string, error?: string }>}
 *   `skipped` means POSAPI wasn't consulted, so the caller must verify the ID some other way.
 */
export async function checkEmployee(employeeId) {
  const url = wsdlUrl();
  if (!isEnabled() || !url) {
    console.warn('[posapi] POSAPI disabled or POSAPI_WSDL_URL unset — skipping employee check');
    return { valid: false, skipped: true };
  }

  try {
    const client = await getClient(url);
    const [result] = await client.checkPasswordAsync({
      employeeId: String(employeeId).trim(),
      password: ''
    });

    const emp = result?.checkPasswordResult;
    // An unknown employee comes back with no name/ID; PasswordValid is irrelevant here.
    // TODO(VPN): unconfirmed. Check what checkPassword returns for an ID that doesn't
    // exist (empty names vs. a SOAP fault) with api/test-posapi.mjs.
    if (!emp || !(emp.FirstName || emp.LastName || emp.EmployeeId)) {
      return { valid: false };
    }
    return { valid: true, firstName: emp.FirstName || '', lastName: emp.LastName || '' };
  } catch (err) {
    console.error('[posapi] checkEmployee failed:', err?.message || err);
    return { valid: false, skipped: true, error: 'POSAPI service unavailable' };
  }
}

/**
 * Pulls a store number out of the getStoreNumber result, whether parsed or raw XML.
 * TODO(VPN): the field names below are guesses. Confirm the result element and the
 * store-number field against the WSDL (run api/test-posapi.mjs) and narrow this.
 */
function extractStoreNumber(data) {
  if (data == null) return null;
  if (typeof data === 'string' || typeof data === 'number') {
    const text = String(data).trim();
    if (/^\d+$/.test(text)) return text;
    const match = text.match(/<(StoreNumber|StoreNbr|Store_Nbr|store_number|Store)>\s*(\d+)\s*</i);
    return match ? match[2] : null;
  }
  const value =
    data.StoreNumber ?? data.storeNumber ?? data.StoreNbr ?? data.store_nbr ?? data.store_number ?? data.Store;
  return value != null && String(value).trim() ? String(value).trim() : null;
}

/** True when POSAPI sent back nothing, i.e. the IP isn't in storeRegister. */
function isEmptyResult(data) {
  if (data == null) return true;
  if (typeof data === 'string') return data.trim() === '';
  return typeof data === 'object' && Object.keys(data).length === 0;
}

/**
 * @param {string} ipAddress
 * @returns {Promise<{ storeNumber: string } | { storeNumber: null, reason: 'not_found' | 'unavailable' }>}
 *   'not_found': POSAPI answered and the IP isn't registered to a store.
 *   'unavailable': POSAPI is off, unreachable, or answered in a shape we can't read.
 *   POSAPI_DEFAULT_STORE, when set, replaces either failure (dev only).
 */
export async function getStoreByIp(ipAddress) {
  const fail = (reason) => (defaultStore() ? { storeNumber: defaultStore() } : { storeNumber: null, reason });

  const url = wsdlUrl();
  if (!isEnabled() || !url) {
    console.warn('[posapi] POSAPI disabled or POSAPI_WSDL_URL unset — store lookup skipped');
    return fail('unavailable');
  }

  try {
    const client = await getClient(url);
    // TODO(VPN): operation name `getStoreNumber`, input `IPAddress` and result element
    // `getStoreNumberResult` are unconfirmed guesses. Verify with api/test-posapi.mjs.
    const [result] = await client.getStoreNumberAsync({ IPAddress: ipAddress });
    const data = result?.getStoreNumberResult;

    const storeNumber = extractStoreNumber(data);
    if (storeNumber) return { storeNumber };
    if (isEmptyResult(data)) return fail('not_found');

    // A non-empty answer we can't parse is a contract problem, not an unknown IP.
    console.error('[posapi] Unrecognised getStoreNumber result:', JSON.stringify(data));
    return fail('unavailable');
  } catch (err) {
    console.error('[posapi] getStoreByIp failed:', err?.message || err);
    return fail('unavailable');
  }
}
