"""Скачивает все роли с wiki.bloodontheclocktower.com.

Создаёт public/roles-data.js (id, название, тип роли) и public/roles/<id>.png.
Запускать заново, когда на вики появятся новые роли:

    python tools/fetch_roles.py

Нужен Pillow (pip install pillow).
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


def main():
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


if __name__ == '__main__':
    sys.exit(main())
