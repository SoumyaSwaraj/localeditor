"""Punctuation, symbols, currency, accents and the letters that are not simple compositions."""
import math
from .geom import N
from .glyphs_basic import (REG, glyph, hw, legs_apex, apex_clip, S_shape, bowl_stem, arch, fig_w,
                           E_like, j_body)
from . import glyphs_basic as B


def mid(P):
    """Height of the maths axis and dashes."""
    return P.xh * 0.52


# ===================================================================== punctuation
@glyph('space', 0x20, 'sym')
def space(g):
    g.adv = g.P.V(0.50, 0) * 0.62 + g.P.track * 2


@glyph('period', 0x2E, 'sym')
def period(g):
    r = g.st * 0.66
    g.dot(r, r, r)


def comma_shape(g, x, y, r):
    """dot + tail; (x, y) is the dot centre."""
    P = g.P
    if P.dot == 'square':
        g.poly([(x - r * 0.9, y - r * 0.9), (x + r * 0.9, y - r * 0.9), (x + r * 0.9, y + r * 0.9), (x - r * 0.9, y + r * 0.9)])
        g.poly([(x + r * 0.9, y + r * 0.2), (x + r * 0.9, y - r * 0.9), (x - r * 0.4, y - r * 3.0), (x - r * 0.9, y - r * 2.8), (x - r * 0.1, y - r * 0.6)])
        return
    g.dot(x, y, r)
    g.stroke([N(x + r * 0.55, y + r * 0.2, 'v', 1.0), N(x + r * 0.2, y - r * 1.4, -115, 0.75), N(x - r * 0.8, y - r * 2.7, -130, 0.45)],
             c0='flat', c1='flat', fixed=r * 1.75)


@glyph('comma', 0x2C, 'sym')
def comma(g):
    r = g.st * 0.66
    comma_shape(g, r, r, r)


@glyph('colon', 0x3A, 'sym')
def colon(g):
    r = g.st * 0.66
    g.dot(r, r, r)
    g.dot(r, g.P.xh - r, r)


@glyph('semicolon', 0x3B, 'sym')
def semicolon(g):
    r = g.st * 0.66
    comma_shape(g, r, r, r)
    g.dot(r, g.P.xh - r, r)


@glyph('exclam', 0x21, 'sym')
def exclam(g):
    P, s = g.P, g.st
    C = P.cap
    r = s * 0.66
    g.stroke([N(r, C, 'v', 1.0), N(r, C * 0.30, 'v', 0.78)], c0='S', c1='S' if P.rounded else 'flat')
    g.dot(r, r, r)


@glyph('question', 0x3F, 'sym')
def question(g):
    P, s, h = g.P, g.st, g.hh
    C, o = P.cap, P.ov
    w = P.U(0.50, 1)
    r = s * 0.66
    xr = w - s / 2
    yt = C + o - h / 2
    xm = w * 0.5
    g.stroke([N(s * 0.5, C * 0.78, 75), N(xm, yt, 'h'), N(xr, C * 0.72, 'v'), N(xm + s * 0.1, C * 0.44, -120, 0.95), N(xm - s * 0.15, C * 0.28, 'v', 0.9)], c0='T', c1='S' if P.rounded else 'flat')
    g.dot(xm - s * 0.15, r, r)


@glyph('quotesingle', 0x27, 'sym')
def quotesingle(g):
    P, s = g.P, g.st
    C = P.cap
    g.stroke([N(s * 0.45, C + P.ov, 'v', 1.0), N(s * 0.45, C * 0.66, 'v', 0.7)], c0='S', c1='S' if P.rounded else 'flat', wmul=0.9)


@glyph('quotedbl', 0x22, 'sym')
def quotedbl(g):
    P, s = g.P, g.st
    C = P.cap
    for x in (s * 0.45, s * 1.6):
        g.stroke([N(x, C + P.ov, 'v', 1.0), N(x, C * 0.66, 'v', 0.7)], c0='S', c1='S' if P.rounded else 'flat', wmul=0.9)


@glyph('quoteright', 0x2019, 'sym')
def quoteright(g):
    r = g.st * 0.62
    comma_shape(g, r, g.P.cap - r * 0.9, r)


@glyph('quotedblright', 0x201D, 'sym')
def quotedblright(g):
    r = g.st * 0.62
    comma_shape(g, r, g.P.cap - r * 0.9, r)
    comma_shape(g, r * 3.4, g.P.cap - r * 0.9, r)


@glyph('quotesinglbase', 0x201A, 'sym')
def quotesinglbase(g):
    r = g.st * 0.66
    comma_shape(g, r, r, r)


@glyph('quotedblbase', 0x201E, 'sym')
def quotedblbase(g):
    r = g.st * 0.62
    comma_shape(g, r, r, r)
    comma_shape(g, r * 3.4, r, r)


@glyph('hyphen', 0x2D, 'sym')
def hyphen(g):
    P = g.P
    g.hbar(0, P.V(0.62, 0), mid(P), 'S', 'S', wmul=1.05)


@glyph('endash', 0x2013, 'sym')
def endash(g):
    g.hbar(0, 500 - g.P.st * 0.6, mid(g.P), 'S', 'S', wmul=1.0)


@glyph('emdash', 0x2014, 'sym')
def emdash(g):
    g.hbar(0, 1000 - g.P.st * 0.9, mid(g.P), 'S', 'S', wmul=1.0)


@glyph('underscore', 0x5F, 'sym')
def underscore(g):
    g.hbar(0, g.P.V(0.95, 0), -g.P.xh * 0.16, 'flat', 'flat')


def paren(g, left=True):
    P, s = g.P, g.st
    top, bot = P.asc + P.ov * 2, P.desc * 0.82
    w = P.V(0.42, 1)
    xo, xi = s * 0.55, w
    ym = (top + bot) / 2
    if left:
        g.stroke([N(xi, top, 62, 0.92, 0.8), N(xo, ym, 'v', 1.0, 0.8), N(xi, bot, 118, 0.92, 0.8)], c0='flat', c1='flat', wmul=0.95)
    else:
        g.stroke([N(xo - s * 0.05 + 0, top, 68), N(xi - s * 0.05 + (w - xi) + s * 0.0, ym, 'v'), N(xo - s * 0.05, bot, 112)], c0='flat', c1='flat', wmul=0.95)
    g.clip(bot - 1, top + 1)


