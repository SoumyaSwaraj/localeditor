"""Glyph builder: helpers used by glyph definitions, and rendering to clean polygons."""
import math
import random
import zlib
import numpy as np
import pyclipper

from .geom import (N, Stroke, expand, extend_for_cut, cut_cap_planes, to_clip, from_clip, orient,
                   union, boolean, halfplane_poly, soften, circle, area, SCALE)


class G:
    def __init__(self, P, name, case='lc'):
        self.P = P
        self.name = name
        self.case = case
        self.st = P.stc if case == 'uc' else P.st
        self.strokes = []
        self.adds = []       # extra positive polygons
        self.subs = []       # polygons to subtract at the end
        self.clipbox = None  # (ymin, ymax)
        self.anchors = {}
        self.sides = None    # optional fixed sidebearings (l, r) as factors
        self.rng = random.Random(zlib.crc32(('%s|%s' % (name, P.seed)).encode()))
        self.adv = None      # fixed advance (e.g. space)
        self.jit = P.jitter

    # ---------------------------------------------------------- widths
    @property
    def hh(self):
        """Thickness of a horizontal stroke."""
        return self.P.pen(self.st)((1.0, 0.0), 'main')

    @property
    def vv(self):
        return self.P.pen(self.st)((0.0, 1.0), 'main')

    def thin(self):
        return self.P.thin(self.st)

    def cap(self, kind):
        P = self.P
        if kind == 'S':
            return 'round' if P.stemcap == 'round' else 'flat'
        if kind == 'T':
            return P.term
        if kind == 'B':
            return 'round' if P.diagcut == 'round' else ('cut', 0)
        if kind == 'none':
            return 'flat'
        return kind

    # ---------------------------------------------------------- primitives
    def stroke(self, nodes, closed=False, c0='S', c1='S', wmul=1.0, role='main', fixed=None):
        if self.jit > 0:
            j = self.jit
            def tj(t):
                if t is None:
                    return None
                base = {'h': 0.0, 'v': 90.0}.get(t, t)
                return base + self.rng.gauss(0, 1) * 5 * j
            nodes = [N(n.x + self.rng.gauss(0, 1) * 13 * j, n.y + self.rng.gauss(0, 1) * 10 * j, tj(n.t), n.w * (1 + self.rng.gauss(0, 1) * 0.09 * j), n.k) for n in nodes]
        self.strokes.append(Stroke(nodes, closed, self.cap(c0), self.cap(c1), wmul, role, fixed))

    def line(self, x0, y0, x1, y1, c0='S', c1='S', role='main', wmul=1.0, w0=1.0, w1=1.0, fixed=None):
        a = math.degrees(math.atan2(y1 - y0, x1 - x0))
        self.stroke([N(x0, y0, a, w0), N(x1, y1, a, w1)], False, c0, c1, wmul, role, fixed)

    def vstem(self, x, y0, y1, c0='S', c1='S', wmul=1.0):
        self.stroke([N(x, y0, 'v'), N(x, y1, 'v')], False, c0, c1, wmul)

    def hbar(self, x0, x1, y, c0='flat', c1='flat', wmul=1.0, role='main'):
        self.stroke([N(x0, y, 'h'), N(x1, y, 'h')], False, c0, c1, wmul, role)

    def poly(self, pts):
        self.adds.append(np.array(pts, dtype=float))

    def cut(self, pts):
        self.subs.append(np.array(pts, dtype=float))

    def clip(self, ymin=None, ymax=None):
        self.clipbox = (ymin, ymax)

    def dot(self, cx, cy, r=None):
        P = self.P
        r = r or self.st * 0.62
        if P.dot == 'square':
            self.poly([(cx - r * 0.9, cy - r * 0.9), (cx + r * 0.9, cy - r * 0.9), (cx + r * 0.9, cy + r * 0.9), (cx - r * 0.9, cy + r * 0.9)])
        elif P.dot == 'diamond':
            q = r * 1.22
            self.poly([(cx, cy - q), (cx + q, cy), (cx, cy + q), (cx - q, cy)])
        else:
            self.poly(circle((cx, cy), r))

    def ink_top_of_dot(self):
        return self.st * 0.62

    # ---------------------------------------------------------- composite helpers
    def bowl(self, x0, x1, y0, y1, wl=1.05, wr=1.05, wt=1.0, wb=1.0, k=None):
        """Closed round shape by its ink box."""
        hh, s = self.hh, self.st
        xl, xr = x0 + s * wl / 2, x1 - s * wr / 2
        yb, yt = y0 + hh * wb / 2, y1 - hh * wt / 2
        xm, ym = (xl + xr) / 2, (yb + yt) / 2
        self.stroke([N(xr, ym, 'v', wr, k), N(xm, yt, 'h', wt, k), N(xl, ym, 'v', wl, k), N(xm, yb, 'h', wb, k)], closed=True)
        return xl, xr, yb, yt

    def ell_pt(self, cx, cy, rx, ry, deg):
        """Point and tangent (degrees, CCW travel) on the centre-line superellipse."""
        P = self.P
        n = 2.0 + max(0.0, (P.sq - 0.552)) * 9.0
        a = math.radians(deg)
        c, s = math.cos(a), math.sin(a)
        x = cx + rx * math.copysign(abs(c) ** (2 / n), c)
        y = cy + ry * math.copysign(abs(s) ** (2 / n), s)
        a2 = math.radians(deg + 0.5)
        c2, s2 = math.cos(a2), math.sin(a2)
        x2 = cx + rx * math.copysign(abs(c2) ** (2 / n), c2)
        y2 = cy + ry * math.copysign(abs(s2) ** (2 / n), s2)
        t = math.degrees(math.atan2(y2 - y, x2 - x))
        return x, y, t

    def arc_open(self, x0, x1, y0, y1, a_top, a_bot, c0='T', c1='T', wl=1.06, top_w=1.0, bot_w=1.0, mid=None):
        """A 'c'-like open stroke by ink box: from the upper terminal at angle a_top (deg, measured
        from +x, 0..90) round the left to the lower terminal at angle a_bot (deg, -90..0)."""
        hh, s = self.hh, self.st
        xl, xr = x0 + s * wl / 2, x1 - s / 2
        yb, yt = y0 + hh / 2, y1 - hh / 2
        cx, cy = (xl + xr) / 2, (yb + yt) / 2
        rx, ry = (xr - xl) / 2, (yt - yb) / 2
        ux, uy, ut = self.ell_pt(cx, cy, rx, ry, a_top)
        lx, ly, lt = self.ell_pt(cx, cy, rx, ry, a_bot)
        nodes = [N(ux, uy, ut, top_w), N(cx, yt, 'h'), N(xl, cy, 'v', wl), N(cx, yb, 'h'), N(lx, ly, lt, bot_w)]
        self.stroke(nodes, False, c0, c1)
        return (xl, xr, yb, yt, cx, cy, rx, ry)

    def vertex(self, apex, pa, pb, wa, wb):
        """Fill the outside of a V-join of two straight legs meeting at apex (from pa and pb).
        wa, wb: leg widths."""
        apex = np.array(apex, float)
        da = apex - np.array(pa, float)
        db = apex - np.array(pb, float)
        da /= np.linalg.norm(da)
        db /= np.linalg.norm(db)
        na = np.array([-da[1], da[0]])
        nb = np.array([-db[1], db[0]])
        # choose the outer normals (pointing away from the other leg)
        if np.dot(na, -db) > 0:
            na = -na
        if np.dot(nb, -da) > 0:
            nb = -nb
        oa = apex + na * wa / 2
        ob = apex + nb * wb / 2
        # intersection of the two outer edges
        M = np.array([[da[0], -db[0]], [da[1], -db[1]]])
        try:
            s, t = np.linalg.solve(M, ob - oa)
            mp = oa + da * s
            if np.linalg.norm(mp - apex) > 6 * max(wa, wb):
                mp = apex + (na + nb) / np.linalg.norm(na + nb) * max(wa, wb) * 3
        except np.linalg.LinAlgError:
            mp = apex + (na + nb) * 0.5 * max(wa, wb)
        self.poly([oa, mp, ob, apex - (da + db) * min(wa, wb) * 0.5])

    def leg(self, x0, y0, x1, y1, role='main', c0='B', c1='flat', wmul=1.0):
        self.line(x0, y0, x1, y1, c0, c1, role, wmul)
        return self.P.pen(self.st)((x1 - x0, y1 - y0), role) * wmul

    # ---------------------------------------------------------- serifs
    def serif(self, x, y, where='foot', side='both', w=None, scale=1.0):
        """where: 'foot' (sits on y, grows up), 'head' (hangs from y), 'flag' (top-left of a
        lowercase ascender), 'beak' (vertical serif at an arm end; x is the arm end, y arm centre)."""
        P = self.P
        if P.serif == 'none':
            return
        s = w if w is not None else self.st
        L = P.sl * scale
        T = P.sth * scale
        up = 1 if where in ('foot',) else -1
        sides = ('l', 'r') if side == 'both' else (side,)
        if where == 'flag':
            if P.serif in ('slab',):
                self.poly([(x - s / 2 - L * 1.1, y), (x, y), (x, y - T), (x - s / 2 - L * 1.1, y - T)])
            elif P.serif == 'wedge':
                self.poly([(x - s / 2 - L * 1.2, y - T * 0.2), (x + s / 2, y + T * 0.15), (x + s / 2, y - T * 1.6), (x - s / 2, y - T * 2.2)])
            else:
                th = T if P.serif != 'hair' else max(T, s * 0.35)
                self.poly([(x - s / 2 - L * 1.05, y - th * 1.05), (x - s / 2 - L * 0.8, y - th * 0.15), (x + s / 2, y + th * 0.25), (x + s / 2, y - th * 2.4), (x - s / 2, y - th * 2.6)])
            return
        if where == 'beak':
            ext = P.sl * 0.9 * scale
            th = max(self.hh, s * 0.5) if P.serif != 'hair' else self.hh
            bw = s * 0.45 if P.serif in ('slab', 'wedge') else s * 0.32
            dirn = 1 if y > 0 else -1
            # y: outer edge of the arm (top for T/E top, bottom for L/E bottom); hangs inward
            yy = y
            if P.serif == 'wedge':
                self.poly([(x - bw * 1.3, yy), (x, yy), (x, yy - dirn * (ext + th))])
            else:
                self.poly([(x - bw, yy), (x, yy), (x, yy - dirn * (ext + th * 0.6)), (x - bw, yy - dirn * (th * 0.6))])
            return
        for sd in sides:
            sg = -1 if sd == 'l' else 1
            xe = x + sg * s / 2
            xo = xe + sg * L
            if P.serif == 'slab':
                pts = [(xe - sg * s * 0.5, y), (xo, y), (xo, y + up * T), (xe - sg * s * 0.5, y + up * T)]
            elif P.serif == 'wedge':
                pts = [(xe - sg * 2, y), (xo, y), (xe - sg * 2, y + up * T * 2.6)]
            else:  # bracket / hair
                th = T if P.serif == 'bracket' else max(self.hh * 0.9, 8)
                br = L * (0.9 if P.serif == 'bracket' else 0.6)
                bh = th + br * 0.9
                pts = [(xe - sg * s * 0.5, y), (xo, y), (xo, y + up * th)]
                # concave bracket from (xo - sg*?) to stem edge
                for i in range(1, 9):
                    t = i / 9
                    bx = xo - sg * (L) * t
                    by = y + up * (th + (bh - th) * (t ** 2.2))
                    pts.append((bx, by))
                pts.append((xe, y + up * bh))
                pts.append((xe - sg * s * 0.5, y + up * bh))
            self.poly(pts)

    def foot_serifs(self, xs, y=0, where='foot'):
        for x in xs:
            self.serif(x, y, where)

    def trap(self, x, y, angle, depth=None, width=None):
        """Ink trap notch: a thin wedge cut into the ink at (x, y) pointing along angle (deg)."""
        P = self.P
        if P.inktrap <= 0:
            return
        d = depth or self.st * 0.55 * P.inktrap
        w = width or self.st * 0.22 * P.inktrap
        a = math.radians(angle)
        dv = np.array([math.cos(a), math.sin(a)])
        nv = np.array([-dv[1], dv[0]])
        p = np.array([x, y])
        self.cut([p - dv * 2 + nv * w, p + dv * d, p - dv * 2 - nv * w, p - dv * (w * 3)])

    # ---------------------------------------------------------- render
    def render(self, err=None):
        P = self.P
        pen = P.pen(self.st)
        k = P.sq
        polys = []
        noise = None
        for st in self.strokes:
            ext_needed = any(isinstance(c, tuple) and c[0] == 'cut' for c in (st.c0, st.c1))
            res, samples = expand(st, pen, k, P.chamfer, P.round_join or P.rounded, noise)
            if not res:
                continue
            if st.closed:
                outer, inner = res
                a_o, a_i = abs(area(outer)), abs(area(inner))
                if a_o < a_i:
                    outer, inner = inner, outer
                pp = [to_clip(orient(outer, True)), to_clip(orient(inner, False))]
                part = union(pp, pyclipper.PFT_POSITIVE)
            else:
                poly = res[0]
                if area(poly) < 0:
                    poly = poly[::-1]
                part = union([to_clip(poly)], pyclipper.PFT_POSITIVE)
                # cut caps: trim the flat end beyond the cut line, and add the wedge up to it.
                planes = cut_cap_planes(st) if ext_needed else []
                for which, (pt, nrm, outw) in zip([i for i, c in enumerate((st.c0, st.c1)) if isinstance(c, tuple) and c[0] == 'cut'], planes):
                    smp = samples[0] if which == 0 else samples[-1]
                    d = smp[1] if which == 0 else smp[2]
                    we = (st.fixed if st.fixed is not None else pen(d, st.role)) * smp[3] * st.wmul
                    pt = np.array(pt)
                    inside = to_clip(halfplane_poly(pt, nrm))
                    outside = to_clip(halfplane_poly(pt, -nrm))
                    trim = boolean([to_clip(circle(pt, we * 0.62, 40))], [outside], pyclipper.CT_INTERSECTION)
                    if trim:
                        part = boolean(part, trim, pyclipper.CT_DIFFERENCE)
                    side = np.array([-outw[1], outw[0]])
                    L = we * 1.8
                    rect = to_clip([pt + side * we / 2, pt + outw * L + side * we / 2, pt + outw * L - side * we / 2, pt - side * we / 2])
                    wedge = boolean([rect], [inside], pyclipper.CT_INTERSECTION)
                    if wedge:
                        part = union(part + wedge)
                # balls
                for which, cap in ((0, st.c0), (1, st.c1)):
                    if cap == 'ball':
                        smp = samples[0] if which == 0 else samples[-1]
                        p = smp[0]
                        d = smp[1] if which == 0 else smp[2]
                        r = self.st * P.ball
                        c = p - (d if which == 1 else -d) * r * 0.15
                        part = union(part + [to_clip(circle(c, r))])
            polys.extend(part)
        for a in self.adds:
            if area(a) < 0:
                a = a[::-1]
            polys.append(to_clip(a))
        res = union(polys)
        if self.subs:
            res = boolean(res, [to_clip(orient(s, True)) for s in self.subs], pyclipper.CT_DIFFERENCE)
        if self.clipbox:
            y0, y1 = self.clipbox
            y0 = -3000 if y0 is None else y0
            y1 = 3000 if y1 is None else y1
            box = [(-3000, y0), (6000, y0), (6000, y1), (-3000, y1)]
            res = boolean(res, [to_clip(box)], pyclipper.CT_INTERSECTION)
        if self.jit > 0 and res and not getattr(self, 'is_mark', False):
            # the whole letter sits a little off: tilt and baseline bounce
            j = self.jit
            ang = math.radians(self.rng.gauss(0, 1) * 2.2 * j)
            dy = self.rng.gauss(0, 1) * 9 * j
            pts = np.vstack([from_clip(p) for p in res])
            cx = (pts[:, 0].min() + pts[:, 0].max()) / 2
            cy = P.xh / 2
            ca, sa = math.cos(ang), math.sin(ang)
            out = []
            for p in res:
                q = from_clip(p) - [cx, cy]
                q = np.column_stack([q[:, 0] * ca - q[:, 1] * sa, q[:, 0] * sa + q[:, 1] * ca]) + [cx, cy + dy]
                out.append(to_clip(q))
            res = out
        if P.corner > 0 or P.softin > 0:
            res = soften(res, P.corner, P.softin)
        return normalize(res)


def normalize(paths):
    """Re-run a union through a PolyTree so outers are positive (CCW, y-up) and holes negative."""
    pc = pyclipper.Pyclipper()
    ok = False
    for p in paths:
        if len(p) >= 3:
            try:
                pc.AddPath(p, pyclipper.PT_SUBJECT, True)
                ok = True
            except pyclipper.ClipperException:
                pass
    if not ok:
        return []
    tree = pc.Execute2(pyclipper.CT_UNION, pyclipper.PFT_NONZERO, pyclipper.PFT_NONZERO)
    out = []

    def walk(node, depth):
        for ch in node.Childs:
            poly = from_clip(ch.Contour)
            if len(poly) >= 3 and abs(area(poly)) > 4:
                out.append(orient(poly, not ch.IsHole))
            walk(ch, depth + 1)
    walk(tree, 0)
    return out
