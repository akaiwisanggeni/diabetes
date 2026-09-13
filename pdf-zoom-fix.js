/* =========================================================
   MPD — SCOPED PDF PINCH ZOOM
   Isolated from the app-wide stylesheet and PDF renderer.
   ========================================================= */

(function () {
  "use strict";

  let initializedContent = null;
  let cleanup = null;

  function setupPdfZoom() {
    const content = document.querySelector("#pdf-viewer .pdf-viewer-content");
    const pages = content?.querySelector(".mpd-pdf-pages");

    if (!content || !pages || initializedContent === content) return;

    if (cleanup) cleanup();

    initializedContent = content;

    let scale = 1;
    let panX = 0;
    let panY = 0;
    let pinchStartDistance = 0;
    let pinchStartScale = 1;
    let lastTouchX = 0;
    let lastTouchY = 0;

    const distance = (touches) => {
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      return Math.hypot(dx, dy);
    };

    const clampPan = () => {
      const maxX = Math.max(0, pages.scrollWidth * scale - content.clientWidth + 24);
      const maxY = Math.max(0, pages.scrollHeight * scale - content.clientHeight + 24);
      panX = Math.min(0, Math.max(-maxX, panX));
      panY = Math.min(0, Math.max(-maxY, panY));
    };

    const apply = () => {
      clampPan();
      pages.style.transformOrigin = "0 0";
      pages.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
      content.style.zoom = "1";
      content.style.touchAction = scale > 1 ? "none" : "pan-y pinch-zoom";
    };

    const reset = () => {
      scale = 1;
      panX = 0;
      panY = 0;
      pinchStartDistance = 0;
      pages.style.transform = "none";
      pages.style.transformOrigin = "0 0";
      content.style.zoom = "1";
      content.style.touchAction = "pan-y pinch-zoom";
    };

    const onTouchStart = (event) => {
      if (event.touches.length === 2) {
        pinchStartDistance = distance(event.touches);
        pinchStartScale = scale;
        return;
      }

      if (event.touches.length === 1 && scale > 1) {
        lastTouchX = event.touches[0].clientX;
        lastTouchY = event.touches[0].clientY;
      }
    };

    const onTouchMove = (event) => {
      if (event.touches.length === 2 && pinchStartDistance) {
        const ratio = distance(event.touches) / pinchStartDistance;
        scale = Math.min(3, Math.max(1, pinchStartScale * ratio));
        apply();
        event.preventDefault();
        return;
      }

      if (event.touches.length === 1 && scale > 1) {
        const touch = event.touches[0];
        panX += touch.clientX - lastTouchX;
        panY += touch.clientY - lastTouchY;
        lastTouchX = touch.clientX;
        lastTouchY = touch.clientY;
        apply();
        event.preventDefault();
      }
    };

    const onTouchEnd = (event) => {
      if (event.touches.length < 2) pinchStartDistance = 0;
      if (scale <= 1) reset();
    };

    const onTouchCancel = () => {
      pinchStartDistance = 0;
    };

    content.addEventListener("touchstart", onTouchStart, { passive: true });
    content.addEventListener("touchmove", onTouchMove, { passive: false });
    content.addEventListener("touchend", onTouchEnd, { passive: true });
    content.addEventListener("touchcancel", onTouchCancel, { passive: true });

    cleanup = () => {
      content.removeEventListener("touchstart", onTouchStart);
      content.removeEventListener("touchmove", onTouchMove);
      content.removeEventListener("touchend", onTouchEnd);
      content.removeEventListener("touchcancel", onTouchCancel);
      reset();
      initializedContent = null;
      cleanup = null;
    };
  }

  const observer = new MutationObserver(() => {
    const viewer = document.querySelector("#pdf-viewer");
    if (viewer?.style.display !== "none") setupPdfZoom();
  });

  function init() {
    const viewer = document.querySelector("#pdf-viewer");
    if (!viewer) return;
    observer.observe(viewer, { childList: true, subtree: true, attributes: true });
    setupPdfZoom();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
