"""Turn a Style into a complete TrueType font (glyphs, spacing, kerning, composites, tables)."""
import math
import unicodedata
import numpy as np
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.feaLib.builder import addOpenTypeFeaturesFromString
from fontTools.agl import UV2AGL

from .style import Style, UPM, ASCENT, DESCENT
from .draw import G
from .geom import fit_contour, cubic_extrema_split
from .spacing import Spacer, profile
from .glyphs_basic import REG
from . import glyphs_more  # noqa: F401  (registers the rest)
from .glyphs_more import SPACING_ACCENTS

VERSION = '1.000'

MARKS = {0x300: 'grave', 0x301: 'acute', 0x302: 'circumflex', 0x303: 'tilde', 0x304: 'macron', 0x306: 'breve',
         0x307: 'dotaccent', 0x308: 'dieresis', 0x30A: 'ring', 0x30B: 'hungarumlaut', 0x30C: 'caron',
         0x327: 'cedilla', 0x328: 'ogonek', 0x326: 'commaaccent'}
BELOW = {'cedilla', 'ogonek', 'commaaccent'}
COMMA_BELOW = {0x122, 0x136, 0x137, 0x13B, 0x13C, 0x145, 0x146, 0x156, 0x157}
CARON_ALT = {0x10F, 0x13D, 0x13E, 0x165}

COVERAGE = (list(range(0x20, 0x7F)) + list(range(0xA0, 0x100)) + list(range(0x100, 0x180)) +
            [0x218, 0x219, 0x21A, 0x21B, 0x237, 0x2C6, 0x2C7, 0x2D8, 0x2D9, 0x2DA, 0x2DB, 0x2DC, 0x2DD,
             0x2013, 0x2014, 0x2018, 0x2019, 0x201A, 0x201C, 0x201D, 0x201E, 0x2022, 0x2026, 0x2039, 0x203A,
             0x2044, 0x20AC, 0x20B9, 0x2122, 0x2212])

KERN_LETTERS = [chr(c) for c in range(0x41, 0x5B)] + [chr(c) for c in range(0x61, 0x7B)]
KERN_EXTRA = ['period', 'comma', 'colon', 'semicolon', 'hyphen', 'quoteright', 'quotedblright', 'quotesingle', 'quotedbl',
              'quoteleft', 'quotedblleft', 'guillemotleft', 'guillemotright', 'parenleft', 'parenright', 'slash', 'ampersand',
              'AE', 'OE', 'oe', 'ae', 'germandbls', 'Oslash', 'oslash', 'Eth', 'Thorn', 'thorn', 'eth']


def gname(cp):
    return UV2AGL.get(cp, 'uni%04X' % cp)


NAME_OF = {}
for _n, (_fn, _u, _c) in REG.items():
    if _u is not None:
        NAME_OF[_u] = _n


class Drawn:
    __slots__ = ('name', 'polys', 'case', 'anchors', 'adv', 'lsb', 'rsb', 'mark', 'comp', 'shift', 'recentre')

    def __init__(self, name):
        self.name = name
        self.polys = []
        self.anchors = {}
        self.adv = 0
        self.mark = False
        self.comp = None
        self.shift = 0.0


def draw_all(P):
    out = {}
    for name, (fn, uni, case) in REG.items():
        g = G(P, name, 'uc' if case in ('uc', 'fig') else 'lc')
        g.case = case
        fn(g)
        d = Drawn(name)
        d.case = case
        d.mark = getattr(g, 'is_mark', False) or case == 'mark'
        d.comp = getattr(g, 'composite_of', None)
        if d.comp is None:
            polys = g.render()
            if getattr(g, 'rotate180', False) and polys:
                allp = np.vstack(polys)
                c = (allp.min(0) + allp.max(0)) / 2
                polys = [2 * c - p for p in polys]
            d.polys = polys
        d.anchors = dict(g.anchors)
        d.adv = g.adv
        d.recentre = getattr(g, 'recentre', False)
        out[name] = d
    return out


