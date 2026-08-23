const fs = require("fs");
const path = require("path");
const os = require("os");
const { documentPath, verifyDownloadToken, isDocumentFree, safeDocumentId } = require("./paywall-utils");

exports.handler = async (event) => {
  try {
    const token = event.queryStringParameters && event.queryStringParameters.token;
    const fileParam = event.queryStringParameters && event.queryStringParameters.file;

    let documentId;
    if (token) {
      const payload = verifyDownloadToken(token);
      documentId = payload.documentId;
      const ref = String(payload.reference || payload.ref || "default").replace(/[^a-zA-Z0-9_-]/g, "");
      const maxAllowed = Number(payload.maxDownloads) || 2;

      // Track and enforce twice download limit per payment token
      const countDir = path.join(os.tmpdir(), "seculex_dl_limits");
      try {
        if (!fs.existsSync(countDir)) {
          fs.mkdirSync(countDir, { recursive: true });
        }
      } catch (e) {}

      const countFile = path.join(countDir, `dl_${ref}.json`);
      let currentCount = 0;
      try {
        if (fs.existsSync(countFile)) {
          const data = JSON.parse(fs.readFileSync(countFile, "utf8"));
          currentCount = Number(data.count) || 0;
        }
      } catch (e) {}

      if (currentCount >= maxAllowed) {
        return {
          statusCode: 403,
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-store",
          },
          body: `
            <!DOCTYPE html>
            <html lang="en">
            <head>
              <meta charset="utf-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <title>Download Limit Reached — SecuLex</title>
              <style>
                body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #080a11; color: #f8fafc; text-align: center; padding: 4rem 1.5rem; }
                .card { max-width: 480px; margin: 0 auto; background: #121520; border: 1px solid rgba(239, 68, 68, 0.4); border-radius: 12px; padding: 2.5rem; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
                h2 { color: #ef4444; margin-bottom: 0.8rem; font-size: 1.4rem; }
                p { color: #94a3b8; font-size: 0.95rem; line-height: 1.6; }
                .btn { display: inline-block; margin-top: 1.5rem; background: #d4af37; color: #080a11; text-decoration: none; padding: 0.75rem 1.6rem; border-radius: 6px; font-weight: bold; }
              </style>
            </head>
            <body>
              <div class="card">
                <h2>Download Limit Reached</h2>
                <p>This payment allows a maximum of <strong>2 downloads</strong> for this document. Both downloads have already been completed.</p>
                <p style="font-size: 0.82rem; color: #64748b; margin-top: 0.5rem;">Reference: ${ref}</p>
                <a href="/articles/" class="btn">Return to Publications</a>
              </div>
            </body>
            </html>
          `,
        };
      }

      // Record this download
      try {
        fs.writeFileSync(countFile, JSON.stringify({
          count: currentCount + 1,
          last_download: new Date().toISOString(),
          reference: ref,
        }));
      } catch (e) {}
    } else if (fileParam) {
      const safeId = safeDocumentId(fileParam);
      if (isDocumentFree(safeId)) {
        documentId = safeId;
      } else {
        return {
          statusCode: 403,
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "no-store",
          },
          body: "This document is not available for free download.",
        };
      }
    } else {
      throw new Error("Missing download token or file parameter.");
    }

    const filePath = documentPath(documentId);
    const file = fs.readFileSync(filePath);

    return {
      statusCode: 200,
      isBase64Encoded: true,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${path.basename(filePath)}"`,
        "cache-control": "private, no-store",
      },
      body: file.toString("base64"),
    };
  } catch (error) {
    return {
      statusCode: 403,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
      },
      body: error.message,
    };
  }
};
