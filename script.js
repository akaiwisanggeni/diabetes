/* =========================================================
   MPD — MEAL PLAN DIABETES
   Main Application Script
   ========================================================= */

/* =========================================================
   1. SUPABASE CONFIG
   ========================================================= */

const SUPABASE_URL = "https://evawbbteyufmnsgerrmv.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_Gw64bLFzcW9lOe8nAfAqZA_rmKHOnoB";

let supabaseClient = null;


/* =========================================================
   2. APP STATE
   ========================================================= */

let currentUser = null;
let pdfLibrary = [];
let bloodSugarRecords = [];
let weightRecords = [];


/* =========================================================
   3. INITIALIZE APP
   ========================================================= */

document.addEventListener("DOMContentLoaded", async () => {
  console.log("MPD App starting...");

  initializeSupabase();

  setupNavigation();
  setupLogout();
  setupMagicLinkForm();
  setupPdfViewer();

  setupBloodSugarTracker();
  setupWeightTracker();
  setupCarbCalculator();

  if (supabaseClient) {
    await initializeAuth();
  }

  loadPdfLibrary();

  console.log("MPD App ready.");
});


/* =========================================================
   4. SUPABASE
   ========================================================= */

function initializeSupabase() {
  if (!window.supabase) {
    console.error("Supabase library tidak ditemukan.");
    return;
  }

  try {
    supabaseClient = window.supabase.createClient(
      SUPABASE_URL,
      SUPABASE_PUBLISHABLE_KEY
    );

    console.log("Supabase initialized.");
  } catch (error) {
    console.error("Supabase initialization error:", error);
  }
}


/* =========================================================
   5. AUTHENTICATION
   ========================================================= */

async function initializeAuth() {
  if (!supabaseClient) return;

  try {
    const {
      data: { session }
    } = await supabaseClient.auth.getSession();

    if (session) {
      currentUser = session.user;
      updateUserUI(currentUser);
    } else {
      updateUserUI(null);
    }

    supabaseClient.auth.onAuthStateChange(
      async (_event, session) => {
        currentUser = session ? session.user : null;

        updateUserUI(currentUser);

        if (currentUser) {
          await loadBloodSugarRecords();
          await loadWeightRecords();
        }
      }
    );

  } catch (error) {
    console.error("Auth initialization error:", error);
  }
}


/* =========================================================
   6. MAGIC LINK LOGIN
   ========================================================= */

function setupMagicLinkForm() {
  const form =
    document.querySelector("#login-form") ||
    document.querySelector("#magic-link-form") ||
    document.querySelector('[data-login-form]');

  if (!form) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!supabaseClient) {
      setLoginMessage("Supabase belum terhubung.");
      return;
    }

    const emailInput =
      form.querySelector("#email") ||
      form.querySelector('input[type="email"]');

    if (!emailInput) {
      setLoginMessage("Kolom email tidak ditemukan.");
      return;
    }

    const email = emailInput.value.trim();

    if (!email) {
      setLoginMessage("Masukkan email kamu.");
      return;
    }

    setLoginMessage("Mengirim link login...");

    try {
      const redirectUrl = window.location.origin + window.location.pathname;

      const { error } = await supabaseClient.auth.signInWithOtp({
        email: email,
        options: {
          emailRedirectTo: redirectUrl
        }
      });

      if (error) {
        console.error(error);
        setLoginMessage(error.message);
        return;
      }

      setLoginMessage(
        "Link login sudah dikirim ke email kamu. Cek inbox."
      );

      emailInput.value = "";

    } catch (error) {
      console.error(error);
      setLoginMessage(
        "Terjadi kesalahan. Coba lagi."
      );
    }
  });
}


