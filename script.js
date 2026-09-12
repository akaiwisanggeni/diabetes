/* =========================================================
   MPD — MEAL PLAN DIABETES
   Main Application Script
   ========================================================= */

/* =========================================================
   1. FIREBASE CONFIG
   ========================================================= */

const firebaseConfig = {
  apiKey: "AIzaSyBKkfC_sbyDWnf_bl3xKdgarJEsR0-BtSo",
  authDomain: "aman-diabetes.firebaseapp.com",
  projectId: "aman-diabetes",
  storageBucket: "aman-diabetes.firebasestorage.app",
  messagingSenderId: "739137930683",
  appId: "1:739137930683:web:8b83beb766e60d3c48309e"
};

firebase.initializeApp(firebaseConfig);

const firebaseAuth = firebase.auth();
const firebaseDb = firebase.firestore();

/* =========================================================
   2. APP STATE
   ========================================================= */

let currentUser = null;
let pdfLibrary = [];
let bloodSugarRecords = [];
let weightRecords = [];
let selectedWeightProgressDays = 7;
let visibleWeightProgressCount = 10;
let selectedBloodSugarChartDays = 7;
let visibleBloodSugarProgressCount = 10;
let pdfJsLoadedPromise = null;
let activePdfDocument = null;
let activePdfPageNumber = 1;
let activePdfRenderTask = null;
let activePdfUrl = "";


/* =========================================================
   2A. LOGIN MESSAGE
   ========================================================= */

function setLoginMessage(message) {
  const element =
    document.querySelector("#login-message") ||
    document.querySelector(".login-message") ||
    document.querySelector('[data-login-message]');

  if (element) {
    element.textContent = message || "";
  }
}


/* =========================================================
   3. INITIALIZE APP
   ========================================================= */

const IS_PREVIEW =
  new URLSearchParams(window.location.search).get("preview") === "true";


