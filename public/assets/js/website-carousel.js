/* Full-width website preview with previous/next controls, dots, arrow keys and swipe. */
(() => {
  "use strict";

  const root = document.querySelector("[data-website-carousel]");
  if (!root) return;

  const track = root.querySelector("[data-carousel-track]");
  const slides = [...root.querySelectorAll("[data-carousel-slide]")];
  const dots = [...root.querySelectorAll("[data-carousel-dot]")];
  const prev = root.querySelector("[data-carousel-prev]");
  const next = root.querySelector("[data-carousel-next]");
  const current = root.querySelector("[data-carousel-current]");
  const viewport = root.querySelector(".website-viewport");
  if (!track || slides.length < 2) return;

  let index = 0;
  let timer = null;
  let inView = !("IntersectionObserver" in window);
  const AUTOPLAY_MS = 10000;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const schedule = () => {
    clearTimeout(timer);
    if (reduceMotion || !inView || document.hidden) return;
    timer = setTimeout(() => {
      go(index + 1);
      schedule();
    }, AUTOPLAY_MS);
  };

  const render = () => {
    track.style.transform = `translate3d(-${index * 100}%, 0, 0)`;
    slides.forEach((slide, i) => {
      const active = i === index;
      slide.setAttribute("aria-hidden", String(!active));
      slide.inert = !active;
    });
    dots.forEach((dot, i) => dot.setAttribute("aria-current", String(i === index)));
    if (current) current.textContent = String(index + 1).padStart(2, "0");
  };

  const go = (nextIndex) => {
    index = (nextIndex + slides.length) % slides.length;
    render();
  };

  // A deliberate click/key/swipe restarts the 10s idle timer instead of fighting it.
  const userGo = (nextIndex) => {
    go(nextIndex);
    schedule();
  };

  prev?.addEventListener("click", () => userGo(index - 1));
  next?.addEventListener("click", () => userGo(index + 1));
  dots.forEach((dot, i) => dot.addEventListener("click", () => userGo(i)));

  root.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      userGo(index - 1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      userGo(index + 1);
    }
  });

  let startX = null;
  viewport?.addEventListener("pointerdown", (event) => { startX = event.clientX; });
  viewport?.addEventListener("pointerup", (event) => {
    if (startX === null) return;
    const delta = event.clientX - startX;
    startX = null;
    if (Math.abs(delta) > 50) userGo(index + (delta < 0 ? 1 : -1));
  });
  viewport?.addEventListener("pointercancel", () => { startX = null; });

  // Only run while the section is visible and the tab is in the foreground.
  document.addEventListener("visibilitychange", schedule);

  if ("IntersectionObserver" in window) {
    new IntersectionObserver(
      ([entry]) => {
        inView = entry.isIntersecting;
        schedule();
      },
      { threshold: 0.2 },
    ).observe(root);
  }

  render();
  schedule();
})();
