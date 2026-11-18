(() => {
  /* Orthographic view of a schematic sky sphere. The rotation changes
   * the viewpoint, while the sky, black hole, and camera stay fixed. */
  const canvas = document.querySelector("#sky-orbit");
  const ctx = canvas.getContext("2d");
  const texture = document.createElement("canvas");
  const tex = texture.getContext("2d");

  // Same x/y/z sign order and sRGB colors as the SingleBh ray shader.
  const colors = [
    [59, 130, 246], [239, 68, 68], [250, 204, 21], [34, 197, 94],
    [151, 71, 255], [255, 139, 38], [255, 88, 171], [20, 210, 220],
  ];
  const initialYaw = -1.05;
  const initialPitch = 0.35;
  const cameraRadius = 20 / 38;
  let yaw = initialYaw;
  let pitch = initialPitch;
  let width, height, radius, front, rear, axis, depths;
  let pending = false;
  let drag;

  function resize() {
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    width = bounds.width;
    height = bounds.height;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    ctx.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);

    radius = Math.min(width, height) * 0.44;
    const size = Math.min(512, Math.max(2, Math.round(2 * radius * ratio)));
    texture.width = size;
    texture.height = size;
    front = tex.createImageData(size, size);
    rear = tex.createImageData(size, size);
    axis = Float64Array.from({ length: size }, (_, i) => (2 * (i + 0.5)) / size - 1);
    depths = new Float32Array(size * size);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const r2 = axis[x] ** 2 + axis[y] ** 2;
        depths[y * size + x] = Math.sqrt(Math.max(0, 1 - r2));
      }
    }
    scheduleDraw();
  }

  function paintSky() {
    const sinYaw = Math.sin(yaw);
    const cosYaw = Math.cos(yaw);
    const sinPitch = Math.sin(pitch);
    const cosPitch = Math.cos(pitch);
    const size = axis.length;
    for (let row = 0; row < size; row += 1) {
      const y = -axis[row];
      for (let col = 0; col < size; col += 1) {
        const pixel = row * size + col;
        const depth = depths[pixel];
        if (depth <= 0) continue;
        const x = axis[col];
        // Rotate the projected ray's front and rear sphere intersections
        // into world coordinates before looking up their octant colors.
        const sx = -sinYaw * x - sinPitch * cosYaw * y;
        const sy = cosYaw * x - sinPitch * sinYaw * y;
        const sz = cosPitch * y;
        const dx = depth * cosPitch * cosYaw;
        const dy = depth * cosPitch * sinYaw;
        const dz = depth * sinPitch;
        const i = pixel * 4;
        const a = colors[4 * (sx + dx >= 0) + 2 * (sy + dy >= 0) + (sz + dz >= 0)];
        const b = colors[4 * (sx - dx >= 0) + 2 * (sy - dy >= 0) + (sz - dz >= 0)];
        front.data.set(a, i);
        rear.data.set(b, i);
        front.data[i + 3] = 88;
        rear.data[i + 3] = 43;
      }
    }
    return {
      cameraX: -sinYaw * cameraRadius,
      cameraY: -sinPitch * cosYaw * cameraRadius,
      cameraDepth: cosPitch * cosYaw,
    };
  }

  function drawLayer(layer, cx, cy) {
    tex.putImageData(layer, 0, 0);
    ctx.drawImage(texture, cx - radius, cy - radius, 2 * radius, 2 * radius);
  }

  function drawCamera(x, y, cx, cy) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.atan2(cy - y, cx - x));
    ctx.fillStyle = "#28384f";
    ctx.beginPath();
    ctx.moveTo(2, -3);
    ctx.lineTo(9, -6);
    ctx.lineTo(9, 6);
    ctx.lineTo(2, 3);
    ctx.fill();
    ctx.fillRect(-7, -5, 10, 10);
    ctx.restore();
  }

  function draw() {
    pending = false;
    if (!width || !height) return;
    const { cameraX, cameraY, cameraDepth } = paintSky();
    const cx = width / 2;
    const cy = height / 2;
    const x = cx + radius * cameraX;
    const y = cy - radius * cameraY;
    ctx.clearRect(0, 0, width, height);
    drawLayer(rear, cx, cy);
    if (cameraDepth < 0) drawCamera(x, y, cx, cy);
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(5, radius * 2 / 38), 0, 2 * Math.PI);
    ctx.fillStyle = "#141c27";
    ctx.fill();
    if (cameraDepth >= 0) drawCamera(x, y, cx, cy);
    drawLayer(front, cx, cy);
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
    ctx.strokeStyle = "#6b7d9359";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.font = "600 12px system-ui, sans-serif";
    ctx.fillStyle = "#26354a";
    ctx.textAlign = "right";
    ctx.fillText("Black hole", cx - 10, cy + 24);
    ctx.textAlign = "left";
    const labelX = Math.min(x + 11, width - ctx.measureText("Camera").width - 4);
    ctx.fillText("Camera", labelX, y - 12);
  }

  function scheduleDraw() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(draw);
  }

  function rotate(dx, dy) {
    yaw = (yaw - dx) % (2 * Math.PI);
    pitch = Math.max(-1.54, Math.min(1.54, pitch + dy));
    scheduleDraw();
  }

  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || drag) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (drag?.id !== event.pointerId) return;
    rotate((event.clientX - drag.x) * 0.009, (event.clientY - drag.y) * 0.009);
    drag.x = event.clientX;
    drag.y = event.clientY;
  });
  for (const event of ["lostpointercapture", "pointercancel", "pointerup"]) {
    canvas.addEventListener(event, (input) => {
      if (drag?.id === input.pointerId) drag = undefined;
    });
  }
  canvas.addEventListener("keydown", (event) => {
    const arrows = { ArrowLeft: [-.12, 0], ArrowRight: [.12, 0], ArrowUp: [0, -.12], ArrowDown: [0, .12] };
    if (!Object.hasOwn(arrows, event.key)) return;
    event.preventDefault();
    rotate(...arrows[event.key]);
  });
  document.querySelector("#sky-orbit-reset").addEventListener("click", () => {
    yaw = initialYaw;
    pitch = initialPitch;
    scheduleDraw();
  });
  new ResizeObserver(resize).observe(canvas);
})();
