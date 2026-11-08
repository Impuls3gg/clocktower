// Каталог всех ролей и формат сценариев. Файл общий для браузера (window.CATALOG) и сервера (require).
(function (root) {
  const ROLES = typeof require === 'function' ? require('./roles-data.js') : root.ROLE_DATA;

  // alignment: null — сторона не определяется типом роли.
  // storyteller: роли ведущего, в сценарии могут быть, но игрокам не выдаются.
  const TEAMS = {
    townsfolk: { name: 'Горожане', single: 'Горожанин', alignment: 'good' },
    outsider: { name: 'Изгои', single: 'Изгой', alignment: 'good' },
    minion: { name: 'Приспешники', single: 'Приспешник', alignment: 'evil' },
    demon: { name: 'Демоны', single: 'Демон', alignment: 'evil' },
    traveller: { name: 'Путешественники', single: 'Путешественник', alignment: null },
    fabled: { name: 'Fabled', single: 'Fabled', alignment: null, storyteller: true },
    loric: { name: 'Loric', single: 'Loric', alignment: null, storyteller: true },
  };

  const byId = {};
  for (const r of ROLES) byId[r.id] = r;

  // В JSON сценариев встречается fortune_teller, pit-hag и т.п.
  const normalizeId = (id) => String(id).toLowerCase().replace(/[^a-z0-9]/g, '');

  // JSON официального script tool: [{ id: '_meta', name, author }, 'role', { id: 'role' }, ...]
  function parseScript(json) {
    const items = Array.isArray(json) ? json : [];
    const meta = items.find((x) => x && x.id === '_meta') || {};
    const roles = [];
    const unknown = [];
    for (const item of items) {
      const raw = typeof item === 'string' ? item : item && item.id;
      if (!raw || raw === '_meta') continue;
      const id = normalizeId(raw);
      if (!byId[id]) unknown.push(String(raw));
      else if (!roles.includes(id)) roles.push(id);
    }
    return { name: String(meta.name || ''), author: String(meta.author || ''), bootlegger: meta.bootlegger, roles, unknown };
  }

  function scriptToJson(script) {
    const meta = { id: '_meta', name: script.name, author: script.author };
    if (script.bootlegger) meta.bootlegger = script.bootlegger;
    return [meta, ...script.roles];
  }

  // Сторону можно сменить только ролям, у которых она определена типом (не путешественникам)
  const canFlip = (id) => !!(byId[id] && TEAMS[byId[id].team].alignment);

  // Фактическая сторона игрока: 'good' | 'evil' | null
  function alignmentOf(id, flipped) {
    const side = byId[id] ? TEAMS[byId[id].team].alignment : null;
    if (!side || !flipped) return side;
    return side === 'good' ? 'evil' : 'good';
  }

  // Сменившим сторону — перекрашенная иконка: <id>_evil.png или <id>_good.png
  const icon = (id, flipped) => (flipped && canFlip(id) ? `roles/${id}_${alignmentOf(id, true)}.png` : `roles/${id}.png`);

  const CATALOG = {
    teams: TEAMS,
    roles: ROLES,
    byId,
    icon,
    canFlip,
    alignmentOf,
    parseScript,
    scriptToJson,
  };

  if (typeof module === 'object' && module.exports) module.exports = CATALOG;
  else root.CATALOG = CATALOG;
})(this);
