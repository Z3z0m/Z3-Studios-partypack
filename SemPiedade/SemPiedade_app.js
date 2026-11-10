// =========================
// FIREBASE IMPORTS
// =========================

import { initializeApp }
from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

import {
  getDatabase,
  ref,
  set,
  get,
  onValue
}
from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

import { MAP } from "./SemPiedade_map.js";


// =========================
// FIREBASE CONFIG
// =========================

const firebaseConfig = {

  apiKey: "AIza....",

  authDomain: "z3-partypack.firebaseapp.com",

  databaseURL:
  "https://z3-partypack-default-rtdb.firebaseio.com",

  projectId: "z3-partypack",

  storageBucket:
  "z3-partypack.firebasestorage.app",

  messagingSenderId: "...",

  appId: "..."

};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);


// =========================
// URL PARAMS
// =========================

const params = new URLSearchParams(window.location.search);
const currentRoomCode = params.get("room");
let currentPlayerId = params.get("id");

// Modo de desenvolvimento (?mock=<tela>): dados de exemplo, sem Firebase. Ver SemPiedade_mock.js.
const MOCK = params.get("mock");


// =========================
// CONSTANTES
// =========================

const NEUTRAL = "neutral";

const PAPER = "#EFE4CC";
const INK = "#141414";

const RejectedReasonLabels = {
  "not-now": "Agora não é hora disso.",
  "invalid-target": "Esse alvo não vale mais.",
  "invalid-dice": "Número de dados inválido.",
  "invalid-count": "Quantidade inválida.",
  "not-yours": "Esse território não é mais seu.",
  "not-connected": "Esses territórios não estão conectados.",
  "must-trade": "Com 5 cartas, a troca é obrigatória.",
  "no-card": "Você não tem essa carta.",
  "invalid-set": "Precisa ser 3 iguais, 3 diferentes ou 2 + coringa."
};

// Mesma ordem de SemPiedadeTheme.PlayerColorNames/Hex.
const Colors = [
  { name: "Vermelho", hex: "#D92E25" },
  { name: "Azul", hex: "#2B5FB8" },
  { name: "Verde", hex: "#2F8F47" },
  { name: "Amarelo", hex: "#E8B21E" },
  { name: "Roxo", hex: "#7A4BA8" },
  { name: "Laranja", hex: "#E06A1B" },
  { name: "Rosa", hex: "#D9578F" },
  { name: "Ciano", hex: "#1E9BB0" }
];

const NEUTRAL_FALLBACK = "#A79B82";

// Símbolos próprios das cartas (GDD §1): desenho nosso, nada dos produtos de referência.
const SymbolIcons = {
  tanque: `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M6 30h36a4 4 0 0 1 0 8H6a4 4 0 0 1 0-8zm6-10h18l4 8H10zm20 1 12-4v3l-11 4z"/></svg>`,
  aviao: `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M44 21 28 19 20 5h-4l3 14-9 1-4-5H3l2 9-2 9h3l4-5 9 1-3 14h4l8-14 16-2c3 0 3-6 0-6z"/></svg>`,
  navio: `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M4 30h40l-5 11H10zm8-5V16h9V8h6v8h9v9zM8 44c5 0 5-2 9-2s4 2 8 2 5-2 9-2 4 2 8 2v2H8z"/></svg>`,
  coringa: `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="m24 4 6 13 14 2-10 10 2 14-12-7-12 7 2-14L4 19l14-2z"/></svg>`
};

const SymbolNames = { tanque: "Tanque", aviao: "Avião", navio: "Navio", coringa: "Coringa" };

const CheckIcon = `<span class="check" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="${PAPER}" stroke-width="3.5" stroke-linecap="square"><path d="M4 12l5 5L20 6"/></svg></span>`;


// =========================
// GRAFO DO MAPA (só pra listar opções; quem valida é o host)
// =========================

const TerritoryById = {};
const Neighbors = {};
const SeaEdges = new Set();
const WrapEdges = new Set();
const TerrBox = {};

MAP.territories.forEach(t =>
{
  TerritoryById[t.id] = t;
  Neighbors[t.id] = [];

  const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };

  t.rings.forEach(ring =>
  {
    for(let i = 0; i < ring.length; i += 2)
    {
      box.x0 = Math.min(box.x0, ring[i]);
      box.x1 = Math.max(box.x1, ring[i]);
      box.y0 = Math.min(box.y0, ring[i + 1]);
      box.y1 = Math.max(box.y1, ring[i + 1]);
    }
  });

  TerrBox[t.id] = box;
});

function EdgeKey(a, b) { return a < b ? `${a}|${b}` : `${b}|${a}`; }

MAP.land.forEach(([a, b]) => { Neighbors[a].push(b); Neighbors[b].push(a); });
MAP.sea.forEach(([a, b]) => { Neighbors[a].push(b); Neighbors[b].push(a); SeaEdges.add(EdgeKey(a, b)); });
MAP.links.forEach(l => { if(l.wrap) WrapEdges.add(EdgeKey(l.a, l.b)); });


// =========================
// ESTADO
// =========================

let currentGameState = "Lobby";
let isHost = false;
let isGamePaused = false;

let table = null;     // currentState/table (público)
let myCards = [];     // players/{eu}/cards (privado)
let myMission = null; // players/{eu}/mission (privado)
let config = { mode: "solo", minutes: 45, turn: 0 };
let lobbyPlayers = {};

let lastActionT = 0;
let panelKey = null;
let cardsKey = null;
let situationKey = null;
let missionVisible = false;
let cardsHelpVisible = false;
let mapBuilt = false;
let lastBattleSerial = 0;
let lastHandSize = null;
let wasFallback = false;
let rejectedTimeout = null;
let toastBusyUntil = 0;
let lastConqueredBy = null; // quem tomou território meu por último (reserva do "eliminado por")
let mockFinal = null;

// Decisão em andamento NESTE celular. Só vira ação quando confirmada.
let ui = NewUi();

let countdownInterval = null;
let countdownRemaining = 0;

let unsubscribers = [];

function NewUi()
{
  return { from: null, to: null, dice: 3, count: 1, step: 1, plan: {}, picked: [], changeTarget: false, sentPlan: false };
}


// =========================
// UTIL
// =========================

function Esc(text)
{
  const div = document.createElement("div");
  div.innerText = text == null ? "" : String(text);
  return div.innerHTML;
}

function AsList(v) { return !v ? [] : (Array.isArray(v) ? v.filter(x => x != null) : Object.values(v)); }

function Player(id) { return table && table.players ? table.players[id] : null; }
function Me() { return Player(currentPlayerId); }
function PlayerName(id) { return id === NEUTRAL ? "Neutro" : (Player(id) ? Player(id).name : ""); }
function IsMyAction() { return table && table.actorId === currentPlayerId; }

function Terr(id) { return table && table.territories ? table.territories[id] : null; }
function Armies(id) { const t = Terr(id); return t ? t.a : 0; }
function OwnerOf(id) { const t = Terr(id); return t ? t.o : null; }
function NeutralColor() { return (table && table.neutralColor) || NEUTRAL_FALLBACK; }
function PlayerColor(pid) { return pid === NEUTRAL ? NeutralColor() : (Player(pid) ? Player(pid).color : NeutralColor()); }
function OwnerColor(id) { return PlayerColor(OwnerOf(id)); }
function NameOfTerr(id) { return TerritoryById[id] ? TerritoryById[id].name : id; }

function IsAlly(ownerId)
{
  if(ownerId === NEUTRAL || !Me() || !Player(ownerId)) return false;
  return table.mode === "teams" && Player(ownerId).team === Me().team;
}

function MyTerritories() { return MAP.territories.map(t => t.id).filter(id => OwnerOf(id) === currentPlayerId); }

