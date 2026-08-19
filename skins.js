/* Exam skins for the Renal QBank.
 *
 * Same feature as the React QBanks, written against this repo's plain-DOM
 * quiz: an "Examplify Skin" and an "NBME Skin" that re-dress the page to look
 * like the interfaces students sit real exams in. Gated on being signed in to
 * Active Transport — any account, not Pro.
 *
 * Everything hangs off data-skin on <html>; skins.css does the rest.
 */
(function (global) {
  "use strict";

  var API = "https://activetransport.app";
  var STORE = "at_qbank_skin";
  var access = null; // 'ok' | 'locked' | 'error', cached for the page view

  function token() {
    try {
      var m = (location.search || "").match(/[?&]at=([A-Za-z0-9._-]+)/);
      if (m) return m[1];
      return sessionStorage.getItem("at_tool_uid");
    } catch (e) {
      return null;
    }
  }

  function loadAccess(done) {
    if (access) return done(access);
    var t = token();
    // No token at all means not signed in — don't spend a request to find out.
    if (!t) {
      access = "locked";
      return done(access);
    }
    fetch(API + "/api/study-tools/skins?at=" + encodeURIComponent(t), { mode: "cors" })
      .then(function (r) {
        access = r.status === 403 ? "locked" : r.ok ? "ok" : "error";
        done(access);
      })
      .catch(function () {
        access = "error";
        done(access);
      });
  }

  function saved() {
    try {
      var s = localStorage.getItem(STORE);
      return s === "examplify" || s === "nbme" ? s : "off";
    } catch (e) {
      return "off";
    }
  }

  function apply(skin) {
    try {
      if (skin === "off") document.documentElement.removeAttribute("data-skin");
      else document.documentElement.setAttribute("data-skin", skin);
      localStorage.setItem(STORE, skin);
    } catch (e) {
      /* private mode — the skin still applies for this page view */
    }
  }

  /** Re-apply on load, but never leave a skin on for someone who signed out. */
  function restore(done) {
    var want = saved();
    if (want === "off") {
      if (done) done("off");
      return;
    }
    loadAccess(function (a) {
      if (a !== "ok") {
        apply("off");
        if (done) done("off");
        return;
      }
      apply(want);
      if (done) done(want);
    });
  }

  var OPTIONS = [
    { id: "off", label: "Off" },
    { id: "examplify", label: "Examplify Skin" },
    { id: "nbme", label: "NBME Skin" },
  ];

  /** Three-button picker; locked until the reader is signed in. */
  function renderPicker(host) {
    if (!host) return;
    host.innerHTML = "";
    host.className = "skin-picker";

    var label = document.createElement("span");
    label.className = "skin-picker-label";
    label.textContent = "Exam skin";
    host.appendChild(label);

    var row = document.createElement("div");
    row.className = "skin-picker-row";
    var buttons = [];

    OPTIONS.forEach(function (opt) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "skin-btn";
      b.textContent = opt.label;
      b.disabled = true;
      b.addEventListener("click", function () {
        apply(opt.id);
        buttons.forEach(function (other) {
          other.classList.toggle("active", other === b);
        });
      });
      buttons.push(b);
      row.appendChild(b);
    });
    host.appendChild(row);

    var note = document.createElement("p");
    note.className = "skin-picker-note";
    host.appendChild(note);

    restore(function (current) {
      buttons.forEach(function (b, i) {
        b.classList.toggle("active", OPTIONS[i].id === current);
      });
      loadAccess(function (a) {
        if (a === "ok") {
          buttons.forEach(function (b) { b.disabled = false; });
          note.textContent = "Practise in a layout built to match the real exam software.";
        } else if (a === "locked") {
          note.innerHTML =
            'Sign in to <a href="' + API + '" target="_blank" rel="noopener">Active Transport</a> ' +
            "and open this QBank from your home page to use the exam skins.";
        } else {
          note.textContent = "Couldn't check your account just now — try again in a moment.";
        }
      });
    });
  }

  global.ATSkin = {
    saved: saved,
    apply: apply,
    restore: restore,
    renderPicker: renderPicker,
    current: function () {
      return document.documentElement.getAttribute("data-skin") || "off";
    },
  };
})(window);