document.addEventListener("DOMContentLoaded", async () => {
  console.log("MPD App starting...");

  setupNavigation();
  setupLogout();
  setupMagicLinkForm();
  setupPdfViewer();

  ensureBloodSugarChartUI();
  setupBloodSugarChartPeriods();
  setupBloodSugarTracker();
  setupWeightTracker();
  ensureWeightProgressUI();
  setupWeightProgressPeriods();
  setupWeightCSVButton();
  setupTrackerEditUI();
  setupCarbCalculator();

  /* =======================================================
     PREVIEW MODE
     ======================================================= */

  if (IS_PREVIEW) {
    console.log("MPD Preview Mode.");

    currentUser = {
      uid: "preview-user",
      email: "preview@aman-diabetes.local",
      displayName: "Akai"
    };

    updateUserUI(currentUser);
    showPage("home");

    const pdfContainer =
      document.querySelector("#pdf-library") ||
      document.querySelector("#pdf-grid") ||
      document.querySelector(".pdf-library") ||
      document.querySelector(".pdf-grid") ||
      document.querySelector('[data-pdf-library]');

    if (pdfContainer) {
      renderPdfMessage(
        pdfContainer,
        "Preview Mode — materi PDF akan tampil saat Firebase aktif."
      );
    }

    console.log("MPD Preview ready.");
    return;
  }

  /* =======================================================
     NORMAL PRODUCTION MODE
     =======================================================

  initializeAuth();

  completeMagicLinkLogin();

  console.log("MPD App ready.");
});


/* =========================================================
   4. FIREBASE AUTHENTICATION
   ========================================================= */

function initializeAuth() {

  firebaseAuth.onAuthStateChanged(
    async (user) => {

      currentUser = user;

      updateUserUI(currentUser);

      if (currentUser) {
        await loadPdfLibrary();
        await loadCarbFoods();
        await loadBloodSugarRecords();
        await loadWeightRecords();
      }

    }
  );

}


/* =========================================================
   5. MAGIC LINK LOGIN
   ========================================================= */

function setupMagicLinkForm() {

  const form =
    document.querySelector("#login-form") ||
    document.querySelector("#magic-link-form") ||
    document.querySelector('[data-login-form]');

  if (!form) return;

  form.addEventListener(
    "submit",
    async (event) => {

      event.preventDefault();

      const emailInput =
        form.querySelector("#email") ||
        form.querySelector('input[type="email"]');

      if (!emailInput) {
        setLoginMessage("Kolom email tidak ditemukan.");
        return;
      }

      const email =
        emailInput.value.trim();

      if (!email) {
        setLoginMessage("Masukkan email kamu.");
        return;
      }

      setLoginMessage(
        "Mengirim link login..."
      );

      try {

        const actionCodeSettings = {
          url:
            window.location.origin +
            window.location.pathname,

          handleCodeInApp: true
        };

        await firebaseAuth.sendSignInLinkToEmail(
          email,
          actionCodeSettings
        );

        window.localStorage.setItem(
          "mpdEmailForSignIn",
          email
        );

        setLoginMessage(
          "Link login sudah dikirim ke email kamu. Cek inbox."
        );

        emailInput.value = "";

      } catch (error) {

        console.error(
          "Firebase Magic Link error:",
          error
        );

        setLoginMessage(
          error.message ||
          "Terjadi kesalahan. Coba lagi."
        );

      }

    }
  );

}


/* =========================================================
   6. COMPLETE MAGIC LINK LOGIN
   ========================================================= */

async function completeMagicLinkLogin() {

  if (
    !firebaseAuth.isSignInWithEmailLink(
      window.location.href
    )
  ) {
    return;
  }

  let email =
    window.localStorage.getItem(
      "mpdEmailForSignIn"
    );

  if (!email) {

    email =
      window.prompt(
        "Masukkan kembali email kamu:"
      );

  }

  if (!email) {
    setLoginMessage(
      "Email diperlukan untuk menyelesaikan login."
    );
    return;
  }

  try {

    setLoginMessage(
      "Menyelesaikan login..."
    );

    await firebaseAuth.signInWithEmailLink(
      email,
      window.location.href
    );

    window.localStorage.removeItem(
      "mpdEmailForSignIn"
    );

    window.history.replaceState(
      {},
      document.title,
      window.location.pathname
    );

  } catch (error) {

    console.error(
      "Firebase Magic Link completion error:",
      error
    );

    setLoginMessage(
      error.message ||
      "Link login tidak valid atau sudah kedaluwarsa."
    );

  }

}

/* =========================================================
   7. USER UI
   ========================================================= */

function updateUserUI(user) {
  const name =
    getUserName(user);

  const userNameElements = document.querySelectorAll(
    "#user-name, #username, .user-name, [data-user-name]"
  );

  userNameElements.forEach((element) => {
    element.textContent = user ? name : "Guest";
  });

  const emailElements = document.querySelectorAll(
    "#user-email, .user-email, [data-user-email]"
  );

  emailElements.forEach((element) => {
    element.textContent = user ? user.email : "";
  });

  const loginScreen =
    document.querySelector("#login-screen") ||
    document.querySelector(".login-screen") ||
    document.querySelector('[data-login-screen]');

  const appScreen =
    document.querySelector("#app-screen") ||
    document.querySelector(".app-screen") ||
    document.querySelector('[data-app-screen]');

  if (loginScreen && appScreen) {
    if (user) {
      loginScreen.style.display = "none";
      appScreen.style.display = "";
    } else {
      loginScreen.style.display = "";
      appScreen.style.display = "none";
    }
  }

  const logoutButtons = document.querySelectorAll(
    "#logout-btn, #logout, .logout-btn, [data-logout]"
  );

  logoutButtons.forEach((button) => {
    button.style.display = user ? "" : "none";
  });
}


function getUserName(user) {
  if (!user) return "Guest";

  if (user.displayName) {
    return user.displayName;
  }

  if (user.email) {
    return user.email.split("@")[0];
  }

  return "User";
}


/* =========================================================
   8. LOGOUT
   ========================================================= */

function setupLogout() {
  const logoutButtons = document.querySelectorAll(
    "#logout-btn, #logout, .logout-btn, [data-logout]"
  );

  logoutButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await firebaseAuth.signOut();

        currentUser = null;

        updateUserUI(null);

        showPage("home");

      } catch (error) {
        console.error("Logout error:", error);
      }
    });
  });
}


