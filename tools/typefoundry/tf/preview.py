"""Quick raster previews of raw polygons (development aid; the real specimens use the browser)."""
from PIL import Image, ImageDraw


def draw_glyphs(items, path, scale=0.12, cols=13, cell=1100, base=300, show_box=False):
    """items: list of (polys, advance)."""
    rows = (len(items) + cols - 1) // cols
    W, H = int(cols * cell * scale), int(rows * (1300) * scale)
    im = Image.new('L', (W, H), 255)
    d = ImageDraw.Draw(im)
    for i, (polys, adv) in enumerate(items):
        cx = (i % cols) * cell * scale
        cy = (i // cols) * 1300 * scale + (1000 + base) * scale * 0.85
        if show_box:
            d.line([(cx, cy), (cx + adv * scale, cy)], fill=200)
            d.line([(cx, cy), (cx, cy - 750 * scale)], fill=220)
            d.line([(cx + adv * scale, cy), (cx + adv * scale, cy - 750 * scale)], fill=220)
        # even-odd composite via mask per polygon with orientation
        mask = Image.new('L', im.size, 0)
        md = ImageDraw.Draw(mask)
        for p in polys:
            pts = [(cx + x * scale, cy - y * scale) for x, y in p]
            if len(pts) > 2:
                md.polygon(pts, fill=255, outline=None)
        # holes: draw with xor emulate: use area sign
        holes = Image.new('L', im.size, 0)
        hd = ImageDraw.Draw(holes)
        from .geom import area
        for p in polys:
            if area(p) < 0:
                pts = [(cx + x * scale, cy - y * scale) for x, y in p]
                hd.polygon(pts, fill=255)
        from PIL import ImageChops
        m = ImageChops.subtract(mask, holes)
        im.paste(0, mask=m)
    im.save(path)


def text_line(glyphs, text, path, scale=0.1, kern=None, pad=40, height=1300):
    """glyphs: name->(polys, adv); text as glyph name list."""
    from .geom import area
    from PIL import ImageChops
    x = pad / scale
    total = sum(glyphs[n][1] for n in text if n in glyphs) + 2 * pad / scale
    W = int(total * scale) + 1
    H = int(height * scale)
    im = Image.new('L', (W, H), 255)
    base = H - 300 * scale
    prev = None
    for n in text:
        if n not in glyphs:
            continue
        if kern and prev:
            x += kern.get((prev, n), 0)
        polys, adv = glyphs[n]
        mask = Image.new('L', im.size, 0)
        holes = Image.new('L', im.size, 0)
        md, hd = ImageDraw.Draw(mask), ImageDraw.Draw(holes)
        for p in polys:
            pts = [((x + px) * scale, base - py * scale) for px, py in p]
            (hd if area(p) < 0 else md).polygon(pts, fill=255)
        im.paste(0, mask=ImageChops.subtract(mask, holes))
        x += adv
        prev = n
    im.save(path)
