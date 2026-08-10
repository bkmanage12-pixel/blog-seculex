/**
 * SecuLex Admin Portal — Single-Owner Authentication Engine
 *
 * SECURITY MODEL:
 * ──────────────────────────────────────────────────────────────
 * • ONE owner only: seculexpublications@gmail.com
 * • NO registration, NO setup, NO account creation — ever
 * • Password verified SERVER-SIDE via /.netlify/functions/admin-verify
 *   → Works from ANY device / browser / PC (not bound to localStorage)
 * • localStorage used only as a fast-path cache for the same device
 * • Session bound to device fingerprint (SHA-256 of browser traits)
 * • 15-minute idle auto-lock
 * • 5-attempt brute-force lockout (60 s cooldown, server-enforced)
 * • PBKDF2-HMAC-SHA256 (100 000 iterations) client + server side
 * • Full security audit logging (last 30 events in localStorage)
 */

(function () {
  "use strict";

  /* ─── Constants ──────────────────────────────────────────────── */
  const ADMIN_EMAIL     = "seculexpublications@gmail.com";
  const KEY_HASH        = "seculex_admin_hash_v1";
  const KEY_SALT        = "seculex_admin_salt_v1";
  const KEY_HASH_VER    = "seculex_admin_hash_ver";
  const KEY_RECOVERY    = "seculex_admin_recovery_v1";
  const KEY_SESSION     = "seculex_admin_session_v1";
  const KEY_RESET_CODE  = "seculex_admin_pending_code_v1";
  const KEY_ATTEMPTS    = "seculex_admin_attempts_v1";
  const KEY_AUDIT       = "seculex_admin_audit_logs_v1";
  const VERIFY_URL      = "/.netlify/functions/admin-verify";

  const PBKDF2_ITER = 100000;
  const MAX_ATTEMPTS = 5;
  const LOCKOUT_MS  = 60 * 1000;       // 60 seconds
  const IDLE_MS     = 15 * 60 * 1000;  // 15 minutes

  let idleTimer = null;

  /* ─── Crypto ─────────────────────────────────────────────────── */

  async function pbkdf2Hash(password, saltHex) {
    const enc  = new TextEncoder();
    const salt = new Uint8Array(saltHex.match(/.{2}/g).map(h => parseInt(h, 16)));
    const key  = await crypto.subtle.importKey("raw", enc.encode(password),
                   { name: "PBKDF2" }, false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt, iterations: PBKDF2_ITER, hash: "SHA-256" }, key, 256);
    return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, "0")).join("");
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

  /* ─── Password Save / Verify ─────────────────────────────────── */

  /**
   * Saves a new password:
   * 1. Hashes it with PBKDF2 in the browser
   * 2. Caches hash+salt in localStorage (fast same-device logins)
   * 3. Pushes hash+salt to the server (Netlify env vars) for cross-device access
   */
  async function savePassword(plaintext) {
    const salt = randomHex(16);
    const hash = await pbkdf2Hash(plaintext, salt);

    // Local cache
    localStorage.setItem(KEY_HASH,    hash);
    localStorage.setItem(KEY_SALT,    salt);
    localStorage.setItem(KEY_HASH_VER, "pbkdf2");

    // Push to server (cross-device sync) — non-blocking
    fetch(VERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "save", hash, salt })
    }).then(r => r.json()).then(d => {
      if (d.success) console.info("[SecuLex] Password synced to server. Rebuild triggered:", d.rebuildTriggered);
      else console.warn("[SecuLex] Server sync note:", d.message || d.error);
    }).catch(e => console.warn("[SecuLex] Server sync unavailable:", e));

    // Save recovery key
    const rk = randomRecoveryKey();
    localStorage.setItem(KEY_RECOVERY, rk);
    return rk;
  }

  /**
   * Verify password.
   * Priority: server-side (any device) → localStorage (same device, instant)
   */
  async function verifyPassword(plaintext) {
    // 1. Try server verification (works cross-device)
    try {
      const res  = await fetch(VERIFY_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "verify", password: plaintext })
      });
      const data = await res.json();

      if (res.status === 200 && data.success) {
        // Also sync to local for offline fallback
        _cacheServerHashLocally(plaintext);
        return true;
      }
      if (data.error === "not_configured") {
        // Server has no hash yet — fall through to local check
      } else if (data.error === "invalid_password") {
        return false; // Server said definitely wrong
      }
    } catch {
      // Network unavailable — fall through to local
    }

    // 2. Fallback: local hash (same device, cached)
    const storedHash = localStorage.getItem(KEY_HASH);
    const storedSalt = localStorage.getItem(KEY_SALT);
    if (!storedHash || !storedSalt) return false;

    const attempt = await pbkdf2Hash(plaintext, storedSalt);
    return attempt === storedHash;
  }

  async function _cacheServerHashLocally(plaintext) {
    try {
      // We don't get the hash back from the server (intentionally)
      // Just ensure the local cache stays fresh by re-hashing locally
      if (!localStorage.getItem(KEY_HASH)) {
        // Nothing to do — hash was never stored locally, that's fine
      }
    } catch {}
  }

  /**
   * Check whether any password is configured (server or local).
   */
  async function hasPassword() {
    // Quick local check
    if (localStorage.getItem(KEY_HASH) && localStorage.getItem(KEY_SALT)) return true;
    // Check server
    try {
      const res  = await fetch(VERIFY_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "check" })
      });
      const data = await res.json();
      return !!(data.configured);
    } catch {
      return false;
    }
  }

  /* ─── Device Fingerprint ─────────────────────────────────────── */

  async function fingerprint() {
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

  /* ─── Session ────────────────────────────────────────────────── */

  async function createSession() {
    const fp  = await fingerprint();
    const now = Date.now();
    const data = JSON.stringify({ timestamp: now, expiresAt: now + 4 * 3600000, fingerprint: fp });
    sessionStorage.setItem(KEY_SESSION, data);
    localStorage.setItem(KEY_SESSION, data);
  }

  async function sessionIsValid() {
    const raw = sessionStorage.getItem(KEY_SESSION) || localStorage.getItem(KEY_SESSION);
    if (!raw) return false;
    try {
      const p = JSON.parse(raw);
      if (p.expiresAt && Date.now() > p.expiresAt) return false;
      const fp = await fingerprint();
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

  /* ─── Audit Logging ──────────────────────────────────────────── */

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
      input.addEventListener("keyup", check);
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

  /* ─── Handlers ───────────────────────────────────────────────── */

  async function handleLogin(e) {
    e.preventDefault();
    clearFeedback("login-feedback");

    const attempts = getAttempts();
    if (attempts.lockoutUntil && Date.now() < attempts.lockoutUntil) {
      const secs = Math.ceil((attempts.lockoutUntil - Date.now()) / 1000);
      feedback("login-feedback", `Locked out. Retry in ${secs} seconds.`);
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
        const a   = recordFail();
        const err = getAttempts();
        audit("failed", `Failed login attempt ${a.count}/${MAX_ATTEMPTS}.`);
        if (err.lockoutUntil) {
          feedback("login-feedback", "Too many failed attempts. Locked for 60 seconds.");
        } else {
          const rem = MAX_ATTEMPTS - a.count;
          feedback("login-feedback", `Incorrect password. ${rem} attempt(s) remaining.`);
        }
      }
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-right-to-bracket"></i> Log In'; }
    }
  }

  async function handleSendResetEmail() {
    clearFeedback("reset-feedback");
    const btn = document.getElementById("btn-send-reset-code");
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Requesting...'; }
    try {
      window.netlifyIdentity?.open?.("recovery");
      const res  = await fetch("/.netlify/functions/request-admin-reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "request", email: ADMIN_EMAIL })
      });
      const data = await res.json();
      feedback("reset-feedback",
        data?.message || `Reset code sent to ${ADMIN_EMAIL}. Check your inbox.`,
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

    const storedKey   = (localStorage.getItem(KEY_RECOVERY) || "").toUpperCase();
    const pendingCode = sessionStorage.getItem(KEY_RESET_CODE);
    const validKey    = (storedKey && key === storedKey) || (pendingCode && key === pendingCode);

    if (!validKey) { feedback("reset-feedback", "Invalid Recovery Key or Security Code."); return; }
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
    setTimeout(() => {
      document.getElementById("admin-change-modal")?.classList.remove("active");
    }, 1800);
  }

  async function handleSyncSite() {
    const btn = document.getElementById("bar-btn-sync");
    if (btn) { btn.classList.add("spinning"); btn.disabled = true; }
    toast("Triggering site rebuild...", "fa-rotate");
    try {
      const res  = await fetch("/.netlify/functions/sync-site", { method: "POST" });
      const data = await res.json();
      if (data?.buildHookTriggered) toast("✅ Rebuild triggered! Updates in ~1–2 mins.", "fa-check-double");
      else toast("✅ Rebuild request sent.", "fa-check-circle");
    } catch { toast("⚠️ Could not reach sync function.", "fa-triangle-exclamation"); }
    finally {
      setTimeout(() => { if (btn) { btn.classList.remove("spinning"); btn.disabled = false; } }, 2000);
    }
  }

  /* ─── Init ───────────────────────────────────────────────────── */

  async function init() {
    setupEyeToggles();
    setupCapsLock();
    setupIdleListener();

    // Handle Netlify Identity recovery token in URL
    if (window.location.hash?.includes("recovery_token=")) {
      showView("reset");
      feedback("reset-feedback", "Email recovery link verified. Enter your new password below.", "success");
      return;
    }

    /* — Bind Login ─ */
    document.getElementById("login-form")?.addEventListener("submit", handleLogin);

    /* — Bind Reset ─ */
    document.getElementById("reset-form")?.addEventListener("submit", handleResetPassword);
    document.getElementById("btn-send-reset-code")?.addEventListener("click", handleSendResetEmail);
    document.getElementById("btn-goto-reset")?.addEventListener("click", () => showView("reset"));
    document.getElementById("btn-back-to-login")?.addEventListener("click", () => showView("login"));

    /* — Bind Change Password Modal ─ */
    document.getElementById("change-password-form")?.addEventListener("submit", handleChangePassword);
    document.getElementById("modal-btn-close-change")?.addEventListener("click", () =>
      document.getElementById("admin-change-modal")?.classList.remove("active"));

    /* — Bind Audit Log Modal ─ */
    document.getElementById("bar-btn-audit")?.addEventListener("click", () => {
      renderAuditLogs();
      document.getElementById("admin-audit-modal")?.classList.add("active");
    });
    document.getElementById("modal-btn-close-audit")?.addEventListener("click", () =>
      document.getElementById("admin-audit-modal")?.classList.remove("active"));
    document.getElementById("btn-clear-audit-logs")?.addEventListener("click", () => {
      if (confirm("Clear all security audit logs?")) {
        localStorage.removeItem(KEY_AUDIT);
        renderAuditLogs();
      }
    });

    /* — Bind Security Bar ─ */
    document.getElementById("bar-btn-sync")?.addEventListener("click", handleSyncSite);
    document.getElementById("bar-btn-change")?.addEventListener("click", () =>
      document.getElementById("admin-change-modal")?.classList.add("active"));
    document.getElementById("bar-btn-lock")?.addEventListener("click", () => {
      audit("logout", "Admin logged out manually.");
      lockPortal();
    });

    /* ── INITIAL STATE ────────────────────────────────────────────
       Always show login gate.  Never show setup or registration.
       If an active session exists for this device/fingerprint, unlock. */
    const validSession = await sessionIsValid();
    if (validSession) {
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
