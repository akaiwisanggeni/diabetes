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
let selectedWeightChartDays = 7;
let selectedBloodSugarChartDays = 7;
let visibleBloodSugarProgressCount = 10;


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
  ensureWeightChartUI();
  setupWeightTracker();
  setupWeightChartPeriods();
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
     ======================================================= */

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

  /* Nama user */

  const userNameElements = document.querySelectorAll(
    "#user-name, #username, .user-name, [data-user-name]"
  );

  userNameElements.forEach((element) => {
    element.textContent = user ? name : "Guest";
  });


  /* Email */

  const emailElements = document.querySelectorAll(
    "#user-email, .user-email, [data-user-email]"
  );

  emailElements.forEach((element) => {
    element.textContent = user ? user.email : "";
  });


  /* Login screen */

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


  /* Logout button */

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
    /* Fallback */

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


  /* Load tracker data ketika masuk */

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


function openPdfViewer(pdf) {
  const viewer =
    document.querySelector("#pdf-viewer") ||
    document.querySelector(".pdf-viewer") ||
    document.querySelector('[data-pdf-viewer]');

  if (!viewer) {
    console.warn("PDF viewer tidak ditemukan.");
    return;
  }

  const iframe =
    viewer.querySelector("iframe") ||
    viewer.querySelector("#pdf-frame") ||
    viewer.querySelector('[data-pdf-frame]');

  const title =
    viewer.querySelector("#pdf-viewer-title") ||
    viewer.querySelector(".pdf-viewer-title") ||
    viewer.querySelector('[data-pdf-title]');

  if (iframe) {
    iframe.src = pdf.pdf_url;
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
}


function closePdfViewer() {
  const viewer =
    document.querySelector("#pdf-viewer") ||
    document.querySelector(".pdf-viewer") ||
    document.querySelector('[data-pdf-viewer]');

  if (!viewer) return;

  const iframe =
    viewer.querySelector("iframe") ||
    viewer.querySelector("#pdf-frame") ||
    viewer.querySelector('[data-pdf-frame]');

  if (iframe) {
    iframe.src = "";
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

  // Tracker hanya membutuhkan tanggal, bukan jam.
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
      form.querySelector('[name="sugar"]');

    const typeInput =
      form.querySelector("#measurement-type") ||
      form.querySelector('[name="measurement_type"]');

    const notesInput =
      form.querySelector("#blood-sugar-notes") ||
      form.querySelector('[name="notes"]');

    if (!sugarInput || !sugarInput.value) {
      alert("Masukkan nilai gula darah.");
      return;
    }

    const recordedAt =
      dateInput && dateInput.value
        ? dateOnlyToTimestamp(dateInput.value)
        : dateOnlyToTimestamp(getTodayDate());

    const bloodSugar =
      Number(sugarInput.value);

    if (Number.isNaN(bloodSugar)) {
      alert("Nilai gula darah tidak valid.");
      return;
    }

    const payload = {
      user_id: currentUser.uid,
      recorded_at: recordedAt,
      blood_sugar: bloodSugar,
      measurement_type:
        typeInput
          ? typeInput.value
          : null,
      notes:
        notesInput
          ? notesInput.value.trim()
          : null
    };

    try {
      await firebaseDb
        .collection("blood_sugar_tracker")
        .add(payload);

      form.reset();

      await loadBloodSugarRecords();

      alert("Data gula darah berhasil disimpan.");

    } catch (error) {
      console.error("Blood sugar save error:", error);

      alert(
        "Gagal menyimpan data gula darah."
      );
    }
  });


  /* CSV button */

  const csvButtons = document.querySelectorAll(
    "#download-blood-sugar-csv, #blood-sugar-csv, [data-download-blood-sugar-csv]"
  );

  csvButtons.forEach((button) => {
    button.addEventListener(
      "click",
      downloadBloodSugarCSV
    );
  });
}


async function loadBloodSugarRecords() {
  if (!firebaseDb || !currentUser) return;

  const sixMonthsAgo =
    new Date();

  sixMonthsAgo.setMonth(
    sixMonthsAgo.getMonth() - 6
  );

  try {
    // Ambil berdasarkan user saja, lalu urutkan di browser.
    // Ini menghindari kebutuhan composite index Firestore.
    const snapshot = await firebaseDb
      .collection("blood_sugar_tracker")
      .where("user_id", "==", currentUser.uid)
      .get();

    bloodSugarRecords =
      snapshot.docs
        .map((doc) => ({
          id: doc.id,
          ...doc.data()
        }))
        .filter((record) => {
          const date = getRecordDate(record.recorded_at);

          return (
            date &&
            date >= sixMonthsAgo
          );
        })
        .sort((a, b) =>
          getRecordDate(b.recorded_at) -
          getRecordDate(a.recorded_at)
        );

    renderBloodSugarChart();

  } catch (error) {
    console.error(
      "Blood sugar load error:",
      error
    );

    bloodSugarRecords = [];

    renderBloodSugarChart();
  }
}


