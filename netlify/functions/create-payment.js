/**
 * ==============================================================================
 * SecuLex Payment API — Create Payment Endpoint
 * Route: POST /.netlify/functions/create-payment
 * ==============================================================================
 */

const {
  json,
  getSiteUrl,
  generateTransactionReference,
  resolveServicePrice,
  validateCustomerInput,
  signPaymentState,
} = require("./payment-utils");

const dpoAdapter = require("./dpo-adapter");

exports.handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return json(200, { ok: true });
  }

  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed. Use POST." });
  }

  try {
    let body = {};
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return json(400, { error: "Invalid JSON request payload." });
    }

    const { serviceId, currency, customAmount } = body;

    // 1. Validate customer information
    const customer = validateCustomerInput(body);

    // 2. Authoritatively resolve service price server-side (NEVER trust frontend amounts)
    const resolvedPrice = resolveServicePrice(serviceId, currency, customAmount);

    // 3. Generate unique transaction reference
    const transactionReference = generateTransactionReference();

    // 4. Construct callback and redirect URLs
    const siteUrl = getSiteUrl(event);
    const redirectUrl = `${siteUrl}/payment-status/`;
    const callbackUrl = `${siteUrl}/.netlify/functions/payment-callback`;

    // 5. Initiate payment via DPO Pay Adapter
    const paymentResult = await dpoAdapter.initiatePayment({
      transactionReference,
      serviceName: resolvedPrice.serviceName,
      amount: resolvedPrice.amount,
      currency: resolvedPrice.currency,
      customer,
      redirectUrl,
      callbackUrl,
    });

    // 6. Generate a cryptographically signed state token for verification
    const stateToken = signPaymentState({
      reference: transactionReference,
      serviceId: resolvedPrice.serviceId,
      serviceName: resolvedPrice.serviceName,
      amount: resolvedPrice.amount,
      currency: resolvedPrice.currency,
      customerName: customer.name,
      customerEmail: customer.email,
      customerPhone: customer.phone,
      notes: customer.notes,
      created_at: new Date().toISOString(),
      status: "PENDING",
    });

    return json(200, {
      success: true,
      transactionReference,
      paymentUrl: paymentResult.paymentUrl,
      stateToken,
      service: {
        id: resolvedPrice.serviceId,
        name: resolvedPrice.serviceName,
      },
      amount: resolvedPrice.amount,
      currency: resolvedPrice.currency,
      customer: {
        name: customer.name,
        email: customer.email,
      },
      mode: paymentResult.mode,
      statusMessage: paymentResult.statusMessage,
    });
  } catch (err) {
    console.error("[create-payment error]:", err.message);
    return json(400, {
      success: false,
      error: err.message || "Could not initiate payment.",
    });
  }
};
