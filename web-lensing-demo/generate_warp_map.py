#!/usr/bin/env python3
"""Generate a small, fake black-hole UV lookup map for the WebGL demo.

This is deliberately not a GR calculation. Replace ``source_uv`` with a real
ray tracer later; the JSON format and browser code can stay unchanged.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path


INVALID_UV = (-1.0, -1.0)


def source_uv(u: float, v: float, aspect: float) -> tuple[float, float]:
    """Return the source coordinate sampled by one output coordinate.

    The fake mapping uses the point-lens equation beta = theta - theta_E^2 /
    theta. It gives an obvious central ring/flip while keeping the generator
    short. Coordinates are normalized and use a bottom-left origin.
    """

    x = (u - 0.5) * aspect
    y = v - 0.5
    radius = math.hypot(x, y)

    shadow_radius = 0.055
    einstein_radius = 0.18

    if radius < shadow_radius:
        return INVALID_UV

    source_radius = radius - einstein_radius**2 / radius
    scale = source_radius / radius
    source_u = 0.5 + (x * scale) / aspect
    source_v = 0.5 + y * scale
    return source_u, source_v


def build_map(width: int, height: int) -> dict[str, object]:
    aspect = width / height
    uv: list[float] = []

    # Row zero is the bottom row, matching WebGL texture coordinates.
    for iy in range(height):
        v = (iy + 0.5) / height
        for ix in range(width):
            u = (ix + 0.5) / width
            source_u, source_v = source_uv(u, v, aspect)
            uv.extend((round(source_u, 6), round(source_v, 6)))

    return {
        "format": "uv-map-v1",
        "width": width,
        "height": height,
        "coordinates": "normalized [0,1] UV, origin bottom-left",
        "invalid_uv": list(INVALID_UV),
        "uv": uv,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--width", type=int, default=320)
    parser.add_argument("--height", type=int, default=240)
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).with_name("warp-map.json"),
    )
    args = parser.parse_args()

    if args.width <= 0 or args.height <= 0:
        parser.error("width and height must be positive")

    data = build_map(args.width, args.height)
    args.output.write_text(
        json.dumps(data, separators=(",", ":")), encoding="utf-8"
    )
    print(f"Wrote {args.output} ({args.width} x {args.height})")


if __name__ == "__main__":
    main()