/* =========================================================
   12A. BLOOD SUGAR PROGRESS LIST UI
   ========================================================= */

function ensureBloodSugarChartUI() {
  const page = document.querySelector('#blood-sugar');
  if (!page) return;

  if (document.querySelector('#mpd-blood-sugar-chart-card')) return;

  const formSection = page.querySelector('.tracker-form-card');
  if (!formSection) return;

  const style = document.createElement('style');
  style.id = 'mpd-blood-sugar-chart-style';
  style.textContent = `
    #mpd-blood-sugar-chart-card {
      margin: 18px 0;
      padding: 18px;
      border-radius: 18px;
      background: #ffffff;
      box-shadow: 0 6px 20px rgba(0,0,0,.05);
    }

    #mpd-blood-sugar-chart-card .mpd-chart-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 4px;
    }

    #mpd-blood-sugar-chart-card .mpd-chart-title {
      font-size: 17px;
      font-weight: 800;
      color: #1f5f4a;
      margin: 0;
    }

    #mpd-blood-sugar-chart-card .mpd-chart-subtitle {
      font-size: 13px;
      line-height: 1.45;
      color: #6d756f;
      margin-bottom: 12px;
    }

    #mpd-blood-sugar-chart-card .mpd-blood-sugar-csv-btn {
      flex: 0 0 auto;
      border: 1px solid #d7ded8;
      background: #ffffff;
      color: #1f5f4a;
      border-radius: 999px;
      padding: 7px 10px;
      font-size: 11px;
      font-weight: 700;
      cursor: pointer;
    }

    #mpd-blood-sugar-chart-card .mpd-blood-sugar-periods {
      display: flex;
      gap: 7px;
      flex-wrap: wrap;
      margin-bottom: 10px;
    }

    #mpd-blood-sugar-chart-card .mpd-blood-sugar-period-btn {
      border: 1px solid #d7ded8;
      background: #f7f9f7;
      color: #506057;
      border-radius: 999px;
      padding: 7px 12px;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
    }

    #mpd-blood-sugar-chart-card .mpd-blood-sugar-period-btn.active {
      background: #679343;
      border-color: #679343;
      color: #ffffff;
    }

    #mpd-blood-sugar-progress-meta {
      font-size: 11px;
      color: #7a827c;
      margin: 0 0 10px;
    }

    #mpd-blood-sugar-progress-list {
      display: flex;
      flex-direction: column;
      gap: 9px;
    }

    .mpd-blood-sugar-progress-item {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 4px 12px;
      padding: 12px 13px;
      border: 1px solid #edf0eb;
      border-radius: 14px;
      background: #fafcf9;
    }

    .mpd-blood-sugar-progress-date {
      font-size: 12px;
      color: #6d756f;
      align-self: center;
    }

    .mpd-blood-sugar-progress-value {
      font-size: 16px;
      font-weight: 800;
      color: #1f5f4a;
      white-space: nowrap;
    }

    .mpd-blood-sugar-progress-value span {
      font-size: 11px;
      font-weight: 600;
      color: #6d756f;
    }

    .mpd-blood-sugar-progress-type,
    .mpd-blood-sugar-progress-note,
    .mpd-blood-sugar-progress-change {
      grid-column: 1 / -1;
      font-size: 11px;
      line-height: 1.45;
      color: #6d756f;
    }

    .mpd-blood-sugar-progress-note {
      color: #4f5d54;
    }

    .mpd-blood-sugar-progress-more {
      width: 100%;
      margin-top: 2px;
      border: 1px solid #d7ded8;
      background: #ffffff;
      color: #1f5f4a;
      border-radius: 12px;
      padding: 10px 12px;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
    }

    .mpd-blood-sugar-progress-empty {
      padding: 18px 12px;
      text-align: center;
      color: #707a73;
      font-size: 13px;
      line-height: 1.5;
      border: 1px dashed #dfe5df;
      border-radius: 14px;
      background: #fafcf9;
    }

    @media (max-width: 420px) {
      #mpd-blood-sugar-chart-card .mpd-chart-header {
        align-items: center;
      }

      #mpd-blood-sugar-chart-card .mpd-blood-sugar-csv-btn {
        padding: 7px 9px;
      }
    }
  `;
  document.head.appendChild(style);

  const card = document.createElement('section');
  card.id = 'mpd-blood-sugar-chart-card';
  card.innerHTML = `
    <div class="mpd-chart-header">
      <div class="mpd-chart-title">Progress Gula Darah</div>
      <button
        type="button"
        id="download-blood-sugar-csv"
        class="mpd-blood-sugar-csv-btn"
      >
        Download CSV
      </button>
    </div>

    <div class="mpd-chart-subtitle">
      Pengukuran dalam periode yang kamu pilih
    </div>

    <div
      id="mpd-blood-sugar-chart-period-controls"
      class="mpd-blood-sugar-periods"
      role="tablist"
      aria-label="Periode progress gula darah"
    >
      <button type="button" data-period="7" class="mpd-blood-sugar-period-btn active">Minggu</button>
      <button type="button" data-period="30" class="mpd-blood-sugar-period-btn">1 Bulan</button>
      <button type="button" data-period="90" class="mpd-blood-sugar-period-btn">3 Bulan</button>
      <button type="button" data-period="180" class="mpd-blood-sugar-period-btn">6 Bulan</button>
    </div>

    <div id="mpd-blood-sugar-progress-meta"></div>
    <div id="mpd-blood-sugar-progress-list"></div>
  `;

  formSection.insertAdjacentElement('afterend', card);
}


