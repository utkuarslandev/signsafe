"""
SignSafe icon generator.
Produces all PNG icon sizes + SVG from the design system.

Colors (from design-system.md):
  bg:     #06060a  — page background
  red:    #ef3a3a  — brand / primary accent
  muted:  #5a5a6e  — for secondary/inactive states
"""

from PIL import Image, ImageDraw
import os, math

# --- Design system tokens ---
BG_COLOR      = (6, 6, 8, 255)      # #06060a
RED           = (239, 58, 58, 255)   # #ef3a3a
RED_FILL      = (239, 58, 58, 22)    # dim fill inside shield
MUTED         = (90, 90, 110, 255)   # #5a5a6e  (inactive state variant)

# Shield polygon in 128×128 space.
# Path: M64 20 L96 33 L96 62 C96 80 80 93 64 100 C48 93 32 80 32 62 L32 33 Z
# Bezier curves approximated with intermediate points.
SHIELD_128 = [
    (64,  20),   # top center (also where top dot sits)
    (96,  33),   # top right
    (96,  62),   # right, curve start
    (93,  75),   # right curve mid-upper
    (86,  85),   # right curve mid-lower
    (76,  94),   # right curve end
    (64, 100),   # bottom center
    (52,  94),   # left curve start
    (42,  85),   # left curve mid-lower
    (35,  75),   # left curve mid-upper
    (32,  62),   # left, curve end
    (32,  33),   # top left
]

def bezier_points(p0, p1, p2, p3, steps=8):
    """Return intermediate points along a cubic bezier (excludes endpoints)."""
    pts = []
    for i in range(1, steps):
        t = i / steps
        u = 1 - t
        x = u**3*p0[0] + 3*u**2*t*p1[0] + 3*u*t**2*p2[0] + t**3*p3[0]
        y = u**3*p0[1] + 3*u**2*t*p1[1] + 3*u*t**2*p2[1] + t**3*p3[1]
        pts.append((x, y))
    return pts

def build_shield_poly(size, steps=12):
    """Build smooth shield polygon scaled to `size`."""
    s = size / 128
    # Straight segments
    top_center  = (64*s,  20*s)
    top_right   = (96*s,  33*s)
    curve_r_start = (96*s, 62*s)
    bottom      = (64*s, 100*s)
    curve_l_end = (32*s,  62*s)
    top_left    = (32*s,  33*s)

    right_bez = bezier_points(
        (96*s, 62*s), (96*s, 80*s), (80*s, 93*s), (64*s, 100*s), steps
    )
    left_bez = bezier_points(
        (64*s, 100*s), (48*s, 93*s), (32*s, 80*s), (32*s, 62*s), steps
    )

    poly = (
        [top_center, top_right, curve_r_start]
        + right_bez
        + [bottom]
        + left_bez
        + [curve_l_end, top_left]
    )
    return poly

def draw_outline(draw, pts, color, width):
    """Draw polygon outline as lines (supports width properly)."""
    n = len(pts)
    for i in range(n):
        p1 = pts[i]
        p2 = pts[(i + 1) % n]
        draw.line([p1, p2], fill=color, width=width)

def render_icon(size, accent=RED, supersample=4):
    """
    Draw icon at `size` px. Uses 4× supersampling for antialiasing.
    accent: RGBA tuple for shield stroke + dot.
    """
    ds = size * supersample          # draw size
    s  = ds / 128
    # More bezier steps at larger draw sizes for smooth curves
    steps = max(16, ds // 8)

    img  = Image.new("RGBA", (ds, ds), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Rounded square background
    radius = round(28 * s)
    draw.rounded_rectangle([(0, 0), (ds-1, ds-1)], radius=radius, fill=BG_COLOR)

    # Shield fill (very dim)
    poly = build_shield_poly(ds, steps=steps)
    dim_fill = accent[:3] + (18,)
    draw.polygon(poly, fill=dim_fill)

    # Shield outline
    stroke = max(int(round(2 * s)), 2)
    draw.polygon(poly, outline=None)   # clear outline
    draw_outline(draw, poly, accent, stroke)

    # Top dot
    dot_r  = max(2.5 * s, 2)
    cx, cy = 64*s, 20*s
    draw.ellipse(
        [(cx - dot_r, cy - dot_r), (cx + dot_r, cy + dot_r)],
        fill=accent
    )

    # Downscale with LANCZOS
    return img.resize((size, size), Image.LANCZOS)


def write_svg():
    svg = """\
<svg width="128" height="128" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
  <!-- Background -->
  <rect width="128" height="128" rx="28" fill="#06060a"/>
  <!-- Shield dim fill -->
  <path d="M64 20 L96 33 L96 62 C96 80 80 93 64 100 C48 93 32 80 32 62 L32 33 Z"
    fill="#ef3a3a" fill-opacity="0.08"/>
  <!-- Shield outline -->
  <path d="M64 20 L96 33 L96 62 C96 80 80 93 64 100 C48 93 32 80 32 62 L32 33 Z"
    stroke="#ef3a3a" stroke-width="2" stroke-linejoin="round"/>
  <!-- Top dot -->
  <circle cx="64" cy="20" r="3.5" fill="#ef3a3a"/>
  <!-- Inner subtle ring around dot -->
  <circle cx="64" cy="20" r="5.5" fill="#ef3a3a" fill-opacity="0.15"/>
</svg>"""
    with open("icons/icon.svg", "w") as f:
        f.write(svg)
    print("  icons/icon.svg")


def write_favicon_ico(img16, img32):
    """Write a proper .ico containing both 16x16 and 32x32."""
    img32.save("icons/favicon.ico", format="ICO", sizes=[(16,16),(32,32)])
    print("  icons/favicon.ico")


# --- Generate ---
os.makedirs("icons", exist_ok=True)

print("Generating PNGs...")

# Extension icons (manifest references these)
for size in [16, 24, 32, 48, 128]:
    img = render_icon(size)
    path = f"icons/icon{size}.png"
    img.save(path, optimize=True)
    print(f"  {path}")

# Favicon PNG + ICO
fav16 = render_icon(16)
fav32 = render_icon(32)
fav16.save("icons/favicon-16.png", optimize=True)
fav32.save("icons/favicon-32.png", optimize=True)
write_favicon_ico(fav16, fav32)
print("  icons/favicon-16.png")
print("  icons/favicon-32.png")

# Apple Touch Icon (iOS home screen)
render_icon(180).save("icons/apple-touch-icon.png", optimize=True)
print("  icons/apple-touch-icon.png")

# Large icon for PWA manifest / Open Graph / web app
render_icon(512).save("icons/icon-512.png", optimize=True)
print("  icons/icon-512.png")

# SVG (web pages, inline use)
write_svg()

print("\nDone. Icon inventory:")
for f in sorted(os.listdir("icons")):
    if f != "generate_icons.py" and not f.endswith(".html"):
        size = os.path.getsize(f"icons/{f}")
        print(f"  icons/{f}  ({size:,} bytes)")