function setLoginMessage(message) {
  const messageElement =
    document.querySelector("#login-message") ||
    document.querySelector("#auth-message") ||
    document.querySelector('[data-login-message]');

  if (messageElement) {
    messageElement.textContent = message;
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

  if (user.user_metadata) {
    if (user.user_metadata.full_name) {
      return user.user_metadata.full_name;
    }

    if (user.user_metadata.name) {
      return user.user_metadata.name;
    }
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
      if (!supabaseClient) return;

      try {
        await supabaseClient.auth.signOut();

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

  if (!supabaseClient) {
    renderPdfMessage(
      container,
      "Supabase belum terhubung."
    );
    return;
  }

  renderPdfMessage(
    container,
    "Memuat materi..."
  );

  try {
    const {
      data,
      error
    } = await supabaseClient
      .from("pdfs")
      .select("*")
      .order("sort_order", {
        ascending: true
      });

    if (error) {
      console.error("PDF query error:", error);

      renderPdfMessage(
        container,
        "Gagal memuat materi."
      );

      return;
    }

    pdfLibrary = data || [];

    renderPdfLibrary(
      container,
      pdfLibrary
    );

  } catch (error) {
    console.error(error);

    renderPdfMessage(
      container,
      "Terjadi kesalahan saat memuat materi."
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
        ? new Date(dateInput.value).toISOString()
        : new Date().toISOString();

    const bloodSugar =
      Number(sugarInput.value);

    if (Number.isNaN(bloodSugar)) {
      alert("Nilai gula darah tidak valid.");
      return;
    }

    const payload = {
      user_id: currentUser.id,
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
      const {
        error
      } = await supabaseClient
        .from("blood_sugar_tracker")
        .insert(payload);

      if (error) {
        console.error(error);
        alert(
          "Gagal menyimpan data gula darah."
        );
        return;
      }

      form.reset();

      await loadBloodSugarRecords();

      alert("Data gula darah berhasil disimpan.");

    } catch (error) {
      console.error(error);

      alert(
        "Terjadi kesalahan saat menyimpan."
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
  if (!supabaseClient || !currentUser) return;

  const sixMonthsAgo =
    new Date();

  sixMonthsAgo.setMonth(
    sixMonthsAgo.getMonth() - 6
  );

  try {
    const {
      data,
      error
    } = await supabaseClient
      .from("blood_sugar_tracker")
      .select("*")
      .eq("user_id", currentUser.id)
      .gte(
        "recorded_at",
        sixMonthsAgo.toISOString()
      )
      .order("recorded_at", {
        ascending: false
      });

    if (error) {
      console.error(
        "Blood sugar load error:",
        error
      );
      return;
    }

    bloodSugarRecords =
      data || [];

    renderBloodSugarRecords(
      bloodSugarRecords
    );

  } catch (error) {
    console.error(error);
  }
}


function renderBloodSugarRecords(records) {
  const container =
    document.querySelector("#blood-sugar-list") ||
    document.querySelector("#blood-sugar-table") ||
    document.querySelector('[data-blood-sugar-list]');

  if (!container) return;

  if (!records.length) {
    container.innerHTML = `
      <div class="empty-state">
        Belum ada data gula darah.
      </div>
    `;

    return;
  }

  container.innerHTML = records
    .map((record) => {
      const date =
        formatDate(record.recorded_at);

      const value =
        record.blood_sugar ?? "-";

      const type =
        record.measurement_type || "";

      const notes =
        record.notes || "";

      return `
        <div class="tracker-row">

          <div class="tracker-date">
            ${escapeHtml(date)}
          </div>

          <div class="tracker-value">
            ${escapeHtml(String(value))}
            <span>mg/dL</span>
          </div>

          <div class="tracker-type">
            ${escapeHtml(type)}
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

function setupWeightTracker() {
  const form =
    document.querySelector("#weight-form") ||
    document.querySelector('[data-weight-form]');

  if (!form) return;

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
        ? new Date(dateInput.value).toISOString()
        : new Date().toISOString();

    const payload = {
      user_id: currentUser.id,
      recorded_at: recordedAt,
      weight: weight,
      notes:
        notesInput
          ? notesInput.value.trim()
          : null
    };

    try {
      const {
        error
      } = await supabaseClient
        .from("weight_tracker")
        .insert(payload);

      if (error) {
        console.error(error);

        alert(
          "Gagal menyimpan berat badan."
        );

        return;
      }

      form.reset();

      await loadWeightRecords();

      alert(
        "Data berat badan berhasil disimpan."
      );

    } catch (error) {
      console.error(error);

      alert(
        "Terjadi kesalahan saat menyimpan."
      );
    }
  });
}


async function loadWeightRecords() {
  if (!supabaseClient || !currentUser) return;

  try {
    const {
      data,
      error
    } = await supabaseClient
      .from("weight_tracker")
      .select("*")
      .eq("user_id", currentUser.id)
      .order("recorded_at", {
        ascending: true
      });

    if (error) {
      console.error(
        "Weight load error:",
        error
      );

      return;
    }

    weightRecords =
      data || [];

    renderWeightRecords(
      weightRecords
    );

  } catch (error) {
    console.error(error);
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

function setupCarbCalculator() {
  const form =
    document.querySelector("#carb-calculator-form") ||
    document.querySelector("#carb-form") ||
    document.querySelector('[data-carb-calculator-form]');

  if (!form) return;

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    calculateCarbs(form);
  });


  /* Automatic calculation */

  const inputs =
    form.querySelectorAll(
      "input, select"
    );

  inputs.forEach((input) => {
    input.addEventListener(
      "input",
      () => calculateCarbs(form)
    );

    input.addEventListener(
      "change",
      () => calculateCarbs(form)
    );
  });
}


function calculateCarbs(form) {
  const amountInput =
    form.querySelector("#carb-amount") ||
    form.querySelector('[name="amount"]') ||
    form.querySelector('[name="portion"]');

  const carbPerServingInput =
    form.querySelector("#carb-per-serving") ||
    form.querySelector('[name="carb_per_serving"]');

  const result =
    document.querySelector("#carb-result") ||
    form.querySelector("#carb-result") ||
    document.querySelector('[data-carb-result]');

  if (!amountInput || !carbPerServingInput || !result) {
    return;
  }

  const amount =
    Number(amountInput.value);

  const carbPerServing =
    Number(carbPerServingInput.value);

  if (
    Number.isNaN(amount) ||
    Number.isNaN(carbPerServing)
  ) {
    result.textContent = "0 g";
    return;
  }

  const total =
    amount * carbPerServing;

  result.textContent =
    `${formatNumber(total)} g`;
}


/* =========================================================
   16. DATE / NUMBER HELPERS
   ========================================================= */

function formatDate(dateString) {
  if (!dateString) return "-";

  const date =
    new Date(dateString);

  if (Number.isNaN(date.getTime())) {
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
