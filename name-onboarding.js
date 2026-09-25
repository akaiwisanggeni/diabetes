/* =========================================================
   MPD — DIRECT LOGIN
   Name + email + password.
   ========================================================= */

(function () {
  "use strict";

  const SESSION_KEY = "mpdAppSession";
  const SESSION_DAYS = 30;
  const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;

  /* Disable the old magic-link completion path. */
  if (typeof completeMagicLinkLogin === "function") {
    completeMagicLinkLogin = async function () {};
  }

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
      const raw = window.localStorage.getItem(SESSION_KEY);
      if (!raw) return null;

      const session = JSON.parse(raw);
      if (!session || !session.lastActive) return null;

      const lastActive = Number(session.lastActive);
      if (!Number.isFinite(lastActive)) return null;

      if (Date.now() - lastActive >= SESSION_MS) {
        window.localStorage.removeItem(SESSION_KEY);
        return null;
      }

      return session;
    } catch (error) {
      console.error("MPD session read error:", error);
      window.localStorage.removeItem(SESSION_KEY);
      return null;
    }
  }

  function writeSession(user, profile) {
    const session = {
      uid: user.uid,
      name: profile.name,
      email: profile.email,
      identity_key: profile.identity_key,
      lastActive: Date.now()
    };

    window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }

  function clearSession() {
    window.localStorage.removeItem(SESSION_KEY);
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

  async function getOrCreateAuthUser(email, password, mode) {
    if (mode === "login") {
      const signedIn = await firebaseAuth.signInWithEmailAndPassword(email, password);
      return signedIn.user;
    }

    let user = firebaseAuth.currentUser;

    if (user && !user.isAnonymous) {
      if (normalizeEmail(user.email) === email) {
        throw { code: "auth/credential-already-in-use" };
      }

      await firebaseAuth.signOut();
      user = null;
    }

    if (!user) {
      const credential = await firebaseAuth.signInAnonymously();
      user = credential.user;
    }

    const emailCredential = firebase.auth.EmailAuthProvider.credential(
      email,
      password
    );

    try {
      const linked = await user.linkWithCredential(emailCredential);
      return linked.user;
    } catch (error) {
      if (error && error.code === "auth/credential-already-in-use") {
        throw error;
      }

      throw error;
    }
  }

  async function loadProfile(authUser) {
    const userRef = firebaseDb.collection("users").doc(authUser.uid);
    const snapshot = await userRef.get();
    return { userRef, snapshot };
  }

  async function activateSession(authUser, name, email) {
    const { userRef, snapshot } = await loadProfile(authUser);
    const existingData = snapshot.exists ? snapshot.data() : null;
    const normalizedName = normalizeName(name || existingData?.name || authUser.displayName || "");
    const normalizedEmail = normalizeEmail(email || existingData?.email || authUser.email);
    const identityKey = makeIdentityKey(normalizedName, normalizedEmail);

    if (existingData && existingData.status === "banned") {
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

    if (!snapshot.exists) {
      profileData.first_login = firebase.firestore.FieldValue.serverTimestamp();
    }

    await userRef.set(profileData, { merge: true });

    try {
      await authUser.updateProfile({ displayName: normalizedName });
    } catch (error) {
      console.warn("Firebase display name update skipped:", error);
    }

    const profile = {
      name: normalizedName,
      email: normalizedEmail,
      identity_key: identityKey
    };

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

  /* Keep Firebase Authentication as the technical cross-device identity. */
  initializeAuth = function () {
    firebaseAuth.onAuthStateChanged(async (authUser) => {
      if (!authUser) {
        currentUser = null;
        updateUserUI(null);
        return;
      }

      const session = readSession();

      if (!session || session.uid !== authUser.uid) {
        currentUser = null;
        updateUserUI(null);
        return;
      }

      try {
        const { snapshot } = await loadProfile(authUser);

        if (!snapshot.exists || snapshot.data().status === "banned") {
          clearSession();
          currentUser = null;
          updateUserUI(null);
          if (snapshot.exists && snapshot.data().status === "banned") {
            setMessage("Akses akun ini telah dinonaktifkan.");
          }
          return;
        }

        const data = snapshot.data();
        const profile = {
          name: data.name || session.name,
          email: data.email || session.email,
          identity_key: data.identity_key || makeIdentityKey(
            data.name || session.name,
            data.email || session.email
          )
        };

        /* Sliding 30-day session: every app open resets the 30-day window. */
        writeSession(authUser, profile);
        currentUser = buildAppUser(authUser, profile);
        updateUserUI(currentUser);

        await loadPdfLibrary();
        await loadCarbFoods();
        await loadBloodSugarRecords();
        await loadWeightRecords();
      } catch (error) {
        console.error("MPD session restore error:", error);
        clearSession();
        currentUser = null;
        updateUserUI(null);
      }
    });
  };

  /* App-level logout only. Keep Firebase auth available for the next login. */
  setupLogout = function () {
    const logoutButtons = document.querySelectorAll(
      "#logout-btn, #logout, .logout-btn, [data-logout]"
    );

    logoutButtons.forEach((button) => {
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

  function setupLoginForm() {
    const form = document.querySelector("#login-form");
    if (!form) return;

    let mode = "signup";

    const loginCard = form.closest(".login-card");
    const subtitle = loginCard ? loginCard.querySelector("h1 + p") : null;

    /* Remove the legacy Instagram/DM password-recovery text if an older cached
       login template is still present. Firebase now handles password reset by email. */
    if (loginCard) {
      loginCard.querySelectorAll("p").forEach((paragraph) => {
        const text = (paragraph.textContent || "").toLowerCase();
        if (
          text.includes("dm @panduandiabetes") ||
          text.includes("lupa password") ||
          text.includes("lupa kata sandi? dm")
        ) {
          paragraph.remove();
        }
      });
    }

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

    let passwordInput = form.querySelector("#password");
    if (!passwordInput) {
      const passwordLabel = document.createElement("label");
      passwordLabel.htmlFor = "password";
      passwordLabel.textContent = "Kata sandi";

      passwordInput = document.createElement("input");
      passwordInput.id = "password";
      passwordInput.type = "password";
      passwordInput.minLength = 6;
      passwordInput.autocomplete = "new-password";
      passwordInput.placeholder = "Minimal 6 karakter";
      passwordInput.required = true;
      passwordInput.style.marginBottom = "12px";

      form.insertBefore(passwordLabel, emailInput.nextSibling);
      form.insertBefore(passwordInput, passwordLabel.nextSibling);
    }

    let passwordHelper = form.querySelector("#password-helper");
    if (!passwordHelper) {
      passwordHelper = document.createElement("div");
      passwordHelper.id = "password-helper";
      passwordHelper.textContent = "Kata sandi ini digunakan untuk mengakses data Anda di perangkat lain.";
      passwordHelper.style.margin = "-7px 0 15px";
      passwordHelper.style.color = "#7A9E9B";
      passwordHelper.style.fontSize = "11.5px";
      passwordHelper.style.lineHeight = "1.4";
      form.insertBefore(passwordHelper, passwordInput.nextSibling);
    }

    const submitButton = form.querySelector("button[type='submit']");
    if (!submitButton) return;

    let modeSwitch = form.querySelector("#auth-mode-switch");
    if (!modeSwitch) {
      modeSwitch = document.createElement("div");
      modeSwitch.id = "auth-mode-switch";
      modeSwitch.style.margin = "14px 0 0";
      modeSwitch.style.textAlign = "center";
      modeSwitch.style.color = "#7A9E9B";
      modeSwitch.style.fontSize = "12px";

      const modeSwitchButton = document.createElement("button");
      modeSwitchButton.type = "button";
      modeSwitchButton.id = "auth-mode-switch-button";
      modeSwitchButton.style.width = "auto";
      modeSwitchButton.style.padding = "0";
      modeSwitchButton.style.margin = "0";
      modeSwitchButton.style.background = "transparent";
      modeSwitchButton.style.color = "#2B7A78";
      modeSwitchButton.style.fontSize = "12px";
      modeSwitchButton.style.fontWeight = "600";

      modeSwitch.appendChild(document.createTextNode("Sudah punya akun? "));
      modeSwitch.appendChild(modeSwitchButton);
      form.appendChild(modeSwitch);
    }

    const modeSwitchButton = modeSwitch.querySelector("#auth-mode-switch-button");

    let resetLink = form.querySelector("#forgot-password");
    if (!resetLink) {
      resetLink = document.createElement("button");
      resetLink.type = "button";
      resetLink.id = "forgot-password";
      resetLink.textContent = "Lupa kata sandi? Reset melalui email";
      resetLink.style.display = "none";
      resetLink.style.width = "auto";
      resetLink.style.margin = "12px auto 0";
      resetLink.style.padding = "0";
      resetLink.style.background = "transparent";
      resetLink.style.color = "#2B7A78";
      resetLink.style.fontSize = "12px";
      resetLink.style.fontWeight = "500";
      form.appendChild(resetLink);
    }

    function setMode(nextMode) {
      mode = nextMode === "login" ? "login" : "signup";
      const isLogin = mode === "login";

      if (nameInput) {
        nameInput.style.display = isLogin ? "none" : "";
        nameInput.required = !isLogin;
        const nameLabel = form.querySelector("label[for='name']");
        if (nameLabel) nameLabel.style.display = isLogin ? "none" : "";
      }

      if (subtitle) {
        subtitle.textContent = isLogin
          ? "Masuk untuk mengakses materi dan tracker kesehatanmu."
          : "Buat akun untuk mengakses materi dan tracker kesehatanmu.";
      }

      submitButton.textContent = isLogin ? "Masuk" : "Buat Akun";
      modeSwitchButton.textContent = isLogin ? "Buat akun" : "Masuk";
      modeSwitch.firstChild.textContent = isLogin ? "Belum punya akun? " : "Sudah punya akun? ";
      resetLink.style.display = isLogin ? "block" : "none";
      passwordInput.autocomplete = isLogin ? "current-password" : "new-password";
      passwordInput.placeholder = isLogin ? "Masukkan kata sandi" : "Minimal 6 karakter";
      setMessage("");
    }

    modeSwitchButton.addEventListener("click", () => {
      setMode(mode === "signup" ? "login" : "signup");
      passwordInput.value = "";
      if (mode === "signup") nameInput.focus();
      else emailInput.focus();
    });

    resetLink.addEventListener("click", async () => {
      const email = normalizeEmail(emailInput.value);

      if (!email || !emailInput.checkValidity()) {
        setMessage("Masukkan email yang valid terlebih dahulu.");
        emailInput.focus();
        return;
      }

      resetLink.disabled = true;
      try {
        await firebaseAuth.sendPasswordResetEmail(email);
        setMessage("Link reset kata sandi sudah dikirim ke email Anda. Cek inbox atau folder spam.");
      } catch (error) {
        console.error("Password reset error:", error);
        if (error?.code === "auth/user-not-found") {
          setMessage("Email tersebut belum terdaftar.");
        } else if (error?.code === "auth/invalid-email") {
          setMessage("Masukkan alamat email yang valid.");
        } else {
          setMessage("Gagal mengirim link reset. Coba lagi.");
        }
      } finally {
        resetLink.disabled = false;
      }
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();

      const name = normalizeName(nameInput.value);
      const email = normalizeEmail(emailInput.value);
      const password = String(passwordInput.value || "");

      if (mode === "signup" && !name) {
        setMessage("Masukkan nama Anda.");
        nameInput.focus();
        return;
      }

      if (!email) {
        setMessage("Masukkan email Anda.");
        emailInput.focus();
        return;
      }

      if (mode === "signup" && name.length > 60) {
        setMessage("Nama maksimal 60 karakter.");
        nameInput.focus();
        return;
      }

      if (!emailInput.checkValidity()) {
        setMessage("Masukkan alamat email yang valid.");
        emailInput.focus();
        return;
      }

      if (password.length < 6) {
        setMessage("Kata sandi minimal 6 karakter.");
        passwordInput.focus();
        return;
      }

      submitButton.disabled = true;
      submitButton.textContent = mode === "login" ? "Masuk..." : "Membuat akun...";

      try {
        const user = await getOrCreateAuthUser(email, password, mode);
        await activateSession(user, mode === "signup" ? name : "", email);
      } catch (error) {
        console.error("Authentication error:", error);

        if (mode === "signup") {
          if (error?.code === "auth/credential-already-in-use" || error?.code === "auth/email-already-in-use") {
            setMessage("Email ini sudah terdaftar. Pilih Masuk untuk menggunakan akun tersebut.");
          } else if (error?.code === "auth/weak-password") {
            setMessage("Kata sandi terlalu lemah. Gunakan minimal 6 karakter.");
          } else if (error?.code === "auth/operation-not-allowed") {
            setMessage("Aktifkan Email/Password dan Anonymous Authentication di Firebase.");
          } else {
            setMessage("Gagal membuat akun. Coba lagi.");
          }
        } else {
          if (["auth/wrong-password", "auth/invalid-credential", "auth/user-not-found"].includes(error?.code)) {
            setMessage("Email atau kata sandi salah.");
          } else if (error?.code === "auth/user-disabled") {
            setMessage("Akun ini telah dinonaktifkan.");
          } else if (error?.code === "auth/operation-not-allowed") {
            setMessage("Login email/password belum aktif di Firebase.");
          } else {
            setMessage("Gagal masuk. Coba lagi.");
          }
        }
      } finally {
        submitButton.disabled = false;
        submitButton.textContent = mode === "login" ? "Masuk" : "Buat Akun";
      }
    }, true);

    setMode("signup");
  }
  /* =========================================================
     CUSTOM PDF.JS VIEWER
     Keeps the existing PDF viewer UI and fixes loading,
     memory usage, pinch zoom, and viewer cleanup.
     ========================================================= */

  let pdfJsPromise = null;
  let activeDocument = null;
  let activeRenderTasks = [];
  let pdfViewerZoomCleanup = null;

  function configurePdfJsWorker(pdfjsLib) {
    if (!pdfjsLib || !pdfjsLib.GlobalWorkerOptions) {
      throw new Error("PDF.js tidak menyediakan GlobalWorkerOptions.");
    }

    const version = String(pdfjsLib.version || "3.11.174");
    const isLegacyJs = version.startsWith("3.");
    const workerExtension = isLegacyJs ? "js" : "mjs";

    pdfjsLib.GlobalWorkerOptions.workerSrc =
      `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${version}/pdf.worker.min.${workerExtension}`;

    return pdfjsLib;
  }

  function loadPdfJs() {
    if (window.pdfjsLib) {
      return Promise.resolve(configurePdfJsWorker(window.pdfjsLib));
    }

    if (!pdfJsPromise) {
      pdfJsPromise = new Promise((resolve, reject) => {
        const existingScript = document.querySelector("script[data-mpd-pdfjs]");

        if (existingScript) {
          existingScript.addEventListener("load", () => {
            try {
              resolve(configurePdfJsWorker(window.pdfjsLib));
            } catch (error) {
              reject(error);
            }
          });
          existingScript.addEventListener("error", reject);
          return;
        }

        const script = document.createElement("script");
        script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
        script.async = true;
        script.dataset.mpdPdfjs = "true";

        script.onload = () => {
          try {
            resolve(configurePdfJsWorker(window.pdfjsLib));
          } catch (error) {
            reject(error);
          }
        };

        script.onerror = () => reject(new Error("PDF.js gagal dimuat."));
        document.head.appendChild(script);
      });
    }

    return pdfJsPromise;
  }

  function getViewerParts() {
    const viewer = document.querySelector("#pdf-viewer");
    if (!viewer) return null;

    let content = viewer.querySelector(".pdf-viewer-content");
    if (!content) {
      content = document.createElement("div");
      content.className = "pdf-viewer-content";
      viewer.appendChild(content);
    }

    const title = viewer.querySelector("#pdf-viewer-title");
    return { viewer, content, title };
  }

  function resetPdfViewerZoom(content) {
    if (!content) return;
    const pages = content.querySelector(".mpd-pdf-pages");
    if (pages) {
      pages.style.transform = "none";
      pages.style.transformOrigin = "center top";
    }
    content.style.touchAction = "pan-y";
  }

  function setupPdfPinchZoom(content) {
    if (!content) return;

    if (pdfViewerZoomCleanup) {
      pdfViewerZoomCleanup();
      pdfViewerZoomCleanup = null;
    }

    resetPdfViewerZoom(content);

    let zoom = 1;
    let panX = 0;
    let panY = 0;
    let startDistance = 0;
    let startZoom = 1;
    let lastTouchX = 0;
    let lastTouchY = 0;
    let isPanning = false;

    const getPages = () => content.querySelector(".mpd-pdf-pages");

    const getDistance = (touches) => {
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      return Math.hypot(dx, dy);
    };

    const clampPan = () => {
      const pages = getPages();
      if (!pages || zoom <= 1) {
        panX = 0;
        panY = 0;
        return;
      }

      const baseWidth = pages.offsetWidth;
      const baseHeight = pages.offsetHeight;
      const maxX = Math.max(0, (baseWidth * zoom - content.clientWidth) / 2 + 24);
      const maxY = Math.max(0, (baseHeight * zoom - content.clientHeight) / 2 + 24);

      panX = Math.min(maxX, Math.max(-maxX, panX));
      panY = Math.min(maxY, Math.max(-maxY, panY));
    };

    const applyTransform = () => {
      const pages = getPages();
      if (!pages) return;

      clampPan();
      pages.style.transformOrigin = "center top";
      pages.style.transform = `translate3d(${panX}px, ${panY}px, 0) scale(${zoom})`;
      pages.style.willChange = zoom > 1 ? "transform" : "auto";
    };

    const resetZoom = () => {
      zoom = 1;
      panX = 0;
      panY = 0;
      startDistance = 0;
      startZoom = 1;
      isPanning = false;
      applyTransform();
    };

    const onTouchStart = (event) => {
      if (event.touches.length === 2) {
        startDistance = getDistance(event.touches);
        startZoom = zoom;
        isPanning = false;
        return;
      }

      if (event.touches.length === 1 && zoom > 1) {
        lastTouchX = event.touches[0].clientX;
        lastTouchY = event.touches[0].clientY;
        isPanning = true;
      }
    };

    const onTouchMove = (event) => {
      if (event.touches.length === 2 && startDistance) {
        const distance = getDistance(event.touches);
        const scale = distance / startDistance;
        zoom = Math.min(3, Math.max(1, startZoom * scale));
        if (zoom === 1) {
          panX = 0;
          panY = 0;
        }
        applyTransform();
        event.preventDefault();
        return;
      }

      if (event.touches.length === 1 && isPanning && zoom > 1) {
        const touch = event.touches[0];
        panX += touch.clientX - lastTouchX;
        panY += touch.clientY - lastTouchY;
        lastTouchX = touch.clientX;
        lastTouchY = touch.clientY;
        applyTransform();
        event.preventDefault();
      }
    };

    const onTouchEnd = (event) => {
      if (event.touches.length >= 2) return;

      if (event.touches.length === 1 && zoom > 1) {
        lastTouchX = event.touches[0].clientX;
        lastTouchY = event.touches[0].clientY;
        isPanning = true;
      } else {
        startDistance = 0;
        isPanning = false;
      }
    };

    content.addEventListener("touchstart", onTouchStart, { passive: true });
    content.addEventListener("touchmove", onTouchMove, { passive: false });
    content.addEventListener("touchend", onTouchEnd, { passive: true });
    content.addEventListener("touchcancel", onTouchEnd, { passive: true });

    pdfViewerZoomCleanup = () => {
      content.removeEventListener("touchstart", onTouchStart);
      content.removeEventListener("touchmove", onTouchMove);
      content.removeEventListener("touchend", onTouchEnd);
      content.removeEventListener("touchcancel", onTouchEnd);
      resetZoom();
      resetPdfViewerZoom(content);
    };
  }

  function setupPdfCanvas() {
    const parts = getViewerParts();
    if (!parts) return;

    const { content } = parts;

    content.querySelectorAll("iframe, #pdf-canvas, .mpd-pdf-pages").forEach((element) => {
      element.remove();
    });

    content.style.overflow = "auto";
    content.style.textAlign = "center";
    content.style.background = "#f5f8f7";
    content.style.padding = "12px";
    content.style.boxSizing = "border-box";
    content.style.touchAction = "pan-y";
  }

  function clearPdfPages(content) {
    activeRenderTasks.forEach((task) => {
      try {
        task.cancel();
      } catch (_) {}
    });
    activeRenderTasks = [];

    const pages = content.querySelector(".mpd-pdf-pages");
    if (pages) pages.remove();
  }

  async function closePdfDocument() {
    const parts = getViewerParts();
    if (!parts) return;

    const { viewer, content } = parts;

    clearPdfPages(content);

    if (pdfViewerZoomCleanup) {
      pdfViewerZoomCleanup();
      pdfViewerZoomCleanup = null;
    } else {
      resetPdfViewerZoom(content);
    }

    if (activeDocument) {
      try {
        await activeDocument.destroy();
      } catch (error) {
        console.error("PDF.js document cleanup error:", error);
      }
      activeDocument = null;
    }

    viewer.style.display = "none";
    document.body.classList.remove("pdf-viewer-open");
  }

  async function renderPdfDocument() {
    const parts = getViewerParts();
    if (!parts || !activeDocument) return;

    const { content } = parts;
    clearPdfPages(content);

    const pagesContainer = document.createElement("div");
    pagesContainer.className = "mpd-pdf-pages";
    pagesContainer.style.width = "100%";
    pagesContainer.style.display = "flex";
    pagesContainer.style.flexDirection = "column";
    pagesContainer.style.alignItems = "center";
    pagesContainer.style.gap = "12px";
    pagesContainer.style.transformOrigin = "center top";

    content.appendChild(pagesContainer);

    const availableWidth = Math.max(280, content.clientWidth - 24);
    const deviceScale = Math.min(window.devicePixelRatio || 1, 2);
    const totalPages = activeDocument.numPages;
    const pageItems = [];

    for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
      const pageWrapper = document.createElement("div");
      pageWrapper.className = "mpd-pdf-page";
      pageWrapper.style.width = "100%";
      pageWrapper.style.maxWidth = "100%";
      pageWrapper.style.background = "#fff";
      pageWrapper.style.boxShadow = "0 1px 5px rgba(0,0,0,0.08)";
      pageWrapper.style.lineHeight = "0";

      const canvas = document.createElement("canvas");
      canvas.className = "mpd-pdf-canvas";
      canvas.setAttribute(
        "aria-label",
        `PDF Viewer, halaman ${pageNumber} dari ${totalPages}`
      );
      canvas.style.display = "block";
      canvas.style.width = "100%";
      canvas.style.height = "auto";
      canvas.style.maxWidth = "100%";

      pageWrapper.appendChild(canvas);
      pagesContainer.appendChild(pageWrapper);
      pageItems.push({ pageNumber, pageWrapper, canvas });
    }

    async function renderPage(item) {
      const page = await activeDocument.getPage(item.pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = availableWidth / baseViewport.width;
      const viewport = page.getViewport({ scale });

      item.pageWrapper.style.width = `${Math.ceil(viewport.width)}px`;
      item.canvas.width = Math.ceil(viewport.width * deviceScale);
      item.canvas.height = Math.ceil(viewport.height * deviceScale);
      item.canvas.style.width = `${Math.ceil(viewport.width)}px`;
      item.canvas.style.height = `${Math.ceil(viewport.height)}px`;

      const context = item.canvas.getContext("2d", { alpha: false });
      context.setTransform(deviceScale, 0, 0, deviceScale, 0, 0);

      const renderTask = page.render({
        canvasContext: context,
        viewport
      });

      activeRenderTasks.push(renderTask);

      try {
        await renderTask.promise;
      } finally {
        activeRenderTasks = activeRenderTasks.filter((task) => task !== renderTask);
      }
    }

    if (pageItems.length === 0) return;

    await renderPage(pageItems[0]);

    const remainingItems = pageItems.slice(1);
    const concurrency = 3;

    (async () => {
      for (let index = 0; index < remainingItems.length; index += concurrency) {
        const batch = remainingItems.slice(index, index + concurrency);
        await Promise.all(
          batch.map(async (item) => {
            try {
              await renderPage(item);
            } catch (error) {
              if (error?.name !== "RenderingCancelledException") {
                console.error(`PDF page ${item.pageNumber} render error:`, error);
              }
            }
          })
        );
      }
    })();
  }

  function resolvePdfUrl(pdfUrl) {
    const parsedUrl = new URL(pdfUrl, window.location.href);

    if (parsedUrl.pathname.startsWith("/assets/pdfs/")) {
      return `${window.location.origin}${parsedUrl.pathname}${parsedUrl.search}`;
    }

    return parsedUrl.href;
  }

  async function customOpenPdfViewer(pdf) {
    const parts = getViewerParts();
    if (!parts) return;

    const { viewer, content, title } = parts;

    if (title) title.textContent = formatPdfTitle(pdf.title);

    viewer.style.display = "";
    document.body.classList.add("pdf-viewer-open");
    content.setAttribute("aria-busy", "true");
    setupPdfPinchZoom(content);

    try {
      const pdfjsLib = await loadPdfJs();
      const pdfUrl = resolvePdfUrl(pdf.pdf_url);
      activeDocument = await pdfjsLib.getDocument({ url: pdfUrl }).promise;
      await renderPdfDocument();
      content.setAttribute(
        "aria-label",
        `PDF Viewer, ${activeDocument.numPages} halaman`
      );
    } catch (error) {
      console.error("PDF.js viewer error:", error);
      clearPdfPages(content);
      if (activeDocument) {
        try {
          await activeDocument.destroy();
        } catch (_) {}
        activeDocument = null;
      }
      setMessage("Materi PDF gagal dimuat. Coba lagi.");
    } finally {
      content.removeAttribute("aria-busy");
    }
  }

  function overridePdfViewer() {
    window.openPdfViewer = customOpenPdfViewer;
    window.closePdfViewer = closePdfDocument;
    setupPdfCanvas();

    /* Capture-phase handler reliably replaces script.js's old Back handler. */
    const backButton = document.querySelector("#pdf-back");
    if (backButton) {
      backButton.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        await closePdfDocument();
      }, true);
    }
  }

  function setup() {
    setupLoginForm();
    overridePdfViewer();

    /* Preload the same PDF.js build used by the viewer. */
    loadPdfJs().catch((error) => {
      console.error("PDF.js preload error:", error);
    });

    const onboarding = document.querySelector("#name-onboarding");
    if (onboarding) onboarding.remove();
  }

  document.addEventListener("DOMContentLoaded", setup);
})();