/* =========================================================
   9. NAVIGATION
   ========================================================= */

function setupNavigation() {
  const navItems = document.querySelectorAll(
    "[data-page]"
  );

  navItems.forEach((item) => {
    item.addEventListener("click", (event) => {
      event.preventDefault();

      const page = item.dataset.page;

      if (!page) return;

      showPage(page);
    });
  });
}


function showPage(pageName) {
  const pages = document.querySelectorAll(
    "[data-page-content]"
  );

  if (pages.length > 0) {
    pages.forEach((page) => {
      const pageId = page.dataset.pageContent;

      page.style.display =
        pageId === pageName ? "" : "none";
    });
  } else {
    const possiblePages = [
      "home",
      "blood-sugar",
      "weight",
      "carb-calculator"
    ];

    possiblePages.forEach((name) => {
      const element =
        document.getElementById(name) ||
        document.querySelector(`.${name}`);

      if (element) {
        element.style.display =
          name === pageName ? "" : "none";
      }
    });
  }

  updateActiveNavigation(pageName);

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });

  if (pageName === "blood-sugar") {
    loadBloodSugarRecords();
  }

  if (pageName === "weight") {
    loadWeightRecords();
  }
}


function updateActiveNavigation(pageName) {
  const navItems = document.querySelectorAll(
    "[data-page]"
  );

  navItems.forEach((item) => {
    const isActive =
      item.dataset.page === pageName;

    item.classList.toggle(
      "active",
      isActive
    );
  });
}


/* =========================================================
   10. PDF LIBRARY
   ========================================================= */

async function loadPdfLibrary() {
  const container =
    document.querySelector("#pdf-library") ||
    document.querySelector("#pdf-grid") ||
    document.querySelector(".pdf-library") ||
    document.querySelector(".pdf-grid") ||
    document.querySelector('[data-pdf-library]');

  if (!container) {
    console.warn("PDF library container tidak ditemukan.");
    return;
  }

  if (!currentUser) {
    renderPdfMessage(
      container,
      "Silakan login terlebih dahulu."
    );
    return;
  }

  renderPdfMessage(
    container,
    "Memuat materi..."
  );

  try {
    const snapshot = await firebaseDb
      .collection("pdfs")
      .orderBy("sort_order", "asc")
      .get();

    pdfLibrary = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data()
    }));

    renderPdfLibrary(
      container,
      pdfLibrary
    );

  } catch (error) {
    console.error("PDF query error:", error);

    renderPdfMessage(
      container,
      "Gagal memuat materi."
    );
  }
}


function renderPdfLibrary(container, pdfs) {
  if (!pdfs.length) {
    renderPdfMessage(
      container,
      "Belum ada materi."
    );

    return;
  }

  container.innerHTML = "";

  pdfs.forEach((pdf) => {
    const card = document.createElement("button");

    card.type = "button";
    card.className = "pdf-card";

    card.innerHTML = `
      <div class="pdf-cover-wrapper">
        <img
          class="pdf-cover"
          src="${escapeHtml(pdf.cover_url)}"
          alt="${escapeHtml(pdf.title)}"
          loading="lazy"
        >
      </div>

      <div class="pdf-title">
        ${escapeHtml(
          formatPdfTitle(pdf.title)
        )}
      </div>
    `;

    card.addEventListener("click", () => {
      openPdfViewer(pdf);
    });

    container.appendChild(card);
  });
}


function formatPdfTitle(title) {
  if (!title) return "";

  return title
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}


function renderPdfMessage(container, message) {
  container.innerHTML = `
    <div class="pdf-message">
      ${escapeHtml(message)}
    </div>
  `;
}


/* =========================================================
   11. PDF VIEWER
   ========================================================= */

