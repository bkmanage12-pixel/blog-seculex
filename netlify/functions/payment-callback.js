/**
 * ==============================================================================
 * SecuLex Payment API — DPO IPN / Webhook Callback Handler
 * Route: POST /.netlify/functions/payment-callback
 * ==============================================================================
 */

const { json } = require("./payment-utils");
const dpoAdapter = require("./dpo-adapter");

exports.handler = async (event) => {
  console.log(`[payment-callback] Received ${event.httpMethod} callback notification.`);

  if (event.httpMethod === "OPTIONS") {
    return json(200, { ok: true });
  }

  try {
    let payload = {};
    if (event.body) {
      try {
        payload = JSON.parse(event.body);
      } catch {
        // Fallback for form-urlencoded or XML bodies
        payload = event.body;
      }
    } else {
      payload = event.queryStringParameters || {};
    }

    // 1. Validate callback via DPO adapter
    const validation = dpoAdapter.validateCallbackNotification(payload, event.headers);

    if (!validation.valid) {
      console.warn("[payment-callback] Invalid callback received:", validation.error);
      return json(400, { error: validation.error });
    }

    console.log("[payment-callback] Successfully processed notification for:", validation.data);

    // Standard acknowledgment expected by payment gateways
    return {
      statusCode: 200,
      headers: {
        "content-type": "text/xml; charset=utf-8",
        "cache-control": "no-store",
      },
      body: `<?xml version="1.0" encoding="utf-8"?><API3G><Response>OK</Response></API3G>`,
    };
  } catch (err) {
    console.error("[payment-callback error]:", err.message);
    return json(500, { error: "Internal processing error during callback." });
  }
};