function setupBloodSugarChartPeriods() {
  const controls =
    document.querySelector('#mpd-blood-sugar-chart-period-controls');

  if (!controls) return;

  const buttons =
    controls.querySelectorAll('.mpd-blood-sugar-period-btn');

  buttons.forEach((button) => {
    button.addEventListener('click', () => {
      selectedBloodSugarChartDays =
        Number(button.dataset.period) || 7;

      visibleBloodSugarProgressCount = 10;

      buttons.forEach((item) => {
        item.classList.toggle('active', item === button);
      });

      renderBloodSugarChart();
    });
  });
}


function renderBloodSugarChart() {
  const container =
    document.querySelector('#mpd-blood-sugar-progress-list');

  const meta =
    document.querySelector('#mpd-blood-sugar-progress-meta');

  if (!container) return;

  const today = new Date();
  today.setHours(23, 59, 59, 999);

  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(
    cutoff.getDate() - (selectedBloodSugarChartDays - 1)
  );

  const progressData =
    (bloodSugarRecords || [])
      .filter((item) => {
        const date = getRecordDate(item.recorded_at);
        return date && date >= cutoff && date <= today;
      })
      .sort((a, b) =>
        getRecordDate(b.recorded_at) - getRecordDate(a.recorded_at)
      );

  if (meta) {
    meta.textContent = progressData.length
      ? `Menampilkan ${Math.min(visibleBloodSugarProgressCount, progressData.length)} dari ${progressData.length} pengukuran`
      : '';
  }

  if (!progressData.length) {
    container.innerHTML = `
      <div class="mpd-blood-sugar-progress-empty">
        Belum ada pengukuran pada periode ini.
      </div>
    `;
    return;
  }

  const visibleData = progressData.slice(
    0,
    visibleBloodSugarProgressCount
  );

  container.innerHTML = visibleData
    .map((record, index) => {
      const value = Number(record.blood_sugar);
      const previous = progressData[index + 1];
      const previousValue = previous
        ? Number(previous.blood_sugar)
        : null;

      let changeHtml = '';

      if (Number.isFinite(value) && Number.isFinite(previousValue)) {
        const difference = value - previousValue;
        const sign = difference > 0 ? '+' : '';
        changeHtml = `
          <div class="mpd-blood-sugar-progress-change">
            ${sign}${formatNumber(difference)} mg/dL dari pengukuran sebelumnya
          </div>
        `;
      }

      const noteHtml = record.notes
        ? `
          <div class="mpd-blood-sugar-progress-note">
            Catatan: ${escapeHtml(record.notes)}
          </div>
        `
        : '';

      return `
        <div class="mpd-blood-sugar-progress-item">
          <div class="mpd-blood-sugar-progress-date">
            ${escapeHtml(formatDate(record.recorded_at))}
          </div>

          <div class="mpd-blood-sugar-progress-value">
            ${escapeHtml(String(record.blood_sugar ?? '-'))}
            <span>mg/dL</span>
          </div>

          ${
            record.measurement_type
              ? `
                <div class="mpd-blood-sugar-progress-type">
                  ${escapeHtml(record.measurement_type)}
                </div>
              `
              : ''
          }

          ${noteHtml}
          ${changeHtml}
        </div>
      `;
    })
    .join('');

  if (visibleBloodSugarProgressCount < progressData.length) {
    const remaining = progressData.length - visibleBloodSugarProgressCount;
    const moreButton = document.createElement('button');
    moreButton.type = 'button';
    moreButton.className = 'mpd-blood-sugar-progress-more';
    moreButton.textContent = `Tampilkan ${Math.min(10, remaining)} data lagi`;

    moreButton.addEventListener('click', () => {
      visibleBloodSugarProgressCount += 10;
      renderBloodSugarChart();
    });

    container.appendChild(moreButton);
  }
}


