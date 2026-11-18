"use strict";

/* One clock, one transport, and matching render timestamps for both views. */
const pair = document.querySelector("#disk-pair");
const goldVideo = document.querySelector("#gold-orbit-video");
const colorVideo = document.querySelector("#color-orbit-video");
const pairVideos = [goldVideo, colorVideo];
const pairPlay = document.querySelector("#pair-play");
const pairProgress = document.querySelector("#pair-progress");
const pairPosition = document.querySelector("#pair-position");
const pairStatus = document.querySelector("#pair-status");
const pairControls = document.querySelector("#pair-controls");
const pairFullscreen = document.querySelector("#pair-fullscreen");
const pairChapters = [...document.querySelectorAll("[data-pair-time]")];
let timeline;
let ready = false;
let desiredPlaying = false;
let buffering = false;
let seeking = false;
let preparingSeek = false;
let seekTarget = 0;
let seekRetries = 0;
let lastSeekAttempt = 0;
let scrubbing = false;
let resumeAfterScrub = false;

function pairMessage(text, error = false) {
  pairStatus.textContent = text;
  pairStatus.dataset.error = String(error);
}

function showPosition(time) {
  if (!timeline) return;
  const index = Math.min(timeline.angles_degrees.length-1, Math.max(0, Math.floor(time*timeline.config.fps)));
  const angle = timeline.angles_degrees[index];
  const cosine = Math.cos(angle*Math.PI/180);
  const side = Math.abs(cosine) < .015 ? "Edge-on" : cosine > 0 ? "Above" : "Below";
  pairPosition.textContent = `${angle.toFixed(1)}° · ${side}`;
  if (!scrubbing) pairProgress.value = String(time);
}

function setPairPlaying(value) {
  if (!ready) return;
  desiredPlaying = value;
  pairPlay.textContent = value ? "Pause both" : goldVideo.ended ? "Replay both" : "Play both";
  if (!value) {
    pairVideos.forEach(video => video.pause());
    return;
  }
  if (seeking || buffering) return;
  Promise.all(pairVideos.map(video => video.play())).catch(error => {
    if (!desiredPlaying || seeking || buffering || error.name === "AbortError") return;
    setPairPlaying(false);
    pairMessage("Playback could not start. Press Play both to retry.", true);
  });
}

function finishPairSeek() {
  if (!seeking || preparingSeek || !pairVideos.every(video => !video.seeking && video.readyState >= 2)) return;
  const offTarget = pairVideos.filter(video => Math.abs(video.currentTime-seekTarget) >= 1/timeline.config.fps);
  if (offTarget.length) {
    // A pending decoder seek can complete at an older playback position after
    // a rapid pause/chapter change. Once both decoders are idle, reapply the
    // latest target rather than waiting forever for another seeked event.
    if (performance.now()-lastSeekAttempt < 200) return;
    if (seekRetries >= 4) {
      seeking = false;
      buffering = false;
      setPairPlaying(false);
      pairMessage("The views could not align. Select a camera position to retry.", true);
      return;
    }
    seekRetries++;
    lastSeekAttempt = performance.now();
    offTarget.forEach(video => { video.currentTime = seekTarget; });
    return;
  }
  seeking = false;
  buffering = false;
  pairMessage("");
  showPosition(seekTarget);
  if (desiredPlaying) setPairPlaying(true);
}

function seekLoadedPair() {
  seekRetries = 0;
  lastSeekAttempt = performance.now();
  pairVideos.forEach(video => { video.currentTime = seekTarget; });
  pairMessage("Seeking both views…");
  finishPairSeek();
}

async function prepareSeek() {
  preparingSeek = true;
  pairMessage("Loading videos for seeking…");
  const localUrls = [];
  try {
    // Basic static servers sometimes ignore byte ranges. Download the pair
    // only when a requested seek cannot use the browser's native seek ranges.
    const files = await Promise.all(pairVideos.map(async video => {
      const response = await fetch(video.currentSrc);
      if (!response.ok) throw new Error("Could not load video");
      return response.blob();
    }));
    await Promise.all(pairVideos.map((video, index) => new Promise((resolve, reject) => {
      const listeners = new AbortController();
      const options = { signal: listeners.signal };
      video.addEventListener("loadedmetadata", () => { listeners.abort(); resolve(); }, options);
      video.addEventListener("error", () => { listeners.abort(); reject(new Error("Could not decode video")); }, options);
      const url = URL.createObjectURL(files[index]);
      localUrls.push(url);
      video.src = url;
    })));
    preparingSeek = false;
    seekLoadedPair();
  } catch {
    preparingSeek = false;
    seeking = false;
    setPairPlaying(false);
    if (localUrls.length) {
      for (const video of pairVideos) video.removeAttribute("src");
      for (const url of localUrls) URL.revokeObjectURL(url);
    }
    pairMessage("Could not prepare both videos for seeking. Select a camera position to retry.", true);
  }
}

function seekPair(time, resume = desiredPlaying) {
  if (!ready) return;
  seekTarget = Math.max(0, Math.min(time, timeline.duration-1/timeline.config.fps));
  seeking = true;
  desiredPlaying = resume;
  pairVideos.forEach(video => video.pause());
  pairPlay.textContent = resume ? "Pause both" : "Play both";
  showPosition(seekTarget);
  if (preparingSeek) return;
  const http = location.protocol === "https:" || location.protocol === "http:";
  const cantSeek = pairVideos.some(video =>
    !video.src.startsWith("blob:") && video.seekable.length > 0 &&
    seekTarget > video.seekable.end(video.seekable.length - 1));
  if (http && cantSeek) prepareSeek();
  else seekLoadedPair();
}