def space_all(P, D):
    sp = Spacer(P)
    digits = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']
    for d in D.values():
        if d.comp is not None:
            continue
        if d.name == 'space':
            continue
        if not d.polys:
            d.adv = d.adv or 0
            continue
        allx = np.vstack(d.polys)[:, 0]
        xmin, xmax = allx.min(), allx.max()
        if d.mark:
            d.shift = 0.0
            d.adv = 0
            continue
        lsb, rsb = sp.sidebearings(d.polys, d.case, d.name)
        xmin, xmax = sp.last_extent
        if d.recentre:
            m = (lsb + rsb) / 2
            lsb = rsb = m
        d.lsb, d.rsb = lsb, rsb
        d.shift = lsb - xmin
        d.adv = lsb + (xmax - xmin) + rsb
    # tabular figures
    widths = [np.ptp(np.vstack(D[n].polys)[:, 0]) for n in digits]
    fsb = sp.sb_uc * 0.62
    fadv = max(widths) + 2 * fsb
    for n in digits:
        d = D[n]
        allx = np.vstack(d.polys)[:, 0]
        xmin, xmax = allx.min(), allx.max()
        d.shift = (fadv - (xmax - xmin)) / 2 - xmin
        d.adv = fadv
        d.lsb = d.rsb = (fadv - (xmax - xmin)) / 2
    for d in D.values():
        if d.shift:
            d.polys = [p + np.array([d.shift, 0.0]) for p in d.polys]
            d.anchors = {k: (v + d.shift if k not in ('topy',) else v) for k, v in d.anchors.items()}
        if d.polys and not d.mark:
            allx = np.vstack(d.polys)
            d.anchors.setdefault('top', (allx[:, 0].min() + allx[:, 0].max()) / 2)
            d.anchors.setdefault('cedilla', (allx[:, 0].min() + allx[:, 0].max()) / 2)
            d.anchors.setdefault('bottom', (allx[:, 0].min() + allx[:, 0].max()) / 2)
            d.anchors.setdefault('ogonek', allx[:, 0].max() - P.st * 0.45)
            d.anchors.setdefault('caron', allx[:, 0].max() + P.st * 0.5)
    D['space'].adv = D['space'].adv
    return sp