@glyph('parenleft', 0x28, 'sym')
def parenleft(g):
    paren(g, True)


@glyph('parenright', 0x29, 'sym')
def parenright(g):
    P, s = g.P, g.st
    top, bot = P.asc + P.ov * 2, P.desc * 0.82
    w = P.V(0.42, 1)
    ym = (top + bot) / 2
    g.stroke([N(0, top, 118, 0.92, 0.8), N(w - s * 0.55, ym, 'v', 1.0, 0.8), N(0, bot, 62, 0.92, 0.8)], c0='flat', c1='flat', wmul=0.95)
    g.clip(bot - 1, top + 1)


def bracket(g, left=True):
    P, s, h = g.P, g.st, g.hh
    top, bot = P.asc + P.ov * 2, P.desc * 0.82
    w = P.V(0.40, 1)
    xs = s / 2 if left else w - s / 2
    g.vstem(xs, bot, top, 'flat', 'flat', wmul=0.95)
    x2 = w if left else 0
    g.hbar(min(xs, x2), max(xs, x2), top - h / 2, 'flat', 'flat')
    g.hbar(min(xs, x2), max(xs, x2), bot + h / 2, 'flat', 'flat')


@glyph('bracketleft', 0x5B, 'sym')
def bracketleft(g):
    bracket(g, True)


@glyph('bracketright', 0x5D, 'sym')
def bracketright(g):
    bracket(g, False)


def brace(g, left=True):
    P, s = g.P, g.st
    top, bot = P.asc + P.ov * 2, P.desc * 0.82
    w = P.V(0.46, 1)
    ym = (top + bot) / 2
    sg = 1 if left else -1
    x0 = 0 if left else w
    xi = w if left else 0
    xc = x0 + sg * w * 0.52
    k = 0.9
    g.stroke([N(xi, top - g.hh * 0.45, 'h'), N(xc, top - w * 0.4, 'v'), N(xc, ym + w * 0.35, 'v'), N(x0 + sg * s * 0.2, ym, 'h')], c0='flat', c1='flat', wmul=0.9)
    g.stroke([N(xi, bot + g.hh * 0.45, 'h'), N(xc, bot + w * 0.4, 'v'), N(xc, ym - w * 0.35, 'v'), N(x0 + sg * s * 0.2, ym, 'h')], c0='flat', c1='flat', wmul=0.9)


@glyph('braceleft', 0x7B, 'sym')
def braceleft(g):
    brace(g, True)


@glyph('braceright', 0x7D, 'sym')
def braceright(g):
    brace(g, False)


@glyph('slash', 0x2F, 'sym')
def slash(g):
    P = g.P
    top, bot = P.cap + P.ov * 3, P.desc * 0.6
    w = P.V(0.62, 1)
    g.line(0, bot, w, top, 'B', 'B', 'main', 0.9)
    g.clip(bot, top)


@glyph('backslash', 0x5C, 'sym')
def backslash(g):
    P = g.P
    top, bot = P.cap + P.ov * 3, P.desc * 0.6
    w = P.V(0.62, 1)
    g.line(0, top, w, bot, 'B', 'B', 'main', 0.9)
    g.clip(bot, top)


@glyph('fraction', 0x2044, 'sym')
def fraction(g):
    P = g.P
    w = P.V(0.5, 1)
    g.line(0, 0, w, P.cap, 'B', 'B', 'thin', 0.8)
    g.clip(0, P.cap)


@glyph('bar', 0x7C, 'sym')
def bar(g):
    P = g.P
    g.vstem(g.st * 0.45, P.desc * 0.82, P.asc + P.ov * 2, 'flat', 'flat', wmul=0.9)


@glyph('brokenbar', 0xA6, 'sym')
def brokenbar(g):
    P = g.P
    m = (P.asc + P.desc) / 2
    g.vstem(g.st * 0.45, P.desc * 0.82, m - 40, 'flat', 'flat', wmul=0.9)
    g.vstem(g.st * 0.45, m + 40, P.asc + P.ov * 2, 'flat', 'flat', wmul=0.9)


@glyph('at', 0x40, 'sym')
def at(g):
    P, s, h = g.P, g.st, g.hh
    C = P.cap
    w = P.U(1.02, 2)
    sc = 0.78
    # inner a: bowl + stem
    bx0, bx1 = w * 0.30, w * 0.66
    by0, by1 = C * 0.18, C * 0.68
    g.bowl(bx0, bx1, by0, by1, wl=0.85, wr=0.85, wt=0.85, wb=0.85)
    xs = bx1 - s * 0.85 / 2
    top = C * 0.95
    bot = P.desc * 0.55
    xl = s * 0.9 / 2
    cx = w * 0.5
    g.stroke([N(xs, by1, 'v', 0.85), N(xs, by0 + s * 0.4, 'v', 0.85), N(xs + w * 0.1, by0 - h * 0.1, 'h', 0.8), N(w - s * 0.45, (top + bot) / 2 + C * 0.1, 'v', 0.85),
              N(cx, top, 'h', 0.85), N(xl, (top + bot) / 2, 'v', 0.9), N(cx, bot, 'h', 0.85), N(w * 0.82, bot + C * 0.09, 25, 0.85)], c0='flat', c1='T')


@glyph('numbersign', 0x23, 'sym')
def numbersign(g):
    P = g.P
    C = P.cap
    w = P.U(0.66, 1)
    sl = w * 0.08
    for xx in (w * 0.32, w * 0.70):
        g.line(xx - sl, 0, xx + sl, C, 'B', 'B', 'main', 0.85)
    for yy in (C * 0.32, C * 0.66):
        g.hbar(w * 0.04, w * 0.98, yy, 'flat', 'flat', wmul=0.9)
    g.clip(0, C)


