const {
  documentPath,
  getPayPalAccessToken,
  getPayPalBaseUrl,
  json,
  moneyValue,
  safeDocumentId,
  signDownloadToken,
  isDemoMode,
} = require("./paywall-utils");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed." });
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const orderId = String(body.orderId || "").trim();
    const documentId = safeDocumentId(body.documentId);
    documentPath(documentId);

    const expectedAmount = moneyValue(body.amount);
    const expectedCurrency = String(body.currency || "USD").toUpperCase();
    if (!orderId) {
      throw new Error("Missing PayPal order id.");
    }

    let isCompleted = false;

    if (orderId.startsWith("DEMO_ORDER_")) {
      if (isDemoMode()) {
        isCompleted = true;
      } else {
        throw new Error("Demo orders are not allowed in production.");
      }
    } else {
      const token = await getPayPalAccessToken();
      const response = await fetch(`${getPayPalBaseUrl()}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
      });

      const data = await response.json();
      if (!response.ok) {
        return json(response.status, { error: "PayPal capture failed.", details: data });
      }

      const unit = data.purchase_units && data.purchase_units[0];
      const capture = unit?.payments?.captures && unit.payments.captures[0];
      const paidAmount = capture?.amount?.value;
      const paidCurrency = capture?.amount?.currency_code;

      if (data.status !== "COMPLETED" || capture?.status !== "COMPLETED") {
        return json(402, { error: "Payment was not completed." });
      }
      if (unit?.custom_id !== documentId && unit?.reference_id !== documentId) {
        return json(400, { error: "Payment does not match this document." });
      }
      if (moneyValue(paidAmount) !== expectedAmount || String(paidCurrency).toUpperCase() !== expectedCurrency) {
        return json(400, { error: "Payment amount does not match this document." });
      }

      isCompleted = true;
    }

    if (!isCompleted) {
      throw new Error("Payment verification failed.");
    }

    const downloadToken = signDownloadToken({
      documentId,
      orderId,
      amount: expectedAmount,
      currency: expectedCurrency,
      exp: Date.now() + 15 * 60 * 1000,
    });

    return json(200, {
      status: "COMPLETED",
      downloadUrl: `/.netlify/functions/download-document?token=${encodeURIComponent(downloadToken)}`,
    });
  } catch (error) {
    return json(400, { error: error.message });
  }
};