def composites(P, D):
    """Returns dict glyphName -> (list of (component, dx, dy, scale or None), advance, base_for_kerning, cp)."""
    comps = {}
    X, C = P.xh, P.cap
    for cp in COVERAGE:
        if cp in NAME_OF:
            continue
        ch = chr(cp)
        name = gname(cp)
        if cp == 0xA0:
            comps[name] = ([], D['space'].adv, 'space', cp)
            continue
        if cp == 0xAD:
            continue  # mapped to hyphen in cmap
        if cp in SPACING_ACCENTS:
            kind = SPACING_ACCENTS[cp]
            m = D[kind + 'comb']
            ext = np.vstack(m.polys)[:, 0]
            w = ext.max() - ext.min()
            sb = D['period'].lsb * 0.9
            adv = w + 2 * sb
            comps[name] = ([(kind + 'comb', sb - ext.min(), 0, None)], adv, None, cp)
            continue
        dec = unicodedata.decomposition(ch).split()
        if not dec:
            continue
        if dec[0].startswith('<'):
            tag = dec[0]
            parts = [int(x, 16) for x in dec[1:]]
            if cp in (0x132, 0x133):  # IJ ij
                a, b = NAME_OF[parts[0]], ('dotlessj' if cp == 0x133 else NAME_OF[parts[1]])
                a = 'i' if cp == 0x133 else a
                bj = 'j' if cp == 0x133 else b
                comps[name] = ([(a, 0, 0, None), (bj, D[a].adv - D[bj].lsb * 0.4, 0, None)], D[a].adv + D[bj].adv - D[bj].lsb * 0.4, a, cp)
            elif cp in (0x13F, 0x140):  # L middle dot
                base = 'L' if cp == 0x13F else 'l'
                dot = D['periodcentered']
                if cp == 0x13F:
                    dx = D['L'].adv * 0.48 - dot.adv / 2
                    comps[name] = ([(base, 0, 0, None), ('periodcentered', dx, P.cap * 0.42 - P.xh * 0.52, None)], D['L'].adv, 'L', cp)
                else:
                    comps[name] = ([(base, 0, 0, None), ('periodcentered', D['l'].adv - dot.lsb * 0.5, 0, None)], D['l'].adv + dot.adv - dot.lsb * 0.5, 'l', cp)
            elif cp == 0x149:
                comps[name] = ([('quoteright', 0, 0, None), ('n', D['quoteright'].adv - D['n'].lsb * 0.5, 0, None)], D['quoteright'].adv + D['n'].adv - D['n'].lsb * 0.5, 'n', cp)
            elif tag == '<super>':
                src = NAME_OF[parts[0]]
                s = 0.6
                d = D[src]
                comps[name] = ([(src, d.adv * 0.08, C * 0.42, s)], d.adv * s + d.adv * 0.16, None, cp)
            elif tag == '<fraction>':
                a, b = NAME_OF[parts[0]], NAME_OF[parts[2]]
                s = 0.56
                da, db = D[a], D[b]
                fr = D['fraction']
                w1 = da.adv * s
                x = 0
                lst = [(a, x, C * 0.44, s)]
                x += w1 - fr.lsb * 0.3
                lst.append(('fraction', x, 0, None))
                x += fr.adv - fr.rsb * 0.3
                lst.append((b, x, 0, s))
                comps[name] = (lst, x + db.adv * s, None, cp)
            continue
        base_cp = int(dec[0], 16)
        mark_cp = int(dec[1], 16) if len(dec) > 1 else None
        if mark_cp not in MARKS or base_cp not in NAME_OF:
            continue
        base = NAME_OF[base_cp]
        kind = MARKS[mark_cp]
        upper = unicodedata.category(chr(base_cp)) == 'Lu'
        if cp in COMMA_BELOW:
            kind = 'commaturned' if cp == 0x123 else 'commaaccent'
        if cp in CARON_ALT:
            kind = 'caronalt'
        if base == 'i' and kind not in BELOW:
            base = 'dotlessi'
        if base == 'j' and kind not in BELOW:
            base = 'dotlessj'
        b = D[base]
        mark = kind + 'comb' + ('.case' if upper and kind not in BELOW else '')
        if kind in BELOW:
            key = {'cedilla': 'cedilla', 'ogonek': 'ogonek', 'commaaccent': 'cedilla'}[kind]
            dx = b.anchors.get(key)
            if kind == 'commaaccent':
                dx = b.anchors.get('bottom')
            dy = 0
        elif kind == 'caronalt':
            dx = b.anchors.get('caron')
            dy = 0
            if base == 't':
                dy = -(P.asc - P.xh) * 0.25
        else:
            dx = b.anchors.get('top')
            dy = (b.anchors['topy'] - X) if ('topy' in b.anchors and not upper) else 0
        comps[name] = ([(base, 0, 0, None), (mark, dx, dy, None)], b.adv, base, cp)
    return comps


def kerning(P, D, comps, sp):
    names = [n for n in KERN_LETTERS + KERN_EXTRA if n in D and D[n].polys]
    rows = {}
    for n in names:
        d = D[n]
        lw, rw = sp.side_rows(d.polys, d.adv, 0)
        rows[n] = {'lw': lw, 'rw': rw, 'lsb': d.lsb, 'rsb': d.rsb}
    punct = set(KERN_EXTRA[:14])
    pairs = {}
    for a in names:
        for b in names:
            if a in punct and b in punct:
                continue
            k = sp.kern(rows[a], rows[b])
            k = int(round(k / 5.0) * 5)
            if abs(k) >= 15:
                pairs[(a, b)] = k
    # classes: each kerned base glyph plus the composites built on it
    members = {n: [n] for n in names}
    for cname, (lst, adv, kbase, cp) in comps.items():
        if kbase in members and cname not in members[kbase]:
            members[kbase].append(cname)
    for extra, base in (('dotlessi', 'i'), ('dotlessj', 'j'), ('quoteleft', None)):
        if base and extra in D and extra not in members.get(base, []):
            members[base].append(extra)
    return pairs, members


