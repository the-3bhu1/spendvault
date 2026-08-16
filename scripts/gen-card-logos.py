"""Convert the uploaded brand SVGs into one inline React component.

Preserves <g transform>, <defs> and clipPath references (HDFC in particular has a
flipped-Y matrix, so extracting bare <path d> would mangle it). Resolves <style>
classes to inline fills, strips editor metadata, namespaces every id so two logos
on one page can't collide, and applies a per-logo colour policy.
"""
import re, os, sys
import xml.etree.ElementTree as ET

REPO = '/Users/tribhuvankomarla/Documents/Expense Tracker'
SVG = 'http://www.w3.org/2000/svg'

# 'white'    -> every fill becomes currentColor (single-colour lockups)
# 'original' -> keep brand colours (plate logos whose text is knocked out)
# 'reversed' -> drop the full-bleed background plate, then whiten what's left.
#               Only works where the plate is its own element (CSB has a
#               <rect>); HDFC's plate is a path among paths, so it stays
#               'original' rather than being guessed at.
LOGOS = [
    ('hdfc',       'scripts/brand-svgs/issuers/hdfc.svg',        'original', 'HDFC Bank'),
    ('axis',       'scripts/brand-svgs/issuers/axis(1).svg',     'white',    'Axis Bank'),
    ('csb',        'scripts/brand-svgs/issuers/csb.svg',         'reversed', 'CSB Bank'),
    ('tide',       'scripts/brand-svgs/issuers/tide(3).svg',     'white',    'Tide'),
    ('swiggy',     'scripts/brand-svgs/issuers/swiggy.svg',      'original', 'Swiggy'),
    ('supermoney', 'scripts/brand-svgs/issuers/super.money.svg', 'white',    'super.money'),
    ('jupiter',    'scripts/brand-svgs/issuers/jupiter(1).svg',  'white',    'Jupiter'),
    # Standalone Axis 'A', no wordmark — used as a background watermark, not a mark.
    ('axismark',   'scripts/brand-svgs/issuers/axis(2).svg',     'white',    'Axis'),
]

# Content bounds, measured with getBBox in a headless browser (scratchpad/bbox.mjs).
#
# A file's viewBox describes the canvas it was drawn on, not the ink on it, and
# for two of these that gap is large. CSB's viewBox is its *plate's* bounds, so
# once 'reversed' drops the plate the wordmark occupies 87 of 214 units and
# renders at 40% of the height it was asked for — which is why it looked tiny
# next to RuPay at the same nominal size. Sizing every mark by its own ink is
# what makes one optical height mean the same thing across all of them.
TIGHT_VIEWBOX = {
    'hdfc':       '1.07 1.08 287.14 47.85',
    'axis':       '6.34 10.47 981.77 233.33',
    'axismark':   '0 0 105.42 91.38',
    'csb':        '64.50 63.68 590.67 87.44',     # x2.44 vs the plate viewBox
    'tide':       '0 0 127.90 53.00',
    'swiggy':     '0 0.63 158.64 48.00',
    'supermoney': '3.17 0.01 128.40 48.64',
    'jupiter':    '-148.90 -7.50 418.71 125.40',
    'rupay':      '0.02 0.02 71.83 18.88',
}

DROP_NS = ('sodipodi', 'inkscape', 'ns_extend', 'ns_ai', 'ns_graphs', 'ns_sfw')
DROP_TAGS = {'metadata', 'namedview', 'title', 'desc', 'style'}

ATTR_MAP = {
    'fill-rule': 'fillRule', 'clip-rule': 'clipRule', 'clip-path': 'clipPath',
    'stroke-width': 'strokeWidth', 'stroke-linecap': 'strokeLinecap',
    'stroke-linejoin': 'strokeLinejoin', 'stroke-miterlimit': 'strokeMiterlimit',
    'stroke-dasharray': 'strokeDasharray', 'fill-opacity': 'fillOpacity',
    'stroke-opacity': 'strokeOpacity', 'stop-color': 'stopColor',
    'stop-opacity': 'stopOpacity', 'xlink:href': 'href', 'enable-background': None,
    'xml:space': None,
}


