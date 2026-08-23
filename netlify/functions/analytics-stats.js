/**
 * analytics-stats.js — SecuLex Admin Portal: Google Analytics 4 Data API
 *
 * Fetches visitor statistics from GA4 using a service account JWT.
 * Required Netlify env vars:
 *   GA4_PROPERTY_ID          = numeric property ID (e.g. "123456789")
 *   GA4_SERVICE_ACCOUNT_JSON = full JSON key content of the service account
 *
 * Called from the admin portal Statistics panel (authenticated admins only).
 */

"use strict";
const https = require("https");
const crypto = require("crypto");

/* ─── Env ─────────────────────────────────────────────────────────── */
const GA4_PROPERTY_ID = process.env.GA4_PROPERTY_ID || "";
const SA_JSON_RAW = process.env.GA4_SERVICE_ACCOUNT_JSON || "";

/* ─── JWT helper ──────────────────────────────────────────────────── */
function b64url(buf) {
  return (typeof buf === "string" ? Buffer.from(buf) : buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function makeJWT(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/analytics.readonly",
      aud: "https://oauth2.googleapis.com/token",
      exp: now + 3600,
      iat: now,
    })
  );
  const sigInput = ${header}.;
  const sig = crypto
    .createSign("RSA-SHA256")
    .update(sigInput)
    .sign(sa.private_key, "base64url");
  return ${sigInput}.;
}

/* ─── HTTP helpers ────────────────────────────────────────────────── */
function post(url, data, headers = {}) {
  return new Promise((resolve, reject) => {
    const body = typeof data === "string" ? data : JSON.stringify(data);
    const u = new URL(url);
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          ...headers,
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(raw) });
          } catch {
            resolve({ status: res.statusCode, body: raw });
          }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function getAccessToken(sa) {
  const jwt = makeJWT(sa);
  const res = await post(
    "https://oauth2.googleapis.com/token",
    grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=,
    { "Content-Type": "application/x-www-form-urlencoded" }
  );
  if (!res.body.access_token) throw new Error("GA4 token exchange failed: " + JSON.stringify(res.body));
  return res.body.access_token;
}

async function ga4RunReport(token, propertyId, body) {
  const res = await post(
    https://analyticsdata.googleapis.com/v1beta/properties/:runReport,
    body,
    { Authorization: Bearer  }
  );
  if (res.status !== 200) throw new Error("GA4 API error " + res.status + ": " + JSON.stringify(res.body));
  return res.body;
}

/* ─── Parse GA4 responses ─────────────────────────────────────────── */
function parseRows(report) {
  const headers = (report.dimensionHeaders || []).map((h) => h.name);
  const metHdrs = (report.metricHeaders || []).map((h) => h.name);
  return (report.rows || []).map((row) => {
    const obj = {};
    (row.dimensionValues || []).forEach((v, i) => (obj[headers[i]] = v.value));
    (row.metricValues || []).forEach((v, i) => (obj[metHdrs[i]] = Number(v.value)));
    return obj;
  });
}

/* ─── Handler ─────────────────────────────────────────────────────── */
exports.handler = async (event) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, X-Admin-Token",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors, body: "" };
  if (event.httpMethod !== "GET") return { statusCode: 405, headers: cors, body: JSON.stringify({ error: "Method not allowed" }) };

  /* — Basic admin token guard — */
  const token = (event.headers["x-admin-token"] || "").trim();
  if (!token || token.length < 16) {
    return { statusCode: 401, headers: cors, body: JSON.stringify({ error: "Unauthorized" }) };
  }

  /* — Check config — */
  if (!GA4_PROPERTY_ID || !SA_JSON_RAW) {
    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({
        configured: false,
        message: "GA4 not configured yet. Add GA4_PROPERTY_ID and GA4_SERVICE_ACCOUNT_JSON to Netlify environment variables.",
      }),
    };
  }

  let sa;
  try {
    sa = JSON.parse(SA_JSON_RAW);
  } catch {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: "Invalid GA4 service account JSON" }) };
  }

  const range = event.queryStringParameters?.range || "7";
  const days = Math.min(Math.max(parseInt(range) || 7, 1), 90);
  const dateRange = { startDate: ${days}daysAgo, endDate: "today" };

  try {
    const accessToken = await getAccessToken(sa);

    /* — Run 4 parallel reports — */
    const [summaryRpt, countriesRpt, pagesRpt, devicesRpt, trendRpt] = await Promise.all([
      /* 1. Summary: total users, sessions, page views */
      ga4RunReport(accessToken, GA4_PROPERTY_ID, {
        dateRanges: [dateRange],
        metrics: [{ name: "totalUsers" }, { name: "sessions" }, { name: "screenPageViews" }, { name: "bounceRate" }],
      }),
      /* 2. Top countries */
      ga4RunReport(accessToken, GA4_PROPERTY_ID, {
        dateRanges: [dateRange],
        dimensions: [{ name: "country" }],
        metrics: [{ name: "totalUsers" }],
        orderBys: [{ metric: { metricName: "totalUsers" }, desc: true }],
        limit: 10,
      }),
      /* 3. Top pages (articles) */
      ga4RunReport(accessToken, GA4_PROPERTY_ID, {
        dateRanges: [dateRange],
        dimensions: [{ name: "pageTitle" }, { name: "pagePath" }],
        metrics: [{ name: "screenPageViews" }, { name: "totalUsers" }],
        orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
        dimensionFilter: {
          filter: {
            fieldName: "pagePath",
            stringFilter: { matchType: "CONTAINS", value: "/posts/" },
          },
        },
        limit: 10,
      }),
      /* 4. Device category */
      ga4RunReport(accessToken, GA4_PROPERTY_ID, {
        dateRanges: [dateRange],
        dimensions: [{ name: "deviceCategory" }],
        metrics: [{ name: "totalUsers" }],
      }),
      /* 5. Daily trend */
      ga4RunReport(accessToken, GA4_PROPERTY_ID, {
        dateRanges: [dateRange],
        dimensions: [{ name: "date" }],
        metrics: [{ name: "totalUsers" }, { name: "screenPageViews" }],
        orderBys: [{ dimension: { dimensionName: "date" } }],
      }),
    ]);

    const summaryRows = parseRows(summaryRpt);
    const summary = summaryRows[0] || {};

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({
        configured: true,
        range: days,
        summary: {
          users: summary.totalUsers || 0,
          sessions: summary.sessions || 0,
          pageViews: summary.screenPageViews || 0,
          bounceRate: summary.bounceRate ? (summary.bounceRate * 100).toFixed(1) : null,
        },
        countries: parseRows(countriesRpt),
        topPages: parseRows(pagesRpt),
        devices: parseRows(devicesRpt),
        trend: parseRows(trendRpt),
      }),
    };
  } catch (err) {
    console.error("[analytics-stats] Error:", err.message);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.message }) };
  }
};