@glyph('percent', 0x25, 'sym')
def percent(g):
    P, s = g.P, g.st
    C = P.cap
    w = P.U(0.92, 2)
    r = w * 0.27
    g.bowl(0, r * 1.62, C * 0.52, C + P.ov, wl=0.8, wr=0.8, wt=0.8, wb=0.8)
    g.bowl(w - r * 1.62, w, -P.ov, C * 0.48 - P.ov, wl=0.8, wr=0.8, wt=0.8, wb=0.8)
    g.line(w * 0.14, 0, w * 0.86, C, 'B', 'B', 'thin', 0.95)
    g.clip(0 - P.ov, C + P.ov)


@glyph('ampersand', 0x26, 'sym')
def ampersand(g):
    P, s, h = g.P, g.st, g.hh
    C, o = P.cap, P.ov
    w = P.U(0.80, 2)
    yt = C + o - h / 2
    yb = -o + h / 2
    # upper loop and diagonal into the tail
    g.stroke([N(w * 0.98, 0, None), N(w * 0.30, C * 0.56, 128), N(w * 0.20, C * 0.80, 'v'), N(w * 0.42, yt, 'h'), N(w * 0.62, C * 0.80, 'v', 0.95),
              N(w * 0.47, C * 0.58, -150, 0.95), N(s * 0.55, C * 0.26, 'v'), N(w * 0.40, yb, 'h'), N(w * 0.70, C * 0.15, 40), N(w * 0.84, C * 0.40, 70)],
             c0='B', c1='T')
    g.clip(0 - o, None)


@glyph('asterisk', 0x2A, 'sym')
def asterisk(g):
    P = g.P
    C = P.cap
    r = C * 0.2
    cx, cy = r * 1.05, C - r * 1.05
    for i in range(5):
        a = math.radians(90 + 72 * i)
        g.stroke([N(cx, cy, math.degrees(a)), N(cx + r * math.cos(a), cy + r * math.sin(a), math.degrees(a), 0.95)], c0='flat', c1='S', wmul=0.68)


def math_w(P):
    return P.V(0.98, 0) + 20


@glyph('plus', 0x2B, 'sym')
def plus(g):
    P = g.P
    w = math_w(P)
    m = mid(P)
    g.hbar(0, w, m, 'S', 'S', wmul=0.92)
    g.vstem(w / 2, m - w / 2, m + w / 2, 'S', 'S', wmul=0.92)


@glyph('minus', 0x2212, 'sym')
def minus(g):
    P = g.P
    g.hbar(0, math_w(P), mid(P), 'S', 'S', wmul=0.92)


@glyph('equal', 0x3D, 'sym')
def equal(g):
    P = g.P
    w = math_w(P)
    m = mid(P)
    d = max(P.xh * 0.2, g.hh * 1.25)
    g.hbar(0, w, m + d / 2 + 0, 'S', 'S', wmul=0.92)
    g.hbar(0, w, m - d / 2 - 0, 'S', 'S', wmul=0.92)


@glyph('plusminus', 0xB1, 'sym')
def plusminus(g):
    P = g.P
    w = math_w(P)
    m = mid(P) + 40
    g.hbar(0, w, m, 'S', 'S', wmul=0.92)
    g.vstem(w / 2, m - w * 0.42, m + w * 0.42, 'S', 'S', wmul=0.92)
    g.hbar(0, w, m - w * 0.42 - 70, 'S', 'S', wmul=0.92)


@glyph('multiply', 0xD7, 'sym')
def multiply(g):
    P = g.P
    w = math_w(P) * 0.78
    m = mid(P)
    g.line(0, m - w / 2, w, m + w / 2, 'S', 'S', 'main', 0.9)
    g.line(0, m + w / 2, w, m - w / 2, 'S', 'S', 'main', 0.9)


@glyph('divide', 0xF7, 'sym')
def divide(g):
    P = g.P
    w = math_w(P)
    m = mid(P)
    g.hbar(0, w, m, 'S', 'S', wmul=0.92)
    r = g.st * 0.55
    g.dot(w / 2, m + w * 0.36, r)
    g.dot(w / 2, m - w * 0.36, r)


@glyph('less', 0x3C, 'sym')
def less(g):
    P = g.P
    w = math_w(P)
    m = mid(P)
    g.stroke([N(w, m + w * 0.42, None), N(0, m, None), N(w, m - w * 0.42, None)], c0='S', c1='S', wmul=0.9)


@glyph('greater', 0x3E, 'sym')
def greater(g):
    P = g.P
    w = math_w(P)
    m = mid(P)
    g.stroke([N(0, m + w * 0.42, None), N(w, m, None), N(0, m - w * 0.42, None)], c0='S', c1='S', wmul=0.9)


@glyph('logicalnot', 0xAC, 'sym')
def logicalnot(g):
    P = g.P
    w = math_w(P)
    m = mid(P)
    g.stroke([N(0, m, 'h'), N(w - g.st * 0.45, m, None), N(w - g.st * 0.45, m - w * 0.35, 'v')], c0='S', c1='S', wmul=0.92)


@glyph('asciicircum', 0x5E, 'sym')
def asciicircum(g):
    P = g.P
    w = math_w(P) * 0.9
    g.stroke([N(0, P.cap * 0.45, None), N(w / 2, P.cap, None), N(w, P.cap * 0.45, None)], c0='S', c1='S', wmul=0.85)


@glyph('asciitilde', 0x7E, 'sym')
def asciitilde(g):
    P = g.P
    w = math_w(P)
    m = mid(P)
    a = w * 0.09
    g.stroke([N(0, m - a, 70), N(w * 0.27, m + a, 'h'), N(w * 0.73, m - a, 'h'), N(w, m + a, 70)], c0='S', c1='S', wmul=0.88)


@glyph('grave', 0x60, 'sym')
def grave_spacing(g):
    accent_draw(g, 'grave', g.P.xh, 1.0, 0)
    g.recentre = True


@glyph('bullet', 0x2022, 'sym')
def bullet(g):
    P = g.P
    r = max(g.st * 1.2, P.xh * 0.17)
    g.dot(r, mid(P), r)


@glyph('periodcentered', 0xB7, 'sym')
def periodcentered(g):
    r = g.st * 0.66
    g.dot(r, mid(g.P), r)


