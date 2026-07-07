(() => {
"use strict";

const AUTH_STORAGE_KEY = "ccs-vo-auth-user";

function showToast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { el.hidden = true; }, 2200);
}

function wireEvents() {
  document.getElementById("logout-btn").addEventListener("click", () => {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    location.href = "index.html";
  });

  const themeToggle = document.getElementById("theme-toggle");
  themeToggle.addEventListener("click", () => {
    const root = document.documentElement;
    const current = root.getAttribute("data-theme") ||
      (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = current === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    localStorage.setItem("ccs-vo-theme", next);
  });
  const savedTheme = localStorage.getItem("ccs-vo-theme");
  if (savedTheme) document.documentElement.setAttribute("data-theme", savedTheme);

  const changelogToggle = document.getElementById("changelog-toggle");
  changelogToggle.addEventListener("click", () => {
    const body = document.getElementById("changelog-body");
    const expanded = changelogToggle.getAttribute("aria-expanded") === "true";
    changelogToggle.setAttribute("aria-expanded", String(!expanded));
    body.hidden = expanded;
  });

  const copyBtn = document.getElementById("copy-broadcast");
  copyBtn.addEventListener("click", async () => {
    const text = document.getElementById("broadcast-text").innerText;
    try {
      await navigator.clipboard.writeText(text);
      showToast("Broadcast message copied");
    } catch (err) {
      console.error(err);
      showToast("Couldn't copy — please select and copy manually");
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  const user = localStorage.getItem(AUTH_STORAGE_KEY);
  if (!user) {
    location.replace("index.html");
    return;
  }
  document.getElementById("signed-in-as").textContent = `Signed in as ${user}`;
  try {
    wireEvents();
  } catch (err) {
    console.error("wireEvents failed:", err);
  }
});

})();
