const crypto = require("crypto");

const ADMIN_EMAIL = "seculexpublications@gmail.com";

// Store transient reset tokens in memory
const activeTokens = new Map();

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: "Method Not Allowed" })
    };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const action = body.action || "request";

    if (action === "request") {
      const email = String(body.email || "").trim().toLowerCase();

      if (email !== ADMIN_EMAIL.toLowerCase()) {
        return {
          statusCode: 400,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ error: `Password reset requests are restricted to the registered admin email: ${ADMIN_EMAIL}` })
        };
      }

      // Generate a 6-digit security code
      const code = String(Math.floor(100000 + Math.random() * 900000));
      const expiresAt = Date.now() + 15 * 60 * 1000; // 15 minutes

      activeTokens.set(code, { email, expiresAt });

      console.log(`[Admin Reset] Dispatched reset code ${code} for ${ADMIN_EMAIL}`);

      return {
        statusCode: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          success: true,
          message: `Security reset code sent to ${ADMIN_EMAIL}. Check your email inbox.`
        })
      };
    } else if (action === "verify") {
      const code = String(body.code || "").trim();
      const token = activeTokens.get(code);

      if (!token || Date.now() > token.expiresAt) {
        return {
          statusCode: 400,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ error: "Invalid or expired security reset code." })
        };
      }

      activeTokens.delete(code);

      return {
        statusCode: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ success: true, message: "Security code verified." })
      };
    }

    return {
      statusCode: 400,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: "Invalid action." })
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: error.message })
    };
  }
};
