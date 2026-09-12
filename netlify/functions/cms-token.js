/**
 * cms-token.js — Securely returns the GitHub PAT for CMS authentication
 *
 * Called by admin-auth.js after successful PBKDF2 admin login.
 * Returns the CMS_GITHUB_TOKEN env var only if the request includes
 * the correct ADMIN_FUNCTION_SECRET header.
 *
 * The token is then used by Decap CMS github backend (implicit flow)
 * to commit directly to GitHub — bypassing Netlify Identity + Git Gateway.
 */

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'x-admin-secret, Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: cors, body: '' };
  }

  const incoming = (event.headers['x-admin-secret'] || '').trim();
  const expected = (process.env.ADMIN_FUNCTION_SECRET || 'seculex_admin_secret_98a7b6c5d4e3f2a1_prod').trim();

  // Constant-time comparison to prevent timing attacks
  const crypto = require('crypto');
  let valid = false;
  try {
    valid = incoming.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(incoming), Buffer.from(expected));
  } catch (_) {
    valid = false;
  }

  if (!valid) {
    return {
      statusCode: 401,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'unauthorized' }),
    };
  }

  const token = (process.env.CMS_GITHUB_TOKEN || '').trim();
  if (!token) {
    return {
      statusCode: 503,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'token_not_configured' }),
    };
  }

  return {
    statusCode: 200,
    headers: {
      ...cors,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store, no-cache',
      'Pragma': 'no-cache',
    },
    body: JSON.stringify({ token }),
  };
};
