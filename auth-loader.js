/* MPD AUTH LOADER — legacy anonymous -> permanent email account migration */
(function () {
  "use strict";

  const MIGRATION_KEY = "mpdAuthMigration";
  const EMAIL_KEY = "mpdEmailForMigration";
  const SESSION_KEY = "mpdAppSession";
  const PASSWORD_SETUP_KEY = "mpdNeedsPasswordSetup";
  const normEmail = (v) => String(v || "").trim().toLowerCase();
  const normName = (v) => String(v || "").trim().replace(/\s+/g, " ");
  const msg = (v) => { const el = document.querySelector("#login-message"); if (el) el.textContent = v || ""; };
  const key = (n, e) => `${normName(n).toLowerCase()}|${normEmail(e)}`;

  // Wait until Firebase has restored the persisted auth state after a refresh.
  // Without this, a fast submit can see currentUser as null and start the
  // anonymous -> legacy-account migration flow again.
  const authReady = new Promise((resolve) => {
    let unsubscribe;
    unsubscribe = firebaseAuth.onAuthStateChanged((user) => {
      if (unsubscribe) unsubscribe();
      resolve(user);
    });
  });

  function ser(v) {
    if (v && typeof v.toDate === "function") return { __mpdTimestamp: v.toDate().toISOString() };
    if (v instanceof Date) return { __mpdTimestamp: v.toISOString() };
    if (Array.isArray(v)) return v.map(ser);
    if (v && typeof v === "object") { const o = {}; Object.keys(v).forEach(k => o[k] = ser(v[k])); return o; }
    return v;
  }
  function restore(v) {
    if (Array.isArray(v)) return v.map(restore);
    if (v && typeof v === "object") { if (v.__mpdTimestamp) return new Date(v.__mpdTimestamp); const o = {}; Object.keys(v).forEach(k => o[k] = restore(v[k])); return o; }
    return v;
  }
  function bundle() { try { const b = JSON.parse(localStorage.getItem(MIGRATION_KEY) || "null"); return b && b.sourceUid && b.email ? b : null; } catch (_) { return null; } }

  async function capture(source, n, e) {
    const uid = source.uid;
    const profile = await firebaseDb.collection("users").doc(uid).get();
    const b = { version: 4, sourceUid: uid, createdAt: Date.now(), name: normName(n), email: normEmail(e), profile: profile.exists ? ser(profile.data()) : null, records: {} };
    for (const c of ["blood_sugar_tracker", "weight_tracker"]) {
      const snap = await firebaseDb.collection(c).where("user_id", "==", uid).get();
      b.records[c] = snap.docs.map(d => ({ id: d.id, data: ser(d.data()) }));
    }
    localStorage.setItem(MIGRATION_KEY, JSON.stringify(b));
    localStorage.setItem(EMAIL_KEY, b.email);
  }

  async function sendLink(e) {
    await firebaseAuth.sendSignInLinkToEmail(e, { url: window.location.origin + window.location.pathname, handleCodeInApp: true });
    localStorage.setItem(EMAIL_KEY, e);
  }

  async function migrate(b, target) {
    const targetRef = firebaseDb.collection("users").doc(target.uid);
    const existing = await targetRef.get();
    if (existing.exists && existing.data()?.migration_source_uid === b.sourceUid) return;
    const profile = restore(b.profile || {}), n = normName(b.name || profile.name || target.displayName || ""), e = normEmail(b.email || target.email || "");
    let batch = firebaseDb.batch(), count = 0;
    const flush = async () => { if (!count) return; await batch.commit(); batch = firebaseDb.batch(); count = 0; };
    batch.set(targetRef, { ...profile, name: n, email: e, identity_key: key(n, e), migration_source_uid: b.sourceUid, migration_completed_at: firebase.firestore.FieldValue.serverTimestamp(), updated_at: firebase.firestore.FieldValue.serverTimestamp(), access_type: "self_registered" }, { merge: true }); count++;
    for (const [c, records] of Object.entries(b.records || {})) for (const r of records || []) {
      const data = restore(r.data || {}); data.user_id = target.uid; data.migrated_from_uid = b.sourceUid; data.migrated_from_id = r.id;
      batch.set(firebaseDb.collection(c).doc(`migrated_${b.sourceUid}_${r.id}`), data, { merge: true }); count++; if (count >= 450) await flush();
    }
    await flush();
  }

  async function activate(user, n, e) {
    const nn = normName(n), ee = normEmail(e), ref = firebaseDb.collection("users").doc(user.uid), snap = await ref.get(), old = snap.exists ? snap.data() : {};
    if (old.status === "banned") throw new Error("Akun ini dinonaktifkan.");
    await ref.set({ name: nn, email: ee, identity_key: key(nn, ee), status: old.status || "active", access_type: "self_registered", last_login: firebase.firestore.FieldValue.serverTimestamp(), updated_at: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
    try { await user.updateProfile({ displayName: nn }); } catch (_) {}
    localStorage.setItem(SESSION_KEY, JSON.stringify({ uid: user.uid, name: nn, email: ee, identity_key: key(nn, ee), lastActive: Date.now() }));
    currentUser = { ...user, uid: user.uid, email: ee, displayName: nn, identity_key: key(nn, ee), auth_uid: user.uid, isAnonymous: user.isAnonymous };
    localStorage.removeItem(PASSWORD_SETUP_KEY);
    updateUserUI(currentUser); showPage("home"); msg("");
    await loadPdfLibrary(); await loadCarbFoods(); await loadBloodSugarRecords(); await loadWeightRecords();
  }

  function errorText(error) {
    const c = error?.code || "unknown-error";
    const map = {
      "auth/operation-not-allowed": "Email/Password, Email Link, atau Anonymous Authentication belum aktif di Firebase.",
      "auth/unauthorized-continue-uri": "Domain MPD belum diizinkan untuk Email Link di Firebase Authentication.",
      "auth/invalid-continue-uri": "Alamat redirect Email Link tidak valid di Firebase.",
      "auth/missing-continue-uri": "Konfigurasi Email Link belum lengkap di Firebase.",
      "auth/invalid-action-code": "Link verifikasi sudah tidak berlaku. Kirim link baru.",
      "auth/expired-action-code": "Link verifikasi sudah kedaluwarsa. Kirim link baru.",
      "auth/network-request-failed": "Koneksi ke Firebase gagal. Coba lagi.",
      "auth/requires-recent-login": "Sesi login perlu diverifikasi ulang lewat email.",
      "auth/invalid-credential": "Email atau kata sandi salah."
    };
    msg(map[c] || `Gagal masuk (${c}). Coba lagi.`); console.error("MPD auth:", error);
  }

  async function finishLink() {
    if (!firebaseAuth.isSignInWithEmailLink(window.location.href)) return;
    const e = normEmail(localStorage.getItem(EMAIL_KEY));
    if (!e) return msg("Email diperlukan untuk menyelesaikan verifikasi.");
    try {
      msg("Memverifikasi email...");
      const result = await firebaseAuth.signInWithEmailLink(e, window.location.href), b = bundle();
      if (b) { msg("Email terverifikasi. Memindahkan data lama..."); await migrate(b, result.user); localStorage.removeItem(MIGRATION_KEY); msg("Data lama sudah dipindahkan. Masukkan kata sandi yang tadi Anda pilih."); }
      else msg("Email terverifikasi. Masukkan kata sandi yang ingin Anda gunakan.");
      localStorage.setItem(PASSWORD_SETUP_KEY, "1");
      localStorage.removeItem(EMAIL_KEY); window.history.replaceState({}, document.title, window.location.pathname); localStorage.removeItem(SESSION_KEY); currentUser = null; updateUserUI(null);
    } catch (error) { errorText(error); }
  }

  async function login(n, e, p) {
    // Firebase can take a moment to restore LOCAL persistence after refresh.
    // Always wait for that first so an existing permanent account is not
    // mistaken for a fresh anonymous session.
    const restoredUser = await authReady;
    let user = firebaseAuth.currentUser || restoredUser;

    if (user && !user.isAnonymous && normEmail(user.email) === e) {
      if (localStorage.getItem(PASSWORD_SETUP_KEY) === "1") {
        try {
          await user.updatePassword(p);
          localStorage.removeItem(PASSWORD_SETUP_KEY);
          await activate(user, n, e);
          return;
        } catch (error) {
          if (error?.code !== "auth/requires-recent-login") throw error;
          await sendLink(e);
          msg("Link verifikasi sudah dikirim. Buka link tersebut di perangkat ini, lalu masukkan kata sandi yang sama lagi.");
          return;
        }
      }

      const signedIn = await firebaseAuth.signInWithEmailAndPassword(e, p);
      await activate(signedIn.user, n, e);
      return;
    }

    if (user && !user.isAnonymous) await firebaseAuth.signOut();
    user = firebaseAuth.currentUser || (await firebaseAuth.signInAnonymously()).user;
    try {
      const linked = await user.linkWithCredential(firebase.auth.EmailAuthProvider.credential(e, p));
      await activate(linked.user, n, e); return;
    } catch (error) {
      // Firebase may return either code when the email already belongs to another account.
      if (error?.code !== "auth/credential-already-in-use" && error?.code !== "auth/email-already-in-use") throw error;
    }
    msg("Menyiapkan pemindahan data lama..."); await capture(user, n, e); await sendLink(e); msg("Link verifikasi sudah dikirim ke email Anda. Buka link tersebut di perangkat ini. Jangan hapus data browser dulu.");
  }

  // Run immediately; this file may be loaded after DOMContentLoaded.
  finishLink();
  document.addEventListener("submit", async (event) => {
    if (event.target?.id !== "login-form") return;
    event.preventDefault(); event.stopImmediatePropagation();
    const form = event.target, n = normName(form.querySelector("#name")?.value), e = normEmail(form.querySelector("#email")?.value), p = String(form.querySelector("#password")?.value || ""), button = form.querySelector("button[type='submit']");
    if (!n) return msg("Masukkan nama Anda.");
    if (!e || !form.querySelector("#email")?.checkValidity()) return msg("Masukkan alamat email yang valid.");
    if (p.length < 6) return msg("Kata sandi minimal 6 karakter.");
    if (button) { button.disabled = true; button.textContent = "Memproses..."; }
    try { await login(n, e, p); } catch (error) { errorText(error); } finally { if (button) { button.disabled = false; button.textContent = "Masuk ke MPD"; } }
  }, true);
})();