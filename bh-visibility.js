"use strict";

const blackHoleVisibility = document.querySelector("[data-bh-visibility]");
if (blackHoleVisibility) {
  blackHoleVisibility.addEventListener("change", () => {
    const visible = blackHoleVisibility.checked;
    document.body.classList.toggle("without-black-hole", !visible);
    if (!visible) {
      for (const video of document.querySelectorAll(".bh-scene video")) video.pause();
    }
  });
}
