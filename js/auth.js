/* Client-side session gate. Credentials are checked only by the Netlify Function. */
(function () {
  "use strict";

  const authScreen = () => document.getElementById("authScreen");
  const trackerApp = () => document.getElementById("trackerApp");
  const loginError = () => document.getElementById("loginError");

  function showTracker() {
    authScreen().hidden = true;
    trackerApp().hidden = false;
    window.__AUTHENTICATED__ = true;
    if (typeof window.startScrapLedger === "function") window.startScrapLedger();
  }

  function showLogin() {
    window.__AUTHENTICATED__ = false;
    authScreen().hidden = false;
    trackerApp().hidden = true;
  }

  async function request(options) {
    const response = await fetch("/.netlify/functions/auth", {
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      credentials: "same-origin"
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.error || "Authentication failed.");
      error.code = body.code;
      error.status = response.status;
      error.missing = body.missing;
      throw error;
    }
    return body;
  }

  async function checkSession() {
    try {
      const body = await request({ method: "GET" });
      if (body.authenticated) return showTracker();
    } catch (_) { /* A static preview without Functions should remain signed out. */ }
    showLogin();
  }

  function bind() {
    const form = document.getElementById("signInForm");
    const password = document.getElementById("loginPassword");
    const toggle = document.getElementById("passwordToggle");
    const button = document.getElementById("signInButton");

    toggle.addEventListener("click", () => {
      const visible = password.type === "text";
      password.type = visible ? "password" : "text";
      toggle.setAttribute("aria-label", visible ? "Show password" : "Hide password");
      toggle.innerHTML = `<i class="bi bi-eye${visible ? "" : "-slash"}"></i>`;
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      document.getElementById("loginUsernameError").textContent = "";
      document.getElementById("loginPasswordError").textContent = "";
      loginError().hidden = true;
      if (!form.checkValidity()) {
        if (!document.getElementById("loginUsername").value) document.getElementById("loginUsernameError").textContent = "Username or email is required.";
        if (!password.value) document.getElementById("loginPasswordError").textContent = "Password is required.";
        return;
      }
      button.disabled = true;
      button.innerHTML = '<i class="bi bi-arrow-repeat"></i> Signing in…';
      try {
        await request({ method: "POST", body: JSON.stringify({ username: document.getElementById("loginUsername").value.trim(), password: password.value }) });
        form.reset();
        showTracker();
      } catch (error) {
        loginError().textContent = error.code === "AUTH_CONFIG_MISSING"
          ? "Authentication is not configured. Please configure the required Netlify environment variables."
          : "Invalid username or password.";
        loginError().hidden = false;
      } finally {
        button.disabled = false;
        button.innerHTML = '<i class="bi bi-box-arrow-in-right"></i> Sign In';
      }
    });

    document.getElementById("logoutBtn").addEventListener("click", async () => {
      try { await request({ method: "DELETE" }); } catch (_) { /* Clear the local view even if the network is unavailable. */ }
      showLogin();
    });
  }

  document.addEventListener("DOMContentLoaded", () => { bind(); checkSession(); });
})();
