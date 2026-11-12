"""Skeletons for A-Z, a-z and 0-9. Every coordinate is derived from the Style."""
import math
from .geom import N

REG = {}


def glyph(name, uni=None, case='lc'):
    def deco(fn):
        REG[name] = (fn, uni, case)
        return fn
    return deco


def hw(width, dx, dy):
    """Horizontal half-extent of a straight stroke of the given width and direction."""
    s = abs(dy) / math.hypot(dx, dy)
    return width / 2 / max(s, 0.2)


def legs_apex(g, apex, left_end, right_end, role_l, role_r, end_cap='B'):
    """Draw two straight legs from left_end and right_end to apex (A, V shapes) and fill the apex."""
    pen = g.P.pen(g.st)
    wl = pen((apex[0] - left_end[0], apex[1] - left_end[1]), role_l)
    wr = pen((right_end[0] - apex[0], right_end[1] - apex[1]), role_r)
    g.line(left_end[0], left_end[1], apex[0], apex[1], end_cap, 'flat', role_l)
    g.line(apex[0], apex[1], right_end[0], right_end[1], 'flat', end_cap, role_r)
    g.vertex(apex, left_end, right_end, wl, wr)
    return wl, wr


def apex_clip(g, top=None, bottom=None):
    P = g.P
    extra = {'flat': 0, 'point': g.st * 0.15, 'over': P.ov * 2.2}.get(P.apex, 0)
    g.clip(None if bottom is None else bottom - extra, None if top is None else top + extra)


# ===================================================================== UPPERCASE
@glyph('A', 0x41, 'uc')
def A(g):
    P = g.P
    C = P.cap
    w = P.U(0.80)
    pen = P.pen(g.st)
    wl = P.thin(g.st)
    wr = pen((w / 2, -C), 'main')
    xl = hw(wl, w / 2, C)
    xr = w - hw(wr, w / 2, C)
    legs_apex(g, (w / 2, C), (xl, 0), (xr, 0), 'thin', 'main')
    yb = C * 0.30 if P.serif == 'none' else C * 0.32
    t = yb / C
    x0 = xl + (w / 2 - xl) * t
    x1 = xr + (w / 2 - xr) * t
    g.hbar(x0, x1, yb)
    apex_clip(g, top=C, bottom=0)
    g.serif(xl, 0, 'foot', w=wl * 1.15)
    g.serif(xr, 0, 'foot', w=wr * 1.15)
    g.anchors['ogonek'] = xr + wr * 0.4


@glyph('B', 0x42, 'uc')
def B(g):
    P, s, h = g.P, g.st, g.hh
    C = P.cap
    w = P.U(0.66)
    xs = s / 2
    yt, yb = C - h / 2, h / 2
    ym = C * 0.535
    xr = w - s * 1.05 / 2
    xru = xr - w * 0.07
    g.vstem(xs, 0, C)
    k = None
    bu = w * 0.50
    g.stroke([N(xs, yt, 'h'), N(bu, yt, 'h'), N(xru, (yt + ym) / 2, 'v', 1.03), N(bu, ym, 'h'), N(xs, ym, 'h')], c0='none', c1='none')
    bl = w * 0.54
    g.stroke([N(xs, ym, 'h'), N(bl, ym, 'h'), N(xr, (ym + yb) / 2, 'v', 1.05), N(bl, yb, 'h'), N(xs, yb, 'h')], c0='none', c1='none')
    g.serif(xs, 0, 'foot', side='l')
    g.serif(xs, C, 'head', side='l')
    g.trap(xs + s / 2, ym + h / 2, 45)
    g.trap(xs + s / 2, ym - h / 2, -45)


@glyph('C', 0x43, 'uc')
def C_(g):
    P = g.P
    C, o = P.cap, P.ov
    w = P.U(0.78)
    a = 26 + P.aperture * 30
    g.arc_open(0, w, -o, C + o, a, -a)
    g.anchors['cedilla'] = w * 0.52


@glyph('D', 0x44, 'uc')
def D(g):
    P, s, h = g.P, g.st, g.hh
    C = P.cap
    w = P.U(0.78)
    xs = s / 2
    yt, yb = C - h / 2, h / 2
    xr = w - s * 1.05 / 2
    g.vstem(xs, 0, C)
    bx = w * 0.42
    g.stroke([N(xs, yt, 'h'), N(bx, yt, 'h'), N(xr, C / 2, 'v', 1.05), N(bx, yb, 'h'), N(xs, yb, 'h')], c0='none', c1='none')
    g.serif(xs, 0, 'foot', side='l')
    g.serif(xs, C, 'head', side='l')


def E_like(g, w, arms=(1.0, 0.9, 1.0), F=False, mid=0.5):
    P, s, h = g.P, g.st, g.hh
    C = P.cap
    xs = s / 2
    g.vstem(xs, 0, C)
    g.hbar(xs, w * arms[0], C - h / 2, 'none', 'flat')
    g.hbar(xs, w * arms[1], C * mid + (0 if F else h * 0.1), 'none', 'flat')
    if not F:
        g.hbar(xs, w * arms[2], h / 2, 'none', 'flat')
    g.serif(xs, 0, 'foot', side='both' if F else 'l')
    g.serif(xs, C, 'head', side='l')
    g.serif(w * arms[0], C, 'beak')
    if not F:
        g.serif(w * arms[2], 0, 'beak')
    if P.serif not in ('none',):
        g.serif(w * arms[1], C * mid + h * 0.6, 'beak', scale=0.6)


@glyph('E', 0x45, 'uc')
def E(g):
    w = g.P.U(0.60, 1)
    E_like(g, w, (1.0, 0.92, 1.0))
    g.anchors['ogonek'] = w * 0.8


@glyph('F', 0x46, 'uc')
def F(g):
    w = g.P.U(0.57, 1)
    E_like(g, w, (1.0, 0.9, 1.0), F=True, mid=0.47)


