const canvas = document.querySelector("#view");
const status = document.querySelector("#status");
const videoButton = document.querySelector("#video-mode");
const pictureButton = document.querySelector("#picture-mode");
const uploadButton = document.querySelector("#upload-button");
const downloadButton = document.querySelector("#download-button");
const uploadInput = document.querySelector("#image-upload");
const camera = document.querySelector("#camera");

let gl;
let sourceTexture;
let cameraStream;
let animationFrame;
let videoIsRunning = false;

const SOURCE_WIDTH = 640;
const SOURCE_HEIGHT = 480;

const vertexSource = `#version 300 es
in vec2 aPosition;
out vec2 vUv;

void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const fragmentSource = `#version 300 es
precision highp float;

uniform sampler2D uSource;
uniform sampler2D uWarp;
in vec2 vUv;
out vec4 outColor;

void main() {
  vec2 sourceUv = texture(uWarp, vUv).rg;

  if (sourceUv.x < 0.0 || sourceUv.y < 0.0) {
    outColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  outColor = texture(uSource, sourceUv);
}
`;

function makeShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader));
  }
  return shader;
}

function makeProgram(gl) {
  const program = gl.createProgram();
  gl.attachShader(program, makeShader(gl, gl.VERTEX_SHADER, vertexSource));
  gl.attachShader(program, makeShader(gl, gl.FRAGMENT_SHADER, fragmentSource));
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program));
  }
  return program;
}

function makeQuadrantImage() {
  const source = document.createElement("canvas");
  source.width = SOURCE_WIDTH;
  source.height = SOURCE_HEIGHT;
  const context = source.getContext("2d");
  const halfWidth = source.width / 2;
  const halfHeight = source.height / 2;

  context.fillStyle = "#ef4444";
  context.fillRect(0, 0, halfWidth, halfHeight);
  context.fillStyle = "#22c55e";
  context.fillRect(halfWidth, 0, halfWidth, halfHeight);
  context.fillStyle = "#3b82f6";
  context.fillRect(0, halfHeight, halfWidth, halfHeight);
  context.fillStyle = "#facc15";
  context.fillRect(halfWidth, halfHeight, halfWidth, halfHeight);

  // Offset grid lines give the radial warp something visible to bend. The
  // central quadrant boundaries alone remain straight under a radial map.
  context.lineWidth = 3;
  context.strokeStyle = "rgba(255, 255, 255, 0.55)";
  for (let x = 40; x < source.width; x += 40) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, source.height);
    context.stroke();
  }
  for (let y = 40; y < source.height; y += 40) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(source.width, y);
    context.stroke();
  }

  const markers = [
    [160, 120],
    [480, 120],
    [160, 360],
    [480, 360],
  ];
  context.fillStyle = "rgba(10, 12, 16, 0.8)";
  context.strokeStyle = "white";
  context.lineWidth = 5;
  for (const [x, y] of markers) {
    context.beginPath();
    context.arc(x, y, 25, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  }

  return source;
}

function validateMap(map) {
  if (map.format !== "uv-map-v1") {
    throw new Error(`Unsupported map format: ${map.format}`);
  }
  if (!Number.isInteger(map.width) || !Number.isInteger(map.height)) {
    throw new Error("Map width and height must be integers");
  }
  if (map.uv.length !== map.width * map.height * 2) {
    throw new Error("Map UV data has the wrong length");
  }
}

function createSourceTexture(gl) {
  const texture = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}

function drawSource(source) {
  if (gl.isContextLost()) {
    throw new Error("The WebGL context was lost; reload the page and try again");
  }

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    source,
  );

  const uploadError = gl.getError();
  if (uploadError !== gl.NO_ERROR) {
    throw new Error(`WebGL could not upload the image (error 0x${uploadError.toString(16)})`);
  }
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  const drawError = gl.getError();
  if (drawError !== gl.NO_ERROR) {
    throw new Error(`WebGL could not draw the image (error 0x${drawError.toString(16)})`);
  }
}

function uploadWarpTexture(gl, map) {
  const texture = gl.createTexture();
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RG32F,
    map.width,
    map.height,
    0,
    gl.RG,
    gl.FLOAT,
    new Float32Array(map.uv),
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const uploadError = gl.getError();
  if (uploadError !== gl.NO_ERROR) {
    throw new Error(`WebGL could not upload the warp map (error 0x${uploadError.toString(16)})`);
  }
}

async function openCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Camera access is not supported by this browser");
  }
  if (cameraStream) {
    return;
  }

  cameraStream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "user" },
    audio: false,
  });
  camera.srcObject = cameraStream;
  await camera.play();

  if (camera.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    await new Promise((resolve) => {
      camera.addEventListener("loadeddata", resolve, { once: true });
    });
  }
}

function closeCamera() {
  videoIsRunning = false;
  if (animationFrame !== undefined) {
    cancelAnimationFrame(animationFrame);
    animationFrame = undefined;
  }
  if (cameraStream) {
    for (const track of cameraStream.getTracks()) {
      track.stop();
    }
  }
  cameraStream = undefined;
  camera.srcObject = null;
  videoButton.textContent = "Start video";
}

function drawVideoFrame() {
  if (!videoIsRunning) {
    return;
  }
  try {
    if (camera.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      drawSource(camera);
    }
    animationFrame = requestAnimationFrame(drawVideoFrame);
  } catch (error) {
    closeCamera();
    status.textContent = `Video error: ${error.message}`;
  }
}

async function toggleVideo() {
  if (videoIsRunning) {
    closeCamera();
    status.textContent = "Video stopped; the last frame remains on screen";
    return;
  }

  try {
    videoButton.disabled = true;
    status.textContent = "Requesting camera access…";
    await openCamera();
    videoIsRunning = true;
    videoButton.textContent = "Stop video";
    status.textContent = "Live camera video";
    drawVideoFrame();
  } catch (error) {
    closeCamera();
    status.textContent = `Camera error: ${error.message}`;
  } finally {
    videoButton.disabled = false;
  }
}

async function takePicture() {
  try {
    pictureButton.disabled = true;
    status.textContent = "Requesting camera access…";
    await openCamera();
    drawSource(camera);
    closeCamera();
    status.textContent = "Camera picture captured";
  } catch (error) {
    closeCamera();
    status.textContent = `Camera error: ${error.message}`;
  } finally {
    pictureButton.disabled = false;
  }
}

function loadImageFile(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      resolve({ image, objectUrl });
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("The selected file could not be decoded as an image"));
    };
    image.src = objectUrl;
  });
}

function normalizeImage(image) {
  const normalized = document.createElement("canvas");
  normalized.width = SOURCE_WIDTH;
  normalized.height = SOURCE_HEIGHT;
  const context = normalized.getContext("2d");
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const scale = Math.min(
    normalized.width / sourceWidth,
    normalized.height / sourceHeight,
  );
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  const x = (normalized.width - width) / 2;
  const y = (normalized.height - height) / 2;

  context.fillStyle = "black";
  context.fillRect(0, 0, normalized.width, normalized.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, x, y, width, height);
  return normalized;
}

async function useUploadedImage() {
  const [file] = uploadInput.files;
  if (!file) {
    return;
  }

  let objectUrl;
  try {
    uploadButton.disabled = true;
    const loaded = await loadImageFile(file);
    objectUrl = loaded.objectUrl;
    closeCamera();
    drawSource(normalizeImage(loaded.image));
    status.textContent = `Uploaded image: ${file.name}`;
  } catch (error) {
    status.textContent = `Upload error: ${error.message}`;
  } finally {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
    }
    uploadButton.disabled = false;
    uploadInput.value = "";
  }
}

function downloadImage() {
  try {
    if (videoIsRunning && camera.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      drawSource(camera);
    } else {
      // The source and warp textures persist even if the browser discarded
      // the visible drawing buffer, so explicitly redraw before reading it.
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    gl.finish();

    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(
      0,
      0,
      canvas.width,
      canvas.height,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      pixels,
    );
    const readError = gl.getError();
    if (readError !== gl.NO_ERROR) {
      throw new Error(`WebGL could not read the image (error 0x${readError.toString(16)})`);
    }

    // WebGL rows start at the bottom; 2D canvas rows start at the top.
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = canvas.width;
    exportCanvas.height = canvas.height;
    const context = exportCanvas.getContext("2d");
    const imageData = context.createImageData(canvas.width, canvas.height);
    const rowBytes = canvas.width * 4;
    for (let y = 0; y < canvas.height; y += 1) {
      const sourceStart = y * rowBytes;
      const destinationStart = (canvas.height - y - 1) * rowBytes;
      imageData.data.set(
        pixels.subarray(sourceStart, sourceStart + rowBytes),
        destinationStart,
      );
    }
    context.putImageData(imageData, 0, 0);

    exportCanvas.toBlob((blob) => {
      if (!blob) {
        status.textContent = "Download error: could not create the PNG";
        return;
      }

      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = "lensed-image.png";
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
      status.textContent = "Downloaded lensed-image.png";
    }, "image/png");
  } catch (error) {
    status.textContent = `Download error: ${error.message}`;
  }
}

async function main() {
  const response = await fetch("warp-map.json");
  if (!response.ok) {
    throw new Error(`Could not load warp-map.json (${response.status})`);
  }
  const map = await response.json();
  validateMap(map);

  gl = canvas.getContext("webgl2");
  if (!gl) {
    throw new Error("This browser does not support WebGL 2");
  }

  canvas.width = map.width;
  canvas.height = map.height;
  gl.viewport(0, 0, map.width, map.height);

  const program = makeProgram(gl);
  gl.useProgram(program);

  const positions = new Float32Array([
    -1, -1,
     1, -1,
    -1,  1,
     1,  1,
  ]);
  const positionBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
  const positionLocation = gl.getAttribLocation(program, "aPosition");
  gl.enableVertexAttribArray(positionLocation);
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

  sourceTexture = createSourceTexture(gl);
  uploadWarpTexture(gl, map);
  gl.uniform1i(gl.getUniformLocation(program, "uSource"), 0);
  gl.uniform1i(gl.getUniformLocation(program, "uWarp"), 1);

  drawSource(makeQuadrantImage());
  videoButton.disabled = false;
  pictureButton.disabled = false;
  uploadButton.disabled = false;
  downloadButton.disabled = false;
  status.textContent = `Loaded ${map.format}: ${map.width} × ${map.height} pixels`;
}

videoButton.addEventListener("click", toggleVideo);
pictureButton.addEventListener("click", takePicture);
uploadButton.addEventListener("click", () => uploadInput.click());
uploadInput.addEventListener("change", useUploadedImage);
downloadButton.addEventListener("click", downloadImage);
window.addEventListener("pagehide", closeCamera);

main().catch((error) => {
  console.error(error);
  status.textContent = `Error: ${error.message}`;
});
