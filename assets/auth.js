(() => {
"use strict";

const AUTH_STORAGE_KEY = "ccs-vo-auth-user";
const USERS_URL = "assets/users.json";

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
}

document.addEventListener("DOMContentLoaded", () => {
  if (localStorage.getItem(AUTH_STORAGE_KEY)) {
    location.replace("dashboard.html");
    return;
  }

  const form = document.getElementById("login-form");
  const errorEl = document.getElementById("login-error");
  const submitBtn = document.getElementById("login-submit");

  form.addEventListener("submit", async e => {
    e.preventDefault();
    errorEl.hidden = true;
    submitBtn.disabled = true;
    submitBtn.textContent = "Checking…";
    try {
      const username = document.getElementById("login-username").value.trim();
      const password = document.getElementById("login-password").value;
      const res = await fetch(USERS_URL + "?cachebust=" + Date.now(), { cache: "no-store" });
      const users = await res.json();
      const match = users.find(u => u.username === username);
      const computed = match ? await sha256Hex(match.salt + password) : null;
      if (match && computed === match.hash) {
        localStorage.setItem(AUTH_STORAGE_KEY, username);
        location.href = "dashboard.html";
      } else {
        errorEl.textContent = "Incorrect username or password.";
        errorEl.hidden = false;
      }
    } catch (err) {
      console.error(err);
      errorEl.textContent = "Couldn't verify credentials. Please try again.";
      errorEl.hidden = false;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Log in";
    }
  });
});

})();
