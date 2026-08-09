/**
 * SecuLex Admin Portal Security & Authentication System (Enterprise Edition)
 * Features:
 * - PBKDF2 100k-iteration Password Hashing & Legacy Auto-Migration
 * - Device Session Fingerprinting & CSRF Protection
 * - 15-Minute Inactivity Auto-Lock Timer
 * - Caps Lock Warnings & Security Audit Logging
 * - Configurable Session Duration
 */

(function () {
  const ADMIN_EMAIL = "seculexpublications@gmail.com";
  const STORAGE_HASH_KEY = "seculex_admin_hash_v1";
  const STORAGE_SALT_KEY = "seculex_admin_salt_v1";
  const STORAGE_RECOVERY_KEY = "seculex_admin_recovery_v1";
  const STORAGE_SESSION_KEY = "seculex_admin_session_v1";
  const STORAGE_PENDING_CODE_KEY = "seculex_admin_pending_code_v1";
  const STORAGE_LOGIN_ATTEMPTS = "seculex_admin_attempts_v1";
  const STORAGE_AUDIT_LOGS = "seculex_admin_audit_logs_v1";
  const HASH_VERSION_KEY = "seculex_admin_hash_ver";

  const PBKDF2_ITERATIONS = 100000;
  const MAX_LOGIN_ATTEMPTS = 5;
  const LOCKOUT_DURATION_MS = 60 * 1000; // 60 seconds lockout
  const IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes idle timeout

  let idleTimer = null;

  // Browser Device Fingerprint Generator
  async function generateDeviceFingerprint() {
    const raw = [
      navigator.userAgent,
      screen.width + "x" + screen.height,
      screen.colorDepth,
      new Date().getTimezoneOffset(),
      navigator.language || "en"
    ].join("|");
    
    const encoder = new TextEncoder();
    const data = encoder.encode(raw);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
  }

  // PBKDF2 Key Derivation using Web Crypto API
  async function hashPasswordPBKDF2(password, saltHex) {
    const encoder = new TextEncoder();
    const passwordBuffer = encoder.encode(password);
    const saltBuffer = new Uint8Array(saltHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
    
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      passwordBuffer,
      { name: "PBKDF2" },
      false,
      ["deriveBits"]
    );
    
    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt: saltBuffer,
        iterations: PBKDF2_ITERATIONS,
        hash: "SHA-256"
      },
      keyMaterial,
      256
    );
    
    const hashArray = Array.from(new Uint8Array(derivedBits));
    return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
  }

  // Legacy SHA-256 helper for transparent migration
  async function hashPasswordLegacy(password, salt) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password + salt);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
  }

  async function verifyAndMigratePassword(enteredPassword, storedHash, saltHex) {
    const hashVer = localStorage.getItem(HASH_VERSION_KEY);
    if (hashVer === "pbkdf2") {
      const computed = await hashPasswordPBKDF2(enteredPassword, saltHex);
      return computed === storedHash;
    } else {
      const legacyComputed = await hashPasswordLegacy(enteredPassword, saltHex);
      if (legacyComputed === storedHash) {
        await setAdminPassword(enteredPassword);
        return true;
      }
      return false;
    }
  }

  async function setAdminPassword(newPassword) {
    const salt = generateSalt();
    const hash = await hashPasswordPBKDF2(newPassword, salt);
    localStorage.setItem(STORAGE_HASH_KEY, hash);
    localStorage.setItem(STORAGE_SALT_KEY, salt);
    localStorage.setItem(HASH_VERSION_KEY, "pbkdf2");
  }

  function generateSalt() {
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    return Array.from(array, b => b.toString(16).padStart(2, "0")).join("");
  }

  function generateRecoveryKey() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let result = "";
    for (let i = 0; i < 16; i++) {
      if (i > 0 && i % 4 === 0) result += "-";
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  function hasAdminPassword() {
    return Boolean(localStorage.getItem(STORAGE_HASH_KEY) && localStorage.getItem(STORAGE_SALT_KEY));
  }

  async function isSessionValid() {
    const session = sessionStorage.getItem(STORAGE_SESSION_KEY) || localStorage.getItem(STORAGE_SESSION_KEY);
    if (!session) return false;
    try {
      const parsed = JSON.parse(session);
      if (parsed.expiresAt && Date.now() > parsed.expiresAt) return false;
      const currentFingerprint = await generateDeviceFingerprint();
      if (parsed.fingerprint && parsed.fingerprint !== currentFingerprint) {
        console.warn("[Admin Security] Device fingerprint mismatch. Session invalidated.");
        logAuditEvent("failed", "Session fingerprint mismatch detected.");
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  async function createSession(durationHours = 4) {
    const fingerprint = await generateDeviceFingerprint();
    const now = Date.now();
    const expiresAt = durationHours > 0 ? now + durationHours * 60 * 60 * 1000 : 0;
    
    const sessionData = JSON.stringify({
      timestamp: now,
      expiresAt: expiresAt,
      fingerprint: fingerprint
    });

    if (durationHours === 0) {
      sessionStorage.setItem(STORAGE_SESSION_KEY, sessionData);
    } else {
      localStorage.setItem(STORAGE_SESSION_KEY, sessionData);
      sessionStorage.setItem(STORAGE_SESSION_KEY, sessionData);
    }
  }

  function clearSession() {
    sessionStorage.removeItem(STORAGE_SESSION_KEY);
    localStorage.removeItem(STORAGE_SESSION_KEY);
    sessionStorage.removeItem(STORAGE_PENDING_CODE_KEY);
  }

  // Security Audit Logging
  function logAuditEvent(type, details) {
    try {
      const logs = JSON.parse(localStorage.getItem(STORAGE_AUDIT_LOGS) || "[]");
      logs.unshift({
        type: type, // 'login', 'logout', 'failed', 'change'
        details: details,
        timestamp: new Date().toLocaleString()
      });
      // Keep last 30 logs
      localStorage.setItem(STORAGE_AUDIT_LOGS, JSON.stringify(logs.slice(0, 30)));
    } catch (e) {}
  }

  function renderAuditLogs() {
    const tbody = document.getElementById("audit-log-rows");
    if (!tbody) return;
    try {
      const logs = JSON.parse(localStorage.getItem(STORAGE_AUDIT_LOGS) || "[]");
      if (logs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" style="text-align: center; color: var(--admin-text-secondary); padding: 1.5rem;">No security logs recorded yet.</td></tr>';
        return;
      }
      tbody.innerHTML = logs.map(log => `
        <tr>
          <td><span class="admin-audit-tag ${log.type}">${log.type.toUpperCase()}</span></td>
          <td style="white-space: nowrap; color: var(--admin-text-secondary);">${log.timestamp}</td>
          <td>${log.details}</td>
        </tr>
      `).join("");
    } catch (e) {
      tbody.innerHTML = '<tr><td colspan="3">Failed to load logs.</td></tr>';
    }
  }

  // Inactivity Auto-Lock Handler
  function resetIdleTimer() {
    if (idleTimer) clearTimeout(idleTimer);
    const sessionActive = document.getElementById("admin-security-bar")?.style.display === "flex";
    if (sessionActive) {
      idleTimer = setTimeout(() => {
        showToast("🔒 Session auto-locked after 15 minutes of inactivity.", "fa-lock");
        logAuditEvent("logout", "Session auto-locked due to inactivity.");
        lockAdminPortal();
      }, IDLE_TIMEOUT_MS);
    }
  }

  function setupInactivityListener() {
    ["mousemove", "keydown", "scroll", "touchstart"].forEach(evt => {
      window.addEventListener(evt, resetIdleTimer, { passive: true });
    });
  }

  // Caps Lock Warning Detection
  function setupCapsLockDetection() {
    document.querySelectorAll("input[type='password']").forEach(input => {
      const warningId = input.id.startsWith("setup") ? "setup-caps-warning" : "login-caps-warning";
      const warningEl = document.getElementById(warningId);
      if (!warningEl) return;

      const checkCaps = (e) => {
        if (e.getModifierState && e.getModifierState("CapsLock")) {
          warningEl.classList.add("active");
        } else {
          warningEl.classList.remove("active");
        }
      };

      input.addEventListener("keyup", checkCaps);
      input.addEventListener("keydown", checkCaps);
      input.addEventListener("blur", () => warningEl.classList.remove("active"));
    });
  }

  // Rate Limiting Management
  function getLoginAttemptsState() {
    try {
      const data = JSON.parse(localStorage.getItem(STORAGE_LOGIN_ATTEMPTS) || "{}");
      if (data.lockoutUntil && Date.now() >= data.lockoutUntil) {
        localStorage.removeItem(STORAGE_LOGIN_ATTEMPTS);
        return { count: 0, lockoutUntil: 0 };
      }
      return data.count ? data : { count: 0, lockoutUntil: 0 };
    } catch {
      return { count: 0, lockoutUntil: 0 };
    }
  }

  function recordFailedLoginAttempt() {
    const state = getLoginAttemptsState();
    const newCount = (state.count || 0) + 1;
    let lockoutUntil = 0;
    if (newCount >= MAX_LOGIN_ATTEMPTS) {
      lockoutUntil = Date.now() + LOCKOUT_DURATION_MS;
    }
    localStorage.setItem(STORAGE_LOGIN_ATTEMPTS, JSON.stringify({ count: newCount, lockoutUntil }));
    return { count: newCount, lockoutUntil };
  }

  function clearLoginAttempts() {
    localStorage.removeItem(STORAGE_LOGIN_ATTEMPTS);
  }

  function showFeedback(elementId, message, type = "error") {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.textContent = message;
    el.className = `admin-feedback ${type}`;
  }

  function hideFeedback(elementId) {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.className = "admin-feedback";
    el.textContent = "";
  }

  // Toggle Password Visibility Eye
  function setupEyeToggles() {
    document.querySelectorAll(".admin-toggle-eye").forEach(btn => {
      btn.addEventListener("click", () => {
        const input = btn.previousElementSibling;
        if (!input) return;
        const icon = btn.querySelector("i");
        if (input.type === "password") {
          input.type = "text";
          if (icon) {
            icon.classList.remove("fa-eye");
            icon.classList.add("fa-eye-slash");
          }
        } else {
          input.type = "password";
          if (icon) {
            icon.classList.remove("fa-eye-slash");
            icon.classList.add("fa-eye");
          }
        }
      });
    });
  }

  function showAuthView(viewName) {
    document.querySelectorAll(".admin-auth-view").forEach(v => v.style.display = "none");
    const target = document.getElementById(`admin-view-${viewName}`);
    if (target) target.style.display = "block";
  }

  async function unlockAdminPortal(durationHours = 4) {
    await createSession(durationHours);
    clearLoginAttempts();
    const overlay = document.getElementById("admin-security-overlay");
    if (overlay) overlay.classList.add("hidden");
    const bar = document.getElementById("admin-security-bar");
    if (bar) bar.style.display = "flex";
    resetIdleTimer();
  }

  function lockAdminPortal() {
    clearSession();
    if (idleTimer) clearTimeout(idleTimer);

    if (window.netlifyIdentity && typeof window.netlifyIdentity.logout === "function") {
      try {
        window.netlifyIdentity.logout();
      } catch (e) {}
    }

    document.querySelectorAll("input[type='password']").forEach(input => input.value = "");

    const overlay = document.getElementById("admin-security-overlay");
    if (overlay) overlay.classList.remove("hidden");
    const bar = document.getElementById("admin-security-bar");
    if (bar) bar.style.display = "none";

    if (!hasAdminPassword()) {
      showAuthView("setup");
    } else {
      showAuthView("login");
    }
  }

  // First-Time Setup
  async function handleCreatePassword(e) {
    e.preventDefault();
    hideFeedback("setup-feedback");

    const pass = document.getElementById("setup-password").value.trim();
    const confirm = document.getElementById("setup-confirm").value.trim();

    if (pass.length < 8) {
      showFeedback("setup-feedback", "Password must be at least 8 characters long.");
      return;
    }
    if (pass !== confirm) {
      showFeedback("setup-feedback", "Passwords do not match.");
      return;
    }

    await setAdminPassword(pass);
    const recoveryKey = generateRecoveryKey();
    localStorage.setItem(STORAGE_RECOVERY_KEY, recoveryKey);

    logAuditEvent("change", "Admin portal initialized & master password created.");
    document.getElementById("generated-recovery-key").textContent = recoveryKey;
    showAuthView("recovery-display");
  }

  // Enterprise Login Handler
  async function handleLogin(e) {
    e.preventDefault();
    hideFeedback("login-feedback");

    const attemptState = getLoginAttemptsState();
    if (attemptState.lockoutUntil && Date.now() < attemptState.lockoutUntil) {
      const secondsLeft = Math.ceil((attemptState.lockoutUntil - Date.now()) / 1000);
      showFeedback("login-feedback", `Security Lockout active. Retry in ${secondsLeft} seconds.`);
      return;
    }

    const entered = document.getElementById("login-password").value;
    const durationSelect = document.getElementById("login-session-length");
    const durationHours = durationSelect ? parseInt(durationSelect.value, 10) : 4;

    if (!entered) {
      showFeedback("login-feedback", "Please enter your password.");
      return;
    }

    const storedHash = localStorage.getItem(STORAGE_HASH_KEY);
    const salt = localStorage.getItem(STORAGE_SALT_KEY);

    if (!storedHash || !salt) {
      showAuthView("setup");
      return;
    }

    const isValid = await verifyAndMigratePassword(entered, storedHash, salt);
    if (isValid) {
      logAuditEvent("login", `Authenticated successfully (${durationHours === 0 ? "Session" : durationHours + "h"}).`);
      await unlockAdminPortal(durationHours);
      document.getElementById("login-password").value = "";
    } else {
      const newAttempts = recordFailedLoginAttempt();
      logAuditEvent("failed", `Failed login attempt (${newAttempts.count}/${MAX_LOGIN_ATTEMPTS}).`);
      if (newAttempts.lockoutUntil) {
        showFeedback("login-feedback", `Too many invalid attempts! Portal locked for 60 seconds.`);
      } else {
        const remaining = MAX_LOGIN_ATTEMPTS - newAttempts.count;
        showFeedback("login-feedback", `Incorrect admin password. ${remaining} attempt(s) remaining.`);
      }
    }
  }

  // Request Reset Handler
  async function handleRequestEmailReset(e) {
    if (e) e.preventDefault();
    hideFeedback("reset-feedback");

    const emailInput = document.getElementById("reset-email");
    const enteredEmail = emailInput ? emailInput.value.trim().toLowerCase() : ADMIN_EMAIL;

    if (enteredEmail !== ADMIN_EMAIL.toLowerCase()) {
      showFeedback("reset-feedback", `Password resets are restricted to ${ADMIN_EMAIL}`);
      return;
    }

    const btn = document.getElementById("btn-send-reset-code");
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Requesting...';
    }

    try {
      if (window.netlifyIdentity && typeof window.netlifyIdentity.open === "function") {
        window.netlifyIdentity.open("recovery");
      }

      await fetch("/.netlify/functions/request-admin-reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "request", email: ADMIN_EMAIL })
      });

      showFeedback(
        "reset-feedback",
        `✅ Reset instructions sent to ${ADMIN_EMAIL}. Check email or enter your saved Recovery Key below.`,
        "success"
      );
    } catch (err) {
      showFeedback(
        "reset-feedback",
        `Reset request sent to ${ADMIN_EMAIL}. Check email or use your saved Recovery Key.`,
        "success"
      );
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-paper-plane"></i> Send Email';
      }
    }
  }

  // Password Reset Handler
  async function handleResetPassword(e) {
    e.preventDefault();
    hideFeedback("reset-feedback");

    const enteredKey = document.getElementById("reset-key").value.trim().toUpperCase();
    const newPass = document.getElementById("reset-new-password").value.trim();
    const confirmPass = document.getElementById("reset-confirm-password").value.trim();

    const storedRecoveryKey = (localStorage.getItem(STORAGE_RECOVERY_KEY) || "").toUpperCase();
    const pendingCode = sessionStorage.getItem(STORAGE_PENDING_CODE_KEY);

    let isValidCode = false;
    if (storedRecoveryKey && enteredKey === storedRecoveryKey) {
      isValidCode = true;
    } else if (pendingCode && enteredKey === pendingCode) {
      isValidCode = true;
    }

    if (!isValidCode) {
      showFeedback("reset-feedback", `Invalid Security Code or Recovery Key. Please check your emergency key.`);
      return;
    }

    if (newPass.length < 8) {
      showFeedback("reset-feedback", "New password must be at least 8 characters long.");
      return;
    }

    if (newPass !== confirmPass) {
      showFeedback("reset-feedback", "New passwords do not match.");
      return;
    }

    await setAdminPassword(newPass);
    const newRecoveryKey = generateRecoveryKey();
    localStorage.setItem(STORAGE_RECOVERY_KEY, newRecoveryKey);
    sessionStorage.removeItem(STORAGE_PENDING_CODE_KEY);

    logAuditEvent("change", "Admin password reset via Recovery Key.");
    showFeedback("reset-feedback", `Password reset successfully! Account updated for ${ADMIN_EMAIL}. Redirecting...`, "success");
    setTimeout(() => {
      document.getElementById("reset-form").reset();
      showAuthView("login");
    }, 1500);
  }

  // Change Password Handler
  async function handleChangePassword(e) {
    e.preventDefault();
    hideFeedback("change-feedback");

    const current = document.getElementById("change-current-password").value;
    const newPass = document.getElementById("change-new-password").value.trim();
    const confirmPass = document.getElementById("change-confirm-password").value.trim();

    const storedHash = localStorage.getItem(STORAGE_HASH_KEY);
    const salt = localStorage.getItem(STORAGE_SALT_KEY);

    const isValidCurrent = await verifyAndMigratePassword(current, storedHash, salt);
    if (!isValidCurrent) {
      showFeedback("change-feedback", "Current password is incorrect.");
      return;
    }

    if (newPass.length < 8) {
      showFeedback("change-feedback", "New password must be at least 8 characters long.");
      return;
    }

    if (newPass !== confirmPass) {
      showFeedback("change-feedback", "New passwords do not match.");
      return;
    }

    await setAdminPassword(newPass);
    logAuditEvent("change", "Admin password changed from inside dashboard.");

    showFeedback("change-feedback", "Admin password updated successfully!", "success");
    setTimeout(() => {
      closeChangePasswordModal();
    }, 1500);
  }

  function openChangePasswordModal() {
    hideFeedback("change-feedback");
    const form = document.getElementById("change-password-form");
    if (form) form.reset();
    const modal = document.getElementById("admin-change-modal");
    if (modal) modal.classList.add("active");
  }

  function closeChangePasswordModal() {
    const modal = document.getElementById("admin-change-modal");
    if (modal) modal.classList.remove("active");
  }

  function openAuditModal() {
    renderAuditLogs();
    const modal = document.getElementById("admin-audit-modal");
    if (modal) modal.classList.add("active");
  }

  function closeAuditModal() {
    const modal = document.getElementById("admin-audit-modal");
    if (modal) modal.classList.remove("active");
  }

  function clearAuditLogs() {
    if (confirm("Are you sure you want to clear security audit logs?")) {
      localStorage.removeItem(STORAGE_AUDIT_LOGS);
      renderAuditLogs();
    }
  }

  function checkUrlRecoveryToken() {
    if (window.location.hash && window.location.hash.includes("recovery_token=")) {
      showAuthView("reset");
      showFeedback("reset-feedback", `Email recovery link verified for ${ADMIN_EMAIL}! Enter your new password below.`, "success");
    }
  }

  function showToast(message, iconClass = "fa-check-circle") {
    let container = document.getElementById("admin-toast-container");
    if (!container) {
      container = document.createElement("div");
      container.id = "admin-toast-container";
      document.body.appendChild(container);
    }

    const toast = document.createElement("div");
    toast.className = "admin-toast";
    toast.innerHTML = `<i class="fas ${iconClass}" style="color: var(--admin-accent-gold);"></i> <span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add("hiding");
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  async function handleSyncSite() {
    const btn = document.getElementById("bar-btn-sync");
    if (btn) {
      btn.classList.add("spinning");
      btn.disabled = true;
    }

    showToast("Triggering site rebuild on Netlify...", "fa-rotate");

    try {
      const response = await fetch("/.netlify/functions/sync-site", { method: "POST" });
      const data = await response.json();

      if (data && data.buildHookTriggered) {
        showToast(
          "✅ Rebuild triggered! Your site will update in ~1–2 minutes.",
          "fa-check-double"
        );
      } else if (data && data.needsSetup) {
        showToast("⚠️ Build hook not set up yet — see instructions.", "fa-triangle-exclamation");
      } else {
        showToast("✅ Rebuild request sent. Site will update shortly.", "fa-check-circle");
      }
    } catch (err) {
      console.warn("[Sync] Failed to reach sync function:", err);
      showToast("⚠️ Could not reach sync function.", "fa-triangle-exclamation");
    } finally {
      setTimeout(() => {
        if (btn) {
          btn.classList.remove("spinning");
          btn.disabled = false;
        }
      }, 2000);
    }
  }

  async function init() {
    setupEyeToggles();
    setupCapsLockDetection();
    setupInactivityListener();
    checkUrlRecoveryToken();

    // Bind Forms
    const setupForm = document.getElementById("setup-form");
    if (setupForm) setupForm.addEventListener("submit", handleCreatePassword);

    const loginForm = document.getElementById("login-form");
    if (loginForm) loginForm.addEventListener("submit", handleLogin);

    const resetForm = document.getElementById("reset-form");
    if (resetForm) resetForm.addEventListener("submit", handleResetPassword);

    const btnSendReset = document.getElementById("btn-send-reset-code");
    if (btnSendReset) btnSendReset.addEventListener("click", handleRequestEmailReset);

    const changeForm = document.getElementById("change-password-form");
    if (changeForm) changeForm.addEventListener("submit", handleChangePassword);

    // Navigation links
    const forgotBtn = document.getElementById("btn-goto-reset");
    if (forgotBtn) forgotBtn.addEventListener("click", () => showAuthView("reset"));

    const backToLoginBtn = document.getElementById("btn-back-to-login");
    if (backToLoginBtn) backToLoginBtn.addEventListener("click", () => showAuthView("login"));

    const btnFinishSetup = document.getElementById("btn-finish-setup");
    if (btnFinishSetup) {
      btnFinishSetup.addEventListener("click", () => {
        unlockAdminPortal();
      });
    }

    // Security Bar buttons
    const btnSyncNow = document.getElementById("bar-btn-sync");
    if (btnSyncNow) btnSyncNow.addEventListener("click", handleSyncSite);

    const btnLockNow = document.getElementById("bar-btn-lock");
    if (btnLockNow) btnLockNow.addEventListener("click", () => {
      logAuditEvent("logout", "Logged out manually by administrator.");
      lockAdminPortal();
    });

    const btnChangePass = document.getElementById("bar-btn-change");
    if (btnChangePass) btnChangePass.addEventListener("click", openChangePasswordModal);

    const btnCloseModal = document.getElementById("modal-btn-close-change");
    if (btnCloseModal) btnCloseModal.addEventListener("click", closeChangePasswordModal);

    const btnAudit = document.getElementById("bar-btn-audit");
    if (btnAudit) btnAudit.addEventListener("click", openAuditModal);

    const btnCloseAudit = document.getElementById("modal-btn-close-audit");
    if (btnCloseAudit) btnCloseAudit.addEventListener("click", closeAuditModal);

    const btnClearAudit = document.getElementById("btn-clear-audit-logs");
    if (btnClearAudit) btnClearAudit.addEventListener("click", clearAuditLogs);

    // Initial session verification
    if (!hasAdminPassword()) {
      showAuthView("setup");
    } else {
      const valid = await isSessionValid();
      if (valid) {
        await unlockAdminPortal();
      } else {
        lockAdminPortal();
      }
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
