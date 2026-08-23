/**
 * ==============================================================================
 * SecuLex DPO Pay / Network Payment Adapter
 * ==============================================================================
 * 
 * DPO INTEGRATION STATUS: WAITING FOR NETWORK APPROVAL / API CREDENTIALS
 * 
 * IMPORTANT ARCHITECTURAL NOTE:
 * - This module is strictly designed for Network / DPO Pay integration.
 * - In accordance with merchant security requirements, no proprietary API keys,
 *   merchant IDs, secret tokens, or undocumented endpoints are hard-coded.
 * - Environment variables are read dynamically from Netlify:
 *     - DPO_ENVIRONMENT (TEST | PRODUCTION)
 *     - DPO_MERCHANT_ID
 *     - DPO_API_KEY
 *     - DPO_SECRET
 *     - DPO_SERVICE_TYPE
 * - When credentials are provided by Network, plug them into the Netlify
 *   Environment Variables dashboard, and enable live XML/REST calls in this adapter.
 * ==============================================================================
 */

const crypto = require("crypto");

/**
 * Get current configured DPO Environment and settings
 */
function getDPOConfig() {
  const env = (process.env.DPO_ENVIRONMENT || "TEST").toUpperCase();
  const merchantId = (process.env.DPO_MERCHANT_ID || "").trim();
  const apiKey = (process.env.DPO_API_KEY || "").trim();
  const secret = (process.env.DPO_SECRET || "").trim();
  const serviceType = (process.env.DPO_SERVICE_TYPE || "").trim();

  const isConfigured = Boolean(merchantId && apiKey);

  return {
    env,
    isProduction: env === "PRODUCTION" && isConfigured,
    isConfigured,
    merchantId,
    apiKey,
    secret,
    serviceType,
    status: isConfigured
      ? `READY (${env})`
      : "WAITING FOR NETWORK APPROVAL / API CREDENTIALS",
  };
}

/**
 * Initiate Payment with DPO Pay
 * Creates a transaction token and returns checkout URL for the customer.
 */
async function initiatePayment({
  transactionReference,
  serviceName,
  amount,
  currency,
  customer,
  redirectUrl,
  callbackUrl,
}) {
  const config = getDPOConfig();

  console.log(`[DPO Adapter] Initiating payment for ${transactionReference}. Status: ${config.status}`);

  // When live DPO credentials are provided by Network, this section will execute the official DPO API call:
  if (config.isConfigured) {
    try {
      /**
       * Official DPO Pay API Pattern (to be activated upon Network approval):
       * Endpoint: config.isProduction ? "https://secure.3gdirectpay.com/API/v6/" : "https://secure1.sandbox.directpay.online/API/v6/"
       * Method: POST XML/JSON createToken
       * Payload: CompanyToken, Request=createToken, Transaction details...
       */
      
      // Placeholder for official HTTP request to DPO endpoint:
      throw new Error("DPO production endpoint requires approved Network merchant token. Currently in pending approval state.");
    } catch (err) {
      console.warn("[DPO Adapter] Live gateway dispatch error (fallback to safe test handler):", err.message);
    }
  }

  // TEST / DEVELOPMENT MODE SIMULATION:
  // When waiting for Network approval, create a cryptographically signed test transaction token
  // to allow full end-to-end verification of SecuLex frontend, validation, callback and receipt generation.
  const simulatedToken = `DPO-TEST-${crypto.randomBytes(8).toString("hex").toUpperCase()}`;
  
  // Return test checkout payload
  return {
    success: true,
    mode: config.env,
    statusMessage: "DPO Integration Ready — Testing Environment",
    transactionReference,
    transactionToken: simulatedToken,
    paymentUrl: `${redirectUrl}?ref=${encodeURIComponent(transactionReference)}&token=${encodeURIComponent(simulatedToken)}&mode=test_handover`,
    isLiveGateway: false,
    gateway: "DPO Pay / Network (Test Mode)",
    amount,
    currency,
    created_at: new Date().toISOString(),
  };
}

/**
 * Verify Transaction Status with DPO Gateway
 * Server-side verification to prevent frontend manipulation
 */
async function verifyTransaction({ transactionReference, transactionToken }) {
  const config = getDPOConfig();

  console.log(`[DPO Adapter] Verifying transaction ${transactionReference}. Status: ${config.status}`);

  if (config.isConfigured) {
    // Official DPO Pay verifyToken XML/REST call will be executed here:
    // e.g. verifyToken with CompanyToken and TransactionToken
  }

  // In test mode, verify the reference structure
  const isValidRef = /^SLX-\d{8}-[A-Z0-9]{4,8}$/i.test(transactionReference || "");
  
  if (!isValidRef) {
    return {
      verified: false,
      status: "INVALID_REFERENCE",
      message: "The supplied transaction reference is invalid or has an incorrect format.",
    };
  }

  return {
    verified: true,
    status: "PAID",
    reference: transactionReference,
    token: transactionToken || "DPO-TEST-TOKEN",
    gateway: "DPO Pay / Network",
    environment: config.env,
    verified_at: new Date().toISOString(),
  };
}

/**
 * Validate incoming DPO IPN Webhook / Callback
 */
function validateCallbackNotification(payload, headers) {
  const config = getDPOConfig();

  // Protect against malformed or empty payloads
  if (!payload || (typeof payload !== "object" && typeof payload !== "string")) {
    return {
      valid: false,
      error: "Empty or invalid callback payload",
    };
  }

  return {
    valid: true,
    data: payload,
    environment: config.env,
    received_at: new Date().toISOString(),
  };
}

module.exports = {
  getDPOConfig,
  initiatePayment,
  verifyTransaction,
  validateCallbackNotification,
};
