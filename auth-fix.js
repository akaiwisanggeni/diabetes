/* MPD — AUTH MIGRATION FIX
   Keeps the existing app UI and data functions intact.
   Replaces only the direct-login/auth lifecycle so legacy anonymous
   accounts can be migrated to the existing email identity safely.
*/
(function () {
  "use strict";

  const SESSION_KEY = "mpdAppSession";
  const MIGRATION_KEY = "mpdAuthMigration";
  const SESSION_DAYS = 30;
  const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;

  function setMessage(message) {
    const element = document.querySelector("#login-message");
    if (element) element.textContent = message || "";
  }

  function normalizeEmail(value) {
    return String(value || "").trim().toLowerCase();
  }

  function normalizeName(value) {
    return String(value || "").trim().replace(/\s+/g, " ");
  }

  function makeIdentityKey(name, email) {
    return `${normalizeName(name).toLowerCase()}|${normalizeEmail(email)}`;
  }

  function readSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const session = JSON.parse(raw);
      const lastActive = Number(session?.lastActive);
      if (!session || !session.uid || !Number.isFinite(lastActive)) return null;
      if (Date.now() - lastActive >= SESSION_MS) {
        localStorage.removeItem(SESSION_KEY);
        return null;
      }
      return session;
    } catch (error) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
  }

  function writeSession(user, profile) {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      uid: user.uid,
      name: profile.name,
      email: profile.email,
      identity_key: profile.identity_key,
      lastActive: Date.now()
    }));
  }

  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
  }

  function buildAppUser(authUser, profile) {
    return {
      ...authUser,
      uid: authUser.uid,
      email: profile.email,
      displayName: profile.name,
      identity_key: profile.identity_key,
      auth_uid: authUser.uid,
      isAnonymous: authUser.isAnonymous
    };
  }

  function serializeFirestoreData(value) {
    if (value && typeof value.toDate === "function") {
      return { __mpdTimestamp: value.toDate().toISOString() };
    }
    if (value instanceof Date) {
      return { __mpdTimestamp: value.toISOString() };
    }
    if (Array.isArray(value)) return value.map(serializeFirestoreData);
    if (value && typeof value === "object") {
      const result = {};
      Object.keys(value).forEach((key) => {
        result[key] = serializeFirestoreData(value[key]);
      });
      return result;
    }
    return value;
  }

  function restoreFirestoreData(value) {
    if (Array.isArray(value)) return value.map(restoreFirestoreData);
    if (value && typeof value === "object") {
      if (value.__mpdTimestamp) return new Date(value.__mpdTimestamp);
      const result = {};
      Object.keys(value).forEach((key) => {
        result[key] = restoreFirestoreData(value[key]);
      });
      return result;
    }
    return value;
  }

  async function readMigrationSource(sourceUser) {
    const sourceUid = sourceUser.uid;
    const profileSnapshot = await firebaseDb.collection("users").doc(sourceUid).get();
    const collections = ["blood_sugar_tracker", "weight_tracker"];
    const bundle = {
      version: 1,
      sourceUid,
      createdAt: Date.now(),
      profile: profileSnapshot.exists ? serializeFirestoreData(profileSnapshot.data()) : null,
      records: {}
    };

    for (const collectionName of collections) {
      const snapshot = await firebaseDb
        .collection(collectionName)
        .where("user_id", "==", sourceUid)
        .get();
      bundle.records[collectionName] = snapshot.docs.map((doc) => ({
        id: doc.id,
        data: serializeFirestoreData(doc.data())
      }));
    }

    return bundle;
  }

  async function saveMigrationBundle(sourceUser, email, name) {
    const bundle = await readMigrationSource(sourceUser);
    bundle.email = email;
    bundle.name = name;
    localStorage.setItem(MIGRATION_KEY, JSON.stringify(bundle));
    return bundle;
  }

  function readMigrationBundle() {
    try {
      const raw = localStorage.getItem(MIGRATION_KEY);
      if (!raw) return null;
      const bundle = JSON.parse(raw);
      if (!bundle || !bundle.sourceUid || !bundle.email) return null;
      return bundle;
    } catch (error) {
      return null;
    }
  }

  function clearMigrationBundle() {
    localStorage.removeItem(MIGRATION_KEY);
  }

  async function commitMigrationBundle(bundle, targetUser) {
    const targetUid = targetUser.uid;
    const targetUserRef = firebaseDb.collection("users").doc(targetUid);
    const existingTarget = await targetUserRef.get();

    if (existingTarget.exists && existingTarget.data()?.migration_source_uid === bundle.sourceUid) {
      return;
    }

    let batch = firebaseDb.batch();
    let operationCount = 0;

    const commitBatch = async () => {
      if (operationCount === 0) return;
      await batch.commit();
      batch = firebaseDb.batch();
      operationCount = 0;
    };

    const profile = restoreFirestoreData(bundle.profile || {});
    const mergedProfile = {
      ...profile,
      name: normalizeName(bundle.name || profile.name || targetUser.displayName || ""),
      email: normalizeEmail(bundle.email || targetUser.email || ""),
      identity_key: makeIdentityKey(
        bundle.name || profile.name || targetUser.displayName || "",
        bundle.email || targetUser.email || ""
      ),
      migration_source_uid: bundle.sourceUid,
      migration_completed_at: firebase.firestore.FieldValue.serverTimestamp(),
      updated_at: firebase.firestore.FieldValue.serverTimestamp(),
      access_type: "self_registered"
    };

    batch.set(targetUserRef, mergedProfile, { merge: true });
    operationCount += 1;

    for (const [collectionName, records] of Object.entries(bundle.records || {})) {
      for (const record of records || []) {
        const destinationId = `migrated_${bundle.sourceUid}_${record.id}`;
        const destinationRef = firebaseDb.collection(collectionName).doc(destinationId);
        const data = restoreFirestoreData(record.data || {});
        data.user_id = targetUid;
        data.migrated_from_uid = bundle.sourceUid;
        data.migrated_from_id = record.id;
        batch.set(destinationRef, data, { merge: true });
        operationCount += 1;
        if (operationCount >= 450) await commitBatch();
      }
    }

    await commitBatch();
  }

  async function completeMigrationIfNeeded(user) {
    const bundle = readMigrationBundle();
    if (!bundle) return false;

    if (normalizeEmail(user.email) !== normalizeEmail(bundle.email)) {
      setMessage("Email verifikasi tidak sesuai dengan akun yang sedang dipulihkan.");
      return false;
    }

    setMessage("Login berhasil. Memindahkan data tracker lama...");
    await commitMigrationBundle(bundle, user);
    clearMigrationBundle();
    return true;
  }

  async function sendMigrationLink(email, name, sourceUser) {
    await saveMigrationBundle(sourceUser, email, name);
    await firebaseAuth.sendSignInLinkToEmail(email, {
      url: window.location.origin + window.location.pathname,
      handleCodeInApp: true
    });
    localStorage.setItem("mpdEmailForMigration", email);
  }

  async function activateSession(authUser, name, email) {
    const normalizedName = normalizeName(name);
    const normalizedEmail = normalizeEmail(email);
    const identityKey = makeIdentityKey(normalizedName, normalizedEmail);
    const userRef = firebaseDb.collection("users").doc(authUser.uid);
    const snapshot = await userRef.get();
    const existingData = snapshot.exists ? snapshot.data() : null;

    if (existingData?.status === "banned") {
      clearSession();
      setMessage("Akses akun ini telah dinonaktifkan.");
      return null;
    }

    const profileData = {
      name: normalizedName,
      email: normalizedEmail,
      identity_key: identityKey,
      status: existingData?.status || "active",
      access_type: "self_registered",
      last_login: firebase.firestore.FieldValue.serverTimestamp(),
      updated_at: firebase.firestore.FieldValue.serverTimestamp()
    };

    if (!snapshot.exists) profileData.first_login = firebase.firestore.FieldValue.serverTimestamp();
    await userRef.set(profileData, { merge: true });

    try {
      await authUser.updateProfile({ displayName: normalizedName });
    } catch (error) {
      console.warn("Firebase display name update skipped:", error);
    }

    const profile = { name: normalizedName, email: normalizedEmail, identity_key: identityKey };
    writeSession(authUser, profile);
    currentUser = buildAppUser(authUser, profile);
    updateUserUI(currentUser);
    showPage("home");
    setMessage("");

    await loadPdfLibrary();
    await loadCarbFoods();
    await loadBloodSugarRecords();
    await loadWeightRecords();
    return currentUser;
  }

  async function handleDirectLogin(name, email, password) {
    const existing = firebaseAuth.currentUser;

    if (existing && !existing.isAnonymous && normalizeEmail(existing.email) === email) {
      await existing.updatePassword(password);
      return existing;
    }

    if (existing && !existing.isAnonymous) await firebaseAuth.signOut();

    let anonymousUser = firebaseAuth.currentUser;
    if (!anonymousUser) anonymousUser = (await firebaseAuth.signInAnonymously()).user;

    const credential = firebase.auth.EmailAuthProvider.credential(email, password);

    try {
      const linked = await anonymousUser.linkWithCredential(credential);
      return linked.user;
    } catch (error) {
      if (!error || error.code !== "auth/credential-already-in-use") throw error;
      await sendMigrationLink(email, name, anonymousUser);
      const migrationError = new Error("MPD_MIGRATION_LINK_SENT");
      migrationError.code = "mpd/migration-link-sent";
      throw migrationError;
    }
  }

  function replaceLoginForm() {
    const form = document.querySelector("#login-form");
    if (!form) return null;

    const replacement = form.cloneNode(true);
    form.replaceWith(replacement);

    let nameInput = replacement.querySelector("#name");
    if (!nameInput) {
      const emailLabel = replacement.querySelector("label[for='email']");
      nameInput = document.createElement("input");
      nameInput.id = "name";
      nameInput.type = "text";
      nameInput.maxLength = 60;
      nameInput.autocomplete = "name";
      nameInput.placeholder = "Masukkan nama Anda";
      nameInput.required = true;
      const nameLabel = document.createElement("label");
      nameLabel.htmlFor = "name";
      nameLabel.textContent = "Nama";
      if (emailLabel) {
        replacement.insertBefore(nameLabel, emailLabel);
        replacement.insertBefore(nameInput, emailLabel);
      } else {
        replacement.prepend(nameInput);
        replacement.prepend(nameLabel);
      }
    }

    const emailInput = replacement.querySelector("#email");
    if (!emailInput) return replacement;

    let passwordInput = replacement.querySelector("#password");
    if (!passwordInput) {
      const emailHelper = replacement.querySelector("#email-helper");
      const passwordLabel = document.createElement("label");
      passwordLabel.htmlFor = "password";
      passwordLabel.textContent = "Kata sandi";
      passwordInput = document.createElement("input");
      passwordInput.id = "password";
      passwordInput.type = "password";
      passwordInput.minLength = 6;
      passwordInput.autocomplete = "current-password";
      passwordInput.placeholder = "Minimal 6 karakter";
      passwordInput.required = true;
      const anchor = emailHelper || emailInput;
      anchor.insertAdjacentElement("afterend", passwordLabel);
      passwordLabel.insertAdjacentElement("afterend", passwordInput);
    }

    const submitButton = replacement.querySelector("button[type='submit']");
    if (submitButton) submitButton.textContent = "Masuk ke MPD";

    replacement.addEventListener("submit", async (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();

      const name = normalizeName(nameInput.value);
      const email = normalizeEmail(emailInput.value);
      const password = String(passwordInput.value || "");

      if (!name) return setMessage("Masukkan nama Anda.");
      if (!email || !emailInput.checkValidity()) return setMessage("Masukkan alamat email yang valid.");
      if (name.length > 60) return setMessage("Nama maksimal 60 karakter.");
      if (password.length < 6) return setMessage("Kata sandi minimal 6 karakter.");

      if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = "Masuk...";
      }

      try {
        const user = await handleDirectLogin(name, email, password);
        await activateSession(user, name, email);
      } catch (error) {
        console.error("MPD direct login error:", error);
        if (error?.code === "mpd/migration-link-sent") {
          setMessage("Link verifikasi sudah dikirim ke email Anda. Buka link tersebut di perangkat ini untuk memindahkan data lama. Jangan hapus data browser dulu.");
        } else if (error?.code === "auth/operation-not-allowed") {
          setMessage("Aktifkan Email/Password, Email Link, dan Anonymous Authentication di Firebase.");
        } else if (["auth/wrong-password", "auth/invalid-credential", "auth/user-disabled"].includes(error?.code)) {
          setMessage("Email atau kata sandi salah.");
        } else if (error?.code === "auth/weak-password") {
          setMessage("Kata sandi terlalu lemah. Gunakan minimal 6 karakter.");
        } else if (error?.code === "auth/too-many-requests") {
          setMessage("Terlalu banyak percobaan. Coba lagi beberapa saat lagi.");
        } else {
          setMessage("Gagal masuk. Coba lagi.");
        }
      } finally {
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.textContent = "Masuk ke MPD";
        }
      }
    });

    return replacement;
  }

  function restoreUiForUser(authUser, session) {
    if (!authUser || !session || session.uid !== authUser.uid) {
      currentUser = null;
      updateUserUI(null);
      return false;
    }
    currentUser = buildAppUser(authUser, {
      name: session.name,
      email: session.email,
      identity_key: session.identity_key || makeIdentityKey(session.name, session.email)
    });
    updateUserUI(currentUser);
    return true;
  }

  initializeAuth = function () {
    firebaseAuth.onAuthStateChanged(async (authUser) => {
      if (!authUser) {
        currentUser = null;
        updateUserUI(null);
        return;
      }

      const session = readSession();
      if (!restoreUiForUser(authUser, session)) return;

      try {
        const profileSnapshot = await firebaseDb.collection("users").doc(authUser.uid).get();
        if (!profileSnapshot.exists || profileSnapshot.data()?.status === "banned") {
          clearSession();
          currentUser = null;
          updateUserUI(null);
          return;
        }

        const data = profileSnapshot.data();
        const profile = {
          name: data.name || session.name,
          email: data.email || session.email,
          identity_key: data.identity_key || makeIdentityKey(data.name || session.name, data.email || session.email)
        };

        writeSession(authUser, profile);
        currentUser = buildAppUser(authUser, profile);
        updateUserUI(currentUser);
        await loadPdfLibrary();
        await loadCarbFoods();
        await loadBloodSugarRecords();
        await loadWeightRecords();
      } catch (error) {
        console.error("MPD auth restore error:", error);
        clearSession();
        currentUser = null;
        updateUserUI(null);
      }
    });
  };

  setupLogout = function () {
    document.querySelectorAll("#logout-btn, #logout, .logout-btn, [data-logout]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        clearSession();
        currentUser = null;
        updateUserUI(null);
        showPage("home");
      }, true);
    });
  };

  setupMagicLinkForm = function () {};

  completeMagicLinkLogin = async function () {
    if (!firebaseAuth.isSignInWithEmailLink(window.location.href)) return;

    let email = normalizeEmail(localStorage.getItem("mpdEmailForMigration"));
    if (!email) email = normalizeEmail(localStorage.getItem("mpdEmailForSignIn"));
    if (!email) email = normalizeEmail(window.prompt("Masukkan kembali email Anda:"));
    if (!email) return setMessage("Email diperlukan untuk menyelesaikan login.");

    try {
      setMessage("Menyelesaikan verifikasi email...");
      const result = await firebaseAuth.signInWithEmailLink(email, window.location.href);
      localStorage.removeItem("mpdEmailForMigration");
      localStorage.removeItem("mpdEmailForSignIn");
      window.history.replaceState({}, document.title, window.location.pathname);

      if (readMigrationBundle()) {
        await completeMigrationIfNeeded(result.user);
        setMessage("Data lama sudah dipindahkan. Sekarang masukkan kata sandi baru lalu klik Masuk ke MPD.");
        clearSession();
        currentUser = null;
        updateUserUI(null);
      }
    } catch (error) {
      console.error("MPD email-link migration error:", error);
      setMessage("Verifikasi email gagal. Pastikan link masih berlaku dan gunakan email yang sama.");
    }
  };

  document.addEventListener("DOMContentLoaded", () => {
    const form = replaceLoginForm();
    if (!form) return;
    const migrationBundle = readMigrationBundle();
    if (migrationBundle) {
      const emailInput = form.querySelector("#email");
      if (emailInput) emailInput.value = migrationBundle.email || "";
    }
  }, { once: true });
})();