@glyph('G', 0x47, 'uc')
def G_(g):
    P, s, h = g.P, g.st, g.hh
    C, o = P.cap, P.ov
    w = P.U(0.80)
    a = 26 + P.aperture * 28
    xl, xr, yb, yt, cx, cy, rx, ry = (s * 1.06 / 2, w - s / 2, -o + h / 2, C + o - h / 2, 0, 0, 0, 0)
    cx, cy = (xl + xr) / 2, (yb + yt) / 2
    rx, ry = (xr - xl) / 2, (yt - yb) / 2
    ux, uy, ut = g.ell_pt(cx, cy, rx, ry, a)
    yj = C * 0.42
    g.stroke([N(ux, uy, ut), N(cx, yt, 'h'), N(xl, cy, 'v', 1.06), N(cx, yb, 'h'), N(xr, yj * 0.55, 'v'), N(xr, yj, 'v')], c0='T', c1='flat')
    g.hbar(w * 0.52, xr + s / 2, yj - h / 2, 'flat', 'none')
    if P.v['G'] == 'spur':
        g.vstem(xr, -o * 0.0, yj, 'flat', 'none')
        g.clip(0 - o, None)


@glyph('H', 0x48, 'uc')
def H(g):
    P, s, h = g.P, g.st, g.hh
    C = P.cap
    w = P.U(0.76)
    xl, xr = s / 2, w - s / 2
    g.vstem(xl, 0, C)
    g.vstem(xr, 0, C)
    g.hbar(xl, xr, C * 0.5 + h * 0.05, 'none', 'none')
    for x in (xl, xr):
        g.serif(x, 0, 'foot')
        g.serif(x, C, 'head')


@glyph('I', 0x49, 'uc')
def I(g):
    P, s = g.P, g.st
    C = P.cap
    g.vstem(s / 2, 0, C)
    g.serif(s / 2, 0, 'foot')
    g.serif(s / 2, C, 'head')


@glyph('J', 0x4A, 'uc')
def J(g):
    P, s, h = g.P, g.st, g.hh
    C, o = P.cap, P.ov
    w = P.U(0.52, 1)
    xr = w - s / 2
    yb = -o + h / 2
    xm = w * 0.47
    tx, ty = s * 0.55, C * 0.2
    g.stroke([N(xr, C, 'v'), N(xr, C * 0.33, 'v'), N(xm, yb, 'h'), N(tx, ty, 72)], c0='S', c1='T')
    g.serif(xr, C, 'head')


@glyph('K', 0x4B, 'uc')
def K(g):
    P, s = g.P, g.st
    C = P.cap
    w = P.U(0.74)
    xs = s / 2
    g.vstem(xs, 0, C)
    pen = P.pen(s)
    wa = P.thin(s)
    xa = w - s * 0.1 - hw(wa, 1, 1.1)
    ya = C * 0.30
    g.line(xs, ya, xa, C, 'none', 'B', 'thin')
    # leg starts on the arm
    t = 0.42
    lx, ly = xs + (xa - xs) * t, ya + (C - ya) * t
    wl = pen((w - lx, -ly), 'main')
    g.line(lx, ly, w - hw(wl, w - lx, ly), 0, 'flat', 'B', 'main')
    apex_clip(g, top=C, bottom=0)
    g.serif(xs, 0, 'foot')
    g.serif(xs, C, 'head')
    g.serif(xa, C, 'head', w=wa)
    g.serif(w - hw(wl, w - lx, ly), 0, 'foot', w=wl)


@glyph('L', 0x4C, 'uc')
def L(g):
    P, s, h = g.P, g.st, g.hh
    C = P.cap
    w = P.U(0.55, 1)
    xs = s / 2
    g.vstem(xs, 0, C)
    g.hbar(xs, w, h / 2, 'none', 'flat')
    g.serif(xs, C, 'head')
    g.serif(xs, 0, 'foot', side='l')
    g.serif(w, 0, 'beak')
    g.anchors['top'] = xs + s * 0.2
    g.anchors['caron'] = s * 1.25


@glyph('M', 0x4D, 'uc')
def M(g):
    P, s = g.P, g.st
    C = P.cap
    w = P.U(0.92, 3)
    pen = P.pen(s)
    thin = P.thin(s)
    splay = P.v['M'] == 'splayed'
    sp = w * 0.07 if splay else 0
    xl, xr = thin / 2 + sp, w - s / 2 - sp
    if splay:
        g.line(thin / 2, 0, xl + sp, C, 'B', 'B', 'thin')
        g.line(w - s / 2 - 0, 0, xr - sp, C, 'B', 'B', 'main')
        xl, xr = xl + sp, xr - sp
    else:
        g.stroke([N(xl, 0, 'v'), N(xl, C, 'v')], c0='S', c1='flat', role='thin')
        g.vstem(xr, 0, C, 'S', 'flat')
    mid = (w / 2, 0)
    wd = pen((1, -2), 'main')
    # diagonals
    g.line(xl, C, mid[0], mid[1], 'flat', 'flat', 'main')
    g.line(mid[0], mid[1], xr, C, 'flat', 'flat', 'thin')
    g.vertex((xl, C), (xl, 0), mid, thin, wd)
    g.vertex((xr, C), (xr, 0), mid, s, thin)
    g.vertex(mid, (xl, C), (xr, C), wd, thin)
    apex_clip(g, top=C, bottom=0)
    g.serif(thin / 2 if not splay else thin / 2, 0, 'foot', w=thin)
    g.serif(w - s / 2, 0, 'foot')


@glyph('N', 0x4E, 'uc')
def N_(g):
    P, s = g.P, g.st
    C = P.cap
    w = P.U(0.78)
    thin = P.thin(s)
    xl, xr = thin / 2, w - thin / 2
    g.stroke([N(xl, 0, 'v'), N(xl, C, 'v')], c0='S', c1='flat', role='thin')
    g.stroke([N(xr, 0, 'v'), N(xr, C, 'v')], c0='flat', c1='S', role='thin')
    pen = P.pen(s)
    wd = pen((xr - xl, -C), 'main')
    g.line(xl, C, xr, 0, 'flat', 'flat', 'main')
    g.vertex((xl, C), (xl, 0), (xr, 0), thin, wd)
    g.vertex((xr, 0), (xr, C), (xl, C), thin, wd)
    apex_clip(g, top=C, bottom=0)
    g.serif(xl, 0, 'foot', w=thin)
    g.serif(xl, C, 'head', side='l', w=thin)
    g.serif(xr, C, 'head', w=thin)


@glyph('O', 0x4F, 'uc')
def O(g):
    P = g.P
    C, o = P.cap, P.ov
    w = P.U(0.84)
    g.bowl(0, w, -o, C + o)


