/* global SCRIPT */
(function () {
  const app = document.getElementById('app');
  const DEFAULT_PLAYERS = 10;

  // ---------- утилиты ----------

  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  const pad = (n) => String(n).padStart(2, '0');

  // YYYY-MM-DD -> DD-MM-YYYY
  const fmtDate = (iso) => (iso ? iso.split('-').reverse().join('-') : '');

  const fmtScore = (n) => (n === null || n === undefined ? '' : String(n).replace('.', ','));

  function nowParts() {
    const d = new Date();
    return {
      date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
    };
  }

  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error((data.errors || ['Ошибка сервера']).join('\n'));
      err.errors = data.errors || ['Ошибка сервера'];
      throw err;
    }
    return data;
  }

  let toastTimer;
  function toast(text) {
    const el = document.getElementById('toast');
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), 2500);
  }

  const PENCIL =
    '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>';

  // ---------- роутер ----------

  function route() {
    const hash = location.hash || '#/games';
    const [, view, id] = hash.split('/');
    document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === view));
    if (view === 'new') return renderEditor(null);
    if (view === 'edit' && id) return renderEditor(id);
    return renderList();
  }

  window.addEventListener('hashchange', route);

  // ---------- карточка игры (как на mafia universe) ----------

  function roleCell(roleId) {
    const role = SCRIPT.byId[roleId];
    if (!role) return '';
    const team = SCRIPT.teams[role.team];
    return `<img src="${SCRIPT.icon(role.id)}" alt="${esc(role.name)}" title="${esc(role.name)} — ${team.single}">`;
  }

  function gameCard(g) {
    const rows = g.players
      .map(
        (p) => `
        <tr>
          <td class="c-seat">${p.seat}</td>
          <td class="c-nick">${esc(p.nick)}</td>
          <td class="c-role">${roleCell(p.role)}</td>
          <td class="c-score">${fmtScore(p.score)}</td>
        </tr>`
      )
      .join('');
    const winText = g.winner === 'good' ? 'Победа Добра' : 'Победа Зла';
    return `
      <article class="card ${g.winner}" title="${winText}">
        <div class="card-head">
          <a class="card-edit" href="#/edit/${g.id}" title="Изменить">${PENCIL}</a>
          <div class="card-title"><a href="#/edit/${g.id}">Игра ${g.number}</a> <span class="check">✓</span></div>
          <div class="card-host">${esc(g.host)}</div>
          <div class="card-date">${fmtDate(g.date)} ${esc(g.time)}</div>
        </div>
        <table class="card-table"><tbody>${rows}</tbody></table>
      </article>`;
  }

  // ---------- фича 2: список игр ----------

  async function renderList() {
    app.innerHTML = '<p class="muted">Загрузка…</p>';
    let games;
    try {
      games = await api('GET', '/api/games');
    } catch (e) {
      app.innerHTML = `<p class="error">Не удалось загрузить игры: ${esc(e.message)}</p>`;
      return;
    }
    if (!games.length) {
      app.innerHTML = `
        <div class="empty">
          <p>Пока нет ни одной игры.</p>
          <a class="btn btn-primary" href="#/new">+ Создать первую игру</a>
        </div>`;
      return;
    }
    const good = games.filter((g) => g.winner === 'good').length;
    app.innerHTML = `
      <div class="list-head">
        <h1>Список игр <span class="muted">(${games.length})</span></h1>
        <div class="legend">
          <span><i class="sw good"></i>Победа Добра — ${good}</span>
          <span><i class="sw evil"></i>Победа Зла — ${games.length - good}</span>
        </div>
      </div>
      <div class="cards">${games.map(gameCard).join('')}</div>`;
  }

  // ---------- фичи 1 и 3: создание и изменение игры ----------

  async function renderEditor(id) {
    app.innerHTML = '<p class="muted">Загрузка…</p>';
    let games;
    let game;
    try {
      games = await api('GET', '/api/games');
      if (id) {
        game = games.find((g) => g.id === id);
        if (!game) throw new Error('Игра не найдена');
        game = structuredClone(game);
      }
    } catch (e) {
      app.innerHTML = `<p class="error">${esc(e.message)}</p>`;
      return;
    }

    if (!game) {
      const { date, time } = nowParts();
      const last = games[0];
      game = {
        number: games.reduce((m, g) => Math.max(m, g.number), 0) + 1,
        host: last ? last.host : '',
        date,
        time,
        winner: null,
        players: Array.from({ length: DEFAULT_PLAYERS }, (_, i) => ({ seat: i + 1, nick: '', role: null, score: null })),
      };
    }

    const nicks = [...new Set(games.flatMap((g) => g.players.map((p) => p.nick)))].sort((a, b) => a.localeCompare(b));
    const hosts = [...new Set(games.map((g) => g.host))].sort((a, b) => a.localeCompare(b));

    app.innerHTML = `
      <form class="editor" novalidate>
        <h1>${id ? `Изменение игры ${game.number}` : 'Новая игра'}</h1>

        <div class="editor-card">
          <div class="editor-head ${game.winner || ''}">
            <label class="f-number">Игра №
              <input name="number" type="number" min="1" step="1" required value="${esc(game.number)}">
            </label>
            <label class="f-host">Ведущий
              <input name="host" type="text" list="hosts-list" required autocomplete="off" value="${esc(game.host)}" placeholder="Kirill736nik">
            </label>
            <label class="f-date">Дата
              <input name="date" type="date" required value="${esc(game.date)}">
            </label>
            <label class="f-time">Время
              <input name="time" type="time" required value="${esc(game.time)}">
            </label>
          </div>

          <table class="players">
            <thead>
              <tr><th class="c-seat">№</th><th>Никнейм</th><th class="c-role">Роль</th><th class="c-score">Баллы</th><th class="c-del"></th></tr>
            </thead>
            <tbody></tbody>
          </table>
          <button type="button" class="btn btn-ghost add-row">+ Добавить игрока</button>
        </div>

        <fieldset class="winner">
          <legend>Кто победил?</legend>
          <label class="win-opt good"><input type="radio" name="winner" value="good" ${game.winner === 'good' ? 'checked' : ''}> Добро</label>
          <label class="win-opt evil"><input type="radio" name="winner" value="evil" ${game.winner === 'evil' ? 'checked' : ''}> Зло</label>
        </fieldset>

        <ul class="errors" hidden></ul>

        <div class="actions">
          <button type="submit" class="btn btn-primary">Сохранить</button>
          <a class="btn" href="#/games">Отмена</a>
          ${id ? '<button type="button" class="btn btn-danger delete">Удалить игру</button>' : ''}
        </div>

        <datalist id="nicks-list">${nicks.map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
        <datalist id="hosts-list">${hosts.map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
      </form>`;

    const form = app.querySelector('form');
    const tbody = form.querySelector('tbody');
    const head = form.querySelector('.editor-head');

    function playerRow(p) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="c-seat"><input class="seat" type="number" min="1" step="1" value="${esc(p.seat)}" aria-label="Номер игрока"></td>
        <td><input class="nick" type="text" list="nicks-list" autocomplete="off" value="${esc(p.nick)}" placeholder="nickname" aria-label="Никнейм"></td>
        <td class="c-role"><button type="button" class="role-btn" aria-label="Выбрать роль"></button></td>
        <td class="c-score"><input class="score" type="text" inputmode="decimal" value="${esc(fmtScore(p.score))}" placeholder="0" aria-label="Баллы"></td>
        <td class="c-del"><button type="button" class="icon-btn del-row" title="Удалить строку" aria-label="Удалить строку">✕</button></td>`;
      setRole(tr, p.role);
      return tr;
    }

    function setRole(tr, roleId) {
      tr.dataset.role = roleId || '';
      const btn = tr.querySelector('.role-btn');
      const role = SCRIPT.byId[roleId];
      btn.innerHTML = role
        ? `<img src="${SCRIPT.icon(role.id)}" alt=""><span>${esc(role.name)}</span>`
        : '<span class="placeholder">выбрать</span>';
      btn.className = 'role-btn' + (role ? ` team-${role.team}` : '');
      btn.title = role ? `${role.name} — ${SCRIPT.teams[role.team].single}` : 'Выбрать роль';
    }

    game.players.forEach((p) => tbody.appendChild(playerRow(p)));

    const usedRoles = () => [...tbody.querySelectorAll('tr')].map((tr) => tr.dataset.role).filter(Boolean);

    form.querySelector('.add-row').addEventListener('click', () => {
      const seats = [...tbody.querySelectorAll('.seat')].map((i) => Number(i.value) || 0);
      const tr = playerRow({ seat: Math.max(0, ...seats) + 1, nick: '', role: null, score: null });
      tbody.appendChild(tr);
      tr.querySelector('.nick').focus();
    });

    tbody.addEventListener('click', async (e) => {
      const tr = e.target.closest('tr');
      if (e.target.closest('.del-row')) {
        tr.remove();
        return;
      }
      if (e.target.closest('.role-btn')) {
        const picked = await pickRole(tr.dataset.role, usedRoles());
        if (picked !== undefined) {
          setRole(tr, picked);
          tr.querySelector('.score').focus();
        }
      }
    });

    form.addEventListener('change', (e) => {
      if (e.target.name === 'winner') head.className = 'editor-head ' + e.target.value;
    });

    const del = form.querySelector('.delete');
    if (del) {
      del.addEventListener('click', async () => {
        if (!confirm(`Удалить игру ${game.number}? Это действие нельзя отменить.`)) return;
        try {
          await api('DELETE', `/api/games/${id}`);
          toast(`Игра ${game.number} удалена`);
          location.hash = '#/games';
        } catch (err) {
          showErrors(err.errors);
        }
      });
    }

    function showErrors(list) {
      const ul = form.querySelector('.errors');
      ul.innerHTML = list.map((t) => `<li>${esc(t)}</li>`).join('');
      ul.hidden = !list.length;
      if (list.length) ul.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    function collect() {
      const fd = new FormData(form);
      return {
        number: Number(fd.get('number')),
        host: String(fd.get('host') || '').trim(),
        date: fd.get('date'),
        time: fd.get('time'),
        winner: fd.get('winner'),
        players: [...tbody.querySelectorAll('tr')].map((tr) => ({
          seat: Number(tr.querySelector('.seat').value),
          nick: tr.querySelector('.nick').value.trim(),
          role: tr.dataset.role || null,
          score: tr.querySelector('.score').value.trim().replace(',', '.') || null,
        })),
      };
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = collect();
      const submit = form.querySelector('[type=submit]');
      submit.disabled = true;
      try {
        const saved = id ? await api('PUT', `/api/games/${id}`, data) : await api('POST', '/api/games', data);
        toast(`Игра ${saved.number} сохранена`);
        location.hash = '#/games';
      } catch (err) {
        showErrors(err.errors);
      } finally {
        submit.disabled = false;
      }
    });
  }

  // ---------- всплывающий выбор роли ----------

  const picker = document.getElementById('role-picker');
  const pickerBody = document.getElementById('picker-body');
  let pickerResolve = null;

  function closePicker(value) {
    picker.hidden = true;
    document.removeEventListener('keydown', onPickerKey);
    if (pickerResolve) pickerResolve(value);
    pickerResolve = null;
  }

  function onPickerKey(e) {
    if (e.key === 'Escape') closePicker(undefined);
  }

  // Возвращает id роли, null (убрать роль) или undefined (отмена)
  function pickRole(current, used) {
    const groups = Object.entries(SCRIPT.teams)
      .map(([teamId, team]) => {
        const roles = SCRIPT.roles.filter((r) => r.team === teamId);
        if (!roles.length) return '';
        const items = roles
          .map((r) => {
            const cls = ['role-opt', r.id === current ? 'current' : '', used.includes(r.id) && r.id !== current ? 'used' : '']
              .filter(Boolean)
              .join(' ');
            return `<button type="button" class="${cls}" data-role="${r.id}" title="${esc(r.name)}">
              <img src="${SCRIPT.icon(r.id)}" alt=""><span>${esc(r.name)}</span></button>`;
          })
          .join('');
        return `<section class="team team-${teamId}"><h3>${team.name}</h3><div class="role-grid">${items}</div></section>`;
      })
      .join('');
    pickerBody.innerHTML = groups;
    picker.hidden = false;
    document.addEventListener('keydown', onPickerKey);
    (pickerBody.querySelector('.current') || pickerBody.querySelector('.role-opt')).focus();
    return new Promise((resolve) => (pickerResolve = resolve));
  }

  pickerBody.addEventListener('click', (e) => {
    const opt = e.target.closest('.role-opt');
    if (opt) closePicker(opt.dataset.role);
  });
  picker.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', () => closePicker(undefined)));
  document.getElementById('picker-clear').addEventListener('click', () => closePicker(null));

  // чтобы во всплывашке картинки появлялись сразу
  for (const r of SCRIPT.roles) new Image().src = SCRIPT.icon(r.id);

  route();
})();
