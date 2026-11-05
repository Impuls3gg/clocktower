const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ExcelJS = require('exceljs');
const CATALOG = require('./public/roles.js');

const PORT = Number(process.env.PORT) || 3777;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'games.json');
const SCRIPTS_FILE = path.join(DATA_DIR, 'scripts.json');

// Первый сценарий приложения: к нему относятся игры, сохранённые до появления сценариев
const DEFAULT_SCRIPT_ID = 'one-night-one-fight';
const DEFAULT_SCRIPT_FILE = path.join(__dirname, 'one-night-one-fight.json');

// ---------- хранилище ----------

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(file)) fs.copyFileSync(file, file.replace(/\.json$/, '.backup.json'));
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function loadGames() {
  return (readJson(DB_FILE) || []).map((g) => (g.scriptId ? g : { ...g, scriptId: DEFAULT_SCRIPT_ID }));
}

function saveGames(games) {
  writeJson(DB_FILE, games);
}

function loadScripts() {
  const scripts = readJson(SCRIPTS_FILE);
  if (scripts) return scripts;
  const { unknown, ...script } = CATALOG.parseScript(readJson(DEFAULT_SCRIPT_FILE));
  return [{ id: DEFAULT_SCRIPT_ID, ...script }];
}

function saveScripts(scripts) {
  writeJson(SCRIPTS_FILE, scripts);
}

const byNumberDesc = (a, b) => b.number - a.number;

// ---------- валидация ----------

const NICK_RE = /^[\x20-\x7E]+$/; // латиница, цифры, пробел и ASCII-символы

function isValidDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function normalizeScript(body, scripts, selfId) {
  const errors = [];
  const b = body || {};

  const name = String(b.name || '').trim();
  if (!name) errors.push('Укажите название сценария');
  else if (scripts.some((s) => s.name.toLowerCase() === name.toLowerCase() && s.id !== selfId))
    errors.push(`Сценарий «${name}» уже существует`);

  const roles = [...new Set(Array.isArray(b.roles) ? b.roles : [])];
  if (!roles.some((id) => CATALOG.byId[id] && !CATALOG.teams[CATALOG.byId[id].team].storyteller))
    errors.push('Добавьте в сценарий хотя бы одну роль для игроков');
  for (const id of roles) if (!CATALOG.byId[id]) errors.push(`Неизвестная роль «${id}»`);

  const script = { name, author: String(b.author || '').trim(), roles };
  if (Array.isArray(b.bootlegger)) script.bootlegger = b.bootlegger.map(String);
  return { errors, script };
}

