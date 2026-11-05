/* global CATALOG */
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

  function showFormErrors(root, list) {
    const ul = root.querySelector('.errors');
    ul.innerHTML = list.map((t) => `<li>${esc(t)}</li>`).join('');
    ul.hidden = !list.length;
    if (list.length) ul.scrollIntoView({ behavior: 'smooth', block: 'center' });
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

  const THUMB =
    '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M1 21h4V9H1v12zm22-11a2 2 0 0 0-2-2h-6.31l.95-4.57.03-.32a1.5 1.5 0 0 0-.44-1.06L14.17 1 7.59 7.59A1.98 1.98 0 0 0 7 9v10a2 2 0 0 0 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z"/></svg>';

  const TRASH =
    '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>';

  // ---------- роутер ----------

  function route() {
    const hash = location.hash || '#/games';
    const [, view, id, scriptId] = hash.split('/');
    document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === view));
    if (view === 'new') return renderEditor(null);
    if (view === 'edit' && id) return renderEditor(id);
    if (view === 'scripts' && id === 'new') return renderScriptEditor(null);
    if (view === 'scripts' && id === 'edit' && scriptId) return renderScriptEditor(scriptId);
    if (view === 'scripts') return renderScripts();
    return renderList();
  }

  window.addEventListener('hashchange', route);

  // ---------- карточка игры (как на mafia universe) ----------

  function roleCell(roleId) {
    const role = CATALOG.byId[roleId];
    if (!role) return '';
    const team = CATALOG.teams[role.team];
    return `<img src="${CATALOG.icon(role.id)}" alt="${esc(role.name)}" title="${esc(role.name)} — ${team.single}">`;
  }

  function gameCard(g, scriptName) {
    const votings = g.votings || (g.nominations?.length ? [{ nominations: g.nominations }] : []);
    const outRound = new Map(); // номер игрока -> [голосование, голосов]
    votings.forEach((v, vi) => v.nominations.forEach((n) => n.out && outRound.set(n.seat, [vi + 1, n.votes])));
    const rowAttrs = (p) => {
      const o = outRound.get(p.seat);
      return o ? ` class="out" title="Заголосован в голосовании ${o[0]}, голосов: ${o[1]}"` : '';
    };
    const rows = g.players
      .map(
        (p) => `
        <tr${rowAttrs(p)}>
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
          ${scriptName ? `<div class="card-script">${esc(scriptName)}</div>` : ''}
        </div>
        <table class="card-table"><tbody>${rows}</tbody></table>
      </article>`;
  }

  // ---------- фича 2: список игр ----------

  async function renderList() {
    app.innerHTML = '<p class="muted">Загрузка…</p>';
    let games;
    let scripts;
    try {
      [games, scripts] = await Promise.all([api('GET', '/api/games'), api('GET', '/api/scripts')]);
    } catch (e) {
      app.innerHTML = `<p class="error">Не удалось загрузить игры: ${esc(e.message)}</p>`;
      return;
    }
    // название сценария на карточке нужно, только когда сценариев несколько
    const scriptName = (g) => (scripts.length > 1 ? scripts.find((s) => s.id === g.scriptId)?.name : '');
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
      <div class="cards">${games.map((g) => gameCard(g, scriptName(g))).join('')}</div>`;
  }

  // ---------- фичи 1 и 3: создание и изменение игры ----------

  async function renderEditor(id) {
    app.innerHTML = '<p class="muted">Загрузка…</p>';
    let games;
    let scripts;
    let game;
    try {
      [games, scripts] = await Promise.all([api('GET', '/api/games'), api('GET', '/api/scripts')]);
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
        scriptId: last ? last.scriptId : scripts[0].id,
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
            <label class="f-script">Сценарий
              <select name="scriptId">
                ${scripts.map((s) => `<option value="${esc(s.id)}"${s.id === game.scriptId ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}
              </select>
            </label>
          </div>

          <table class="players">
            <thead>
              <tr><th class="c-nom" title="Выставить на голосование">${THUMB}</th><th class="c-seat">№</th><th>Никнейм</th><th class="c-role">Роль</th><th class="c-score">Баллы</th><th class="c-del"></th></tr>
            </thead>
            <tbody></tbody>
          </table>
          <button type="button" class="btn btn-ghost add-row">+ Добавить игрока</button>
        </div>

        <section class="voting">
          <h2>Голосования</h2>
          <div class="rounds"></div>
          <button type="button" class="btn btn-ghost add-round">+ Новое голосование</button>
        </section>

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

    const currentScript = () => scripts.find((s) => s.id === form.elements.scriptId.value);

    let uidSeq = 0;

    function playerRow(p) {
      const tr = document.createElement('tr');
      tr.dataset.uid = ++uidSeq;
      tr.innerHTML = `
        <td class="c-nom"><button type="button" class="nom-btn" title="Выставить на голосование">${esc(p.seat)}</button></td>
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
      const role = CATALOG.byId[roleId];
      btn.innerHTML = role
        ? `<img src="${CATALOG.icon(role.id)}" alt=""><span>${esc(role.name)}</span>`
        : '<span class="placeholder">выбрать</span>';
      // роль могла остаться от другого сценария: сохранить можно, но это стоит заметить
      const offScript = role && !currentScript().roles.includes(role.id);
      btn.className = 'role-btn' + (role ? ` team-${role.team}` : '') + (offScript ? ' off-script' : '');
      btn.title = role ? `${role.name} — ${CATALOG.teams[role.team].single}` : 'Выбрать роль';
      if (offScript) btn.title += ' (нет в выбранном сценарии)';
    }

    game.players.forEach((p) => tbody.appendChild(playerRow(p)));

    // чтобы во всплывашке картинки появлялись сразу
    for (const s of scripts) for (const r of s.roles) new Image().src = CATALOG.icon(r);

    // ---------- голосования ----------
    // Выставленные ссылаются на строку игрока по uid, чтобы смена номера игрока не ломала связь.
    // Номер в колонке 👍 выставляет игрока в активное голосование.
    const rowByUid = (uid) => tbody.querySelector(`tr[data-uid="${uid}"]`);
    const rowBySeat = (seat) => [...tbody.querySelectorAll('tr')].find((tr) => Number(tr.querySelector('.seat').value) === seat);
    const sourceVotings = game.votings || (game.nominations?.length ? [{ nominations: game.nominations }] : []);
    let rounds = sourceVotings.map((v) => ({
      noms: v.nominations
        .map((n) => ({ uid: rowBySeat(n.seat)?.dataset.uid, votes: n.votes || 0, out: !!n.out }))
        .filter((n) => n.uid),
    }));
    if (!rounds.length) rounds.push({ noms: [] });
    let active = rounds.length - 1;

    const roundsEl = form.querySelector('.rounds');

    // uid -> номер голосования (с 0), в котором игрока заголосовали
    function outRounds() {
      const map = new Map();
      rounds.forEach((r, ri) => r.noms.forEach((n) => n.out && !map.has(n.uid) && map.set(n.uid, ri)));
      return map;
    }

    function roundTable(r, ri, maxVotes, outIn) {
      if (!r.noms.length) {
        return `<p class="muted vote-hint">Нажмите на номер игрока в колонке ${THUMB}, чтобы выставить его в это голосование.</p>`;
      }
      const total = r.noms.reduce((s, n) => s + n.votes, 0);
      const counts = Array.from({ length: maxVotes + 1 }, (_, i) => i);
      const rows = r.noms
        .map((n) => {
          const tr = rowByUid(n.uid);
          const seat = tr.querySelector('.seat').value;
          const nick = tr.querySelector('.nick').value.trim();
          const btns = counts
            .map((c) => `<td><button type="button" class="vote-btn${c === n.votes ? ' active' : ''}" data-votes="${c}">${c}</button></td>`)
            .join('');
          const outElsewhere = outIn.has(n.uid) && outIn.get(n.uid) !== ri;
          return `
            <tr data-uid="${n.uid}" class="${n.out ? 'out' : ''}">
              <td class="v-del"><button type="button" class="icon-btn del-nom" title="Убрать с голосования" aria-label="Убрать с голосования">${TRASH}</button></td>
              <td class="v-player"><b>${esc(seat)}</b> <span>${esc(nick)}</span></td>
              <td class="v-count">${n.votes}</td>
              ${btns}
              <td class="v-out"><button type="button" class="out-btn${n.out ? ' active' : ''}" aria-pressed="${n.out}"
                ${outElsewhere ? `disabled title="Уже заголосован в голосовании ${outIn.get(n.uid) + 1}"` : ''}>Заголосован</button></td>
            </tr>`;
        })
        .join('');
      return `
        <div class="votes-wrap">
          <table class="votes">
            <thead>
              <tr>
                <th></th>
                <th class="v-player" title="Выставлен">${THUMB}</th>
                <th class="v-count" title="Всего голосов">${total}</th>
                <th colspan="${counts.length}">Кол-во голосов</th>
                <th></th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
    }

    function renderVotes() {
      const maxVotes = tbody.querySelectorAll('tr').length;
      for (const r of rounds) {
        r.noms = r.noms.filter((n) => rowByUid(n.uid));
        r.noms.forEach((n) => (n.votes = Math.min(n.votes, maxVotes)));
      }
      const outIn = outRounds();
      const inActive = new Set(rounds[active].noms.map((n) => n.uid));

      tbody.querySelectorAll('tr').forEach((tr) => {
        const uid = tr.dataset.uid;
        const btn = tr.querySelector('.nom-btn');
        const isOut = outIn.has(uid);
        tr.classList.toggle('nominated', inActive.has(uid));
        tr.classList.toggle('out', isOut);
        btn.textContent = tr.querySelector('.seat').value;
        btn.disabled = isOut && !inActive.has(uid);
        btn.title = isOut
          ? `Заголосован в голосовании ${outIn.get(uid) + 1}`
          : `Выставить в голосование ${active + 1}`;
      });

      roundsEl.innerHTML = rounds
        .map(
          (r, ri) => `
          <div class="round${ri === active ? ' active' : ''}" data-round="${ri}">
            <div class="round-head">
              <button type="button" class="round-title" title="Сделать активным">Голосование ${ri + 1}</button>
              ${ri === active ? '<span class="round-badge">выставляем сюда</span>' : ''}
              <button type="button" class="icon-btn del-round" title="Удалить голосование" aria-label="Удалить голосование">${TRASH}</button>
            </div>
            ${roundTable(r, ri, maxVotes, outIn)}
          </div>`
        )
        .join('');
    }

    roundsEl.addEventListener('click', (e) => {
      const roundEl = e.target.closest('.round');
      if (!roundEl) return;
      const ri = Number(roundEl.dataset.round);
      const r = rounds[ri];

      if (e.target.closest('.del-round')) {
        if (r.noms.length && !confirm(`Удалить голосование ${ri + 1}?`)) return;
        rounds.splice(ri, 1);
        if (!rounds.length) rounds.push({ noms: [] });
        if (active >= ri) active = Math.max(0, active - 1);
        if (active >= rounds.length) active = rounds.length - 1;
        renderVotes();
        return;
      }

      const tr = e.target.closest('tbody tr');
      const n = tr && r.noms.find((x) => x.uid === tr.dataset.uid);
      if (n && e.target.closest('.del-nom')) r.noms = r.noms.filter((x) => x !== n);
      else if (n && e.target.closest('.vote-btn')) n.votes = Number(e.target.closest('.vote-btn').dataset.votes);
      else if (n && e.target.closest('.out-btn')) n.out = !n.out;
      else if (ri === active) return;
      active = ri; // любое действие внутри голосования делает его активным
      renderVotes();
    });

    form.querySelector('.add-round').addEventListener('click', () => {
      rounds.push({ noms: [] });
      active = rounds.length - 1;
      renderVotes();
    });

    tbody.addEventListener('input', (e) => {
      if (e.target.matches('.seat, .nick')) renderVotes();
    });

    renderVotes();

    const usedRoles = () => [...tbody.querySelectorAll('tr')].map((tr) => tr.dataset.role).filter(Boolean);

    form.querySelector('.add-row').addEventListener('click', () => {
      const seats = [...tbody.querySelectorAll('.seat')].map((i) => Number(i.value) || 0);
      const tr = playerRow({ seat: Math.max(0, ...seats) + 1, nick: '', role: null, score: null });
      tbody.appendChild(tr);
      renderVotes();
      tr.querySelector('.nick').focus();
    });

    tbody.addEventListener('click', async (e) => {
      const tr = e.target.closest('tr');
      if (e.target.closest('.del-row')) {
        tr.remove();
        renderVotes();
        return;
      }
      if (e.target.closest('.nom-btn')) {
        const r = rounds[active];
        if (!r.noms.some((n) => n.uid === tr.dataset.uid)) r.noms.push({ uid: tr.dataset.uid, votes: 0, out: false });
        renderVotes();
        return;
      }
      if (e.target.closest('.role-btn')) {
        const picked = await pickRole(tr.dataset.role, usedRoles(), currentScript());
        if (picked !== undefined) {
          setRole(tr, picked);
          tr.querySelector('.score').focus();
        }
      }
    });

    form.addEventListener('change', (e) => {
      if (e.target.name === 'winner') head.className = 'editor-head ' + e.target.value;
      if (e.target.name === 'scriptId') tbody.querySelectorAll('tr').forEach((tr) => setRole(tr, tr.dataset.role));
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

    const showErrors = (list) => showFormErrors(form, list);

    function collect() {
      const fd = new FormData(form);
      return {
        scriptId: fd.get('scriptId'),
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
        votings: rounds
          .filter((r) => r.noms.length)
          .map((r) => ({
            nominations: r.noms.map((n) => ({
              seat: Number(rowByUid(n.uid).querySelector('.seat').value),
              votes: n.votes,
              out: n.out,
            })),
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

  // ---------- сценарии: список, импорт и экспорт ----------

  let scriptDraft = null; // импортированный сценарий, который ждёт проверки в редакторе

  const teamsOf = (roles) =>
    Object.entries(CATALOG.teams)
      .map(([teamId, team]) => [teamId, team, roles.filter((id) => CATALOG.byId[id].team === teamId)])
      .filter(([, , ids]) => ids.length);

  function downloadScript(script) {
    const blob = new Blob([JSON.stringify(CATALOG.scriptToJson(script), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${script.name}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function scriptCard(s) {
    const counts = teamsOf(s.roles)
      .map(([, team, ids]) => `${team.name}: ${ids.length}`)
      .join(' · ');
    const icons = s.roles
      .map((id) => `<img src="${CATALOG.icon(id)}" alt="" title="${esc(CATALOG.byId[id].name)}" loading="lazy">`)
      .join('');
    return `
      <article class="script-card" data-id="${esc(s.id)}">
        <h2><a href="#/scripts/edit/${esc(s.id)}">${esc(s.name)}</a></h2>
        <p class="muted">${s.author ? `${esc(s.author)} · ` : ''}игр: ${s.games}</p>
        <p class="muted">${counts}</p>
        <div class="script-icons">${icons}</div>
        <div class="script-actions">
          <a class="btn" href="#/scripts/edit/${esc(s.id)}">Изменить</a>
          <button type="button" class="btn export-script">Экспорт JSON</button>
        </div>
      </article>`;
  }

  async function renderScripts() {
    app.innerHTML = '<p class="muted">Загрузка…</p>';
    let scripts;
    try {
      scripts = await api('GET', '/api/scripts');
    } catch (e) {
      app.innerHTML = `<p class="error">Не удалось загрузить сценарии: ${esc(e.message)}</p>`;
      return;
    }
    app.innerHTML = `
      <div class="list-head">
        <h1>Сценарии <span class="muted">(${scripts.length})</span></h1>
        <div class="script-actions">
          <label class="btn">Импорт JSON<input type="file" class="import-script" accept=".json,application/json" hidden></label>
          <a class="btn btn-primary" href="#/scripts/new">+ Новый сценарий</a>
        </div>
      </div>
      <ul class="errors" hidden></ul>
      <div class="script-cards">${scripts.map(scriptCard).join('')}</div>`;

    app.querySelector('.script-cards').addEventListener('click', (e) => {
      if (!e.target.closest('.export-script')) return;
      const id = e.target.closest('.script-card').dataset.id;
      downloadScript(scripts.find((s) => s.id === id));
    });

    app.querySelector('.import-script').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        scriptDraft = CATALOG.parseScript(JSON.parse(await file.text()));
        location.hash = '#/scripts/new';
      } catch {
        showFormErrors(app, [`Файл «${file.name}» — не JSON сценария`]);
      }
    });
  }

  // ---------- редактор сценария ----------

  async function renderScriptEditor(id) {
    app.innerHTML = '<p class="muted">Загрузка…</p>';
    const draft = scriptDraft;
    scriptDraft = null;
    let script = draft || { name: '', author: '', roles: [] };
    if (id) {
      try {
        script = (await api('GET', '/api/scripts')).find((s) => s.id === id);
        if (!script) throw new Error('Сценарий не найден');
      } catch (e) {
        app.innerHTML = `<p class="error">${esc(e.message)}</p>`;
        return;
      }
    }

    const selected = [...script.roles];
    const unknown = draft?.unknown || [];

    const sections = Object.entries(CATALOG.teams)
      .map(([teamId, team]) => {
        const items = CATALOG.roles
          .filter((r) => r.team === teamId)
          .map(
            (r) => `<button type="button" class="role-opt" data-role="${r.id}" data-search="${esc(r.name.toLowerCase())}" aria-pressed="false">
              <img src="${CATALOG.icon(r.id)}" alt="" loading="lazy"><span>${esc(r.name)}</span></button>`
          )
          .join('');
        return `
          <section class="team team-${teamId}" data-team="${teamId}">
            <h3>${team.name} <span class="team-count"></span>${team.storyteller ? ' <span class="team-note">для ведущего, игрокам не выдаются</span>' : ''}</h3>
            <div class="role-grid">${items}</div>
          </section>`;
      })
      .join('');

    app.innerHTML = `
      <form class="script-editor" novalidate>
        <h1>${id ? `Сценарий «${esc(script.name)}»` : 'Новый сценарий'}</h1>
        <div class="script-meta">
          <label>Название
            <input name="name" type="text" required autocomplete="off" value="${esc(script.name)}">
          </label>
          <label>Автор
            <input name="author" type="text" autocomplete="off" value="${esc(script.author)}">
          </label>
        </div>
        ${unknown.length ? `<p class="warning">Этих ролей нет в каталоге, они пропущены: ${unknown.map(esc).join(', ')}</p>` : ''}
        <div class="script-layout">
          <div class="script-catalog">
            <input type="search" class="role-search" placeholder="Поиск роли…" aria-label="Поиск роли">
            ${sections}
            <p class="muted no-matches" hidden>Ничего не найдено</p>
          </div>
          <aside class="script-picked">
            <h2>В сценарии: <span class="picked-count"></span></h2>
            <div class="picked-list"></div>
            <ul class="errors" hidden></ul>
            <div class="actions">
              <button type="submit" class="btn btn-primary">Сохранить</button>
              <a class="btn" href="#/scripts">Отмена</a>
              ${id ? '<button type="button" class="btn btn-danger delete">Удалить</button>' : ''}
            </div>
          </aside>
        </div>
      </form>`;

    const form = app.querySelector('form');
    const tiles = [...form.querySelectorAll('.script-catalog .role-opt')];
    const pickedList = form.querySelector('.picked-list');

    function renderPicked() {
      form.querySelector('.picked-count').textContent = selected.length;
      for (const tile of tiles) {
        const on = selected.includes(tile.dataset.role);
        tile.classList.toggle('current', on);
        tile.setAttribute('aria-pressed', on);
      }
      form.querySelectorAll('.script-catalog .team').forEach((section) => {
        const teamId = section.dataset.team;
        const count = selected.filter((r) => CATALOG.byId[r].team === teamId).length;
        section.querySelector('.team-count').textContent = count ? `(${count})` : '';
      });
      pickedList.innerHTML = selected.length
        ? teamsOf(selected)
            .map(
              ([teamId, team, ids]) => `
              <div class="team team-${teamId}">
                <h3>${team.name}</h3>
                ${ids
                  .map(
                    (r) => `<button type="button" class="picked-item" data-role="${r}" title="Убрать из сценария">
                      <img src="${CATALOG.icon(r)}" alt=""><span>${esc(CATALOG.byId[r].name)}</span><i>✕</i></button>`
                  )
                  .join('')}
              </div>`
            )
            .join('')
        : '<p class="muted">Нажимайте на роли слева, чтобы добавить их.</p>';
    }

    function toggleRole(roleId) {
      const i = selected.indexOf(roleId);
      if (i === -1) selected.push(roleId);
      else selected.splice(i, 1);
      renderPicked();
    }

    form.querySelector('.script-catalog').addEventListener('click', (e) => {
      const tile = e.target.closest('.role-opt');
      if (tile) toggleRole(tile.dataset.role);
    });

    pickedList.addEventListener('click', (e) => {
      const item = e.target.closest('.picked-item');
      if (item) toggleRole(item.dataset.role);
    });

    form.querySelector('.role-search').addEventListener('input', (e) => {
      const q = e.target.value.trim().toLowerCase();
      for (const tile of tiles) tile.hidden = !tile.dataset.search.includes(q);
      form.querySelectorAll('.script-catalog .team').forEach((section) => {
        section.hidden = !section.querySelector('.role-opt:not([hidden])');
      });
      form.querySelector('.no-matches').hidden = tiles.some((t) => !t.hidden);
    });

    // Enter в поиске не должен отправлять форму
    form.querySelector('.role-search').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') e.preventDefault();
    });

    const del = form.querySelector('.delete');
    if (del) {
      del.addEventListener('click', async () => {
        if (!confirm(`Удалить сценарий «${script.name}»?`)) return;
        try {
          await api('DELETE', `/api/scripts/${id}`);
          toast(`Сценарий «${script.name}» удалён`);
          location.hash = '#/scripts';
        } catch (err) {
          showFormErrors(form, err.errors);
        }
      });
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const data = { name: fd.get('name'), author: fd.get('author'), roles: selected, bootlegger: script.bootlegger };
      const submit = form.querySelector('[type=submit]');
      submit.disabled = true;
      try {
        const saved = id ? await api('PUT', `/api/scripts/${id}`, data) : await api('POST', '/api/scripts', data);
        toast(`Сценарий «${saved.name}» сохранён`);
        location.hash = '#/scripts';
      } catch (err) {
        showFormErrors(form, err.errors);
      } finally {
        submit.disabled = false;
      }
    });

    renderPicked();
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
  function pickRole(current, used, script) {
    const groups = Object.entries(CATALOG.teams)
      .map(([teamId, team]) => {
        if (team.storyteller) return '';
        const roles = CATALOG.roles.filter((r) => r.team === teamId && script.roles.includes(r.id));
        if (!roles.length) return '';
        const items = roles
          .map((r) => {
            const cls = ['role-opt', r.id === current ? 'current' : '', used.includes(r.id) && r.id !== current ? 'used' : '']
              .filter(Boolean)
              .join(' ');
            return `<button type="button" class="${cls}" data-role="${r.id}" title="${esc(r.name)}">
              <img src="${CATALOG.icon(r.id)}" alt=""><span>${esc(r.name)}</span></button>`;
          })
          .join('');
        return `<section class="team team-${teamId}"><h3>${team.name}</h3><div class="role-grid">${items}</div></section>`;
      })
      .join('');
    pickerBody.innerHTML = groups;
    picker.hidden = false;
    document.addEventListener('keydown', onPickerKey);
    (pickerBody.querySelector('.current') || pickerBody.querySelector('.role-opt'))?.focus();
    return new Promise((resolve) => (pickerResolve = resolve));
  }

  pickerBody.addEventListener('click', (e) => {
    const opt = e.target.closest('.role-opt');
    if (opt) closePicker(opt.dataset.role);
  });
  picker.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', () => closePicker(undefined)));
  document.getElementById('picker-clear').addEventListener('click', () => closePicker(null));

  route();
})();