// Contraste WCAG: texto sobre a cor de um jogador.
function Luminance(hex)
{
  if(!hex || hex.length < 7) return 0;

  const channel = i =>
  {
    const c = parseInt(hex.substr(i, 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };

  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function Contrast(a, b)
{
  const la = Luminance(a);
  const lb = Luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// Tinta (preto ou papel) com mais contraste sobre a cor.
function InkOn(hex) { return Contrast(INK, hex) >= Contrast(PAPER, hex) ? INK : PAPER; }

// Texto pequeno sobre a cor: se nem preto nem papel chegam a 4.5:1, vai num rótulo de papel.
function LabelOn(hex)
{
  const fg = InkOn(hex);
  return { fg, chip: Contrast(fg, hex) < 4.5 };
}

function JoinNames(names)
{
  if(names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`;
}

// Animações que só tocam na primeira vez que a coisa aparece (o painel é redesenhado a cada toque).
const onceSeen = new Set();

function Once(key)
{
  if(onceSeen.has(key)) return false;
  onceSeen.add(key);
  return true;
}

function ArmyBadge(id) { return `<span class="armyBadge">${Armies(id)}</span>`; }

// Avisos em fila: vários chegam quase juntos.
function ShowToast(text, good)
{
  const duration = 2200;
  const wait = Math.max(0, toastBusyUntil - Date.now());
  toastBusyUntil = Date.now() + wait + duration;

  setTimeout(() =>
  {
    const el = document.getElementById("rejectedText");
    el.innerText = text;
    el.classList.toggle("good", !!good);
    el.classList.add("active");
    clearTimeout(rejectedTimeout);
    rejectedTimeout = setTimeout(() => el.classList.remove("active"), duration);
  }, wait);
}

function ReducedMotion() { return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches; }


// =========================
// OPÇÕES DA JOGADA
// =========================

function CanAttackTarget(from, to)
{
  const owner = OwnerOf(to);

  if(owner === currentPlayerId || IsAlly(owner)) return false;
  if(table.truce && owner !== NEUTRAL) return false;
  return Neighbors[from].includes(to);
}

function AttackOrigins()
{
  return MyTerritories().filter(id => Armies(id) >= 2 && Neighbors[id].some(n => CanAttackTarget(id, n)));
}

function AttackTargets(from) { return Neighbors[from].filter(n => CanAttackTarget(from, n)); }

function MaxDice(from) { return Math.min(3, Armies(from) - 1); }

function ReachableFrom(from)
{
  const seen = new Set([from]);
  const queue = [from];

  while(queue.length)
  {
    const current = queue.shift();

    Neighbors[current].forEach(n =>
    {
      if(!seen.has(n) && OwnerOf(n) === currentPlayerId)
      {
        seen.add(n);
        queue.push(n);
      }
    });
  }

  seen.delete(from);
  return [...seen];
}

function MoveOrigins() { return MyTerritories().filter(id => Armies(id) >= 2 && ReachableFrom(id).length > 0); }

function PlanTotal() { return Object.values(ui.plan).reduce((a, b) => a + b, 0); }

function MyReserve()
{
  const me = Me();
  return me ? me.reserve : 0;
}

function IsPlanning()
{
  if(!table) return false;
  if(table.phase === "Placement") return MyReserve() > 0 && !ui.sentPlan;
  return table.phase === "Reinforce" && IsMyAction();
}

// Valor de cada carta: mesma regra do host.
function IsValidSet(cards)
{
  if(cards.length !== 3) return false;
  if(cards.some(c => c.symbol === "coringa")) return true;

  const symbols = new Set(cards.map(c => c.symbol));
  return symbols.size === 1 || symbols.size === 3;
}

function CardIsMine(card) { return !!card.territory && OwnerOf(card.territory) === currentPlayerId; }

function BestSet()
{
  let best = null;
  let bestScore = -Infinity;

  for(let a = 0; a < myCards.length; a++)
  {
    for(let b = a + 1; b < myCards.length; b++)
    {
      for(let c = b + 1; c < myCards.length; c++)
      {
        const set = [myCards[a], myCards[b], myCards[c]];
        if(!IsValidSet(set)) continue;

        const score = set.filter(CardIsMine).length * 2 - set.filter(x => x.symbol === "coringa").length * 3;

        if(score > bestScore)
        {
          bestScore = score;
          best = set;
        }
      }
    }
  }

  return best;
}

// A batalha publicada só vale enquanto é do turno de quem atacou.
function CurrentBattle()
{
  const b = table && table.battle;
  return b && b.attackerId === table.currentTurnPlayerId ? b : null;
}


// =========================
// SCREEN SYSTEM
// =========================

function ShowScreen(screenId)
{
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById(screenId).classList.add("active");
  UpdateChrome();
  UpdateDockSpace();
}

// Telas pretas (tutorial, eliminado): o fundo da página e a barra acompanham.
function UpdateChrome()
{
  const tutorial = document.getElementById("tutorialScreen").classList.contains("active");
  const out = document.getElementById("playingScreen").classList.contains("active") && Me() && Me().alive === false;
  document.body.classList.toggle("onInk", !!(tutorial || out));
}

// A barra fixa de baixo não pode cobrir o fim da página.
function UpdateDockSpace()
{
  let h = 0;

  document.querySelectorAll(".dock").forEach(d =>
  {
    if(d.getClientRects().length) h = Math.max(h, d.offsetHeight);
  });

  document.documentElement.style.setProperty("--dock-h", `${h}px`);
}

function WatchDocks()
{
  if(typeof ResizeObserver === "undefined") return;

  const observer = new ResizeObserver(UpdateDockSpace);
  document.querySelectorAll(".dock").forEach(d => observer.observe(d));
}


// =========================
// START
// =========================

window.onload = function()
{
  WatchDocks();
  window.addEventListener("resize", () => { UpdateDockSpace(); ApplyMapCamera(); });

  if(MOCK)
  {
    StartMock();
    return;
  }

  ListenForLobby();
  ListenForGameState();
  ListenForVisibilityRecovery();
  CheckIfHost();
  ListenForPause();
};

function ListenForPause()
{
  onValue(ref(db, `rooms/${currentRoomCode}/gamePaused`), (snapshot) =>
  {
    isGamePaused = snapshot.val() === true;
    document.getElementById("pauseOverlay").classList.toggle("active", isGamePaused);
  });
}


// =========================
// LOBBY — só o host ajusta; os outros veem o que está valendo
// =========================

function ListenForLobby()
{
  onValue(ref(db, `rooms/${currentRoomCode}/config`), (snapshot) =>
  {
    if(snapshot.exists()) config = snapshot.val();
    RenderLobby();
  });

  onValue(ref(db, `rooms/${currentRoomCode}/players`), (snapshot) =>
  {
    lobbyPlayers = snapshot.val() || {};
    RenderLobby();
  });
}

function LobbyNames() { return Object.values(lobbyPlayers).filter(p => p && p.name).map(p => p.name); }

function HostName()
{
  const host = Object.values(lobbyPlayers).find(p => p && p.isHost);
  return host && host.name ? host.name : "";
}

function ConfigChips(field, options)
{
  return `<div class="chipGroup">${options.map(o =>
  {
    const on = config[field] === o.value;
    return `<button type="button" class="chip text ${on ? "selected" : ""}" aria-pressed="${on}" onclick="SetConfig('${field}', ${JSON.stringify(o.value).replace(/"/g, "'")})">${Esc(o.label)}</button>`;
  }).join("")}</div>`;
}

function RenderLobbyHead(count)
{
  const el = document.getElementById("lobbyHead");
  if(!el) return;

  if(isHost)
  {
    el.innerHTML = `<div class="hostHead">
      <div class="hostHeadRow"><span class="hostTitle">Sem Piedade</span>${currentRoomCode ? `<span class="hostRoom">Sala ${Esc(currentRoomCode)}</span>` : ""}</div>
      <p class="hostSub">Você é o anfitrião · ${count} na sala</p>
    </div>`;
    return;
  }

  el.innerHTML = `<header class="lobbyHead">
    <div class="band" aria-hidden="true"></div>
    <div class="lobbyHeadInner">
      <p class="kicker">Board Classics · Nº 5</p>
      <h1 class="display">Sem<br>Piedade</h1>
      <p class="tagline">Conquista mundial com missão secreta</p>
    </div>
  </header>`;
}

function RenderColorGrid()
{
  const el = document.getElementById("colorSection");
  if(!el) return;

  const mine = lobbyPlayers[currentPlayerId] ? lobbyPlayers[currentPlayerId].colorPick : null;
  const takenBy = {};

  Object.entries(lobbyPlayers).forEach(([id, p]) =>
  {
    if(id !== currentPlayerId && p && p.colorPick != null) takenBy[p.colorPick] = p.name;
  });

  // ANFITRIÃO: faixa compacta (sobra espaço pros ajustes da partida).
  if(isHost)
  {
    const strip = Colors.map((c, i) =>
    {
      const taken = takenBy[i];
      const label = taken ? `${c.name}, de ${taken}` : c.name;
      return `<button type="button" class="swatch ${mine === i ? "selected" : ""}" style="background:${c.hex}" aria-pressed="${mine === i}" aria-label="${Esc(label)}" ${taken ? "disabled" : ""} onclick="SelectColor(${i})"></button>`;
    }).join("");

    const caption = mine != null && Colors[mine] ? `Seu exército: ${Colors[mine].name}` : "Toque pra escolher seu exército";
    el.innerHTML = `<div class="swatchStrip">${strip}</div><p class="stripLabel">${caption}</p>`;
    return;
  }

  const grid = Colors.map((c, i) =>
  {
    const taken = takenBy[i];
    const isMine = mine === i;
    const by = taken ? Esc(taken) : isMine ? "você" : "";

    return `<button type="button" class="colorItem ${isMine ? "selected" : ""}" aria-pressed="${isMine}" ${taken ? "disabled" : ""} onclick="SelectColor(${i})">
      <span class="sw" style="background:${c.hex}"></span>${isMine ? CheckIcon : ""}
      <span class="nm">${c.name}</span><span class="by">${by}</span></button>`;
  }).join("");

  el.innerHTML = `<div class="sectionHead"><h2>Escolha seu exército</h2><small>Toque de novo = desmarca</small></div>
    <div class="colorGrid">${grid}</div>`;
}

function RenderTeamPicker(count)
{
  const el = document.getElementById("teamPicker");
  if(!el) return;

  if(config.mode !== "teams" || ![4, 6, 8].includes(count))
  {
    el.innerHTML = "";
    return;
  }

  const mine = lobbyPlayers[currentPlayerId] ? lobbyPlayers[currentPlayerId].teamPick : null;
  let html = `<div class="teamBlock"><h3 class="subhead">Escolha seu time</h3>`;

  for(let t = 0; t < 2; t++)
  {
    const members = Object.entries(lobbyPlayers).filter(([, p]) => p && p.name && p.teamPick === t);
    const full = members.length >= count / 2 && mine !== t;
    const free = Math.max(0, count / 2 - members.length);
    const names = members.map(([, p]) => p.name);

    if(free === 1) names.push("vaga livre");
    if(free > 1) names.push(`${free} vagas livres`);

    const text = (names.join(" + ") || "vaga livre") + (free === 0 ? " · cheio" : "");

    html += `<button type="button" class="teamItem ${mine === t ? "selected" : ""}" aria-pressed="${mine === t}" ${full ? "disabled" : `onclick="SelectTeam(${t})"`}><b>Time ${t + 1}</b><span>${Esc(text)}</span></button>`;
  }

  el.innerHTML = html + `<p class="sub">Quem não escolher completa as vagas que sobrarem.</p></div>`;
}

window.SelectColor = async function(index)
{
  if(currentGameState !== "Lobby") return;

  const p = lobbyPlayers[currentPlayerId];
  const next = p && p.colorPick === index ? null : index; // tocar de novo = desmarcar

  if(MOCK)
  {
    if(p) p.colorPick = next;
    RenderLobby();
    return;
  }

  await set(ref(db, `rooms/${currentRoomCode}/players/${currentPlayerId}/colorPick`), next);
};

window.SelectTeam = async function(team)
{
  if(currentGameState !== "Lobby") return;

  const p = lobbyPlayers[currentPlayerId];
  const next = p && p.teamPick === team ? null : team;

  if(MOCK)
  {
    if(p) p.teamPick = next;
    RenderLobby();
    return;
  }

  await set(ref(db, `rooms/${currentRoomCode}/players/${currentPlayerId}/teamPick`), next);
};

function RenderLobby()
{
  const el = document.getElementById("lobbyConfig");
  if(!el) return;

  const names = LobbyNames();
  const count = names.length;

  RenderLobbyHead(count);
  RenderColorGrid();
  RenderTeamPicker(count);

  const teamsProblem = config.mode === "teams" && ![4, 6, 8].includes(count);
  const warning = teamsProblem ? `<p class="warn">O modo em times precisa de 4, 6 ou 8 jogadores (agora: ${count}).</p>` : "";
  const host = HostName();

  if(isHost)
  {
    el.innerHTML = `
      <div class="configGroup"><p class="groupLabel">Modo</p>${ConfigChips("mode", [{ value: "solo", label: "Individual" }, { value: "teams", label: "Em times" }])}</div>
      <div class="configGroup"><p class="groupLabel">Tempo por turno</p>${ConfigChips("turn", [{ value: 0, label: "Auto" }, { value: 60, label: "60 s" }, { value: 90, label: "90 s" }, { value: 120, label: "120 s" }])}</div>
      <div class="configGroup"><p class="groupLabel">Limite da partida</p>${ConfigChips("minutes", [{ value: 30, label: "30 min" }, { value: 45, label: "45 min" }, { value: 60, label: "60 min" }, { value: 0, label: "Sem" }])}</div>
      ${warning}`;

    document.getElementById("lobbyRoster").innerHTML = "";
    document.getElementById("lobbyWaiting").innerText = "";
    UpdateDockSpace();
    return;
  }

  const mode = config.mode === "teams" ? "Em times" : "Individual";
  const time = config.minutes > 0 ? `${config.minutes} min` : "sem limite";
  const turn = config.turn > 0 ? `turno ${config.turn} s` : "turno auto";

  el.innerHTML = `<div class="infoBox">
      <p class="groupLabel">Partida</p>
      <b>${mode} · ${time} · ${turn}</b>
      <small>Quem ajusta é ${host ? Esc(host) : "o anfitrião"}.</small>
    </div>${warning}`;

  document.getElementById("lobbyRoster").innerHTML = count
    ? `<div class="roster"><b>${count}/${Colors.length}</b><span>${Esc(JoinNames(names))} na sala</span></div>`
    : "";

  document.getElementById("lobbyWaiting").innerText = `Esperando ${host || "o anfitrião"} começar...`;
  UpdateDockSpace();
}

window.SetConfig = async function(field, value)
{
  if(!isHost || currentGameState !== "Lobby") return;

  if(MOCK)
  {
    config[field] = value;
    RenderLobby();
    return;
  }

  await set(ref(db, `rooms/${currentRoomCode}/config/${field}`), value);
};


// =========================
// HOST CONTROLS
// =========================

async function CheckIfHost()
{
  const snapshot = await get(ref(db, `rooms/${currentRoomCode}/players/${currentPlayerId}/isHost`));
  isHost = snapshot.val() === true;
  UpdateActionBar(currentGameState);
  RenderLobby();
  UpdateTutorialScreen();
}

window.SendHostCommand = async function()
{
  if(MOCK) { console.info("[mock] hostCommand"); return; }
  await set(ref(db, `rooms/${currentRoomCode}/hostCommand`), Date.now());
};

window.SendTutorialAction = async function(action)
{
  if(MOCK) { console.info("[mock] tutorialAction", action); return; }
  await set(ref(db, `rooms/${currentRoomCode}/tutorialAction`), { action: action, t: Date.now() });
};

// Barra fixa: botões da fase (barSlot) + o do anfitrião.
function UpdateActionBar(state)
{
  const bar = document.getElementById("actionBar");
  const btn = document.getElementById("hostButton");
  const home = document.getElementById("homeLink");

  bar.dataset.state = state;

  // Playing: o host pode "pular" a decisão de quem está AFK (mesmo efeito do timeout).
  const labels = { "Lobby": "Começar jogo", "Playing": "Pular decisão atual", "FinalScore": "Jogar de novo" };
  const label = isHost ? labels[state] : null;

  btn.style.display = label ? "" : "none";
  if(label) btn.innerText = label;

  btn.className = "btn hostButton " + (state === "Playing" ? "btnGhost skip" : state === "FinalScore" ? "btnPrimary final" : "btnPrimary");

  home.style.display = state === "FinalScore" ? "" : "none";

  if(state !== "Playing") document.getElementById("barSlot").innerHTML = "";

  RefreshBar();
}

function RefreshBar()
{
  const slot = document.getElementById("barSlot");
  const host = document.getElementById("hostButton");
  const home = document.getElementById("homeLink");
  const empty = !slot.children.length && host.style.display === "none" && home.style.display === "none";

  document.getElementById("actionBar").classList.toggle("empty", empty);
  UpdateDockSpace();
}

function UpdateTutorialScreen()
{
  document.getElementById("tutorialControls").style.display = isHost ? "flex" : "none";
  document.getElementById("tutorialText").innerText = isHost
    ? "As regras aparecem na tela grande. Você é quem passa as páginas, daqui."
    : "As regras aparecem na tela grande. Quem passa as páginas é o anfitrião.";
  UpdateDockSpace();
}


// =========================
// GAME STATE
// =========================

let gameStateUnsubscribe = null;

function ListenForGameState()
{
  if(gameStateUnsubscribe) { gameStateUnsubscribe(); gameStateUnsubscribe = null; }

  gameStateUnsubscribe = onValue(ref(db, `rooms/${currentRoomCode}/currentState/gameState`), (snapshot) =>
  {
    ApplyGameState(snapshot.val());
  });
}

function ListenForVisibilityRecovery()
{
  document.addEventListener("visibilitychange", () =>
  {
    if(document.visibilityState !== "visible") return;
    console.log("[SemPiedade] Aba voltou ao foco — ressincronizando.");
    ListenForGameState();
    if(currentGameState === "Playing") OpenPlaying();
  });
}

function ApplyGameState(gameState)
{
  if(!gameState || gameState === currentGameState) return;

  currentGameState = gameState;
  UpdateActionBar(gameState);

  if(gameState === "Lobby")
  {
    StopPlayingListeners();
    // Replay: os seriais do host recomeçam do zero.
    lastBattleSerial = 0;
    lastHandSize = null;
    wasFallback = false;
    lastConqueredBy = null;
    onceSeen.clear();
    ShowScreen("lobbyScreen");
    RenderLobby();
  }

  if(gameState === "Tutorial")
  {
    ShowScreen("tutorialScreen");
    UpdateTutorialScreen();
  }

  if(gameState === "Playing") { ShowScreen("playingScreen"); OpenPlaying(); }

  if(gameState === "FinalScore") { StopPlayingListeners(); ShowScreen("finalScoreScreen"); OpenFinalScore(); }
}


// =========================
// AÇÕES (caixa própria — ver SemPiedadeGameManager.HandleActionsChanged)
// =========================

async function SendAction(type, extra)
{
  if(isGamePaused) return;

  // t estritamente crescente: o host descarta ações com t <= a última vista.
  lastActionT = Math.max(Date.now(), lastActionT + 1);

  const action = Object.assign({ type: type, t: lastActionT }, extra || {});

  if(MOCK)
  {
    console.info("[mock] ação", action);
    return;
  }

  await set(ref(db, `rooms/${currentRoomCode}/actions/${currentPlayerId}`), action);
}

function Rerender()
{
  panelKey = null;
  cardsKey = null;
  RenderAll();
}

// ===== COLOCAÇÃO =====

window.SetStep = function(step) { ui.step = step; Rerender(); };

function ReserveLeft() { return ReserveForPlan() - PlanTotal(); }

function ReserveForPlan()
{
  if(table.phase === "Reinforce") return (table.prompt && table.prompt.reserve) || MyReserve();
  return MyReserve();
}

window.AddToPlan = function(id)
{
  if(!IsPlanning() || OwnerOf(id) !== currentPlayerId) return;

  const left = ReserveLeft();
  if(left <= 0) return;

  const amount = ui.step === 0 ? left : Math.min(ui.step, left);
  ui.plan[id] = (ui.plan[id] || 0) + amount;
  Rerender();
};

window.RemoveFromPlan = function(id)
{
  if(!ui.plan[id]) return;

  ui.plan[id]--;
  if(ui.plan[id] <= 0) delete ui.plan[id];
  Rerender();
};

window.ClearPlan = function() { ui.plan = {}; Rerender(); };

window.ConfirmPlan = function()
{
  if(!IsPlanning() || PlanTotal() === 0 || ReserveLeft() > 0) return;
  if(table.prompt && table.prompt.mustTrade) return;
  SendPlan();
};

function SendPlan()
{
  ui.sentPlan = true;
  const placements = Object.assign({}, ui.plan);
  ui.plan = {};
  SendAction("place", { placements: placements });
  Rerender();
}

// ===== CARTAS =====

window.ToggleCard = function(cardId)
{
  if(!(table.phase === "Reinforce" && IsMyAction())) return;

  const i = ui.picked.indexOf(cardId);

  if(i >= 0) ui.picked.splice(i, 1);
  else if(ui.picked.length < 3) ui.picked.push(cardId);

  Rerender();
};

window.PickBestSet = function()
{
  const best = BestSet();
  ui.picked = best ? best.map(c => c.id) : [];
  Rerender();
};

window.TradeCards = function()
{
  const picked = ui.picked.map(id => myCards.find(c => c.id === id)).filter(Boolean);
  if(!IsValidSet(picked)) return;

  const cards = ui.picked.slice();
  ui.picked = [];
  SendAction("trade", { cards: cards });
  Rerender();
};

// ===== ATAQUE =====

window.PickFrom = function(id)
{
  ui.from = id;
  ui.to = null;
  ui.changeTarget = true;

  if(table.phase === "Attack") ui.dice = MaxDice(id);
  if(table.phase === "Move") ui.count = Math.max(1, Armies(id) - 1);

  Rerender();
};

window.PickTo = function(id)
{
  ui.to = id;
  if(table.phase === "Attack") ui.dice = MaxDice(ui.from);
  Rerender();
};

window.BackStep = function()
{
  if(ui.to) ui.to = null;
  else ui.from = null;
  Rerender();
};

window.SetDice = function(dice) { ui.dice = dice; Rerender(); };

window.DoAttack = function()
{
  if(!ui.from || !ui.to) return;
  ui.changeTarget = false;
  SendAction("attack", { from: ui.from, to: ui.to, dice: Math.min(ui.dice, MaxDice(ui.from)) });
};

window.DoBlitz = function()
{
  if(!ui.from || !ui.to) return;
  ui.changeTarget = false;
  SendAction("blitz", { from: ui.from, to: ui.to });
};

window.ChangeTarget = function()
{
  ui.from = null;
  ui.to = null;
  ui.changeTarget = true;
  Rerender();
};

window.EndAttack = function() { SendAction("endAttack"); };

// ===== CONQUISTA E MOVIMENTO =====

window.SetCount = function(count) { ui.count = count; Rerender(); };

window.ConfirmConquest = function(count) { SendAction("conquestMove", { count: count }); };

window.DoMove = function()
{
  if(!ui.from || !ui.to) return;
  SendAction("move", { from: ui.from, to: ui.to, count: ui.count });
};

window.EndTurn = function() { SendAction("endTurn"); };

window.TapTerritory = function(id)
{
  if(IsPlanning())
  {
    window.AddToPlan(id);
    return;
  }

  if(!IsMyAction()) return;

  if(table.phase === "Attack" && !RepeatPanelActive())
  {
    if(ui.from && AttackTargets(ui.from).includes(id)) window.PickTo(id);
    else if(AttackOrigins().includes(id)) window.PickFrom(id);
    return;
  }

  if(table.phase === "Attack")
  {
    if(AttackOrigins().includes(id)) window.PickFrom(id);
    return;
  }

  if(table.phase === "Move")
  {
    if(ui.from && ReachableFrom(ui.from).includes(id)) window.PickTo(id);
    else if(MoveOrigins().includes(id)) window.PickFrom(id);
  }
};

window.ToggleMission = function()
{
  missionVisible = !missionVisible;
  RenderMission();
};

window.ToggleCardsHelp = function()
{
  cardsHelpVisible = !cardsHelpVisible;
  RenderCards();
};

window.ResetMapView = function()
{
  mapUserMoved = true;
  AnimateCamTo(FullCam(ViewAspect()));
};


// =========================
// OPEN PLAYING
// =========================

function StopPlayingListeners()
{
  unsubscribers.forEach(u => u());
  unsubscribers = [];
  StopCountdown();
}

function OpenPlaying()
{
  StopPlayingListeners();

  panelKey = null;
  cardsKey = null;
  situationKey = null;
  ui = NewUi();

  if(MOCK)
  {
    RenderAll();
    return;
  }

  const me = `rooms/${currentRoomCode}/players/${currentPlayerId}`;

  unsubscribers.push(onValue(ref(db, `rooms/${currentRoomCode}/currentState/table`), (snapshot) =>
  {
    if(!snapshot.exists()) return;
    table = snapshot.val();
    TrackBattle();
    RenderAll();
  }));

  unsubscribers.push(onValue(ref(db, `${me}/cards`), (snapshot) =>
  {
    const next = AsList(snapshot.val());

    if(lastHandSize !== null && next.length > lastHandSize)
    {
      const gained = next.length - lastHandSize;
      ShowToast(gained === 1 ? "Nova carta!" : `${gained} cartas novas!`, true);
    }

    lastHandSize = next.length;
    myCards = next;
    ui.picked = ui.picked.filter(id => myCards.some(c => c.id === id));
    cardsKey = null;
    RenderAll();
  }));

  unsubscribers.push(onValue(ref(db, `${me}/mission`), (snapshot) =>
  {
    myMission = snapshot.val();

    if(myMission && myMission.fallback && !wasFallback)
    {
      wasFallback = true;
      missionVisible = true;
      ShowToast("Seu alvo foi destruído por outro! Missão nova.");
      if(navigator.vibrate) navigator.vibrate([100, 50, 100]);
    }

    RenderMission();
    if(table) RenderActionPanel(); // a tela de eliminado mostra a missão
  }));

  unsubscribers.push(onValue(ref(db, `rooms/${currentRoomCode}/currentState/actionRejected`), (snapshot) =>
  {
    if(!snapshot.exists()) return;
    const data = snapshot.val();
    if(data.playerId !== currentPlayerId || data.t < Date.now() - 10000) return;
    ShowToast(RejectedReasonLabels[data.reason] || "Ação inválida.");
    ui.sentPlan = false;
    Rerender();
  }));
}

function TrackBattle()
{
  const b = table.battle;
  if(!b || b.serial === lastBattleSerial) return;

  if(b.defenderId === currentPlayerId && b.conquered) lastConqueredBy = b.attackerId;

  const isFirstRead = lastBattleSerial === 0 && table.turnNumber > 1 && situationKey === null;
  lastBattleSerial = b.serial;
  if(isFirstRead) return;

  if(b.defenderId === currentPlayerId && navigator.vibrate) navigator.vibrate(b.conquered ? [120, 60, 120] : 40);
}

function RenderAll()
{
  if(!table) return;

  const me = Me();
  document.getElementById("playingScreen").classList.toggle("out", !!me && me.alive === false);
  UpdateChrome();

  RenderMe();
  RenderMission();
  RenderActionPanel();
  RenderCards();
  RenderMap();
  RenderMiniLog();
}


// =========================
// MEU STATUS E MISSÃO
// =========================

function RenderMe()
{
  const me = Me();
  if(!me) return;

  document.getElementById("meDot").style.background = me.color;
  document.getElementById("meName").innerText = `${me.name} · ${me.colorName}`;

  const parts = me.alive ? [`${me.territories} territórios`, `${me.armies} exércitos`] : ["Eliminado"];
  if(table.mode === "teams") parts.push(`Time ${me.team + 1}`);
  document.getElementById("meSub").innerText = parts.join(" · ");
}

function RenderMission()
{
  const el = document.getElementById("missionCard");
  if(!el) return;

  const open = !!myMission && missionVisible;
  el.classList.toggle("open", open);
  el.classList.toggle("closed", !open);
  el.setAttribute("aria-expanded", open ? "true" : "false");

  if(!myMission)
  {
    el.innerHTML = `<span>Missão secreta</span><span>Chegando...</span>`;
    return;
  }

  if(!open)
  {
    el.innerHTML = `<span>Missão secreta</span><span>Toque pra ver</span>`;
    return;
  }

  const progress = myMission.progress || 0;
  const allies = AsList(myMission.allies).map(PlayerName).filter(Boolean);
  const note = myMission.fallback ? `<small class="missionNote alert">Seu alvo foi destruído por outro jogador. Missão nova.</small>` : "";
  const team = allies.length ? `<small class="missionNote">Missão do time, com ${Esc(JoinNames(allies))}.</small>` : "";

  el.innerHTML = `<span class="missionTop"><span class="hot">Missão secreta</span><span class="soft">Toque pra esconder</span></span>
    <b class="missionText">${Esc(myMission.text)}</b>
    <span class="progress"><span class="progressBar" role="progressbar" aria-label="Missão cumprida" aria-valuenow="${progress}" aria-valuemin="0" aria-valuemax="100"><i style="width:${progress}%"></i></span><b>${progress}%</b></span>
    ${note}${team}`;
}


// =========================
// PAINEL DA FASE
// =========================

function RepeatPanelActive()
{
  const prompt = table.prompt || {};
  return !!prompt.againFrom && !ui.changeTarget;
}

function WaitingPlacementNames()
{
  if(!table || !table.players) return [];

  return Object.entries(table.players)
    .filter(([id, p]) => id !== currentPlayerId && p && p.alive !== false && p.reserve > 0)
    .sort((a, b) => (a[1].seat || 0) - (b[1].seat || 0))
    .map(([, p]) => p.name);
}

function RenderActionPanel()
{
  const el = document.getElementById("actionPanel");
  const phase = table.phase;
  const prompt = table.prompt || {};
  const mine = IsMyAction() || (phase === "Placement" && MyReserve() > 0);

  // SITUAÇÃO NOVA: zera a decisão local (a colocação inicial espera a confirmação).
  const situation = [phase, table.actorId, table.turnNumber, prompt.type, prompt.againFrom, prompt.againTo, prompt.reserve].join("#");

  if(situation !== situationKey)
  {
    const samePlanning = situationKey && situationKey.startsWith("Reinforce") && phase === "Reinforce" && table.actorId === currentPlayerId;
    situationKey = situation;

    const keepPlan = samePlanning ? ui.plan : {};
    const keepStep = ui.step;
    const keepTarget = phase === "Attack" ? false : ui.changeTarget;
    const keepSent = phase === "Placement" ? ui.sentPlan : false;

    ui = NewUi();
    ui.plan = keepPlan;
    ui.step = keepStep;
    ui.changeTarget = keepTarget;
    ui.sentPlan = keepSent;

    if(phase === "Attack" && prompt.againFrom)
    {
      ui.from = prompt.againFrom;
      ui.to = prompt.againTo;
      ui.dice = MaxDice(prompt.againFrom);
    }

    if(phase === "Conquest") ui.count = prompt.min;

    // Mapa: volta a se enquadrar sozinho na situação nova.
    mapUserMoved = false;
    frameKey = null;

    StartCountdown(mine ? (table.phaseDuration || 0) : 0);

    if(mine && navigator.vibrate && ["Reinforce", "Attack", "Move", "Conquest"].includes(phase)) navigator.vibrate(30);
  }

  // CHAVE: só reconstrói quando algo que aparece no painel muda.
  const b = table.battle;
  const key = [
    situation, table.actorId, JSON.stringify(ui), MyReserve(), table.truce,
    b ? `${b.serial}|${Armies(b.to)}|${OwnerOf(b.to)}` : "",
    ui.from ? Armies(ui.from) : "", ui.to ? `${Armies(ui.to)}|${OwnerOf(ui.to)}` : "",
    mine ? JSON.stringify(table.territories) : "", myCards.length, Me() ? `${Me().alive}|${Me().eliminatedBy}` : "",
    phase === "Placement" ? WaitingPlacementNames().join(",") : "", myMission ? myMission.text : ""
  ].join("#");

  if(key === panelKey) return;
  panelKey = key;

  el.innerHTML = BuildPanelHTML(phase, prompt, mine);
  AnimateDice(el);

  // Lista de territórios e controles marcados com data-below vão pra baixo do mapa.
  const below = document.getElementById("choicePanel");
  below.innerHTML = "";
  el.querySelectorAll(".choiceList, [data-below]").forEach(node => below.appendChild(node));

  // Botões principais vão pra barra fixa.
  const slot = document.getElementById("barSlot");
  slot.innerHTML = "";
  el.querySelectorAll("[data-bar]").forEach(node => slot.appendChild(node));
  RefreshBar();

  // Fora do reforço as cartas viram uma linha; no meu turno ela fica depois da lista.
  const battleView = !mine && !!CurrentBattle();
  const late = (mine && phase !== "Reinforce") || battleView;
  document.getElementById("playBody").classList.toggle("cardsLate", late);
  document.getElementById("mapWrap").classList.toggle("titled", !mine && !battleView);
}

function BuildPanelHTML(phase, prompt, mine)
{
  const me = Me();

  if(me && !me.alive) return EliminatedHTML();

  if(phase === "Placement") return mine && !ui.sentPlan ? PlanHTML(true, prompt) : PlacedHTML();

  if(phase === "Reinforce" && mine) return PlanHTML(false, prompt);
  if(phase === "Attack" && mine) return AttackHTML(prompt);
  if(phase === "Conquest" && mine) return ConquestHTML(prompt);
  if(phase === "Move" && mine) return MoveHTML();

  return SpectatorHTML(phase);
}

function TruceHTML()
{
  return `<div class="noteBox"><b>Trégua</b><span>Na primeira rodada, só vale atacar territórios neutros.</span></div>`;
}

function TagHTML(kind, note, strong)
{
  const tag = kind === "attack" ? `<span class="tag tag-red">Ataque</span>` : `<span class="tag tag-ink">Movimento</span>`;
  return `<div class="phaseHead">${tag}${note ? `<span class="tagNote ${strong ? "strong" : ""}">${Esc(note)}</span>` : ""}</div>`;
}

function StepperHTML(count, min, max)
{
  return `<div class="stepper">
      <button type="button" aria-label="Menos um" onclick="SetCount(${count - 1})" ${count <= min ? "disabled" : ""}>−</button>
      <output aria-live="polite">${count}</output>
      <button type="button" aria-label="Mais um" onclick="SetCount(${count + 1})" ${count >= max ? "disabled" : ""}>+</button>
    </div>`;
}

// ===== COLOCAÇÃO ENVIADA / ESPERANDO =====

function PlacedHTML()
{
  const waiting = WaitingPlacementNames().map(n => `<b>${Esc(n)}</b>`);
  const who = waiting.length ? ` faltam ${JoinNames(waiting)}` : "";

  return `<div class="inkBlock">
      <h2>Exércitos posicionados!</h2>
      <p>Esperando os outros<span class="dots" aria-hidden="true">...</span>${who}</p>
    </div>${table.truce ? TruceHTML() : ""}`;
}

// ===== COLOCAÇÃO INICIAL E REFORÇO =====

function PlanHTML(initial, prompt)
{
  const total = ReserveForPlan();
  const left = total - PlanTotal();

  const steps = [{ v: 1, l: "+1" }, { v: 3, l: "+3" }, { v: 5, l: "+5" }, { v: 0, l: "Tudo" }]
    .map(s => `<button type="button" class="chip ${ui.step === s.v ? "selected" : ""}" aria-pressed="${ui.step === s.v}" onclick="SetStep(${s.v})">${s.l}</button>`).join("");

  // Fronteiras primeiro: é onde exército faz diferença.
  const list = MyTerritories().sort((a, b) =>
  {
    const fa = Neighbors[a].some(n => OwnerOf(n) !== currentPlayerId && !IsAlly(OwnerOf(n))) ? 1 : 0;
    const fb = Neighbors[b].some(n => OwnerOf(n) !== currentPlayerId && !IsAlly(OwnerOf(n))) ? 1 : 0;
    return fb - fa || Armies(b) - Armies(a);
  });

  const rows = list.map(id =>
  {
    const planned = ui.plan[id] || 0;
    const frontier = Neighbors[id].some(n => OwnerOf(n) !== currentPlayerId && !IsAlly(OwnerOf(n)));
    const name = Esc(NameOfTerr(id));
    const plus = planned ? `<span class="plus">+${planned}</span>` : "";
    const minus = planned ? `<button type="button" class="minus" aria-label="Tirar 1 de ${name}" onclick="RemoveFromPlan('${id}')">−</button>` : "";

    return `<div class="choiceRow"><button type="button" class="choice ${planned ? "selected" : ""}" onclick="AddToPlan('${id}')">
      ${ArmyBadge(id)}<span class="grow">${name} <small>${frontier ? "fronteira" : "interior"}</small></span>${plus}</button>${minus}</div>`;
  }).join("");

  const mustTrade = !!prompt.mustTrade;
  const warn = mustTrade ? `<p class="warn">Com 5 cartas, a troca é obrigatória: troque uma trinca primeiro.</p>` : "";
  const ready = left <= 0 && !mustTrade && PlanTotal() > 0;
  const confirm = left > 0 ? `Confirmar · faltam ${left}` : "Confirmar";

  const head = initial
    ? `<h2 class="phaseTitle md">Posicione seus exércitos</h2><p class="countLine">Faltam <b>${left}</b> de ${total} · toque no mapa ou na lista</p>`
    : `<div class="phaseHead split"><h2 class="phaseTitle">Reforço</h2><span class="count">Faltam <b>${left}</b> de ${total}</span></div>`;

  return `${head}${warn}
    <div class="chipGroup" role="group" aria-label="Quanto cada toque põe">${steps}</div>
    <div class="choiceList">${rows}</div>
    <div class="barRow" data-bar>
      <button type="button" class="btn btnGhost barSide" ${PlanTotal() ? "" : "disabled"} onclick="ClearPlan()">Limpar</button>
      <button type="button" class="btn btnPrimary mid" ${ready ? "" : "disabled"} onclick="ConfirmPlan()">${confirm}</button>
    </div>`;
}

// ===== ATAQUE =====

function TerritoryRow(id, click, side, selected)
{
  return `<button type="button" class="choice ${selected ? "selected" : ""}" onclick="${click}">${ArmyBadge(id)}<span class="grow">${Esc(NameOfTerr(id))}</span>${side ? `<span class="side">${Esc(side)}</span>` : ""}</button>`;
}

function Plural(n, one, many) { return `${n} ${n === 1 ? one : many}`; }

function EmptyRow(text) { return `<div class="emptyRow">${Esc(text)}</div>`; }

function AttackHTML(prompt)
{
  const truce = table.truce ? TruceHTML() : "";

  // ATACAR DE NOVO: mesma batalha, um toque só.
  if(RepeatPanelActive() && Armies(prompt.againFrom) >= 2)
  {
    return `<h2 class="phaseTitle sm">${Esc(NameOfTerr(prompt.againFrom))} <span class="hot">→ ${Esc(NameOfTerr(prompt.againTo))}</span></h2>
      ${BattleHTML(false)}
      ${ScoreHTML(prompt.againFrom, prompt.againTo, true)}
      <p class="label gap">Dados</p>${DiceChips(prompt.againFrom, true)}
      <div class="barStack" data-bar>
        <button type="button" class="btn btnPrimary" onclick="DoAttack()">Atacar de novo</button>
        <div class="row">
          <button type="button" class="btn" onclick="DoBlitz()">Até o fim</button>
          <button type="button" class="btn btnGhost" onclick="ChangeTarget()">Mudar de alvo</button>
        </div>
        <button type="button" class="btnLink" onclick="EndAttack()">Parar de atacar</button>
      </div>`;
  }

  if(!ui.from)
  {
    const origins = AttackOrigins().sort((a, b) => Armies(b) - Armies(a));

    const rows = origins.map(id =>
    {
      const targets = AttackTargets(id);
      const sea = targets.some(t => SeaEdges.has(EdgeKey(id, t)));
      return TerritoryRow(id, `PickFrom('${id}')`, Plural(targets.length, "alvo", "alvos") + (sea ? " · mar" : ""));
    }).join("");

    return `${TagHTML("attack")}<h2 class="phaseTitle">Atacar de onde?</h2>
      <p class="sub">Seus territórios com 2+ exércitos e vizinho inimigo.</p>${truce}
      <div class="choiceList">${rows || EmptyRow("Nenhum território seu pode atacar agora.")}</div>
      <div class="barStack" data-bar><button type="button" class="btn btnGhost" onclick="EndAttack()">Parar de atacar</button></div>`;
  }

  if(!ui.to)
  {
    const targets = AttackTargets(ui.from).sort((a, b) => Armies(a) - Armies(b));

    const rows = targets.map(id =>
    {
      const sea = SeaEdges.has(EdgeKey(ui.from, id)) ? " · mar" : "";
      return TerritoryRow(id, `PickTo('${id}')`, `${PlayerName(OwnerOf(id))}${sea}`);
    }).join("");

    return `${TagHTML("attack", `${Plural(Armies(ui.from), "exército", "exércitos")} aqui`)}
      <h2 class="phaseTitle">${Esc(NameOfTerr(ui.from))} ataca quem?</h2>
      <div class="choiceList">${rows}</div>
      <div class="barStack" data-bar><button type="button" class="btn btnGhost" onclick="BackStep()">Voltar</button></div>`;
  }

  const sea = SeaEdges.has(EdgeKey(ui.from, ui.to));

  return `${TagHTML("attack", sea ? "pelo mar" : "", true)}
    <h2 class="phaseTitle">${Esc(NameOfTerr(ui.from))}<br><span class="hot">→ ${Esc(NameOfTerr(ui.to))}</span></h2>
    <div data-below>
      ${ScoreHTML(ui.from, ui.to)}
      <p class="label gap">Quantos dados</p>${DiceChips(ui.from)}
    </div>
    <div class="barStack" data-bar>
      <button type="button" class="btn btnPrimary" onclick="DoAttack()">Atacar!</button>
      <div class="row">
        <button type="button" class="btn" onclick="DoBlitz()">Até o fim</button>
        <button type="button" class="btn btnGhost" onclick="BackStep()">Voltar</button>
      </div>
    </div>`;
}

// Placar "SEUS 8 × LÉO 3": a caixa do defensor fica na cor dele.
function ScoreHTML(from, to, compact)
{
  const owner = OwnerOf(to);
  const color = OwnerColor(to);
  const label = LabelOn(color);
  const name = Esc(PlayerName(owner));

  return `<div class="score ${compact ? "compact" : ""}">
      <div class="scoreSide"><small>Seus</small><b>${Armies(from)}</b></div>
      <span class="scoreX"><span aria-hidden="true">×</span><span class="sr">contra</span></span>
      <div class="scoreSide" style="background:${color};color:${label.fg}"><small class="${label.chip ? "onPaper" : ""}">${name}</small><b>${Armies(to)}</b></div>
    </div>`;
}

function DiceChips(from, short)
{
  const max = MaxDice(from);
  const dice = Math.min(ui.dice, max);
  const chips = [];

  for(let d = 1; d <= max; d++)
  {
    const text = d === 1 ? "1 dado" : `${d} dados`;
    const label = short ? `<span aria-hidden="true">${d}</span><span class="sr">${text}</span>` : text;
    chips.push(`<button type="button" class="chip ${dice === d ? "selected" : ""}" aria-pressed="${dice === d}" onclick="SetDice(${d})">${label}</button>`);
  }

  return `<div class="chipGroup">${chips.join("")}</div>`;
}

// ===== CONQUISTA =====

function ConquestHTML(prompt)
{
  const min = prompt.min;
  const max = prompt.max;
  const half = Math.max(min, Math.ceil((min + max) / 2));
  const count = Math.max(min, Math.min(max, ui.count));
  const b = table.battle;
  const stamp = Once(`stamp#${b ? b.serial : situationKey}`) ? "anim" : "";

  const options = [{ v: min, l: "Mínimo" }, { v: half, l: "Metade" }, { v: max, l: "Tudo" }];
  const selected = count === min ? 0 : count === max ? 2 : count === half ? 1 : -1;
  const chips = options.map((o, i) => `<button type="button" class="chip ${selected === i ? "selected" : ""}" aria-pressed="${selected === i}" onclick="SetCount(${o.v})">${o.l}</button>`).join("");

  return `<h2 class="stamp ${stamp}">${Esc(NameOfTerr(prompt.to))} é sua!</h2>
    <p class="lead2">Quantos exércitos entram? Pelo menos <b>${min}</b>. O resto fica em ${Esc(NameOfTerr(prompt.from))}.</p>
    <div data-below>
      ${StepperHTML(count, min, max)}
      <div class="chipGroup">${chips}</div>
    </div>
    <div class="barStack" data-bar><button type="button" class="btn btnPrimary" onclick="ConfirmConquest(${count})">Mover ${count}</button></div>`;
}

// ===== MOVIMENTO =====

function MoveHTML()
{
  const tag = TagHTML("move", "uma por turno, entre os seus");
  const end = `<button type="button" class="btn btnGhost" onclick="EndTurn()">Terminar turno</button>`;
  const back = `<button type="button" class="btn btnGhost" onclick="BackStep()">Voltar</button>`;

  if(!ui.from)
  {
    const origins = MoveOrigins().sort((a, b) => Armies(b) - Armies(a));
    const rows = origins.map(id => TerritoryRow(id, `PickFrom('${id}')`, Plural(ReachableFrom(id).length, "destino", "destinos"))).join("");

    return `${tag}<h2 class="phaseTitle">Mover exércitos?</h2>
      <div class="choiceList">${rows || EmptyRow("Nenhum território seu pode mover agora.")}</div>
      <div class="barStack" data-bar>${end}</div>`;
  }

  if(!ui.to)
  {
    const targets = ReachableFrom(ui.from).sort((a, b) => Armies(a) - Armies(b));

    return `${tag}<h2 class="phaseTitle">De ${Esc(NameOfTerr(ui.from))} pra onde?</h2>
      <div class="choiceList">${targets.map(id => TerritoryRow(id, `PickTo('${id}')`, "")).join("")}</div>
      <div class="barStack" data-bar><div class="row">${back}${end}</div></div>`;
  }

  const max = Armies(ui.from) - 1;
  const count = Math.max(1, Math.min(max, ui.count));

  return `${tag}<h2 class="phaseTitle">${Esc(NameOfTerr(ui.from))} → ${Esc(NameOfTerr(ui.to))}</h2>
    <div data-below>
      ${StepperHTML(count, 1, max)}
      <p class="sub center">Sempre fica 1 exército em ${Esc(NameOfTerr(ui.from))}.</p>
    </div>
    <div class="barStack" data-bar>
      <button type="button" class="btn btnInk big" onclick="DoMove()">Mover ${count}</button>
      <div class="row">${back}${end}</div>
    </div>`;
}

// ===== VEZ DE OUTRO =====

function SpectatorHTML(phase)
{
  const actor = PlayerName(table.actorId);
  const turnName = PlayerName(table.currentTurnPlayerId || table.actorId);

  const labels = {
    "Reinforce": `${actor} está reforçando`,
    "Attack": `${actor} escolhe quem atacar`,
    "Battle": `${actor} está atacando!`,
    "Conquest": `${actor} conquistou!`,
    "Move": `${actor} pode mover exércitos`
  };

  const b = CurrentBattle();
  const live = b && ["Attack", "Battle", "Conquest"].includes(phase);
  const underAttack = live && b.defenderId === currentPlayerId;

  const title = underAttack ? `${PlayerName(b.attackerId)} está te atacando!` : (labels[phase] || "Olho na TV!");
  const shake = underAttack && Once(`shake#${b.serial}`) && !ReducedMotion() ? " shake" : "";

  let detail = "";

  if(b)
  {
    const sea = SeaEdges.has(EdgeKey(b.from, b.to)) ? " · pelo mar" : "";
    detail = `<p class="battleRoute">${Esc(NameOfTerr(b.from))} → <b>${Esc(NameOfTerr(b.to))}</b>${sea}</p>${BattleHTML(true)}`;
  }

  return `<div class="inkBlock${shake}">
      <p class="kicker">Vez de ${Esc(turnName)}</p>
      <h2>${Esc(title)}</h2>
      ${detail}
    </div>`;
}

// ===== ELIMINADO =====

function EliminatedHTML()
{
  const me = Me();
  const byId = (me && me.eliminatedBy) || lastConqueredBy;
  const by = byId ? PlayerName(byId) : "";
  const mission = myMission && myMission.text;
  const stamp = by && Once("eliminated") ? "anim" : "";

  return `<div class="elim">
      <div class="band" aria-hidden="true"></div>
      <h2 class="display elimTitle">Você<br>foi<br>eliminado</h2>
      ${by ? `<div class="elimStampRow"><span class="stamp onInk ${stamp}">Por ${Esc(by)}</span></div>` : ""}
      <p class="elimLead">Sem piedade mesmo. Agora é só torcer pra quem te derrubou se dar mal.</p>
      ${mission ? `<div class="paperCard"><small>Sua missão era</small><b>${Esc(mission)}</b></div>` : ""}
      <p class="elimFoot">${by ? `${Esc(by)} levou suas cartas. ` : ""}Continue de olho na TV.</p>
    </div>`;
}


// =========================
// DADOS
// =========================

const PipPatterns = [[], [4], [0, 8], [0, 4, 8], [0, 2, 6, 8], [0, 2, 4, 6, 8], [0, 2, 3, 5, 6, 8]];

function DieFaceHTML(value)
{
  return Array.from({ length: 9 }, (_, i) => `<i class="${(PipPatterns[value] || []).includes(i) ? "pip" : ""}"></i>`).join("");
}

// Leitura das duplas: maior contra maior, empate é da defesa.
function PairsText(att, def)
{
  const a = att.slice().sort((x, y) => y - x);
  const d = def.slice().sort((x, y) => y - x);
  const out = [];

  for(let i = 0; i < Math.min(a.length, d.length); i++)
  {
    if(a[i] > d[i]) out.push(`${a[i]} × ${d[i]} pro ataque`);
    else if(a[i] === d[i]) out.push(`${a[i]} × ${d[i]} empate, defesa leva`);
    else out.push(`${a[i]} × ${d[i]} pra defesa`);
  }

  return out.join(" · ");
}

// colored = dados na cor de cada jogador (quem assiste); senão papel × preto dentro do bloco vermelho.
function BattleHTML(colored)
{
  const b = CurrentBattle();
  if(!b) return "";

  const att = AsList(b.att);
  const def = AsList(b.def);
  const attColor = PlayerColor(b.attackerId);
  const defColor = PlayerColor(b.defenderId);

  const die = (v, side) =>
  {
    if(colored)
    {
      const c = side === "a" ? attColor : defColor;
      return `<span class="die" style="background:${c};--pip:${InkOn(c)}" data-final="${v}">${DieFaceHTML(v)}</span>`;
    }

    return `<span class="die ${side === "d" ? "def" : ""}" data-final="${v}">${DieFaceHTML(v)}</span>`;
  };

  const attName = b.attackerId === currentPlayerId ? "Você" : PlayerName(b.attackerId);
  const defName = b.defenderId === currentPlayerId ? "Você" : PlayerName(b.defenderId);
  const many = b.rolls > 1;
  const sum = `${b.conquered ? "Conquistou! " : ""}Ataque −${b.totalAttLoss} · Defesa −${b.totalDefLoss}`;
  const pairs = PairsText(att, def);
  const pairsLine = many ? `${b.rolls} rolagens. Última: ${pairs}` : pairs;

  let after = "";

  if(colored)
  {
    after = b.conquered
      ? `. ${NameOfTerr(b.to)} agora é de ${PlayerName(b.attackerId)}.`
      : `. Sobram ${Armies(b.to)} em ${NameOfTerr(b.to)}.`;
  }

  return `<div class="battleBox ${colored ? "plain" : ""}" data-serial="${b.serial}">
      <div class="battleDice">
        <div class="diceSide"><small>${Esc(attName)}</small><div class="diceRow" aria-label="Dados do ataque: ${att.join(", ")}">${att.map(v => die(v, "a")).join("")}</div></div>
        <div class="diceSide right"><small>${Esc(defName)}</small><div class="diceRow" aria-label="Dados da defesa: ${def.join(", ")}">${def.map(v => die(v, "d")).join("")}</div></div>
      </div>
      <p class="battleSum">${sum}</p>
      <p class="battlePairs">${Esc(pairsLine + after)}</p>
    </div>`;
}

let lastAnimatedBattleSerial = null;

function AnimateDice(container)
{
  const box = container.querySelector(".battleBox[data-serial]");
  if(!box) return;

  const serial = box.dataset.serial;
  if(serial === lastAnimatedBattleSerial) return;
  lastAnimatedBattleSerial = serial;

  box.querySelectorAll(".diceRow").forEach(row =>
  {
    const dice = Array.from(row.querySelectorAll(".die[data-final]"));
    row.classList.add("rolling");

    dice.forEach((die, i) =>
    {
      const swap = setInterval(() => { die.innerHTML = DieFaceHTML(1 + Math.floor(Math.random() * 6)); }, 70);

      setTimeout(() =>
      {
        clearInterval(swap);
        die.innerHTML = DieFaceHTML(parseInt(die.dataset.final, 10));
        die.classList.add("landed");

        if(i === dice.length - 1) row.classList.remove("rolling");
      }, 520 + i * 110);
    });
  });
}


// =========================
// CARTAS
// =========================

function CardsHelpHTML()
{
  return `<div class="cardsHelp">
    <p><b>Como ganhar:</b> cada território que você conquista no seu turno vale 1 carta (até 2 por turno). Eliminou alguém? Fica com as cartas dele.</p>
    <p><b>Trinca:</b> 3 cartas com o mesmo símbolo, 3 símbolos diferentes, ou quaisquer 2 + coringa.</p>
    <p><b>Quando trocar:</b> só na sua fase de reforço. A trinca vira exércitos na sua reserva pra posicionar.</p>
    <p><b>Quanto vale:</b> cada troca na mesa (de qualquer jogador) aumenta o valor da próxima: +4, +6, +8, +10, +12 e +15. O valor atual aparece aqui em cima.</p>
    <p><b>Bônus:</b> carta marcada “+2 aqui” é de um território seu. Trocar ela põe +2 exércitos direto nele.</p>
    <p><b>Limite:</b> com 5 cartas na mão, a troca é obrigatória.</p>
  </div>`;
}

function CardHTML(c, pickable)
{
  const wild = c.symbol === "coringa";
  const note = CardIsMine(c)
    ? `<small class="bonus">+2 aqui</small>`
    : `<small>${wild ? "vale qualquer" : (SymbolNames[c.symbol] || "")}</small>`;

  const inner = `${SymbolIcons[c.symbol] || ""}<b>${Esc(wild ? SymbolNames.coringa : c.name)}</b>${note}`;

  if(!pickable) return `<div class="gameCard">${inner}</div>`;

  const picked = ui.picked.includes(c.id);
  return `<button type="button" class="gameCard pickable ${picked ? "selected" : ""}" aria-pressed="${picked}" onclick="ToggleCard('${c.id}')">${inner}</button>`;
}

function TrincaHint()
{
  const n = myCards.length;
  if(n < 3) return `Faltam ${Plural(3 - n, "carta", "cartas")} pra uma trinca.`;
  return BestSet() ? "Você já tem uma trinca." : "Ainda sem trinca.";
}

function RenderCards()
{
  const el = document.getElementById("cardsPanel");
  const canTrade = table.phase === "Reinforce" && IsMyAction();
  const watching = !IsMyAction() && !IsPlanning();

  const key = [canTrade, watching, JSON.stringify(myCards), ui.picked.join(","), table.nextTradeValue, canTrade ? MyTerritories().join(",") : "", cardsHelpVisible].join("#");
  if(key === cardsKey) return;
  cardsKey = key;

  const n = myCards.length;
  const value = table.nextTradeValue || 0;
  const help = `<button type="button" class="helpButton ${cardsHelpVisible ? "open" : ""}" aria-label="Como funcionam as cartas" aria-expanded="${cardsHelpVisible}" onclick="ToggleCardsHelp()"><span aria-hidden="true">?</span></button>`;
  const helpBox = cardsHelpVisible ? CardsHelpHTML() : "";

  // FORA DO REFORÇO: uma linha só (sobra espaço pro mapa).
  if(!canTrade)
  {
    const compactLabel = n && !watching ? `${Plural(n, "carta", "cartas")} · próxima troca +${value}` : `Suas cartas · próxima troca +${value}`;
    const header = `<div class="cardsHeader"><p class="label">${compactLabel}</p>${help}</div>${helpBox}`;

    if(!watching) { el.innerHTML = header; return; }

    if(!n)
    {
      el.innerHTML = `${header}<div class="cardsNote">Sem cartas. Conquiste território pra ganhar (até 2 por turno).</div>`;
      return;
    }

    el.innerHTML = `${header}<div class="cardsMini">${myCards.map(c => CardHTML(c, false)).join("")}
      <div class="cardsNote">Troca só na sua vez, no reforço. ${TrincaHint()}</div></div>`;
    return;
  }

  const header = `<div class="cardsHeader"><p class="label">Suas cartas · próxima troca +${value}</p>${help}</div>${helpBox}`;

  if(!n)
  {
    el.innerHTML = `${header}<div class="cardsNote">Sem cartas. Conquiste território pra ganhar (até 2 por turno).</div>`;
    return;
  }

  const cards = myCards.map(c => CardHTML(c, true)).join("");
  const picked = ui.picked.map(id => myCards.find(c => c.id === id)).filter(Boolean);
  const valid = IsValidSet(picked);
  const hasSet = BestSet() !== null;

  const controls = hasSet || picked.length
    ? `<div class="row cardsActions">
        <button type="button" class="btn btnGhost" ${hasSet ? "" : "disabled"} onclick="PickBestSet()">Melhor trinca</button>
        <button type="button" class="btn btnRed" ${valid ? "" : "disabled"} onclick="TradeCards()">Trocar +${value}</button>
      </div>`
    : `<p class="sub">Ainda sem trinca: 3 iguais, 3 diferentes ou 2 + coringa.</p>`;

  el.innerHTML = `${header}<div class="handRow ${n >= 5 ? "five" : ""}">${cards}</div>${controls}`;
}


// =========================
// MAPA (SVG, mesmo arquivo de dados do telão)
// =========================

const TerrD = {};
const MapEls = { path: {}, tok: {}, num: {}, plus: {}, name: {} };

let mapFocus = {};
let mapHighlightKey = null;
let mapAspectKey = null;
let frameKey = null;
let mapUserMoved = false;
let camAnim = null;

function RingPath(ring)
{
  let d = "";

  for(let i = 0; i < ring.length; i += 2) d += `${i === 0 ? "M" : "L"}${ring[i]} ${ring[i + 1]}`;

  return d + "Z";
}

function BuildMap()
{
  if(mapBuilt) return;
  mapBuilt = true;

  let svg = `<svg viewBox="0 0 ${MAP.width} ${MAP.height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Mapa do mundo">`;

  MAP.decor.forEach(d => { svg += `<path class="decor" d="${d.rings.map(RingPath).join("")}" fill-rule="evenodd"/>`; });

  MAP.territories.forEach(t =>
  {
    TerrD[t.id] = t.rings.map(RingPath).join("");
    svg += `<path id="p_${t.id}" class="terr" d="${TerrD[t.id]}" fill="${NEUTRAL_FALLBACK}" fill-rule="evenodd" onclick="TapTerritory('${t.id}')"/>`;
  });

  // Papel por cima de quem não dá pra escolher agora.
  svg += `<path id="mapVeil" class="veil" d="" fill-rule="evenodd"/>`;

  (MAP.continents || []).forEach(c => { svg += `<path class="cont" d="${c.rings.map(RingPath).join("")}"/>`; });

  svg += `<g>`;

  MAP.links.forEach(l =>
  {
    const a = TerritoryById[l.a];
    const b = TerritoryById[l.b];
    const cls = l.sea ? "route sea" : "route";

    if(l.wrap)
    {
      const left = a.x < b.x ? a : b;
      const right = a.x < b.x ? b : a;
      svg += `<line class="${cls}" x1="${left.x}" y1="${left.y}" x2="0" y2="${left.y}"/>`;
      svg += `<line class="${cls}" x1="${right.x}" y1="${right.y}" x2="${MAP.width}" y2="${right.y}"/>`;
      return;
    }

    svg += `<line class="${cls}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`;
  });

  svg += `</g><g id="mapHighlights"></g>`;

  svg += `<g id="mapArrow" class="arrow" style="display:none">
    <line class="aUnder"/><line class="aOver"/>
    <g class="aHead"><polygon class="hUnder" points="3,0 -21,-15 -21,15"/><polygon class="hOver" points="-3,0 -17,-9 -17,9"/></g>
  </g>`;

  // FICHAS: quadrado preto, tamanho constante na tela (escala em ApplyMapCamera).
  MAP.territories.forEach(t =>
  {
    svg += `<g id="k_${t.id}" class="tok" onclick="TapTerritory('${t.id}')">
      <rect class="tOuter" style="display:none"/>
      <rect class="tRing" x="-14" y="-14" width="28" height="28"/>
      <rect class="tBody" x="-12" y="-12" width="24" height="24"/>
      <text class="tNum" y="0" dy=".36em"></text>
      <g class="tPlus" style="display:none"><rect y="-24" height="16"/><text y="-16" dy=".36em"></text></g>
    </g>`;
  });

  MAP.territories.forEach(t =>
  {
    svg += `<g id="m_${t.id}"><text class="tName" dy=".8em">${Esc(t.name.toUpperCase())}</text></g>`;
  });

  document.getElementById("mapView").innerHTML = svg + "</svg>";

  MAP.territories.forEach(t =>
  {
    const g = document.getElementById(`k_${t.id}`);
    MapEls.path[t.id] = document.getElementById(`p_${t.id}`);
    MapEls.tok[t.id] = g;
    MapEls.num[t.id] = g.querySelector(".tNum");
    MapEls.plus[t.id] = g.querySelector(".tPlus");
    MapEls.name[t.id] = document.getElementById(`m_${t.id}`);
  });

  SetupMapCamera();
  ApplyMapCamera();
}

// ===== CÂMERA DO MAPA: arrastar pra mover, scroll/pinça pra zoom, enquadramento automático =====

const MAP_MAX_ZOOM = 6;
const MAP_DRAG_THRESHOLD = 6;
const MAP_FRAME_ASPECT = 4 / 3;

let mapCam = { x: 0, y: 0, w: MAP.width, h: MAP.height };
const mapPointers = new Map();
let mapMoved = false;
let mapSuppressClick = false;

function MapSvg() { return document.querySelector("#mapView svg"); }

function ViewAspect()
{
  const view = document.getElementById("mapView");
  return view && view.clientWidth > 0 && view.clientHeight > 0 ? view.clientWidth / view.clientHeight : MAP_FRAME_ASPECT;
}

// Largura máxima da câmera: o mundo inteiro cabe (com faixa de oceano se o quadro for mais alto).
function MaxCamW(aspect) { return Math.max(MAP.width, MAP.height * aspect); }

function ClampCam(c, aspect)
{
  c.w = Math.min(MaxCamW(aspect), Math.max(MAP.width / MAP_MAX_ZOOM, c.w));
  c.h = c.w / aspect;
  c.x = c.w >= MAP.width ? (MAP.width - c.w) / 2 : Math.min(MAP.width - c.w, Math.max(0, c.x));
  c.y = c.h >= MAP.height ? (MAP.height - c.h) / 2 : Math.min(MAP.height - c.h, Math.max(0, c.y));
  return c;
}

function FullCam(aspect) { return ClampCam({ x: 0, y: 0, w: MaxCamW(aspect), h: 0 }, aspect); }

function UnitsPerPx()
{
  const view = document.getElementById("mapView");
  return mapCam.w / ((view && view.clientWidth) || 1);
}

// Ficha entre 16 e 34px na tela, independente do zoom.
function TokenPx(unitsPerPx) { return Math.max(16, Math.min(34, 40 / unitsPerPx)); }

function ApplyMapCamera()
{
  const svg = MapSvg();
  if(!svg) return;

  const aspect = ViewAspect();
  const c = ClampCam(mapCam, aspect);

  svg.setAttribute("viewBox", `${c.x} ${c.y} ${c.w} ${c.h}`);
  svg.classList.toggle("named", c.w < MAP.width / 1.8);
  document.getElementById("zoomButton").style.visibility = c.w < MaxCamW(aspect) - 0.5 ? "visible" : "hidden";

  const u = UnitsPerPx();
  const px = TokenPx(u);
  const s = px / 24 * u;

  MAP.territories.forEach(t =>
  {
    const tok = MapEls.tok[t.id];
    if(!tok) return;
    tok.setAttribute("transform", `translate(${t.x} ${t.y}) scale(${s})`);
    MapEls.name[t.id].setAttribute("transform", `translate(${t.x} ${t.y + (px / 2 + 5) * u}) scale(${u})`);
  });

  UpdateArrow();
}

function AnimateCamTo(target)
{
  if(camAnim) cancelAnimationFrame(camAnim);
  camAnim = null;

  if(ReducedMotion())
  {
    mapCam = Object.assign({}, target);
    ApplyMapCamera();
    return;
  }

  const from = Object.assign({}, mapCam);
  const start = performance.now();
  const duration = 300;

  const step = now =>
  {
    const k = duration ? Math.min(1, (now - start) / duration) : 1;
    const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;

    mapCam = {
      x: from.x + (target.x - from.x) * e,
      y: from.y + (target.y - from.y) * e,
      w: from.w + (target.w - from.w) * e,
      h: from.h + (target.h - from.h) * e
    };

    ApplyMapCamera();
    camAnim = k < 1 ? requestAnimationFrame(step) : null;
  };

  camAnim = requestAnimationFrame(step);
}

function StopCamAnim()
{
  if(camAnim) cancelAnimationFrame(camAnim);
  camAnim = null;
}

// Zoom mantendo fixo o ponto do mapa que está sob (clientX, clientY).
function ZoomMapAt(clientX, clientY, factor)
{
  const rect = MapSvg().getBoundingClientRect();
  const aspect = ViewAspect();
  const fx = (clientX - rect.left) / rect.width;
  const fy = (clientY - rect.top) / rect.height;
  const px = mapCam.x + fx * mapCam.w;
  const py = mapCam.y + fy * mapCam.h;

  const w = Math.min(MaxCamW(aspect), Math.max(MAP.width / MAP_MAX_ZOOM, mapCam.w / factor));
  const h = w / aspect;

  mapCam = { x: px - fx * w, y: py - fy * h, w, h };
}

function PanMapBy(dxPx, dyPx)
{
  const unitsPerPx = mapCam.w / MapSvg().getBoundingClientRect().width;
  mapCam.x -= dxPx * unitsPerPx;
  mapCam.y -= dyPx * unitsPerPx;
}

function SetupMapCamera()
{
  const view = document.getElementById("mapView");

  view.addEventListener("pointerdown", e =>
  {
    if(e.pointerType === "mouse" && e.button !== 0) return;

    if(mapPointers.size === 0)
    {
      mapMoved = false;
      mapSuppressClick = false;
    }

    mapPointers.set(e.pointerId, { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY });
  });

  view.addEventListener("pointermove", e =>
  {
    const p = mapPointers.get(e.pointerId);
    if(!p) return;

    const prev = [...mapPointers.values()].slice(0, 2).map(q => ({ x: q.x, y: q.y }));
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;

    if(!mapMoved)
    {
      const far = Math.hypot(p.x - p.startX, p.y - p.startY) > MAP_DRAG_THRESHOLD;
      if(!far && mapPointers.size < 2) return;

      mapMoved = true;
      mapUserMoved = true; // mexeu à mão: não reenquadra até a próxima situação
      StopCamAnim();
      view.classList.add("dragging");
      mapPointers.forEach((_, id) => { try { view.setPointerCapture(id); } catch(err) {} });
    }

    if(mapPointers.size >= 2)
    {
      // PINÇA: zoom pela distância entre os dedos, pan pelo ponto médio.
      const now = [...mapPointers.values()].slice(0, 2);
      const prevMid = { x: (prev[0].x + prev[1].x) / 2, y: (prev[0].y + prev[1].y) / 2 };
      const nowMid = { x: (now[0].x + now[1].x) / 2, y: (now[0].y + now[1].y) / 2 };
      const prevDist = Math.hypot(prev[0].x - prev[1].x, prev[0].y - prev[1].y);
      const nowDist = Math.hypot(now[0].x - now[1].x, now[0].y - now[1].y);

      if(prevDist > 0) ZoomMapAt(nowMid.x, nowMid.y, nowDist / prevDist);
      PanMapBy(nowMid.x - prevMid.x, nowMid.y - prevMid.y);
    }
    else
    {
      PanMapBy(dx, dy);
    }

    ApplyMapCamera();
  });

  const release = e =>
  {
    if(!mapPointers.delete(e.pointerId)) return;
    if(mapMoved) mapSuppressClick = true;
    if(mapPointers.size === 0) view.classList.remove("dragging");
  };

  view.addEventListener("pointerup", release);
  view.addEventListener("pointercancel", release);

  // Depois de arrastar, o soltar não conta como toque no território.
  view.addEventListener("click", e =>
  {
    if(!mapSuppressClick) return;
    mapSuppressClick = false;
    e.stopPropagation();
    e.preventDefault();
  }, true);

  view.addEventListener("wheel", e =>
  {
    e.preventDefault();
    mapUserMoved = true;
    StopCamAnim();
    const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
    ZoomMapAt(e.clientX, e.clientY, Math.exp(-delta * 0.0015));
    ApplyMapCamera();
  }, { passive: false });
}

function MapPicks()
{
  const picks = new Set();

  if(IsPlanning())
  {
    if(ReserveLeft() > 0) MyTerritories().forEach(id => picks.add(id));
    return picks;
  }

  if(!IsMyAction()) return picks;

  if(table.phase === "Attack")
  {
    if(ui.from && !ui.to && !RepeatPanelActive()) AttackTargets(ui.from).forEach(id => picks.add(id));
    else if(!ui.from) AttackOrigins().forEach(id => picks.add(id));
  }

  if(table.phase === "Move")
  {
    if(ui.from && !ui.to) ReachableFrom(ui.from).forEach(id => picks.add(id));
    else if(!ui.from) MoveOrigins().forEach(id => picks.add(id));
  }

  return picks;
}

// Origem e alvo destacados no mapa (e a seta entre eles).
function MapFocus()
{
  const phase = table.phase;
  const prompt = table.prompt || {};

  if(IsMyAction() && !IsPlanning())
  {
    if(phase === "Conquest" && prompt.from) return { from: prompt.from, to: prompt.to, kind: "move" };
    if(phase === "Attack") return { from: ui.from, to: ui.to, kind: "attack" };
    if(phase === "Move") return { from: ui.from, to: ui.to, kind: "move" };
  }

  const b = CurrentBattle();
  if(b && ["Attack", "Battle", "Conquest"].includes(phase)) return { from: b.from, to: b.to, kind: phase === "Conquest" ? "move" : "attack" };

  return {};
}

// O que a câmera enquadra sozinha.
function FrameIds(picks, focus)
{
  const ids = new Set(IsPlanning() ? MyTerritories() : picks);

  if(focus.from) ids.add(focus.from);
  if(focus.to && !(focus.from && WrapEdges.has(EdgeKey(focus.from, focus.to)))) ids.add(focus.to);

  return [...ids].filter(id => TerrBox[id]);
}

function FrameCam(ids, aspect)
{
  if(!ids.length) return FullCam(aspect);

  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;

  ids.forEach(id =>
  {
    const b = TerrBox[id];
    x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0);
    x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1);
  });

  // 12% de folga de cada lado, sem aproximar demais, na proporção do quadro.
  let w = Math.max((x1 - x0) * 1.24, MAP.width / 5.5);
  let h = (y1 - y0) * 1.24;

  if(w / Math.max(h, 1) < aspect) w = h * aspect;
  h = w / aspect;

  return ClampCam({ x: (x0 + x1) / 2 - w / 2, y: (y0 + y1) / 2 - h / 2, w, h }, aspect);
}

function SetTokenRect(rect, half)
{
  rect.setAttribute("x", -half);
  rect.setAttribute("y", -half);
  rect.setAttribute("width", half * 2);
  rect.setAttribute("height", half * 2);
}

// Estados da ficha: origem (anel papel + vermelho), alvo (ficha vermelha), selecionável (anel vermelho).
function SetTokenState(id, state)
{
  const g = MapEls.tok[id];
  if(g.getAttribute("data-st") === state) return;
  g.setAttribute("data-st", state);

  const [outer, ring] = g.children;
  const outerHalf = state === "from" ? 22 : state === "pick" ? 20 : 0;

  outer.style.display = outerHalf ? "" : "none";
  if(outerHalf) SetTokenRect(outer, outerHalf);
  SetTokenRect(ring, state === "from" ? 15 : 14);
  g.classList.toggle("to", state === "to");
}

function RenderMap()
{
  BuildMap();

  const picks = MapPicks();
  const focus = MapFocus();
  const choosing = picks.size > 0;

  MAP.territories.forEach(t =>
  {
    const id = t.id;
    const color = OwnerColor(id);
    const path = MapEls.path[id];

    if(path.getAttribute("fill") !== color) path.setAttribute("fill", color);
    path.classList.toggle("pick", picks.has(id));

    // Número da ficha = exércitos de agora; o planejado vai no selo "+N".
    const num = MapEls.num[id];
    const label = String(Armies(id));
    if(num.textContent !== label) { num.textContent = label; num.classList.toggle("long", label.length > 2); }

    const planned = ui.plan[id] || 0;
    const plus = MapEls.plus[id];
    plus.style.display = planned ? "" : "none";

    if(planned)
    {
      const text = `+${planned}`;
      const width = 8 + 7 * text.length;
      const [box, txt] = plus.children;
      box.setAttribute("x", 6);
      box.setAttribute("width", width);
      txt.setAttribute("x", 6 + width / 2);
      if(txt.textContent !== text) txt.textContent = text;
    }

    SetTokenState(id, id === focus.from ? "from" : id === focus.to ? "to" : picks.has(id) ? "pick" : "");
  });

  // Véu e contornos: só refaz quando a escolha muda.
  const hlKey = [[...picks].sort().join(","), focus.from, focus.to, focus.kind].join("|");

  if(hlKey !== mapHighlightKey)
  {
    mapHighlightKey = hlKey;

    const veiled = choosing ? MAP.territories.map(t => t.id).filter(id => !picks.has(id) && id !== focus.from && id !== focus.to) : [];
    document.getElementById("mapVeil").setAttribute("d", veiled.map(id => TerrD[id]).join(""));

    let html = "";
    picks.forEach(id => { if(id !== focus.from && id !== focus.to) html += `<path class="hl pick" d="${TerrD[id]}"/>`; });
    if(focus.from) html += `<path class="hl from" d="${TerrD[focus.from]}"/>`;
    if(focus.to) html += `<path class="hl ${focus.kind === "move" ? "toMove" : "to"}" d="${TerrD[focus.to]}"/>`;
    document.getElementById("mapHighlights").innerHTML = html;
  }

  mapFocus = focus;

  // QUADRO: 4:3 quando há o que enquadrar; o mundo inteiro na proporção dele quando não há.
  const ids = FrameIds(picks, focus);
  const view = document.getElementById("mapView");
  const aspectKey = ids.length ? "frame" : "world";

  if(aspectKey !== mapAspectKey)
  {
    mapAspectKey = aspectKey;
    view.style.aspectRatio = ids.length ? "4 / 3" : `${MAP.width} / ${MAP.height}`;
  }

  const key = ids.slice().sort().join(",");

  if(key !== frameKey)
  {
    frameKey = key;
    if(!mapUserMoved) { AnimateCamTo(FrameCam(ids, ViewAspect())); return; }
  }

  ApplyMapCamera();
}

// Seta da origem ao alvo, encurtada pra não cobrir as fichas.
function UpdateArrow()
{
  const g = document.getElementById("mapArrow");
  if(!g) return;

  const f = mapFocus || {};

  if(!f.from || !f.to || !TerritoryById[f.from] || !TerritoryById[f.to])
  {
    g.style.display = "none";
    return;
  }

  const a = TerritoryById[f.from];
  const b = TerritoryById[f.to];
  const u = UnitsPerPx();
  const half = TokenPx(u) / 2;

  let bx = b.x;
  let by = b.y;
  let endGap = (half + 6) * u;

  // Rota do Pacífico: a seta vai só até a borda do mapa.
  if(WrapEdges.has(EdgeKey(f.from, f.to)))
  {
    bx = a.x < MAP.width / 2 ? 0 : MAP.width;
    by = a.y;
    endGap = 2 * u;
  }

  const dx = bx - a.x;
  const dy = by - a.y;
  const len = Math.hypot(dx, dy);
  const startGap = (half + 6) * u;
  const head = 17 * u;

  if(len < startGap + endGap + head + 4 * u)
  {
    g.style.display = "none";
    return;
  }

  const ux = dx / len;
  const uy = dy / len;
  const tipX = bx - ux * endGap;
  const tipY = by - uy * endGap;

  g.querySelectorAll("line").forEach(line =>
  {
    line.setAttribute("x1", a.x + ux * startGap);
    line.setAttribute("y1", a.y + uy * startGap);
    line.setAttribute("x2", tipX - ux * head);
    line.setAttribute("y2", tipY - uy * head);
  });

  g.querySelector(".aHead").setAttribute("transform", `translate(${tipX} ${tipY}) rotate(${Math.atan2(dy, dx) * 180 / Math.PI}) scale(${u})`);
  g.setAttribute("class", `arrow ${f.kind || "attack"}`);
  g.style.display = "";
}

function RenderMiniLog()
{
  const log = AsList(table.log);
  document.getElementById("miniLog").innerHTML = log.slice(-4).reverse().map(l => `<p>${Esc(l)}</p>`).join("");
}


// =========================
// CONTAGEM
// =========================

function StartCountdown(seconds)
{
  StopCountdown();
  countdownRemaining = Math.ceil(seconds || 0);

  const el = document.getElementById("meTimer");
  el.innerText = countdownRemaining > 0 ? countdownRemaining : "";
  if(countdownRemaining <= 0) return;

  countdownInterval = setInterval(() =>
  {
    if(isGamePaused) return;
    countdownRemaining--;
    el.innerText = countdownRemaining > 0 ? countdownRemaining : "";

    // Tempo acabando: manda o que já foi distribuído; o host completa o resto.
    if(countdownRemaining === 2 && IsPlanning() && PlanTotal() > 0 && !(table.prompt && table.prompt.mustTrade)) SendPlan();

    if(countdownRemaining <= 0) StopCountdown();
  }, 1000);
}

function StopCountdown()
{
  if(countdownInterval) clearInterval(countdownInterval);
  countdownInterval = null;
  const el = document.getElementById("meTimer");
  if(el) el.innerText = "";
}


// =========================
// FINAL
// =========================

async function OpenFinalScore()
{
  const final = MOCK ? mockFinal : (await get(ref(db, `rooms/${currentRoomCode}/currentState/final`))).val();
  if(!final) return;

  const winners = AsList(final.winnerIds);
  const names = AsList(final.winnerNames);
  const won = winners.includes(currentPlayerId);

  const title = document.getElementById("finalWinner");
  const who = names.join(" & ");
  const verb = names.length > 1 ? "venceram" : "venceu";

  title.innerHTML = won ? "Você<br>venceu!" : `${Esc(who)}<br>${verb}!`;
  title.classList.toggle("long", !won && who.length > 6);

  const ranking = AsList(final.ranking);
  const winnerRow = ranking.find(r => winners.includes(r.id));

  document.getElementById("finalBand").style.backgroundColor = winnerRow ? winnerRow.color : "";

  const reasons = {
    "time": "Acabou o tempo: venceu quem estava mais perto da missão.",
    "world": "Dominou o mundo inteiro!",
    "lastStanding": "Último de pé!",
    "mission": `Missão cumprida: ${winnerRow ? winnerRow.mission : ""}`
  };

  document.getElementById("finalReason").innerText = reasons[final.reason] || "";

  document.getElementById("finalRanking").innerHTML = ranking.map((r, i) =>
  {
    const team = final.teams ? ` · Time ${r.team + 1}` : "";
    const out = r.alive ? "" : " · eliminado";

    return `<div class="rankRow ${r.id === currentPlayerId ? "me" : ""} ${r.alive ? "" : "out"}">
      <span class="rankPos">${i + 1}</span><span class="rankSw" style="background:${r.color}" aria-hidden="true"></span>
      <span class="rankName"><b>${Esc(r.name)}</b><small>${Esc(r.mission)}${out}${team}</small></span>
      <span class="rankScore">${r.progress}%</span></div>`;
  }).join("");

  if(won && navigator.vibrate) navigator.vibrate([60, 40, 120]);
}


// =========================
// MODO DE DESENVOLVIMENTO (?mock=<tela>)
// =========================

async function StartMock()
{
  const { BuildMock } = await import("./SemPiedade_mock.js");
  const m = BuildMock(MOCK, { MAP, Colors });

  if(!m)
  {
    console.warn(`[mock] tela desconhecida: ${MOCK}`);
    return;
  }

  currentPlayerId = params.get("id") || m.me;
  isHost = !!m.isHost;
  config = m.config || config;
  lobbyPlayers = m.lobbyPlayers || {};
  table = m.table || null;
  myCards = m.cards || [];
  myMission = m.mission || null;
  missionVisible = !!m.missionVisible;
  lastHandSize = myCards.length;
  lastConqueredBy = m.lastConqueredBy || null;
  mockFinal = m.final || null;

  currentGameState = null;
  ApplyGameState(m.state);

  if(m.state === "Playing")
  {
    Object.assign(ui, m.ui || {});
    Rerender();
  }

  if(m.toast) ShowToast(m.toast, true);

  if(m.paused)
  {
    isGamePaused = true;
    document.getElementById("pauseOverlay").classList.add("active");
  }
}