@glyph('ellipsis', 0x2026, 'sym')
def ellipsis(g):
    r = g.st * 0.66
    gap = max(r * 2.0, g.P.V(0.25, 0))
    for i in range(3):
        g.dot(r + i * (2 * r + gap), r, r)


def chevron(g, x0, x1, m, h, left=True, wmul=0.86):
    if left:
        g.stroke([N(x1, m + h, None), N(x0, m, None), N(x1, m - h, None)], c0='S', c1='S', wmul=wmul)
    else:
        g.stroke([N(x0, m + h, None), N(x1, m, None), N(x0, m - h, None)], c0='S', c1='S', wmul=wmul)


@glyph('guilsinglleft', 0x2039, 'sym')
def guilsinglleft(g):
    P = g.P
    w = P.V(0.42, 1)
    chevron(g, 0, w, mid(P), P.xh * 0.3, True)


@glyph('guilsinglright', 0x203A, 'sym')
def guilsinglright(g):
    P = g.P
    w = P.V(0.42, 1)
    chevron(g, 0, w, mid(P), P.xh * 0.3, False)


@glyph('guillemotleft', 0xAB, 'sym')
def guillemotleft(g):
    P = g.P
    w = P.V(0.42, 1)
    d = w * 0.62 + g.st * 0.6
    chevron(g, 0, w, mid(P), P.xh * 0.3, True)
    chevron(g, d, d + w, mid(P), P.xh * 0.3, True)


@glyph('guillemotright', 0xBB, 'sym')
def guillemotright(g):
    P = g.P
    w = P.V(0.42, 1)
    d = w * 0.62 + g.st * 0.6
    chevron(g, 0, w, mid(P), P.xh * 0.3, False)
    chevron(g, d, d + w, mid(P), P.xh * 0.3, False)


@glyph('degree', 0xB0, 'sym')
def degree(g):
    P = g.P
    r = P.cap * 0.17
    g.bowl(0, 2 * r + g.st * 0.3, P.cap - 2 * r - g.st * 0.3 + P.ov, P.cap + P.ov, wl=0.7, wr=0.7, wt=0.7, wb=0.7)


def ring_mark(g, cx, cy, R, wm=0.8):
    """Circle (used by copyright and registered)."""
    g.bowl(cx - R, cx + R, cy - R, cy + R, wl=wm, wr=wm, wt=wm, wb=wm)


@glyph('copyright', 0xA9, 'sym')
def copyright(g):
    P, s = g.P, g.st
    C = P.cap
    R = C * 0.52
    cx, cy = R, C * 0.5
    ring_mark(g, cx, cy, R, 0.62)
    rr = R * 0.5
    g.st = s * 0.66
    a = 40
    g.arc_open(cx - rr, cx + rr, cy - rr * 1.05, cy + rr * 1.05, a, -a, wl=1.0)
    g.st = s


@glyph('registered', 0xAE, 'sym')
def registered(g):
    P, s = g.P, g.st
    C = P.cap
    R = C * 0.52
    cx, cy = R, C * 0.5
    ring_mark(g, cx, cy, R, 0.62)
    g.st = s * 0.66
    h = g.hh
    x0 = cx - R * 0.36
    y0, y1 = cy - R * 0.5, cy + R * 0.5
    g.vstem(x0, y0, y1)
    ym = cy
    g.stroke([N(x0, y1 - h / 2, 'h'), N(cx + R * 0.0, y1 - h / 2, 'h'), N(cx + R * 0.32, (y1 + ym) / 2, 'v'), N(cx, ym, 'h'), N(x0, ym, 'h')], c0='none', c1='none')
    g.line(cx, ym, cx + R * 0.38, y0, 'flat', 'B')
    g.st = s


@glyph('trademark', 0x2122, 'sym')
def trademark(g):
    P, s = g.P, g.st
    C = P.cap
    sc = 0.42
    h = C * sc
    y0 = C - h
    g.st = s * 0.62
    hh = g.hh
    tw = h * 0.8
    g.hbar(0, tw, C - hh / 2)
    g.vstem(tw / 2, y0, C - hh / 2, 'S', 'none')
    x = tw + h * 0.2
    mw = h * 1.05
    xl, xr = x + g.st / 2, x + mw - g.st / 2
    g.vstem(xl, y0, C)
    g.vstem(xr, y0, C)
    g.stroke([N(xl, C, None), N((xl + xr) / 2, y0 + h * 0.25, None), N(xr, C, None)], c0='flat', c1='flat')
    g.clip(y0, C)
    g.st = s


@glyph('section', 0xA7, 'sym')
def section(g):
    P = g.P
    C = P.cap
    w = P.U(0.52, 1)
    S_shape(g, 0, w, C * 0.26, C + P.ov, top_frac=0.6)
    S_shape(g, 0, w, -P.ov - C * 0.12, C * 0.62, top_frac=0.45)


@glyph('paragraph', 0xB6, 'sym')
def paragraph(g):
    P, s, h = g.P, g.st, g.hh
    C = P.cap
    w = P.U(0.62, 2)
    x1, x2 = w * 0.55, w - s * 0.4
    g.vstem(x1, P.desc * 0.5, C, 'flat', 'flat', wmul=0.85)
    g.vstem(x2, P.desc * 0.5, C, 'flat', 'flat', wmul=0.85)
    g.hbar(x1, x2, C - h / 2)
    g.stroke([N(x1, C - h / 2, 'h'), N(w * 0.3, C - h / 2, 'h'), N(s * 0.5, C * 0.7, 'v', 1.1), N(w * 0.3, C * 0.42, 'h'), N(x1, C * 0.42, 'h')], c0='none', c1='none', wmul=1.2)
    g.poly([(x1, C * 0.42 - h * 0.6), (w * 0.3, C * 0.42 - h * 0.6), (w * 0.3, C - h), (x1, C - h)])
    g.bowl(s * 0.05, w * 0.62, C * 0.40, C, wl=1.0)