XLINK = 'http://www.w3.org/1999/xlink'


def local(tag):
    return tag.split('}', 1)[1] if '}' in tag else tag


def ns_of(tag):
    """URI for a namespaced tag/attr, or '' when unqualified."""
    return tag[1:].split('}', 1)[0] if tag.startswith('{') else ''


def is_foreign(tag):
    """True for anything not in the SVG namespace — inkscape:perspective,
    sodipodi:namedview and friends, which ElementTree resolves to a URI so a
    local-name check never sees the prefix."""
    ns = ns_of(tag)
    return ns not in ('', SVG)


def parse_css(root):
    """Very small .class{fill:#xxx} reader — enough for these files."""
    rules = {}
    for el in root.iter():
        if local(el.tag) == 'style' and el.text:
            for m in re.finditer(r'\.([\w-]+)\s*\{([^}]*)\}', el.text):
                decls = {}
                for d in m.group(2).split(';'):
                    if ':' in d:
                        k, v = d.split(':', 1)
                        decls[k.strip()] = v.strip()
                rules[m.group(1)] = decls
    return rules


def clean(el, css, key, policy, out_ids):
    tag = local(el.tag)
    attrs = {}

    # class -> inline declarations
    decls = {}
    for cls in (el.get('class') or '').split():
        decls.update(css.get(cls, {}))
    if el.get('style'):
        for d in el.get('style').split(';'):
            if ':' in d:
                k, v = d.split(':', 1)
                decls[k.strip()] = v.strip()

    for k, v in el.attrib.items():
        ns = ns_of(k)
        if ns == XLINK:
            attrs['href'] = v
            continue
        if ns not in ('', SVG):          # inkscape:label, sodipodi:* etc.
            continue
        k = local(k)
        if k in ('class', 'style'):
            continue
        attrs[k] = v

    for k in ('fill', 'stroke', 'fill-rule', 'clip-rule', 'opacity', 'fill-opacity'):
        if k in decls:
            attrs[k] = decls[k]

    # namespace ids so two logos on one page cannot collide
    if 'id' in attrs:
        new = f'{key}-{attrs["id"]}'
        out_ids[attrs['id']] = new
        attrs['id'] = new

    # colour policy
    if policy in ('white', 'reversed'):
        if attrs.get('fill', '').lower() not in ('none', '') :
            attrs['fill'] = 'currentColor'
        elif tag == 'path' and 'fill' not in attrs:
            attrs['fill'] = 'currentColor'
        attrs.pop('stroke', None)

    return tag, attrs


def eff_fill(el, css):
    """Effective fill: attribute, inline style, or CSS class."""
    if el.get('fill'):
        return el.get('fill').strip().lower()
    style = el.get('style') or ''
    m = re.search(r'fill\s*:\s*([^;]+)', style)
    if m:
        return m.group(1).strip().lower()
    for cls in (el.get('class') or '').split():
        if 'fill' in css.get(cls, {}):
            return css[cls]['fill'].strip().lower()
    return ''


def is_full_bleed(el, vb):
    """A rect covering the whole viewBox — i.e. the logo's background plate."""
    if local(el.tag) != 'rect' or vb is None:
        return False
    x0, y0, w, h = vb
    f = lambda v, d=0.0: float(el.get(v, d))
    try:
        return (abs(f('x') - x0) < 0.5 and abs(f('y') - y0) < 0.5
                and abs(f('width') - w) < 0.5 and abs(f('height') - h) < 0.5)
    except ValueError:
        return False


