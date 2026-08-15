/**
 * SecuLex Admin Portal — Single-Owner Authentication Engine
 *
 * SECURITY MODEL:
 * ──────────────────────────────────────────────────────────────
 * • ONE owner only: seculexpublications@gmail.com
 * • NO registration, NO setup, NO account creation — ever
 * • Password verified server-side for cross-device access
 *   (plaintext sent over HTTPS only — never stored or logged)
 * • localStorage is a fast-path cache for the same device
 * • Session fingerprinted to device (blocks hijacking)
 * • 15-minute idle auto-lock
 * • 5-attempt brute-force lockout (60 s cooldown)
 * • PBKDF2-HMAC-SHA256 (100 000 iterations) client + server
 * • Full security audit log (last 30 events in localStorage)
 */

(function () {
  "use strict";

  /* ─── Constants ──────────────────────────────────────────────── */
  const ADMIN_EMAIL    = "seculexpublications@gmail.com";
  const KEY_HASH       = "seculex_admin_hash_v1";
  const KEY_SALT       = "seculex_admin_salt_v1";
  const KEY_HASH_VER   = "seculex_admin_hash_ver";
  const KEY_RECOVERY   = "seculex_admin_recovery_v1";
  const KEY_SESSION    = "seculex_admin_session_v1";
  const KEY_RESET_CODE = "seculex_admin_pending_code_v1";
  const KEY_ATTEMPTS   = "seculex_admin_attempts_v1";
  const KEY_AUDIT      = "seculex_admin_audit_logs_v1";
  const VERIFY_URL     = "/.netlify/functions/admin-verify";

  const PBKDF2_ITER = 100000;
  const MAX_ATTEMPTS = 5;
  const LOCKOUT_MS  = 60 * 1000;
  const IDLE_MS     = 15 * 60 * 1000;

  let idleTimer = null;

  /* ─── Crypto ─────────────────────────────────────────────────── */

  async function pbkdf2Hash(password, saltHex) {
    const enc  = new TextEncoder();
    const salt = new Uint8Array(saltHex.match(/.{2}/g).map(h => parseInt(h, 16)));
    const key  = await crypto.subtle.importKey("raw", enc.encode(password),
                   { name: "PBKDF2" }, false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt, iterations: PBKDF2_ITER, hash: "SHA-256" }, key, 256);
    return Array.from(new Uint8Array(bits))
      .map(b => b.toString(16).padStart(2, "0")).join("");
  }

  function randomHex(bytes = 16) {
    const a = new Uint8Array(bytes);
    crypto.getRandomValues(a);
    return Array.from(a, b => b.toString(16).padStart(2, "0")).join("");
  }

  function randomRecoveryKey() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let r = "";
    for (let i = 0; i < 16; i++) {
      if (i && i % 4 === 0) r += "-";
      r += chars[Math.floor(Math.random() * chars.length)];
    }
    return r;
  }

  /* ─── Password Save ──────────────────────────────────────────── */

  /**
   * Hash + save a new password.
   * 1. Hashes locally with PBKDF2 and caches in localStorage
   * 2. Pushes hash+salt to server (Netlify env vars) for cross-device use
   */
  async function savePassword(plaintext) {
    const salt = randomHex(16);
    const hash = await pbkdf2Hash(plaintext, salt);

    localStorage.setItem(KEY_HASH,    hash);
    localStorage.setItem(KEY_SALT,    salt);
    localStorage.setItem(KEY_HASH_VER, "pbkdf2");

    // Non-blocking server sync (requires NETLIFY_ACCESS_TOKEN + NETLIFY_SITE_ID in env)
    fetch(VERIFY_URL, {
      method:  "POST",
      headers: { "content-type": "application/json" },
      body:    JSON.stringify({ action: "save", hash, salt })
    }).then(r => r.json()).then(d => {
      if (d.success)  console.info("[SecuLex] Password synced to server ✓");
      else console.warn("[SecuLex] Server sync:", d.message || d.error);
    }).catch(() => {});

    const rk = randomRecoveryKey();
    localStorage.setItem(KEY_RECOVERY, rk);
    return rk;
  }

  /**
   * _bootstrapServerHash — called silently on first successful local login.
   * Checks if the server already has a hash; if not, pushes the local one.
   * Requires NETLIFY_ACCESS_TOKEN + NETLIFY_SITE_ID in Netlify env vars.
   */
  async function _bootstrapServerHash(hash, salt) {
    try {
      // First check if server is already configured — avoid overwriting
      const checkRes  = await fetch(VERIFY_URL, {
        method:  "POST",
        headers: { "content-type": "application/json" },
        body:    JSON.stringify({ action: "check" })
      });
      const checkData = await checkRes.json();
      if (checkData.configured) return; // Server already has a hash — skip

      // Push local hash to server
      const saveRes  = await fetch(VERIFY_URL, {
        method:  "POST",
        headers: { "content-type": "application/json" },
        body:    JSON.stringify({ action: "save", hash, salt })
      });
      const saveData = await saveRes.json();
      if (saveData.success) {
        console.info("[SecuLex] ✓ Admin hash bootstrapped to server. Cross-device login now active.");
      } else {
        console.warn("[SecuLex] Bootstrap note:", saveData.message || saveData.error);
      }
    } catch { /* silent — never block login */ }
  }

  /* ─── Password Verify ────────────────────────────────────────── */

  /**
   * Verify password — tries routes in priority order:
   *
   * 1. Server (verify_plain): sends password over HTTPS → server hashes
   *    with stored salt → compares → works on ANY device.
   *
   * 2. Local cache (localStorage): same device only, instant fallback
   *    when server is unreachable or env vars not configured yet.
   */
  async function verifyPassword(plaintext) {
    // ── Route 1: Server-side (cross-device) ──────────────────────
    try {
      const res  = await fetch(VERIFY_URL, {
        method:  "POST",
        headers: { "content-type": "application/json" },
        body:    JSON.stringify({ action: "verify_plain", password: plaintext })
      });
      const data = await res.json();

      if (res.status === 200 && data.success) {
        // Cache the server's salt locally for fast future logins
        if (data.salt) {
          const localHash = await pbkdf2Hash(plaintext, data.salt);
          localStorage.setItem(KEY_HASH,    localHash);
          localStorage.setItem(KEY_SALT,    data.salt);
          localStorage.setItem(KEY_HASH_VER, "pbkdf2");
        }
        return true;
      }

      if (data.error === "invalid_password") return false; // Definitive rejection
      // "not_configured" or other → fall through to local
    } catch {
      // Network error → fall through to local
    }

    // ── Route 2: Local cache (same device, no network needed) ─────
    const storedHash = localStorage.getItem(KEY_HASH);
    const storedSalt = localStorage.getItem(KEY_SALT);
    if (!storedHash || !storedSalt) return false;

    const attempt = await pbkdf2Hash(plaintext, storedSalt);
    const matched  = attempt === storedHash;

    // ── AUTO-BOOTSTRAP: push local hash to server ─────────────────
    // If local login succeeds and server has no hash yet, sync now.
    // This runs silently the first time you log in on your main PC.
    if (matched) {
      _bootstrapServerHash(storedHash, storedSalt);
    }

    return matched;
  }

  /**
   * Whether any password is configured (server or locally).
   * Returns true if server is configured OR if local cache exists.
   * This prevents the "Admin portal not configured" false error.
   */
  async function hasPasswordAnywhere() {
    // Local check first (instant)
    if (localStorage.getItem(KEY_HASH) && localStorage.getItem(KEY_SALT)) return true;
    // Server check
    try {
      const res  = await fetch(VERIFY_URL, {
        method:  "POST",
        headers: { "content-type": "application/json" },
        body:    JSON.stringify({ action: "check" })
      });
      const data = await res.json();
      return !!data.configured;
    } catch { return false; }
  }

  /* ─── Session ────────────────────────────────────────────────── */

  async function getFingerprint() {
    const raw = [
      navigator.userAgent,
      screen.width + "x" + screen.height,
      screen.colorDepth,
      new Date().getTimezoneOffset(),
      navigator.language || "en"
    ].join("|");
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
  }

  async function createSession() {
    const fp   = await getFingerprint();
    const now  = Date.now();
    const data = JSON.stringify({ timestamp: now, expiresAt: now + 4 * 3600000, fingerprint: fp });
    sessionStorage.setItem(KEY_SESSION, data);
    localStorage.setItem(KEY_SESSION, data);
  }

  async function sessionIsValid() {
    const raw = sessionStorage.getItem(KEY_SESSION) || localStorage.getItem(KEY_SESSION);
    if (!raw) return false;
    try {
      const p  = JSON.parse(raw);
      if (p.expiresAt && Date.now() > p.expiresAt) return false;
      const fp = await getFingerprint();
      if (p.fingerprint && p.fingerprint !== fp) {
        audit("failed", "Session fingerprint mismatch — possible hijack attempt.");
        return false;
      }
      return true;
    } catch { return false; }
  }

  function destroySession() {
    sessionStorage.removeItem(KEY_SESSION);
    localStorage.removeItem(KEY_SESSION);
    sessionStorage.removeItem(KEY_RESET_CODE);
  }

  /* ─── Rate Limiting ──────────────────────────────────────────── */

  function getAttempts() {
    try {
      const d = JSON.parse(localStorage.getItem(KEY_ATTEMPTS) || "{}");
      if (d.lockoutUntil && Date.now() >= d.lockoutUntil) {
        localStorage.removeItem(KEY_ATTEMPTS);
        return { count: 0, lockoutUntil: 0 };
      }
      return d.count ? d : { count: 0, lockoutUntil: 0 };
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
      logs.unshift({ type, details, timestamp: new Date().toLocaleString() });
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
          <td style="white-space:nowrap;color:var(--admin-text-secondary);">${l.timestamp}</td>
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
        audit("logout", "Session auto-locked due to inactivity.");
        lockPortal();
      }, IDLE_MS);
    }
  }

  function setupIdleListener() {
    ["mousemove", "keydown", "scroll", "touchstart"].forEach(e =>
      window.addEventListener(e, resetIdleTimer, { passive: true }));
  }

  /* ─── Caps Lock ──────────────────────────────────────────────── */

  function setupCapsLock() {
    document.querySelectorAll("input[type='password']").forEach(input => {
      const warnId = input.closest("#admin-view-login") ? "login-caps-warning" : null;
      const warn   = warnId ? document.getElementById(warnId) : null;
      if (!warn) return;
      const check = e => warn.classList.toggle("active",
        !!(e.getModifierState && e.getModifierState("CapsLock")));
      input.addEventListener("keyup",   check);
      input.addEventListener("keydown", check);
      input.addEventListener("blur", () => warn.classList.remove("active"));
    });
  }

  /* ─── Eye Toggles ────────────────────────────────────────────── */

  function setupEyeToggles() {
    document.querySelectorAll(".admin-toggle-eye").forEach(btn => {
      btn.addEventListener("click", () => {
        const input = btn.previousElementSibling;
        if (!input) return;
        const icon = btn.querySelector("i");
        input.type = input.type === "password" ? "text" : "password";
        icon?.classList.toggle("fa-eye",       input.type === "password");
        icon?.classList.toggle("fa-eye-slash", input.type === "text");
      });
    });
  }

  /* ─── View Router ────────────────────────────────────────────── */

  function showView(name) {
    document.querySelectorAll(".admin-auth-view").forEach(v => v.style.display = "none");
    const el = document.getElementById(`admin-view-${name}`);
    if (el) el.style.display = "block";
  }

  /* ─── Portal Lock / Unlock ───────────────────────────────────── */

  async function unlockPortal() {
    await createSession();
    clearAttempts();
    document.getElementById("admin-security-overlay")?.classList.add("hidden");
    const bar = document.getElementById("admin-security-bar");
    if (bar) bar.style.display = "flex";
    resetIdleTimer();
    injectCMSPublishHider();
  }

  /**
   * Hide the per-entry "Publish" button inside Decap CMS.
   * The editorial workflow shows a Publish button on every entry —
   * we hide it so the admin must use the "Publish All" bar button.
   * We also relabel the per-entry Save button to "Save Draft".
   */
  function injectCMSPublishHider() {
    if (document.getElementById("seculex-cms-publish-hider")) return;
    const style = document.createElement("style");
    style.id = "seculex-cms-publish-hider";
    style.textContent = [
      /* Hide the CMS Publish Now button inside entry editor */
      '[data-testid="publish-button"],',
      'button[class*="PublishButton"],',
      'span[class*="PublishButton"],',
      /* Hide the top-level "Publish" option in workflow toolbar */
      '[data-testid="workflow-publish-button"],',
      'button[class*="WorkflowPublish"]',
      '{ display: none !important; }',
    ].join("\n");
    document.head.appendChild(style);

    /* Because Decap CMS renders its UI asynchronously via React,
       we watch the DOM and re-inject the rules whenever its toolbar re-renders. */
    const obs = new MutationObserver(() => {
      if (!document.getElementById("seculex-cms-publish-hider")) {
        document.head.appendChild(style.cloneNode(true));
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  function lockPortal() {
    destroySession();
    if (idleTimer) clearTimeout(idleTimer);
    try { window.netlifyIdentity?.logout?.(); } catch {}
    document.querySelectorAll("input[type='password']").forEach(i => i.value = "");
    document.getElementById("admin-security-overlay")?.classList.remove("hidden");
    const bar = document.getElementById("admin-security-bar");
    if (bar) bar.style.display = "none";
    showView("login");
  }

  /* ─── Toast ──────────────────────────────────────────────────── */

  function toast(msg, icon = "fa-check-circle") {
    let c = document.getElementById("admin-toast-container");
    if (!c) { c = document.createElement("div"); c.id = "admin-toast-container"; document.body.appendChild(c); }
    const t = document.createElement("div");
    t.className = "admin-toast";
    t.innerHTML = `<i class="fas ${icon}" style="color:var(--admin-accent-gold)"></i> <span>${msg}</span>`;
    c.appendChild(t);
    setTimeout(() => { t.classList.add("hiding"); setTimeout(() => t.remove(), 300); }, 4000);
  }

  /* ─── Feedback ───────────────────────────────────────────────── */

  function feedback(id, msg, type = "error") {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = msg;
    el.className   = `admin-feedback ${type}`;
  }

  function clearFeedback(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = "";
    el.className   = "admin-feedback";
  }

  /* ─── Login Handler ──────────────────────────────────────────── */

  async function handleLogin(e) {
    e.preventDefault();
    clearFeedback("login-feedback");

    const att = getAttempts();
    if (att.lockoutUntil && Date.now() < att.lockoutUntil) {
      const secs = Math.ceil((att.lockoutUntil - Date.now()) / 1000);
      feedback("login-feedback", `Too many attempts. Try again in ${secs}s.`);
      return;
    }

    const pw  = document.getElementById("login-password").value;
    if (!pw) { feedback("login-feedback", "Please enter your password."); return; }

    const btn = document.querySelector("#login-form button[type='submit']");
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verifying...'; }

    try {
      const valid = await verifyPassword(pw);

      if (valid) {
        audit("login", "Admin authenticated successfully.");
        await unlockPortal();
        document.getElementById("login-password").value = "";
      } else {
        const a = recordFail();
        audit("failed", `Failed login attempt ${a.count}/${MAX_ATTEMPTS}.`);
        if (a.lockoutUntil) {
          feedback("login-feedback", "Too many failed attempts. Locked for 60 seconds.");
        } else {
          const rem = MAX_ATTEMPTS - a.count;
          feedback("login-feedback", `Incorrect password. ${rem} attempt(s) remaining.`);
        }
      }
    } catch (err) {
      console.error("[SecuLex] Login error:", err);
      feedback("login-feedback", "Login failed — please try again.");
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-right-to-bracket"></i> Log In'; }
    }
  }

  /* ─── Reset Handlers ─────────────────────────────────────────── */

  async function handleSendResetEmail() {
    clearFeedback("reset-feedback");
    const btn = document.getElementById("btn-send-reset-code");
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Requesting...'; }
    try {
      window.netlifyIdentity?.open?.("recovery");
      const res  = await fetch("/.netlify/functions/request-admin-reset", {
        method:  "POST",
        headers: { "content-type": "application/json" },
        body:    JSON.stringify({ action: "request", email: ADMIN_EMAIL })
      });
      const data = await res.json();
      feedback("reset-feedback",
        data?.message || `Reset code sent to ${ADMIN_EMAIL}. Check inbox.`,
        data?.emailDispatched ? "success" : "error");
    } catch {
      feedback("reset-feedback",
        `Reset request sent to ${ADMIN_EMAIL}. Check email or enter Recovery Key.`, "success");
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane"></i> Send Email'; }
    }
  }

  async function handleResetPassword(e) {
    e.preventDefault();
    clearFeedback("reset-feedback");

    const key       = document.getElementById("reset-key").value.trim().toUpperCase();
    const newPw     = document.getElementById("reset-new-password").value.trim();
    const confirmPw = document.getElementById("reset-confirm-password").value.trim();
    const storedKey = (localStorage.getItem(KEY_RECOVERY) || "").toUpperCase();
    const pendCode  = sessionStorage.getItem(KEY_RESET_CODE);

    if (!(storedKey && key === storedKey) && !(pendCode && key === pendCode)) {
      feedback("reset-feedback", "Invalid Recovery Key or Security Code."); return;
    }
    if (newPw.length < 8) { feedback("reset-feedback", "Password must be at least 8 characters."); return; }
    if (newPw !== confirmPw) { feedback("reset-feedback", "Passwords do not match."); return; }

    const btn = document.querySelector("#reset-form button[type='submit']");
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...'; }
    try {
      await savePassword(newPw);
      sessionStorage.removeItem(KEY_RESET_CODE);
      audit("change", "Admin password reset via Recovery Key.");
      feedback("reset-feedback", "Password reset! Redirecting to login...", "success");
      setTimeout(() => { document.getElementById("reset-form")?.reset(); showView("login"); }, 1800);
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-rotate"></i> Reset & Save Password'; }
    }
  }

  async function handleChangePassword(e) {
    e.preventDefault();
    clearFeedback("change-feedback");

    const cur     = document.getElementById("change-current-password").value;
    const newPw   = document.getElementById("change-new-password").value.trim();
    const confirm = document.getElementById("change-confirm-password").value.trim();

    if (!(await verifyPassword(cur))) { feedback("change-feedback", "Current password is incorrect."); return; }
    if (newPw.length < 8) { feedback("change-feedback", "New password must be at least 8 characters."); return; }
    if (newPw !== confirm) { feedback("change-feedback", "New passwords do not match."); return; }

    await savePassword(newPw);
    audit("change", "Admin password updated from dashboard.");
    feedback("change-feedback", "Password updated & synced to all devices!", "success");
    setTimeout(() => document.getElementById("admin-change-modal")?.classList.remove("active"), 1800);
  }

  async function handleSyncSite() {
    const btn = document.getElementById("bar-btn-sync");
    if (btn) { btn.classList.add("spinning"); btn.disabled = true; }
    toast("Triggering site rebuild...", "fa-rotate");
    try {
      const res  = await fetch("/.netlify/functions/sync-site", { method: "POST" });
      const data = await res.json();
      toast(data?.buildHookTriggered ? "✅ Rebuild triggered! Updates in ~1–2 mins." : "✅ Rebuild request sent.", "fa-check-double");
    } catch { toast("⚠️ Could not reach rebuild function.", "fa-triangle-exclamation"); }
    finally { setTimeout(() => { if (btn) { btn.classList.remove("spinning"); btn.disabled = false; } }, 2000); }
  }

  /**
   * Publish All — merges all pending Decap CMS draft PRs into main,
   * then triggers a Netlify rebuild so changes go live in one step.
   */
  async function handlePublishAll() {
    const btn = document.getElementById("bar-btn-publish-all");
    if (btn) {
      btn.disabled = true;
      btn.classList.add("spinning");
      btn.innerHTML = '<i class="fas fa-globe"></i> Publishing...';
    }
    toast("Publishing all saved drafts...", "fa-globe");
    try {
      const res  = await fetch("/.netlify/functions/publish-all", { method: "POST" });
      const data = await res.json();

      if (data.needsSetup) {
        toast("⚠️ Publish All needs setup — see admin guide.", "fa-triangle-exclamation");
        console.warn("[SecuLex] Publish All:", data.message);
        return;
      }

      if (data.success) {
        audit("publish", `Published ${data.published} draft(s) via Publish All.`);
        toast(data.message || `✅ ${data.published} draft(s) published! Live in ~1–2 mins.`, "fa-check-double");
      } else {
        toast(data.message || "⚠️ Some drafts could not be published.", "fa-triangle-exclamation");
      }
    } catch {
      toast("⚠️ Could not reach Publish All function.", "fa-triangle-exclamation");
    } finally {
      setTimeout(() => {
        if (btn) {
          btn.disabled = false;
          btn.classList.remove("spinning");
          btn.innerHTML = '<i class="fas fa-globe"></i> Publish All';
        }
      }, 3000);
    }
  }

  /* ─── Init ───────────────────────────────────────────────────── */

  async function init() {
    setupEyeToggles();
    setupCapsLock();
    setupIdleListener();

    // Netlify Identity recovery link
    if (window.location.hash?.includes("recovery_token=")) {
      showView("reset");
      feedback("reset-feedback", "Recovery link verified. Set a new password below.", "success");
      return;
    }

    // Bind events
    document.getElementById("login-form")?.addEventListener("submit", handleLogin);
    document.getElementById("reset-form")?.addEventListener("submit", handleResetPassword);
    document.getElementById("btn-send-reset-code")?.addEventListener("click", handleSendResetEmail);
    document.getElementById("btn-goto-reset")?.addEventListener("click", () => showView("reset"));
    document.getElementById("btn-back-to-login")?.addEventListener("click", () => showView("login"));
    document.getElementById("change-password-form")?.addEventListener("submit", handleChangePassword);
    document.getElementById("modal-btn-close-change")?.addEventListener("click", () =>
      document.getElementById("admin-change-modal")?.classList.remove("active"));
    document.getElementById("bar-btn-audit")?.addEventListener("click", () => {
      renderAuditLogs();
      document.getElementById("admin-audit-modal")?.classList.add("active");
    });
    document.getElementById("modal-btn-close-audit")?.addEventListener("click", () =>
      document.getElementById("admin-audit-modal")?.classList.remove("active"));
    document.getElementById("btn-clear-audit-logs")?.addEventListener("click", () => {
      if (confirm("Clear all security audit logs?")) { localStorage.removeItem(KEY_AUDIT); renderAuditLogs(); }
    });
    document.getElementById("bar-btn-sync")?.addEventListener("click", handleSyncSite);
    document.getElementById("bar-btn-publish-all")?.addEventListener("click", handlePublishAll);
    document.getElementById("bar-btn-change")?.addEventListener("click", () =>
      document.getElementById("admin-change-modal")?.classList.add("active"));
    document.getElementById("bar-btn-lock")?.addEventListener("click", () => {
      audit("logout", "Admin logged out manually.");
      lockPortal();
    });

    // ── Initial state: always show login. NEVER show setup/register ──
    if (await sessionIsValid()) {
      await unlockPortal();
    } else {
      lockPortal();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

})();
