#!/usr/bin/env python3
"""Convert the six SlowMilesStudio mockup templates into editable scenes.

    pip install pillow numpy scipy psd-tools
    python3 scripts/import-mockups.py <mockups-folder> data/mockups

Each template becomes data/mockups/<id>/scene.json plus one image per layer.
The layer stack reproduces the kit's reference `mockup_bauen.py` (and through
it the live shop pipeline); every layer stays visible and editable in the
editor. Numbers come from ANLEITUNG-FUER-KI.md and punkte.json.
"""
import json
import os
import shutil
import sys

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

Image.MAX_IMAGE_PIXELS = None
MAX_EDGE = 4096          # working resolution of a scene; export is 2000 px anyway
RAUM_ARBEIT = 2048       # AI rooms: 1024 → 2048, their points are measured here
SHINE = 0.45             # glass reflection strength (Robin, 15.09.2026)
FLAT = 0.7               # flat-field strength (Robin, 15.09.2026)
OVERSCAN = 0.008         # AI rooms: poster 0.8 % larger, clipped to the exact quad

TEMPLATES = [
    {'id': '01-altbau-frontal', 'name': 'Altbau frontal angelehnt', 'order': 1, 'kind': 'psd',
     'file': '1 - Altbau frontal angelehnt (Vorschaubild).psd',
     'quad': [(2074.47, 929.94), (6159.47, 929.94), (6260.95, 6862.10), (1990.64, 6860.77)],
     'tone': False},
    {'id': '02-bett', 'name': 'Bett weiße Wäsche', 'order': 2, 'kind': 'psd',
     'file': '2 - Bett weisse Waesche.psd',
     'quad': [(369.41, 568.56), (1700.36, 568.21), (1686.04, 2557.74), (343.09, 2550.40)],
     'tone': False, 'lift': 1.12},
    {'id': '03-kueche', 'name': 'Küche Marmorplatte', 'order': 3, 'kind': 'room',
     'file': '3 - Kueche Marmorplatte.png',
     'quad': [(1208.86, 461.96), (1739.37, 464.45), (1742.81, 1226.38), (1206.99, 1225.42)]},
    {'id': '04-diele', 'name': 'Diele Sideboard', 'order': 4, 'kind': 'psd',
     'file': '4 - Diele Sideboard weisse Tuer.psd',
     'quad': [(1726.58, 711.38), (2698.78, 760.86), (2757.19, 2181.14), (1760.56, 2217.66)],
     'tone': True, 'shine': 0.5,
     # Book stack in front of the lower right poster corner (known weakness 1).
     'front': [(2498, 2062), (2610, 2055), (2780, 2048), (2780, 2222),
               (2487, 2222), (2487, 2120), (2500, 2115)]},
    {'id': '05-altbau-chromregal', 'name': 'Altbau Chromregal', 'order': 5, 'kind': 'room',
     'file': '5 - Altbau Chromregal Bogenlampe.png',
     'quad': [(811.38, 438.12), (1236.90, 437.19), (1240.36, 1035.60), (811.35, 1036.64)]},
    {'id': '06-nussbaum-sideboard', 'name': 'Nussbaum-Sideboard', 'order': 6, 'kind': 'room',
     'file': '6 - Nussbaum-Sideboard Siebtraeger.png',
     'quad': [(687.53, 134.77), (1350.28, 135.70), (1352.01, 1052.95), (690.78, 1055.17)]},
]

BLEND = {'NORMAL': 'normal', 'MULTIPLY': 'multiply', 'SCREEN': 'screen', 'OVERLAY': 'overlay',
         'SOFT_LIGHT': 'soft-light', 'LINEAR_BURN': 'linear-burn'}
BRIGHTENING = ('SCREEN', 'OVERLAY', 'SOFT_LIGHT')


# ── helpers ─────────────────────────────────────────────────────────────────
def quad_mask(quad, w, h):
    """Antialiased 0..1 mask of a quad (4× supersampled)."""
    m = Image.new('L', (w * 4, h * 4), 0)
    ImageDraw.Draw(m).polygon([(x * 4, y * 4) for x, y in quad], fill=255)
    return np.asarray(m.resize((w, h), Image.LANCZOS), np.float32) / 255