function initializePair() {
  if (ready || !timeline || !pairVideos.every(video => Number.isFinite(video.duration))) return;
  if (!pairVideos.every(video => Math.abs(video.duration-timeline.duration) < 1/timeline.config.fps)) {
    pairMessage("These movies have different timelines. Reload to get the matching pair.", true);
    return;
  }
  pairVideos.forEach(video => {
    video.pause();
    video.controls = false;
    // When the shared controls are ready, rewind both clips on the same seek.
    video.loop = false;
  });
  ready = true;
  pairControls.hidden = false;
  document.querySelector(".pair-chapters").hidden = false;
  pairPlay.disabled = false;
  pairProgress.disabled = false;
  pairProgress.max = String(timeline.duration);
  pairProgress.step = String(1/timeline.config.fps);
  pairChapters.forEach((button, index) => {
    button.disabled = false;
    button.dataset.pairTime = String(index*timeline.duration/4);
  });
  pairMessage("");
  showPosition(0);
}

pairPlay.addEventListener("click", () => {
  if (!desiredPlaying && (goldVideo.ended || goldVideo.currentTime >= timeline.duration-1/timeline.config.fps)) seekPair(0, true);
  else setPairPlaying(!desiredPlaying);
});
pairProgress.addEventListener("input", () => {
  if (!scrubbing) { resumeAfterScrub = desiredPlaying; scrubbing = true; }
  seekPair(Number(pairProgress.value), false);
});
pairProgress.addEventListener("change", () => {
  scrubbing = false;
  desiredPlaying = resumeAfterScrub;
  if (!seeking) setPairPlaying(desiredPlaying);
  else finishPairSeek();
});
pairChapters.forEach(button => button.addEventListener("click", () => seekPair(Number(button.dataset.pairTime))));

for (const video of pairVideos) {
  video.addEventListener("loadedmetadata", initializePair);
  video.addEventListener("seeked", finishPairSeek);
  video.addEventListener("canplay", () => {
    finishPairSeek();
    if (buffering && pairVideos.every(item => item.readyState >= 3)) {
      buffering = false;
      pairMessage("");
      if (desiredPlaying) setPairPlaying(true);
    }
  });
  video.addEventListener("waiting", () => {
    if (!ready || !desiredPlaying || seeking) return;
    buffering = true;
    pairVideos.forEach(item => item.pause());
    pairMessage("Buffering both views…");
  });
  video.addEventListener("pause", () => {
    if (ready && desiredPlaying && video.paused && !video.ended && !seeking && !buffering) setPairPlaying(false);
  });
  video.addEventListener("play", () => {
    if (ready && !desiredPlaying && !video.paused && !seeking && !buffering) setPairPlaying(true);
  });
  video.addEventListener("ratechange", () => {
    pairVideos.forEach(item => { if (item.playbackRate !== video.playbackRate) item.playbackRate = video.playbackRate; });
  });
  video.addEventListener("ended", () => {
    if (ready && desiredPlaying && !seeking && !scrubbing && video.ended) seekPair(0, true);
  });
  video.addEventListener("error", () => {
    if (ready) setPairPlaying(false);
    pairMessage("A disk movie could not load. Reload the page to retry.", true);
  });
}

function updatePairClock() {
  if (ready && seeking) finishPairSeek();
  if (ready && !seeking && !scrubbing) {
    if (desiredPlaying && !buffering && !goldVideo.paused && !colorVideo.seeking && Math.abs(goldVideo.currentTime-colorVideo.currentTime) > 1/timeline.config.fps) colorVideo.currentTime = goldVideo.currentTime;
    showPosition(goldVideo.currentTime);
  }
  requestAnimationFrame(updatePairClock);
}
requestAnimationFrame(updatePairClock);

pairFullscreen.hidden = !document.fullscreenEnabled;
pairFullscreen.addEventListener("click", async () => {
  try {
    if (document.fullscreenElement === pair) await document.exitFullscreen();
    else await pair.requestFullscreen();
  } catch { pairMessage("Fullscreen is unavailable in this browser.", true); }
});
document.addEventListener("fullscreenchange", () => { pairFullscreen.textContent = document.fullscreenElement === pair ? "Exit fullscreen" : "Fullscreen"; });
document.addEventListener("visibilitychange", () => { if (document.hidden) setPairPlaying(false); });
window.addEventListener("pagehide", () => setPairPlaying(false));

try {
  const data = JSON.parse(document.querySelector("#disk-timeline").textContent);
  if (data.format !== "synchronized-disk-pair-v1" ||
      !Number.isFinite(data.duration) || data.duration <= 0 ||
      !Number.isInteger(data.config?.fps) || data.config.fps <= 0 ||
      !Array.isArray(data.angles_degrees) || data.angles_degrees.length !== data.config.frames ||
      Math.abs(data.duration - data.config.frames / data.config.fps) > .001 ||
      !data.angles_degrees.every((angle, i, values) => Number.isFinite(angle) && angle >= 0 && angle < 360 && (i === 0 || angle > values[i - 1]))) {
    throw new Error("Invalid shared camera timeline");
  }
  timeline = data;
  initializePair();
} catch {
  pairMessage("Shared playback is unavailable. Use the controls on each video.", true);
}
