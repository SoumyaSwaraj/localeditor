#!/usr/bin/env python3
"""Builds the document fixtures for tests/pdf-flow.test.js (QA-010).

Usage: python3 tests/fixtures/pdf-docs/make-fixtures.py
Needs python-docx and openpyxl (both preinstalled in the build environment).
The PDF fixtures for table extraction are made by make-fixtures.js in this folder.
"""
import base64
import os
import struct
import zlib

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor
from openpyxl import Workbook

OUT = os.path.dirname(os.path.abspath(__file__))


def png(w, h, colour):
    """A small solid PNG with a darker frame, built by hand so no image library is needed."""
    r, g, b = colour
    rows = []
    for y in range(h):
        row = bytearray([0])
        for x in range(w):
            edge = x < 3 or y < 3 or x >= w - 3 or y >= h - 3
            row += bytes((r // 3, g // 3, b // 3) if edge else (r, g, b))
        rows.append(bytes(row))
    raw = b''.join(rows)

    def chunk(kind, data):
        c = struct.pack('>I', len(data)) + kind + data
        return c + struct.pack('>I', zlib.crc32(kind + data) & 0xFFFFFFFF)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')


def hyperlink(paragraph, url, text):
    part = paragraph.part
    r_id = part.relate_to(url, 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink', is_external=True)
    link = OxmlElement('w:hyperlink')
    link.set(qn('r:id'), r_id)
    run = OxmlElement('w:r')
    rpr = OxmlElement('w:rPr')
    u = OxmlElement('w:u')
    u.set(qn('w:val'), 'single')
    rpr.append(u)
    run.append(rpr)
    t = OxmlElement('w:t')
    t.text = text
    run.append(t)
    link.append(run)
    paragraph._p.append(link)


PARA = ('Our office moved every paper form to a shared drive this year. The change saved about four hours a week, '
        'but it also raised questions about who may open which file and how long records should be kept. ')


def report_docx():
    doc = Document()
    doc.core_properties.title = 'Quarterly operations report'
    doc.add_heading('Quarterly operations report', 0)
    p = doc.add_paragraph('Prepared for the leadership team. Contact: ')
    hyperlink(p, 'https://example.org/ops', 'example.org/ops')
    p.add_run('.')

    doc.add_heading('1. Summary', 1)
    p = doc.add_paragraph('This report has ')
    p.add_run('bold findings').bold = True
    p.add_run(', ')
    p.add_run('italic remarks').italic = True
    p.add_run(', ')
    r = p.add_run('underlined dates')
    r.underline = True
    p.add_run(' and ')
    r = p.add_run('withdrawn figures')
    r.font.strike = True
    p.add_run('. Water is H')
    r = p.add_run('2')
    r.font.subscript = True
    p.add_run('O and area is m')
    r = p.add_run('2')
    r.font.superscript = True
    p.add_run('. Accents survive: café, naïve, Zoë, Łódź, Straße, Đà Nẵng.')
    for i in range(4):
        doc.add_paragraph(PARA * 2)

    doc.add_heading('2. What changed', 1)
    doc.add_heading('2.1 Tools', 2)
    for item in ['Shared drive for forms', 'Weekly backup to an offline disk', 'Password manager for the front desk']:
        doc.add_paragraph(item, style='List Bullet')
    doc.add_paragraph('Second-level detail under the backup item', style='List Bullet 2')
    doc.add_heading('2.2 Steps we followed', 2)
    for item in ['Collect every paper form', 'Scan and name each file', 'Shred the originals after review']:
        doc.add_paragraph(item, style='List Number')
    doc.add_paragraph(PARA)

    doc.add_heading('3. Costs by month', 1)
    rows = [('Month', 'Item', 'Supplier', 'Amount', 'Notes')]
    months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
    for i in range(72):
        rows.append((months[i % 12], 'Line item %02d' % (i + 1), 'Supplier %s' % 'ABCDEFG'[i % 7], '%d.%02d' % (100 + i * 37 % 900, i * 7 % 100),
                     'Cell text that wraps onto a second line in a narrow column' if i % 9 == 0 else 'OK'))
    t = doc.add_table(rows=len(rows), cols=5)
    t.style = 'Table Grid'
    for ri, row in enumerate(rows):
        for ci, val in enumerate(row):
            cell = t.cell(ri, ci)
            cell.text = val
            if ri == 0:
                cell.paragraphs[0].runs[0].bold = True
    # repeat the header row in Word too
    trpr = t.rows[0]._tr.get_or_add_trPr()
    th = OxmlElement('w:tblHeader')
    th.set(qn('w:val'), 'true')
    trpr.append(th)

    doc.add_heading('4. Floor plan', 1)
    img = os.path.join(OUT, '_tmp.png')
    with open(img, 'wb') as f:
        f.write(png(240, 150, (198, 170, 120)))
    doc.add_picture(img, width=Inches(3))
    os.remove(img)
    cap = doc.add_paragraph('Figure 1. The new layout of the front office.')
    cap.alignment = WD_ALIGN_PARAGRAPH.CENTER

    doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)
    doc.add_heading('5. Other languages', 1)
    doc.add_paragraph('Greek: Η αναφορά είναι έτοιμη. Russian: Отчёт готов к отправке. Ukrainian: Звіт готовий.')
    doc.add_paragraph('Vietnamese: Báo cáo đã sẵn sàng. Polish: Raport jest gotowy, zażółć gęślą jaźń.')
    doc.add_heading('6. Closing', 1)
    for i in range(3):
        doc.add_paragraph(PARA * 3)
    doc.save(os.path.join(OUT, 'report.docx'))


def long_md():
    parts = ['# Handbook for new staff', '', 'Welcome. This handbook is **long on purpose** so the converter has to flow it over many pages. See [the policy page](https://example.org/policy) and [section 3](#section-3).', '']
    for s in range(1, 9):
        anchor = ' {#section-%d}' % s if False else ''
        parts.append('## Section %d: topic %s%s' % (s, 'ABCDEFGHIJ'[s], anchor))
        parts.append('')
        for k in range(3):
            parts.append('Paragraph %d.%d. %s' % (s, k + 1, PARA))
            parts.append('')
        parts.append('- First point for section %d' % s)
        parts.append('- Second point with `inline code` and *emphasis*')
        parts.append('  - Nested point')
        parts.append('')
        parts.append('> A quoted remark from the team in section %d.' % s)
        parts.append('')
        if s % 2 == 0:
            parts.append('```')
            parts.append('function total(items) {  // section %d' % s)
            parts.append('  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);')
            parts.append('}')
            parts.append('```')
            parts.append('')
        if s % 3 == 0:
            parts.append('| Code | Description | Qty |')
            parts.append('| --- | --- | ---: |')
            for r in range(6):
                parts.append('| C-%d%02d | Item for section %d row %d | %d |' % (s, r, s, r, r * 3 + 1))
            parts.append('')
    with open(os.path.join(OUT, 'handbook.md'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(parts) + '\n')


def wide_xlsx():
    wb = Workbook()
    ws = wb.active
    ws.title = 'Orders'
    head = ['Order', 'Date', 'Customer', 'City', 'Country', 'Product', 'SKU', 'Qty', 'Unit price', 'Discount', 'Tax', 'Total', 'Status', 'Notes']
    ws.append(head)
    for i in range(1, 121):
        ws.append(['SO-%05d' % i, '2026-%02d-%02d' % (i % 12 + 1, i % 28 + 1), 'Customer %d' % i, ['Pune', 'Leeds', 'Austin', 'Lyon'][i % 4],
                   ['India', 'UK', 'USA', 'France'][i % 4], 'Product %s' % 'ABCDE'[i % 5], '%07d' % (i * 7919 % 10000000), i % 9 + 1,
                   round(9.99 + i * 1.25, 2), '%d%%' % (i % 4 * 5), round((9.99 + i * 1.25) * 0.18, 2), round((9.99 + i * 1.25) * (i % 9 + 1), 2),
                   ['Paid', 'Due', 'Sent'][i % 3], 'Leave at reception' if i % 10 == 0 else ''])
    ws2 = wb.create_sheet('Summary')
    ws2.append(['Region', 'Orders', 'Revenue'])
    for r in [('North', 40, 12000.5), ('South', 35, 9800.25), ('East', 25, 7300), ('West', 20, 5100.75)]:
        ws2.append(list(r))
    wb.save(os.path.join(OUT, 'wide.xlsx'))


if __name__ == '__main__':
    report_docx()
    long_md()
    wide_xlsx()
    print('wrote report.docx, handbook.md, wide.xlsx to', OUT)
