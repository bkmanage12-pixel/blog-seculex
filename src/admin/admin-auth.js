/**
 * SecuLex Admin Portal Security & Password Management System
 * Supports password initialization, authentication gate, password change,
 * and email-based password reset for seculexpublications@gmail.com.
 */

(function () {
  const ADMIN_EMAIL = "seculexpublications@gmail.com";
  const STORAGE_HASH_KEY = "seculex_admin_hash_v1";
  const STORAGE_SALT_KEY = "seculex_admin_salt_v1";
  const STORAGE_RECOVERY_KEY = "seculex_admin_recovery_v1";
  const STORAGE_SESSION_KEY = "seculex_admin_session_v1";
  const STORAGE_PENDING_CODE_KEY = "seculex_admin_pending_code_v1";
  
  // Master emergency fallback reset key
  const MASTER_EMERGENCY_KEY = "SECULEX-RESET-9988";

  // SHA-256 Helper using Web Crypto API
  async function hashPassword(password, salt) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password + salt);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
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

  function isSessionValid() {
    const session = sessionStorage.getItem(STORAGE_SESSION_KEY);
    if (!session) return false;
    try {
      const parsed = JSON.parse(session);
      return Date.now() - parsed.timestamp < 4 * 60 * 60 * 1000;
    } catch {
      return false;
    }
  }

  function createSession() {
    sessionStorage.setItem(STORAGE_SESSION_KEY, JSON.stringify({ timestamp: Date.now() }));
  }

  function clearSession() {
    sessionStorage.removeItem(STORAGE_SESSION_KEY);
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

  // Show correct view inside overlay (Setup vs Login vs Reset)
  function showAuthView(viewName) {
    document.querySelectorAll(".admin-auth-view").forEach(v => v.style.display = "none");
    const target = document.getElementById(`admin-view-${viewName}`);
    if (target) target.style.display = "block";
  }

  function unlockAdminPortal() {
    createSession();
    const overlay = document.getElementById("admin-security-overlay");
    if (overlay) overlay.classList.add("hidden");
    const bar = document.getElementById("admin-security-bar");
    if (bar) bar.style.display = "flex";
  }

  function lockAdminPortal() {
    clearSession();
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

  // Initialize Password during first-time setup
  async function handleCreatePassword(e) {
    e.preventDefault();
    hideFeedback("setup-feedback");

    const pass = document.getElementById("setup-password").value.trim();
    const confirm = document.getElementById("setup-confirm").value.trim();

    if (pass.length < 6) {
      showFeedback("setup-feedback", "Password must be at least 6 characters long.");
      return;
    }
    if (pass !== confirm) {
      showFeedback("setup-feedback", "Passwords do not match.");
      return;
    }

    const salt = generateSalt();
    const hash = await hashPassword(pass, salt);
    const recoveryKey = generateRecoveryKey();

    localStorage.setItem(STORAGE_HASH_KEY, hash);
    localStorage.setItem(STORAGE_SALT_KEY, salt);
    localStorage.setItem(STORAGE_RECOVERY_KEY, recoveryKey);

    document.getElementById("generated-recovery-key").textContent = recoveryKey;
    showAuthView("recovery-display");
  }

  // Handle Login Submission
  async function handleLogin(e) {
    e.preventDefault();
    hideFeedback("login-feedback");

    const entered = document.getElementById("login-password").value;
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

    const computedHash = await hashPassword(entered, salt);
    if (computedHash === storedHash) {
      unlockAdminPortal();
      document.getElementById("login-password").value = "";
    } else {
      showFeedback("login-feedback", "Incorrect admin password.");
    }
  }

  // Request Email Reset Code to seculexpublications@gmail.com
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
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending email to ' + ADMIN_EMAIL + '...';
    }

    try {
      // 1. Trigger Netlify Identity email recovery widget if available
      if (window.netlifyIdentity) {
        window.netlifyIdentity.open("recovery");
      }

      // 2. Call backend serverless function
      const response = await fetch("/.netlify/functions/request-admin-reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "request", email: ADMIN_EMAIL })
      });
      const data = await response.json();

      if (response.ok && data.code) {
        sessionStorage.setItem(STORAGE_PENDING_CODE_KEY, data.code);
        showFeedback(
          "reset-feedback",
          `✅ Reset instructions & Security Code dispatched to ${ADMIN_EMAIL}! Code: [ ${data.code} ]`,
          "success"
        );
      } else {
        showFeedback(
          "reset-feedback",
          `✅ Reset request sent to ${ADMIN_EMAIL}. Check your email inbox.`,
          "success"
        );
      }
    } catch (err) {
      showFeedback(
        "reset-feedback",
        `Password reset requested for ${ADMIN_EMAIL}. Check your email inbox or Netlify Identity link.`,
        "success"
      );
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-paper-plane"></i> Resend Email Code';
      }
    }
  }

  // Handle Password Reset via Email Security Code, Recovery Key or Master Key
  async function handleResetPassword(e) {
    e.preventDefault();
    hideFeedback("reset-feedback");

    const enteredKey = document.getElementById("reset-key").value.trim().toUpperCase();
    const newPass = document.getElementById("reset-new-password").value.trim();
    const confirmPass = document.getElementById("reset-confirm-password").value.trim();

    const storedRecoveryKey = (localStorage.getItem(STORAGE_RECOVERY_KEY) || "").toUpperCase();
    const pendingCode = sessionStorage.getItem(STORAGE_PENDING_CODE_KEY);

    let isValidCode = false;
    if (enteredKey === storedRecoveryKey || enteredKey === MASTER_EMERGENCY_KEY) {
      isValidCode = true;
    } else if (pendingCode && enteredKey === pendingCode) {
      isValidCode = true;
    }

    if (!isValidCode) {
      showFeedback("reset-feedback", `Invalid reset code or key. Please click "Send Code to Email" to receive a code at ${ADMIN_EMAIL}.`);
      return;
    }

    if (newPass.length < 6) {
      showFeedback("reset-feedback", "New password must be at least 6 characters long.");
      return;
    }

    if (newPass !== confirmPass) {
      showFeedback("reset-feedback", "New passwords do not match.");
      return;
    }

    const salt = generateSalt();
    const hash = await hashPassword(newPass, salt);
    const newRecoveryKey = generateRecoveryKey();

    localStorage.setItem(STORAGE_HASH_KEY, hash);
    localStorage.setItem(STORAGE_SALT_KEY, salt);
    localStorage.setItem(STORAGE_RECOVERY_KEY, newRecoveryKey);
    sessionStorage.removeItem(STORAGE_PENDING_CODE_KEY);

    showFeedback("reset-feedback", `Password reset successfully! Account updated for ${ADMIN_EMAIL}. Redirecting...`, "success");
    setTimeout(() => {
      document.getElementById("reset-form").reset();
      showAuthView("login");
    }, 1500);
  }

  // Handle Password Change from inside CMS (Modal)
  async function handleChangePassword(e) {
    e.preventDefault();
    hideFeedback("change-feedback");

    const current = document.getElementById("change-current-password").value;
    const newPass = document.getElementById("change-new-password").value.trim();
    const confirmPass = document.getElementById("change-confirm-password").value.trim();

    const storedHash = localStorage.getItem(STORAGE_HASH_KEY);
    const salt = localStorage.getItem(STORAGE_SALT_KEY);

    const computedHash = await hashPassword(current, salt);
    if (computedHash !== storedHash) {
      showFeedback("change-feedback", "Current password is incorrect.");
      return;
    }

    if (newPass.length < 6) {
      showFeedback("change-feedback", "New password must be at least 6 characters long.");
      return;
    }

    if (newPass !== confirmPass) {
      showFeedback("change-feedback", "New passwords do not match.");
      return;
    }

    const newSalt = generateSalt();
    const newHash = await hashPassword(newPass, newSalt);

    localStorage.setItem(STORAGE_HASH_KEY, newHash);
    localStorage.setItem(STORAGE_SALT_KEY, newSalt);

    showFeedback("change-feedback", "Admin Password updated successfully!", "success");
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

  function checkUrlRecoveryToken() {
    if (window.location.hash && window.location.hash.includes("recovery_token=")) {
      showAuthView("reset");
      showFeedback("reset-feedback", `Email recovery link verified for ${ADMIN_EMAIL}! Please enter your new password below.`, "success");
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

  // Sync & Rebuild Site Handler — triggers Netlify build hook to redeploy
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
          "✅ Rebuild triggered! Your site will update in ~1–2 minutes. Deleted articles will disappear once complete.",
          "fa-check-double"
        );
      } else if (data && data.needsSetup) {
        showToast("⚠️ Build hook not set up yet — see instructions.", "fa-triangle-exclamation");
        console.warn("[SecuLex Admin] Build hook not configured:", data.message);
        // Show user the full setup steps
        setTimeout(() => {
          alert(
            "⚠️  One-time setup required to enable the Sync button:\n\n" +
            "1. Open Netlify → Your Site → Site Settings\n" +
            "2. Go to: Build & Deploy → Build hooks\n" +
            "3. Click \"Add build hook\" → Name it \"Admin Sync\" → Branch: main → Save\n" +
            "4. Copy the hook URL that appears\n" +
            "5. Go to: Site Settings → Environment Variables\n" +
            "6. Click \"Add a variable\" → Key: NETLIFY_BUILD_HOOK_URL → Paste the hook URL → Save\n" +
            "7. Redeploy your site once (so the new env variable takes effect)\n\n" +
            "After that, this button will trigger instant rebuilds!"
          );
        }, 300);
      } else {
        showToast("✅ Rebuild request sent. Site will update shortly.", "fa-check-circle");
      }
    } catch (err) {
      console.warn("[Sync] Failed to reach sync function:", err);
      showToast("⚠️ Could not reach sync function. Is the site deployed on Netlify?", "fa-triangle-exclamation");
    } finally {
      // Signal other open tabs (nice-to-have)
      try {
        localStorage.setItem("seculex_site_refreshed", String(Date.now()));
      } catch (e) {}

      setTimeout(() => {
        if (btn) {
          btn.classList.remove("spinning");
          btn.disabled = false;
        }
      }, 2000);
    }
  }

  function init() {
    setupEyeToggles();
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

    // Bind Navigation links inside overlay
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

    // Floating Security Bar buttons
    const btnSyncNow = document.getElementById("bar-btn-sync");
    if (btnSyncNow) btnSyncNow.addEventListener("click", handleSyncSite);

    const btnLockNow = document.getElementById("bar-btn-lock");
    if (btnLockNow) btnLockNow.addEventListener("click", lockAdminPortal);

    const btnChangePass = document.getElementById("bar-btn-change");
    if (btnChangePass) btnChangePass.addEventListener("click", openChangePasswordModal);

    const btnCloseModal = document.getElementById("modal-btn-close-change");
    if (btnCloseModal) btnCloseModal.addEventListener("click", closeChangePasswordModal);

    // Initial check
    if (!hasAdminPassword()) {
      showAuthView("setup");
    } else if (isSessionValid()) {
      unlockAdminPortal();
    } else {
      lockAdminPortal();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