@glyph('mu', 0xB5)
def mu(g):
    P, s, h = g.P, g.st, g.hh
    X, o = P.xh, P.ov
    w = P.V(0.86)
    xl, xr = s / 2, w - s / 2
    g.stroke([N(xl, X, 'v'), N(xl, X * 0.44, 'v'), N((xl + xr) / 2 - s * 0.08, -o + h / 2, 'h'), N(xr - s * 0.06, X * 0.13 + h * 0.6, 'v', P.join)], c0='S', c1='none')
    g.vstem(xr, 0, X)
    g.vstem(xl, P.desc, X * 0.5, 'S', 'none')


@glyph('ordfeminine', 0xAA, 'sym')
def ordfeminine(g):
    g.composite_of = [('a', 0.62, 0, None), ('underscore_ord', 1, 0, None)]


@glyph('ordmasculine', 0xBA, 'sym')
def ordmasculine(g):
    g.composite_of = [('o', 0.62, 0, None), ('underscore_ord', 1, 0, None)]


@glyph('underscore_ord', None, 'sym')
def underscore_ord(g):
    P = g.P
    g.hbar(0, P.V(0.6, 0), P.cap * 0.36, 'flat', 'flat', wmul=0.7)


# ===================================================================== currency
@glyph('dollar', 0x24, 'fig')
def dollar(g):
    P, s = g.P, g.st
    C, o = P.cap, P.ov
    w = B.fig_w(P)
    S_shape(g, 0, w, C * 0.02 - o, C * 0.98 + o)
    x = w / 2
    if P.v['dollar'] == 'through':
        g.vstem(x, -C * 0.12, C * 1.12, 'flat', 'flat', wmul=0.72)
    else:
        g.vstem(x, -C * 0.12, C * 0.05, 'flat', 'none', wmul=0.75)
        g.vstem(x, C * 0.95, C * 1.12, 'none', 'flat', wmul=0.75)


@glyph('cent', 0xA2, 'fig')
def cent(g):
    P = g.P
    w = B.fig_w(P) * 0.9
    X = P.xh * 1.05
    a = 32 + P.aperture * 20
    g.arc_open(0, w, C0 := P.cap * 0.08, C0 + X, a, -a)
    g.vstem(w * 0.52, C0 - X * 0.2, C0 + X * 1.2, 'flat', 'flat', wmul=0.7)


@glyph('euro', 0x20AC, 'fig')
def euro(g):
    P, s, h = g.P, g.st, g.hh
    C, o = P.cap, P.ov
    w = B.fig_w(P) * 1.05
    a = 30 + P.aperture * 18
    g.arc_open(w * 0.16, w, -o, C + o, a, -a)
    g.hbar(0, w * 0.68, C * 0.58, 'flat', 'flat', wmul=0.85)
    g.hbar(0, w * 0.62, C * 0.40, 'flat', 'flat', wmul=0.85)


@glyph('sterling', 0xA3, 'fig')
def sterling(g):
    P, s, h = g.P, g.st, g.hh
    C, o = P.cap, P.ov
    w = B.fig_w(P)
    xs = w * 0.36
    g.stroke([N(w * 0.92, C * 0.76, 70), N(w * 0.62, C + o - h / 2, 'h'), N(xs, C * 0.72, 'v'), N(xs, C * 0.3, 'v'), N(w * 0.08, h / 2, -120)], c0='T', c1='none')
    g.hbar(w * 0.04, w, h / 2, 'flat', 'flat')
    g.hbar(w * 0.05, w * 0.72, C * 0.45, 'flat', 'flat', wmul=0.9)


@glyph('yen', 0xA5, 'fig')
def yen(g):
    P = g.P
    C = P.cap
    w = B.fig_w(P) * 1.1
    pen = P.pen(g.st)
    yj = C * 0.45
    wm = pen((w / 2, -(C - yj)), 'main')
    wt = P.thin(g.st)
    legs_apex(g, (w / 2, yj), (hw(wm, w / 2, C - yj), C), (w - hw(wt, w / 2, C - yj), C), 'main', 'thin')
    g.vstem(w / 2, 0, yj, 'S', 'none')
    g.hbar(w * 0.12, w * 0.88, C * 0.36, 'flat', 'flat', wmul=0.85)
    g.hbar(w * 0.12, w * 0.88, C * 0.18, 'flat', 'flat', wmul=0.85)
    g.clip(None, C)


@glyph('currency', 0xA4, 'fig')
def currency(g):
    P = g.P
    w = B.fig_w(P) * 0.9
    m = mid(P) + 30
    r = w * 0.32
    cx = w / 2
    g.bowl(cx - r, cx + r, m - r, m + r, wl=0.8, wr=0.8, wt=0.8, wb=0.8)
    for dx, dy in ((-1, 1), (1, 1), (-1, -1), (1, -1)):
        g.line(cx + dx * r * 0.7, m + dy * r * 0.7, cx + dx * w / 2, m + dy * w / 2, 'flat', 'S', 'main', 0.7)


@glyph('rupee', 0x20B9, 'fig')
def rupee(g):
    P, s, h = g.P, g.st, g.hh
    C = P.cap
    w = B.fig_w(P)
    g.hbar(0, w, C - h / 2, 'flat', 'flat', wmul=0.9)
    g.hbar(0, w, C * 0.72, 'flat', 'flat', wmul=0.9)
    yb = C * 0.46
    g.stroke([N(w * 0.08, C - h / 2, 'h'), N(w * 0.42, C - h / 2, 'h'), N(w * 0.72, (C + yb) / 2 + h * 0.2, 'v'), N(w * 0.42, yb, 'h'), N(w * 0.08, yb, 'h')], c0='none', c1='flat')
    g.line(w * 0.18, yb, w * 0.86, 0, 'flat', 'B', 'main')
    g.clip(0, C)


# ===================================================================== letters with extra parts
@glyph('Oslash', 0xD8, 'uc')
def Oslash(g):
    B.O(g)
    w = g.P.U(0.84)
    g.line(w * 0.06, -g.P.cap * 0.05, w * 0.94, g.P.cap * 1.05, 'flat', 'flat', 'thin')


@glyph('oslash', 0xF8)
def oslash(g):
    B.o_(g)
    w = g.P.V(0.90)
    g.line(w * 0.04, -g.P.xh * 0.06, w * 0.96, g.P.xh * 1.06, 'flat', 'flat', 'thin')