def fea_for(pairs, members):
    lines = ['languagesystem DFLT dflt;', 'languagesystem latn dflt;']
    used_l = sorted(set(a for a, b in pairs))
    used_r = sorted(set(b for a, b in pairs))
    for n in used_l:
        lines.append('@kL_%s = [%s];' % (n, ' '.join(members[n])))
    for n in used_r:
        lines.append('@kR_%s = [%s];' % (n, ' '.join(members[n])))
    lines.append('feature kern {')
    for (a, b), k in sorted(pairs.items()):
        lines.append('  pos @kL_%s @kR_%s %d;' % (a, b, k))
    lines.append('} kern;')
    return '\n'.join(lines)


def shear(polys, P):
    if not P.slant:
        return polys
    t = math.tan(math.radians(P.slant))
    ax = P.xh / 2
    return [np.column_stack([p[:, 0] + (p[:, 1] - ax) * t, p[:, 1]]) for p in polys]


def tt_glyph(polys, err=1.0):
    pen = TTGlyphPen(None)
    qp = Cu2QuPen(pen, max_err=1.0, reverse_direction=True)
    for poly in polys:
        segs = fit_contour(poly, err=err)
        if not segs:
            continue
        out = []
        for s in segs:
            if s[0] == 'C':
                out.extend(cubic_extrema_split(s))
            else:
                out.append(s)
        p0 = out[0][1]
        qp.moveTo(tuple(int(round(v)) for v in p0))
        for s in out:
            if s[0] == 'L':
                q = tuple(int(round(v)) for v in s[2])
                qp.lineTo(q)
            else:
                c1, c2, p3 = [tuple(int(round(v)) for v in q) for q in s[2:]]
                qp.curveTo(c1, c2, p3)
        qp.closePath()
    return pen.glyph()


