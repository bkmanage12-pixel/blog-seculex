const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const protectedRoot = path.resolve(__dirname, "../../protected_documents");

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
    body: JSON.stringify(body),
  };
}

function getPayPalBaseUrl() {
  return process.env.PAYPAL_ENV === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

function getSiteUrl(event) {
  const configured = process.env.SITE_URL || process.env.URL;
  if (configured) return configured.replace(/\/$/, "");
  const proto = event.headers["x-forwarded-proto"] || "https";
  const host = event.headers.host;
  return `${proto}://${host}`;
}

function safeDocumentId(raw) {
  const id = String(raw || "").trim();
  if (!/^[a-zA-Z0-9._-]+\.pdf$/i.test(id)) {
    throw new Error("Invalid document id.");
  }
  return id;
}

function documentPath(documentId) {
  const safeId = safeDocumentId(documentId);
  const resolved = path.resolve(protectedRoot, safeId);
  if (!resolved.startsWith(protectedRoot + path.sep)) {
    throw new Error("Invalid document path.");
  }
  if (!fs.existsSync(resolved)) {
    throw new Error("Protected document not found.");
  }
  return resolved;
}

function moneyValue(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error("Invalid payment amount.");
  }
  return numeric.toFixed(2);
}

async function getPayPalAccessToken() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !secret) {
    throw new Error("PayPal credentials are not configured.");
  }

  const auth = Buffer.from(`${clientId}:${secret}`).toString("base64");
  const response = await fetch(`${getPayPalBaseUrl()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      authorization: `Basic ${auth}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  const data = await response.json();
  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description || "Could not authenticate with PayPal.");
  }
  return data.access_token;
}

function signDownloadToken(payload) {
  const secret = process.env.PAYWALL_DOWNLOAD_SECRET;
  if (!secret) {
    throw new Error("PAYWALL_DOWNLOAD_SECRET is not configured.");
  }
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", secret)
    .update(encoded)
    .digest("base64url");
  return `${encoded}.${signature}`;
}

function verifyDownloadToken(token) {
  const secret = process.env.PAYWALL_DOWNLOAD_SECRET;
  if (!secret) {
    throw new Error("PAYWALL_DOWNLOAD_SECRET is not configured.");
  }
  const [encoded, signature] = String(token || "").split(".");
  if (!encoded || !signature) {
    throw new Error("Invalid download token.");
  }
  const expected = crypto
    .createHmac("sha256", secret)
    .update(encoded)
    .digest("base64url");

  const given = Buffer.from(signature);
  const wanted = Buffer.from(expected);
  if (given.length !== wanted.length || !crypto.timingSafeEqual(given, wanted)) {
    throw new Error("Invalid download token.");
  }

  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  if (!payload.exp || Date.now() > payload.exp) {
    throw new Error("Download token has expired.");
  }
  return payload;
}

function isDemoMode() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  return !clientId || clientId.trim() === "demo";
}

function isFlutterwaveDemoMode() {
  const secretKey = process.env.FLUTTERWAVE_SECRET_KEY;
  return !secretKey || secretKey.trim() === "demo";
}

function isDocumentFree(documentId) {
  try {
    const manifestPath = path.join(protectedRoot, "paywall_manifest.json");
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      if (manifest.paywallEnabled === false) {
        return true;
      }
      return Array.isArray(manifest.freeDocuments) && manifest.freeDocuments.includes(documentId);
    }
  } catch (err) {
    console.error("Error reading paywall manifest:", err);
  }
  return false;
}

module.exports = {
  documentPath,
  getPayPalAccessToken,
  getPayPalBaseUrl,
  getSiteUrl,
  json,
  moneyValue,
  safeDocumentId,
  signDownloadToken,
  verifyDownloadToken,
  isDemoMode,
  isFlutterwaveDemoMode,
  isDocumentFree,
};