@glyph('Eth', 0xD0, 'uc')
def Eth(g):
    B.D(g)
    s = g.st
    g.hbar(-s * 0.35, s * 1.6, g.P.cap * 0.48, 'flat', 'flat', wmul=0.9)


@glyph('Dcroat', 0x110, 'uc')
def Dcroat(g):
    Eth(g)


@glyph('dcroat', 0x111)
def dcroat(g):
    P = g.P
    B.d(g)
    xs = P.V(0.92) - g.st / 2
    yb = P.xh + (P.asc - P.xh) * 0.45
    g.hbar(xs - g.st * 1.6, xs + g.st * 0.9, yb, 'flat', 'flat', wmul=0.85)


@glyph('eth', 0xF0)
def eth(g):
    P, s, h = g.P, g.st, g.hh
    X, o = P.xh, P.ov
    w = P.V(0.90)
    xl, xr, yb, yt = g.bowl(0, w, -o, X * 0.92 + o)
    top = P.asc
    g.stroke([N(xr, (yb + yt) / 2, 'v', 1.05), N(xr - s * 0.25, X * 0.95, 100), N(w * 0.25, top - h * 0.2, 140, 0.9)], c0='none', c1='T')
    g.line(w * 0.22, X * 1.05, w * 0.8, top - (top - X) * 0.1, 'flat', 'flat', 'thin', 0.85)


@glyph('Thorn', 0xDE, 'uc')
def Thorn(g):
    P, s, h = g.P, g.st, g.hh
    C = P.cap
    w = P.U(0.64)
    xs = s / 2
    g.vstem(xs, 0, C)
    y1, y0 = C * 0.80, C * 0.22
    xr = w - s * 1.05 / 2
    g.stroke([N(xs, y1 - h / 2, 'h'), N(w * 0.5, y1 - h / 2, 'h'), N(xr, (y0 + y1) / 2, 'v', 1.05), N(w * 0.5, y0 + h / 2, 'h'), N(xs, y0 + h / 2, 'h')], c0='none', c1='none')
    g.serif(xs, 0, 'foot')
    g.serif(xs, C, 'head')


@glyph('thorn', 0xFE)
def thorn(g):
    P = g.P
    w = P.V(0.92)
    bowl_stem(g, 0, w, P.xh, P.xh, right=False, desc=True)
    g.vstem(g.st / 2, P.xh * 0.8, P.asc)
    g.serif(g.st / 2, P.asc, 'flag')


@glyph('Hbar', 0x126, 'uc')
def Hbar(g):
    B.H(g)
    w = g.P.U(0.76)
    g.hbar(-g.st * 0.2, w + g.st * 0.2, g.P.cap * 0.78, 'flat', 'flat', wmul=0.85)


@glyph('hbar', 0x127)
def hbar(g):
    B.h_(g)
    P = g.P
    g.hbar(-g.st * 0.25, g.st * 2.0, P.xh + (P.asc - P.xh) * 0.5, 'flat', 'flat', wmul=0.85)


@glyph('Lslash', 0x141, 'uc')
def Lslash(g):
    B.L(g)
    P, s = g.P, g.st
    g.line(-s * 0.35, P.cap * 0.32, s * 1.55, P.cap * 0.58, 'flat', 'flat', 'main', 0.85)


@glyph('lslash', 0x142)
def lslash(g):
    B.l(g)
    P, s = g.P, g.st
    g.line(-s * 0.55, P.xh * 0.42, s * 1.55, P.xh * 0.78, 'flat', 'flat', 'main', 0.85)


@glyph('Tbar', 0x166, 'uc')
def Tbar(g):
    B.T(g)
    w = g.P.U(0.70, 1)
    g.hbar(w * 0.2, w * 0.8, g.P.cap * 0.45, 'flat', 'flat', wmul=0.85)


@glyph('tbar', 0x167)
def tbar(g):
    B.t(g)
    w = g.P.V(0.56, 1)
    g.hbar(0, w * 0.8, g.P.xh * 0.45, 'flat', 'flat', wmul=0.8)


@glyph('Eng', 0x14A, 'uc')
def Eng(g):
    P, s, h = g.P, g.st, g.hh
    C = P.cap
    w = P.U(0.76)
    xl, xr = s / 2, w - s / 2
    g.vstem(xl, 0, C)
    g.stroke([N(xr, P.desc * 0.0 + C * 0.05, 'v'), N(xr, C * 0.6, 'v'), N((xl + xr) / 2, C + P.ov - h / 2, 'h'), N(xl + s * 0.05, C * 0.8, 'v', P.join)], c0='flat', c1='none')
    g.stroke([N(xr, C * 0.1, 'v'), N(xr, P.desc * 0.25, 'v'), N(xr - s * 1.3, P.desc - P.ov + h / 2, 'h'), N(xr - s * 2.4, P.desc * 0.8, 160)], c0='flat', c1='T')


@glyph('eng', 0x14B)
def eng(g):
    P, s, h = g.P, g.st, g.hh
    w = P.V(0.86)
    xl, xr = s / 2, w - s / 2
    g.vstem(xl, 0, P.xh)
    arch(g, xl, xr, P.xh, base=P.xh * 0.3)
    g.stroke([N(xr, P.xh * 0.4, 'v'), N(xr, P.desc * 0.25, 'v'), N(xr - s * 1.2, P.desc - P.ov + h / 2, 'h'), N(xr - s * 2.3, P.desc * 0.8, 160)], c0='flat', c1='T')


@glyph('kgreenlandic', 0x138)
def kgreenlandic(g):
    P, s = g.P, g.st
    X = P.xh
    w = P.V(0.78)
    xs = s / 2
    g.vstem(xs, 0, X)
    pen = P.pen(s)
    wa = P.thin(s)
    xa = w - s * 0.15 - hw(wa, 1, 1.1)
    g.line(xs, X * 0.18, xa, X, 'none', 'B', 'thin')
    lx, ly = xs + (xa - xs) * 0.45, X * 0.18 + (X - X * 0.18) * 0.45
    wl = pen((w - lx, -ly), 'main')
    g.line(lx, ly, w - hw(wl, w - lx, ly), 0, 'flat', 'B', 'main')
    g.clip(0, X)


