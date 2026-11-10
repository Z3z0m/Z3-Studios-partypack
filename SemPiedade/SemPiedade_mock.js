// =========================
// SEM PIEDADE — modo de desenvolvimento
// Abra SemPiedade_index.html?mock=<tela> pra ver uma tela sem partida rolando.
// Só é carregado (import dinâmico) quando o parâmetro existe. Nada daqui toca no Firebase:
// as ações aparecem no console.
//
// Telas: lobby, lobbyHost, tutorial, colocacao, aguardando, reforco, ataqueOrigem,
// ataqueDados, atacarDeNovo, conquista, movimento, defesa, eliminado, final, pausa.
// Opcional: &id=p2 troca quem é "você".
// =========================

const PEOPLE = [
  { id: "p1", name: "Bia" },
  { id: "p2", name: "Rafa" },
  { id: "p3", name: "Duda" },
  { id: "p4", name: "Léo" },
  { id: "p5", name: "Nina" }
];

const OWNERS = {
  p1: ["amazonia", "andes", "caribe_sa", "cone_sul", "litoral_br", "caribe_ac", "mexico", "eua_oeste", "canada_oeste"],
  p2: ["canada_leste", "eua_leste", "ilhas_britanicas", "escandinavia", "europa_ocidental", "iberica", "japao"],
  p3: ["europa_central", "europa_oriental", "italia_balcas", "russia_ocidental", "urais", "siberia", "mongolia", "china", "extremo_oriente"],
  p4: ["africa_ocidental", "africa_central", "africa_austral", "africa_oriental", "chifre", "madagascar", "nilo", "magrebe", "levante"],
  p5: ["anatolia", "arabica", "mesopotamia", "persia", "asia_central", "india", "indochina", "indonesia", "filipinas", "australia", "nova_guine"]
};

const MISSIONS = {
  p1: "Conquistar a América do Norte e a África",
  p2: "Destruir o exército Roxo",
  p3: "Conquistar 26 territórios",
  p4: "Conquistar o Oriente Médio e a África + 1 continente à escolha",
  p5: "Conquistar a Europa e a Oceania"
};

const LOG = [
  "Bia posicionou os exércitos",
  "Rafa posicionou os exércitos",
  "Léo posicionou os exércitos"
];

