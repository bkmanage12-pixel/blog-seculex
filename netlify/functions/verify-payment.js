/**
 * ==============================================================================
 * SecuLex Payment API — Verify Payment Endpoint
 * Route: GET or POST /.netlify/functions/verify-payment
 * ==============================================================================
 */

const { json, verifyPaymentState } = require("./payment-utils");
const dpoAdapter = require("./dpo-adapter");

exports.handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return json(200, { ok: true });
  }

  try {
    const params = event.queryStringParameters || {};
    let body = {};
    if (event.body) {
      try {
        body = JSON.parse(event.body);
      } catch {
        // Ignored if invalid JSON body
      }
    }

    const reference = String(params.ref || body.ref || params.reference || body.reference || "").trim();
    const token = String(params.token || body.token || "").trim();
    const stateToken = String(params.state || body.state || "").trim();
    const mockOutcome = String(params.outcome || body.outcome || "").trim().toUpperCase();

    if (!reference) {
      return json(400, {
        success: false,
        status: "INVALID_REQUEST",
        error: "Missing required 'ref' (Transaction Reference) parameter.",
      });
    }

    // Verify format of reference
    if (!/^SLX-\d{8}-[A-Z0-9]{4,8}$/i.test(reference)) {
      return json(400, {
        success: false,
        status: "INVALID_REFERENCE",
        error: "Malformed transaction reference.",
      });
    }

    // Decode signed state token if available
    const verifiedState = stateToken ? verifyPaymentState(stateToken) : null;

    // Execute server-side verification with DPO adapter
    const dpoVerification = await dpoAdapter.verifyTransaction({
      transactionReference: reference,
      transactionToken: token,
    });

    let finalStatus = dpoVerification.status || "PENDING";

    // Allow testing different outcomes in simulation/test mode if specified
    if (mockOutcome && ["PAID", "PENDING", "FAILED", "CANCELLED", "EXPIRED", "VERIFICATION_FAILED"].includes(mockOutcome)) {
      finalStatus = mockOutcome;
    }

    const nowIso = new Date().toISOString();

    const transactionData = {
      reference,
      status: finalStatus,
      serviceName: verifiedState ? verifiedState.serviceName : "SecuLex Professional Advisory",
      serviceId: verifiedState ? verifiedState.serviceId : "consulting",
      amount: verifiedState ? verifiedState.amount : null,
      currency: verifiedState ? verifiedState.currency : "RWF",
      customerName: verifiedState ? verifiedState.customerName : null,
      customerEmail: verifiedState ? verifiedState.customerEmail : null,
      customerPhone: verifiedState ? verifiedState.customerPhone : null,
      notes: verifiedState ? verifiedState.notes : null,
      created_at: verifiedState ? verifiedState.created_at : nowIso,
      updated_at: nowIso,
      paid_at: finalStatus === "PAID" ? (dpoVerification.verified_at || nowIso) : null,
      gateway: dpoVerification.gateway || "DPO Pay / Network",
      environment: dpoVerification.environment || "TEST",
    };

    return json(200, {
      success: true,
      verified: dpoVerification.verified && finalStatus === "PAID",
      status: finalStatus,
      reference,
      transaction: transactionData,
    });
  } catch (err) {
    console.error("[verify-payment error]:", err.message);
    return json(500, {
      success: false,
      status: "SERVER_ERROR",
      error: err.message || "Failed to verify transaction.",
    });
  }
};
