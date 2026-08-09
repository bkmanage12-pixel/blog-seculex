# Real Paywall Setup

Paid PDFs must not be stored in `src/assets`, because files there are published publicly. Store paid PDFs in `protected_documents/` and set the article `attachment` value to the filename, for example:

```yaml
attachment: document.pdf
paywall_enabled: true
price_override: 2
```

Required Netlify environment variables:

```text
PAYPAL_CLIENT_ID=your PayPal REST app client id
PAYPAL_CLIENT_SECRET=your PayPal REST app secret
PAYPAL_ENV=sandbox
PAYWALL_DOWNLOAD_SECRET=a long random secret
SITE_URL=https://your-production-domain.example
```

Use `PAYPAL_ENV=live` only after testing the full checkout in PayPal sandbox.

Flow:

1. The article page asks `/.netlify/functions/paywall-order` to create a PayPal Orders v2 checkout.
2. PayPal redirects the reader back after approval.
3. `/.netlify/functions/paywall-capture` captures and verifies the payment amount, currency, and document id.
4. The server returns a short-lived signed download URL.
5. `/.netlify/functions/download-document` serves the PDF only when that signed token is valid.

Do not upload paid PDFs through the CMS media uploader unless that uploader is changed to store files outside the public build output.
