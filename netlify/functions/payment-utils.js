const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function json(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, no-cache, must-revalidate",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "Content-Type, Authorization",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      ...headers,
    },
    body: JSON.stringify(body),
  };
}

function getSiteUrl(event) {
  const configured = process.env.SECULEX_BASE_URL || process.env.SITE_URL || process.env.URL;
  if (configured) return configured.replace(/\/$/, "");
  if (!event || !event.headers) return "https://seculex.org";
  const proto = event.headers["x-forwarded-proto"] || "https";
  const host = event.headers.host || "seculex.org";
  return `${proto}://${host}`;
}

/**
 * Generate unique, human-readable transaction reference in format:
 * SLX-YYYYMMDD-XXXXX (e.g. SLX-20260823-7A3F9)
 */
function generateTransactionReference() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  const dateStr = `${year}${month}${day}`;
  
  // 5 uppercase hex/alphanumeric characters using cryptographic random bytes
  const randomSuffix = crypto.randomBytes(3).toString("hex").toUpperCase().slice(0, 5);
  return `SLX-${dateStr}-${randomSuffix}`;
}

/**
 * Load the authoritative services catalog from services.json
 */
function getServicesCatalog() {
  const candidatePaths = [
    path.resolve(__dirname, "../../src/_data/services.json"),
    path.resolve(__dirname, "../src/_data/services.json"),
    path.resolve(process.cwd(), "src/_data/services.json"),
    path.resolve(__dirname, "_data/services.json"),
  ];

  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(p, "utf8"));
        if (parsed && Array.isArray(parsed.services)) {
          return parsed.services;
        }
      } catch (err) {
        console.error("Error loading services.json from", p, err);
      }
    }
  }

  // Authoritative fallback in case filesystem path is isolated inside Lambda
  return [
    {
      id: "legal-consultation",
      name: "Legal Consultation & Advisory",
      prices: { RWF: 50000, USD: 40, EUR: 38 },
      is_custom: false,
    },
    {
      id: "forensic-consultation",
      name: "Forensic & Digital Evidence Advisory",
      prices: { RWF: 75000, USD: 60, EUR: 55 },
      is_custom: false,
    },
    {
      id: "document-review",
      name: "Contract & Document Legal Review",
      prices: { RWF: 45000, USD: 35, EUR: 32 },
      is_custom: false,
    },
    {
      id: "research-services",
      name: "Specialized Legal & Policy Research",
      prices: { RWF: 100000, USD: 80, EUR: 75 },
      is_custom: false,
    },
    {
      id: "professional-consulting",
      name: "Law-Tech & Security Retainer",
      prices: { RWF: 150000, USD: 120, EUR: 110 },
      is_custom: false,
    },
    {
      id: "custom-invoice",
      name: "Custom Invoice / Retainer Fee",
      prices: { RWF: 0, USD: 0, EUR: 0 },
      is_custom: true,
    },
  ];
}

/**
 * Server-side price resolution and validation
 * NEVER trust client-submitted prices.
 */
function resolveServicePrice(serviceId, currency = "USD", customAmount = null, articlePrice = null) {
  const allowedCurrencies = ["USD", "RWF", "EUR"];
  const curr = String(currency || "USD").trim().toUpperCase();
  if (!allowedCurrencies.includes(curr)) {
    throw new Error(`Unsupported currency: '${currency}'. Allowed: ${allowedCurrencies.join(", ")}`);
  }

  const catalog = getServicesCatalog();
  const service = catalog.find((s) => s.id === serviceId);
  if (!service) {
    throw new Error(`Invalid service ID: '${serviceId}'. Service not found in catalog.`);
  }

  let finalAmount = 0;
  if (service.id === "article-download" && articlePrice !== null && articlePrice !== undefined) {
    const num = Number(articlePrice);
    if (!Number.isFinite(num) || num <= 0) {
      throw new Error("Invalid article download price provided.");
    }
    // Allow article prices between 0.50 USD (or 100 RWF) and 10,000 USD
    const minAmount = curr === "USD" ? 0.5 : (curr === "EUR" ? 0.5 : 100);
    const maxAmount = curr === "USD" ? 10000 : (curr === "EUR" ? 10000 : 10000000);
    if (num < minAmount || num > maxAmount) {
      throw new Error(`Article price must be between ${minAmount.toLocaleString()} and ${maxAmount.toLocaleString()} ${curr}.`);
    }
    finalAmount = (curr === "USD" || curr === "EUR") ? Number(num.toFixed(2)) : Math.round(num);
  } else if (service.is_custom) {
    const num = Number(customAmount);
    if (!Number.isFinite(num) || num <= 0) {
      throw new Error("A valid custom amount greater than 0 is required for this service.");
    }
    // Set reasonable bounds
    const minAmount = curr === "RWF" ? 5000 : 5;
    const maxAmount = curr === "RWF" ? 50000000 : 50000;
    if (num < minAmount || num > maxAmount) {
      throw new Error(`Custom amount must be between ${minAmount.toLocaleString()} and ${maxAmount.toLocaleString()} ${curr}.`);
    }
    finalAmount = curr === "RWF" ? Math.round(num) : Number(num.toFixed(2));
  } else {
    const definedPrice = service.prices && service.prices[curr];
    if (definedPrice === undefined || definedPrice <= 0) {
      throw new Error(`Price is not configured for service '${service.name}' in currency '${curr}'.`);
    }
    finalAmount = definedPrice;
  }

  return {
    serviceId: service.id,
    serviceName: service.name,
    amount: finalAmount,
    currency: curr,
    isCustom: Boolean(service.is_custom || (service.id === "article-download" && articlePrice !== null)),
  };
}

/**
 * Sanitize and validate customer input
 */
function validateCustomerInput(input) {
  const { name, email, phone, notes } = input || {};

  const cleanName = String(name || "").trim();
  if (!cleanName || cleanName.length < 2 || cleanName.length > 120) {
    throw new Error("Please provide a valid full name (2-120 characters).");
  }

  const cleanEmail = String(email || "").trim().toLowerCase();
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
  if (!cleanEmail || !emailRegex.test(cleanEmail)) {
    throw new Error("Please provide a valid email address.");
  }

  const cleanPhone = String(phone || "").trim().replace(/[^\d+()\-\s]/g, "");
  if (!cleanPhone || cleanPhone.length < 8 || cleanPhone.length > 25) {
    throw new Error("Please provide a valid phone number including country/area code.");
  }

  const cleanNotes = String(notes || "").trim().slice(0, 500);

  return {
    name: cleanName,
    email: cleanEmail,
    phone: cleanPhone,
    notes: cleanNotes,
  };
}

/**
 * HMAC signature for state tokens (to allow server-verified state without external database if needed)
 */
function signPaymentState(payload) {
  const secret = process.env.PAYMENT_SIGNING_SECRET || "seculex_default_signing_key_2026";
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${signature}`;
}

function verifyPaymentState(token) {
  const secret = process.env.PAYMENT_SIGNING_SECRET || "seculex_default_signing_key_2026";
  const [data, signature] = String(token || "").split(".");
  if (!data || !signature) return null;

  const expected = crypto.createHmac("sha256", secret).update(data).digest("base64url");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

module.exports = {
  json,
  getSiteUrl,
  generateTransactionReference,
  getServicesCatalog,
  resolveServicePrice,
  validateCustomerInput,
  signPaymentState,
  verifyPaymentState,
};
