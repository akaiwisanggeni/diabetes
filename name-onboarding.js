/* =========================================================
   MPD — DIRECT LOGIN
   Name + email only. No magic link.
   ========================================================= */

(function () {
  "use strict";

  function setMessage(message) {
    const element = document.querySelector("#login-message");
    if (element) element.textContent = message || "";
  }

  function normalizeEmail(value) {
    return String(value || "").trim().toLowerCase();
  }

  function setupLoginForm() {
    const form = document.querySelector("#login-form");
    if (!form) return;

    let nameInput = form.querySelector("#name");
    if (!nameInput) {
      const emailLabel = form.querySelector("label[for='email']");
      nameInput = document.createElement("input");
      nameInput.id = "name";
      nameInput.type = "text";
      nameInput.maxLength = 60;
      nameInput.autocomplete = "name";
      nameInput.placeholder = "Masukkan nama Anda";
      nameInput.required = true;
      nameInput.style.marginBottom = "12px";

      const nameLabel = document.createElement("label");
      nameLabel.htmlFor = "name";
      nameLabel.textContent = "Nama";

      if (emailLabel) {
        form.insertBefore(nameLabel, emailLabel);
        form.insertBefore(nameInput, emailLabel);
      } else {
        form.insertBefore(nameLabel, form.firstChild);
        form.insertBefore(nameInput, nameLabel.nextSibling);
      }
    }

    const emailInput = form.querySelector("#email");
    if (!emailInput) return;

    let helper = form.querySelector("#email-helper");
    if (!helper) {
      helper = document.createElement("div");
      helper.id = "email-helper";
      helper.textContent = "Gunakan email yang Anda pakai untuk membeli produk ini.";
      helper.style.margin = "-7px 0 15px";
      helper.style.color = "#7A9E9B";
      helper.style.fontSize = "11.5px";
      helper.style.lineHeight = "1.4";
      form.insertBefore(helper, emailInput.nextSibling);
    }

    const submitButton = form.querySelector("button[type='submit']");
    if (submitButton) submitButton.textContent = "Masuk ke MPD";

    /* Capture phase blocks the old magic-link submit handler in script.js. */
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();

      const name = nameInput.value.trim();
      const email = normalizeEmail(emailInput.value);

      if (!name) {
        setMessage("Masukkan nama Anda.");
        nameInput.focus();
        return;
      }

      if (!email) {
        setMessage("Masukkan email Anda.");
        emailInput.focus();
        return;
      }

      if (name.length > 60) {
        setMessage("Nama maksimal 60 karakter.");
        nameInput.focus();
        return;
      }

      if (!emailInput.checkValidity()) {
        setMessage("Masukkan alamat email yang valid.");
        emailInput.focus();
        return;
      }

      if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = "Masuk...";
      }

      try {
        let user = firebaseAuth.currentUser;

        if (user && !user.isAnonymous) {
          await firebaseAuth.signOut();
          user = null;
        }

        if (!user) {
          const credential = await firebaseAuth.signInAnonymously();
          user = credential.user;
        }

        await user.updateProfile({ displayName: name });

        const userRef = firebaseDb.collection("users").doc(user.uid);
        const existingUser = await userRef.get();

        const profileData = {
          name,
          email,
          status: "active",
          access_type: "self_registered",
          last_login: firebase.firestore.FieldValue.serverTimestamp(),
          updated_at: firebase.firestore.FieldValue.serverTimestamp()
        };

        if (!existingUser.exists) {
          profileData.first_login = firebase.firestore.FieldValue.serverTimestamp();
        }

        await userRef.set(profileData, { merge: true });

        currentUser = user;
        updateUserUI(user);
        showPage("home");
        setMessage("");

      } catch (error) {
        console.error("Direct login error:", error);

        if (error && error.code === "auth/operation-not-allowed") {
          setMessage("Login belum aktif. Aktifkan Anonymous Authentication di Firebase.");
        } else {
          setMessage("Gagal masuk. Coba lagi.");
        }
      } finally {
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.textContent = "Masuk ke MPD";
        }
      }
    }, true);
  }

  function setupPdfCanvas() {
    const viewer = document.querySelector("#pdf-viewer");
    if (!viewer) return;

    const iframe = viewer.querySelector("iframe");
    if (!iframe) return;

    const canvas = document.createElement("canvas");
    canvas.id = "pdf-canvas";
    canvas.setAttribute("aria-label", "PDF Viewer");
    canvas.setAttribute("data-pdf-canvas", "");

    iframe.replaceWith(canvas);
  }

  function setup() {
    setupLoginForm();
    setupPdfCanvas();

    const onboarding = document.querySelector("#name-onboarding");
    if (onboarding) onboarding.remove();
  }

  document.addEventListener("DOMContentLoaded", setup);
})();
