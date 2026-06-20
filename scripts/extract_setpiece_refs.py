from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
ORIGIN = ROOT / "origin.png"
CLEAN_BG = ROOT / "assets" / "layers" / "background_clean_ai.png"
OUT_DIR = ROOT / "assets" / "tripo" / "parts"
MATTE = (244, 226, 200)


@dataclass(frozen=True)
class Part:
    slug: str
    title: str
    box: tuple[int, int, int, int]
    source: str = "origin"
    note: str = ""


PARTS = [
    Part(
        "01_floor",
        "stone floor and low front step",
        (0, 1000, 864, 1536),
        source="clean",
        note="Use this first. It is based on the clean background plate because the original floor is covered by the cat and phone UI.",
    ),
    Part(
        "01_floor_origin_context",
        "original floor context",
        (0, 1024, 864, 1536),
        note="Original-image context only; includes the cat/cushion and should not be the primary Tripo input.",
    ),
    Part(
        "02_gate_wall",
        "left brick wall, green gate, pillar, lantern",
        (0, 575, 452, 1160),
        source="clean",
        note="Clean-plate crop avoids the main cat occluding the lower gate.",
    ),
    Part(
        "03_stall_front",
        "right street stall front, awning, counter, crates",
        (548, 610, 864, 1188),
        source="clean",
        note="Clean-plate crop avoids extra bird/cat details being interpreted as part of the stall.",
    ),
    Part(
        "04_pole_wires",
        "utility pole, streetlight, wires",
        (540, 0, 864, 690),
        source="clean",
        note="Clean-plate crop removes lockscreen UI from the sky.",
    ),
    Part(
        "05_tree_lantern",
        "left tree branch, wall lantern, plant/pillar cluster",
        (0, 260, 365, 930),
        source="clean",
        note="Clean-plate crop removes the lockscreen arrow and decorative cat statue from the input.",
    ),
    Part(
        "06_far_background_card",
        "distant tower, roofs, warm sky",
        (92, 120, 746, 720),
        source="clean",
        note="This should stay a 2D/flat background card unless we decide to make a very shallow relief.",
    ),
]


def load_sources() -> dict[str, Image.Image]:
    origin = Image.open(ORIGIN).convert("RGB")
    clean = Image.open(CLEAN_BG).convert("RGB") if CLEAN_BG.exists() else origin
    return {"origin": origin, "clean": clean}


def make_square_reference(crop: Image.Image, out_size: int = 1024) -> Image.Image:
    canvas = Image.new("RGB", (out_size, out_size), MATTE)
    max_size = int(out_size * 0.9)
    scale = min(max_size / crop.width, max_size / crop.height)
    resized = crop.resize(
        (max(1, int(crop.width * scale)), max(1, int(crop.height * scale))),
        Image.Resampling.LANCZOS,
    )
    x = (out_size - resized.width) // 2
    y = (out_size - resized.height) // 2
    canvas.paste(resized, (x, y))
    return canvas


def draw_overview(parts: list[Part], source: Image.Image) -> Image.Image:
    overview = source.copy()
    overlay = Image.new("RGBA", source.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    colors = [
        (60, 190, 255, 72),
        (255, 190, 60, 72),
        (90, 225, 130, 72),
        (255, 100, 130, 72),
        (170, 120, 255, 72),
        (255, 235, 95, 72),
        (80, 230, 210, 72),
    ]

    font_y_offset = 8
    for index, part in enumerate(parts):
        color = colors[index % len(colors)]
        x1, y1, x2, y2 = part.box
        draw.rectangle(part.box, outline=color[:3] + (220,), width=4, fill=color)
        draw.rectangle((x1, y1, min(x2, x1 + 235), y1 + 34), fill=(45, 28, 18, 180))
        draw.text((x1 + 8, y1 + font_y_offset), part.slug, fill=(255, 246, 220, 255))

    overview = Image.alpha_composite(overview.convert("RGBA"), overlay)
    return overview.convert("RGB")


def write_manifest(parts: list[Part]) -> None:
    lines = [
        "# Origin-derived set-piece references",
        "",
        "These images are cut from the lockscreen source art. Use the `*_tripo.png` files as the primary image inputs for Tripo3D, then use the short note only as guidance.",
        "",
        "Recommended experiment order:",
        "",
        "1. `01_floor_tripo.png` -> save generated GLB as `assets/models/01_floor.glb`.",
        "2. `02_gate_wall_tripo.png` -> save as `assets/models/02_gate_wall.glb`.",
        "3. `03_stall_front_tripo.png` -> save as `assets/models/03_stall_front.glb`.",
        "4. `04_pole_wires_tripo.png` -> save as `assets/models/04_pole_wires.glb`.",
        "5. `05_tree_lantern_tripo.png` -> save as `assets/models/05_tree_lantern.glb`.",
        "",
        "Use `part_overview.png` to see where each crop came from.",
        "",
    ]

    for part in parts:
        lines.extend(
            [
                f"## {part.slug}",
                "",
                f"- Object: {part.title}",
                f"- Source: `{part.source}`",
                f"- Crop box: `{part.box}`",
                f"- Tripo image: `{part.slug}_tripo.png`",
                f"- Reference crop: `{part.slug}_reference.png`",
            ],
        )
        if part.note:
            lines.append(f"- Note: {part.note}")
        lines.append("")

    (OUT_DIR / "README.md").write_text("\n".join(lines), encoding="utf-8")


def save_parts() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    sources = load_sources()

    for part in PARTS:
        source = sources[part.source]
        crop = source.crop(part.box)
        crop.save(OUT_DIR / f"{part.slug}_reference.png")
        make_square_reference(crop).save(OUT_DIR / f"{part.slug}_tripo.png", quality=96)

        if part.source != "origin":
            origin_crop = sources["origin"].crop(part.box)
            origin_crop.save(OUT_DIR / f"{part.slug}_origin_reference.png")

    overview = draw_overview(PARTS, sources["origin"])
    overview.save(OUT_DIR / "part_overview.png", quality=96)
    write_manifest(PARTS)


if __name__ == "__main__":
    save_parts()