function setupPdfViewer() {
  const viewer =
    document.querySelector("#pdf-viewer") ||
    document.querySelector(".pdf-viewer") ||
    document.querySelector('[data-pdf-viewer]');

  if (!viewer) return;

  const closeButtons = viewer.querySelectorAll(
    "#pdf-back, #pdf-close, .pdf-back, .pdf-close, [data-pdf-close]"
  );

  closeButtons.forEach((button) => {
    button.addEventListener(
      "click",
      closePdfViewer
    );
  });
}


function loadPdfJs() {
  if (window.pdfjsLib) {
    return Promise.resolve(window.pdfjsLib);
  }

  if (!pdfJsLoadedPromise) {
    pdfJsLoadedPromise = import(
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs"
    ).then((module) => {
      const pdfjsLib = module.default || module;
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs";
      return pdfjsLib;
    });
  }

  return pdfJsLoadedPromise;
}


async function openPdfViewer(pdf) {
  const viewer =
    document.querySelector("#pdf-viewer") ||
    document.querySelector(".pdf-viewer") ||
    document.querySelector('[data-pdf-viewer]');

  if (!viewer) {
    console.warn("PDF viewer tidak ditemukan.");
    return;
  }

  const canvas =
    viewer.querySelector("canvas") ||
    viewer.querySelector("#pdf-canvas") ||
    viewer.querySelector('[data-pdf-canvas]');

  const title =
    viewer.querySelector("#pdf-viewer-title") ||
    viewer.querySelector(".pdf-viewer-title") ||
    viewer.querySelector('[data-pdf-title]');

  if (!canvas) {
    console.warn("PDF canvas tidak ditemukan.");
    return;
  }

  if (title) {
    title.textContent =
      formatPdfTitle(pdf.title);
  }

  viewer.style.display = "";

  document.body.classList.add(
    "pdf-viewer-open"
  );

  window.scrollTo({
    top: 0,
    behavior: "instant"
  });

  if (!pdf.pdf_url) {
    renderPdfViewerMessage(
      viewer,
      "File materi tidak tersedia."
    );
    return;
  }

  activePdfUrl = pdf.pdf_url;
  activePdfDocument = null;
  activePdfPageNumber = 1;

  try {
    const pdfjsLib = await loadPdfJs();

    if (activePdfUrl !== pdf.pdf_url) return;

    const loadingTask = pdfjsLib.getDocument({
      url: pdf.pdf_url,
      disableAutoFetch: false,
      disableStream: false,
      isEvalSupported: true
    });

    activePdfDocument = await loadingTask.promise;

    if (activePdfUrl !== pdf.pdf_url) return;

    await renderPdfPage(activePdfPageNumber);

  } catch (error) {
    console.error("PDF viewer error:", error);
    renderPdfViewerMessage(
      viewer,
      "Gagal memuat materi. Coba buka lagi."
    );
  }
}


async function renderPdfPage(pageNumber) {
  if (!activePdfDocument) return;

  const viewer =
    document.querySelector("#pdf-viewer") ||
    document.querySelector(".pdf-viewer") ||
    document.querySelector('[data-pdf-viewer]');

  const canvas =
    viewer?.querySelector("canvas") ||
    viewer?.querySelector("#pdf-canvas") ||
    viewer?.querySelector('[data-pdf-canvas]');

  if (!viewer || !canvas) return;

  try {
    if (activePdfRenderTask) {
      activePdfRenderTask.cancel();
      activePdfRenderTask = null;
    }

    const page = await activePdfDocument.getPage(pageNumber);
    const baseViewport = page.getViewport({ scale: 1 });

    const content =
      viewer.querySelector(".pdf-viewer-content");

    const availableWidth =
      content?.clientWidth ||
      viewer.clientWidth ||
      baseViewport.width;

    const horizontalPadding = 24;
    const scale = Math.max(
      0.6,
      (availableWidth - horizontalPadding) / baseViewport.width
    );

    const viewport = page.getViewport({ scale });
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width = Math.floor(viewport.width * pixelRatio);
    canvas.height = Math.floor(viewport.height * pixelRatio);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;

    const context = canvas.getContext("2d", {
      alpha: false
    });

    context.setTransform(
      pixelRatio,
      0,
      0,
      pixelRatio,
      0,
      0
    );

    activePdfRenderTask = page.render({
      canvasContext: context,
      viewport
    });

    await activePdfRenderTask.promise;
    activePdfRenderTask = null;

  } catch (error) {
    if (error?.name !== "RenderingCancelledException") {
      console.error("PDF page render error:", error);
    }
  }
}