def to_jsx(el, css, key, policy, out_ids, depth=1, vb=None, plate_fill=''):
    if is_foreign(el.tag):
        return ''
    tag = local(el.tag)
    if tag in DROP_TAGS:
        return ''
    if policy == 'reversed':
        if is_full_bleed(el, vb):
            return ''
        # Shapes painted in the plate's own colour are part of the plate — CSB
        # has four corner pieces that only read as "invisible" while the plate
        # is behind them. Whitening those puts stray brackets over the wordmark.
        if plate_fill and eff_fill(el, css) == plate_fill:
            return ''
    tag_name, attrs = clean(el, css, key, policy, out_ids)

    parts = []
    for k, v in attrs.items():
        jk = ATTR_MAP.get(k, k)
        if jk is None:
            continue
        parts.append(f'{jk}="{v}"')
    kids = ''.join(to_jsx(c, css, key, policy, out_ids, depth + 1, vb, plate_fill) for c in el)
    ind = '    ' * depth
    a = (' ' + ' '.join(parts)) if parts else ''
    if kids.strip():
        return f'\n{ind}<{tag_name}{a}>{kids}\n{ind}</{tag_name}>'
    return f'\n{ind}<{tag_name}{a} />'


def convert(key, path, policy):
    ET.register_namespace('', SVG)
    tree = ET.parse(os.path.join(REPO, path))
    root = tree.getroot()
    css = parse_css(root)

    vb = root.get('viewBox')
    if not vb:
        w, h = root.get('width'), root.get('height')
        if not (w and h):
            sys.exit(f'{key}: no viewBox and no width/height')
        vb = f'0 0 {re.sub("[a-z]", "", w)} {re.sub("[a-z]", "", h)}'

    vb_nums = [float(n) for n in re.split(r'[\s,]+', vb.strip())]

    plate_fill = ''
    if policy == 'reversed':
        for el in root.iter():
            if is_full_bleed(el, vb_nums):
                plate_fill = eff_fill(el, css)
                break
        if not plate_fill:
            sys.exit(f'{key}: reversed policy but no full-bleed plate found')

    out_ids = {}
    body = ''.join(to_jsx(c, css, key, policy, out_ids, 1, vb_nums, plate_fill) for c in root)
    vb = TIGHT_VIEWBOX.get(key, vb)
    # rewrite url(#id) and href="#id" to the namespaced ids
    for old, new in out_ids.items():
        body = body.replace(f'url(#{old})', f'url(#{new})')
        body = body.replace(f'href="#{old}"', f'href="#{new}"')
    return vb.strip(), body


blocks, meta = [], []
for key, path, policy, label in LOGOS:
    vb, body = convert(key, path, policy)
    x0, y0, w, h = [float(n) for n in re.split(r'[\s,]+', vb)]
    meta.append((key, label, vb, w / h, policy))
    blocks.append(f"""  {key}: {{
    label: '{label}',
    viewBox: '{vb}',
    ratio: {w / h:.4f},
    art: (<>{body}
    </>),
  }},""")

header = '''import React from 'react';
import type { BrandKey } from '../types';

/**
 * Brand marks printed on a card: the issuing bank on the front, the co-brand
 * programme on the back. Generated from the official SVGs in scripts/brand-svgs/issuers —
 * inlined rather than loaded, so they render offline in the Capacitor webview
 * and can take their colour from the card.
 *
 * Colour policy differs per mark, and it is not a preference:
 *
 *   'white'    single-colour lockups (Axis, Jupiter, Tide, super.money). Every
 *              fill becomes currentColor, so the mark follows --card-ink and
 *              would invert correctly on a light skin.
 *   'original' plate logos (HDFC, CSB) and Swiggy. These are a solid coloured
 *              block with the wordmark KNOCKED OUT of it — recolouring them to a
 *              single fill collapses the whole mark into a white rectangle, so
 *              they keep their brand colours.
 *
 * Marks are sized by optical HEIGHT, never width: Axis is a 3.9:1 wordmark and
 * HDFC a 5.8:1 block, so matching their widths would make one visually twice the
 * weight of the other.
 *
 * Regenerated by scratchpad/gen_logos.py — edit that, not this file.
 */

'''

