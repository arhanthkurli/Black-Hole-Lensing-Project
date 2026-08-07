# Web lensing lookup-map demo

This is a static WebGL 2 demo. It loads `warp-map.json`, uses each stored UV
pair to sample a four-color test grid, and draws invalid UVs in black. The
grid and four circular markers make radial distortion easy to see.
The source can be the default quadrants, live camera video, a single camera
picture, or an uploaded image.

The included generator uses the weak point-lens mapping
`beta = theta - theta_E^2 / theta`, with a manually masked central shadow. It
is a visual placeholder rather than a strong-field Schwarzschild ray trace.

Run it locally from this directory:

```bash
python3 generate_warp_map.py
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

Camera access works on `localhost` in modern browsers. The browser will ask
for permission the first time video or picture mode is used. **Start video**
updates the texture continuously; **Take camera picture** captures one frame
and releases the camera immediately. **Download image** saves the currently
distorted canvas—including the current live-video frame—as `lensed-image.png`.

## Map format

The map is a dense **output-to-source UV lookup table**. It does not contain
ray trajectories or image colors. For every pixel that WebGL will draw, it
contains the absolute coordinate in the source image that should be sampled.

This direction is important:

```text
output pixel (x, y) -> map entry (u, v) -> source image sample
```

It is not a forward map from source pixels to output pixels, and `(u,v)` is
not a displacement vector. Multiple output pixels may point to the same source
coordinate; that is how duplicated and higher-order lensed images can appear.

### `uv-map-v1` JSON object

`warp-map.json` has this top-level structure:

```json
{
  "format": "uv-map-v1",
  "width": 320,
  "height": 240,
  "coordinates": "normalized [0,1] UV, origin bottom-left",
  "invalid_uv": [-1.0, -1.0],
  "uv": [0.0, 0.0, 0.1, 0.0]
}
```

The fields are:

| Field | Required | Meaning |
| --- | --- | --- |
| `format` | Yes | Must be the version identifier `"uv-map-v1"`. |
| `width` | Yes | Positive integer number of output-map columns. |
| `height` | Yes | Positive integer number of output-map rows. |
| `coordinates` | Yes | Human-readable statement of the UV convention. For v1 it should be `"normalized [0,1] UV, origin bottom-left"`. |
| `invalid_uv` | Yes | Human-readable invalid sentinel. For v1 it must be `[-1.0, -1.0]`. |
| `uv` | Yes | Flat, interleaved array of `u,v` pairs with exactly `width * height * 2` finite numbers. |

The current loader validates `format`, dimensions, and array length. The
`coordinates` and `invalid_uv` fields document the v1 convention; the shader
does not dynamically change its behavior from their values.

### Pixel and array ordering

Rows are stored from bottom to top, matching WebGL texture coordinates. Pixels
inside each row are stored from left to right. For zero-based output pixel
coordinates `(x,y)`, the source coordinate is:

```text
pixel_index = y * width + x
u = uv[2 * pixel_index]
v = uv[2 * pixel_index + 1]
```

Here, `x = 0` is the left output column and `y = 0` is the bottom output row.
Map generators should normally construct a camera ray through the center of
each output pixel:

```text
screen_u = (x + 0.5) / width
screen_v = (y + 0.5) / height
```

For example, this 2 x 2 map stores the bottom row first. Its top-left output
pixel is invalid:

```json
{
  "format": "uv-map-v1",
  "width": 2,
  "height": 2,
  "coordinates": "normalized [0,1] UV, origin bottom-left",
  "invalid_uv": [-1.0, -1.0],
  "uv": [
    0.0, 0.0,  1.0, 0.0,
   -1.0,-1.0,  1.0, 1.0
  ]
}
```

Visually, the entries correspond to:

```text
top:     invalid    (1,1)
bottom:  (0,0)      (1,0)
```

Whitespace and line breaks do not matter to JSON. The generated production
file is minified to reduce its download size.

### Source UV coordinates

Valid source coordinates are normalized rather than measured in source-image
pixels:

```text
(0,0)       source bottom-left
(1,0)       source bottom-right
(0,1)       source top-left
(1,1)       source top-right
```

This lets one map work with the built-in background, uploaded photographs, and
camera frames even when those sources have different pixel dimensions.

The page vertically flips DOM images and video while uploading them to WebGL,
so this bottom-left convention still displays ordinary photographs upright.

The current source texture uses `CLAMP_TO_EDGE`. Positive UV values greater
than `1` therefore sample the nearest image edge. A negative `u` or `v` is
different: the current shader treats **any negative component** as invalid and
renders that output pixel black. A v1 generator should therefore use negative
coordinates only for invalid rays.

### Invalid and failed rays

Use `[-1.0, -1.0]` when a ray is known to be captured by the black hole. The
current v1 renderer also uses the same black result for every invalid entry.

A real GR generator should internally distinguish at least:

- captured/horizon-crossing rays;
- rays that reached the background;
- rays whose numerical integration failed;
- rays that stopped without reaching any terminal surface.

Only deliberately captured or deliberately background-less rays should become
the normal invalid sentinel. Solver failures should be reported while creating
the map instead of silently appearing as part of the black-hole shadow. A
future format can add a separate status channel if those distinctions need to
reach the browser.

### WebGL representation and precision

JavaScript parses the JSON numbers, converts `uv` to a `Float32Array`, and
uploads it as a WebGL 2 `RG32F` texture:

```text
R channel = source u
G channel = source v
```

The effective runtime precision is therefore 32-bit floating point even though
JavaScript initially parses JSON numbers as 64-bit numbers. The map texture
currently uses nearest-neighbor filtering so a map pixel is not blended with a
captured ray or with the other side of a sharp lensing discontinuity.

The canvas backing resolution is set to the map's `width` and `height`. CSS may
scale that canvas on screen, but a higher-resolution download requires a
higher-resolution map.

At 320 x 240, the current minified JSON map is about 1.36 MB. The same
interleaved data stored directly as two float32 values per pixel would occupy
614,400 bytes before a header. JSON is being used because it is easy to create
and inspect; a binary payload may be preferable for HD or 4K maps.

### Producing a real GR map

The renderer does not care how a UV pair was calculated. A Schwarzschild or
Kerr exporter should perform the following operation independently for every
output pixel:

```python
uv = []

for y in range(height):          # bottom row first
    for x in range(width):       # left to right
        ray = make_camera_ray(x, y, width, height)
        result = trace_null_geodesic_backwards(ray)

        if result.hit_horizon:
            uv.extend((-1.0, -1.0))
        else:
            source_u, source_v = project_onto_background(result)
            uv.extend((source_u, source_v))
```

The projection used by `project_onto_background` must be consistent with the
source image. Examples include intersection with a flat background plane or a
chosen projection of a distant celestial sphere. Camera position, orientation,
field of view, metric parameters, units, background projection, integration
tolerances, and terminal surfaces should be recorded alongside real maps for
reproducibility. They are not yet standardized fields in `uv-map-v1`.

Finally, serialize the data without `NaN` or infinity because those values are
not valid portable JSON numbers:

```python
payload = {
    "format": "uv-map-v1",
    "width": width,
    "height": height,
    "coordinates": "normalized [0,1] UV, origin bottom-left",
    "invalid_uv": [-1.0, -1.0],
    "uv": uv,
}
```

To replace the fake lens, keep this structure and generate the UV pairs with
the real geodesic calculation. No webpage or shader change is required as long
as the exporter follows this contract.
