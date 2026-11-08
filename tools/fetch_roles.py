"""Скачивает все роли с wiki.bloodontheclocktower.com.

Создаёт public/roles-data.js (id, название, тип роли), public/roles/<id>.png и
перекрашенные варианты для игроков, сменивших сторону:
<id>_evil.png (красные горожане и изгои) и <id>_good.png (синие приспешники и демоны).
Запускать заново, когда на вики появятся новые роли:

    python tools/fetch_roles.py

Только пересоздать перекрашенные варианты из уже скачанных иконок:

    python tools/fetch_roles.py --variants

Нужны Pillow и numpy (pip install pillow numpy).
"""
import concurrent.futures
import io
import json
import pathlib
import re
import sys
import time
import urllib.parse
import urllib.request

import numpy as np
from PIL import Image

API = 'https://wiki.bloodontheclocktower.com/api.php'
HEADERS = {'User-Agent': 'clocktower-results/0.1'}
ROOT = pathlib.Path(__file__).resolve().parent.parent
ICONS_DIR = ROOT / 'public' / 'roles'
DATA_FILE = ROOT / 'public' / 'roles-data.js'
ICON_SIZE = 256

# категория на вики -> тип роли; порядок задаёт порядок в каталоге
CATEGORIES = {
    'Townsfolk': 'townsfolk',
    'Outsiders': 'outsider',
    'Minions': 'minion',
    'Demons': 'demon',
    'Travellers': 'traveller',
    'Fabled': 'fabled',
    'Loric': 'loric',
}


def normalize(name):
    return re.sub(r'[^a-z0-9]', '', name.lower())


def get(url, timeout=60):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return res.read()


def api(**params):
    params.update(action='query', format='json')
    return json.loads(get(API + '?' + urllib.parse.urlencode(params)))


def category_titles(category):
    titles, cont = [], {}
    while True:
        d = api(list='categorymembers', cmtitle=f'Category:{category}', cmlimit=500, **cont)
        titles += [m['title'] for m in d['query']['categorymembers'] if m['ns'] == 0]
        if 'continue' not in d:
            return titles
        cont = {'cmcontinue': d['continue']['cmcontinue']}


def all_icons():
    icons, cont = {}, {}
    while True:
        d = api(list='allimages', aiprefix='Icon_', ailimit=500, aiprop='url|size', **cont)
        for i in d['query']['allimages']:
            icons[normalize(i['name'][len('Icon_'):-len('.png')])] = i
        if 'continue' not in d:
            return icons
        cont = {'aicontinue': d['continue']['aicontinue']}


def download_icon(role_id, info):
    """Скачивает иконку, проверяет полноту файла и сохраняет уменьшенную копию."""
    error = None
    for attempt in range(3):
        try:
            raw = get(info['url'])
            if len(raw) != info['size']:
                raise OSError(f"получено {len(raw)} байт из {info['size']}")
            img = Image.open(io.BytesIO(raw))
            img.load()  # упадёт на обрезанном файле
            img = img.convert('RGBA').resize((ICON_SIZE, ICON_SIZE), Image.LANCZOS)
            img.save(ICONS_DIR / f'{role_id}.png', optimize=True)
            return
        except OSError as e:
            error = e
            time.sleep(1 + attempt)
    raise RuntimeError(f'{role_id}: {error}')


# ---------- перекрашенные варианты ----------

GOOD_TEAMS = {'townsfolk', 'outsider'}
EVIL_TEAMS = {'minion', 'demon'}


def load_hsv(path):
    img = Image.open(path).convert('RGBA')
    hsv = np.asarray(img.convert('RGB').convert('HSV'), dtype=np.float64)
    alpha = np.asarray(img.getchannel('A'))
    return img, hsv, alpha


