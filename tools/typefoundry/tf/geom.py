"""Skeleton -> outline geometry.

A glyph is drawn as centre-line strokes (nodes with tangents), expanded with a
direction-dependent pen (stroke contrast and stress), capped, unioned with
Clipper (overlaps removed), optionally softened, then fitted back to cubic
Beziers with nodes on extrema.
"""
import math
import numpy as np
import pyclipper

SCALE = 16  # Clipper integer scale


# ---------------------------------------------------------------- skeleton DSL
class N:
    """Skeleton node. t = tangent axis: 'h', 'v', degrees, or None (corner).
    w = width multiplier at this node; k = curve tension override."""
    __slots__ = ('x', 'y', 't', 'w', 'k')

    def __init__(self, x, y, t=None, w=1.0, k=None):
        self.x, self.y, self.t, self.w, self.k = float(x), float(y), t, w, k


class Stroke:
    """caps: 'S' stem end, 'T' terminal, 'B' baseline/topline cut (horizontal),
    'flat', 'round', ('cut', deg), 'ball', 'taper', 'none' (flat, hidden)."""

    def __init__(self, nodes, closed=False, c0='S', c1='S', wmul=1.0, role='main', fixed=None):
        self.nodes = nodes
        self.closed = closed
        self.c0, self.c1 = c0, c1
        self.wmul = wmul
        self.role = role      # 'main' | 'thin'
        self.fixed = fixed    # fixed width in units (overrides pen model)


def _tan(t):
    if t is None:
        return None
    if t == 'h':
        return np.array([1.0, 0.0])
    if t == 'v':
        return np.array([0.0, 1.0])
    a = math.radians(t)
    return np.array([math.cos(a), math.sin(a)])


def _unit(v):
    n = math.hypot(v[0], v[1])
    return v / n if n > 1e-9 else np.array([1.0, 0.0])


def segment_ctrl(A, B, k_default, chamfer=0.0):
    """Return list of control polygons: ('L', p0, p1) or ('C', p0, c1, c2, p3)."""
    p0 = np.array([A.x, A.y])
    p3 = np.array([B.x, B.y])
    chord = p3 - p0
    ta, tb = _tan(A.t), _tan(B.t)
    if ta is None and tb is None:
        return [('L', p0, p3)]
    if ta is None:
        ta = _unit(chord)
    if tb is None:
        tb = _unit(chord)
    if np.dot(ta, chord) < 0:
        ta = -ta
    if np.dot(tb, chord) < 0:
        tb = -tb
    k = A.k if A.k is not None else (B.k if B.k is not None else k_default)
    # intersection of rays p0 + s*ta and p3 - u*tb
    M = np.array([[ta[0], tb[0]], [ta[1], tb[1]]])
    det = np.linalg.det(M)
    s = u = None
    if abs(det) > 1e-6:
        s, u = np.linalg.solve(M, chord)
    if s is not None and s > 1e-3 and u > 1e-3:
        I = p0 + ta * s
        if chamfer > 0:
            q1 = p0 + (I - p0) * (1 - chamfer)
            q2 = p3 + (I - p3) * (1 - chamfer)
            return [('L', p0, q1), ('L', q1, q2), ('L', q2, p3)]
        c1 = p0 + ta * s * k
        c2 = p3 - tb * u * k
    else:
        d = np.linalg.norm(chord)
        if np.linalg.norm(_unit(chord) - ta) < 1e-3 and np.linalg.norm(_unit(chord) - tb) < 1e-3:
            return [('L', p0, p3)]
        if chamfer > 0:
            return [('L', p0, p3)]
        c1 = p0 + ta * d * 0.36 * (k / 0.55)
        c2 = p3 - tb * d * 0.36 * (k / 0.55)
    return [('C', p0, c1, c2, p3)]


def _bez(c, t):
    p0, c1, c2, p3 = c
    mt = 1 - t
    return (mt ** 3) * p0 + 3 * mt * mt * t * c1 + 3 * mt * t * t * c2 + t ** 3 * p3


def _bezd(c, t):
    p0, c1, c2, p3 = c
    mt = 1 - t
    d = 3 * mt * mt * (c1 - p0) + 6 * mt * t * (c2 - c1) + 3 * t * t * (p3 - c2)
    if np.linalg.norm(d) < 1e-9:
        d = p3 - p0
    return d