@glyph('P', 0x50, 'uc')
def P_(g):
    P, s, h = g.P, g.st, g.hh
    C = P.cap
    w = P.U(0.66)
    xs = s / 2
    yt = C - h / 2
    ym = C * 0.45
    xr = w - s * 1.05 / 2
    g.vstem(xs, 0, C)
    bx = w * 0.52
    g.stroke([N(xs, yt, 'h'), N(bx, yt, 'h'), N(xr, (yt + ym) / 2, 'v', 1.05), N(bx, ym, 'h'), N(xs, ym, 'h')], c0='none', c1='none')
    g.serif(xs, 0, 'foot')
    g.serif(xs, C, 'head', side='l')
    g.trap(xs + s / 2, ym - h / 2, -45)


@glyph('Q', 0x51, 'uc')
def Q(g):
    P, s = g.P, g.st
    C, o = P.cap, P.ov
    w = P.U(0.84)
    g.bowl(0, w, -o, C + o)
    if P.v['Q'] == 'below':
        g.line(w * 0.48, C * 0.02, w * 0.92, -C * 0.16, 'flat', 'T', 'main')
    else:
        g.line(w * 0.56, C * 0.24, w * 0.98, -C * 0.06, 'flat', 'B', 'main')


@glyph('R', 0x52, 'uc')
def R(g):
    P, s, h = g.P, g.st, g.hh
    C = P.cap
    w = P.U(0.70)
    xs = s / 2
    yt = C - h / 2
    ym = C * 0.46
    xr = w - s * 1.05 / 2 - w * 0.04
    g.vstem(xs, 0, C)
    bx = w * 0.5
    g.stroke([N(xs, yt, 'h'), N(bx, yt, 'h'), N(xr, (yt + ym) / 2, 'v', 1.05), N(bx, ym, 'h'), N(xs, ym, 'h')], c0='none', c1='none')
    pen = P.pen(s)
    if P.v['R'] == 'straight':
        wl = pen((0.3, -1), 'main')
        g.line(w * 0.56, ym, w - hw(wl, 0.3, 1), 0, 'flat', 'B')
    else:
        lx = w * 0.42
        wl = pen((w - lx, -ym), 'main')
        g.line(lx, ym + h * 0.2, w - hw(wl, w - lx, ym), 0, 'flat', 'B')
    g.clip(0, None)
    g.serif(xs, 0, 'foot')
    g.serif(xs, C, 'head', side='l')
    g.trap(xs + s / 2, ym - h / 2, -45)


def S_shape(g, x0, x1, y0, y1, top_frac=0.52):
    """S by ink box. Upper bowl slightly narrower than the lower."""
    P, s, h = g.P, g.st, g.hh
    w = x1 - x0
    xl = x0 + s * 0.98 / 2 + w * 0.025
    xr = x1 - s * 1.0 / 2
    yt, yb = y1 - h / 2, y0 + h / 2
    H = yt - yb
    yu = yt - H * 0.255
    yl = yb + H * 0.245
    xmt = (xl + xr - w * 0.03) / 2
    xmb = (xl - w * 0.02 + xr) / 2
    ym = yb + H * top_frac * 0.98
    a = 22 + P.aperture * 30
    # upper terminal on the upper bowl ellipse
    rxu = (xr - w * 0.04 - xl) / 2
    ryu = yt - yu
    ux, uy, ut = g.ell_pt(xmt, yu, rxu, ryu, a)
    rxl = (xr - (xl - w * 0.02)) / 2
    ryl = yl - yb
    lx, ly, lt = g.ell_pt(xmb, yl, rxl, ryl, 180 + a)
    spine = -math.degrees(math.atan2(yu - yl, (xr - xl) * 0.82)) * 0.95
    g.stroke([N(ux, uy, ut), N(xmt, yt, 'h'), N(xl, yu, 'v', 1.0), N((xl + xr) / 2, ym, spine, 1.06),
              N(xr, yl, 'v', 1.04), N(xmb, yb, 'h'), N(lx, ly, lt)], c0='T', c1='T')


@glyph('S', 0x53, 'uc')
def S(g):
    P = g.P
    C, o = P.cap, P.ov
    w = P.U(0.66)
    S_shape(g, 0, w, -o, C + o)
    g.anchors['cedilla'] = w * 0.5


@glyph('T', 0x54, 'uc')
def T(g):
    P, s, h = g.P, g.st, g.hh
    C = P.cap
    w = P.U(0.70, 1)
    g.hbar(0, w, C - h / 2, 'flat', 'flat')
    g.vstem(w / 2, 0, C - h / 2, 'S', 'none')
    g.serif(w / 2, 0, 'foot')
    if P.serif != 'none':
        g.serif(w, C, 'beak')
        g.poly([(0, C), (P.serif == 'wedge' and P.sl * 0.9 + g.st * 0.3 or g.st * 0.42, C), (0, C - (P.sl * 0.9 + h))])
    g.anchors['cedilla'] = w / 2
    g.anchors['caron'] = w / 2


@glyph('U', 0x55, 'uc')
def U(g):
    P, s, h = g.P, g.st, g.hh
    C, o = P.cap, P.ov
    w = P.U(0.76)
    xl, xr = s / 2, w - s / 2
    yb = -o + h / 2
    yc = min(C * 0.42, (xr - xl) * 0.62)
    g.stroke([N(xl, C, 'v'), N(xl, yc, 'v'), N(w / 2, yb, 'h'), N(xr, yc, 'v'), N(xr, C, 'v')], c0='S', c1='S')
    g.serif(xl, C, 'head')
    g.serif(xr, C, 'head')
    g.anchors['ogonek'] = w * 0.55


@glyph('V', 0x56, 'uc')
def V(g):
    P = g.P
    C = P.cap
    w = P.U(0.78)
    pen = P.pen(g.st)
    wl = pen((w / 2, -C), 'main')
    wr = P.thin(g.st)
    xl = hw(wl, w / 2, C)
    xr = w - hw(wr, w / 2, C)
    legs_apex(g, (w / 2, 0), (xl, C), (xr, C), 'main', 'thin')
    apex_clip(g, top=C, bottom=0)
    g.serif(xl, C, 'head', w=wl)
    g.serif(xr, C, 'head', w=wr)


