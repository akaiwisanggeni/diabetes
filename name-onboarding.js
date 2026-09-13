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
  let activePage = 1;
  let activeRenderTask = null;

  function loadPdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);

    if (!pdfJsPromise) {
      pdfJsPromise = import(
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs"
      ).then((module) => {
        const pdfjsLib = module.default || module;
        pdfjsLib.GlobalWorkerOptions.workerSrc =
          "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs";
        return pdfjsLib;
      });
    }

    return pdfJsPromise;
  }

  function getViewerParts() {
    const viewer = document.querySelector("#pdf-viewer");
    if (!viewer) return null;

    let canvas = viewer.querySelector("#pdf-canvas");
    if (!canvas) {
      const iframe = viewer.querySelector("iframe");
      canvas = document.createElement("canvas");
      canvas.id = "pdf-canvas";
      canvas.setAttribute("aria-label", "PDF Viewer");
      canvas.setAttribute("data-pdf-canvas", "");
      if (iframe) iframe.replaceWith(canvas);
      else viewer.appendChild(canvas);
    }

    const content = viewer.querySelector(".pdf-viewer-content");
    const title = viewer.querySelector("#pdf-viewer-title");

    return { viewer, canvas, content, title };
  }

  function setupPdfCanvas() {
    const parts = getViewerParts();
    if (!parts) return;

    const { canvas, content } = parts;
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "auto";
    canvas.style.maxWidth = "100%";
    canvas.style.background = "#fff";

    if (content) {
      content.style.overflow = "auto";
      content.style.textAlign = "center";
    }
  }

  async function renderPdfPage(pageNumber) {
    const parts = getViewerParts();
    if (!parts || !activeDocument) return;

    const { canvas, content } = parts;
    const page = await activeDocument.getPage(pageNumber);

    const baseViewport = page.getViewport({ scale: 1 });
    const availableWidth = Math.max(
      280,
      (content ? content.clientWidth : window.innerWidth) - 24
    );
    const scale = availableWidth / baseViewport.width;
    const viewport = page.getViewport({ scale });

    const deviceScale = window.devicePixelRatio || 1;
    canvas.width = Math.ceil(viewport.width * deviceScale);
    canvas.height = Math.ceil(viewport.height * deviceScale);
    canvas.style.width = `${Math.ceil(viewport.width)}px`;
    canvas.style.height = `${Math.ceil(viewport.height)}px`;

    const context = canvas.getContext("2d", { alpha: false });
    context.setTransform(deviceScale, 0, 0, deviceScale, 0, 0);

    if (activeRenderTask) {
      try {
        activeRenderTask.cancel();
      } catch (_) {}
    }

    activeRenderTask = page.render({
      canvasContext: context,
      viewport
    });

    try {
      await activeRenderTask.promise;
    } catch (error) {
      if (error?.name !== "RenderingCancelledException") throw error;
    } finally {
      activeRenderTask = null;
    }
  }

  async function customOpenPdfViewer(pdf) {
    const parts = getViewerParts();
    if (!parts) return;

    const { viewer, canvas, title } = parts;

    if (title) title.textContent = formatPdfTitle(pdf.title);

    viewer.style.display = "";
    document.body.classList.add("pdf-viewer-open");
    canvas.style.display = "block";
    canvas.setAttribute("aria-busy", "true");

    activePage = 1;

    try {
      const pdfjsLib = await loadPdfJs();
      activeDocument = await pdfjsLib.getDocument({ url: pdf.pdf_url }).promise;
      await renderPdfPage(activePage);
      canvas.setAttribute("aria-label", `PDF Viewer, halaman 1 dari ${activeDocument.numPages}`);
    } catch (error) {
      console.error("PDF.js viewer error:", error);
      const context = canvas.getContext("2d");
      canvas.width = 1;
      canvas.height = 1;
      if (context) context.clearRect(0, 0, 1, 1);
      setMessage("Materi PDF gagal dimuat. Coba lagi.");
    } finally {
      canvas.removeAttribute("aria-busy");
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
