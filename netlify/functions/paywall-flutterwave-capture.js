const {
  documentPath,
  json,
  moneyValue,
  safeDocumentId,
  signDownloadToken,
  isFlutterwaveDemoMode,
} = require("./paywall-utils");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed." });
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const transactionId = String(body.transactionId || "").trim();
    const documentId = safeDocumentId(body.documentId);
    documentPath(documentId);

    const expectedAmount = moneyValue(body.amount);
    const expectedCurrency = String(body.currency || "USD").toUpperCase();

    if (!transactionId) {
      throw new Error("Missing Flutterwave transaction id.");
    }

    let isCompleted = false;

    if (transactionId.startsWith("DEMO_FLW_")) {
      if (isFlutterwaveDemoMode()) {
        isCompleted = true;
      } else {
        throw new Error("Demo transactions are not allowed in production.");
      }
    } else {
      const secretKey = process.env.FLUTTERWAVE_SECRET_KEY;
      const response = await fetch(
        `https://api.flutterwave.com/v3/transactions/${encodeURIComponent(transactionId)}/verify`,
        {
          method: "GET",
          headers: {
            authorization: `Bearer ${secretKey}`,
            "content-type": "application/json",
          },
        }
      );

      const data = await response.json();
      if (!response.ok || data.status !== "success") {
        return json(response.status || 400, {
          error: "Flutterwave payment verification failed.",
          details: data,
        });
      }

      const tx = data.data;
      if (!tx || tx.status !== "successful") {
        return json(402, { error: "Payment was not completed." });
      }

      const paidAmount = tx.amount;
      const paidCurrency = tx.currency;

      if (moneyValue(paidAmount) !== expectedAmount || String(paidCurrency).toUpperCase() !== expectedCurrency) {
        return json(400, { error: "Payment amount or currency does not match." });
      }

      isCompleted = true;
    }

    if (!isCompleted) {
      throw new Error("Payment verification failed.");
    }

    const downloadToken = signDownloadToken({
      documentId,
      orderId: transactionId,
      amount: expectedAmount,
      currency: expectedCurrency,
      exp: Date.now() + 15 * 60 * 1000, // 15 mins expiry
    });

    return json(200, {
      status: "COMPLETED",
      downloadUrl: `/.netlify/functions/download-document?token=${encodeURIComponent(downloadToken)}`,
    });
  } catch (error) {
    return json(400, { error: error.message });
  }
};
