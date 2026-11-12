"""Write HTML specimen pages for one or many fonts (rendered to PNG by shoot.js)."""
import html
import os

PARA = ('Fresh bread every morning from 7 am. Order ahead for birthdays, weddings and office parties — '
        'we bake to your size, flavour and budget, and deliver across town for free on orders over £40.')
KERN = 'AV AT AY LT LV LY PA TA To Tr Ty Va Vo Wa We Yo Ya r. f. y, F. P. "A" ‘Te’ «Fy» Kv Rv'
ACCENTS = ('Français: Noël à l’hôtel, façade, œuvre · Deutsch: Größe, Mädchen, Übung · Español: ¿Qué niño? ¡Año mañana! · '
           'Polski: Zażółć gęślą jaźń · Türkçe: Işık, ağaç, şoför, İstanbul · Čeština: Příliš žluťoučký kůň · Română: Știință, țară')
PRICES = 'Latte  €3.50 · Flat white  £3.20 · Thali  ₹249 · Ramen  ¥980 · Bagel  $2.75 · 25% off · 10 × 12 = 120 · 1/2 ½ ¼ ¾'
SYMS = '. , : ; ! ? \' " ‘ ’ “ ” ‚ „ - – — _ ( ) [ ] { } / \\ | @ # % & * + = < > ^ ~ ` $ € £ ₹ ¥ ¢ © ® ™ ° • … « » ‹ › § ¶ ± × ÷ µ ¹ ² ³ ª º'


def face_css(fonts, base_dir):
    out = []
    for f in fonts:
        url = 'file://' + os.path.abspath(f['file'])
        out.append('@font-face{font-family:"%s";src:url("%s");font-weight:%d;font-style:normal;}' % (f['family'], url, f.get('weight', 400)))
    return '\n'.join(out)


def page(fonts, sections, title='Specimen', width=1400, dark=False):
    css = face_css(fonts, '.')
    body = '\n'.join(sections)
    return ('<!doctype html><html><head><meta charset="utf-8"><title>%s</title><style>%s\n'
            'body{margin:0;padding:28px 36px;background:%s;color:%s;font-family:sans-serif;width:%dpx;box-sizing:border-box}'
            '.lab{font:12px/1.2 monospace;color:#888;margin:14px 0 4px}'
            'p{margin:0}.row{margin:0 0 6px}'
            '</style></head><body>%s</body></html>') % (title, css, '#16131C' if dark else '#fff', '#F2EFE9' if dark else '#16131C', width, body)


def one_font_sections(fam, label=''):
    e = html.escape
    S = []
    def blk(lab, txt, size, weight=400, extra=''):
        S.append('<div class="lab">%s %s · %dpx %s</div><p class="row" style="font-family:\'%s\';font-size:%dpx;font-weight:%d;%s">%s</p>' % (e(label), e(lab), size, weight, fam, size, weight, extra, e(txt)))
    blk('headline', 'Summer Sale — Everything 40% Off', 72)
    blk('headline bold', 'Fresh Bakes, Honest Prices', 72, 700)
    blk('caps', 'GRAND OPENING · SATURDAY 14 JUNE', 48)
    blk('lower', 'abcdefghijklmnopqrstuvwxyz', 48)
    blk('upper', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 48)
    blk('figures', '0123456789 $€£₹¥¢', 48)
    blk('lower bold', 'abcdefghijklmnopqrstuvwxyz', 48, 700)
    blk('upper bold', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ 0123456789', 48, 700)
    blk('symbols', SYMS, 32)
    blk('kerning', KERN, 40)
    blk('prices', PRICES, 24)
    blk('accents', ACCENTS, 24)
    blk('paragraph', PARA, 16, extra='max-width:620px;line-height:1.5')
    blk('paragraph', PARA, 24, extra='max-width:980px;line-height:1.4')
    return S


def write(path, fonts, sections, **kw):
    with open(path, 'w') as f:
        f.write(page(fonts, sections, **kw))
