"""Fill the generated block of /fonts/index.html (the family cards) from families.py."""
import base64
import html
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))

GROUPS = [
    ('attention', 'Attention', 'Fonts that get noticed first.',
     'Heavy weight, extreme widths and dramatic contrast. Use them for one loud line: a sale, a title, a thumbnail.'),
    ('trust', 'Trust', 'Fonts that feel clear and dependable.',
     'Easy-to-read shapes, open letters and even spacing. Use them where people need to believe you: prices, notices, menus, terms.'),
    ('positive', 'Positive feeling', 'Fonts that feel warm and happy.',
     'Round shapes, soft ends and a human hand. Use them for invitations, treats, kids, and saying thank you.'),
    ('tension', 'Tension', 'Fonts that put people on edge, on purpose.',
     'Sharp cuts, cold squares, shaky lines and odd contrast. Use them for warnings, horror, protest and sport, and as contrast next to calmer type.'),
]
INK = {'attention', 'tension'}


def studio_link(f, text):
    ink = f['intent'] in INK
    design = {
        'format': 'localeditor-design', 'version': 1, 'name': f['name'] + ' — LocalEditor originals',
        'pages': [{'width': 1080, 'height': 1080, 'background': '#141318' if ink else '#F6F1E7',
                   'layers': [{'id': 'title', 'type': 'text', 'text': text, 'font': f['name'], 'weight': 400,
                               'size': 92 if len(text) > 28 else 128, 'color': '#F7F3EA' if ink else '#17131F',
                               'align': 'center', 'w': '84%', 'x': 'center', 'y': 'center'}]}],
    }
    raw = json.dumps(design, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    return '../studio/#d=j' + base64.urlsafe_b64encode(raw).decode().rstrip('=')


def card(f):
    e = html.escape
    sample = f['sample']
    tone = ' data-tone="ink"' if f['intent'] in INK else ''
    long_ = ' data-long' if len(sample) > 28 else ''
    feel = ''.join('<li>%s</li>' % e(x) for x in f['feel'])
    return ('          <li class="fo-card" data-family="%s" data-intent="%s" data-sample="%s"%s%s>\n'
            '            <div class="fo-spec"><p class="fo-sample" style="font-family:\'%s\', %s">%s</p></div>\n'
            '            <div class="fo-meta">\n'
            '              <h3>%s</h3>\n'
            '              <p>%s</p>\n'
            '              <ul class="fo-feel" aria-label="Feel">%s</ul>\n'
            '              <p class="fo-uses">Good for %s.</p>\n'
            '              <div class="fo-actions"><a class="btn btn-sm" href="%s" data-studio>Use in the studio</a></div>\n'
            '            </div>\n'
            '          </li>\n') % (
        e(f['name']), f['intent'], e(sample), tone, long_, e(f['name']),
        'serif' if f['regular'].get('serif', 'none') != 'none' else 'sans-serif', e(sample),
        e(f['name']), e(f['description']), feel, e(', '.join(u[0].lower() + u[1:] for u in f['uses'])), e(studio_link(f, sample)))


def block(fams):
    out = []
    for key, title, lead, body in GROUPS:
        fs = [f for f in fams if f['intent'] == key]
        out.append('        <section class="fo-group" id="%s" aria-labelledby="fo-%s">\n'
                   '          <div class="fo-group-head"><p class="eyebrow">%s</p><h2 id="fo-%s">%s</h2><p>%s</p></div>\n'
                   '          <ul class="fo-grid">\n%s          </ul>\n        </section>\n'
                   % (key, key, html.escape(title), key, html.escape(lead), html.escape(body), ''.join(card(f) for f in fs)))
    return ''.join(out)


def write(fams):
    p = os.path.join(ROOT, 'fonts', 'index.html')
    src = open(p).read()
    a, b = '<!-- BEGIN originals -->', '<!-- END originals -->'
    i, j = src.index(a) + len(a), src.index(b)
    src = src[:i] + '\n' + block(fams) + src[j:]
    open(p, 'w').write(src)
