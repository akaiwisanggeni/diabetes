/* =========================================================
   MPD — FIRST LOGIN NAME ONBOARDING
   Production only. Stores the user's chosen display name in
   Firebase Authentication so it follows the user across devices.
   ========================================================= */

(function () {
  "use strict";

  if (new URLSearchParams(window.location.search).get("preview") === "true") {
    return;
  }

  let pendingUser = null;
  let initialized = false;

  function getElements() {
    return {
      screen: document.querySelector("#name-onboarding"),
      form: document.querySelector("#name-onboarding-form"),
      input: document.querySelector("#name-onboarding-input"),
      message: document.querySelector("#name-onboarding-message")
    };
  }

  function showForUser(user) {
    if (!user || user.displayName) return;

    const { screen, input, message } = getElements();
    if (!screen || !input) {
      pendingUser = user;
      return;
    }

    pendingUser = user;
    initialized = true;
    input.value = "";
    if (message) message.textContent = "";
    screen.style.display = "flex";
    input.focus();
  }

  function hide() {
    const { screen } = getElements();
    if (screen) screen.style.display = "none";
    pendingUser = null;
  }

  function setup() {
    if (initialized) return;

    const { form } = getElements();
    if (!form) return;

    initialized = true;

    form.addEventListener("submit", async (event) => {
      event.preventDefault();

      const { input, message } = getElements();
      const name = input ? input.value.trim() : "";

      if (!name) {
        if (message) message.textContent = "Masukkan nama kamu terlebih dahulu.";
        if (input) input.focus();
        return;
      }

      if (name.length > 60) {
        if (message) message.textContent = "Nama maksimal 60 karakter.";
        return;
      }

      if (!pendingUser) return;

      const submitButton = form.querySelector("button[type='submit']");
      if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = "Menyimpan...";
      }

      try {
        await pendingUser.updateProfile({ displayName: name });

        if (typeof updateUserUI === "function") {
          updateUserUI(pendingUser);
        }

        hide();
      } catch (error) {
        console.error("Save display name error:", error);
        if (message) {
          message.textContent = "Nama belum tersimpan. Coba lagi.";
        }
      } finally {
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.textContent = "Lanjut ke Aman Diabetes";
        }
      }
    });

    if (pendingUser) {
      const user = pendingUser;
      pendingUser = null;
      showForUser(user);
    }
  }

  document.addEventListener("DOMContentLoaded", setup);

  if (typeof firebaseAuth !== "undefined") {
    firebaseAuth.onAuthStateChanged((user) => {
      if (!user) {
        hide();
        return;
      }

      if (user.displayName) {
        hide();
        return;
      }

      showForUser(user);
    });
  }
})();