function normalizeGame(body, games, selfId, scripts) {
  const errors = [];
  const b = body || {};

  const scriptId = b.scriptId || DEFAULT_SCRIPT_ID;
  if (!scripts.some((s) => s.id === scriptId)) errors.push('Выберите сценарий');

  const number = Number(b.number);
  if (!Number.isInteger(number) || number < 1) errors.push('Номер игры должен быть натуральным числом');
  else if (games.some((g) => g.number === number && g.id !== selfId)) errors.push(`Игра №${number} уже существует`);

  const host = String(b.host || '').trim();
  if (!host) errors.push('Укажите ведущего');

  const date = String(b.date || '');
  if (!isValidDate(date)) errors.push('Некорректная дата');

  const time = String(b.time || '');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) errors.push('Некорректное время');

  const winner = b.winner;
  if (winner !== 'good' && winner !== 'evil') errors.push('Укажите, кто победил: Добро или Зло');

  const players = [];
  const rawPlayers = Array.isArray(b.players) ? b.players : [];
  if (rawPlayers.length === 0) errors.push('Добавьте хотя бы одного игрока');
  const seats = new Set();
  rawPlayers.forEach((p, i) => {
    const row = `Строка ${i + 1}`;
    const seat = Number(p.seat);
    if (!Number.isInteger(seat) || seat < 1) errors.push(`${row}: номер игрока должен быть натуральным числом`);
    else if (seats.has(seat)) errors.push(`${row}: номер игрока ${seat} повторяется`);
    seats.add(seat);

    const nick = String(p.nick || '').trim();
    if (!nick) errors.push(`${row}: укажите никнейм`);
    else if (!NICK_RE.test(nick)) errors.push(`${row}: никнейм «${nick}» должен быть латиницей`);

    const role = p.role || null;
    if (!role) errors.push(`${row}: выберите роль`);
    else if (!CATALOG.byId[role]) errors.push(`${row}: неизвестная роль «${role}»`);

    let score = null;
    if (p.score !== null && p.score !== undefined && String(p.score).trim() !== '') {
      score = Number(String(p.score).replace(',', '.'));
      if (!Number.isFinite(score)) errors.push(`${row}: баллы должны быть числом`);
    }

    players.push({ seat, nick, role, score });
  });

  // голосования по порядку: кто выставлен, сколько голосов, кого заголосовали
  const votings = [];
  const outRound = new Map(); // номер игрока -> в каком голосовании заголосован
  votingsOf(b).forEach((v, vi) => {
    const label = `Голосование ${vi + 1}`;
    const nominations = [];
    const nominated = new Set();
    (Array.isArray(v?.nominations) ? v.nominations : []).forEach((n) => {
      const seat = Number(n.seat);
      if (!seats.has(seat)) errors.push(`${label}: игрока №${n.seat} нет в таблице`);
      else if (nominated.has(seat)) errors.push(`${label}: игрок №${seat} выставлен дважды`);
      else if (outRound.has(seat)) errors.push(`${label}: игрок №${seat} уже заголосован в голосовании ${outRound.get(seat)}`);
      nominated.add(seat);

      const votes = Number(n.votes ?? 0);
      if (!Number.isInteger(votes) || votes < 0 || votes > rawPlayers.length)
        errors.push(`${label}: у игрока №${seat} некорректное число голосов`);

      nominations.push({ seat, votes, out: n.out === true });
    });
    for (const n of nominations) if (n.out) outRound.set(n.seat, vi + 1);
    if (nominations.length) votings.push({ nominations });
  });

  players.sort((a, b2) => a.seat - b2.seat);
  return { errors, game: { scriptId, number, host, date, time, winner, players, votings } };
}

// Старые игры хранили одно голосование в поле nominations
function votingsOf(game) {
  if (Array.isArray(game.votings)) return game.votings;
  return Array.isArray(game.nominations) && game.nominations.length ? [{ nominations: game.nominations }] : [];
}

// номер игрока -> { times, votes, outRound } по всем голосованиям игры
function votingSummary(game) {
  const map = new Map();
  votingsOf(game).forEach((v, vi) => {
    for (const n of v.nominations) {
      const s = map.get(n.seat) || { times: 0, votes: 0, outRound: null };
      s.times++;
      s.votes += n.votes;
      if (n.out) s.outRound = vi + 1;
      map.set(n.seat, s);
    }
  });
  return map;
}

// ---------- экспорт в Excel ----------

const WIN_LABEL = { good: 'Добро', evil: 'Зло' };

// Сторона, определяемая типом роли; у путешественников её нет, такие ячейки остаются пустыми
const sideLabel = (team) => (team ? WIN_LABEL[team.alignment] ?? '' : '');

function wonLabel(team, game) {
  if (!team || !team.alignment) return '';
  return team.alignment === game.winner ? 'Да' : 'Нет';
}

function excelDate(game) {
  const [y, m, d] = game.date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function styleSheet(ws) {
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2B2B3A' } };
  header.alignment = { vertical: 'middle' };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } };
}