def sample_stroke(st, k_default, chamfer, step=3.0):
    """Returns list of samples: (pt, dir_in, dir_out, wmul, s_norm)."""
    nodes = st.nodes
    pairs = list(zip(nodes[:-1], nodes[1:]))
    if st.closed:
        pairs.append((nodes[-1], nodes[0]))
    pieces = []  # (ctrl, wA, wB)
    for A, B in pairs:
        segs = segment_ctrl(A, B, k_default, chamfer)
        n = len(segs)
        for i, sg in enumerate(segs):
            wa = A.w + (B.w - A.w) * (i / n)
            wb = A.w + (B.w - A.w) * ((i + 1) / n)
            pieces.append((sg, wa, wb))
    raw = []  # (pt, dir, w, piece_index, is_start)
    for pi, (sg, wa, wb) in enumerate(pieces):
        if sg[0] == 'L':
            p0, p1 = sg[1], sg[2]
            L = np.linalg.norm(p1 - p0)
            d = _unit(p1 - p0)
            n = max(1, int(L / (step * 3)))
            for i in range(n + 1):
                t = i / n
                tw = t * t * (3 - 2 * t)
                raw.append((p0 + (p1 - p0) * t, d, wa + (wb - wa) * tw, pi, i == 0, i == n))
        else:
            c = sg[1:]
            L = sum(np.linalg.norm(c[i + 1] - c[i]) for i in range(3))
            n = max(4, int(L / step))
            for i in range(n + 1):
                t = i / n
                tw = t * t * (3 - 2 * t)
                raw.append((_bez(c, t), _unit(_bezd(c, t)), wa + (wb - wa) * tw, pi, i == 0, i == n))
    # merge piece boundaries into single samples with in/out directions
    out = []
    i = 0
    while i < len(raw):
        p, d, w, pi, s0, s1 = raw[i]
        if s1 and i + 1 < len(raw) and raw[i + 1][4]:
            q = raw[i + 1]
            out.append([p, d, q[1], (w + q[2]) / 2])
            i += 2
            continue
        out.append([p, d, d, w])
        i += 1
    if st.closed and len(out) > 2:
        # first and last coincide
        first, last = out[0], out[-1]
        if np.linalg.norm(first[0] - last[0]) < 1e-6:
            first[1] = last[1]
            out.pop()
    # arc-length parameter
    acc = [0.0]
    for j in range(1, len(out)):
        acc.append(acc[-1] + float(np.linalg.norm(out[j][0] - out[j - 1][0])))
    tot = acc[-1] or 1.0
    return [(o[0], o[1], o[2], o[3], acc[j] / tot) for j, o in enumerate(out)], tot


def _left(d):
    return np.array([-d[1], d[0]])


def _arc(c, r, a0, a1, step_deg=9):
    """points on circle c radius r from angle a0 to a1 (radians), going the short/positive way as given."""
    n = max(2, int(abs(a1 - a0) / math.radians(step_deg)))
    return [c + r * np.array([math.cos(a0 + (a1 - a0) * i / n), math.sin(a0 + (a1 - a0) * i / n)]) for i in range(n + 1)]