@glyph('W', 0x57, 'uc')
def W(g):
    P = g.P
    C = P.cap
    w = P.U(1.14, 3)
    pen = P.pen(g.st)
    thin = P.thin(g.st)
    wm = pen((w / 4, -C), 'main')
    x1 = hw(wm, w / 4, C)
    x5 = w - hw(thin, w / 4, C)
    b1, b2 = w * 0.27, w * 0.73
    top_mid = C if P.v['W'] == 'crossed' else C * 0.78
    g.line(x1, C, b1, 0, 'B', 'flat', 'main')
    g.line(b1, 0, w / 2, top_mid, 'flat', 'flat', 'thin')
    g.line(w / 2, top_mid, b2, 0, 'flat', 'flat', 'main')
    g.line(b2, 0, x5, C, 'flat', 'B', 'thin')
    g.vertex((b1, 0), (x1, C), (w / 2, top_mid), wm, thin)
    g.vertex((w / 2, top_mid), (b1, 0), (b2, 0), thin, wm)
    g.vertex((b2, 0), (w / 2, top_mid), (x5, C), wm, thin)
    apex_clip(g, top=C, bottom=0)
    g.serif(x1, C, 'head', w=wm)
    g.serif(x5, C, 'head', w=thin)


@glyph('X', 0x58, 'uc')
def X(g):
    P = g.P
    C = P.cap
    w = P.U(0.76)
    pen = P.pen(g.st)
    wm = pen((w, -C), 'main')
    wt = P.thin(g.st)
    g.line(hw(wm, w, C), C, w - hw(wm, w, C), 0, 'B', 'B', 'main')
    g.line(hw(wt, w, C) + w * 0.02, 0, w - hw(wt, w, C) - w * 0.02, C, 'B', 'B', 'thin')
    g.clip(0, C)
    for x, y, ww in ((hw(wm, w, C), C, wm), (w - hw(wm, w, C), 0, wm), (hw(wt, w, C) + w * 0.02, 0, wt), (w - hw(wt, w, C) - w * 0.02, C, wt)):
        g.serif(x, y, 'foot' if y == 0 else 'head', w=ww)


@glyph('Y', 0x59, 'uc')
def Y(g):
    P = g.P
    C = P.cap
    w = P.U(0.76)
    pen = P.pen(g.st)
    yj = C * 0.42
    wm = pen((w / 2, -(C - yj)), 'main')
    wt = P.thin(g.st)
    xl = hw(wm, w / 2, C - yj)
    xr = w - hw(wt, w / 2, C - yj)
    legs_apex(g, (w / 2, yj), (xl, C), (xr, C), 'main', 'thin')
    g.vstem(w / 2, 0, yj, 'S', 'none')
    g.clip(None, C)
    g.serif(w / 2, 0, 'foot')
    g.serif(xl, C, 'head', w=wm)
    g.serif(xr, C, 'head', w=wt)


@glyph('Z', 0x5A, 'uc')
def Z(g):
    P, s, h = g.P, g.st, g.hh
    C = P.cap
    w = P.U(0.66, 1)
    pen = P.pen(s)
    wd = pen((-w, -C), 'main')
    hx = hw(wd, w, C)
    g.hbar(w * 0.04, w - hx * 0.6, C - h / 2, 'flat', 'none')
    g.hbar(hx * 0.6, w, h / 2, 'none', 'flat')
    g.line(w - hx, C, hx, 0, 'B', 'B', 'main')
    g.clip(0, C)
    g.serif(w * 0.04, C, 'beak')
    g.serif(w, 0, 'beak')


# ===================================================================== lowercase
def arch(g, xl, xr, top, base=0, join=None, left_top=None):
    """n-like arch: right stem from base up and over to the left stem (which the caller draws)."""
    P, s, h = g.P, g.st, g.hh
    o = P.ov
    yt = top + o - h / 2
    ys = top * 0.56 if P.sq < 0.65 else top * 0.62
    xm = (xl + xr) / 2 + s * 0.08
    j = join if join is not None else P.join
    yj = top - h * 0.6 - top * 0.13
    g.stroke([N(xr, base, 'v'), N(xr, ys, 'v'), N(xm, yt, 'h'), N(xl + s * 0.06, yj, 'v', j)], c0='S', c1='none')
    g.trap(xl + s / 2, yj - s * 0.1, -70)


@glyph('a', 0x61)
def a(g):
    P, s, h = g.P, g.st, g.hh
    X, o = P.xh, P.ov
    if P.v['a'] == 1:
        w = P.V(0.86)
        xr = w - s / 2
        bowl_stem(g, 0, w, X, X, right=True, asc=False)
        return
    w = P.V(0.80)
    xr = w - s / 2
    yt = X + o - h / 2
    yb = -o + h / 2
    xm = w * 0.48
    a_ = 28 + P.aperture * 24
    # top hook + stem
    tx = s * 0.55 + w * 0.02
    ty = X * (0.80 - 0.03 * P.aperture)
    g.stroke([N(tx, ty, 62), N(xm, yt, 'h'), N(xr, X * 0.62, 'v'), N(xr, 0, 'v')], c0='T', c1='S')
    # bowl
    yj = X * 0.54
    xl = s * 1.04 / 2
    g.stroke([N(xr, yj, 'h', P.join), N(w * 0.42, yj, 'h'), N(xl, X * 0.27, 'v', 1.04), N(w * 0.42, yb, 'h'), N(xr, X * 0.2, 60, P.join)], c0='none', c1='none')
    g.trap(xr - s / 2, X * 0.2 + s * 0.1, 200)
    g.serif(xr, 0, 'foot', side='r')
    g.anchors['ogonek'] = xr + s * 0.2


def bowl_stem(g, x0, x1, top, stem_top, right=True, asc=False, desc=False, base=0):
    """b d p q and single-storey a/g bowl with a stem."""
    P, s, h = g.P, g.st, g.hh
    X, o = top, P.ov
    xs = x1 - s / 2 if right else x0 + s / 2
    xo = x0 + s * 1.05 / 2 if right else x1 - s * 1.05 / 2
    yt = X + o - h / 2
    yb = -o + h / 2
    xm = (xs + xo) / 2 + (-1 if right else 1) * s * 0.06
    j = P.join
    y_top_j = X - X * 0.2
    y_bot_j = X * 0.2
    g.stroke([N(xs, y_top_j, 'v', j), N(xm, yt, 'h'), N(xo, X / 2, 'v', 1.05), N(xm, yb, 'h'), N(xs, y_bot_j, 'v', j)], c0='none', c1='none')
    y0 = P.desc if desc else 0
    y1 = P.asc if asc else stem_top
    g.vstem(xs, y0, y1, 'S', 'S')
    g.trap(xs + (-1 if right else 1) * s / 2, y_top_j + s * 0.15, 90 + (-30 if right else 30) + 180 * 0)
    g.trap(xs + (-1 if right else 1) * s / 2, y_bot_j - s * 0.15, -90 + (30 if right else -30))
    if asc:
        g.serif(xs, P.asc, 'flag')
    if desc:
        g.serif(xs, P.desc, 'head')
    elif right:
        g.serif(xs, 0, 'foot', side='r')
    return xs


