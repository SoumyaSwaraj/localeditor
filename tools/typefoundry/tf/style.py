"""Design parameters for one instance (one family at one weight)."""
import math

# Shared vertical metrics: identical across all twenty families so they can be
# swapped in a layout without the line box jumping.
UPM = 1000
ASCENT = 950
DESCENT = -250

DEFAULTS = dict(
    # proportions
    cap=700, xh=510, asc=745, desc=-205, ov=11,
    wid=1.0,            # horizontal scale of the letter bodies
    # pen
    st=86,              # lowercase vertical stem
    capst=1.06,         # caps stem / lowercase stem
    ratio=0.86,         # horizontal stroke / vertical stem (contrast; 1 = monoline)
    stress=0.0,         # tilt of the axis of contrast, degrees (+ = backward lean, humanist)
    # curves
    sq=0.58,            # curve tension 0.55 round ... 0.8 squarish
    chamfer=0.0,        # >0 replaces curves with straight chamfers (angular)
    round_join=False,
    # terminals and ends
    term='h',           # terminal on c e s a r f j y: 'h','v','flat','round','ball','taper',('cut',deg)
    stemcap='flat',     # stem ends: 'flat' | 'round'
    diagcut='B',        # diagonal ends at base/top line: 'B' cut horizontal, 'round'
    ball=0.6,
    apex='flat',        # 'flat' | 'point' | 'over' (pointed with overshoot)
    # serifs
    serif='none',       # 'none','slab','bracket','wedge','hair'
    sl=0.0,             # serif length (each side), units
    sth=0.0,            # serif thickness (slab) or base height (wedge)
    # openness
    aperture=0.45,      # 0 closed (grotesque) ... 1 open (humanist)
    # finish
    slant=0.0,          # degrees
    jitter=0.0,         # 0..1 hand irregularity
    seed=7,
    track=0,            # extra units each side
    spacing=1.0,        # multiplier on optical spacing
    inktrap=0.0,        # 0..1 notch depth at junctions
    corner=0.0,         # radius of rounding of convex corners (units)
    softin=0.0,         # radius of rounding of concave corners
    join=0.82,          # stroke thinning where arches meet stems
    dot='round',        # 'round','square','diamond'
    # skeleton variants
    v=None,
)

VARIANT_DEFAULTS = dict(a=2, g=1, y='straight', l='plain', e='h', R='diag', G='bar', Q='tail',
                        M='vertical', J='base', one='flag', four='closed', seven='straight', t='plain',
                        k='arm', u='stem', W='crossed', i='plain', f='plain', zero='plain', amp='classic',
                        dollar='through', ss='plain')


class Style:
    def __init__(self, **kw):
        d = dict(DEFAULTS)
        d.update(kw)
        v = dict(VARIANT_DEFAULTS)
        v.update(d.get('v') or {})
        d['v'] = v
        for k, val in d.items():
            setattr(self, k, val)
        self.stc = self.st * self.capst
        if self.term == 'h':
            self.term = ('cut', 0)
        elif self.term == 'v':
            self.term = ('cut', 90)
        self.rounded = self.stemcap == 'round'

    def hair(self, stem):
        return stem * self.ratio

    def thin(self, stem):
        return stem * (1 - (1 - self.ratio) * 0.9)

    def pen(self, stem):
        hair = self.hair(stem)
        phi = math.radians(self.stress)
        norm = abs(math.cos(phi)) or 1.0
        thin = self.thin(stem)

        def f(d, role):
            if role == 'thin':
                return thin
            if role == 'hair':
                return hair
            th = math.atan2(d[1], d[0])
            s = abs(math.sin(th - phi)) / norm
            return hair + (stem - hair) * min(s, 1.06)
        return f

    def U(self, frac, stems=2):
        """Cap width: fraction of cap height scaled by width, plus weight growth."""
        return frac * self.cap * self.wid + stems * (self.stc - 86) * 0.55

    def V(self, frac, stems=2):
        """Lowercase width relative to x-height."""
        return frac * self.xh * self.wid * 1.02 + stems * (self.st - 86) * 0.55