def expand(st, pen, k_default, chamfer=0.0, round_join=False, noise=None):
    """Expand one stroke into polygons (list of np arrays) with positive orientation intended.
    pen(dir, role) -> width. noise(s) -> multiplier (optional)."""
    samples, length = sample_stroke(st, k_default, chamfer)
    n = len(samples)
    if n < 2:
        return [], samples

    def W(d, wm, s):
        if st.fixed is not None:
            base = st.fixed
        else:
            base = pen(d, st.role)
        w = base * wm * st.wmul
        if noise is not None:
            w *= noise(s)
        return w

    # taper caps modulate width near ends
    def taper_mul(s):
        m = 1.0
        if st.c0 == 'taper' and s < 0.3:
            m *= 0.18 + 0.82 * (s / 0.3) ** 0.7
        if st.c1 == 'taper' and s > 0.7:
            m *= 0.18 + 0.82 * ((1 - s) / 0.3) ** 0.7
        return m

    L, R = [], []
    for j, (p, din, dout, wm, s) in enumerate(samples):
        tm = taper_mul(s)
        win, wout = W(din, wm, s) * tm, W(dout, wm, s) * tm
        turn = math.degrees(math.atan2(din[0] * dout[1] - din[1] * dout[0], float(np.dot(din, dout))))
        if abs(turn) < 6:
            d = _unit(din + dout)
            w = (win + wout) / 2
            nl = _left(d)
            L.append(p + nl * w / 2)
            R.append(p - nl * w / 2)
            continue
        nin, nout = _left(din), _left(dout)
        # outer side: left if right turn (turn<0)
        for side, arr, sign in (('L', L, 1), ('R', R, -1)):
            a = p + sign * nin * win / 2
            b = p + sign * nout * wout / 2
            outer = (turn < 0 and sign == 1) or (turn > 0 and sign == -1)
            arr.append(a)
            if outer:
                if round_join:
                    a0 = math.atan2(*(sign * nin)[::-1])
                    a1 = math.atan2(*(sign * nout)[::-1])
                    da = (a1 - a0 + math.pi) % (2 * math.pi) - math.pi
                    for q in _arc(p, (win + wout) / 4, a0, a0 + da)[1:-1]:
                        arr.append(q)
                else:
                    m = _unit(sign * nin + sign * nout)
                    half = math.radians(abs(turn)) / 2
                    ml = ((win + wout) / 4) / max(math.cos(half), 0.35)
                    arr.append(p + m * ml)
            else:
                arr.append(p)  # pass through centre keeps inner side tidy
            arr.append(b)
    polys = []
    if st.closed:
        polys.append(np.array(L))
        polys.append(np.array(R[::-1]))
        return polys, samples
    poly = list(L)
    # end cap
    pe, de = samples[-1][0], samples[-1][2]
    we = W(de, samples[-1][3], 1.0) * taper_mul(1.0)
    poly += _cap(pe, de, we, st.c1, end=True)
    poly += R[::-1]
    ps, ds = samples[0][0], samples[0][1]
    ws = W(ds, samples[0][3], 0.0) * taper_mul(0.0)
    poly += _cap(ps, -ds, ws, st.c0, end=True, reverse=True)
    return [np.array(poly)], samples


def _cap(p, d, w, kind, end=True, reverse=False):
    """Points between left offset and right offset at an end point, going around the end.
    d points outward (direction of travel past the end)."""
    nl = _left(d)
    if kind == 'round':
        a0 = math.atan2(nl[1], nl[0])
        pts = _arc(p, w / 2, a0, a0 - math.pi, 10)
        return pts[1:-1]
    return []


def cut_cap_planes(st, samples=None):
    """Half-planes for ('cut', deg) caps of the ORIGINAL stroke: list of (point, inward normal)."""
    planes = []
    nodes = st.nodes
    for which in (0, 1):
        kind = st.c0 if which == 0 else st.c1
        if not (isinstance(kind, tuple) and kind[0] == 'cut'):
            continue
        a = nodes[0] if which == 0 else nodes[-1]
        b = nodes[1] if which == 0 else nodes[-2]
        p = np.array([a.x, a.y])
        t = _tan(a.t)
        ch = p - np.array([b.x, b.y])
        if t is None:
            t = _unit(ch)
        if np.dot(t, ch) < 0:
            t = -t
        outward = t
        ang = math.radians(kind[1])
        ld = np.array([math.cos(ang), math.sin(ang)])
        nrm = _left(ld)
        if np.dot(nrm, outward) > 0:
            nrm = -nrm
        if abs(np.dot(nrm, outward)) < 0.74:
            # cut nearly parallel to the stroke: turn it by 90 degrees
            nrm = _left(nrm)
            if np.dot(nrm, outward) > 0:
                nrm = -nrm
        planes.append((p, nrm, outward))
    return planes


