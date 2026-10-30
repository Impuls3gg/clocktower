// Сценарий и роли. Файл общий для браузера (window.SCRIPT) и сервера (require).
(function (root) {
  const TEAMS = {
    townsfolk: { name: 'Горожане', single: 'Горожанин', alignment: 'good' },
    outsider: { name: 'Изгои', single: 'Изгой', alignment: 'good' },
    minion: { name: 'Приспешники', single: 'Приспешник', alignment: 'evil' },
    demon: { name: 'Демоны', single: 'Демон', alignment: 'evil' },
  };

  const ROLES = [
    { id: 'steward', name: 'Steward', team: 'townsfolk' },
    { id: 'investigator', name: 'Investigator', team: 'townsfolk' },
    { id: 'clockmaker', name: 'Clockmaker', team: 'townsfolk' },
    { id: 'librarian', name: 'Librarian', team: 'townsfolk' },
    { id: 'shugenja', name: 'Shugenja', team: 'townsfolk' },
    { id: 'empath', name: 'Empath', team: 'townsfolk' },
    { id: 'chambermaid', name: 'Chambermaid', team: 'townsfolk' },
    { id: 'mathematician', name: 'Mathematician', team: 'townsfolk' },
    { id: 'dreamer', name: 'Dreamer', team: 'townsfolk' },
    { id: 'nightwatchman', name: 'Nightwatchman', team: 'townsfolk' },
    { id: 'seamstress', name: 'Seamstress', team: 'townsfolk' },
    { id: 'philosopher', name: 'Philosopher', team: 'townsfolk' },
    { id: 'slayer', name: 'Slayer', team: 'townsfolk' },
    { id: 'goon', name: 'Goon', team: 'outsider' },
    { id: 'recluse', name: 'Recluse', team: 'outsider' },
    { id: 'mutant', name: 'Mutant', team: 'outsider' },
    { id: 'snitch', name: 'Snitch', team: 'outsider' },
    { id: 'cerenovus', name: 'Cerenovus', team: 'minion' },
    { id: 'marionette', name: 'Marionette', team: 'minion' },
    { id: 'baron', name: 'Baron', team: 'minion' },
    { id: 'boffin', name: 'Boffin', team: 'minion' },
    { id: 'pukka', name: 'Pukka', team: 'demon' },
  ];

  const byId = {};
  for (const r of ROLES) byId[r.id] = r;

  const SCRIPT = {
    name: 'ONE NIGHT ONE FIGHT',
    author: 'Kirill736',
    teams: TEAMS,
    roles: ROLES,
    byId,
    icon: (id) => `roles/${id}.png`,
  };

  if (typeof module === 'object' && module.exports) module.exports = SCRIPT;
  else root.SCRIPT = SCRIPT;
})(this);
