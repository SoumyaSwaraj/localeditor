"""Write the review sheets: all twenty on one page, one sheet per intent, one detailed
sheet per family. Render with: node tools/typefoundry/shoot.js <html> <png> [width] [dpr]

  python tools/typefoundry/sheets.py OUTDIR
"""
import html
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, HERE)
from families import FAMILIES, slug  # noqa: E402
import specimen  # noqa: E402

SAMPLES = {
    'attention': ['MEGA SALE 70% OFF', 'Doors open at 8 — be first in line!'],
    'trust': ['Your account is safe with us', 'Fees, terms and prices: no surprises. Cancel any time.'],
    'positive': ['Happy birthday, Maya!', 'Fresh cookies, warm hugs and a little bit of sunshine.'],
    'tension': ['WARNING: DO NOT ENTER', 'Something was moving behind the door. Then the lights went out.'],
}
INTENT_LABEL = {'attention': 'Attention', 'trust': 'Trust', 'positive': 'Positive feeling', 'tension': 'Tension'}


def fonts_for(fams, d):
    out = []
    for f in fams:
        s = slug(f['name'])
        for w in (400, 700):
            out.append({'family': f['name'], 'file': os.path.join(ROOT, 'assets/fonts/originals', s, '%s-%d.woff2' % (s, w)), 'weight': w})
    return out


def all_sheet(path, fams=FAMILIES, size=46):
    e = html.escape
    S = []
    for intent in ('attention', 'trust', 'positive', 'tension'):
        S.append('<h2 style="font:600 15px sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#7457F0;margin:26px 0 6px">%s</h2>' % INTENT_LABEL[intent])
        for f in [x for x in fams if x['intent'] == intent]:
            a, b = SAMPLES[intent]
            S.append('<div style="display:grid;grid-template-columns:150px 1fr;gap:16px;align-items:baseline;border-top:1px solid #eee;padding:8px 0">'
                     '<div class="lab">%s<br>%s</div><div>'
                     '<p style="font-family:\'%s\';font-size:%dpx;line-height:1.1">%s</p>'
                     '<p style="font-family:\'%s\';font-size:%dpx;line-height:1.1;font-weight:700">%s</p>'
                     '<p style="font-family:\'%s\';font-size:18px;line-height:1.35;margin-top:4px">%s</p></div></div>'
                     % (e(f['name']), e(', '.join(f['feel'])), f['name'], size, e(f['name'] + ' — ' + a), f['name'], int(size * 0.8), e(a), f['name'], e(b + ' 0123456789 €£$')))
    specimen.write(path, fonts_for(fams, ROOT), S, width=1500)


def intent_sheet(path, intent):
    fams = [f for f in FAMILIES if f['intent'] == intent]
    e = html.escape
    S = ['<h1 style="font:700 22px sans-serif">%s</h1>' % INTENT_LABEL[intent]]
    for f in fams:
        S.append('<div style="border-top:1px solid #ddd;padding:10px 0"><div class="lab">%s · %s</div>' % (e(f['name']), e(f['description'])))
        S.append('<p style="font-family:\'%s\';font-size:64px;line-height:1.05">%s</p>' % (f['name'], e(SAMPLES[intent][0])))
        S.append('<p style="font-family:\'%s\';font-size:34px;font-weight:700">%s</p>' % (f['name'], 'Hamburgefontsiv ABCDEFGHIJKLMNOPQRSTUVWXYZ'))
        S.append('<p style="font-family:\'%s\';font-size:34px">%s</p>' % (f['name'], 'abcdefghijklmnopqrstuvwxyz 0123456789 &@?!'))
        S.append('<p style="font-family:\'%s\';font-size:24px">%s</p>' % (f['name'], e(specimen.PRICES)))
        S.append('<p style="font-family:\'%s\';font-size:16px;max-width:640px;line-height:1.5">%s</p></div>' % (f['name'], e(specimen.PARA)))
    specimen.write(path, fonts_for(fams, ROOT), S, width=1500)


def family_sheet(path, f):
    S = specimen.one_font_sections(f['name'], f['name'])
    specimen.write(path, fonts_for([f], ROOT), S)


if __name__ == '__main__':
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    all_sheet(os.path.join(out, 'all-20.html'))
    for i in ('attention', 'trust', 'positive', 'tension'):
        intent_sheet(os.path.join(out, 'intent-%s.html' % i), i)
    for f in FAMILIES:
        family_sheet(os.path.join(out, 'family-%s.html' % slug(f['name'])), f)