@glyph('b', 0x62)
def b(g):
    w = g.P.V(0.92)
    bowl_stem(g, 0, w, g.P.xh, g.P.asc, right=False, asc=True)


@glyph('c', 0x63)
def c(g):
    P = g.P
    X, o = P.xh, P.ov
    w = P.V(0.80)
    a = 30 + P.aperture * 26
    g.arc_open(0, w, -o, X + o, a, -a)
    g.anchors['cedilla'] = w * 0.52


@glyph('d', 0x64)
def d(g):
    P = g.P
    w = P.V(0.92)
    xs = bowl_stem(g, 0, w, P.xh, P.asc, right=True, asc=True)
    g.anchors['caron'] = xs + g.st * 0.9
    g.anchors['bar'] = xs


@glyph('e', 0x65)
def e(g):
    P, s, h = g.P, g.st, g.hh
    X, o = P.xh, P.ov
    w = P.V(0.86)
    xl, xr = s * 1.05 / 2, w - s / 2
    yt, yb = X + o - h / 2, -o + h / 2
    cx, cy = (xl + xr) / 2, (yt + yb) / 2
    a = 28 + P.aperture * 22
    rx, ry = (xr - xl) / 2, (yt - yb) / 2
    lx, ly, lt = g.ell_pt(cx, cy, rx, ry, -a)
    if P.v['e'] == 'slant':
        yb1, yb2 = X * 0.42, X * 0.62
        g.line(xl, yb1, xr, yb2, 'none', 'none', 'main')
        g.stroke([N(xr, yb2, 80), N(cx + s * 0.1, yt, 'h'), N(xl, cy, 'v', 1.05), N(cx, yb, 'h'), N(lx, ly, lt)], c0='none', c1='T')
    else:
        ybar = X * 0.5 + h * 0.1
        g.hbar(xl, xr + s * 0.5, ybar, 'none', 'flat')
        g.stroke([N(xr, ybar, 'v'), N(cx, yt, 'h'), N(xl, cy, 'v', 1.05), N(cx, yb, 'h'), N(lx, ly, lt)], c0='none', c1='T')
    g.anchors['ogonek'] = w * 0.55


@glyph('f', 0x66)
def f(g):
    P, s, h = g.P, g.st, g.hh
    X, A, o = P.xh, P.asc, P.ov
    w = P.V(0.56, 1)
    xs = s / 2 + w * 0.16
    yt = A + o - h / 2
    g.stroke([N(xs, 0, 'v'), N(xs, A - (A - X) * 0.62, 'v'), N(xs + w * 0.34, yt, 'h'), N(w, A - (A - X) * 0.18, -20)], c0='S', c1='T')
    g.hbar(0, w * 0.86, X - h / 2, 'flat', 'flat')
    g.serif(xs, 0, 'foot')


@glyph('g', 0x67)
def g_(g):
    P, s, h = g.P, g.st, g.hh
    X, D, o = P.xh, P.desc, P.ov
    if P.v['g'] == 2:
        return g2(g)
    w = P.V(0.90)
    xs = w - s / 2
    xo = s * 1.05 / 2
    yt = X + o - h / 2
    yb = X * 0.0 + (-o + h / 2) + X * 0.04
    xm = (xs + xo) / 2 - s * 0.06
    j = P.join
    g.stroke([N(xs, X * 0.8, 'v', j), N(xm, yt, 'h'), N(xo, (yt + yb) / 2, 'v', 1.05), N(xm, yb, 'h'), N(xs, X * 0.24, 'v', j)], c0='none', c1='none')
    yd = D + o * 0 + h / 2 - o
    g.stroke([N(xs, X, 'v'), N(xs, D * 0.28, 'v'), N(w * 0.5, yd, 'h'), N(s * 0.5 + w * 0.08, D * 0.70 + h * 0.2, 125)], c0='S', c1='T')
    g.trap(xs - s / 2, X * 0.8 + s * 0.15, 120)


def g2(g):
    P, s, h = g.P, g.st, g.hh
    X, D, o = P.xh, P.desc, P.ov
    w = P.V(0.86)
    bw = w * 0.80
    top = X + o
    bot = X * 0.30
    xl, xr, yb, yt = g.bowl(w * 0.06, w * 0.06 + bw, bot, top, wl=1.0, wr=1.0)
    # ear
    g.line(xr - s * 0.2, X * 0.88, w + s * 0.1, X * 0.98, 'none', 'T', 'thin')
    # link + lower loop
    lb = D + h / 2 - o
    g.stroke([N((xl + xr) / 2 - s * 0.1, yb, 'h'), N(w * 0.18, yb - X * 0.07, -110), N(w * 0.3, X * 0.02, 'h'), N(w * 0.72, X * 0.02, 'h'),
              N(w - s / 2, (X * 0.02 + lb) / 2, 'v', 1.05), N(w * 0.5, lb, 'h'), N(s * 0.5, (X * 0.02 + lb) / 2 - h * 0.1, 'v', 1.0), N(w * 0.24, X * 0.02, 'h', 0.9)],
             c0='none', c1='none', role='main')


@glyph('h', 0x68)
def h_(g):
    P, s = g.P, g.st
    w = P.V(0.86)
    xl, xr = s / 2, w - s / 2
    g.vstem(xl, 0, P.asc)
    arch(g, xl, xr, P.xh)
    g.serif(xl, P.asc, 'flag')
    g.serif(xl, 0, 'foot')
    g.serif(xr, 0, 'foot')
    g.anchors['top'] = xl
    g.anchors['topy'] = P.asc
    g.anchors['bar'] = xl


@glyph('i', 0x69)
def i(g):
    P, s = g.P, g.st
    X = P.xh
    g.vstem(s / 2, 0, X)
    r = s * 0.62
    g.dot(s / 2, X + (P.asc - X) * 0.5 + r * 0.3, r)
    g.serif(s / 2, X, 'flag')
    g.serif(s / 2, 0, 'foot')
    g.anchors['ogonek'] = s * 0.6