async function buildWorkbook(games, scripts) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Clocktower Results';
  wb.created = new Date();
  const sorted = [...games].sort((a, b) => a.number - b.number);
  const scriptName = (g) => scripts.find((s) => s.id === g.scriptId)?.name ?? '';

  // 1. Плоская таблица: одна строка = один игрок в одной игре
  const flat = wb.addWorksheet('Результаты');
  flat.columns = [
    { header: 'Игра №', key: 'number', width: 9 },
    { header: 'Дата', key: 'date', width: 12, style: { numFmt: 'dd-mm-yyyy' } },
    { header: 'Время', key: 'time', width: 8 },
    { header: 'Сценарий', key: 'script', width: 22 },
    { header: 'Ведущий', key: 'host', width: 18 },
    { header: 'Победа', key: 'winner', width: 9 },
    { header: 'Номер игрока', key: 'seat', width: 8 },
    { header: 'Игрок', key: 'nick', width: 20 },
    { header: 'Роль', key: 'role', width: 16 },
    { header: 'Тип роли', key: 'type', width: 15 },
    { header: 'Команда', key: 'alignment', width: 10 },
    { header: 'Победил', key: 'won', width: 9 },
    { header: 'Баллы', key: 'score', width: 9 },
    { header: 'Выставлялся (раз)', key: 'nominated', width: 12 },
    { header: 'Голосов всего', key: 'votes', width: 10 },
    { header: 'Заголосован в голосовании №', key: 'out', width: 14 },
  ];
  for (const g of sorted) {
    const summary = votingSummary(g);
    for (const p of g.players) {
      const role = CATALOG.byId[p.role];
      const team = role ? CATALOG.teams[role.team] : null;
      const vs = summary.get(p.seat);
      flat.addRow({
        number: g.number,
        date: excelDate(g),
        time: g.time,
        script: scriptName(g),
        host: g.host,
        winner: WIN_LABEL[g.winner],
        seat: p.seat,
        nick: p.nick,
        role: role ? role.name : p.role,
        type: team ? team.single : '',
        alignment: sideLabel(team),
        won: wonLabel(team, g),
        score: p.score,
        nominated: vs ? vs.times : 0,
        votes: vs ? vs.votes : 0,
        out: vs ? vs.outRound : null,
      });
    }
  }
  styleSheet(flat);

  // 1б. Голосования: одна строка = один выставленный игрок в одном голосовании
  const vsheet = wb.addWorksheet('Голосования');
  vsheet.columns = [
    { header: 'Игра №', key: 'number', width: 9 },
    { header: 'Дата', key: 'date', width: 12, style: { numFmt: 'dd-mm-yyyy' } },
    { header: 'Сценарий', key: 'script', width: 22 },
    { header: 'Голосование №', key: 'round', width: 14 },
    { header: 'Номер игрока', key: 'seat', width: 8 },
    { header: 'Игрок', key: 'nick', width: 20 },
    { header: 'Роль', key: 'role', width: 16 },
    { header: 'Команда', key: 'alignment', width: 10 },
    { header: 'Голосов', key: 'votes', width: 9 },
    { header: 'Заголосован', key: 'out', width: 12 },
  ];
  for (const g of sorted) {
    votingsOf(g).forEach((v, vi) => {
      for (const n of v.nominations) {
        const p = g.players.find((x) => x.seat === n.seat);
        const role = CATALOG.byId[p?.role];
        vsheet.addRow({
          number: g.number,
          date: excelDate(g),
          script: scriptName(g),
          round: vi + 1,
          seat: n.seat,
          nick: p ? p.nick : '',
          role: role ? role.name : '',
          alignment: sideLabel(role && CATALOG.teams[role.team]),
          votes: n.votes,
          out: n.out ? 'Да' : '',
        });
      }
    });
  }
  styleSheet(vsheet);

  // 2. Игры
  const gs = wb.addWorksheet('Игры');
  gs.columns = [
    { header: 'Игра №', key: 'number', width: 9 },
    { header: 'Дата', key: 'date', width: 12, style: { numFmt: 'dd-mm-yyyy' } },
    { header: 'Время', key: 'time', width: 8 },
    { header: 'Сценарий', key: 'script', width: 22 },
    { header: 'Ведущий', key: 'host', width: 18 },
    { header: 'Победа', key: 'winner', width: 9 },
    { header: 'Игроков', key: 'count', width: 9 },
    { header: 'Демон', key: 'demon', width: 20 },
    { header: 'Голосований', key: 'rounds', width: 12 },
    { header: 'Заголосованы (№ голосования)', key: 'out', width: 30 },
  ];
  for (const g of sorted) {
    const demons = g.players.filter((p) => CATALOG.byId[p.role]?.team === 'demon').map((p) => p.nick);
    const outNicks = votingsOf(g).flatMap((v, vi) =>
      v.nominations.filter((n) => n.out).map((n) => `${g.players.find((p) => p.seat === n.seat)?.nick ?? n.seat} (${vi + 1})`)
    );
    gs.addRow({
      number: g.number,
      date: excelDate(g),
      time: g.time,
      script: scriptName(g),
      host: g.host,
      winner: WIN_LABEL[g.winner],
      count: g.players.length,
      demon: demons.join(', '),
      rounds: votingsOf(g).length,
      out: outNicks.join(', '),
    });
  }
  styleSheet(gs);

  // 3. Статистика игроков
  const stats = new Map();
  for (const g of sorted) {
    const summary = votingSummary(g);
    for (const p of g.players) {
      const role = CATALOG.byId[p.role];
      if (!role) continue;
      const side = CATALOG.teams[role.team].alignment;
      const s = stats.get(p.nick) || { nick: p.nick, games: 0, wins: 0, score: 0, good: 0, goodWins: 0, evil: 0, evilWins: 0, out: 0 };
      const won = side === g.winner;
      s.games++;
      if (summary.get(p.seat)?.outRound) s.out++;
      if (won) s.wins++;
      s.score += p.score || 0;
      if (side) s[side]++;
      if (won) s[side + 'Wins']++;
      stats.set(p.nick, s);
    }
  }
  const ps = wb.addWorksheet('Статистика игроков');
  ps.columns = [
    { header: 'Игрок', key: 'nick', width: 20 },
    { header: 'Игр', key: 'games', width: 7 },
    { header: 'Побед', key: 'wins', width: 8 },
    { header: '% побед', key: 'winrate', width: 9, style: { numFmt: '0%' } },
    { header: 'Сумма баллов', key: 'score', width: 13, style: { numFmt: '0.###' } },
    { header: 'Средний балл', key: 'avg', width: 13, style: { numFmt: '0.000' } },
    { header: 'Игр за Добро', key: 'good', width: 12 },
    { header: 'Побед за Добро', key: 'goodWins', width: 14 },
    { header: 'Игр за Зло', key: 'evil', width: 11 },
    { header: 'Побед за Зло', key: 'evilWins', width: 13 },
    { header: 'Раз заголосован', key: 'out', width: 15 },
  ];
  const rows = [...stats.values()].sort((a, b) => b.score - a.score || b.wins - a.wins);
  for (const s of rows) {
    // % побед считается только по играм, где сторона известна (без путешественников)
    const decided = s.good + s.evil;
    ps.addRow({ ...s, score: Math.round(s.score * 1000) / 1000, winrate: decided ? s.wins / decided : null, avg: s.score / s.games });
  }
  styleSheet(ps);

  // 4. Статистика ролей
  const rs = wb.addWorksheet('Статистика ролей');
  rs.columns = [
    { header: 'Роль', key: 'role', width: 16 },
    { header: 'Тип роли', key: 'type', width: 15 },
    { header: 'Сыграна раз', key: 'games', width: 12 },
    { header: 'Побед', key: 'wins', width: 8 },
    { header: '% побед', key: 'winrate', width: 9, style: { numFmt: '0%' } },
  ];
  for (const role of CATALOG.roles) {
    const team = CATALOG.teams[role.team];
    let n = 0;
    let w = 0;
    for (const g of sorted) {
      for (const p of g.players) {
        if (p.role !== role.id) continue;
        n++;
        if (team.alignment === g.winner) w++;
      }
    }
    if (!n) continue; // в каталоге почти 200 ролей, несыгранные только мешают
    const known = !!team.alignment;
    rs.addRow({ role: role.name, type: team.single, games: n, wins: known ? w : null, winrate: known ? w / n : null });
  }
  styleSheet(rs);

  return wb;
}

