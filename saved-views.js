(() => {
  /* Baked Schwarzschild close-ups and Kerr views share one image panel. */
  const explorer = document.querySelector("#schwarzschild-explorer");
  const stills = document.querySelector("#saved-stills");
  const spinZero = document.querySelector("#schwarzschild-mode");
  const spins = [...document.querySelectorAll("[data-kerr-spin]")];
  const patch = document.querySelector("#saved-patch");
  const showHole = document.querySelector("#saved-hole");
  const image = document.querySelector("#saved-image");
  const background = document.querySelector("#kerr-unlensed");
  const download = document.querySelector("#saved-download");
  const status = document.querySelector("#saved-status");
  const backgroundOptions = document.querySelector("#saved-background");
  const backgroundButtons = [...backgroundOptions.querySelectorAll("button")];
  const imageVersion = stills.dataset.stillVersion;
  const imageQuery = imageVersion ? `?v=${imageVersion}` : "";

  const overviewImage = document.querySelector("#overview-image");
  const canvas = document.querySelector("#view");
  const overviewHole = document.querySelector("#show-black-hole");
  const overviewOctants = document.querySelector("#octants-mode");
  const overviewSky = document.querySelector("#sky-mode");
  const photoTools = document.querySelector("#source-tools");
  const mapDetails = document.querySelector("#map-details");
  const overviewStatus = document.querySelector("#status");
  const isLocalFile = location.protocol === "file:";
  let overviewBackground = "octants";
  let rendererModule;
  let requestPending = false;

  function renderOverview() {
    const isSky = overviewBackground === "sky";
    overviewOctants.setAttribute("aria-pressed", String(!isSky));
    overviewSky.setAttribute("aria-pressed", String(isSky));
    const filename = overviewHole.checked
      ? (isSky ? "sky" : "overview-r20")
      : overviewBackground + "-unlensed";
    overviewImage.src = `data/schwarzschild-octants/${filename}.png${imageQuery}`;
    overviewImage.alt = (isSky ? "Milky Way" : "Eight-color sky") +
      (overviewHole.checked ? " lensed by a Schwarzschild black hole" : " without lensing");
    document.querySelector("#capture-legend").hidden = !overviewHole.checked;
  }

  for (const [button, kind] of [[overviewOctants, "octants"], [overviewSky, "sky"]]) {
    button.addEventListener("click", event => {
      if (!canvas.hidden) return;
      event.stopImmediatePropagation();
      overviewBackground = kind;
      renderOverview();
    });
  }
  overviewHole.addEventListener("change", event => {
    if (!canvas.hidden) return;
    event.stopImmediatePropagation();
    renderOverview();
  });
  document.querySelector("#download-button").addEventListener("click", event => {
    if (!canvas.hidden) return;
    event.stopImmediatePropagation();
    const link = document.createElement("a");
    link.href = overviewImage.src;
    link.download = `schwarzschild-${overviewBackground}${overviewHole.checked ? "" : "-unlensed"}.png`;
    link.click();
  });

  async function requestLiveOverview(event) {
    if (!event.currentTarget.open || explorer.hidden || !canvas.hidden || requestPending) return;
    requestPending = true;
    overviewStatus.textContent = "Loading live controls…";
    overviewStatus.dataset.error = "false";
    try {
      rendererModule ||= import(new URL(explorer.dataset.renderer, document.baseURI).href);
      await rendererModule;
      await new Promise(resolve => {
        window.addEventListener("live-overview-started", resolve, { once: true });
        window.dispatchEvent(new Event("start-live-overview"));
      });
      if (canvas.hidden && overviewStatus.dataset.error !== "true") {
        throw new Error("Live renderer did not start");
      }
    } catch {
      rendererModule = undefined;
      overviewStatus.textContent = "Could not load live controls.";
      overviewStatus.dataset.error = "true";
    } finally {
      requestPending = false;
    }
  }

  if (isLocalFile) {
    document.querySelector("#local-photo-note").hidden = false;
    document.querySelector("#upload-button").hidden = true;
    photoTools.querySelector(".camera-controls").hidden = true;
    mapDetails.hidden = true;
  } else {
    photoTools.addEventListener("toggle", requestLiveOverview);
    mapDetails.addEventListener("toggle", requestLiveOverview);
  }

  let spin = "0";
  let schwarzschildPatch = "right-modest";
  let kerrPatch = "overview";
  let kerrHoleVisible = true;
  let sky = "octants";

  function savedImage() {
    const view = patch.value;
    if (spin === "0") {
      const unlensed = showHole.checked ? "" : "-unlensed";
      return `data/schwarzschild-closeups/${view}/${sky}${unlensed}.png`;
    }
    if (spin === "0.99") {
      const folder = view === "overview" ? "data/kerr-a099" : `data/kerr-a099/zooms/a099-${view}`;
      return `${folder}/octants.png`;
    }
    return `data/kerr-octants/${view}-r20.png`;
  }

  function renderStill() {
    const isSchwarzschild = spin === "0";
    const view = patch.selectedOptions[0].textContent;
    const name = `${isSchwarzschild ? "Schwarzschild" : "Kerr"} · a/M = ${spin}`;
    document.querySelector("#saved-heading").textContent = name;
    document.querySelector("#saved-view").textContent = view;
    const useKerrReference = !isSchwarzschild && !showHole.checked;
    image.hidden = useKerrReference;
    background.hidden = !useKerrReference;
    download.hidden = useKerrReference;
    status.textContent = "";
    backgroundOptions.hidden = !isSchwarzschild;
    for (const button of backgroundButtons) {
      button.setAttribute("aria-pressed", String(button.dataset.sky === sky));
    }
    if (useKerrReference) {
      background.dataset.view = patch.value.split("-")[0];
      return;
    }
    const path = savedImage() + imageQuery;
    const skyName = isSchwarzschild && sky === "sky" ? "Milky Way" : "eight-color sky";
    image.alt = `${name} · ${view} · ${skyName}${showHole.checked ? "" : " without lensing"}`;
    if (image.getAttribute("src") !== path) image.src = path;
    download.href = path;
  }

  function setMetricButtons(active) {
    spinZero.setAttribute("aria-pressed", String(active === spinZero));
    for (const button of spins) button.setAttribute("aria-pressed", String(active === button));
  }

  function openStill(selectedSpin, active) {
    spin = selectedSpin;
    const isSchwarzschild = spin === "0";
    setMetricButtons(active);
    patch.value = isSchwarzschild ? schwarzschildPatch : kerrPatch;
    showHole.checked = isSchwarzschild ? overviewHole.checked : kerrHoleVisible;
    if (isSchwarzschild) {
      sky = overviewSky.getAttribute("aria-pressed") === "true" ? "sky" : "octants";
    }
    explorer.hidden = true;
    mapDetails.hidden = true;
    stills.hidden = false;
    window.dispatchEvent(new Event("saved-view-opened"));
    renderStill();
  }

  function openOverview() {
    setMetricButtons(spinZero);
    explorer.hidden = false;
    mapDetails.hidden = isLocalFile;
    stills.hidden = true;
  }

  for (const button of spins) button.addEventListener("click", () => openStill(button.dataset.kerrSpin, button));
  document.querySelector("#refined-mode").addEventListener("click", () => openStill("0", spinZero));
  spinZero.addEventListener("click", openOverview);
  patch.addEventListener("change", () => {
    if (spin === "0") {
      if (patch.value === "overview") {
        openOverview();
        return;
      }
      schwarzschildPatch = patch.value;
    } else {
      kerrPatch = patch.value;
    }
    renderStill();
  });
  showHole.addEventListener("change", () => {
    if (spin !== "0") kerrHoleVisible = showHole.checked;
    renderStill();
  });
  for (const button of backgroundButtons) button.addEventListener("click", () => {
    sky = button.dataset.sky;
    renderStill();
  });
  image.addEventListener("error", () => { status.textContent = "Could not load this image."; });
})();
