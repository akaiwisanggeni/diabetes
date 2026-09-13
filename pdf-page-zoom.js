/* MPD — PDF PAGE PINCH ZOOM
   Zoom only the PDF page being touched, not the whole document. */
(function () {
  "use strict";

  function init() {
    const viewer = document.querySelector("#pdf-viewer");
    if (!viewer) return;

    const content = viewer.querySelector(".pdf-viewer-content");
    if (!content || content.dataset.mpdPageZoomReady === "true") return;
    content.dataset.mpdPageZoomReady = "true";

    const resetAll = () => {
      content.querySelectorAll(".mpd-pdf-page").forEach((page) => {
        page.style.transform = "none";
        page.style.transformOrigin = "center top";
        page.style.willChange = "auto";
      });
    };

    resetAll();

    let activePage = null;
    let zoom = 1;
    let panX = 0;
    let panY = 0;
    let startDistance = 0;
    let startZoom = 1;
    let lastTouchX = 0;
    let lastTouchY = 0;
    let isPanning = false;

    const getDistance = (touches) => {
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      return Math.hypot(dx, dy);
    };

    const pageFromPoint = (x, y) => {
      const element = document.elementFromPoint(x, y);
      return element?.closest?.(".mpd-pdf-page") || null;
    };

    const resetZoom = () => {
      if (activePage) {
        activePage.style.transform = "none";
        activePage.style.transformOrigin = "center top";
        activePage.style.willChange = "auto";
      }
      activePage = null;
      zoom = 1;
      panX = 0;
      panY = 0;
      startDistance = 0;
      startZoom = 1;
      isPanning = false;
    };

    const clampPan = () => {
      if (!activePage || zoom <= 1) {
        panX = 0;
        panY = 0;
        return;
      }

      const width = activePage.offsetWidth;
      const height = activePage.offsetHeight;
      const maxX = Math.max(24, (width * zoom - content.clientWidth) / 2 + 24);
      const maxY = Math.max(24, height * zoom - content.clientHeight + 24);

      panX = Math.min(maxX, Math.max(-maxX, panX));
      panY = Math.min(maxY, Math.max(-maxY, panY));
    };

    const applyTransform = () => {
      if (!activePage) return;
      clampPan();
      activePage.style.transformOrigin = "center top";
      activePage.style.transform = `translate3d(${panX}px, ${panY}px, 0) scale(${zoom})`;
      activePage.style.willChange = zoom > 1 ? "transform" : "auto";
    };

    const onTouchStart = (event) => {
      if (event.touches.length === 2) {
        const midpointX = (event.touches[0].clientX + event.touches[1].clientX) / 2;
        const midpointY = (event.touches[0].clientY + event.touches[1].clientY) / 2;
        const page = pageFromPoint(midpointX, midpointY) || event.target?.closest?.(".mpd-pdf-page");

        if (!page) return;

        if (activePage && activePage !== page) resetZoom();
        activePage = page;
        startDistance = getDistance(event.touches);
        startZoom = zoom;
        isPanning = false;
        event.stopImmediatePropagation();
        return;
      }

      if (event.touches.length === 1 && zoom > 1 && activePage && activePage.isConnected) {
        lastTouchX = event.touches[0].clientX;
        lastTouchY = event.touches[0].clientY;
        isPanning = true;
      }
    };

    const onTouchMove = (event) => {
      if (event.touches.length === 2 && startDistance && activePage) {
        const distance = getDistance(event.touches);
        const scale = distance / startDistance;
        zoom = Math.min(3, Math.max(1, startZoom * scale));
        if (zoom === 1) {
          panX = 0;
          panY = 0;
        }
        applyTransform();
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }

      if (event.touches.length === 1 && isPanning && zoom > 1 && activePage) {
        const touch = event.touches[0];
        panX += touch.clientX - lastTouchX;
        panY += touch.clientY - lastTouchY;
        lastTouchX = touch.clientX;
        lastTouchY = touch.clientY;
        applyTransform();
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };

    const onTouchEnd = (event) => {
      if (event.touches.length >= 2) return;

      if (event.touches.length === 1 && zoom > 1 && activePage && activePage.isConnected) {
        lastTouchX = event.touches[0].clientX;
        lastTouchY = event.touches[0].clientY;
        isPanning = true;
        event.stopImmediatePropagation();
      } else {
        startDistance = 0;
        isPanning = false;
      }
    };

    content.addEventListener("touchstart", onTouchStart, { passive: true, capture: true });
    content.addEventListener("touchmove", onTouchMove, { passive: false, capture: true });
    content.addEventListener("touchend", onTouchEnd, { passive: true, capture: true });
    content.addEventListener("touchcancel", onTouchEnd, { passive: true, capture: true });
  }

  function watchViewer() {
    init();

    const viewer = document.querySelector("#pdf-viewer");
    if (!viewer || viewer.dataset.mpdPageZoomObserver === "true") return;
    viewer.dataset.mpdPageZoomObserver = "true";

    const observer = new MutationObserver(() => init());
    observer.observe(viewer, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", watchViewer, { once: true });
  } else {
    watchViewer();
  }
})();
