"use strict";

const binaryClips = [...document.querySelectorAll(".binary-cases video")];
const binaryPlayAll = document.querySelector("#binary-play-all");
const binaryPlaybackStatus = document.querySelector("#binary-playback-status");
const binaryShowHoles = document.querySelector("#binary-show-black-hole");
let binaryPlaybackRequest = 0;

function allBinaryClipsPlaying() {
  return binaryClips.every(clip => !clip.paused && !clip.ended && !clip.error);
}

function updateBinaryPlayButton() {
  binaryPlayAll.textContent = allBinaryClipsPlaying() ? "Stop all" : "Play all";
  binaryPlayAll.disabled = !binaryShowHoles.checked;
}

function stopBinaryClips() {
  binaryPlaybackRequest += 1;
  for (const clip of binaryClips) {
    clip.pause();
    clip.loop = false;
  }
  binaryPlaybackStatus.textContent = "";
  updateBinaryPlayButton();
}

binaryPlayAll.addEventListener("click", async () => {
  if (allBinaryClipsPlaying()) {
    stopBinaryClips();
    return;
  }

  const request = ++binaryPlaybackRequest;
  binaryPlaybackStatus.textContent = "";
  const starts = binaryClips.map(clip => {
    clip.loop = true;
    return clip.play();
  });
  updateBinaryPlayButton();

  const results = await Promise.allSettled(starts);
  if (request !== binaryPlaybackRequest) return;
  if (results.some(result => result.status === "rejected" && result.reason?.name !== "AbortError")) {
    stopBinaryClips();
    binaryPlaybackStatus.textContent = "A clip could not start. Select Play all to retry.";
  }
  updateBinaryPlayButton();
});

for (const clip of binaryClips) {
  clip.addEventListener("play", updateBinaryPlayButton);
  for (const event of ["pause", "ended", "error"]) {
    clip.addEventListener(event, () => {
      if (clip.paused || clip.ended || clip.error) clip.loop = false;
      updateBinaryPlayButton();
    });
  }
}

binaryShowHoles.addEventListener("change", () => {
  if (!binaryShowHoles.checked) stopBinaryClips();
  else updateBinaryPlayButton();
});
updateBinaryPlayButton();
binaryPlayAll.hidden = false;
