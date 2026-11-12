"""Optical spacing and kerning from outline profiles.

Spacing follows the idea behind HT Letterspacer: within a reference zone, the white
area between a glyph's side profile (limited to a fixed depth) and its sidebearing
line is made equal for every glyph, so straight, round and open sides all get the
same optical amount of space.

Kerning uses a non-additive measure: for a pair, the per-row gap is the sum of the two
sides' (depth-limited) white; spacing already balances each side's average. What is
left is the case where the two sides' white never lines up — AV, To, LT, r. — where
the smallest row-gap of the pair is much bigger than the sum of each side's own
smallest white. kern = -(min_y(wL + wR) - min wL - min wR) * strength, then a
collision guard keeps a minimum ink distance.
"""
import numpy as np


def edges(polys):
    E = []
    for p in polys:
        q = np.roll(p, -1, axis=0)
        E.append(np.hstack([p, q]))
    return np.vstack(E) if E else np.zeros((0, 4))


def profile(polys, ys):
    """Left and right ink extents at each y (nan where no ink)."""
    E = edges(polys)
    L = np.full(len(ys), np.nan)
    R = np.full(len(ys), np.nan)
    if not len(E):
        return L, R
    x0, y0, x1, y1 = E[:, 0], E[:, 1], E[:, 2], E[:, 3]
    for i, y in enumerate(ys):
        m = ((y0 <= y) & (y1 > y)) | ((y1 <= y) & (y0 > y))
        if not m.any():
            continue
        t = (y - y0[m]) / (y1[m] - y0[m])
        xs = x0[m] + t * (x1[m] - x0[m])
        L[i] = xs.min()
        R[i] = xs.max()
    return L, R


class Spacer:
    def __init__(self, P):
        self.P = P
        self.depth = P.xh * 0.16
        self.kdepth = P.xh * 0.42
        cn = P.V(0.86) - 2 * P.st
        cH = P.U(0.76) - 2 * P.stc
        sp = P.spacing
        self.sb_lc = sp * (0.25 * cn + 0.20 * P.st) + P.track
        self.sb_uc = sp * (0.20 * cH + 0.24 * P.stc) + P.track
        self.rows = 40

    def zone(self, case, polys):
        P = self.P
        if case == 'lc':
            return 0, P.xh
        if case in ('uc', 'fig'):
            return 0, P.cap
        ys = np.vstack(polys)[:, 1]
        lo, hi = ys.min(), ys.max()
        if hi - lo < 1:
            hi = lo + 1
        return lo, hi

    def sidebearings(self, polys, case, name=''):
        """Returns (lsb, rsb) relative to ink extremes."""
        if not polys:
            self.last_extent = (0, 0)
            return 0, 0
        P = self.P
        y0, y1 = self.zone(case, polys)
        ys = np.linspace(y0 + 0.5, y1 - 0.5, self.rows)
        L, R = profile(polys, ys)
        allx = np.vstack(polys)[:, 0]
        xmin, xmax = allx.min(), allx.max()
        if not np.all(np.isnan(L)):
            # measure from the extremes inside the zone, so hooks and tails outside it
            # (j, f, y, comma) are allowed to overhang
            xmin, xmax = np.nanmin(L), np.nanmax(R)
        self.last_extent = (xmin, xmax)
        d = self.depth
        wl = np.where(np.isnan(L), d, np.minimum(L - xmin, d))
        wr = np.where(np.isnan(R), d, np.minimum(xmax - R, d))
        tgt = self.sb_uc if case in ('uc', 'fig') else self.sb_lc
        if case == 'sym':
            tgt = self.sb_lc * 0.95
        lsb = tgt - wl.mean() * 0.86
        rsb = tgt - wr.mean() * 0.86
        floor = tgt * 0.18
        return max(lsb, floor), max(rsb, floor)

    # ---------------------------------------------------------- kerning
    def side_rows(self, polys, adv, xoff):
        """Per-row white from the right edge (advance) and from the left edge (0)."""
        P = self.P
        ys = np.linspace(P.desc * 0.9, P.cap + P.ov, 64)
        L, R = profile(polys, ys)
        d = self.kdepth
        lw = np.where(np.isnan(L), np.inf, L)          # distance from origin to left ink
        rw = np.where(np.isnan(R), np.inf, adv - R)    # distance from right ink to advance
        return lw, rw

    def kern(self, A, B, strength=0.48):
        """A, B: dicts with 'lw','rw' arrays (inf where empty). Returns kern value."""
        d = self.kdepth
        ra = np.minimum(A['rw'], A['rsb'] + d)
        lb = np.minimum(B['lw'], B['lsb'] + d)
        gap = ra + lb
        base = (A['rsb'] + B['lsb'])
        excess = gap.min() - base
        k = -excess * strength
        # collision guard: true ink distance (with a little vertical blur)
        rr = A['rw'].copy()
        ll = B['lw'].copy()
        def blur(a):
            up = np.r_[a[1:], np.inf]
            dn = np.r_[np.inf, a[:-1]]
            return np.minimum.reduce([a, up, dn])
        blur_r = blur(rr)
        blur_l = blur(ll)
        true_gap = (blur_r + blur_l).min()
        min_gap = base * 0.55
        if np.isfinite(true_gap):
            k = max(k, min_gap - true_gap)
        k = max(k, -(self.P.xh * 0.19))
        return k