function Hash(text)
{
  let h = 7;
  for(let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return h;
}

export function BuildMock(screen, { MAP, Colors })
{
  const nameOf = id => (MAP.territories.find(t => t.id === id) || {}).name || id;

  function Owners(overrides)
  {
    const owner = {};
    MAP.territories.forEach(t => { owner[t.id] = "neutral"; });
    Object.entries(OWNERS).forEach(([pid, ids]) => ids.forEach(id => { owner[id] = pid; }));
    return Object.assign(owner, overrides || {});
  }

  // Mesa no formato que o host publica em currentState/table.
  function Table(opts)
  {
    const owner = Owners(opts.owners);
    const territories = {};

    MAP.territories.forEach(t =>
    {
      const base = opts.allOnes ? 1 : 1 + (Hash(t.id) % 4);
      territories[t.id] = { o: owner[t.id], a: (opts.armies && opts.armies[t.id] != null) ? opts.armies[t.id] : base };
    });

    const players = {};

    PEOPLE.forEach((p, seat) =>
    {
      const mine = Object.keys(territories).filter(id => territories[id].o === p.id);
      const dead = (opts.dead || []).includes(p.id);

      players[p.id] = {
        name: p.name,
        color: Colors[seat].hex,
        colorName: Colors[seat].name,
        seat,
        team: seat % 2,
        alive: !dead,
        reserve: (opts.reserve && opts.reserve[p.id]) || 0,
        territories: mine.length,
        armies: mine.reduce((sum, id) => sum + territories[id].a, 0),
        cards: 0,
        eliminatedBy: dead ? (opts.eliminatedBy || null) : null
      };
    });

    return {
      phase: opts.phase,
      actorId: "actor" in opts ? opts.actor : "p1",
      currentTurnPlayerId: opts.turn || opts.actor || "p1",
      seating: PEOPLE.map(p => p.id),
      round: 4,
      turnNumber: 16,
      phaseDuration: opts.duration || 0,
      t: Date.now(),
      minutes: 45,
      turnSeconds: 0,
      mode: "solo",
      tradeCount: 2,
      nextTradeValue: opts.nextTrade || 8,
      truce: !!opts.truce,
      neutralColor: "#A79B82",
      territories,
      players,
      prompt: opts.prompt || {},
      battle: opts.battle || null,
      log: opts.log || LOG
    };
  }

  function Lobby(entries)
  {
    const out = {};

    Object.entries(entries).forEach(([id, extra]) =>
    {
      const person = PEOPLE.find(p => p.id === id);
      out[id] = Object.assign({ name: person ? person.name : id }, extra);
    });

    return out;
  }

  const mission = id => ({ text: MISSIONS[id], progress: 6, fallback: false, allies: [] });
  const card = (id, territory, symbol) => ({ id, territory, name: territory ? nameOf(territory) : "Coringa", symbol });

  const battle = {
    serial: 7, from: "litoral_br", to: "africa_ocidental", attackerId: "p1", defenderId: "p4",
    att: [6, 4, 2], def: [5, 4], attLoss: 1, defLoss: 1, totalAttLoss: 1, totalDefLoss: 1, rolls: 1, conquered: false
  };

  const attackArmies = { litoral_br: 8, caribe_ac: 6, mexico: 3, eua_oeste: 2, amazonia: 1, andes: 1, caribe_sa: 1, cone_sul: 1, canada_oeste: 1, africa_ocidental: 3 };

  const playing = (me, opts, extra) => Object.assign({
    state: "Playing",
    me,
    isHost: me === "p1",
    table: Table(opts),
    cards: [],
    mission: mission(me)
  }, extra || {});

  const screens = {

    lobby: () => ({
      state: "Lobby", me: "p2", isHost: false,
      config: { mode: "solo", minutes: 45, turn: 0 },
      lobbyPlayers: Lobby({ p1: { colorPick: 0, isHost: true }, p2: { colorPick: 1 }, p3: { colorPick: 2 }, p4: { colorPick: 3 }, p5: {} })
    }),

    lobbyHost: () => ({
      state: "Lobby", me: "p1", isHost: true,
      config: { mode: "teams", minutes: 45, turn: 0 },
      lobbyPlayers: Lobby({
        p1: { colorPick: 0, isHost: true, teamPick: 0 }, p2: { colorPick: 1, teamPick: 1 }, p3: { colorPick: 2, teamPick: 1 },
        p4: { colorPick: 3, teamPick: 0 }, p5: { colorPick: 4, teamPick: 1 }, p6: { name: "Gabi", colorPick: 5 }
      })
    }),

    tutorial: () => ({ state: "Tutorial", me: "p1", isHost: true }),

    colocacao: () => playing("p1",
      { phase: "Placement", actor: null, allOnes: true, duration: 47, reserve: { p1: 31, p2: 31, p3: 31, p4: 31, p5: 31 }, truce: true, log: [] },
      { ui: { plan: { litoral_br: 6, caribe_ac: 4, mexico: 3, andes: 2, eua_oeste: 4 }, step: 3 } }),

    aguardando: () => playing("p1",
      { phase: "Placement", actor: null, allOnes: true, reserve: { p3: 12, p5: 8 }, truce: true },
      { missionVisible: true }),

    reforco: () => playing("p1",
      { phase: "Reinforce", duration: 38, prompt: { type: "reinforce", reserve: 6 }, nextTrade: 8 },
      {
        cards: [card("c1", "litoral_br", "navio"), card("c2", "magrebe", "tanque"), card("c3", null, "coringa"), card("c4", "japao", "navio")],
        ui: { plan: { litoral_br: 3 }, picked: ["c1", "c2", "c3"] }
      }),

    ataqueOrigem: () => playing("p1",
      { phase: "Attack", duration: 27, prompt: { type: "attack" }, armies: attackArmies },
      { cards: [card("c4", "japao", "navio")] }),

    ataqueDados: () => playing("p1",
      { phase: "Attack", duration: 21, prompt: { type: "attack" }, armies: attackArmies },
      { cards: [card("c4", "japao", "navio")], ui: { from: "litoral_br", to: "africa_ocidental", dice: 3, changeTarget: true } }),

    atacarDeNovo: () => playing("p1",
      {
        phase: "Attack", duration: 19, prompt: { type: "attack", againFrom: "litoral_br", againTo: "africa_ocidental" },
        armies: Object.assign({}, attackArmies, { litoral_br: 7, africa_ocidental: 2 }), battle
      }),

    conquista: () => playing("p1",
      {
        phase: "Conquest", duration: 12, prompt: { type: "conquest", from: "litoral_br", to: "africa_ocidental", min: 3, max: 6 },
        owners: { africa_ocidental: "p1" }, armies: Object.assign({}, attackArmies, { litoral_br: 7, africa_ocidental: 0 }),
        battle: Object.assign({}, battle, { serial: 9, def: [3], att: [6, 5, 1], totalDefLoss: 1, conquered: true })
      },
      { ui: { count: 5 }, toast: "Nova carta!" }),

    movimento: () => playing("p1",
      { phase: "Move", duration: 15, prompt: { type: "move" }, armies: Object.assign({}, attackArmies, { amazonia: 4 }) },
      { ui: { from: "amazonia", to: "cone_sul", count: 3 } }),

    defesa: () => playing("p4",
      {
        phase: "Battle", actor: "p1", nextTrade: 10,
        armies: Object.assign({}, attackArmies, { litoral_br: 7, africa_ocidental: 2 }), battle
      },
      { cards: [card("c9", "nilo", "aviao")] }),

    eliminado: () => playing("p4",
      {
        phase: "Attack", actor: "p1", dead: ["p4"], eliminatedBy: "p1",
        owners: Object.fromEntries(OWNERS.p4.map(id => [id, "p1"]))
      }),

    final: () => ({
      state: "FinalScore", me: "p1", isHost: true,
      final: {
        winnerIds: ["p1"], winnerNames: ["Bia"], reason: "mission", teams: false,
        ranking: [
          { id: "p1", name: "Bia", color: Colors[0].hex, progress: 100, mission: MISSIONS.p1, alive: true, team: 0 },
          { id: "p2", name: "Rafa", color: Colors[1].hex, progress: 67, mission: MISSIONS.p2, alive: true, team: 1 },
          { id: "p3", name: "Duda", color: Colors[2].hex, progress: 54, mission: MISSIONS.p3, alive: true, team: 0 },
          { id: "p5", name: "Nina", color: Colors[4].hex, progress: 13, mission: MISSIONS.p5, alive: true, team: 0 },
          { id: "p4", name: "Léo", color: Colors[3].hex, progress: 0, mission: MISSIONS.p4, alive: false, team: 1 }
        ]
      }
    })
  };

  screens.pausa = () => Object.assign(screens.ataqueDados(), { paused: true });

  const build = screens[screen];
  return build ? build() : null;
}