@glyph('longs', 0x17F)
def longs(g):
    P, s, h = g.P, g.st, g.hh
    X, A, o = P.xh, P.asc, P.ov
    w = P.V(0.50, 1)
    xs = s / 2 + w * 0.05
    g.stroke([N(xs, 0, 'v'), N(xs, A - (A - X) * 0.62, 'v'), N(xs + w * 0.38, A + o - h / 2, 'h'), N(w, A - (A - X) * 0.18, -20)], c0='S', c1='T')


@glyph('germandbls', 0xDF)
def germandbls(g):
    P, s, h = g.P, g.st, g.hh
    X, A, o = P.xh, P.asc, P.ov
    w = P.V(0.88)
    xs = s / 2
    xr = w - s / 2
    yt = A + o - h / 2
    ym = X * 0.98
    g.stroke([N(xs, 0, 'v'), N(xs, A * 0.7, 'v'), N(w * 0.45, yt, 'h'), N(xr - w * 0.08, (yt + ym) / 2 + 20, 'v', 0.95), N(w * 0.42, ym, 'h', 0.9)], c0='S', c1='flat')
    g.stroke([N(w * 0.42, ym, 'h', 0.9), N(xr, X * 0.48, 'v', 1.05), N(w * 0.5, -o + h / 2, 'h'), N(w * 0.26, X * 0.06, 155)], c0='flat', c1='T')


@glyph('AE', 0xC6, 'uc')
def AE(g):
    P, s, h = g.P, g.st, g.hh
    C = P.cap
    w = P.U(1.02, 2)
    xs = w * 0.50
    pen = P.pen(s)
    wl = pen((xs, C), 'main')
    g.line(hw(wl, xs, C), 0, xs + s * 0.3, C - h / 2, 'B', 'flat', 'main')
    g.vstem(xs, 0, C - h / 2, 'S', 'none')
    g.hbar(xs - s * 0.2, w, C - h / 2, 'flat', 'flat')
    g.hbar(xs, w * 0.94, C * 0.5 + h * 0.1, 'none', 'flat')
    g.hbar(xs, w, h / 2, 'none', 'flat')
    g.hbar(w * 0.22, xs, C * 0.30, 'flat', 'none')
    g.clip(0, C)


@glyph('ae', 0xE6)
def ae(g):
    P, s, h = g.P, g.st, g.hh
    X, o = P.xh, P.ov
    w = P.V(1.32, 3)
    xm = w * 0.48
    yt, yb = X + o - h / 2, -o + h / 2
    g.stroke([N(s * 0.55 + w * 0.02, X * 0.8, 62), N(xm * 0.5, yt, 'h'), N(xm, X * 0.62, 'v'), N(xm, X * 0.3, 'v')], c0='T', c1='none')
    yj = X * 0.54
    g.stroke([N(xm, yj, 'h', P.join), N(xm * 0.45, yj, 'h'), N(s * 0.52, X * 0.27, 'v'), N(xm * 0.45, yb, 'h'), N(xm, X * 0.22, 40, P.join)], c0='none', c1='none')
    # e part
    xl, xr = xm, w - s / 2
    cx = (xl + xr) / 2
    ybar = X * 0.5 + h * 0.1
    g.hbar(xl, xr + s * 0.5, ybar, 'none', 'flat')
    a = 28 + P.aperture * 22
    lx, ly, lt = g.ell_pt(cx, (yt + yb) / 2, (xr - xl) / 2, (yt - yb) / 2, -a)
    g.stroke([N(xr, ybar, 'v'), N(cx, yt, 'h'), N(xl, X * 0.55, 'v', 1.0), N(xl + s * 0.05, X * 0.35, 'v'), N(cx, yb, 'h'), N(lx, ly, lt)], c0='none', c1='T')


@glyph('OE', 0x152, 'uc')
def OE(g):
    P, s, h = g.P, g.st, g.hh
    C, o = P.cap, P.ov
    w = P.U(1.12, 3)
    xs = w * 0.55
    yt, yb = C - h / 2, h / 2
    xl = s * 1.05 / 2
    g.stroke([N(xs, yt, 'h'), N(xs * 0.5, yt + o, 'h'), N(xl, C / 2, 'v', 1.05), N(xs * 0.5, yb - o, 'h'), N(xs, yb, 'h')], c0='none', c1='none')
    g.vstem(xs, 0, C, 'S', 'S')
    g.hbar(xs, w, yt, 'none', 'flat')
    g.hbar(xs, w * 0.94, C * 0.5 + h * 0.1, 'none', 'flat')
    g.hbar(xs, w, yb, 'none', 'flat')


@glyph('oe', 0x153)
def oe(g):
    P, s, h = g.P, g.st, g.hh
    X, o = P.xh, P.ov
    w = P.V(1.40, 3)
    wo = w * 0.52
    g.bowl(0, wo, -o, X + o)
    xl, xr = wo - s * 0.55, w - s / 2
    yt, yb = X + o - h / 2, -o + h / 2
    cx = (xl + xr) / 2
    ybar = X * 0.5 + h * 0.1
    g.hbar(xl, xr + s * 0.5, ybar, 'none', 'flat')
    a = 28 + P.aperture * 22
    lx, ly, lt = g.ell_pt(cx, (yt + yb) / 2, (xr - xl) / 2, (yt - yb) / 2, -a)
    g.stroke([N(xr, ybar, 'v'), N(cx, yt, 'h'), N(xl, X * 0.5, 'v', 1.0), N(cx, yb, 'h'), N(lx, ly, lt)], c0='none', c1='T')


# ===================================================================== accents
ACCENTS = ['grave', 'acute', 'circumflex', 'caron', 'tilde', 'macron', 'breve', 'dotaccent', 'dieresis', 'ring',
           'hungarumlaut', 'cedilla', 'ogonek', 'commaaccent', 'commaturned', 'caronalt']


