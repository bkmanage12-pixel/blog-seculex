/**
 * SecuLex Admin Portal — Authentication Engine
 *
 * DESIGN:
 * ──────────────────────────────────────────────────────────────
 * • Single-owner portal. NO registration, NO external auth.
 * • Password verified locally with PBKDF2-SHA256 (100,000 iterations).
 * • Default password: SecuLex2024!  (change it from the Password modal after login)
 * • Session stored in sessionStorage + localStorage (4-hour expiry).
 * • 5-attempt brute-force lockout (60 s cooldown).
 * • 15-minute idle auto-lock.
 * • Publishing is authenticated through Netlify Identity and Git Gateway.
 */

(function () {
  "use strict";

  /* ─── Constants ──────────────────────────────────────────────── */
  const KEY_HASH     = "seculex_pw_hash";
  const KEY_SALT     = "seculex_pw_salt";
  const KEY_SESSION  = "seculex_session";
  const KEY_ATTEMPTS = "seculex_attempts";
  const KEY_AUDIT    = "seculex_audit";

  // Default credentials — user should change password after first login
  // Hash of "SecuLex2024!" with the salt below
  const DEFAULT_HASH = "44a902c526c54de4dd4c5928e68cbb6def1966b367e22c89f635ef88a07ee00c";
  const DEFAULT_SALT = "d5d9c7163078aa42c4b612034bdc3ba3";

  const ADMIN_FUNCTION_SECRET = (
    (document.querySelector('meta[name="admin-function-secret"]') || {}).content || ""
  ).trim() || "seculex_admin_secret_v1";

  const PBKDF2_ITER  = 100000;
  const MAX_ATTEMPTS = 5;
  const LOCKOUT_MS   = 60 * 1000;
  const IDLE_MS      = 15 * 60 * 1000;
  const SESSION_MS   = 4 * 60 * 60 * 1000;

  let idleTimer = null;

  /* ─── Crypto ─────────────────────────────────────────────────── */

  async function pbkdf2Hash(password, saltHex) {
    const enc  = new TextEncoder();
    const salt = hexToBytes(saltHex);
    const key  = await crypto.subtle.importKey(
      "raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveBits"]
    );
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt, iterations: PBKDF2_ITER, hash: "SHA-256" }, key, 256
    );
    return bytesToHex(new Uint8Array(bits));
  }

  function hexToBytes(hex) {
    return new Uint8Array(hex.match(/.{2}/g).map(h => parseInt(h, 16)));
  }

  function bytesToHex(bytes) {
    return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
  }

  function randomHex(bytes = 16) {
    const a = new Uint8Array(bytes);
    crypto.getRandomValues(a);
    return bytesToHex(a);
  }

  /* ─── Credential Store ───────────────────────────────────────── */

  function getCredentials() {
    const hash = localStorage.getItem(KEY_HASH) || DEFAULT_HASH;
    const salt = localStorage.getItem(KEY_SALT) || DEFAULT_SALT;
    return { hash, salt };
  }

  async function saveNewPassword(plaintext) {
    const salt = randomHex(16);
    const hash = await pbkdf2Hash(plaintext, salt);
    localStorage.setItem(KEY_HASH, hash);
    localStorage.setItem(KEY_SALT, salt);
    // Try to sync to server (non-blocking, best-effort)
    _syncToServer(hash, salt).catch(() => {});
    return true;
  }

  async function _syncToServer(hash, salt) {
    await fetch("/.netlify/functions/admin-verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "save", hash, salt })
    });
  }

  /* ─── Password Verify ────────────────────────────────────────── */

  async function verifyPassword(plaintext) {
    const { hash: storedHash, salt: storedSalt } = getCredentials();
    const attempt = await pbkdf2Hash(plaintext, storedSalt);
    return attempt === storedHash;
  }

  /* ─── Session ────────────────────────────────────────────────── */

  async function getFingerprint() {
    const raw = [
      navigator.userAgent,
      screen.width + "x" + screen.height,
      new Date().getTimezoneOffset()
    ].join("|");
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
    return bytesToHex(new Uint8Array(buf));
  }

  async function createSession() {
    const fp  = await getFingerprint();
    const now = Date.now();
    const data = JSON.stringify({ ts: now, exp: now + SESSION_MS, fp });
    sessionStorage.setItem(KEY_SESSION, data);
    localStorage.setItem(KEY_SESSION, data);
  }

  async function sessionIsValid() {
    const raw = sessionStorage.getItem(KEY_SESSION) || localStorage.getItem(KEY_SESSION);
    if (!raw) return false;
    try {
      const p = JSON.parse(raw);
      if (!p.exp || Date.now() > p.exp) return false;
      const fp = await getFingerprint();
      if (p.fp && p.fp !== fp) return false;
      return true;
    } catch { return false; }
  }

  function destroySession() {
    sessionStorage.removeItem(KEY_SESSION);
    localStorage.removeItem(KEY_SESSION);
  }

  /* ─── Rate Limiting ──────────────────────────────────────────── */

  function getAttempts() {
    try {
      const d = JSON.parse(localStorage.getItem(KEY_ATTEMPTS) || "{}");
      if (d.lockoutUntil && Date.now() >= d.lockoutUntil) {
        localStorage.removeItem(KEY_ATTEMPTS);
        return { count: 0, lockoutUntil: 0 };
      }
      return { count: d.count || 0, lockoutUntil: d.lockoutUntil || 0 };
    } catch { return { count: 0, lockoutUntil: 0 }; }
  }

  function recordFail() {
    const s     = getAttempts();
    const count = (s.count || 0) + 1;
    const lockoutUntil = count >= MAX_ATTEMPTS ? Date.now() + LOCKOUT_MS : 0;
    localStorage.setItem(KEY_ATTEMPTS, JSON.stringify({ count, lockoutUntil }));
    return { count, lockoutUntil };
  }

  function clearAttempts() { localStorage.removeItem(KEY_ATTEMPTS); }

  /* ─── Audit ──────────────────────────────────────────────────── */

  function audit(type, details) {
    try {
      const logs = JSON.parse(localStorage.getItem(KEY_AUDIT) || "[]");
      logs.unshift({ type, details, ts: new Date().toLocaleString() });
      localStorage.setItem(KEY_AUDIT, JSON.stringify(logs.slice(0, 30)));
    } catch {}
  }

  function renderAuditLogs() {
    const tbody = document.getElementById("audit-log-rows");
    if (!tbody) return;
    try {
      const logs = JSON.parse(localStorage.getItem(KEY_AUDIT) || "[]");
      if (!logs.length) {
        tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--admin-text-secondary);padding:1.5rem;">No security logs recorded yet.</td></tr>';
        return;
      }
      tbody.innerHTML = logs.map(l => `
        <tr>
          <td><span class="admin-audit-tag ${l.type}">${l.type.toUpperCase()}</span></td>
          <td style="white-space:nowrap;color:var(--admin-text-secondary);">${l.ts}</td>
          <td>${l.details}</td>
        </tr>`).join("");
    } catch { tbody.innerHTML = '<tr><td colspan="3">Failed to load logs.</td></tr>'; }
  }

  /* ─── Idle Lock ──────────────────────────────────────────────── */

  function resetIdleTimer() {
    if (idleTimer) clearTimeout(idleTimer);
    const bar = document.getElementById("admin-security-bar");
    if (bar && bar.style.display === "flex") {
      idleTimer = setTimeout(() => {
        toast("🔒 Session locked after 15 minutes of inactivity.", "fa-lock");
        audit("logout", "Auto-locked due to inactivity.");
        lockPortal();
      }, IDLE_MS);
    }
  }

  function setupIdleListener() {
    ["mousemove", "keydown", "scroll", "touchstart"].forEach(e =>
      window.addEventListener(e, resetIdleTimer, { passive: true }));
  }

  /* ─── UI Helpers ─────────────────────────────────────────────── */

  function showView(name) {
    document.querySelectorAll(".admin-auth-view").forEach(v => v.style.display = "none");
    const el = document.getElementById("admin-view-" + name);
    if (el) el.style.display = "block";
  }

  function feedback(id, msg, type = "error") {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = msg;
    el.className = "admin-feedback " + type;
  }

  function clearFeedback(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = "";
    el.className = "admin-feedback";
  }

  function setBtn(btn, loading, loadingHTML, defaultHTML) {
    if (!btn) return;
    btn.disabled = loading;
    btn.innerHTML = loading ? loadingHTML : defaultHTML;
  }

  function setupEyeToggles() {
    document.querySelectorAll(".admin-toggle-eye").forEach(btn => {
      btn.addEventListener("click", () => {
        const input = btn.previousElementSibling;
        if (!input) return;
        const icon = btn.querySelector("i");
        input.type = input.type === "password" ? "text" : "password";
        icon && icon.classList.toggle("fa-eye",       input.type === "password");
        icon && icon.classList.toggle("fa-eye-slash", input.type === "text");
      });
    });
  }

  function setupCapsLock() {
    const pwInput = document.getElementById("login-password");
    const warn    = document.getElementById("login-caps-warning");
    if (!pwInput || !warn) return;
    const check = e => warn.classList.toggle("active",
      !!(e.getModifierState && e.getModifierState("CapsLock")));
    pwInput.addEventListener("keyup",   check);
    pwInput.addEventListener("keydown", check);
    pwInput.addEventListener("blur", () => warn.classList.remove("active"));
  }

  function toast(msg, icon = "fa-check-circle") {
    let c = document.getElementById("admin-toast-container");
    if (!c) { c = document.createElement("div"); c.id = "admin-toast-container"; document.body.appendChild(c); }
    const t = document.createElement("div");
    t.className = "admin-toast";
    t.innerHTML = `<i class="fas ${icon}" style="color:var(--admin-accent-gold)"></i> <span>${msg}</span>`;
    c.appendChild(t);
    setTimeout(() => { t.classList.add("hiding"); setTimeout(() => t.remove(), 300); }, 4000);
  }

  /* ─── CMS Loader ─────────────────────────────────────────────── */

  async function initCMS() {
    if (window.__seculexCmsLoaded) return;
    window.__seculexCmsLoaded = true;

    try {
      // Ensure config link tag exists
      if (!document.querySelector('link[rel="cms-config-url"]')) {
        const link = document.createElement("link");
        link.rel   = "cms-config-url";
        link.type  = "text/yaml";
        link.href  = "/admin/config.yml?v=1";
        document.head.appendChild(link);
      }

      // Clean up legacy Netlify Identity tokens from localStorage
      try {
        const rawUser = localStorage.getItem("decap-cms-user") || localStorage.getItem("netlify-cms-user");
        if (rawUser) {
          const parsed = JSON.parse(rawUser);
          if (!parsed || parsed.backendName !== "github" || !parsed.token) {
            localStorage.removeItem("decap-cms-user");
            localStorage.removeItem("netlify-cms-user");
            localStorage.removeItem("gotrue.user");
          }
        }
      } catch (_) {
        localStorage.removeItem("decap-cms-user");
        localStorage.removeItem("netlify-cms-user");
      }

      // Check if user saved a custom GitHub token
      const savedToken = localStorage.getItem("seculex_github_token");
      if (savedToken && savedToken.trim()) {
        const userObj = JSON.stringify({ token: savedToken.trim(), backendName: "github" });
        localStorage.setItem("decap-cms-user", userObj);
        localStorage.setItem("netlify-cms-user", userObj);
      }

      if (typeof CMS === "undefined") {
        throw new Error("Decap CMS did not load. Refresh the portal and try again.");
      }

      // Register CMS event hooks
      if (typeof CMS !== "undefined") {
        try { CMS.registerPreviewStyle("/css/styles.css"); } catch (_) {}
        if (CMS.registerEventListener) {
          CMS.registerEventListener({
            name: "postPublish",
            handler: function (data) {
              const title = data && data.entry && data.entry.getIn
                ? data.entry.getIn(["data", "title"]) : "Content";
              toast("✅ Published to live site! Netlify rebuilding...", "fa-check-double");
              audit("publish", 'Published: "' + (title || "Document") + '"');
            }
          });
        }
      }

      toast("✅ Editor ready — signed in to GitHub CMS backend.", "fa-pen-to-square");

    } catch (err) {
      console.error("[SecuLex] CMS init error:", err);
      toast("⚠️ CMS failed to load: " + err.message, "fa-triangle-exclamation");
      window.__seculexCmsLoaded = false;
    }
  }

  /* ─── Portal Lock / Unlock ───────────────────────────────────── */

  async function unlockPortal() {
    await createSession();
    clearAttempts();

    // Hide overlay with CSS animation, show bar
    const overlay = document.getElementById("admin-security-overlay");
    if (overlay) overlay.classList.add("hidden");
    const bar = document.getElementById("admin-security-bar");
    if (bar) bar.style.display = "flex";

    resetIdleTimer();
    await initCMS();
  }

  function lockPortal() {
    destroySession();
    if (idleTimer) clearTimeout(idleTimer);
    window.__seculexCmsLoaded = false;

    const bar = document.getElementById("admin-security-bar");
    if (bar) bar.style.display = "none";
    const overlay = document.getElementById("admin-security-overlay");
    if (overlay) overlay.classList.remove("hidden");
    showView("login");
  }

  /* ─── Login Handler ──────────────────────────────────────────── */

  async function handleLogin(e) {
    e.preventDefault();
    clearFeedback("login-feedback");

    const att = getAttempts();
    if (att.lockoutUntil && Date.now() < att.lockoutUntil) {
      const secs = Math.ceil((att.lockoutUntil - Date.now()) / 1000);
      feedback("login-feedback", "Too many failed attempts. Try again in " + secs + "s.");
      return;
    }

    const pw  = (document.getElementById("login-password") || {}).value || "";
    if (!pw) { feedback("login-feedback", "Please enter your password."); return; }

    const btn = document.getElementById("login-submit-btn");
    setBtn(btn, true,
      '<i class="fas fa-spinner fa-spin"></i> Verifying...',
      '<i class="fas fa-right-to-bracket"></i> Sign In'
    );

    try {
      const valid = await verifyPassword(pw);

      if (valid) {
        audit("login", "Admin authenticated successfully.");
        document.getElementById("login-password").value = "";
        await unlockPortal();
      } else {
        const a = recordFail();
        audit("failed", "Failed login attempt " + a.count + "/" + MAX_ATTEMPTS + ".");
        if (a.lockoutUntil) {
          feedback("login-feedback", "Too many failed attempts. Locked for 60 seconds.");
        } else {
          const rem = MAX_ATTEMPTS - a.count;
          feedback("login-feedback", "Incorrect password. " + rem + " attempt(s) remaining.");
        }
      }
    } catch (err) {
      console.error("[SecuLex] Login error:", err);
      feedback("login-feedback", "Login error — please try again.");
    } finally {
      setBtn(btn, false,
        "",
        '<i class="fas fa-right-to-bracket"></i> Sign In'
      );
    }
  }

  /* ─── Password Reset Handler ─────────────────────────────────── */

  async function handleResetPassword(e) {
    e.preventDefault();
    clearFeedback("reset-feedback");

    const key       = ((document.getElementById("reset-key") || {}).value || "").trim().toUpperCase();
    const newPw     = ((document.getElementById("reset-new-password") || {}).value || "").trim();
    const confirmPw = ((document.getElementById("reset-confirm-password") || {}).value || "").trim();

    const MASTER_KEY = "SECULEX-ADMIN-RECOVERY-KEY";
    if (key !== MASTER_KEY) {
      feedback("reset-feedback", "Invalid Recovery Key.");
      return;
    }
    if (newPw.length < 8) {
      feedback("reset-feedback", "Password must be at least 8 characters.");
      return;
    }
    if (newPw !== confirmPw) {
      feedback("reset-feedback", "Passwords do not match.");
      return;
    }

    const btn = document.querySelector("#reset-form button[type='submit']");
    setBtn(btn, true,
      '<i class="fas fa-spinner fa-spin"></i> Saving...',
      '<i class="fas fa-floppy-disk"></i> Reset & Save Password'
    );
    try {
      await saveNewPassword(newPw);
      audit("change", "Password reset via Recovery Key.");
      feedback("reset-feedback", "Password updated! Redirecting to login...", "success");
      setTimeout(() => { document.getElementById("reset-form").reset(); showView("login"); }, 1800);
    } finally {
      setBtn(btn, false, "", '<i class="fas fa-floppy-disk"></i> Reset & Save Password');
    }
  }

  /* ─── Change Password Handler ────────────────────────────────── */

  async function handleChangePassword(e) {
    e.preventDefault();
    clearFeedback("change-feedback");

    const cur     = ((document.getElementById("change-current-password") || {}).value || "");
    const newPw   = ((document.getElementById("change-new-password") || {}).value || "").trim();
    const confirm = ((document.getElementById("change-confirm-password") || {}).value || "").trim();
    const ghToken = ((document.getElementById("change-github-token") || {}).value || "").trim();

    if (newPw || cur) {
      if (!(await verifyPassword(cur))) {
        feedback("change-feedback", "Current password is incorrect.");
        return;
      }
    }

    if (newPw) {
      if (newPw.length < 8) { feedback("change-feedback", "New password must be at least 8 characters."); return; }
      if (newPw !== confirm) { feedback("change-feedback", "Passwords do not match."); return; }
      await saveNewPassword(newPw);
    }

    if (ghToken !== undefined) {
      if (ghToken) {
        localStorage.setItem("seculex_github_token", ghToken);
        const userObj = JSON.stringify({ token: ghToken, backendName: "github" });
        localStorage.setItem("decap-cms-user", userObj);
        localStorage.setItem("netlify-cms-user", userObj);
      } else {
        localStorage.removeItem("seculex_github_token");
      }
    }

    audit("change", "Admin settings updated.");
    feedback("change-feedback", "Settings saved! Reloading editor...", "success");
    setTimeout(() => {
      document.getElementById("admin-change-modal")?.classList.remove("active");
      if (ghToken) window.location.reload();
    }, 1500);
  }

  /* ─── Analytics & Stats ──────────────────────────────────────── */

  let statsCurrentRange = 7;

  function statsShowState(state) {
    ["stats-loading", "stats-not-configured", "stats-error", "stats-dashboard"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = id === state ? "" : "none";
    });
  }

  function fmtNum(n) {
    if (n === null || n === undefined) return "—";
    return Number(n).toLocaleString();
  }

  function renderTrend(rows) {
    const chart = document.getElementById("stats-trend-chart");
    if (!chart || !rows.length) return;
    chart.innerHTML = "";
    const maxVal = Math.max(...rows.map(r => r.totalUsers || 0), 1);
    rows.forEach(row => {
      const val = row.totalUsers || 0;
      const pct = Math.max((val / maxVal) * 100, 3);
      const d   = String(row.date || "");
      const label = d.length === 8 ? d.slice(4,6) + "/" + d.slice(6,8) : d;
      const wrap = document.createElement("div");
      wrap.className = "admin-trend-bar-wrap";
      wrap.title = label + ": " + fmtNum(val) + " visitors";
      const bar = document.createElement("div");
      bar.className = "admin-trend-bar";
      bar.style.height = pct + "%";
      const lbl = document.createElement("div");
      lbl.className = "admin-trend-label";
      lbl.textContent = label;
      wrap.appendChild(bar);
      wrap.appendChild(lbl);
      chart.appendChild(wrap);
    });
  }

  function renderCountries(rows) {
    const tbody = document.getElementById("stats-countries-rows");
    if (!tbody) return;
    const total = rows.reduce((s, r) => s + (r.totalUsers || 0), 0) || 1;
    tbody.innerHTML = rows.slice(0, 10).map(r => {
      const pct = ((r.totalUsers / total) * 100).toFixed(1);
      return "<tr><td>" + (r.country || "(Unknown)") + "</td><td class=\"stat-num\">" + fmtNum(r.totalUsers) + "</td><td class=\"stat-share\">" + pct + "%</td></tr>";
    }).join("");
  }

  function renderPages(rows) {
    const tbody = document.getElementById("stats-pages-rows");
    if (!tbody) return;
    tbody.innerHTML = rows.slice(0, 10).map((r, i) => {
      const title = (r.pageTitle || r.pagePath || "Untitled").replace(" | SecuLex", "").replace(" - SecuLex", "");
      return "<tr><td class=\"stat-rank\">" + (i+1) + "</td><td title=\"" + (r.pagePath||"") + "\">" + title + "</td><td class=\"stat-num\">" + fmtNum(r.screenPageViews) + "</td><td class=\"stat-num\" style=\"color:var(--admin-text-secondary)\">" + fmtNum(r.totalUsers) + "</td></tr>";
    }).join("");
  }

  function renderDevices(rows) {
    const container = document.getElementById("stats-devices-bars");
    if (!container) return;
    const total = rows.reduce((s, r) => s + (r.totalUsers || 0), 0) || 1;
    const icons  = { desktop: "🖥️", mobile: "📱", tablet: "📟" };
    container.innerHTML = rows.map(r => {
      const pct    = ((r.totalUsers / total) * 100).toFixed(1);
      const device = (r.deviceCategory || "other").toLowerCase();
      return "<div class=\"admin-device-row\"><div class=\"admin-device-label\">" + (icons[device] || "💻") + " " + device + "</div><div class=\"admin-device-track\"><div class=\"admin-device-fill\" style=\"width:" + pct + "%\"></div></div><div class=\"admin-device-pct\">" + pct + "%</div></div>";
    }).join("");
  }

  async function loadAnalyticsDashboard(range) {
    statsCurrentRange = range;
    statsShowState("stats-loading");
    try {
      const res  = await fetch("/.netlify/functions/analytics-stats?range=" + range, {
        headers: { "x-admin-secret": ADMIN_FUNCTION_SECRET }
      });
      const data = await res.json();
      if (!res.ok) {
        statsShowState("stats-error");
        const errEl = document.getElementById("stats-error-msg");
        if (errEl) errEl.textContent = data.error || "Could not load analytics.";
        return;
      }
      if (!data.configured) { statsShowState("stats-not-configured"); return; }
      document.getElementById("stat-users").textContent     = fmtNum(data.summary?.users);
      document.getElementById("stat-pageviews").textContent = fmtNum(data.summary?.pageViews);
      document.getElementById("stat-sessions").textContent  = fmtNum(data.summary?.sessions);
      document.getElementById("stat-bounce").textContent    = data.summary?.bounceRate != null ? data.summary.bounceRate + "%" : "—";
      renderTrend(data.trend || []);
      renderCountries(data.countries || []);
      renderPages(data.topPages || []);
      renderDevices(data.devices || []);
      statsShowState("stats-dashboard");
    } catch (err) {
      statsShowState("stats-error");
      const errEl = document.getElementById("stats-error-msg");
      if (errEl) errEl.textContent = "Network error: " + err.message;
    }
  }

  function openStatsModal() {
    document.getElementById("admin-stats-modal")?.classList.add("active");
    loadAnalyticsDashboard(statsCurrentRange);
  }

  function closeStatsModal() {
    document.getElementById("admin-stats-modal")?.classList.remove("active");
  }

  /* ─── Publish All & Sync ─────────────────────────────────────── */

  async function handleSyncSite() {
    toast("Triggering site rebuild...", "fa-rotate");
    try {
      await fetch("/.netlify/functions/sync-site", {
        method: "POST",
        headers: { "x-admin-secret": ADMIN_FUNCTION_SECRET }
      });
      toast("✅ Rebuild triggered! Live in ~1–2 mins.", "fa-check-double");
    } catch { toast("⚠️ Could not reach rebuild function.", "fa-triangle-exclamation"); }
  }

  /* ─── Expose globals for CMS hooks ──────────────────────────── */
  window.seculexToast = toast;
  window.seculexAudit = audit;

  /* ─── Init ───────────────────────────────────────────────────── */

  async function init() {
    setupEyeToggles();
    setupCapsLock();
    setupIdleListener();

    // Event bindings
    document.getElementById("login-form")?.addEventListener("submit", handleLogin);
    document.getElementById("reset-form")?.addEventListener("submit", handleResetPassword);
    document.getElementById("change-password-form")?.addEventListener("submit", handleChangePassword);

    document.getElementById("btn-goto-reset")?.addEventListener("click", () => showView("reset"));
    document.getElementById("btn-back-to-login")?.addEventListener("click", () => showView("login"));
    document.getElementById("btn-send-reset-code")?.addEventListener("click", () => {
      feedback("reset-feedback", "Enter your administrative recovery key below to set a new password.", "success");
    });

    // Security bar buttons
    document.getElementById("bar-btn-stats")?.addEventListener("click", openStatsModal);
    document.getElementById("bar-btn-change")?.addEventListener("click", () => {
      const modal = document.getElementById("admin-change-modal");
      if (modal) {
        const ghInput = document.getElementById("change-github-token");
        if (ghInput) ghInput.value = localStorage.getItem("seculex_github_token") || "";
        modal.classList.add("active");
      }
    });
    document.getElementById("bar-btn-lock")?.addEventListener("click", () => {
      audit("logout", "Admin logged out manually.");
      lockPortal();
    });

    // Modal close buttons
    const closeChange = () => document.getElementById("admin-change-modal")?.classList.remove("active");
    document.getElementById("modal-btn-close-change")?.addEventListener("click", closeChange);
    document.getElementById("modal-btn-close-change-2")?.addEventListener("click", closeChange);

    const closeAudit = () => document.getElementById("admin-audit-modal")?.classList.remove("active");
    document.getElementById("modal-btn-close-audit")?.addEventListener("click", closeAudit);
    document.getElementById("modal-btn-close-audit-2")?.addEventListener("click", closeAudit);

    document.getElementById("modal-btn-close-stats")?.addEventListener("click", closeStatsModal);
    document.getElementById("modal-btn-close-stats-2")?.addEventListener("click", closeStatsModal);

    document.getElementById("btn-refresh-stats")?.addEventListener("click", () =>
      loadAnalyticsDashboard(statsCurrentRange)
    );
    document.querySelectorAll(".admin-stats-range-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".admin-stats-range-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        loadAnalyticsDashboard(parseInt(btn.dataset.range));
      });
    });

    document.getElementById("btn-clear-audit-logs")?.addEventListener("click", () => {
      if (confirm("Clear all audit logs? This cannot be undone.")) {
        localStorage.removeItem(KEY_AUDIT);
        renderAuditLogs();
      }
    });

    document.getElementById("modal-btn-close-audit-2")?.addEventListener("click", closeAudit);

    document.addEventListener("keydown", e => {
      if (e.key === "Escape") { closeChange(); closeAudit(); closeStatsModal(); }
    });

    // ── Check for existing valid session ──────────────────────────
    if (await sessionIsValid()) {
      await unlockPortal();
    } else {
      // Show login (already visible by default in HTML)
      lockPortal();
    }
  }

  // Boot
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

})();