function renderPdfViewerMessage(viewer, message) {
  const content =
    viewer.querySelector(".pdf-viewer-content");

  if (!content) return;

  content.innerHTML = `
    <div class="pdf-viewer-message">
      ${escapeHtml(message)}
    </div>
  `;
}


function closePdfViewer() {
  const viewer =
    document.querySelector("#pdf-viewer") ||
    document.querySelector(".pdf-viewer") ||
    document.querySelector('[data-pdf-viewer]');

  if (!viewer) return;

  const content =
    viewer.querySelector(".pdf-viewer-content");

  if (activePdfRenderTask) {
    try {
      activePdfRenderTask.cancel();
    } catch (error) {
      console.warn("PDF render cancel error:", error);
    }
    activePdfRenderTask = null;
  }

  activePdfDocument = null;
  activePdfUrl = "";
  activePdfPageNumber = 1;

  if (content) {
    content.innerHTML = `
      <canvas id="pdf-canvas" aria-label="PDF Viewer" data-pdf-canvas></canvas>
    `;
  }

  viewer.style.display = "none";

  document.body.classList.remove(
    "pdf-viewer-open"
  );
}


/* =========================================================
   12. BLOOD SUGAR TRACKER
   ========================================================= */

function setupBloodSugarTracker() {
  const form =
    document.querySelector("#blood-sugar-form") ||
    document.querySelector('[data-blood-sugar-form]');

  if (!form) return;

  const dateLabel =
    form.querySelector(`label[for="blood-sugar-date"]`);
  const dateInputElement =
    form.querySelector("#blood-sugar-date");

  if (dateLabel) dateLabel.textContent = "Tanggal";
  if (dateInputElement) dateInputElement.type = "date";

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!currentUser) {
      alert("Silakan login terlebih dahulu.");
      return;
    }

    const dateInput =
      form.querySelector("#blood-sugar-date") ||
      form.querySelector('[name="recorded_at"]') ||
      form.querySelector('[name="date"]');

    const sugarInput =
      form.querySelector("#blood-sugar-value") ||
      form.querySelector('[name="blood_sugar"]') ||
      form.querySelector('[name="value"]');

    const measurementInput =
      form.querySelector("#measurement-type") ||
      form.querySelector('[name="measurement_type"]');

    const notesInput =
      form.querySelector("#blood-sugar-notes") ||
      form.querySelector('[name="notes"]');

    const recordedAt = dateInput?.value || "";
    const bloodSugar = parseFloat(sugarInput?.value || "");
    const measurementType = measurementInput?.value || "";
    const notes = notesInput?.value?.trim() || "";

    if (!recordedAt || Number.isNaN(bloodSugar)) {
      alert("Lengkapi tanggal dan nilai gula darah.");
      return;
    }

    try {
      await firebaseDb
        .collection("users")
        .doc(currentUser.uid)
        .collection("blood_sugar_records")
        .add({
          recorded_at: recordedAt,
          blood_sugar: bloodSugar,
          measurement_type: measurementType,
          notes,
          created_at: firebase.firestore.FieldValue.serverTimestamp()
        });

      form.reset();
      setDefaultBloodSugarDate();
      await loadBloodSugarRecords();

    } catch (error) {
      console.error("Save blood sugar error:", error);
      alert("Gagal menyimpan data. Coba lagi.");
    }
  });

  setDefaultBloodSugarDate();
}


function setDefaultBloodSugarDate() {
  const input = document.querySelector("#blood-sugar-date");
  if (!input || input.value) return;

  const now = new Date();
  const offset = now.getTimezoneOffset();
  const local = new Date(now.getTime() - offset * 60000);
  input.value = local.toISOString().slice(0, 10);
}