def extend_for_cut(st, ext):
    """Return a copy of stroke with nodes extended at cut ends so the cut has material."""
    nodes = list(st.nodes)

    def endtan(i0, i1):
        a, b = nodes[i0], nodes[i1]
        t = _tan(a.t)
        ch = np.array([a.x - b.x, a.y - b.y])
        if t is None:
            t = _unit(ch)
        if np.dot(t, ch) < 0:
            t = -t
        return t
    if isinstance(st.c0, tuple) and st.c0[0] == 'cut':
        t = endtan(0, 1)
        a = nodes[0]
        nodes = [N(a.x + t[0] * ext, a.y + t[1] * ext, a.t, a.w)] + [N(a.x, a.y, a.t if a.t is not None else math.degrees(math.atan2(t[1], t[0])), a.w, a.k)] + nodes[1:]
    if isinstance(st.c1, tuple) and st.c1[0] == 'cut':
        t = endtan(len(nodes) - 1, len(nodes) - 2)
        a = nodes[-1]
        nodes = nodes[:-1] + [N(a.x, a.y, a.t if a.t is not None else math.degrees(math.atan2(t[1], t[0])), a.w, a.k), N(a.x + t[0] * ext, a.y + t[1] * ext, a.t, a.w)]
    s2 = Stroke(nodes, st.closed, st.c0, st.c1, st.wmul, st.role, st.fixed)
    return s2


# ---------------------------------------------------------------- clipper ops
def to_clip(poly):
    return [(int(round(x * SCALE)), int(round(y * SCALE))) for x, y in poly]


def from_clip(path):
    return np.array(path, dtype=float) / SCALE


def area(poly):
    x, y = poly[:, 0], poly[:, 1]
    return 0.5 * float(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))


def orient(poly, positive=True):
    a = area(poly)
    if (a > 0) != positive:
        return poly[::-1]
    return poly


def union(paths, fill=pyclipper.PFT_NONZERO):
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
    return pc.Execute(pyclipper.CT_UNION, fill, fill)


def boolean(subj, clip, op):
    pc = pyclipper.Pyclipper()
    for p in subj:
        if len(p) >= 3:
            try:
                pc.AddPath(p, pyclipper.PT_SUBJECT, True)
            except pyclipper.ClipperException:
                pass
    for p in clip:
        if len(p) >= 3:
            try:
                pc.AddPath(p, pyclipper.PT_CLIP, True)
            except pyclipper.ClipperException:
                pass
    return pc.Execute(op, pyclipper.PFT_NONZERO, pyclipper.PFT_NONZERO)


def halfplane_poly(p, nrm, big=4000):
    """Big polygon covering the half-plane {x : (x-p).nrm >= 0}."""
    d = np.array([-nrm[1], nrm[0]])
    a = p + d * big
    b = p - d * big
    c = b + nrm * big
    e = a + nrm * big
    return [a, b, c, e]


def offset(paths, delta, join=pyclipper.JT_ROUND):
    po = pyclipper.PyclipperOffset(2.0, 0.2 * SCALE)
    po.AddPaths(paths, join, pyclipper.ET_CLOSEDPOLYGON)
    return po.Execute(delta * SCALE)


def soften(paths, r_convex=0.0, r_concave=0.0):
    if r_convex > 0.5:
        paths = offset(offset(paths, -r_convex), r_convex)
    if r_concave > 0.5:
        paths = offset(offset(paths, r_concave), -r_concave)
    return paths


def circle(c, r, n=None):
    n = n or max(16, int(r * 0.8))
    return np.array([[c[0] + r * math.cos(2 * math.pi * i / n), c[1] + r * math.sin(2 * math.pi * i / n)] for i in range(n)])


# ---------------------------------------------------------------- curve fitting
def _chord_param(pts):
    d = np.r_[0, np.cumsum(np.linalg.norm(np.diff(pts, axis=0), axis=1))]
    return d / d[-1] if d[-1] > 0 else d


def _gen_bezier(pts, u, t0, t1):
    p0, p3 = pts[0], pts[-1]
    A0 = np.outer(3 * (1 - u) ** 2 * u, t0)
    A1 = np.outer(3 * (1 - u) * u ** 2, t1)
    C00 = np.sum(A0 * A0)
    C01 = np.sum(A0 * A1)
    C11 = np.sum(A1 * A1)
    b0 = (1 - u) ** 3 + 3 * (1 - u) ** 2 * u
    b1 = 3 * (1 - u) * u ** 2 + u ** 3
    tmp = pts - np.outer(b0, p0) - np.outer(b1, p3)
    X0 = np.sum(A0 * tmp)
    X1 = np.sum(A1 * tmp)
    det = C00 * C11 - C01 * C01
    seg = np.linalg.norm(p3 - p0)
    if abs(det) < 1e-12:
        a0 = a1 = seg / 3
    else:
        a0 = (X0 * C11 - X1 * C01) / det
        a1 = (C00 * X1 - C01 * X0) / det
    eps = 1e-6 * seg
    if a0 < eps or a1 < eps or a0 > seg * 2 or a1 > seg * 2:
        a0 = a1 = seg / 3
    return (p0, p0 + t0 * a0, p3 + t1 * a1, p3)


