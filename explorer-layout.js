(() => {
  for (const info of document.querySelectorAll(".select-info")) {
    const button = info.querySelector("button");
    const tip = info.querySelector(".select-tip");
    let pinned = false;

    function show(visible) {
      tip.hidden = !visible;
      button.setAttribute("aria-expanded", String(visible));
    }

    function dismiss() {
      pinned = false;
      show(false);
    }

    info.addEventListener("pointerenter", (event) => {
      if (event.pointerType !== "touch") show(true);
    });
    info.addEventListener("pointerleave", () => {
      if (!pinned && !button.matches(":focus-visible")) show(false);
    });
    button.addEventListener("focus", () => show(true));
    button.addEventListener("blur", () => {
      pinned = false;
      if (!info.matches(":hover")) show(false);
    });
    button.addEventListener("click", () => {
      pinned = !pinned;
      show(pinned);
    });
    document.addEventListener("pointerdown", (event) => {
      if (!tip.hidden && !info.contains(event.target)) dismiss();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !tip.hidden) {
        event.preventDefault();
        dismiss();
      }
    });
  }
})();
