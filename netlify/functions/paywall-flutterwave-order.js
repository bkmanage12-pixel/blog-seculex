const {
  documentPath,
  getSiteUrl,
  json,
  moneyValue,
  safeDocumentId,
  isFlutterwaveDemoMode,
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

    // Redirect URL after checkout completion
    const redirectUrl = `${siteUrl}${articlePath}?paywall=return&gateway=flutterwave&doc=${encodeURIComponent(documentId)}`;

    if (isFlutterwaveDemoMode()) {
      const demoRef = `DEMO_FLW_REF_${Date.now()}`;
      const demoTxId = `DEMO_FLW_TX_${Date.now()}`;
      const simulatedReturnUrl = `${redirectUrl}&status=successful&tx_ref=${demoRef}&transaction_id=${demoTxId}`;
      return json(200, { transactionId: demoTxId, approveUrl: simulatedReturnUrl });
    }

    const secretKey = process.env.FLUTTERWAVE_SECRET_KEY;
    const txRef = `FLW_REF_${Date.now()}_${documentId.replace(/[^a-zA-Z0-9]/g, "")}`;

    const response = await fetch("https://api.flutterwave.com/v3/payments", {
      method: "POST",
      headers: {
        authorization: `Bearer ${secretKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        tx_ref: txRef,
        amount: amount,
        currency: currency,
        redirect_url: redirectUrl,
        customer: {
          email: "guest@seculex.local",
          name: "Guest Reader",
        },
        customizations: {
          title: "SecuLex Scholarly Publication",
          description: `Unlock attached document: ${documentId}`,
        },
      }),
    });

    const data = await response.json();
    if (!response.ok || data.status !== "success") {
      return json(response.status || 400, {
        error: "Flutterwave payment initialization failed.",
        details: data,
      });
    }

    const approveUrl = data.data && data.data.link;
    if (!approveUrl) {
      return json(502, { error: "Flutterwave did not return a payment link." });
    }

    return json(200, { transactionId: txRef, approveUrl });
  } catch (error) {
    return json(400, { error: error.message });
  }
};
