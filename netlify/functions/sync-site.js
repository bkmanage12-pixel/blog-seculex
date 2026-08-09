/**
 * SecuLex Sync-Site Netlify Function
 *
 * Triggers a Netlify build hook to rebuild and redeploy the site.
 * This is the ONLY reliable way to update a static Netlify site:
 * - The live site is served from CDN-deployed static files.
 * - No filesystem is available at function runtime to modify _site/.
 * - A build hook POST causes Netlify to re-pull GitHub and rebuild.
 *
 * Setup:
 *   1. Go to Netlify → Site Settings → Build & Deploy → Build hooks
 *   2. Create a hook called "Admin Sync" targeting branch "main"
 *   3. Copy the hook URL
 *   4. Go to Site Settings → Environment Variables → add:
 *      NETLIFY_BUILD_HOOK_URL = <your hook URL>
 */

exports.handler = async (event) => {
  const corsHeaders = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
  };

  // Handle CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders, body: "" };
  }

  const buildHookUrl = process.env.NETLIFY_BUILD_HOOK_URL;

  if (!buildHookUrl) {
    // No build hook configured — return a helpful error message
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: false,
        buildHookTriggered: false,
        needsSetup: true,
        message:
          "⚠️ Build hook not configured. " +
          "To enable automatic site refresh: " +
          "Go to Netlify → Site Settings → Build & Deploy → Build hooks → " +
          "Create a hook called 'Admin Sync' → Copy the URL → " +
          "Go to Site Settings → Environment Variables → " +
          "Add NETLIFY_BUILD_HOOK_URL with the hook URL value.",
      }),
    };
  }

  try {
    // Trigger the Netlify build hook
    const hookResponse = await fetch(buildHookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ trigger_title: "Admin Portal Sync" }),
    });

    if (!hookResponse.ok) {
      const errorText = await hookResponse.text();
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({
          success: false,
          buildHookTriggered: false,
          message: `Build hook returned error ${hookResponse.status}: ${errorText}`,
        }),
      };
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        buildHookTriggered: true,
        message:
          "✅ Site rebuild triggered! Netlify is rebuilding your site now. " +
          "Deleted articles will be removed from the live site once the build completes (usually 1-2 minutes).",
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        success: false,
        buildHookTriggered: false,
        message: `Failed to trigger build hook: ${err.message}`,
      }),
    };
  }
};
