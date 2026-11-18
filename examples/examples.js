"use strict";

function connectViews(kind, subject) {
  const select = document.querySelector(`#${kind}-angle`);
  const image = document.querySelector(`#${kind}-image`);
  // Carry the initial image revision to every selectable angle, so a cached
  // older render cannot reappear when the visitor changes camera position.
  const revision = image.src.split("?")[1];
  const cacheSuffix = revision ? `?${revision}` : "";
  const download = document.querySelector(`#${kind}-download`);
  const status = document.querySelector(`#${kind}-status`);
  let active = select.value;
  let generation = 0;

  select.addEventListener("change", () => {
    const option = select.selectedOptions[0];
    if (!option) return;
    const selected = option.value;
    const token = ++generation;
    const url = `media/${kind}-${selected}.png${cacheSuffix}`;
    status.textContent = "Loading view…";
    status.removeAttribute("data-error");
    const next = new Image();
    next.onload = () => {
      if (token !== generation) return;
      image.src = url;
      image.alt = `${subject} around a Schwarzschild black hole · ${option.textContent}`;
      download.href = url;
      active = selected;
      status.textContent = "";
    };
    next.onerror = () => {
      if (token !== generation) return;
      select.value = active;
      status.textContent = "Could not load that view. Select an angle to retry.";
      status.setAttribute("data-error", "true");
    };
    next.src = url;
  });
}

connectViews("disk", "Emitting disk");
connectViews("orbit", "Colored disk with source-direction arrows");