tsx = header
tsx += 'const BRANDS: Record<BrandKey, { label: string; viewBox: string; ratio: number; art: React.ReactNode }> = {\n'
tsx += '\n'.join(blocks)
tsx += '\n};\n\n'
tsx += '''/**
 * The same artwork blown up as a background motif — the issuer's own symbol
 * doing the work a generic geometry layer would otherwise do. Sized in % of the
 * card so it scales with it, and deliberately allowed to run off the right edge:
 * a mark cropped by the card reads as printed into it, a mark that fits reads as
 * a sticker.
 */
export function CardBrandWatermark({
  brand,
  scale = 1.8,
  nudge = '20%',
}: {
  brand: BrandKey;
  scale?: number;
  nudge?: string;
}) {
  const b = BRANDS[brand];
  if (!b) return null;
  return (
    <svg
      viewBox={b.viewBox}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      focusable="false"
      style={{
        height: `${scale * 100}%`,
        width: 'auto',
        transform: `translateX(${nudge})`,
        flexShrink: 0,
      }}
    >
      {b.art}
    </svg>
  );
}

export function CardBrandLogo({ brand, height = 22 }: { brand: BrandKey; height?: number }) {
  const b = BRANDS[brand];
  if (!b) return null;
  return (
    <svg
      viewBox={b.viewBox}
      height={height}
      width={height * b.ratio}
      role="img"
      aria-label={b.label}
      style={{ display: 'block', color: 'rgb(var(--card-ink))', overflow: 'visible' }}
    >
      {b.art}
    </svg>
  );
}
'''

out = os.path.join(REPO, 'src/components/CardBrandLogo.tsx')
open(out, 'w').write(tsx)
print(f'wrote {out} ({len(tsx)/1024:.1f} KB)')
for k, label, vb, ratio, policy in meta:
    print(f'  {k:11s} {policy:9s} viewBox="{vb}"  ratio={ratio:.2f}')


# ── RuPay network mark ────────────────────────────────────────────────────────
# Not a brand logo, so it lands in its own file for CardNetworkLogo to use. The
# wordmark paths are #1b3281 navy and the two chevrons are green/orange; only the
# wordmark becomes currentColor so the chevrons keep their brand colour on a dark
# card, which is exactly how the mark appears on a real RuPay card face.
RUPAY_WORDMARK = '#1b3281'

vb, body = convert('rupay', 'scripts/brand-svgs/networks/rupay.svg', 'original')
body = body.replace(f'fill="{RUPAY_WORDMARK}"', 'fill="currentColor"')
assert 'currentColor' in body, 'rupay wordmark recolour did not match'
assert '#008c44' in body and '#f47920' in body, 'rupay chevrons lost'

x0, y0, w, h = [float(n) for n in re.split(r'[\s,]+', vb)]
rupay_tsx = f'''/**
 * Official RuPay mark. Replaces a hand-drawn stand-in that set the wordmark in
 * italic Arial Black and drew the chevrons as two triangles — it never matched,
 * because the real wordmark is a custom face and the chevrons are angled
 * parallelograms.
 *
 * The wordmark takes currentColor (white on a dark card); the green and orange
 * chevrons keep their brand colours, as they do on a real card.
 *
 * Regenerated by scratchpad/gen_logos.py — edit that, not this file.
 */
export function RupayMark({{ height = 19 }}: {{ height?: number }}) {{
  return (
    <svg
      viewBox="{vb}"
      height={{height}}
      width={{height * {w / h:.4f}}}
      role="img"
      aria-label="RuPay"
      style={{{{ display: 'block', color: 'currentColor' }}}}
    >{body}
    </svg>
  );
}}
'''
out = os.path.join(REPO, 'src/components/CardNetworkRupay.tsx')
open(out, 'w').write(rupay_tsx)
print(f'wrote {out} ({len(rupay_tsx)/1024:.1f} KB)  ratio={w/h:.2f}')
