#!/usr/bin/env python3
"""One-time migration of site/public/index.html onto the design tokens.

Every spacing value (padding, margin, gap, inset offsets are left alone),
font size, corner radius, stacking layer and transition duration is snapped
to its scale and written as a token. Kept for the record and so the mapping
can be re-read; the deploy gate (site/tests/test_site.py, "dls:" checks)
is what keeps the file on the scale from now on.

  python3 ops/design-tokens-migrate.py            # rewrite in place, print a report
  python3 ops/design-tokens-migrate.py --check    # report only
"""
import re, sys, collections

PATH = 'site/public/index.html'
SPACE = [2, 4, 8, 12, 16, 20, 24, 32, 40, 48]          # 4pt grid, 2px micro step
TYPE = [12, 14, 16, 18, 20, 24, 30, 36, 48]            # px; never below 12
RADIUS = [2, 4, 8, 12, 16, 20, 24]
LAYOUT_MIN = 56                                         # larger spacing is layout, left as is

def snap(v, scale):
    # Nearest step; a tie goes to the larger step (more air, bigger targets).
    return min(scale, key=lambda s: (abs(s - v), -s))

report = collections.Counter()

def space_val(m):
    num, unit = float(m.group(1)), m.group(2)
    neg = num < 0
    px = abs(num) * (16 if unit == 'rem' else 1)
    if px == 0 or px == 1 or px >= LAYOUT_MIN or unit == 'em':
        return m.group(0)
    step = snap(px, SPACE)
    report['space %gpx -> %d' % (px, step)] += 1
    tok = 'var(--space-%d)' % step
    return 'calc(%s * -1)' % tok if neg else tok

def font_val(m):
    num, unit = float(m.group(1)), m.group(2)
    px = num * 16 if unit == 'rem' else num
    step = snap(max(px, 12), TYPE)
    report['type %g%s -> %d' % (num, unit, step)] += 1
    return 'var(--fs-%d)' % step

def radius_val(m):
    num = float(m.group(1))
    if num >= 99:
        report['radius %gpx -> pill' % num] += 1
        return 'var(--radius-pill)'
    step = snap(max(num, 2), RADIUS)
    report['radius %gpx -> %d' % (num, step)] += 1
    return 'var(--radius-%d)' % step

Z = {1: 'raised', 2: 'above', 5: 'bar', 6: 'inputbar', 7: 'fab', 8: 'tabs', 9: 'toast',
     12: 'sos', 20: 'menu', 25: 'sheet', 30: 'drawer', 60: 'coach', 99: 'fx'}
def dur(v):
    s = float(v[:-2]) / 1000 if v.endswith('ms') else float(v[:-1])
    return 'fast' if s <= 0.16 else 'base' if s <= 0.28 else 'slow'

NUM = r'(-?\d*\.?\d+)(px|rem|em)\b'

def fix_decls(text):
    def one(m):
        prop, val, end = m.group(1), m.group(2), m.group(3)
        low = prop.lower()
        if re.fullmatch(r'(padding|margin)(-(top|right|bottom|left|inline|block)(-(start|end))?)?|gap|row-gap|column-gap', low):
            new = re.sub(NUM, space_val, val)
        elif low == 'font-size':
            if 'clamp' in val or 'var(' in val or '%' in val or 'em' in re.sub(r'rem', '', val):
                return m.group(0)
            new = re.sub(r'(\d*\.?\d+)(px|rem)\b', font_val, val)
        elif low == 'border-radius':
            if '%' in val: return m.group(0)
            new = re.sub(r'(\d*\.?\d+)px\b', radius_val, val)
        elif low == 'z-index':
            v = val.strip()
            if v.isdigit() and int(v) in Z:
                report['z %s -> %s' % (v, Z[int(v)])] += 1
                new = 'var(--z-%s)' % Z[int(v)]
            else: new = val
        elif low == 'transition':
            new = re.sub(r'(?<![\w.-])(\d*\.?\d+m?s)\b', lambda d: (report.update(['motion %s -> %s' % (d.group(1), dur(d.group(1)))]) or 'var(--motion-%s)' % dur(d.group(1))), val)
        else:
            return m.group(0)
        return prop + ':' + new + end
    return re.sub(r'(?<![\w-])([a-zA-Z-]+)\s*:\s*([^;{}"]+?)(\s*(?:;|}|"|$))', one, text)

def main():
    s = open(PATH, encoding='utf-8').read()
    a, b = s.index('<style>'), s.index('</style>')
    css = s[a:b]
    # Leave the token block itself alone: tokens are defined in raw values.
    root_end = css.index('}', css.index(':root{'))
    head, rest = css[:root_end + 1], css[root_end + 1:]
    new_css = head + fix_decls(rest)
    body = s[b:]
    new_body = re.sub(r'style="([^"]*)"', lambda m: 'style="' + fix_decls(m.group(1)) + '"', body)
    new_body = re.sub(r"style=\\\"([^\\]*)\\\"", lambda m: 'style=\\"' + fix_decls(m.group(1)) + '\\"', new_body)
    out = s[:a] + new_css + new_body
    for k, v in sorted(report.items()): print('%4d  %s' % (v, k))
    if '--check' not in sys.argv:
        open(PATH, 'w', encoding='utf-8').write(out)
        print('rewrote', PATH)

main()