def _bez_np(c, u):
    p0, c1, c2, p3 = c
    mu = 1 - u
    return (np.outer(mu ** 3, p0) + np.outer(3 * mu * mu * u, c1) + np.outer(3 * mu * u * u, c2) + np.outer(u ** 3, p3))


def _max_err(pts, c, u):
    q = _bez_np(c, u)
    d = np.linalg.norm(q - pts, axis=1)
    i = int(np.argmax(d))
    return d[i], i


def _reparam(pts, c, u):
    p0, c1, c2, p3 = c
    q = _bez_np(c, u)
    mu = 1 - u
    d1 = np.outer(3 * mu * mu, c1 - p0) + np.outer(6 * mu * u, c2 - c1) + np.outer(3 * u * u, p3 - c2)
    d2 = np.outer(6 * mu, c2 - 2 * c1 + p0) + np.outer(6 * u, p3 - 2 * c2 + c1)
    num = np.sum((q - pts) * d1, axis=1)
    den = np.sum(d1 * d1, axis=1) + np.sum((q - pts) * d2, axis=1)
    den[np.abs(den) < 1e-9] = 1e-9
    nu = np.clip(u - num / den, 0, 1)
    nu[0], nu[-1] = 0, 1
    return nu


def fit_curve(pts, t0, t1, err, depth=0):
    if len(pts) == 2 or np.linalg.norm(pts[-1] - pts[0]) < 1e-6:
        d = np.linalg.norm(pts[-1] - pts[0]) / 3
        return [(pts[0], pts[0] + t0 * d, pts[-1] + t1 * d, pts[-1])]
    u = _chord_param(pts)
    c = _gen_bezier(pts, u, t0, t1)
    e, i = _max_err(pts, c, u)
    if e < err:
        return [c]
    if e < err * 6:
        for _ in range(6):
            u = _reparam(pts, c, u)
            c = _gen_bezier(pts, u, t0, t1)
            e, i = _max_err(pts, c, u)
            if e < err:
                return [c]
    if depth > 12 or len(pts) < 4:
        return [c]
    i = min(max(i, 1), len(pts) - 2)
    tc = _unit(pts[i - 1] - pts[i + 1])
    return fit_curve(pts[:i + 1], t0, tc, err, depth + 1) + fit_curve(pts[i:], -tc, t1, err, depth + 1)


def _dedupe(poly, tol=0.4):
    out = [poly[0]]
    for p in poly[1:]:
        if np.linalg.norm(p - out[-1]) > tol:
            out.append(p)
    if len(out) > 1 and np.linalg.norm(out[0] - out[-1]) < tol:
        out.pop()
    return np.array(out)


def _simplify_collinear(poly, tol=0.15):
    """drop vertices lying on straight runs (keeps shape exactly)."""
    n = len(poly)
    keep = []
    for i in range(n):
        a, b, c = poly[i - 1], poly[i], poly[(i + 1) % n]
        ab, bc = b - a, c - b
        cr = abs(ab[0] * bc[1] - ab[1] * bc[0]) / (np.linalg.norm(ab) * np.linalg.norm(bc) + 1e-9)
        if cr > tol * 0.01 or np.dot(ab, bc) < 0:
            keep.append(i)
    return poly[keep] if len(keep) >= 3 else poly