/* =========================================================
   13. BLOOD SUGAR CSV — LAST 6 MONTHS
   ========================================================= */

function downloadBloodSugarCSV() {
  if (!currentUser) {
    alert("Silakan login terlebih dahulu.");
    return;
  }

  if (!bloodSugarRecords.length) {
    alert("Belum ada data gula darah.");
    return;
  }

  const headers = [
    "Tanggal",
    "Gula Darah (mg/dL)",
    "Waktu Pengukuran",
    "Catatan"
  ];

  const rows =
    bloodSugarRecords.map(
      (record) => {

        const date =
          formatDate(record.recorded_at);

        const sugar =
          record.blood_sugar ?? "";

        const type =
          record.measurement_type ?? "";

        const notes =
          record.notes ?? "";

        return [
          date,
          sugar,
          type,
          notes
        ];
      }
    );

  const csvData = [
    headers,
    ...rows
  ];

  const csv = csvData
    .map((row) =>
      row
        .map(csvEscape)
        .join(",")
    )
    .join("\n");

  const blob =
    new Blob(
      ["\uFEFF" + csv],
      {
        type: "text/csv;charset=utf-8;"
      }
    );

  const url =
    URL.createObjectURL(blob);

  const link =
    document.createElement("a");

  link.href = url;

  link.download =
    "tracker-gula-darah-6-bulan.csv";

  document.body.appendChild(link);

  link.click();

  document.body.removeChild(link);

  URL.revokeObjectURL(url);
}


function csvEscape(value) {
  const stringValue =
    String(value ?? "");

  return `"${stringValue.replace(
    /"/g,
    '""'
  )}"`;
}


/* =========================================================
   14. WEIGHT TRACKER
   ========================================================= */

/* =========================================================
   14A. WEIGHT CHART UI
   ========================================================= */

function ensureWeightChartUI() {
  const weightPage = document.querySelector('#weight');
  if (!weightPage) return;

  // Do not duplicate the chart if the script/UI is initialized again.
  if (document.querySelector('#mpd-weight-chart-card')) return;

  const historySection =
    weightPage.querySelector('.tracker-history') ||
    weightPage.querySelector('#weight-list')?.parentElement;

  if (!historySection) return;

  const style = document.createElement('style');
  style.id = 'mpd-weight-chart-style';
  style.textContent = `
    #mpd-weight-chart-card {
      margin: 18px 0;
      padding: 18px;
      border-radius: 18px;
      background: #ffffff;
      box-shadow: 0 6px 20px rgba(0,0,0,.05);
    }
    #mpd-weight-chart-card .mpd-chart-title {
      font-size: 17px;
      font-weight: 800;
      color: #1f5f4a;
      margin-bottom: 4px;
    }
    #mpd-weight-chart-card .mpd-chart-subtitle {
      font-size: 13px;
      line-height: 1.45;
      color: #6d756f;
      margin-bottom: 12px;
    }
    #mpd-weight-chart-card .mpd-weight-chart-periods {
      display: flex;
      gap: 7px;
      flex-wrap: wrap;
      margin-bottom: 14px;
    }
    #mpd-weight-chart-card .mpd-weight-period-btn {
      border: 1px solid #d7ded8;
      background: #f7f9f7;
      color: #506057;
      border-radius: 999px;
      padding: 7px 12px;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
    }
    #mpd-weight-chart-card .mpd-weight-period-btn.active {
      background: #679343;
      border-color: #679343;
      color: #ffffff;
    }
    #mpd-weight-chart-card .mpd-chart-wrap {
      width: 100%;
      overflow: hidden;
    }
    #mpd-weight-chart-card #mpd-weight-chart {
      display: block;
      width: 100%;
      height: 220px;
    }
    #mpd-weight-chart-card .mpd-chart-empty {
      min-height: 180px;
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 20px;
      color: #707a73;
      font-size: 13px;
      line-height: 1.5;
    }
    @media (max-width: 480px) {
      #mpd-weight-chart-card {
        padding: 16px;
        border-radius: 16px;
      }
      #mpd-weight-chart-card #mpd-weight-chart {
        height: 190px;
      }
      #mpd-weight-chart-card .mpd-weight-period-btn {
        padding: 6px 10px;
      }
    }
  `;
  document.head.appendChild(style);

  const card = document.createElement('section');
  card.id = 'mpd-weight-chart-card';
  card.innerHTML = `
    <div class="mpd-chart-title">Progress 6 Bulan</div>
    <div class="mpd-chart-subtitle">
      Perkembangan berat badan berdasarkan catatanmu
    </div>

    <div
      id="mpd-weight-chart-period-controls"
      class="mpd-weight-chart-periods"
      role="tablist"
      aria-label="Periode grafik berat badan"
    >
      <button type="button" data-period="7" class="mpd-weight-period-btn active">Minggu</button>
      <button type="button" data-period="30" class="mpd-weight-period-btn">1 Bulan</button>
      <button type="button" data-period="90" class="mpd-weight-period-btn">3 Bulan</button>
      <button type="button" data-period="180" class="mpd-weight-period-btn">6 Bulan</button>
    </div>

    <div class="mpd-chart-wrap">
      <div id="mpd-weight-chart-empty" class="mpd-chart-empty">
        Belum ada cukup data untuk menampilkan grafik.
      </div>

      <svg
        id="mpd-weight-chart"
        viewBox="0 0 700 240"
        preserveAspectRatio="none"
        style="display:none;"
        aria-label="Grafik perkembangan berat badan"
        role="img"
      >
        <g id="mpd-weight-grid"></g>
        <polyline
          id="mpd-weight-chart-line"
          fill="none"
          stroke="#679343"
          stroke-width="4"
          stroke-linecap="round"
          stroke-linejoin="round"
        ></polyline>
        <g id="mpd-weight-chart-dots"></g>
      </svg>
    </div>
  `;

  historySection.parentNode.insertBefore(card, historySection);
}


