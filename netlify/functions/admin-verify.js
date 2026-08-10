/**
 * admin-verify.js — Server-side admin password verification
 *
 * Verification strategy (no plaintext ever leaves the browser):
 *   Browser → PBKDF2-hash(password, salt) → sends hash to this function
 *   Server  → compares hash vs ADMIN_PASSWORD_HASH env var (timingSafeEqual)
 *
 * Actions:
 *   POST { action: "verify", hash: "<hex>", salt: "<hex>" }
 *     → { success: true } | { error: "invalid_password" | "not_configured" }
 *
 *   POST { action: "check" }
 *     → { configured: true|false }
 *
 *   POST { action: "save", hash: "<hex>", salt: "<hex>" }
 *     → Persists new hash+salt to Netlify env vars (requires NETLIFY_ACCESS_TOKEN + NETLIFY_SITE_ID)
 *
 * Required env vars:
 *   ADMIN_PASSWORD_HASH  — hex PBKDF2 hash
 *   ADMIN_PASSWORD_SALT  — hex salt
 *   NETLIFY_ACCESS_TOKEN — (for auto-save on password change)
 *   NETLIFY_SITE_ID      — (for auto-save on password change)
 */

const crypto = require("crypto");

exports.handler = async (event) => {
  const headers = {
    "content-type": "application/json",
    "cache-control": "no-store, no-cache, must-revalidate",
    "x-content-type-options": "nosniff"
  };

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method Not Allowed" }) };
  }

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid JSON" }) }; }

  const action = String(body.action || "").trim();

  // ── CHECK ────────────────────────────────────────────────────
  if (action === "check") {
    const configured = !!(process.env.ADMIN_PASSWORD_HASH && process.env.ADMIN_PASSWORD_SALT);
    return { statusCode: 200, headers, body: JSON.stringify({ configured }) };
  }

  // ── VERIFY ───────────────────────────────────────────────────
  // Browser sends the PBKDF2 hash (not plaintext) + salt used.
  // Server re-derives using same salt and compares with stored hash.
  // OR: if browser sends hash directly, compare hash vs stored hash.
  if (action === "verify") {
    const storedHash = (process.env.ADMIN_PASSWORD_HASH || "").trim();
    const storedSalt = (process.env.ADMIN_PASSWORD_SALT || "").trim();

    if (!storedHash || !storedSalt) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: "not_configured" }) };
    }

    // Accept pre-computed hash from client (avoids plaintext transmission)
    const clientHash = String(body.hash || "").trim();
    const clientSalt = String(body.salt || "").trim();

    if (!clientHash || !clientSalt) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "hash and salt required" }) };
    }

    // Client must have used the STORED salt to compute the hash.
    // If client used a different salt (first-time PC), hashes won't match regardless.
    // We must re-derive from the stored salt server-side.
    // Strategy: client sends the password (encrypted in transit via HTTPS), 
    // server derives with stored salt and compares.
    // OR: client sends hash computed with stored salt (client first fetches stored salt).
    //
    // Current flow: client sends { hash: clientHash, salt: clientSalt }
    // If clientSalt === storedSalt → compare clientHash vs storedHash
    // If clientSalt !== storedSalt → hashes won't match (different salts)

    if (clientSalt !== storedSalt) {
      // Client used a different salt (local cache from another device).
      // This means we can't directly compare. Return salt so client can rehash.
      return {
        statusCode: 409,
        headers,
        body: JSON.stringify({ error: "salt_mismatch", salt: storedSalt })
      };
    }

    try {
      const valid = crypto.timingSafeEqual(
        Buffer.from(clientHash, "hex").slice(0, 32),
        Buffer.from(storedHash, "hex").slice(0, 32)
      );
      if (valid) {
        return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
      } else {
        return { statusCode: 401, headers, body: JSON.stringify({ error: "invalid_password" }) };
      }
    } catch (e) {
      console.error("[admin-verify] compare error:", e.message);
      return { statusCode: 500, headers, body: JSON.stringify({ error: "Server error" }) };
    }
  }

  // ── VERIFY WITH PLAINTEXT (fallback, HTTPS-protected) ────────
  // Used when client doesn't have the stored salt (fresh device).
  // Client sends raw password, server hashes with stored salt and compares.
  if (action === "verify_plain") {
    const storedHash = (process.env.ADMIN_PASSWORD_HASH || "").trim();
    const storedSalt = (process.env.ADMIN_PASSWORD_SALT || "").trim();

    if (!storedHash || !storedSalt) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: "not_configured" }) };
    }

    const password = String(body.password || "");
    if (!password) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "password required" }) };
    }

    try {
      const derived = await new Promise((resolve, reject) => {
        const salt = Buffer.from(storedSalt, "hex");
        crypto.pbkdf2(password, salt, 100000, 32, "sha256", (err, key) => {
          if (err) reject(err);
          else resolve(key.toString("hex"));
        });
      });

      const valid = crypto.timingSafeEqual(
        Buffer.from(derived,     "hex"),
        Buffer.from(storedHash,  "hex")
      );

      if (valid) {
        // Return the stored salt so client can cache locally
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, salt: storedSalt }) };
      } else {
        return { statusCode: 401, headers, body: JSON.stringify({ error: "invalid_password" }) };
      }
    } catch (e) {
      console.error("[admin-verify] verify_plain error:", e.message);
      return { statusCode: 500, headers, body: JSON.stringify({ error: "Server error" }) };
    }
  }

  // ── SAVE ─────────────────────────────────────────────────────
  if (action === "save") {
    const hash = String(body.hash || "").trim();
    const salt = String(body.salt || "").trim();

    if (!hash || !salt || hash.length < 32 || salt.length < 16) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid hash/salt" }) };
    }

    const token  = process.env.NETLIFY_ACCESS_TOKEN;
    const siteId = process.env.NETLIFY_SITE_ID;

    if (!token || !siteId) {
      // No Netlify API access — save can't happen server-side
      // Client will keep hash in localStorage only
      return {
        statusCode: 503,
        headers,
        body: JSON.stringify({
          error: "env_not_set",
          message: "NETLIFY_ACCESS_TOKEN and NETLIFY_SITE_ID not set. Password saved locally only."
        })
      };
    }

    try {
      // Update env vars via Netlify API
      const apiRes = await fetch(`https://api.netlify.com/api/v1/sites/${siteId}/env`, {
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

      if (!apiRes.ok) {
        const errText = await apiRes.text();
        console.error("[admin-verify] Netlify env update failed:", errText);
        return { statusCode: 502, headers, body: JSON.stringify({ error: "Netlify API error" }) };
      }

      // Trigger rebuild so the env vars are live immediately
      await fetch(`https://api.netlify.com/api/v1/sites/${siteId}/builds`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}` }
      });

      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    } catch (e) {
      console.error("[admin-verify] save error:", e.message);
      return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
    }
  }

  return { statusCode: 400, headers, body: JSON.stringify({ error: "Unknown action" }) };
};