def bbox_of(alpha, pad=2):
    ys, xs = np.nonzero(alpha > 0)
    if len(xs) == 0:
        return None
    h, w = alpha.shape
    return (max(0, xs.min() - pad), max(0, ys.min() - pad),
            min(w, xs.max() + 1 + pad), min(h, ys.max() + 1 + pad))


class Writer:
    def __init__(self, folder, scale):
        self.folder, self.scale = folder, scale

    def save(self, name, im, opaque=False):
        """Scale to working resolution and save; returns the file name."""
        if self.scale != 1:
            im = im.resize((round(im.width * self.scale), round(im.height * self.scale)), Image.LANCZOS)
        fn = f'{name}.jpg' if opaque else f'{name}.png'
        p = os.path.join(self.folder, fn)
        if opaque:
            im.convert('RGB').save(p, quality=95, subsampling=0)
        else:
            im.save(p, optimize=True)
        return fn, im.size

    def layer(self, lid, name, im, blend, opacity, visible=True, x=0, y=0, opaque=False, role=None):
        fn, (w, h) = self.save(lid, im, opaque)
        out = {'id': lid, 'kind': 'image', 'name': name, 'src': fn,
               'x': round(x * self.scale, 3), 'y': round(y * self.scale, 3), 'width': w, 'height': h,
               'blend': blend, 'opacity': round(opacity, 5), 'visible': visible}
        if role:
            out['role'] = role
        return out

    def cropped(self, lid, name, rgba, blend, opacity, visible=True, role=None):
        """RGBA float array (canvas size) → layer cropped to its visible pixels."""
        b = bbox_of(rgba[..., 3])
        if b is None:
            return None
        x0, y0, x1, y1 = b
        im = Image.fromarray(np.clip(rgba[y0:y1, x0:x1], 0, 255).astype(np.uint8))
        return self.layer(lid, name, im, blend, opacity, visible, x0, y0, role=role)


def layer_rgba(layer, W, H):
    """A PSD layer's own pixels (mask applied, layer opacity NOT baked in)."""
    o, v = layer.opacity, layer.visible
    layer.opacity, layer.visible = 255, True
    try:
        im = layer.composite(viewport=(0, 0, W, H), force=True)
    finally:
        layer.opacity, layer.visible = o, v
    return np.asarray(im.convert('RGBA'), np.float32)


def misch(u, o, modus, deckkraft=255, maske=None):
    """Photoshop blend formulas from mockup_bauen.py (0..255)."""
    if modus == 'NORMAL':
        neu = o
    elif modus == 'MULTIPLY':
        neu = u * o / 255.0
    elif modus == 'SOFT_LIGHT':
        un, on = u / 255.0, o / 255.0
        d = np.where(un <= 0.25, ((16 * un - 12) * un + 4) * un, np.sqrt(un))
        neu = 255.0 * np.where(on <= 0.5, un - (1 - 2 * on) * un * (1 - un), un + (2 * on - 1) * (d - un))
    elif modus == 'LINEAR_BURN':
        neu = np.clip(u + o - 255.0, 0, 255)
    else:
        raise ValueError(modus)
    a = deckkraft / 255.0
    if maske is not None:
        a = a * maske[..., None]
    return np.clip(u * (1 - a) + neu * a, 0, 255)