// ---------- HTTP ----------

const app = express();
app.use(express.json({ limit: '1mb' }));
// no-cache: после обновления приложения браузер сразу берёт свежие файлы
app.use(express.static(path.join(__dirname, 'public'), { setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') }));

app.get('/api/games', (req, res) => {
  res.json(loadGames().sort(byNumberDesc));
});

app.get('/api/games/:id', (req, res) => {
  const game = loadGames().find((g) => g.id === req.params.id);
  if (!game) return res.status(404).json({ errors: ['Игра не найдена'] });
  res.json(game);
});

app.post('/api/games', (req, res) => {
  const games = loadGames();
  const { errors, game } = normalizeGame(req.body, games, null, loadScripts());
  if (errors.length) return res.status(400).json({ errors });
  const now = new Date().toISOString();
  const saved = { id: crypto.randomUUID(), ...game, createdAt: now, updatedAt: now };
  games.push(saved);
  saveGames(games);
  res.status(201).json(saved);
});

app.put('/api/games/:id', (req, res) => {
  const games = loadGames();
  const idx = games.findIndex((g) => g.id === req.params.id);
  if (idx === -1) return res.status(404).json({ errors: ['Игра не найдена'] });
  const { errors, game } = normalizeGame(req.body, games, req.params.id, loadScripts());
  if (errors.length) return res.status(400).json({ errors });
  games[idx] = { ...games[idx], ...game, updatedAt: new Date().toISOString() };
  delete games[idx].nominations; // старый формат с одним голосованием
  saveGames(games);
  res.json(games[idx]);
});

app.delete('/api/games/:id', (req, res) => {
  const games = loadGames();
  const rest = games.filter((g) => g.id !== req.params.id);
  if (rest.length === games.length) return res.status(404).json({ errors: ['Игра не найдена'] });
  saveGames(rest);
  res.status(204).end();
});

app.get('/api/scripts', (req, res) => {
  const games = loadGames();
  const scripts = loadScripts()
    .map((s) => ({ ...s, games: games.filter((g) => g.scriptId === s.id).length }))
    .sort((a, b) => a.name.localeCompare(b.name));
  res.json(scripts);
});

app.post('/api/scripts', (req, res) => {
  const scripts = loadScripts();
  const { errors, script } = normalizeScript(req.body, scripts, null);
  if (errors.length) return res.status(400).json({ errors });
  const saved = { id: crypto.randomUUID(), ...script };
  scripts.push(saved);
  saveScripts(scripts);
  res.status(201).json(saved);
});

app.put('/api/scripts/:id', (req, res) => {
  const scripts = loadScripts();
  const idx = scripts.findIndex((s) => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ errors: ['Сценарий не найден'] });
  const { errors, script } = normalizeScript(req.body, scripts, req.params.id);
  if (errors.length) return res.status(400).json({ errors });
  scripts[idx] = { ...scripts[idx], ...script };
  saveScripts(scripts);
  res.json(scripts[idx]);
});

app.delete('/api/scripts/:id', (req, res) => {
  const scripts = loadScripts();
  const rest = scripts.filter((s) => s.id !== req.params.id);
  if (rest.length === scripts.length) return res.status(404).json({ errors: ['Сценарий не найден'] });
  if (!rest.length) return res.status(409).json({ errors: ['Нельзя удалить единственный сценарий'] });
  const used = loadGames().filter((g) => g.scriptId === req.params.id).length;
  if (used) return res.status(409).json({ errors: [`Сценарий используется в играх: ${used}. Сначала смените им сценарий`] });
  saveScripts(rest);
  res.status(204).end();
});

app.get('/api/export', async (req, res, next) => {
  try {
    const wb = await buildWorkbook(loadGames(), loadScripts());
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="botc-results-${stamp}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    next(e);
  }
});

app.listen(PORT, () => {
  console.log(`Clocktower Results: http://localhost:${PORT}`);
  console.log(`Данные: ${DB_FILE}`);
});
