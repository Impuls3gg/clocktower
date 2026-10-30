const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ExcelJS = require('exceljs');
const SCRIPT = require('./public/roles.js');

const PORT = Number(process.env.PORT) || 3777;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'games.json');
const BACKUP_FILE = path.join(DATA_DIR, 'games.backup.json');

// ---------- хранилище ----------

function loadGames() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

function saveGames(games) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(DB_FILE)) fs.copyFileSync(DB_FILE, BACKUP_FILE);
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(games, null, 2), 'utf8');
  fs.renameSync(tmp, DB_FILE);
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

function normalizeGame(body, games, selfId) {
  const errors = [];
  const b = body || {};

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
    else if (!SCRIPT.byId[role]) errors.push(`${row}: неизвестная роль «${role}»`);

    let score = null;
    if (p.score !== null && p.score !== undefined && String(p.score).trim() !== '') {
      score = Number(String(p.score).replace(',', '.'));
      if (!Number.isFinite(score)) errors.push(`${row}: баллы должны быть числом`);
    }

    players.push({ seat, nick, role, score });
  });

  players.sort((a, b2) => a.seat - b2.seat);
  return { errors, game: { number, host, date, time, winner, players } };
}

// ---------- экспорт в Excel ----------

const WIN_LABEL = { good: 'Добро', evil: 'Зло' };

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

async function buildWorkbook(games) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Clocktower Results';
  wb.created = new Date();
  const sorted = [...games].sort((a, b) => a.number - b.number);

  // 1. Плоская таблица: одна строка = один игрок в одной игре
  const flat = wb.addWorksheet('Результаты');
  flat.columns = [
    { header: 'Игра №', key: 'number', width: 9 },
    { header: 'Дата', key: 'date', width: 12, style: { numFmt: 'dd-mm-yyyy' } },
    { header: 'Время', key: 'time', width: 8 },
    { header: 'Ведущий', key: 'host', width: 18 },
    { header: 'Победа', key: 'winner', width: 9 },
    { header: 'Номер игрока', key: 'seat', width: 8 },
    { header: 'Игрок', key: 'nick', width: 20 },
    { header: 'Роль', key: 'role', width: 16 },
    { header: 'Тип роли', key: 'type', width: 13 },
    { header: 'Команда', key: 'alignment', width: 10 },
    { header: 'Победил', key: 'won', width: 9 },
    { header: 'Баллы', key: 'score', width: 9 },
  ];
  for (const g of sorted) {
    for (const p of g.players) {
      const role = SCRIPT.byId[p.role];
      const team = role ? SCRIPT.teams[role.team] : null;
      flat.addRow({
        number: g.number,
        date: excelDate(g),
        time: g.time,
        host: g.host,
        winner: WIN_LABEL[g.winner],
        seat: p.seat,
        nick: p.nick,
        role: role ? role.name : p.role,
        type: team ? team.single : '',
        alignment: team ? WIN_LABEL[team.alignment] : '',
        won: team ? (team.alignment === g.winner ? 'Да' : 'Нет') : '',
        score: p.score,
      });
    }
  }
  styleSheet(flat);

  // 2. Игры
  const gs = wb.addWorksheet('Игры');
  gs.columns = [
    { header: 'Игра №', key: 'number', width: 9 },
    { header: 'Дата', key: 'date', width: 12, style: { numFmt: 'dd-mm-yyyy' } },
    { header: 'Время', key: 'time', width: 8 },
    { header: 'Ведущий', key: 'host', width: 18 },
    { header: 'Победа', key: 'winner', width: 9 },
    { header: 'Игроков', key: 'count', width: 9 },
    { header: 'Демон', key: 'demon', width: 20 },
  ];
  for (const g of sorted) {
    const demons = g.players.filter((p) => SCRIPT.byId[p.role]?.team === 'demon').map((p) => p.nick);
    gs.addRow({
      number: g.number,
      date: excelDate(g),
      time: g.time,
      host: g.host,
      winner: WIN_LABEL[g.winner],
      count: g.players.length,
      demon: demons.join(', '),
    });
  }
  styleSheet(gs);

  // 3. Статистика игроков
  const stats = new Map();
  for (const g of sorted) {
    for (const p of g.players) {
      const role = SCRIPT.byId[p.role];
      if (!role) continue;
      const side = SCRIPT.teams[role.team].alignment;
      const s = stats.get(p.nick) || { nick: p.nick, games: 0, wins: 0, score: 0, good: 0, goodWins: 0, evil: 0, evilWins: 0 };
      const won = side === g.winner;
      s.games++;
      if (won) s.wins++;
      s.score += p.score || 0;
      s[side]++;
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
  ];
  const rows = [...stats.values()].sort((a, b) => b.score - a.score || b.wins - a.wins);
  for (const s of rows) {
    ps.addRow({ ...s, score: Math.round(s.score * 1000) / 1000, winrate: s.wins / s.games, avg: s.score / s.games });
  }
  styleSheet(ps);

  // 4. Статистика ролей
  const rs = wb.addWorksheet('Статистика ролей');
  rs.columns = [
    { header: 'Роль', key: 'role', width: 16 },
    { header: 'Тип роли', key: 'type', width: 13 },
    { header: 'Сыграна раз', key: 'games', width: 12 },
    { header: 'Побед', key: 'wins', width: 8 },
    { header: '% побед', key: 'winrate', width: 9, style: { numFmt: '0%' } },
  ];
  for (const role of SCRIPT.roles) {
    const team = SCRIPT.teams[role.team];
    let n = 0;
    let w = 0;
    for (const g of sorted) {
      for (const p of g.players) {
        if (p.role !== role.id) continue;
        n++;
        if (team.alignment === g.winner) w++;
      }
    }
    rs.addRow({ role: role.name, type: team.single, games: n, wins: w, winrate: n ? w / n : null });
  }
  styleSheet(rs);

  return wb;
}

// ---------- HTTP ----------

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

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
  const { errors, game } = normalizeGame(req.body, games, null);
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
  const { errors, game } = normalizeGame(req.body, games, req.params.id);
  if (errors.length) return res.status(400).json({ errors });
  games[idx] = { ...games[idx], ...game, updatedAt: new Date().toISOString() };
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

app.get('/api/export', async (req, res, next) => {
  try {
    const wb = await buildWorkbook(loadGames());
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