# ── PSD templates ───────────────────────────────────────────────────────────
def import_psd(path, t, folder):
    from psd_tools import PSDImage
    psd = PSDImage.open(path)
    W, H = psd.size
    scale = min(1.0, MAX_EDGE / max(W, H))
    wr = Writer(folder, scale)
    # Flatten the tree; hidden groups are alternative versions of the template
    # (slot 1: "Mockup 3" with a different quad) and are left out.
    stack = []
    def walk(g):
        for l in g:
            if l.is_group():
                if l.is_visible():
                    walk(l)
            else:
                stack.append(l)
    walk(psd)
    target_i = max(i for i, l in enumerate(stack)
                   if type(l).__name__ == 'SmartObjectLayer' and l.is_visible())
    target = stack[target_i]
    quad = t['quad']
    qm = quad_mask(quad, W, H)

    layers = []
    grund = None
    clip_base = None
    for i, l in enumerate(stack[:target_i]):
        rgba = layer_rgba(l, W, H)
        mode = l.blend_mode.name
        lid = f'l{i:02d}'
        if i == 0 and mode == 'NORMAL' and rgba[..., 3].min() == 255:
            layers.append(wr.layer(lid, l.name, Image.fromarray(rgba[..., :3].astype(np.uint8)),
                                   'normal', 1, opaque=True, role='background'))
            grund = rgba[..., :3].copy()
        elif target.clipping and i == target_i - 1:
            # The clip base (slot 2: the sheet with "Your design here" on it).
            # psd-tools' composite leaves it out, so the pipeline never shows
            # it; kept hidden for reference, its alpha becomes the front mask.
            clip_base = rgba[..., 3] / 255
            layers.append(wr.cropped(lid, f'{l.name} (clip base)', rgba, BLEND[mode], l.opacity / 255, False))
        else:
            layers.append(wr.cropped(lid, l.name, rgba, BLEND[mode], l.opacity / 255, l.visible))
            if l.visible:
                grund = misch(grund, rgba[..., :3], mode, l.opacity, rgba[..., 3] / 255)

    # Slot 2: paper under the sheet +12 %. MULTIPLY never gets brighter than its
    # base, so the base is lifted, only inside the quad (as in the pipeline).
    if t.get('lift'):
        add = grund * (t['lift'] - 1)
        rgba = np.dstack([add, qm * 255])
        layers.append(wr.cropped('lift', f'Paper lift +{round((t["lift"] - 1) * 100)} %', rgba,
                                 'add', 1, role='lift'))
        grund = np.clip(grund + add * qm[..., None], 0, 255)

    layers.append({
        'id': 'poster', 'kind': 'poster', 'name': target.name,
        'quad': [[round(x * scale, 3), round(y * scale, 3)] for x, y in quad],
        'overscan': 0, 'fit': 'stretch', 'tone': t['tone'],
        'blend': BLEND[target.blend_mode.name], 'opacity': target.opacity / 255, 'visible': True,
        'children': [],
    })

    # What stands in front of the poster. Slot 2: holes punched into the clip
    # base (lamp, books, ball); slot 4: the book stack the PSD never masked.
    front = None
    if clip_base is not None:
        front = qm * (1 - clip_base)
    elif t.get('front'):
        poly = quad_mask(t['front'], W, H)
        g = grund
        # The empty sheet is bright and nearly neutral; covers and page edges
        # are darker or clearly warmer.
        paper = ((g.max(-1) - g.min(-1)) < 28) & (g.mean(-1) > 185)
        # Fill holes so white lettering on a spine stays in front.
        books = ndimage.binary_fill_holes((poly > 0.5) & ~ndimage.binary_opening(paper, iterations=1))
        front = poly * qm * books
        front = ndimage.gaussian_filter(front.astype(np.float32), 0.6)
    if front is not None:
        layers.append(wr.cropped('front', 'In front of poster', np.dstack([grund, front * 255]),
                                 'normal', 1, role='front'))

    # Overlays above the poster. The pipeline applies a layer's opacity twice
    # (once inside psd-tools' composite, once when blending), and brightening
    # layers at half strength on slot 4 — both kept so the output matches.
    for i, l in enumerate(stack[target_i + 1:], start=target_i + 1):
        mode = l.blend_mode.name
        if mode not in BLEND or mode == 'NORMAL':
            continue
        rgba = layer_rgba(l, W, H)
        op = (l.opacity / 255) ** 2
        if mode in BRIGHTENING:
            op *= t.get('shine', 1.0)
        layers.append(wr.cropped(f'l{i:02d}', l.name, rgba, BLEND[mode], op, l.is_visible(), role='overlay'))

    return {'width': round(W * scale), 'height': round(H * scale),
            'layers': [l for l in layers if l]}


