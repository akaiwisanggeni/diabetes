/* =========================================================
   PANDUAN DIABETES — AUTH CONTROLLER
   Single email/password controller. Legacy auth scripts are not loaded.
   ========================================================= */
(function () {
  "use strict";

  let authBusy = false;

  const LOGIN_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
  const LOGIN_STARTED_AT_KEY = "mpdLoginStartedAt";

  function rememberLoginStart() {
    try {
      localStorage.setItem(LOGIN_STARTED_AT_KEY, String(Date.now()));
    } catch (error) {
      console.warn("Login timestamp tidak dapat disimpan:", error);
    }
  }

  function clearLoginStart() {
    try {
      localStorage.removeItem(LOGIN_STARTED_AT_KEY);
    } catch (error) {
      console.warn("Login timestamp tidak dapat dihapus:", error);
    }
  }

  function isLoginExpired() {
    try {
      const raw = localStorage.getItem(LOGIN_STARTED_AT_KEY);
      if (!raw) return false;

      const startedAt = Number(raw);
      return !Number.isFinite(startedAt) || Date.now() - startedAt >= LOGIN_MAX_AGE_MS;
    } catch (error) {
      return false;
    }
  }

  function normalizeEmail(value) {
    return String(value || "").trim().toLowerCase();
  }

  function normalizeName(value) {
    return String(value || "").trim().replace(/\s+/g, " ");
  }

  function setMessage(message, type = "") {
    const element = document.querySelector("#login-message");
    if (!element) return;
    element.textContent = message || "";
    element.classList.remove("is-error", "is-success");
    if (type) element.classList.add(type === "error" ? "is-error" : "is-success");
  }

  function firebaseErrorMessage(error, action) {
    const code = error?.code || "";
    const messages = {
      "auth/invalid-email": "Format alamat email tidak valid.",
      "auth/missing-password": "Masukkan kata sandi.",
      "auth/weak-password": "Kata sandi minimal 6 karakter.",
      "auth/email-already-in-use": "Email ini sudah terdaftar. Silakan masuk.",
      "auth/user-not-found": "Email atau kata sandi salah.",
      "auth/wrong-password": "Email atau kata sandi salah.",
      "auth/invalid-credential": "Email atau kata sandi salah.",
      "auth/user-disabled": "Akun ini telah dinonaktifkan.",
      "auth/too-many-requests": "Terlalu banyak percobaan. Tunggu beberapa saat lalu coba lagi.",
      "auth/network-request-failed": "Koneksi internet bermasalah. Periksa koneksi lalu coba lagi.",
      "auth/operation-not-allowed": "Login Email/Password belum diaktifkan di Firebase.",
      "auth/unauthorized-domain": "Domain aplikasi belum diizinkan di Firebase Authentication."
    };
    return messages[code] || `Gagal ${action}. Silakan coba lagi.${code ? ` (${code})` : ""}`;
  }

  function showLoginScreen() {
    const loginScreen = document.querySelector("#login-screen");
    const appScreen = document.querySelector("#app-screen");
    if (loginScreen) loginScreen.style.display = "";
    if (appScreen) appScreen.style.display = "none";
  }

  async function openApp(user) {
    if (!user || user.isAnonymous) {
      if (user?.isAnonymous) await firebaseAuth.signOut();
      currentUser = null;
      showLoginScreen();
      return;
    }

    let profile = {
      name: user.displayName || (user.email ? user.email.split("@")[0] : "User"),
      email: normalizeEmail(user.email)
    };

    try {
      const ref = firebaseDb.collection("users").doc(user.uid);
      const snapshot = await ref.get();

      if (snapshot.exists) {
        const data = snapshot.data() || {};
        if (data.status === "banned" || data.status === "revoked") {
          await firebaseAuth.signOut();
          clearUserDataState();
          setMessage("Akun ini telah dinonaktifkan.", "error");
          return;
        }

        profile.name = normalizeName(data.name) || profile.name;
        profile.email = normalizeEmail(data.email) || profile.email;

        ref.set({
          last_login: firebase.firestore.FieldValue.serverTimestamp(),
          updated_at: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true }).catch((error) => {
          console.warn("Tidak dapat memperbarui last_login:", error);
        });
      } else {
        await ref.set({
          name: profile.name,
          email: profile.email,
          status: "active",
          access_type: "self_registered",
          created_at: firebase.firestore.FieldValue.serverTimestamp(),
          updated_at: firebase.firestore.FieldValue.serverTimestamp(),
          last_login: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      }
    } catch (error) {
      // Auth is already valid. Do not turn a Firestore problem into a login failure.
      console.warn("Profil Firestore tidak dapat dimuat:", error);
    }

    currentUser = user;
    try {
      if (profile.name && profile.name !== user.displayName) {
        await user.updateProfile({ displayName: profile.name });
      }
    } catch (error) {
      console.warn("Display name update skipped:", error);
    }

    await Promise.allSettled([
      Promise.resolve().then(() => loadPdfLibrary()),
      Promise.resolve().then(() => loadCarbFoods()),
      Promise.resolve().then(() => loadBloodSugarRecords()),
      Promise.resolve().then(() => loadWeightRecords())
    ]);

    updateUserUI(currentUser);
    showPage("home");
  }

  async function migratePendingBundle(user) {
    let raw = null;
    try {
      raw = JSON.parse(localStorage.getItem("mpdAuthMigration") || "null");
    } catch (_) {
      raw = null;
    }

    if (!raw || !raw.sourceUid || !raw.email) return;

    if (normalizeEmail(raw.email) !== normalizeEmail(user.email)) return;

    try {
      const targetRef = firebaseDb.collection("users").doc(user.uid);
      const existing = await targetRef.get();

      if (!(existing.exists && existing.data()?.migration_source_uid === raw.sourceUid)) {
        const restore = (value) => {
          if (Array.isArray(value)) return value.map(restore);
          if (value && typeof value === "object") {
            if (value.__mpdTimestamp) return new Date(value.__mpdTimestamp);
            const result = {};
            Object.keys(value).forEach((key) => { result[key] = restore(value[key]); });
            return result;
          }
          return value;
        };

        const profile = restore(raw.profile || {});
        let batch = firebaseDb.batch();
        let count = 0;

        const commitBatch = async () => {
          if (!count) return;
          await batch.commit();
          batch = firebaseDb.batch();
          count = 0;
        };

        batch.set(targetRef, {
          ...profile,
          name: normalizeName(raw.name || profile.name || user.displayName || ""),
          email: normalizeEmail(raw.email || user.email),
          migration_source_uid: raw.sourceUid,
          migration_completed_at: firebase.firestore.FieldValue.serverTimestamp(),
          updated_at: firebase.firestore.FieldValue.serverTimestamp(),
          access_type: "self_registered"
        }, { merge: true });
        count++;

        for (const [collectionName, records] of Object.entries(raw.records || {})) {
          for (const record of records || []) {
            const data = restore(record.data || {});
            data.user_id = user.uid;
            data.migrated_from_uid = raw.sourceUid;
            data.migrated_from_id = record.id;
            batch.set(
              firebaseDb.collection(collectionName).doc(`migrated_${raw.sourceUid}_${record.id}`),
              data,
              { merge: true }
            );
            count++;

            if (count >= 400) {
              await commitBatch();
            }
          }
        }

        await commitBatch();
      }

      localStorage.removeItem("mpdAuthMigration");
    } catch (error) {
      console.warn("Migrasi data lama dilewati:", error);
    }
  }

  function setupTabs() {
    const loginTab = document.querySelector("#show-login-btn");
    const registerTab = document.querySelector("#show-register-btn");
    const loginForm = document.querySelector("#login-form");
    const registerForm = document.querySelector("#register-form");
    const subtitle = document.querySelector("#auth-subtitle");

    if (!loginTab || !registerTab || !loginForm || !registerForm) return;

    const setMode = (mode) => {
      const isLogin = mode === "login";
      loginForm.style.display = isLogin ? "" : "none";
      registerForm.style.display = isLogin ? "none" : "";
      loginTab.classList.toggle("active", isLogin);
      registerTab.classList.toggle("active", !isLogin);
      loginTab.setAttribute("aria-selected", String(isLogin));
      registerTab.setAttribute("aria-selected", String(!isLogin));
      if (subtitle) {
        subtitle.textContent = isLogin
          ? "Masuk untuk mengakses materi dan tracker kesehatanmu."
          : "Buat akun untuk mengakses materi dan tracker kesehatanmu.";
      }
      setMessage("");
    };

    loginTab.addEventListener("click", () => setMode("login"));
    registerTab.addEventListener("click", () => setMode("register"));
    setMode("login");
  }

  function setupPasswordToggle(buttonId, inputId) {
    const button = document.querySelector(buttonId);
    const input = document.querySelector(inputId);
    if (!button || !input) return;

    button.addEventListener("click", () => {
      const visible = input.type === "text";
      input.type = visible ? "password" : "text";
      button.textContent = visible ? "Tampilkan" : "Sembunyikan";
      button.setAttribute("aria-label", visible ? "Tampilkan kata sandi" : "Sembunyikan kata sandi");
    });
  }

  function setupLoginForm() {
    const form = document.querySelector("#login-form");
    const emailInput = document.querySelector("#login-email");
    const passwordInput = document.querySelector("#login-password");
    const submitButton = document.querySelector("#login-submit");
    if (!form || !emailInput || !passwordInput || !submitButton) return;

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (authBusy) return;

      const email = normalizeEmail(emailInput.value);
      const password = String(passwordInput.value || "");

      if (!email || !emailInput.checkValidity()) {
        setMessage("Masukkan alamat email yang valid.", "error");
        emailInput.focus();
        return;
      }

      if (password.length < 6) {
        setMessage("Kata sandi minimal 6 karakter.", "error");
        passwordInput.focus();
        return;
      }

      authBusy = true;
      submitButton.disabled = true;
      submitButton.textContent = "Memproses...";
      setMessage("Sedang masuk...");

      try {
        await firebaseAuth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
        const credential = await firebaseAuth.signInWithEmailAndPassword(email, password);
        rememberLoginStart();
        await migratePendingBundle(credential.user);
        await openApp(credential.user);
        setMessage("");
      } catch (error) {
        console.error("Firebase login gagal:", error?.code, error?.message);
        setMessage(firebaseErrorMessage(error, "masuk"), "error");
      } finally {
        authBusy = false;
        submitButton.disabled = false;
        submitButton.textContent = "Masuk";
      }
    });
  }

  function setupRegisterForm() {
    const form = document.querySelector("#register-form");
    const nameInput = document.querySelector("#register-name");
    const emailInput = document.querySelector("#register-email");
    const passwordInput = document.querySelector("#register-password");
    const confirmInput = document.querySelector("#register-password-confirm");
    const submitButton = document.querySelector("#register-submit");
    if (!form || !nameInput || !emailInput || !passwordInput || !confirmInput || !submitButton) return;

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (authBusy) return;

      const name = normalizeName(nameInput.value);
      const email = normalizeEmail(emailInput.value);
      const password = String(passwordInput.value || "");
      const confirmation = String(confirmInput.value || "");

      if (!name) {
        setMessage("Masukkan nama kamu.", "error");
        nameInput.focus();
        return;
      }
      if (!email || !emailInput.checkValidity()) {
        setMessage("Masukkan alamat email yang valid.", "error");
        emailInput.focus();
        return;
      }
      if (password.length < 6) {
        setMessage("Kata sandi minimal 6 karakter.", "error");
        passwordInput.focus();
        return;
      }
      if (password !== confirmation) {
        setMessage("Konfirmasi kata sandi tidak sama.", "error");
        confirmInput.focus();
        return;
      }

      authBusy = true;
      submitButton.disabled = true;
      submitButton.textContent = "Membuat akun...";
      setMessage("Sedang membuat akun...");

      try {
        await firebaseAuth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
        const credential = await firebaseAuth.createUserWithEmailAndPassword(email, password);
        rememberLoginStart();
        await credential.user.updateProfile({ displayName: name });

        await firebaseDb.collection("users").doc(credential.user.uid).set({
          name,
          email,
          status: "active",
          access_type: "self_registered",
          created_at: firebase.firestore.FieldValue.serverTimestamp(),
          updated_at: firebase.firestore.FieldValue.serverTimestamp(),
          last_login: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        await openApp(credential.user);
        setMessage("");
      } catch (error) {
        console.error("Firebase register gagal:", error?.code, error?.message);
        setMessage(firebaseErrorMessage(error, "membuat akun"), "error");
      } finally {
        authBusy = false;
        submitButton.disabled = false;
        submitButton.textContent = "Daftar dan Masuk";
      }
    });
  }

  function setupPasswordReset() {
    const button = document.querySelector("#forgot-password-btn");
    const emailInput = document.querySelector("#login-email");
    if (!button || !emailInput) return;

    button.addEventListener("click", async () => {
      const email = normalizeEmail(emailInput.value);
      if (!email || !emailInput.checkValidity()) {
        setMessage("Masukkan email yang valid terlebih dahulu.", "error");
        emailInput.focus();
        return;
      }

      button.disabled = true;
      setMessage("Mengirim link reset...");

      try {
        await firebaseAuth.sendPasswordResetEmail(email);
        setMessage("Jika email tersebut terdaftar, link reset kata sandi sudah dikirim. Cek inbox atau folder spam.", "success");
      } catch (error) {
        console.error("Reset password gagal:", error?.code, error?.message);
        setMessage(firebaseErrorMessage(error, "mengirim link reset"), "error");
      } finally {
        button.disabled = false;
      }
    });
  }

  function clearUserDataState() {
    bloodSugarRecords = [];
    weightRecords = [];

    if (typeof renderBloodSugarChart === "function") {
      renderBloodSugarChart();
    }
    if (typeof renderWeightProgress === "function") {
      renderWeightProgress();
    }

    const summaryBloodSugarDate = document.getElementById("summary-blood-sugar-date");
    const summaryBloodSugarValue = document.getElementById("summary-blood-sugar-value");
    const summaryBloodSugarSub = document.getElementById("summary-blood-sugar-sub");
    const summaryWeightDate = document.getElementById("summary-weight-date");
    const summaryWeightValue = document.getElementById("summary-weight-value");
    const summaryWeightSub = document.getElementById("summary-weight-sub");

    if (summaryBloodSugarDate) summaryBloodSugarDate.textContent = "Belum ada catatan";
    if (summaryBloodSugarValue && summaryBloodSugarValue.firstChild) summaryBloodSugarValue.firstChild.nodeValue = "—";
    if (summaryBloodSugarSub) summaryBloodSugarSub.textContent = "Belum ada catatan";
    if (summaryWeightDate) summaryWeightDate.textContent = "Belum ada catatan";
    if (summaryWeightValue && summaryWeightValue.firstChild) summaryWeightValue.firstChild.nodeValue = "—";
    if (summaryWeightSub) summaryWeightSub.textContent = "Belum ada catatan";

    const streakElement = document.getElementById("streak-count");
    if (streakElement) streakElement.textContent = "0";

    currentUser = null;
    updateUserUI(null);
    showLoginScreen();
  }

  window.initializeAuth = function initializeAuth() {
    firebaseAuth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch((error) => {
      console.warn("Persistence setup gagal:", error);
    });

    firebaseAuth.onAuthStateChanged(async (user) => {
      if (!user) {
        clearUserDataState();
        return;
      }

      if (currentUser && currentUser.uid !== user.uid) {
        clearUserDataState();
      }

      if (user.isAnonymous) {
        await firebaseAuth.signOut();
        clearLoginStart();
        clearUserDataState();
        return;
      }

      if (isLoginExpired()) {
        await firebaseAuth.signOut();
        clearLoginStart();
        clearUserDataState();
        setMessage("Sesi login sudah 30 hari. Silakan masuk kembali.", "error");
        return;
      }

      try {
        const raw = localStorage.getItem(LOGIN_STARTED_AT_KEY);
        if (!raw) rememberLoginStart();
      } catch (error) {
        rememberLoginStart();
      }

      await openApp(user);
    });
  };

  window.setupLogout = function setupLogout() {
    document.querySelectorAll("#logout-btn, #logout, .logout-btn, [data-logout]").forEach((button) => {
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();

        try {
          await firebaseAuth.signOut();
          clearLoginStart();
        } catch (error) {
          console.error("Logout gagal:", error);
          setMessage("Gagal keluar. Silakan coba lagi.", "error");
        }
      }, true);
    });
  };

  function initializeForms() {
    setupTabs();
    setupLoginForm();
    setupRegisterForm();
    setupPasswordReset();
    setupPasswordToggle("#toggle-login-password", "#login-password");
    setupPasswordToggle("#toggle-register-password", "#register-password");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeForms, { once: true });
  } else {
    initializeForms();
  }
})();
