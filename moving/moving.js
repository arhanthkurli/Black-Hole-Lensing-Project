"use strict";

const backgrounds = [...document.querySelectorAll("[data-moving-sky]")];
const films = [...document.querySelectorAll("[data-moving-film]")];
const saveFilm = document.querySelector("#moving-download");

for (const button of backgrounds) button.addEventListener("click", () => {
  const sky = button.dataset.movingSky;
  if (button.getAttribute("aria-pressed") === "true") return;
  for (const choice of backgrounds) choice.setAttribute("aria-pressed", String(choice === button));
  for (const film of films) {
    film.hidden = film.dataset.movingFilm !== sky;
    if (film.hidden) film.querySelector("video").pause();
    else saveFilm.href = film.querySelector("source").src;
  }
});
