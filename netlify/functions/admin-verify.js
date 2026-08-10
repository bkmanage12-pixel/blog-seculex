/**
 * admin-verify.js — Server-side admin password verification
 *
 * POST body: { action: "verify", password: "..." }
 *   → Returns { success: true } or { error: "..." }
 *
 * POST body: { action: "save", hash: "...", salt: "..." }
 *   → Saves hash+salt to Netlify env vars via Netlify API
 *     Requires NETLIFY_ACCESS_TOKEN + NETLIFY_SITE_ID env vars
 *
 * POST body: { action: "check" }
 *   → Returns { configured: true/false } — is a password saved server-side?
 *
 * Environment variables required:
 *   ADMIN_PASSWORD_HASH  — PBKDF2 hex hash of master password
 *   ADMIN_PASSWORD_SALT  — hex salt used during hashing
 *   NETLIFY_ACCESS_TOKEN — personal token (for saving new hash)
 *   NETLIFY_SITE_ID      — site ID (for saving new hash)
 */

const crypto = require("crypto");

const ADMIN_EMAIL  = "seculexpublications@gmail.com";
const PBKDF2_ITER  = 100000;

// PBKDF2 hash using Node crypto (server-side, same params as browser SubtleCrypto)
function pbkdf2Hash(password, saltHex) {
  return new Promise((resolve, reject) => {
    const salt = Buffer.from(saltHex, "hex");
    crypto.pbkdf2(password, salt, PBKDF2_ITER, 32, "sha256", (err, derivedKey) => {
      if (err) return reject(err);
      resolve(derivedKey.toString("hex"));
    });
  });
}

exports.handler = async (event) => {
  const corsHeaders = {
    "content-type": "application/json",
    "cache-control": "no-store, no-cache",
    "x-content-type-options": "nosniff"
  };

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: "Method Not Allowed" }) };
  }

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "Invalid JSON" }) }; }

  const action = String(body.action || "").trim();

  // ── CHECK: Is a server-side password configured? ──────────────
  if (action === "check") {
    const configured = !!(process.env.ADMIN_PASSWORD_HASH && process.env.ADMIN_PASSWORD_SALT);
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ configured }) };
  }

  // ── VERIFY: Check password against env-var hash ───────────────
  if (action === "verify") {
    const password = String(body.password || "");
    const storedHash = process.env.ADMIN_PASSWORD_HASH || "";
    const storedSalt = process.env.ADMIN_PASSWORD_SALT || "";

    if (!storedHash || !storedSalt) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: "not_configured" })
      };
    }

    if (!password) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "Password required" }) };
    }

    try {
      const attempt = await pbkdf2Hash(password, storedSalt);
      // Constant-time comparison
      const valid = crypto.timingSafeEqual(
        Buffer.from(attempt,     "hex"),
        Buffer.from(storedHash,  "hex")
      );
      if (valid) {
        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true }) };
      } else {
        return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: "invalid_password" }) };
      }
    } catch (err) {
      console.error("[admin-verify] verify error:", err);
      return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: "Server error" }) };
    }
  }

  // ── SAVE: Store new hash+salt in Netlify env vars ────────────
  if (action === "save") {
    const hash = String(body.hash || "").trim();
    const salt = String(body.salt || "").trim();

    if (!hash || !salt || hash.length < 32 || salt.length < 16) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "Invalid hash/salt" }) };
    }

    const token  = process.env.NETLIFY_ACCESS_TOKEN;
    const siteId = process.env.NETLIFY_SITE_ID;

    if (!token || !siteId) {
      return {
        statusCode: 503,
        headers: corsHeaders,
        body: JSON.stringify({
          error: "env_not_set",
          message: "NETLIFY_ACCESS_TOKEN and NETLIFY_SITE_ID must be set in Netlify environment variables to enable cross-device password sync."
        })
      };
    }

    try {
      const apiUrl = `https://api.netlify.com/api/v1/sites/${siteId}/env`;
      const res = await fetch(apiUrl, {
        method: "PUT",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify([
          { key: "ADMIN_PASSWORD_HASH", values: [{ value: hash, context: "all" }] },
          { key: "ADMIN_PASSWORD_SALT", values: [{ value: salt, context: "all" }] }
        ])
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error("[admin-verify] Netlify API error:", errText);
        return { statusCode: 502, headers: corsHeaders, body: JSON.stringify({ error: "Netlify API error", detail: errText }) };
      }

      // Trigger a redeploy so the new env vars take effect immediately
      const deployRes = await fetch(`https://api.netlify.com/api/v1/sites/${siteId}/builds`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}` }
      });

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ success: true, rebuildTriggered: deployRes.ok })
      };
    } catch (err) {
      console.error("[admin-verify] save error:", err);
      return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: err.message }) };
    }
  }

  return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "Unknown action" }) };
};