@glyph('dotlessi', 0x131)
def dotlessi(g):
    P, s = g.P, g.st
    g.vstem(s / 2, 0, P.xh)
    g.serif(s / 2, P.xh, 'flag')
    g.serif(s / 2, 0, 'foot')


def j_body(g, dot=True):
    P, s, h = g.P, g.st, g.hh
    X, D, o = P.xh, P.desc, P.ov
    xs = s / 2 + s * 1.2
    g.stroke([N(xs, X, 'v'), N(xs, D * 0.3, 'v'), N(xs - s * 1.1, D - o + h / 2, 'h'), N(-s * 0.6, D * 0.86, 180)], c0='S', c1='T')
    if dot:
        r = s * 0.62
        g.dot(xs, X + (P.asc - X) * 0.5 + r * 0.3, r)
    g.serif(xs, X, 'flag')
    g.anchors['top'] = xs


@glyph('j', 0x6A)
def j(g):
    j_body(g, True)


@glyph('dotlessj', 0x237)
def dotlessj(g):
    j_body(g, False)


@glyph('k', 0x6B)
def k(g):
    P, s = g.P, g.st
    X, A = P.xh, P.asc
    w = P.V(0.80)
    xs = s / 2
    g.vstem(xs, 0, A)
    pen = P.pen(s)
    wa = P.thin(s)
    xa = w - s * 0.15 - hw(wa, 1, 1.1)
    ya = X * 0.22
    g.line(xs, ya, xa, X, 'none', 'B', 'thin')
    t = 0.45
    lx, ly = xs + (xa - xs) * t, ya + (X - ya) * t
    wl = pen((w - lx, -ly), 'main')
    g.line(lx, ly, w - hw(wl, w - lx, ly), 0, 'flat', 'B', 'main')
    g.clip(0, A)
    g.serif(xs, A, 'flag')
    g.serif(xs, 0, 'foot')
    g.serif(xa, X, 'head', w=wa, scale=0.8)
    g.serif(w - hw(wl, w - lx, ly), 0, 'foot', w=wl, scale=0.8)


@glyph('l', 0x6C)
def l(g):
    P, s, h = g.P, g.st, g.hh
    A, o = P.asc, P.ov
    xs = s / 2
    if P.v['l'] == 'tail':
        g.stroke([N(xs, A, 'v'), N(xs, P.xh * 0.2, 'v'), N(xs + s * 1.0, -o + h / 2, 'h'), N(xs + s * 2.0, P.xh * 0.1, 50)], c0='S', c1='T')
    else:
        g.vstem(xs, 0, A)
        g.serif(xs, 0, 'foot')
    g.serif(xs, A, 'flag')
    g.anchors['top'] = xs
    g.anchors['topy'] = A
    g.anchors['caron'] = xs + s * 1.1


@glyph('m', 0x6D)
def m(g):
    P, s = g.P, g.st
    w = P.V(1.32, 3)
    x1, x3 = s / 2, w - s / 2
    x2 = (x1 + x3) / 2
    g.vstem(x1, 0, P.xh)
    arch(g, x1, x2, P.xh, join=P.join * 0.95)
    arch(g, x2, x3, P.xh, join=P.join * 0.95)
    g.serif(x1, P.xh, 'flag')
    for x in (x1, x2, x3):
        g.serif(x, 0, 'foot')


@glyph('n', 0x6E)
def n(g):
    P, s = g.P, g.st
    w = P.V(0.86)
    xl, xr = s / 2, w - s / 2
    g.vstem(xl, 0, P.xh)
    arch(g, xl, xr, P.xh)
    g.serif(xl, P.xh, 'flag')
    g.serif(xl, 0, 'foot')
    g.serif(xr, 0, 'foot')


@glyph('o', 0x6F)
def o_(g):
    P = g.P
    w = P.V(0.90)
    g.bowl(0, w, -P.ov, P.xh + P.ov)


@glyph('p', 0x70)
def p(g):
    P = g.P
    w = P.V(0.92)
    bowl_stem(g, 0, w, P.xh, P.xh, right=False, desc=True)
    g.serif(g.st / 2, P.xh, 'flag')


@glyph('q', 0x71)
def q(g):
    P = g.P
    w = P.V(0.92)
    bowl_stem(g, 0, w, P.xh, P.xh, right=True, desc=True)


@glyph('r', 0x72)
def r(g):
    P, s, h = g.P, g.st, g.hh
    X, o = P.xh, P.ov
    w = P.V(0.60, 1)
    xs = s / 2
    g.vstem(xs, 0, X)
    yt = X + o - h / 2
    yj = X * 0.62
    g.stroke([N(xs + s * 0.05, yj, 'v', P.join), N(xs + (w - xs) * 0.45, yt, 'h'), N(w, X - X * 0.06 - h * 0.25, -25)], c0='none', c1='T')
    g.trap(xs + s / 2, yj, -70)
    g.serif(xs, X, 'flag')
    g.serif(xs, 0, 'foot', scale=1.2)


@glyph('s', 0x73)
def s_(g):
    P = g.P
    w = P.V(0.70)
    S_shape(g, 0, w, -P.ov, P.xh + P.ov)
    g.anchors['cedilla'] = w * 0.5


@glyph('t', 0x74)
def t(g):
    P, s, h = g.P, g.st, g.hh
    X, o = P.xh, P.ov
    w = P.V(0.56, 1)
    xs = s / 2 + w * 0.18
    top = X + (P.asc - X) * 0.62
    g.stroke([N(xs, top, 'v'), N(xs, X * 0.24, 'v'), N(xs + (w - xs) * 0.5, -o + h / 2, 'h'), N(w, X * 0.07, 35)], c0=('cut', 35) if P.serif == 'none' and P.stemcap == 'flat' else 'S', c1='T')
    g.hbar(0, w * 0.9, X - h / 2, 'flat', 'flat')
    g.anchors['top'] = xs
    g.anchors['caron'] = xs + s * 1.1
    g.anchors['cedilla'] = xs + s * 0.4