function setupWeightChartPeriods() {
  const controls =
    document.querySelector('#mpd-weight-chart-period-controls');

  if (!controls) return;

  const buttons =
    controls.querySelectorAll('.mpd-weight-period-btn');

  buttons.forEach((button) => {
    button.addEventListener('click', () => {
      selectedWeightChartDays =
        Number(button.dataset.period) || 7;

      buttons.forEach((item) => {
        item.classList.toggle('active', item === button);
      });

      renderWeightChart();
    });
  });
}


function renderWeightChart() {
  const chart = document.querySelector('#mpd-weight-chart');
  const empty = document.querySelector('#mpd-weight-chart-empty');
  const line = document.querySelector('#mpd-weight-chart-line');
  const dots = document.querySelector('#mpd-weight-chart-dots');
  const grid = document.querySelector('#mpd-weight-grid');

  if (!chart || !empty) return;

  const today = new Date();
  today.setHours(23, 59, 59, 999);

  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - (selectedWeightChartDays - 1));

  const chartData =
    (weightRecords || [])
      .filter((item) => {
        const date = new Date(item.recorded_at);
        return !Number.isNaN(date.getTime()) && date >= cutoff && date <= today;
      })
      .sort((a, b) => new Date(a.recorded_at) - new Date(b.recorded_at));

  if (chartData.length < 2) {
    chart.style.display = 'none';
    empty.style.display = 'flex';
    empty.textContent =
      'Belum ada cukup data pada periode ini untuk menampilkan grafik.';
    return;
  }

  chart.style.display = 'block';
  empty.style.display = 'none';

  const width = 700;
  const height = 240;
  const paddingX = 25;
  const paddingY = 25;

  const values = chartData.map((item) => Number(item.weight));
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const range = maxValue - minValue || 1;

  const points = chartData.map((item, index) => {
    const x =
      paddingX +
      (index / Math.max(chartData.length - 1, 1)) *
        (width - paddingX * 2);

    const y =
      height -
      paddingY -
      ((Number(item.weight) - minValue) / range) *
        (height - paddingY * 2);

    return {
      x,
      y,
      value: Number(item.weight),
      date: item.recorded_at
    };
  });

  if (line) {
    line.setAttribute(
      'points',
      points.map((point) => `${point.x},${point.y}`).join(' ')
    );
  }

  if (dots) {
    dots.innerHTML = '';

    points.forEach((point) => {
      const circle = document.createElementNS(
        'http://www.w3.org/2000/svg',
        'circle'
      );

      circle.setAttribute('cx', point.x);
      circle.setAttribute('cy', point.y);
      circle.setAttribute('r', '5');
      circle.setAttribute('fill', '#679343');

      const title = document.createElementNS(
        'http://www.w3.org/2000/svg',
        'title'
      );
      title.textContent =
        `${formatDate(point.date)} — ${formatNumber(point.value)} kg`;
      circle.appendChild(title);

      dots.appendChild(circle);
    });
  }

  if (grid) {
    grid.innerHTML = '';
    const gridCount = 4;

    for (let i = 0; i <= gridCount; i++) {
      const y =
        paddingY +
        (i / gridCount) * (height - paddingY * 2);

      const gridLine = document.createElementNS(
        'http://www.w3.org/2000/svg',
        'line'
      );

      gridLine.setAttribute('x1', paddingX);
      gridLine.setAttribute('x2', width - paddingX);
      gridLine.setAttribute('y1', y);
      gridLine.setAttribute('y2', y);
      gridLine.setAttribute('stroke', '#e7e4dc');
      gridLine.setAttribute('stroke-width', '1');

      grid.appendChild(gridLine);
    }
  }
}