def fit_contour(poly, err=1.2, corner_deg=32):
    """poly: closed polygon (np array). Returns list of segments for a closed contour:
    each ('L', p0, p1) or ('C', p0, c1, c2, p3)."""
    poly = _dedupe(poly)
    n = len(poly)
    if n < 3:
        return []
    # corners
    brk = set()
    dirs = []
    for i in range(n):
        a, b, c = poly[i - 1], poly[i], poly[(i + 1) % n]
        v1, v2 = _unit(b - a), _unit(c - b)
        ang = math.degrees(math.acos(max(-1, min(1, float(np.dot(v1, v2))))))
        dirs.append(ang)
        if ang > corner_deg:
            brk.add(i)
    # long straight edges: both ends break (so lines stay lines)
    for i in range(n):
        j = (i + 1) % n
        if np.linalg.norm(poly[j] - poly[i]) > 24:
            brk.add(i)
            brk.add(j)
    # extrema (x and y) along smooth runs
    for axis in (0, 1):
        vals = poly[:, axis]
        for i in range(n):
            prev = vals[i - 1]
            cur = vals[i]
            # find next differing value
            j = (i + 1) % n
            steps = 0
            while abs(vals[j] - cur) < 1e-6 and steps < n:
                j = (j + 1) % n
                steps += 1
            nxt = vals[j]
            if (cur > prev + 1e-6 and cur > nxt + 1e-6) or (cur < prev - 1e-6 and cur < nxt - 1e-6):
                brk.add(i)
            elif steps > 0 and ((cur > prev and cur > nxt) or (cur < prev and cur < nxt)):
                # plateau: break at both ends
                brk.add(i)
                brk.add((j - 1) % n)
    if not brk:
        brk = {int(np.argmax(poly[:, 1]))}
    b = sorted(brk)
    segs = []
    for k in range(len(b)):
        i0 = b[k]
        i1 = b[(k + 1) % len(b)]
        if i1 <= i0:
            idx = list(range(i0, n)) + list(range(0, i1 + 1))
        else:
            idx = list(range(i0, i1 + 1))
        pts = poly[idx]
        if len(pts) < 2:
            continue
        chord = pts[-1] - pts[0]
        cl = np.linalg.norm(chord)
        if cl < 1e-6:
            continue
        # straight?
        if len(pts) == 2:
            segs.append(('L', pts[0], pts[-1]))
            continue
        nrm = _left(chord / cl)
        dev = np.abs((pts - pts[0]) @ nrm).max()
        if dev < 0.6:
            segs.append(('L', pts[0], pts[-1]))
            continue
        # tangents: from neighbouring points, snapped to H/V at extrema
        t0 = _unit(pts[min(2, len(pts) - 1)] - pts[0]) if len(pts) > 2 else _unit(pts[1] - pts[0])
        t1 = _unit(pts[max(-3, -len(pts))] - pts[-1]) if len(pts) > 2 else _unit(pts[-2] - pts[-1])
        # use local smooth tangent at a smooth breakpoint (extremum): average of both sides
        def smooth_t(i, forward):
            if dirs[i] > corner_deg:
                return None
            a = poly[(i - 2) % n]
            c = poly[(i + 2) % n]
            t = _unit(c - a)
            if abs(t[0]) > 0.985:
                t = np.array([math.copysign(1, t[0]), 0.0])
            elif abs(t[1]) > 0.985:
                t = np.array([0.0, math.copysign(1, t[1])])
            return t if forward else -t
        s0 = smooth_t(i0, True)
        s1 = smooth_t(i1, False)
        if s0 is not None:
            t0 = s0
        if s1 is not None:
            t1 = s1
        for c in fit_curve(pts, t0, t1, err):
            segs.append(('C',) + tuple(c))
    return segs


def cubic_extrema_split(seg):
    """Split a cubic at interior x/y extrema."""
    from fontTools.misc.bezierTools import splitCubicAtT
    p0, c1, c2, p3 = seg[1:]
    ts = []
    for ax in (0, 1):
        a = -p0[ax] + 3 * c1[ax] - 3 * c2[ax] + p3[ax]
        b = 2 * (p0[ax] - 2 * c1[ax] + c2[ax])
        c = c1[ax] - p0[ax]
        roots = []
        if abs(a) < 1e-9:
            if abs(b) > 1e-9:
                roots = [-c / b]
        else:
            disc = b * b - 4 * a * c
            if disc >= 0:
                sq = math.sqrt(disc)
                roots = [(-b + sq) / (2 * a), (-b - sq) / (2 * a)]
        for r in roots:
            if 0.04 < r < 0.96:
                ts.append(r)
    if not ts:
        return [seg]
    ts = sorted(set(round(t, 4) for t in ts))
    parts = splitCubicAtT(*[tuple(float(v) for v in q) for q in (p0, c1, c2, p3)], *ts)
    return [('C',) + tuple(np.array(q) for q in part) for part in parts]