@glyph('u', 0x75)
def u(g):
    P, s, h = g.P, g.st, g.hh
    X, o = P.xh, P.ov
    w = P.V(0.86)
    xl, xr = s / 2, w - s / 2
    yb = -o + h / 2
    ys = X * 0.44
    xm = (xl + xr) / 2 - s * 0.08
    g.stroke([N(xl, X, 'v'), N(xl, ys, 'v'), N(xm, yb, 'h'), N(xr - s * 0.06, X * 0.13 + h * 0.6, 'v', P.join)], c0='S', c1='none')
    g.vstem(xr, 0, X)
    g.trap(xr - s / 2, X * 0.13 + h * 0.6 + s * 0.1, 110)
    g.serif(xl, X, 'flag')
    g.serif(xr, X, 'flag')
    g.serif(xr, 0, 'foot', side='r')
    g.anchors['ogonek'] = xr + s * 0.2


def v_shape(g, w, top, bottom=0, desc_tail=False):
    P = g.P
    pen = P.pen(g.st)
    wl = pen((w / 2, -(top - bottom)), 'main')
    wr = P.thin(g.st)
    xl = hw(wl, w / 2, top)
    xr = w - hw(wr, w / 2, top)
    legs_apex(g, (w / 2, bottom), (xl, top), (xr, top), 'main', 'thin')
    return xl, xr, wl, wr


@glyph('v', 0x76)
def v(g):
    P = g.P
    w = P.V(0.82)
    xl, xr, wl, wr = v_shape(g, w, P.xh)
    apex_clip(g, top=P.xh, bottom=0)
    g.serif(xl, P.xh, 'head', w=wl, scale=0.85)
    g.serif(xr, P.xh, 'head', w=wr, scale=0.85)


@glyph('w', 0x77)
def w_(g):
    P = g.P
    X = P.xh
    w = P.V(1.22, 3)
    pen = P.pen(g.st)
    thin = P.thin(g.st)
    wm = pen((w / 4, -X), 'main')
    x1 = hw(wm, w / 4, X)
    x5 = w - hw(thin, w / 4, X)
    b1, b2 = w * 0.27, w * 0.73
    tm = X if P.v['W'] == 'crossed' else X * 0.8
    g.line(x1, X, b1, 0, 'B', 'flat', 'main')
    g.line(b1, 0, w / 2, tm, 'flat', 'flat', 'thin')
    g.line(w / 2, tm, b2, 0, 'flat', 'flat', 'main')
    g.line(b2, 0, x5, X, 'flat', 'B', 'thin')
    g.vertex((b1, 0), (x1, X), (w / 2, tm), wm, thin)
    g.vertex((w / 2, tm), (b1, 0), (b2, 0), thin, wm)
    g.vertex((b2, 0), (w / 2, tm), (x5, X), wm, thin)
    apex_clip(g, top=X, bottom=0)
    g.serif(x1, X, 'head', w=wm, scale=0.85)
    g.serif(x5, X, 'head', w=thin, scale=0.85)


@glyph('x', 0x78)
def x(g):
    P = g.P
    X = P.xh
    w = P.V(0.80)
    pen = P.pen(g.st)
    wm = pen((w, -X), 'main')
    wt = P.thin(g.st)
    g.line(hw(wm, w, X), X, w - hw(wm, w, X), 0, 'B', 'B', 'main')
    g.line(hw(wt, w, X) + w * 0.02, 0, w - hw(wt, w, X) - w * 0.02, X, 'B', 'B', 'thin')
    g.clip(0, X)
    for xx, y, ww in ((hw(wm, w, X), X, wm), (w - hw(wm, w, X), 0, wm), (hw(wt, w, X) + w * 0.02, 0, wt), (w - hw(wt, w, X) - w * 0.02, X, wt)):
        g.serif(xx, y, 'foot' if y == 0 else 'head', w=ww, scale=0.8)


@glyph('y', 0x79)
def y(g):
    P, s, h = g.P, g.st, g.hh
    X, D, o = P.xh, P.desc, P.ov
    w = P.V(0.82)
    if P.v['y'] == 'curve':
        xl, xr = s / 2, w - s / 2
        ys = X * 0.44
        xm = (xl + xr) / 2 - s * 0.08
        g.stroke([N(xl, X, 'v'), N(xl, ys, 'v'), N(xm, -o + h / 2 + X * 0.02, 'h'), N(xr - s * 0.06, X * 0.16 + h * 0.6, 'v', P.join)], c0='S', c1='none')
        g.stroke([N(xr, X, 'v'), N(xr, D * 0.3, 'v'), N(w * 0.48, D - o + h / 2, 'h'), N(s * 0.6, D * 0.72, 115)], c0='S', c1='T')
        g.serif(xl, X, 'flag')
        g.serif(xr, X, 'flag')
        return
    pen = P.pen(s)
    wl = pen((w / 2, -X), 'main')
    wr = P.thin(s)
    xl = hw(wl, w / 2, X)
    xr = w - hw(wr, w / 2, X)
    ax = w * 0.5
    g.line(xl, X, ax, 0, 'B', 'flat', 'main')
    # tail continues the thin stroke down to the descender
    dx = (xr - ax) / X
    tx = ax - dx * (-D) * 0.92
    g.stroke([N(xr, X, None), N(ax, 0, None), N(tx + s * 0.1, D * 0.82, (math.degrees(math.atan2(-X, -(xr - ax))))), N(tx - s * 0.9, D - o + h / 2, 'h')], c0='B', c1='T', role='thin')
    g.vertex((ax, 0), (xl, X), (xr, X), wl, wr)
    g.clip(D - 2 * o, X)
    g.serif(xl, X, 'head', w=wl, scale=0.85)
    g.serif(xr, X, 'head', w=wr, scale=0.85)


@glyph('z', 0x7A)
def z(g):
    P, s, h = g.P, g.st, g.hh
    X = P.xh
    w = P.V(0.72, 1)
    pen = P.pen(s)
    wd = pen((-w, -X), 'main')
    hx = hw(wd, w, X)
    g.hbar(w * 0.05, w - hx * 0.6, X - h / 2, 'flat', 'none')
    g.hbar(hx * 0.6, w, h / 2, 'none', 'flat')
    g.line(w - hx, X, hx, 0, 'B', 'B', 'main')
    g.clip(0, X)
    if P.serif != 'none':
        g.serif(w * 0.05, X, 'beak', scale=0.6)
        g.serif(w, 0, 'beak', scale=0.6)


# ===================================================================== figures
def fig_w(P):
    return P.U(0.57, 1.5)