function setupWeightTracker() {
  const form =
    document.querySelector("#weight-form") ||
    document.querySelector('[data-weight-form]');

  if (!form) return;

  // Tracker hanya membutuhkan tanggal, bukan jam.
  const dateLabel =
    form.querySelector(`label[for="weight-date"]`);
  const dateInputElement =
    form.querySelector("#weight-date");

  if (dateLabel) dateLabel.textContent = "Tanggal";
  if (dateInputElement) dateInputElement.type = "date";

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!currentUser) {
      alert("Silakan login terlebih dahulu.");
      return;
    }

    const dateInput =
      form.querySelector("#weight-date") ||
      form.querySelector('[name="recorded_at"]') ||
      form.querySelector('[name="date"]');

    const weightInput =
      form.querySelector("#weight-value") ||
      form.querySelector('[name="weight"]');

    const notesInput =
      form.querySelector("#weight-notes") ||
      form.querySelector('[name="notes"]');

    if (!weightInput || !weightInput.value) {
      alert("Masukkan berat badan.");
      return;
    }

    const weight =
      Number(weightInput.value);

    if (Number.isNaN(weight)) {
      alert("Berat badan tidak valid.");
      return;
    }

    const recordedAt =
      dateInput && dateInput.value
        ? dateOnlyToTimestamp(dateInput.value)
        : dateOnlyToTimestamp(getTodayDate());

    const payload = {
      user_id: currentUser.uid,
      recorded_at: recordedAt,
      weight: weight,
      notes:
        notesInput
          ? notesInput.value.trim()
          : null
    };

    try {
      await firebaseDb
        .collection("weight_tracker")
        .add(payload);

      form.reset();

      await loadWeightRecords();

      alert(
        "Data berat badan berhasil disimpan."
      );

    } catch (error) {
      console.error("Weight save error:", error);

      alert(
        "Gagal menyimpan berat badan."
      );
    }
  });
}


async function loadWeightRecords() {
  if (!firebaseDb || !currentUser) return;

  try {
    const snapshot = await firebaseDb
      .collection("weight_tracker")
      .where("user_id", "==", currentUser.uid)
      .orderBy("recorded_at", "asc")
      .get();

    weightRecords =
      snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data()
      }));

    renderWeightRecords(
      weightRecords
    );

    renderWeightChart();

  } catch (error) {
    console.error(
      "Weight load error:",
      error
    );

    weightRecords = [];

    renderWeightRecords(
      weightRecords
    );

    renderWeightChart();
  }
}


function renderWeightRecords(records) {
  const container =
    document.querySelector("#weight-list") ||
    document.querySelector("#weight-table") ||
    document.querySelector('[data-weight-list]');

  if (!container) return;

  if (!records.length) {
    container.innerHTML = `
      <div class="empty-state">
        Belum ada data berat badan.
      </div>
    `;

    return;
  }

  const sorted =
    [...records].reverse();

  container.innerHTML =
    sorted
      .map((record) => {

        const date =
          formatDate(
            record.recorded_at
          );

        const weight =
          record.weight ?? "-";

        const notes =
          record.notes || "";

        return `
          <div class="tracker-row">

            <div class="tracker-date">
              ${escapeHtml(date)}
            </div>

            <div class="tracker-value">
              ${escapeHtml(String(weight))}
              <span>kg</span>
            </div>

            ${
              notes
                ? `
                  <div class="tracker-notes">
                    ${escapeHtml(notes)}
                  </div>
                `
                : ""
            }

          </div>
        `;
      })
      .join("");
}