def colour_stats(hsv, alpha):
    """Основной оттенок (0..1, по кругу) и средняя яркость цветных пикселей."""
    h, s, v = hsv[..., 0] / 256, hsv[..., 1], hsv[..., 2]
    mask = (alpha > 128) & (s > 60) & (v > 30)
    if mask.sum() < 50:
        return None
    w = s[mask]
    angle = h[mask] * 2 * np.pi
    hue = np.arctan2((np.sin(angle) * w).sum(), (np.cos(angle) * w).sum()) / (2 * np.pi) % 1
    return hue, v[mask].mean()


def recolour(path, target_hue, target_value, out_path):
    img, hsv, alpha = load_hsv(path)
    stats = colour_stats(hsv, alpha)
    if stats is None:
        img.save(out_path, optimize=True)
        return
    hue, value = stats
    # Поворачиваем оттенок у всех пикселей: белые и серые детали от этого не меняются
    hsv[..., 0] = (hsv[..., 0] + (target_hue - hue) * 256) % 256
    # Яркость подгоняем только цветным пикселям, пропорционально насыщенности
    weight = hsv[..., 1] / 255
    factor = 1 + (target_value / value - 1) * weight
    hsv[..., 2] = np.clip(hsv[..., 2] * factor, 0, 255)
    rgb = Image.fromarray(hsv.round().astype(np.uint8), 'HSV').convert('RGB')
    out = rgb.convert('RGBA')
    out.putalpha(img.getchannel('A'))
    out.save(out_path, optimize=True)


def make_variants(roles):
    def reference(teams):
        stats = [colour_stats(*load_hsv(ICONS_DIR / f"{r['id']}.png")[1:]) for r in roles if r['team'] in teams]
        stats = [s for s in stats if s]
        angle = np.array([s[0] for s in stats]) * 2 * np.pi
        hue = np.arctan2(np.sin(angle).sum(), np.cos(angle).sum()) / (2 * np.pi) % 1
        return hue, float(np.median([s[1] for s in stats]))

    blue = reference({'townsfolk'})
    red = reference(EVIL_TEAMS)
    count = 0
    for r in roles:
        src = ICONS_DIR / f"{r['id']}.png"
        if r['team'] in GOOD_TEAMS:
            recolour(src, *red, ICONS_DIR / f"{r['id']}_evil.png")
        elif r['team'] in EVIL_TEAMS:
            recolour(src, *blue, ICONS_DIR / f"{r['id']}_good.png")
        else:
            continue
        count += 1
    print(f'Перекрашенных вариантов: {count}')


def load_roles():
    text = DATA_FILE.read_text(encoding='utf-8')
    return [json.loads(line.strip().rstrip(',')) for line in text.splitlines() if line.strip().startswith('{"id"')]


def main():
    if '--variants' in sys.argv:
        make_variants(load_roles())
        return

    icons = all_icons()
    roles, seen, skipped = [], set(), []
    for category, team in CATEGORIES.items():
        for title in category_titles(category):
            role_id = normalize(title)
            if role_id not in icons:
                skipped.append(title)  # например, «God of Ug (Ug Mode)» — вариант другой страницы
            elif role_id not in seen:
                seen.add(role_id)
                roles.append({'id': role_id, 'name': title, 'team': team})

    ICONS_DIR.mkdir(parents=True, exist_ok=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        jobs = [pool.submit(download_icon, r['id'], icons[r['id']]) for r in roles]
        for job in concurrent.futures.as_completed(jobs):
            job.result()

    lines = ',\n'.join('    ' + json.dumps(r, ensure_ascii=False) for r in roles)
    DATA_FILE.write_text(
        '// Сгенерировано tools/fetch_roles.py, вручную не править.\n'
        '(function (root) {\n'
        f'  const ROLES = [\n{lines},\n  ];\n'
        "  if (typeof module === 'object' && module.exports) module.exports = ROLES;\n"
        '  else root.ROLE_DATA = ROLES;\n'
        '})(this);\n',
        encoding='utf-8',
    )

    print(f'Ролей: {len(roles)}')
    if skipped:
        print('Пропущено (нет иконки):', ', '.join(skipped))
    make_variants(roles)


if __name__ == '__main__':
    sys.exit(main())
