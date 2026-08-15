/**
 * SecuLex — Publish All Drafts Netlify Function
 *
 * This function publishes ALL pending editorial-workflow drafts at once by:
 * 1. Listing all open GitHub PRs on cms/** branches (created by Decap CMS)
 * 2. Merging each one into main (i.e. "publishing" the saved draft)
 * 3. Triggering a Netlify build hook to redeploy the live site
 *
 * Required Netlify environment variables:
 *   GITHUB_TOKEN       — Personal access token with repo scope
 *   GITHUB_OWNER       — GitHub username/org (e.g. bkmanage12-pixel)
 *   GITHUB_REPO        — Repository name (e.g. blog-seculex)
 *   NETLIFY_BUILD_HOOK_URL — Netlify build hook URL for post-publish rebuild
 */

exports.handler = async (event) => {
  const cors = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: cors, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const token      = process.env.GITHUB_TOKEN;
  const owner      = process.env.GITHUB_OWNER;
  const repo       = process.env.GITHUB_REPO;
  const buildHook  = process.env.NETLIFY_BUILD_HOOK_URL;

  if (!token || !owner || !repo) {
    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({
        success: false,
        needsSetup: true,
        message:
          "⚠️ Publish All is not configured yet. " +
          "Add these Netlify environment variables: " +
          "GITHUB_TOKEN (repo-scoped personal access token), " +
          "GITHUB_OWNER (your GitHub username), " +
          "GITHUB_REPO (your repository name).",
      }),
    };
  }

  const ghHeaders = {
    "Authorization": `token ${token}`,
    "Accept": "application/vnd.github+json",
    "Content-Type": "application/json",
    "User-Agent": "SecuLex-Admin/1.0",
  };

  try {
    // ── Step 1: Fetch all open PRs ────────────────────────────────
    const prRes  = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/pulls?state=open&per_page=100`,
      { headers: ghHeaders }
    );

    if (!prRes.ok) {
      const errText = await prRes.text();
      return {
        statusCode: 200,
        headers: cors,
        body: JSON.stringify({
          success: false,
          message: `GitHub API error fetching PRs (${prRes.status}): ${errText}`,
        }),
      };
    }

    const allPRs = await prRes.json();

    // Decap CMS editorial workflow creates branches named cms/...
    const cmsPRs = allPRs.filter(pr =>
      pr.head?.ref?.startsWith("cms/") || pr.head?.ref?.startsWith("netlify-cms/")
    );

    if (!cmsPRs.length) {
      return {
        statusCode: 200,
        headers: cors,
        body: JSON.stringify({
          success: true,
          published: 0,
          failed: 0,
          message: "ℹ️ No pending saved drafts found. Everything is already published.",
        }),
      };
    }

    // ── Step 2: Merge each draft PR ───────────────────────────────
    let published = 0;
    let failed    = 0;
    const errors  = [];

    for (const pr of cmsPRs) {
      try {
        const mergeRes = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/pulls/${pr.number}/merge`,
          {
            method: "PUT",
            headers: ghHeaders,
            body: JSON.stringify({
              commit_title:   `Publish: ${pr.title}`,
              commit_message: `Published via SecuLex Admin Portal — Publish All`,
              merge_method:   "squash",
            }),
          }
        );

        if (mergeRes.ok) {
          published++;
        } else {
          const errBody = await mergeRes.json().catch(() => ({}));
          failed++;
          errors.push(`PR #${pr.number} "${pr.title}": ${errBody.message || mergeRes.status}`);
        }
      } catch (mergeErr) {
        failed++;
        errors.push(`PR #${pr.number}: ${mergeErr.message}`);
      }
    }

    // ── Step 3: Trigger Netlify rebuild ───────────────────────────
    let buildTriggered = false;
    if (buildHook && published > 0) {
      try {
        const hookRes = await fetch(buildHook, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ trigger_title: "Admin Portal — Publish All" }),
        });
        buildTriggered = hookRes.ok;
      } catch {}
    }

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({
        success: published > 0,
        published,
        failed,
        buildTriggered,
        errors: errors.length ? errors : undefined,
        message:
          published > 0
            ? `✅ ${published} draft${published > 1 ? "s" : ""} published successfully.` +
              (failed > 0 ? ` ⚠️ ${failed} failed.` : "") +
              (buildTriggered ? " Site rebuild triggered — live in ~1–2 minutes." : "")
            : `⚠️ No drafts could be published. ${failed} error(s): ${errors.join("; ")}`,
      }),
    };
  } catch (err) {
    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({
        success: false,
        message: `Unexpected error: ${err.message}`,
      }),
    };
  }
};
