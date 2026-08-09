const fs = require("fs");
const path = require("path");
const { documentPath, verifyDownloadToken, isDocumentFree, safeDocumentId } = require("./paywall-utils");

exports.handler = async (event) => {
  try {
    const token = event.queryStringParameters && event.queryStringParameters.token;
    const fileParam = event.queryStringParameters && event.queryStringParameters.file;

    let documentId;
    if (token) {
      const payload = verifyDownloadToken(token);
      documentId = payload.documentId;
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
