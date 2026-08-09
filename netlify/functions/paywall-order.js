const {
  documentPath,
  getPayPalAccessToken,
  getPayPalBaseUrl,
  getSiteUrl,
  json,
  moneyValue,
  safeDocumentId,
  isDemoMode,
} = require("./paywall-utils");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed." });
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const documentId = safeDocumentId(body.documentId);
    documentPath(documentId);

    const amount = moneyValue(body.amount);
    const currency = String(body.currency || "USD").toUpperCase();
    const articlePath = String(body.articlePath || "/");
    const siteUrl = getSiteUrl(event);

    const returnUrl = `${siteUrl}${articlePath}?paywall=return&doc=${encodeURIComponent(documentId)}`;
    const cancelUrl = `${siteUrl}${articlePath}?paywall=cancel`;

    if (isDemoMode()) {
      const orderId = `DEMO_ORDER_${Date.now()}`;
      const simulatedReturnUrl = `${returnUrl}&token=${orderId}`;
      return json(200, { orderId, approveUrl: simulatedReturnUrl });
    }

    const token = await getPayPalAccessToken();

    const response = await fetch(`${getPayPalBaseUrl()}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [
          {
            reference_id: documentId,
            description: `SecuLex protected document: ${documentId}`,
            amount: {
              currency_code: currency,
              value: amount,
            },
            custom_id: documentId,
          },
        ],
        payment_source: {
          paypal: {
            experience_context: {
              payment_method_preference: "IMMEDIATE_PAYMENT_REQUIRED",
              brand_name: "SecuLex",
              landing_page: "GUEST_CHECKOUT", // Direct debit/credit card guest checkout!
              user_action: "PAY_NOW",
              return_url: returnUrl,
              cancel_url: cancelUrl,
            },
          },
        },
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      return json(response.status, { error: "PayPal order creation failed.", details: data });
    }

    const approveUrl = (data.links || []).find((link) => link.rel === "payer-action" || link.rel === "approve")?.href;
    if (!approveUrl) {
      return json(502, { error: "PayPal did not return an approval URL." });
    }

    return json(200, { orderId: data.id, approveUrl });
  } catch (error) {
    return json(400, { error: error.message });
  }
};