def accent_draw(g, kind, base, sc, x0=0):
    """Draw an accent centred on x0 with its bottom at `base`. sc = vertical scale (caps use < 1)."""
    P, s = g.P, g.st
    sw = s * 0.82
    gap = 55 * sc + (P.xh * 0.05)
    y0 = base + gap
    H = 150 * sc
    W = max(P.xh * 0.38, s * 2.0)
    if kind == 'acute':
        g.line(x0 - W * 0.22, y0, x0 + W * 0.30, y0 + H, 'flat', 'S', 'main', fixed=sw * 0.95, w0=0.7)
    elif kind == 'grave':
        g.line(x0 + W * 0.22, y0, x0 - W * 0.30, y0 + H, 'flat', 'S', 'main', fixed=sw * 0.95, w0=0.7)
    elif kind in ('circumflex', 'caron'):
        hh = H * 0.85
        if kind == 'circumflex':
            g.stroke([N(x0 - W * 0.48, y0, None), N(x0, y0 + hh, None), N(x0 + W * 0.48, y0, None)], c0='flat', c1='flat', fixed=sw * 0.85)
            g.clip(y0, y0 + hh + sw * 0.2)
        else:
            g.stroke([N(x0 - W * 0.48, y0 + hh, None), N(x0, y0, None), N(x0 + W * 0.48, y0 + hh, None)], c0='flat', c1='flat', fixed=sw * 0.85)
            g.clip(y0 - sw * 0.2, y0 + hh)
    elif kind == 'tilde':
        a = H * 0.22
        yc = y0 + H * 0.4
        g.stroke([N(x0 - W * 0.55, yc - a, 70), N(x0 - W * 0.22, yc + a, 'h'), N(x0 + W * 0.22, yc - a, 'h'), N(x0 + W * 0.55, yc + a, 70)], c0='flat', c1='flat', fixed=sw * 0.75)
    elif kind == 'macron':
        g.hbar(x0 - W * 0.5, x0 + W * 0.5, y0 + H * 0.3, 'flat', 'flat', role='main')
        g.strokes[-1].fixed = sw * 0.8
    elif kind == 'breve':
        g.stroke([N(x0 - W * 0.45, y0 + H * 0.75, 'v'), N(x0, y0 + sw * 0.35, 'h'), N(x0 + W * 0.45, y0 + H * 0.75, 'v')], c0='flat', c1='flat', fixed=sw * 0.75)
    elif kind == 'dotaccent':
        r = s * 0.62
        g.dot(x0, y0 + r, r)
    elif kind == 'dieresis':
        r = s * 0.62
        d = max(W * 0.36, r * 1.7)
        g.dot(x0 - d, y0 + r, r)
        g.dot(x0 + d, y0 + r, r)
    elif kind == 'ring':
        R = max(W * 0.30, s * 0.95)
        g.bowl(x0 - R, x0 + R, y0, y0 + 2 * R * 0.95, wl=0.62, wr=0.62, wt=0.62, wb=0.62)
    elif kind == 'hungarumlaut':
        for dx in (-W * 0.26, W * 0.26):
            g.line(x0 + dx - W * 0.16, y0, x0 + dx + W * 0.22, y0 + H, 'flat', 'S', 'main', fixed=sw * 0.85, w0=0.7)
    elif kind == 'cedilla':
        g.stroke([N(x0, 0, 'v'), N(x0 + 6, -P.xh * 0.08, 'v'), N(x0 + W * 0.3, -P.xh * 0.17, 'v'), N(x0 - W * 0.05, -P.xh * 0.30, 'h'), N(x0 - W * 0.38, -P.xh * 0.26, 160)],
                 c0='flat', c1='flat', fixed=sw * 0.7)
    elif kind == 'ogonek':
        g.stroke([N(x0, s * 0.3, -110), N(x0 - W * 0.3, -P.xh * 0.16, 'v'), N(x0, -P.xh * 0.30, 'h'), N(x0 + W * 0.3, -P.xh * 0.26, 30)],
                 c0='flat', c1='flat', fixed=sw * 0.7)
    elif kind == 'commaaccent':
        r = s * 0.5
        comma_from(g, x0, -P.xh * 0.12 - r, r)
    elif kind == 'commaturned':
        r = s * 0.5
        g.dot(x0, y0 + r * 2.2, r)
        g.stroke([N(x0 - r * 0.55, y0 + r * 2.0, 'v'), N(x0 - r * 0.1, y0 + r * 3.6, 65, 0.75), N(x0 + r * 0.7, y0 + r * 4.8, 50, 0.45)], c0='flat', c1='flat', fixed=r * 1.75)
    elif kind == 'caronalt':
        r = s * 0.5
        comma_from(g, x0, base - r * 1.3, r)


def comma_from(g, x, y, r):
    g.dot(x, y, r)
    g.stroke([N(x + r * 0.55, y + r * 0.2, 'v'), N(x + r * 0.2, y - r * 1.4, -115, 0.75), N(x - r * 0.8, y - r * 2.7, -130, 0.45)], c0='flat', c1='flat', fixed=r * 1.75)


def _register_accents():
    for kind in ACCENTS:
        def lc(g, kind=kind):
            base = 0 if kind in ('cedilla', 'ogonek', 'commaaccent') else g.P.xh
            if kind == 'caronalt':
                base = g.P.asc
            accent_draw(g, kind, base, 1.0)
            g.is_mark = True

        def uc(g, kind=kind):
            base = 0 if kind in ('cedilla', 'ogonek', 'commaaccent') else g.P.cap
            if kind == 'caronalt':
                base = g.P.cap
            accent_draw(g, kind, base, 0.78)
            g.is_mark = True
        REG[kind + 'comb'] = (lc, None, 'mark')
        REG[kind + 'comb.case'] = (uc, None, 'mark')


_register_accents()

# spacing versions of the accents (Latin-1 and spacing modifier letters)
SPACING_ACCENTS = {0xB4: 'acute', 0xA8: 'dieresis', 0xAF: 'macron', 0xB8: 'cedilla', 0x2C6: 'circumflex', 0x2DC: 'tilde',
                   0x2C7: 'caron', 0x2D8: 'breve', 0x2D9: 'dotaccent', 0x2DA: 'ring', 0x2DB: 'ogonek', 0x2DD: 'hungarumlaut'}
