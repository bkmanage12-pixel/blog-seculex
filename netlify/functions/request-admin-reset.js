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
          body: JSON.stringify({ error: `Password reset requests are restricted to: ${ADMIN_EMAIL}` })
        };
      }

      // Generate a 6-digit security code
      const code = String(Math.floor(100000 + Math.random() * 900000));
      const expiresAt = Date.now() + 15 * 60 * 1000; // 15 minutes

      activeTokens.set(code, { email, expiresAt });
      console.log(`[Admin Reset] Generated security code ${code} for ${ADMIN_EMAIL}`);

      let emailSent = false;
      let emailError = "";

      // 1. Send via Resend API if RESEND_API_KEY is configured
      if (process.env.RESEND_API_KEY) {
        try {
          const res = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              from: "SecuLex Security <onboarding@resend.dev>",
              to: [ADMIN_EMAIL],
              subject: "SecuLex Admin Password Reset Security Code",
              html: `
                <div style="font-family: sans-serif; padding: 20px; color: #111;">
                  <h2>SecuLex Admin Password Reset</h2>
                  <p>You requested a password reset for <strong>${ADMIN_EMAIL}</strong>.</p>
                  <p>Your 6-digit security reset code is:</p>
                  <div style="font-size: 28px; font-weight: bold; letter-spacing: 4px; color: #d4af37; padding: 10px 0;">${code}</div>
                  <p>This code expires in 15 minutes.</p>
                  <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
                  <p style="font-size: 12px; color: #666;">If you did not request this reset, please ignore this email.</p>
                </div>
              `
            })
          });
          if (res.ok) {
            emailSent = true;
          } else {
            const errData = await res.json();
            emailError = errData.message || "Resend API error";
          }
        } catch (err) {
          emailError = err.message;
        }
      }

      // 2. Send via SendGrid API if SENDGRID_API_KEY is configured
      if (!emailSent && process.env.SENDGRID_API_KEY) {
        try {
          const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${process.env.SENDGRID_API_KEY}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              personalizations: [{ to: [{ email: ADMIN_EMAIL }] }],
              from: { email: "no-reply@seculex.org", name: "SecuLex Security" },
              subject: "SecuLex Admin Password Reset Security Code",
              content: [{
                type: "text/html",
                value: `<p>Your SecuLex Admin reset code is: <strong>${code}</strong> (valid for 15 mins).</p>`
              }]
            })
          });
          if (res.ok) emailSent = true;
        } catch (err) {
          emailError = err.message;
        }
      }

      if (emailSent) {
        return {
          statusCode: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            success: true,
            emailDispatched: true,
            message: `✅ Security reset code emailed to ${ADMIN_EMAIL}. Check your inbox!`
          })
        };
      }

      // Fallback message if no email API key is configured yet
      return {
        statusCode: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          success: true,
          emailDispatched: false,
          message: `Reset code generated for ${ADMIN_EMAIL}. (Email API Key not set in Netlify — use your saved Recovery Key below).`
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