@glyph('zero', 0x30, 'fig')
def zero(g):
    P = g.P
    C, o = P.cap, P.ov
    w = fig_w(P)
    g.bowl(0, w, -o, C + o, wl=1.02, wr=1.02)
    if P.v['zero'] == 'slash':
        g.line(w * 0.3, C * 0.3, w * 0.7, C * 0.7, 'flat', 'flat', 'thin', 0.8)
    elif P.v['zero'] == 'dot':
        g.dot(w / 2, C / 2, g.st * 0.5)


@glyph('one', 0x31, 'fig')
def one(g):
    P, s, h = g.P, g.st, g.hh
    C = P.cap
    w = fig_w(P)
    xs = w * 0.58
    g.vstem(xs, 0, C, 'S', 'flat')
    g.line(xs, C, w * 0.12, C * 0.76, 'none', 'T', 'main', 0.88)
    g.clip(None, C)
    if P.v['one'] == 'base' or P.serif != 'none':
        g.hbar(w * 0.14, w * 0.98, h / 2, 'flat', 'flat')


@glyph('two', 0x32, 'fig')
def two(g):
    P, s, h = g.P, g.st, g.hh
    C, o = P.cap, P.ov
    w = fig_w(P)
    xl, xr = s / 2 + w * 0.03, w - s / 2
    yt = C + o - h / 2
    cx = (xl + xr) / 2
    ry = C * 0.27
    a = 150 - P.aperture * 12
    tx, ty, tt = g.ell_pt(cx, yt - ry, (xr - xl) / 2, ry, a)
    g.stroke([N(tx, ty, tt), N(cx, yt, 'h'), N(xr, yt - ry, 'v', 1.02), N(s * 0.6, h * 0.5, None)], c0='T', c1='none')
    g.hbar(0, w, h / 2, 'flat', 'flat')


@glyph('three', 0x33, 'fig')
def three(g):
    P, s, h = g.P, g.st, g.hh
    C, o = P.cap, P.ov
    w = fig_w(P)
    xr = w - s / 2
    yt, yb = C + o - h / 2, -o + h / 2
    ym = C * 0.55
    xmt = w * 0.47
    a = 150 - P.aperture * 15
    tx, ty, tt = g.ell_pt(xmt, (yt + ym) / 2, (xr - w * 0.05 - s * 0.6) / 2, (yt - ym) / 2, a)
    g.stroke([N(tx, ty, tt), N(xmt, yt, 'h'), N(xr - w * 0.05, (yt + ym) / 2, 'v'), N(w * 0.5, ym, 'h'), N(w * 0.3, ym, 'h')], c0='T', c1='flat')
    g.stroke([N(w * 0.42, ym, 'h'), N(w * 0.5, ym, 'h'), N(xr, (ym + yb) / 2, 'v', 1.03), N(w * 0.5, yb, 'h'), N(s * 0.5, C * 0.16 + h * 0.2, 125)], c0='flat', c1='T')


@glyph('four', 0x34, 'fig')
def four(g):
    P, s, h = g.P, g.st, g.hh
    C = P.cap
    w = fig_w(P)
    xs = w * 0.70
    yb = C * 0.28
    g.vstem(xs, 0, C if P.v['four'] == 'closed' else C * 0.62, 'S', 'flat')
    g.hbar(0, w, yb, 'flat', 'flat')
    pen = P.pen(s)
    wd = pen((-xs, -(C - yb)), 'thin')
    if P.v['four'] == 'closed':
        g.line(xs, C, hw(wd, xs, C) * 0.6, yb, 'flat', 'flat', 'thin')
        g.vertex((xs, C), (xs, 0), (0, yb), s, wd)
        g.clip(0, C)
    else:
        g.line(w * 0.45, C, s * 0.5, yb, 'S', 'flat', 'main')


@glyph('five', 0x35, 'fig')
def five(g):
    P, s, h = g.P, g.st, g.hh
    C, o = P.cap, P.ov
    w = fig_w(P)
    xs = s / 2 + w * 0.06
    yj = C * 0.60
    xr = w - s / 2
    yb = -o + h / 2
    g.hbar(xs, w * 0.92, C - h / 2, 'none', 'flat')
    g.stroke([N(xs + s * 0.04, C - h * 0.5, 'v'), N(xs - s * 0.02, yj - h * 0.3, -95)], c0='flat', c1='flat')
    g.stroke([N(xs, yj - h * 0.4, 50, 0.9), N(w * 0.5, yj + o * 0.4 - h / 2 + h * 0.5, 'h'), N(xr, (yj + yb) / 2, 'v', 1.03), N(w * 0.48, yb, 'h'), N(s * 0.5, C * 0.16 + h * 0.2, 125)], c0='flat', c1='T')


@glyph('six', 0x36, 'fig')
def six(g):
    P, s, h = g.P, g.st, g.hh
    C, o = P.cap, P.ov
    w = fig_w(P)
    top = C * 0.62
    xl, xr, yb, yt = g.bowl(0, w, -o, top)
    yT = C + o - h / 2
    g.stroke([N(xl, (yb + yt) / 2, 'v', 1.05), N(xl + s * 0.15, C * 0.62, 80), N(w * 0.55, yT, 'h'), N(w - s * 0.55, C * 0.86, -40)], c0='none', c1='T')


@glyph('seven', 0x37, 'fig')
def seven(g):
    P, s, h = g.P, g.st, g.hh
    C = P.cap
    w = fig_w(P)
    g.hbar(0, w, C - h / 2, 'flat', 'none')
    xr = w - s * 0.45
    if P.v['seven'] == 'curved':
        g.stroke([N(xr, C - h * 0.5, None), N(w * 0.55, C * 0.45, -110), N(w * 0.38, 0, 'v')], c0='flat', c1='B')
    else:
        g.line(xr, C - h * 0.5, w * 0.28, 0, 'flat', 'B', 'main')
    g.clip(0, C)


@glyph('eight', 0x38, 'fig')
def eight(g):
    P, s, h = g.P, g.st, g.hh
    C, o = P.cap, P.ov
    w = fig_w(P)
    mid = C * 0.555
    g.bowl(w * 0.06, w * 0.94, mid - h * 0.98, C + o, wl=0.95, wr=0.95)
    g.bowl(0, w, -o, mid, wl=1.03, wr=1.03)


@glyph('nine', 0x39, 'fig')
def nine(g):
    six(g)
    g.rotate180 = True


GLYPH_ORDER_BASIC = list(REG.keys())