# ── AI rooms with a blank white sheet ───────────────────────────────────────
def koef(quelle, ziel):
    A, b = [], []
    for (xz, yz), (xq, yq) in zip(ziel, quelle):
        A.append([xz, yz, 1, 0, 0, 0, -xq * xz, -xq * yz])
        A.append([0, 0, 0, xz, yz, 1, -yq * xz, -yq * yz])
        b += [xq, yq]
    return np.linalg.solve(np.array(A, float), np.array(b, float))


def sheet_light(raum, q, shine=SHINE, flat=FLAT):
    """Split the blank sheet into light (multiply) and reflection (add)."""
    bw = int(round(max(q[1][0] - q[0][0], q[2][0] - q[3][0])))
    bh = int(round(bw * 1.4))
    k = koef(q, [(0, 0), (bw, 0), (bw, bh), (0, bh)])
    blatt = np.asarray(raum.transform((bw, bh), Image.PERSPECTIVE, k, Image.BICUBIC), np.float32)
    f = max(3, int(round(0.16 * bw)) | 1)
    licht = np.dstack([ndimage.gaussian_filter(ndimage.grey_opening(blatt[..., c], size=(f, f), mode='nearest'),
                                               0.06 * bw, mode='nearest') for c in range(3)])
    reflex = np.clip(blatt - licht, 0, None)
    gross = np.dstack([ndimage.gaussian_filter(licht[..., c], 0.25 * min(bw, bh), mode='nearest') for c in range(3)])
    licht = licht * (np.percentile(gross, 50) / np.maximum(gross, 1e-3)) ** flat
    l = licht / 255.0
    l = np.minimum(l / max(float(np.percentile(l, 97)), 0.15), 1.0)
    return bw, bh, l, reflex


def import_room(path, t, folder):
    wr = Writer(folder, 1)
    raum = Image.open(path).convert('RGB').resize((RAUM_ARBEIT, RAUM_ARBEIT), Image.LANCZOS)
    q = t['quad']
    bw, bh, l, reflex = sheet_light(raum, q)
    bg = wr.layer('background', 'Room', raum, 'normal', 1, opaque=True, role='background')
    light = wr.layer('light', 'Light', Image.fromarray(np.round(l * 255).astype(np.uint8)),
                     'multiply', 1, role='light')
    shine = wr.layer('shine', 'Glass reflection',
                     Image.fromarray(np.clip(np.round(reflex), 0, 255).astype(np.uint8)),
                     'add', SHINE, role='shine')
    for c in (light, shine):
        del c['x'], c['y']
    return {'width': RAUM_ARBEIT, 'height': RAUM_ARBEIT, 'layers': [bg, {
        'id': 'poster', 'kind': 'poster', 'name': 'Poster',
        'quad': [[x, y] for x, y in q], 'overscan': OVERSCAN, 'fit': 'cover', 'aspect': bh / bw,
        'tone': True, 'blend': 'normal', 'opacity': 1, 'visible': True,
        'sheet': {'source': 'background', 'shine': SHINE, 'flat': FLAT},
        'children': [light, shine],
    }]}


def main():
    src, dst = sys.argv[1], sys.argv[2]
    only = set(sys.argv[3:])
    os.makedirs(dst, exist_ok=True)
    for t in TEMPLATES:
        if only and t['id'] not in only:
            continue
        folder = os.path.join(dst, t['id'])
        shutil.rmtree(folder, ignore_errors=True)
        os.makedirs(folder)
        path = os.path.join(src, t['file'])
        scene = (import_psd if t['kind'] == 'psd' else import_room)(path, t, folder)
        scene = {'version': 1, 'id': t['id'], 'name': t['name'], 'order': t['order'],
                 'source': t['file'], **scene}
        with open(os.path.join(folder, 'scene.json'), 'w') as f:
            json.dump(scene, f, indent=1, ensure_ascii=False)
        print(f'✓ {t["id"]}  {scene["width"]}×{scene["height"]}  {len(scene["layers"])} layers')


if __name__ == '__main__':
    main()