/* =========================================================
   15. CARBOHYDRATE CALCULATOR
   ========================================================= */

/* =========================================================
   15. CARBOHYDRATE CALCULATOR
   ========================================================= */

let carbFoods = [];
let selectedCarbFood = null;


async function setupCarbCalculator() {
  const form =
    document.querySelector("#carb-calculator-form") ||
    document.querySelector("#carb-form") ||
    document.querySelector('[data-carb-calculator-form]');

  if (!form) return;

  /* Build the database-powered UI without changing index.html. */
  const amountInput =
    form.querySelector("#carb-amount") ||
    form.querySelector('[name="amount"]');

  const oldCarbInput =
    form.querySelector("#carb-per-serving") ||
    form.querySelector('[name="carb_per_serving"]');

  if (amountInput) {
    amountInput.outerHTML = `
      <input
        id="carb-amount"
        type="number"
        name="amount"
        min="0"
        step="1"
        inputmode="decimal"
        placeholder="Contoh: 100"
      >
    `;
  }

  if (oldCarbInput) {
    const wrapper = oldCarbInput.closest(".input-with-unit");
    if (wrapper) {
      wrapper.outerHTML = `
        <div
          id="carb-selected-info"
          class="carb-selected-info"
          style="
            border:1px solid rgba(23,105,73,.15);
            border-radius:12px;
            padding:12px 14px;
            background:#f7fbf8;
            margin-bottom:12px;
          "
        >
          <div style="font-size:13px;color:#777;">Karbohidrat per 100 g</div>
          <strong id="carb-per-100g-display" style="font-size:18px;">—</strong>
        </div>
      `;
    }
  }

  const firstLabel = form.querySelector('label[for="carb-amount"]');
  if (firstLabel) firstLabel.textContent = "Jumlah (gram)";

  const oldCarbLabel = form.querySelector('label[for="carb-per-serving"]');
  if (oldCarbLabel) oldCarbLabel.remove();

  /* Insert food search before the amount field. */
  if (!form.querySelector("#carb-food-search")) {
    const searchBlock = document.createElement("div");
    searchBlock.className = "carb-food-picker";
    searchBlock.style.marginBottom = "16px";
    searchBlock.innerHTML = `
      <label for="carb-food-search">Pilih Makanan</label>

      <input
        id="carb-food-search"
        type="search"
        autocomplete="off"
        placeholder="Cari makanan, misalnya: ay"
      >

      <div
        id="carb-food-results"
        role="listbox"
        aria-label="Hasil pencarian makanan"
        style="
          display:none;
          max-height:230px;
          overflow-y:auto;
          margin-top:8px;
          border:1px solid #e1e8e3;
          border-radius:12px;
          background:#fff;
          box-shadow:0 8px 20px rgba(0,0,0,.08);
        "
      ></div>

      <div
        id="carb-food-selected"
        style="
          display:none;
          margin-top:8px;
          padding:10px 12px;
          border-radius:10px;
          background:#eef8f1;
          font-size:14px;
        "
      ></div>
    `;

    const amountLabel = form.querySelector('label[for="carb-amount"]');
    if (amountLabel) {
      form.insertBefore(searchBlock, amountLabel);
    } else {
      form.prepend(searchBlock);
    }
  }

  const searchInput = form.querySelector("#carb-food-search");
  const results = form.querySelector("#carb-food-results");
  const selected = form.querySelector("#carb-food-selected");
  const amount = form.querySelector("#carb-amount");
  const carbDisplay = form.querySelector("#carb-per-100g-display");

  const renderFoodResults = (query = "") => {
    if (!results) return;

    const q = query.trim().toLocaleLowerCase("id-ID");

    const matches = carbFoods.filter((food) =>
      !q || food.name.toLocaleLowerCase("id-ID").includes(q)
    );

    results.innerHTML = "";

    if (!matches.length) {
      results.innerHTML = `
        <div style="padding:14px;color:#777;">
          Makanan tidak ditemukan.
        </div>
      `;
    } else {
      matches.forEach((food) => {
        const item = document.createElement("button");
        item.type = "button";
        item.setAttribute("role", "option");
        item.style.cssText = `
          display:block;
          width:100%;
          border:0;
          border-bottom:1px solid #eef1ef;
          background:#fff;
          padding:11px 13px;
          text-align:left;
          cursor:pointer;
        `;
        item.innerHTML = `
          <strong style="display:block;font-size:14px;">
            ${escapeHtml(food.name)}
          </strong>
          <span style="font-size:12px;color:#777;">
            ${escapeHtml(food.category)} · ${formatNumber(food.carbs_per_100g)} g karbo / 100 g
          </span>
        `;

        item.addEventListener("click", () => {
          selectedCarbFood = food;

          if (searchInput) searchInput.value = food.name;
          if (results) results.style.display = "none";

          if (selected) {
            selected.style.display = "block";
            selected.textContent =
              `${food.name} · ${formatNumber(food.carbs_per_100g)} g karbohidrat / 100 g`;
          }

          if (carbDisplay) {
            carbDisplay.textContent =
              `${formatNumber(food.carbs_per_100g)} g`;
          }

          calculateCarbs(form);
        });

        results.appendChild(item);
      });
    }

    results.style.display = "block";
  };

  searchInput?.addEventListener("input", () => {
    /* Substring search: "ay" finds every food containing "ay". */
    renderFoodResults(searchInput.value);
  });

  searchInput?.addEventListener("focus", () => {
    renderFoodResults(searchInput.value);
  });

  amount?.addEventListener("input", () => calculateCarbs(form));
  amount?.addEventListener("change", () => calculateCarbs(form));

  document.addEventListener("click", (event) => {
    if (
      results &&
      searchInput &&
      !searchInput.contains(event.target) &&
      !results.contains(event.target)
    ) {
      results.style.display = "none";
    }
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    calculateCarbs(form);
  });

  if (currentUser) {
    await loadCarbFoods();

    if (carbFoods.length) {
      renderFoodResults("");
    }
  }
}


