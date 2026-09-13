/* =========================================================
   MPD — DIRECT LOGIN
   Name + email only. No magic link.
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

    window.localStorage.setItem(
      SESSION_KEY,
      JSON.stringify(session)
    );
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

  async function getOrCreateAnonymousUser() {
    let user = firebaseAuth.currentUser;

    if (user && !user.isAnonymous) {
      await firebaseAuth.signOut();
      user = null;
    }

    if (!user) {
      const credential = await firebaseAuth.signInAnonymously();
      user = credential.user;
    }

    return user;
  }

  async function loadProfile(authUser) {
    const userRef = firebaseDb.collection("users").doc(authUser.uid);
    const snapshot = await userRef.get();
    return { userRef, snapshot };
  }

  async function activateSession(authUser, name, email) {
    const normalizedName = normalizeName(name);
    const normalizedEmail = normalizeEmail(email);
    const identityKey = makeIdentityKey(normalizedName, normalizedEmail);
    const { userRef, snapshot } = await loadProfile(authUser);

    const existingData = snapshot.exists ? snapshot.data() : null;

    if (existingData && existingData.status === "banned") {
      clearSession();
      setMessage("Akses akun ini telah dinonaktifkan.");
      return null;
    }

    /*
       The app identity is name + email. The Firebase anonymous UID is kept
       only as the technical owner of the Firestore records. We never expose
       this UID to the user and we do not sign it out when the user logs out.
    */
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

  /*
     Keep Firebase Authentication as an invisible technical session so the
     existing Firestore security rules continue to protect tracker data.
     The user-facing login is still only name + email.
  */
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
          identity_key: data.identity_key || makeIdentityKey(data.name || session.name, data.email || session.email)
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

  /*
     Override logout before script.js registers its original handler.
     Logout is app-level only: Firebase anonymous auth stays alive so the
     same name + email can reconnect to the same Firestore data.
  */
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

      const name = normalizeName(nameInput.value);
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
        const user = await getOrCreateAnonymousUser();
        await activateSession(user, name, email);
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

  /* =========================================================
     CUSTOM PDF.JS VIEWER
     Replaces the native iframe viewer while keeping the
     existing PDF library and viewer UI intact.
     ========================================================= */

  let pdfJsPromise = null;
  let activeDocument = null;
  let activeRenderTasks = [];

  function configurePdfJsWorker(pdfjsLib) {
    if (!pdfjsLib || !pdfjsLib.GlobalWorkerOptions) {
      throw new Error("PDF.js tidak menyediakan GlobalWorkerOptions.");
    }

    const version = String(pdfjsLib.version || "4.4.168");
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
        const existingScript = document.querySelector(
          "script[data-mpd-pdfjs]"
        );

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
        script.src =
          "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
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

  function setupPdfCanvas() {
    const parts = getViewerParts();
    if (!parts) return;

    const { content } = parts;

    /* Remove only the old native PDF iframe/canvas. */
    content.querySelectorAll("iframe, #pdf-canvas, .mpd-pdf-pages").forEach((element) => {
      element.remove();
    });

    content.style.overflow = "auto";
    content.style.textAlign = "center";
    content.style.background = "#f5f8f7";
    content.style.padding = "12px";
    content.style.boxSizing = "border-box";
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

    content.appendChild(pagesContainer);

    const availableWidth = Math.max(280, content.clientWidth - 24);
    const deviceScale = window.devicePixelRatio || 1;
    const totalPages = activeDocument.numPages;
    const pageItems = [];

    /* Create all page shells first so the first page can appear immediately. */
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

    /* Render page 1 first. This is the only page the viewer waits for. */
    await renderPage(pageItems[0]);

    /* Render the remaining pages in small concurrent batches in the background. */
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

    /*
       The PDF files live in this repository under /assets/pdfs/.
       Firestore still contains the old aman-diabetes.vercel.app host,
       so use the current app origin for those files. This keeps the
       PDF.js request same-origin and avoids the Vercel CORS redirect.
    */
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
      setMessage("Materi PDF gagal dimuat. Coba lagi.");
    } finally {
      content.removeAttribute("aria-busy");
    }
  }

  function overridePdfViewer() {
    window.openPdfViewer = customOpenPdfViewer;
    setupPdfCanvas();
  }

  function setup() {
    setupLoginForm();
    overridePdfViewer();

    const onboarding = document.querySelector("#name-onboarding");
    if (onboarding) onboarding.remove();
  }

  document.addEventListener("DOMContentLoaded", setup);
})();