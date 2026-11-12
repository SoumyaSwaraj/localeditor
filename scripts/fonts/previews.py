#!/usr/bin/env python3
"""Name-only preview subsets for the font picker.

For every family: the glyphs of its own name (and a short sample in its script for non-Latin families),
cut from the library's own woff2 files with fontTools, instanced at weight 400 for variable fonts,
renamed to an internal name ("LE Preview <n>") so a modified font never carries a Reserved Font Name,
and packed 16 to a file in popularity order. Writes assets/fonts/previews/pack-<n>.<hash>.bin and
assets/fonts/previews/previews.json ({ packs, map: { slug: [[pack, offset, length, unicodeRange], ...] } }).

Run through `node scripts/fetch-fonts.js --previews` (env LE_PYTHON = a Python with fontTools and brotli).
"""
import hashlib
import io
import json
import os
import sys

from fontTools.ttLib import TTFont
from fontTools import subset as ftsubset
from fontTools.varLib import instancer

ROOT = sys.argv[1]
BUILT = json.load(open(sys.argv[2]))
OUT = os.path.join(ROOT, 'assets', 'fonts', 'previews')
INDEX = json.load(open(os.path.join(ROOT, 'assets', 'data', 'fonts-index.json')))
PACK = 16

SAMPLE = {
    'devanagari': 'हिन्दी', 'bengali': 'বাংলা', 'tamil': 'தமிழ்', 'telugu': 'తెలుగు', 'gujarati': 'ગુજરાતી',
    'gurmukhi': 'ਪੰਜਾਬੀ', 'kannada': 'ಕನ್ನಡ', 'malayalam': 'മലയാളം', 'arabic': 'العربية', 'hebrew': 'עברית',
    'thai': 'ภาษาไทย', 'japanese': '日本語', 'chinese-simplified': '简体中文', 'chinese-traditional': '繁體中文',
    'korean': '한국어',
}
CJK_SCRIPT = {'noto-sans-jp': 'japanese', 'noto-sans-kr': 'korean', 'noto-sans-sc': 'chinese-simplified', 'noto-sans-tc': 'chinese-traditional'}


def parse_ranges(text):
    out = []
    for part in (text or '').split(','):
        part = part.strip().upper().replace('U+', '')
        if not part:
            continue
        if '-' in part:
            a, b = part.split('-')
            out.append((int(a, 16), int(b, 16)))
        elif '?' in part:
            out.append((int(part.replace('?', '0'), 16), int(part.replace('?', 'F'), 16)))
        else:
            out.append((int(part, 16), int(part, 16)))
    return out


def covers(ranges, cp):
    return any(a <= cp <= b for a, b in ranges)


def source_file(fam, subset):
    face = fam['faces'][0]['key']
    if fam.get('source') == 'localeditor':
        return os.path.join(ROOT, fam['dir'], fam['faces'][0]['file'])
    base = 'cjk' if fam.get('cjk') else 'library'
    return os.path.join(ROOT, 'assets', 'fonts', base, fam['slug'], '%s-%s-%s.%s.woff2' % (fam['slug'], subset, face, fam['rev']))


def cut(path, chars, n, wght):
    font = TTFont(path)
    if 'fvar' in font:
        axes = {a.axisTag: a for a in font['fvar'].axes}
        limits = {}
        for tag, a in axes.items():
            if tag == 'wght':
                limits[tag] = max(a.minValue, min(a.maxValue, wght))
            else:
                limits[tag] = a.defaultValue
        font = instancer.instantiateVariableFont(font, limits)
    opts = ftsubset.Options()
    opts.layout_features = ['*']
    opts.hinting = False
    opts.desubroutinize = True
    opts.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14]
    opts.notdef_outline = False
    opts.glyph_names = False
    sub = ftsubset.Subsetter(opts)
    sub.populate(text=chars)
    sub.subset(font)
    internal = 'LE Preview %d' % n
    name = font['name']
    for rec in list(name.names):
        if rec.nameID in (1, 3, 4, 16, 17, 18, 21, 22):
            name.removeNames(nameID=rec.nameID)
    for nid, val in ((1, internal), (3, internal), (4, internal), (6, internal.replace(' ', ''))):
        name.removeNames(nameID=nid)
        name.setName(val, nid, 3, 1, 0x409)
    font.flavor = 'woff2'
    buf = io.BytesIO()
    font.save(buf)
    return buf.getvalue()


def main():
    order = [f['slug'] for f in INDEX['families']]
    fams = {}
    for slug, fam in BUILT.items():
        fams[slug] = fam
    origin_dir = os.path.join(ROOT, 'assets', 'fonts', 'originals')
    for f in INDEX['families']:
        if f.get('source') == 'localeditor':
            fams[f['slug']] = {'slug': f['slug'], 'family': f['family'], 'source': 'localeditor', 'dir': f['dir'],
                               'faces': [{'key': k, 'file': v} for k, v in f['files'].items()], 'subsets': ['all'], 'ranges': {}}
    os.makedirs(OUT, exist_ok=True)
    for name in os.listdir(OUT):
        if name.startswith('pack-'):
            os.remove(os.path.join(OUT, name))
    entries = {}
    blobs = []
    n = 0
    for slug in order:
        fam = fams.get(slug)
        if not fam:
            continue
        index_entry = next(x for x in INDEX['families'] if x['slug'] == slug)
        scripts = index_entry.get('scripts', ['latin'])
        primary = CJK_SCRIPT.get(slug) or (scripts[0] if scripts and scripts[0] != 'latin' else None)
        texts = [fam['family']]
        if primary in SAMPLE:
            texts.append(SAMPLE[primary])
        chars = sorted(set(''.join(texts)))
        groups = {}
        for ch in chars:
            cp = ord(ch)
            if fam.get('source') == 'localeditor':
                groups.setdefault('all', []).append(ch)
                continue
            ranges = fam.get('ranges') or {}
            pick = None
            for s in (['latin'] if cp < 0x250 else []) + fam['subsets']:
                if s in ranges and covers(parse_ranges(ranges[s]), cp):
                    pick = s
                    break
            if pick:
                groups.setdefault(pick, []).append(ch)
        parts = []
        for s, cs in groups.items():
            path = source_file(fam, s)
            if not os.path.exists(path):
                continue
            try:
                data = cut(path, ''.join(cs), n, 400)
            except Exception as e:  # a broken subset must not stop the run
                print('preview failed', slug, s, e)
                continue
            rng = ','.join('U+%X' % ord(c) for c in cs)
            parts.append((data, rng))
            n += 1
        if parts:
            entries[slug] = parts
            blobs.append(slug)
    packs = []
    out_map = {}
    for i in range(0, len(blobs), PACK):
        chunk = blobs[i:i + PACK]
        data = b''
        idx = len(packs)
        for slug in chunk:
            for blob, rng in entries[slug]:
                out_map.setdefault(slug, []).append([idx, len(data), len(blob), rng])
                data += blob
        h = hashlib.sha1(data).hexdigest()[:6]
        name = 'pack-%d.%s.bin' % (idx, h)
        with open(os.path.join(OUT, name), 'wb') as fh:
            fh.write(data)
        packs.append(name)
    total = sum(os.path.getsize(os.path.join(OUT, p)) for p in packs)
    json.dump({'packs': packs, 'map': out_map}, open(os.path.join(OUT, 'previews.json'), 'w'))
    print('previews: %d families, %d fonts, %d packs, %d bytes (avg %d per family)' % (len(entries), n, len(packs), total, total // max(1, len(entries))))


if __name__ == '__main__':
    main()
