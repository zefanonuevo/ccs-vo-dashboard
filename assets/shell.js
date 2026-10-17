/* Shell behaviour shared by every page: the System / Light / Dark theme switch
   (same key and markup as the other CCS sites) and the tab strip. */
(function () {
  "use strict";
  // single source of truth for the version shown in every page footer; keep in step with CHANGELOG.md
  var VERSION = "2.2.0";
  var KEY = "ccs-theme", LEGACY = "ccs-vo-theme", root = document.documentElement;
  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function del(k) { try { localStorage.removeItem(k); } catch (e) {} }

  function mode() {
    var m = get(KEY);
    if (m !== "light" && m !== "dark") {
      // carry over the choice made with the old dark-mode button, once
      var legacy = get(LEGACY);
      if (legacy === "light" || legacy === "dark") { set(KEY, legacy); del(LEGACY); m = legacy; }
    }
    return m === "light" || m === "dark" ? m : "system";
  }
  function apply(m) {
    if (m === "light" || m === "dark") root.setAttribute("data-theme", m);
    else root.removeAttribute("data-theme");
    var box = document.getElementById("theme");
    if (!box) return;
    Array.prototype.forEach.call(box.querySelectorAll("button"), function (b) {
      b.setAttribute("aria-checked", String(b.dataset.themeSet === m));
    });
  }
  function init() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-version]"), function (e) { e.textContent = "v" + VERSION; });
    apply(mode());
    var box = document.getElementById("theme");
    if (box) box.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-theme-set]");
      if (!b) return;
      var m = b.dataset.themeSet;
      if (m === "system") del(KEY); else set(KEY, m);
      apply(m);
    });

    // tab strip: fade at the edge while more tabs are off-screen; keep the current tab in view
    var tabs = document.querySelector(".tabs");
    if (tabs) {
      var fade = function () { tabs.classList.toggle("more", tabs.scrollWidth - tabs.clientWidth - tabs.scrollLeft > 4); };
      var cur = tabs.querySelector(".tab-active");
      if (cur) {
        var l = cur.offsetLeft, r = l + cur.offsetWidth;
        if (r > tabs.clientWidth) tabs.scrollLeft = r - tabs.clientWidth + 8;
        else if (l < tabs.scrollLeft) tabs.scrollLeft = Math.max(0, l - 8);
      }
      tabs.addEventListener("scroll", fade, { passive: true });
      window.addEventListener("resize", fade);
      fade();
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