async function loadCarbFoods() {
  carbFoods = [];

  if (!firebaseDb) {
    console.warn("Carb foods: Firestore belum aktif.");
    return;
  }

  try {
    const snapshot = await firebaseDb
      .collection("carb_foods")
      .orderBy("name", "asc")
      .get();

    carbFoods = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data()
    }));

    console.log(
      `Carb foods loaded: ${carbFoods.length}`
    );

  } catch (error) {
    console.error(
      "Carb foods load error:",
      error
    );
  }
}


function calculateCarbs(form) {
  const amountInput =
    form.querySelector("#carb-amount") ||
    form.querySelector('[name="amount"]');

  const result =
    document.querySelector("#carb-result") ||
    form.querySelector("#carb-result") ||
    document.querySelector('[data-carb-result]');

  if (!amountInput || !result) return;

  const amount = Number(amountInput.value);

  if (
    !selectedCarbFood ||
    Number.isNaN(amount) ||
    amount < 0
  ) {
    result.textContent = "0 g";
    return;
  }

  const total =
    (amount / 100) *
    Number(selectedCarbFood.carbs_per_100g);

  result.textContent =
    `${formatNumber(total)} g`;
}


/* =========================================================
   16. DATE / NUMBER HELPERS
   ========================================================= */

function getTodayDate() {
  const now = new Date();

  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}


function dateOnlyToTimestamp(dateValue) {
  if (!dateValue) return new Date().toISOString();

  // Simpan pada tengah hari lokal agar tanggal tidak bergeser
  // ke hari sebelumnya karena konversi timezone.
  const date = new Date(`${dateValue}T12:00:00`);

  return Number.isNaN(date.getTime())
    ? new Date().toISOString()
    : date.toISOString();
}


function getRecordDate(value) {
  if (!value) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (value && typeof value.toDate === "function") {
    const date = value.toDate();
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}


function formatDate(dateString) {
  if (!dateString) return "-";

  const date =
    getRecordDate(dateString);

  if (!date) {
    return "-";
  }

  return date.toLocaleDateString(
    "id-ID",
    {
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    }
  );
}


function formatNumber(number) {
  return Number(number)
    .toLocaleString(
      "id-ID",
      {
        maximumFractionDigits: 2
      }
    );
}


/* =========================================================
   17. ESCAPE HTML
   ========================================================= */

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}


/* =========================================================
   18. KEYBOARD SUPPORT
   ========================================================= */

document.addEventListener(
  "keydown",
  (event) => {

    if (event.key === "Escape") {
      closePdfViewer();
    }

  }
);


/* =========================================================
   19. GLOBAL MPD OBJECT
   ========================================================= */

window.MPD = {

  getUser: () => currentUser,

  getPDFs: () => pdfLibrary,

  getBloodSugarRecords: () =>
    bloodSugarRecords,

  getWeightRecords: () =>
    weightRecords,

  openPDF: openPdfViewer,

  closePDF: closePdfViewer,

  downloadBloodSugarCSV:
    downloadBloodSugarCSV,

  showPage: showPage

};


/* =========================================================
   END OF MPD SCRIPT
   ========================================================= */
