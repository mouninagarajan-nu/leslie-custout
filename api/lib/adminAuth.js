import crypto from 'crypto';

const TOKEN_TTL_SECONDS = 8 * 60 * 60;

// In production ADMIN_TOKEN_SECRET must be set (tokens must verify across
// instances). In dev, fall back to a random per-process secret cached on
// `global` so hot reload doesn't invalidate issued tokens.
function getSecret() {
  if (process.env.ADMIN_TOKEN_SECRET) return process.env.ADMIN_TOKEN_SECRET;
  if (process.env.NODE_ENV === 'production') return null;
  if (!global.__custoutAdminSecret) {
    console.warn('ADMIN_TOKEN_SECRET is not set; using a random dev-only secret.');
    global.__custoutAdminSecret = crypto.randomBytes(32).toString('hex');
  }
  return global.__custoutAdminSecret;
}

const sign = (data, secret) => crypto.createHmac('sha256', secret).update(data).digest('base64url');

// Returns a signed `payload.signature` token, or null if no secret is configured.
export function signAdminToken(employeeId) {
  const secret = getSecret();
  if (!secret) return null;
  const payload = Buffer.from(
    JSON.stringify({ sub: employeeId, role: 'admin', exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS })
  ).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

// Reads `Authorization: Bearer <token>`; returns the payload if valid, else null.
export function verifyAdminRequest(request) {
  const secret = getSecret();
  if (!secret) return null;
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;

  const expected = Buffer.from(sign(payload, secret));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (data.role !== 'admin' || !data.exp || data.exp < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch (_) {
    return null;
  }
}