def build_font(fam, weight, params, outpath_ttf):
    """fam: dict with name, slug etc. weight: 'Regular' or 'Bold'."""
    P = Style(**params)
    D = draw_all(P)
    sp = space_all(P, D)
    comps = composites(P, D)
    pairs, members = kerning(P, D, comps, sp)

    order = ['.notdef'] + [n for n in D.keys() if n not in ('.notdef',)] + list(comps.keys())
    cmap = {}
    for n, (fn, uni, case) in REG.items():
        if uni is not None and uni in COVERAGE:
            cmap[uni] = n
    for n, (lst, adv, kb, cp) in comps.items():
        cmap[cp] = n
    cmap[0xAD] = 'hyphen'

    t = math.tan(math.radians(P.slant)) if P.slant else 0.0
    glyphs = {}
    metrics = {}
    # .notdef: a simple box
    nd = TTGlyphPen(None)
    w = 500
    for (x0, y0, x1, y1, rev) in ((60, 0, w - 60, P.cap, False), (60 + 50, 50, w - 110, P.cap - 50, True)):
        pts = [(x0, y0), (x0, y1), (x1, y1), (x1, y0)]
        if rev:
            pts = pts[::-1]
        nd.moveTo(pts[0])
        for p in pts[1:]:
            nd.lineTo(p)
        nd.closePath()
    glyphs['.notdef'] = nd.glyph()
    metrics['.notdef'] = (w, 60)
    for n, d in D.items():
        if d.comp is not None:
            continue
        polys = shear(d.polys, P)
        g = tt_glyph(polys)
        glyphs[n] = g
        xmin = int(round(min(p[:, 0].min() for p in polys))) if polys else 0
        metrics[n] = (int(round(d.adv)), xmin)
    # simple composites from REG (ordfeminine etc.)
    for n, d in D.items():
        if d.comp is None:
            continue
        lst = []
        adv = 0
        for (src, s, dx, dy) in d.comp:
            sd = D[src]
            if src == 'underscore_ord':
                lst.append((src, D['a'].lsb * 0.6, 0, None))
            else:
                lst.append((src, sd.adv * 0.04, P.cap * 0.38, s))
                adv = max(adv, sd.adv * s + sd.adv * 0.1)
        comps[n] = (lst, adv, None, REG[n][1])
        cmap[REG[n][1]] = n
    for n, (lst, adv, kb, cp) in comps.items():
        pen = TTGlyphPen(glyphs)
        if not lst:
            glyphs[n] = pen.glyph()
            metrics[n] = (int(round(adv)), 0)
            continue
        for (src, dx, dy, s) in lst:
            dx2 = dx + dy * t
            if s is None:
                pen.addComponent(src, (1, 0, 0, 1, int(round(dx2)), int(round(dy))))
            else:
                # scaled component: keep it slanted consistently by compensating the shear of the offset
                a = P.xh / 2
                pen.addComponent(src, (s, 0, 0, s, int(round(dx + (dy - a * (1 - s)) * t)), int(round(dy))))
        g = pen.glyph()
        glyphs[n] = g
        metrics[n] = (int(round(adv)), 0)
    # rotated punctuation (composites with 180 degree rotation)
    rot = {'exclamdown': ('exclam', 0xA1, P.xh), 'questiondown': ('question', 0xBF, P.xh),
           'quoteleft': ('quoteright', 0x2018, None), 'quotedblleft': ('quotedblright', 0x201C, None)}
    for n, (src, cp, top) in rot.items():
        d = D[src]
        ys = np.vstack(d.polys)[:, 1]
        xs = np.vstack(shear(d.polys, P))[:, 0]
        if top is None:
            dy = ys.min() + ys.max()
        else:
            dy = top + ys.min() + 0
        dx = d.adv
        pen = TTGlyphPen(glyphs)
        pen.addComponent(src, (-1, 0, 0, -1, int(round(dx + (dy - P.xh) * t)), int(round(dy))))
        glyphs[n] = pen.glyph()
        metrics[n] = (int(round(d.adv)), 0)
        cmap[cp] = n
        order.append(n)
    order = list(dict.fromkeys(order))
    order = [n for n in order if n in glyphs]

    fb = FontBuilder(UPM, isTTF=True)
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap(cmap)
    fb.setupGlyf(glyphs)
    glyf = fb.font['glyf']
    hm = {}
    for n in order:
        adv = metrics[n][0]
        g = glyf[n]
        g.recalcBounds(glyf)
        lsb = getattr(g, 'xMin', 0) if g.numberOfContours != 0 else 0
        hm[n] = (max(0, adv), lsb)
    fb.setupHorizontalMetrics(hm)
    fb.setupHorizontalHeader(ascent=ASCENT, descent=DESCENT, lineGap=0)
    family = fam['name']
    style = weight
    psname = (family.replace(' ', '') + '-' + style)
    fb.setupNameTable({
        'copyright': '© 2026 LocalEditor. All rights reserved.',
        'familyName': family,
        'styleName': style,
        'uniqueFontIdentifier': '%s;%s;LocalEditor' % (VERSION, psname),
        'fullName': family + ' ' + style,
        'version': 'Version ' + VERSION,
        'psName': psname,
        'manufacturer': 'LocalEditor',
        'designer': 'LocalEditor typefoundry (parametric)',
        'description': fam.get('description', ''),
        'licenseDescription': 'Bundled for use within LocalEditor designs and exports. All rights reserved pending the owner’s licence decision. See LICENSE.',
    })
    bold = style == 'Bold'
    fs = (1 << 5) if bold else (1 << 6)
    fs |= (1 << 7)  # USE_TYPO_METRICS
    fb.setupOS2(
        version=4, usWeightClass=700 if bold else 400, usWidthClass=5,
        fsType=0, achVendID='LOCE',
        sTypoAscender=ASCENT, sTypoDescender=DESCENT, sTypoLineGap=0,
        usWinAscent=1050, usWinDescent=350,
        sxHeight=int(P.xh), sCapHeight=int(P.cap), fsSelection=fs,
        ulUnicodeRange1=(1 << 0) | (1 << 1) | (1 << 2), ulCodePageRange1=(1 << 0) | (1 << 1),
    )
    fb.setupPost(italicAngle=-float(P.slant), underlinePosition=-120, underlineThickness=int(max(40, P.st * 0.55)))
    fb.font['head'].fontRevision = float(VERSION)
    fb.font['head'].macStyle = 1 if bold else 0
    fea = fea_for(pairs, members)
    addOpenTypeFeaturesFromString(fb.font, fea)
    fb.font['OS/2'].usMaxContext = 2
    fb.save(outpath_ttf)
    return {'pairs': len(pairs), 'glyphs': len(order), 'kern': pairs, 'P': P}
