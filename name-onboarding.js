/* =========================================================
   MPD — DIRECT LOGIN
   Name + email only. No magic link.
   ========================================================= */

(function () {
  "use strict";

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

  /* =========================================================
     CUSTOM PDF.JS VIEWER
     Replaces the native iframe viewer while keeping the
     existing PDF library and viewer UI intact.
     ========================================================= */

  let pdfJsPromise = null;
  let activeDocument = null;
  let activeRenderTasks = [];

  function loadPdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);

    if (!pdfJsPromise) {
      pdfJsPromise = new Promise((resolve, reject) => {
        const existingScript = document.querySelector(
          "script[data-mpd-pdfjs]"
        );

        if (existingScript) {
          existingScript.addEventListener("load", () => resolve(window.pdfjsLib));
          existingScript.addEventListener("error", reject);
          return;
        }

        const script = document.createElement("script");
        script.src =
          "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
        script.async = true;
        script.dataset.mpdPdfjs = "true";

        script.onload = () => {
          if (!window.pdfjsLib) {
            reject(new Error("PDF.js gagal dimuat."));
            return;
          }

          window.pdfjsLib.GlobalWorkerOptions.workerSrc =
            "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

          resolve(window.pdfjsLib);
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

    for (let pageNumber = 1; pageNumber <= activeDocument.numPages; pageNumber += 1) {
      const page = await activeDocument.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = availableWidth / baseViewport.width;
      const viewport = page.getViewport({ scale });
      const deviceScale = window.devicePixelRatio || 1;

      const pageWrapper = document.createElement("div");
      pageWrapper.className = "mpd-pdf-page";
      pageWrapper.style.width = `${Math.ceil(viewport.width)}px`;
      pageWrapper.style.maxWidth = "100%";
      pageWrapper.style.background = "#fff";
      pageWrapper.style.boxShadow = "0 1px 5px rgba(0,0,0,0.08)";
      pageWrapper.style.lineHeight = "0";

      const canvas = document.createElement("canvas");
      canvas.className = "mpd-pdf-canvas";
      canvas.setAttribute(
        "aria-label",
        `PDF Viewer, halaman ${pageNumber} dari ${activeDocument.numPages}`
      );
      canvas.width = Math.ceil(viewport.width * deviceScale);
      canvas.height = Math.ceil(viewport.height * deviceScale);
      canvas.style.display = "block";
      canvas.style.width = `${Math.ceil(viewport.width)}px`;
      canvas.style.height = `${Math.ceil(viewport.height)}px`;
      canvas.style.maxWidth = "100%";

      pageWrapper.appendChild(canvas);
      pagesContainer.appendChild(pageWrapper);

      const context = canvas.getContext("2d", { alpha: false });
      context.setTransform(deviceScale, 0, 0, deviceScale, 0, 0);

      const renderTask = page.render({
        canvasContext: context,
        viewport
      });

      activeRenderTasks.push(renderTask);

      try {
        await renderTask.promise;
      } catch (error) {
        if (error?.name !== "RenderingCancelledException") throw error;
      } finally {
        activeRenderTasks = activeRenderTasks.filter((task) => task !== renderTask);
      }
    }
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
      activeDocument = await pdfjsLib.getDocument({ url: pdf.pdf_url }).promise;
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
