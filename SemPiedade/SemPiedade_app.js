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
const currentPlayerId = params.get("id");


// =========================
// CONSTANTES
// =========================

const NEUTRAL = "neutral";

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
  { name: "Vermelho", hex: "#E5383B" },
  { name: "Azul", hex: "#2F6FD0" },
  { name: "Verde", hex: "#2FA84F" },
  { name: "Amarelo", hex: "#F2C230" },
  { name: "Roxo", hex: "#8E4EC6" },
  { name: "Laranja", hex: "#F07D1A" },
  { name: "Rosa", hex: "#EC5FA6" },
  { name: "Ciano", hex: "#22B8CF" }
];

// Símbolos próprios das cartas (GDD §1): desenho nosso, nada dos produtos de referência.
const SymbolIcons = {
  tanque: `<svg viewBox="0 0 48 48"><path d="M6 30h36a4 4 0 0 1 0 8H6a4 4 0 0 1 0-8zm6-10h18l4 8H10zm20 1 12-4v3l-11 4z"/></svg>`,
  aviao: `<svg viewBox="0 0 48 48"><path d="M44 21 28 19 20 5h-4l3 14-9 1-4-5H3l2 9-2 9h3l4-5 9 1-3 14h4l8-14 16-2c3 0 3-6 0-6z"/></svg>`,
  navio: `<svg viewBox="0 0 48 48"><path d="M4 30h40l-5 11H10zm8-5V16h9V8h6v8h9v9zM8 44c5 0 5-2 9-2s4 2 8 2 5-2 9-2 4 2 8 2v2H8z"/></svg>`,
  coringa: `<svg viewBox="0 0 48 48"><path d="m24 4 6 13 14 2-10 10 2 14-12-7-12 7 2-14L4 19l14-2z"/></svg>`
};

const SymbolNames = { tanque: "Tanque", aviao: "Avião", navio: "Navio", coringa: "Coringa" };


// =========================
// GRAFO DO MAPA (só pra listar opções; quem valida é o host)
// =========================

const TerritoryById = {};
const Neighbors = {};
const SeaEdges = new Set();

MAP.territories.forEach(t => { TerritoryById[t.id] = t; Neighbors[t.id] = []; });

function EdgeKey(a, b) { return a < b ? `${a}|${b}` : `${b}|${a}`; }

MAP.land.forEach(([a, b]) => { Neighbors[a].push(b); Neighbors[b].push(a); });
MAP.sea.forEach(([a, b]) => { Neighbors[a].push(b); Neighbors[b].push(a); SeaEdges.add(EdgeKey(a, b)); });


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
function OwnerColor(id) { const o = OwnerOf(id); return o === NEUTRAL ? (table.neutralColor || "#7B8494") : (Player(o) ? Player(o).color : "#7B8494"); }
function NameOfTerr(id) { return TerritoryById[id] ? TerritoryById[id].name : id; }

function IsAlly(ownerId)
{
  if(ownerId === NEUTRAL || !Me() || !Player(ownerId)) return false;
  return table.mode === "teams" && Player(ownerId).team === Me().team;
}

function MyTerritories() { return MAP.territories.map(t => t.id).filter(id => OwnerOf(id) === currentPlayerId); }

function InkOn(hex)
{
  if(!hex || hex.length < 7) return "#fff";
  const r = parseInt(hex.substr(1, 2), 16) / 255, g = parseInt(hex.substr(3, 2), 16) / 255, b = parseInt(hex.substr(5, 2), 16) / 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 0.6 ? "#1E2430" : "#fff";
}

function ArmyBadge(id, extra)
{
  const color = OwnerColor(id);
  const shown = Armies(id) + (extra || 0);
  return `<span class="armyBadge" style="background:${color};color:${InkOn(color)}">${shown}</span>`;
}

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


// =========================
// SCREEN SYSTEM
// =========================

function ShowScreen(screenId)
{
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById(screenId).classList.add("active");
}


// =========================
// START
// =========================

window.onload = function()
{
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

function ConfigChips(field, options)
{
  return `<div class="chipGroup">${options.map(o =>
    `<button class="chip ${config[field] === o.value ? "selected" : ""}" onclick="SetConfig('${field}', ${JSON.stringify(o.value).replace(/"/g, "'")})">${Esc(o.label)}</button>`
  ).join("")}</div>`;
}

function RenderColorGrid()
{
  const el = document.getElementById("colorGrid");
  if(!el) return;

  const mine = lobbyPlayers[currentPlayerId] ? lobbyPlayers[currentPlayerId].colorPick : null;
  const takenBy = {};

  Object.entries(lobbyPlayers).forEach(([id, p]) =>
  {
    if(id !== currentPlayerId && p && p.colorPick != null) takenBy[p.colorPick] = p.name;
  });

  el.innerHTML = Colors.map((c, i) =>
  {
    const taken = takenBy[i];
    const click = taken ? "" : ` onclick="SelectColor(${i})"`;
    return `<button class="colorItem ${mine === i ? "selected" : ""} ${taken ? "taken" : ""}" style="background:${c.hex};color:${InkOn(c.hex)}"${click}>${c.name}${taken ? `<small>${Esc(taken)}</small>` : ""}</button>`;
  }).join("");
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
  let html = `<p class="label" style="text-align:center">Escolha seu time</p>`;

  for(let t = 0; t < 2; t++)
  {
    const members = Object.entries(lobbyPlayers).filter(([, p]) => p && p.name && p.teamPick === t);
    const full = members.length >= count / 2 && mine !== t;
    const names = members.map(([, p]) => p.name).join(" + ") || "vaga livre";
    html += `<button class="teamItem ${mine === t ? "selected" : ""}" ${full ? "disabled" : `onclick="SelectTeam(${t})"`}><b>Time ${t + 1}</b> <small>${Esc(names)}</small></button>`;
  }

  el.innerHTML = html + `<p class="hint" style="text-align:center">Quem não escolher completa as vagas que sobrarem.</p>`;
}

window.SelectColor = async function(index)
{
  if(currentGameState !== "Lobby") return;

  const p = lobbyPlayers[currentPlayerId];
  const next = p && p.colorPick === index ? null : index; // tocar de novo = desmarcar

  await set(ref(db, `rooms/${currentRoomCode}/players/${currentPlayerId}/colorPick`), next);
};

window.SelectTeam = async function(team)
{
  if(currentGameState !== "Lobby") return;

  const p = lobbyPlayers[currentPlayerId];
  const next = p && p.teamPick === team ? null : team;

  await set(ref(db, `rooms/${currentRoomCode}/players/${currentPlayerId}/teamPick`), next);
};

function RenderLobby()
{
  const el = document.getElementById("lobbyConfig");
  if(!el) return;

  const count = Object.values(lobbyPlayers).filter(p => p && p.name).length;

  RenderColorGrid();
  RenderTeamPicker(count);

  const teamsProblem = config.mode === "teams" && ![4, 6, 8].includes(count);
  const warning = teamsProblem ? `<p class="warn">O modo em times precisa de 4, 6 ou 8 jogadores (agora: ${count}).</p>` : "";

  if(isHost)
  {
    el.innerHTML = `
      <div class="configRow"><p class="label">Modo</p>${ConfigChips("mode", [{ value: "solo", label: "Individual" }, { value: "teams", label: "Em times" }])}</div>
      <div class="configRow"><p class="label">Tempo por turno</p>${ConfigChips("turn", [{ value: 0, label: "Auto" }, { value: 60, label: "60 s" }, { value: 90, label: "90 s" }, { value: 120, label: "120 s" }])}</div>
      <div class="configRow"><p class="label">Limite de tempo</p>${ConfigChips("minutes", [{ value: 30, label: "30 min" }, { value: 45, label: "45 min" }, { value: 60, label: "60 min" }, { value: 0, label: "Sem" }])}</div>
      ${warning}`;
    return;
  }

  const mode = config.mode === "teams" ? "Em times" : "Individual";
  const time = config.minutes > 0 ? `${config.minutes} min` : "sem limite de tempo";
  const turn = config.turn > 0 ? `turno de ${config.turn} s` : "turno automático";

  el.innerHTML = `<p class="label">Partida</p><p><b>${mode}</b> · ${time} · ${turn}</p>${warning}`;
}

window.SetConfig = async function(field, value)
{
  if(!isHost || currentGameState !== "Lobby") return;
  await set(ref(db, `rooms/${currentRoomCode}/config/${field}`), value);
};


// =========================
// HOST CONTROLS
// =========================

async function CheckIfHost()
{
  const snapshot = await get(ref(db, `rooms/${currentRoomCode}/players/${currentPlayerId}/isHost`));
  isHost = snapshot.val() === true;
  UpdateHostButton(currentGameState);
  RenderLobby();
}

window.SendHostCommand = async function()
{
  await set(ref(db, `rooms/${currentRoomCode}/hostCommand`), Date.now());
};

window.SendTutorialAction = async function(action)
{
  await set(ref(db, `rooms/${currentRoomCode}/tutorialAction`), { action: action, t: Date.now() });
};

function UpdateHostButton(state)
{
  if(!isHost) return;

  const btn = document.getElementById("hostButton");

  // Playing: o host pode "pular" a decisão de quem está AFK (mesmo efeito do timeout).
  const labels = { "Lobby": "Começar Jogo", "Playing": "Pular decisão atual", "FinalScore": "Jogar de Novo" };
  const label = labels[state];

  btn.style.display = label ? "block" : "none";
  btn.classList.toggle("btnGhost", state === "Playing");
  if(label) btn.innerText = label;
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
  UpdateHostButton(gameState);

  if(gameState === "Lobby")
  {
    StopPlayingListeners();
    // Replay: os seriais do host recomeçam do zero.
    lastBattleSerial = 0;
    lastHandSize = null;
    wasFallback = false;
    ShowScreen("lobbyScreen");
    RenderLobby();
  }

  if(gameState === "Tutorial")
  {
    ShowScreen("tutorialScreen");
    document.getElementById("tutorialControls").style.display = isHost ? "flex" : "none";
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

  await set(ref(db, `rooms/${currentRoomCode}/actions/${currentPlayerId}`), Object.assign({ type: type, t: lastActionT }, extra || {}));
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
  mapCam = { x: 0, y: 0, w: MAP.width, h: MAP.height };
  ApplyMapCamera();
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

  const isFirstRead = lastBattleSerial === 0 && table.turnNumber > 1 && situationKey === null;
  lastBattleSerial = b.serial;
  if(isFirstRead) return;

  if(b.defenderId === currentPlayerId && navigator.vibrate) navigator.vibrate(b.conquered ? [120, 60, 120] : 40);
}

function RenderAll()
{
  if(!table) return;

  RenderMe();
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

  if(!myMission)
  {
    el.innerHTML = `<small>Sua missão secreta chega em instantes...</small>`;
    return;
  }

  if(!missionVisible)
  {
    el.innerHTML = `<small>Missão secreta</small><b>Toque pra ver</b>`;
    return;
  }

  const allies = AsList(myMission.allies).map(PlayerName).filter(Boolean);
  const note = myMission.fallback ? `<small>Seu alvo foi destruído por outro jogador.</small>` : "";
  const team = allies.length ? `<small>Missão do time, com ${Esc(allies.join(", "))}.</small>` : "";

  el.innerHTML = `<small>Missão secreta · toque pra esconder</small><b>${Esc(myMission.text)}</b>${note}${team}
    <div class="progressBar"><i style="width:${myMission.progress || 0}%"></i></div>
    <small>${myMission.progress || 0}% cumprida</small>`;
}


// =========================
// PAINEL DA FASE
// =========================

function RepeatPanelActive()
{
  const prompt = table.prompt || {};
  return !!prompt.againFrom && !ui.changeTarget;
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

    StartCountdown(mine ? (table.phaseDuration || 0) : 0);

    if(mine && navigator.vibrate && ["Reinforce", "Attack", "Move", "Conquest"].includes(phase)) navigator.vibrate(30);
  }

  // CHAVE: só reconstrói quando algo que aparece no painel muda.
  const key = [
    situation, table.actorId, JSON.stringify(ui), MyReserve(), table.truce,
    table.battle ? `${table.battle.serial}` : "",
    ui.from ? Armies(ui.from) : "", ui.to ? `${Armies(ui.to)}|${OwnerOf(ui.to)}` : "",
    mine ? JSON.stringify(table.territories) : "", myCards.length, Me() ? Me().alive : ""
  ].join("#");

  if(key === panelKey) return;
  panelKey = key;

  el.classList.toggle("mine", mine && ["Placement", "Reinforce", "Attack", "Conquest", "Move"].includes(phase));
  el.innerHTML = BuildPanelHTML(phase, prompt, mine);
  AnimateDice(el);

  // A lista de territórios vai sempre pra baixo do mapa.
  const choices = document.getElementById("choicePanel");
  choices.innerHTML = "";
  el.querySelectorAll(".choiceList").forEach(list => choices.appendChild(list));
  choices.classList.toggle("mine", el.classList.contains("mine"));
}

function BuildPanelHTML(phase, prompt, mine)
{
  const me = Me();

  if(me && !me.alive)
  {
    return `<div class="phaseTitle">Você foi eliminado</div>
      <p class="hint">Sem piedade mesmo. Agora é só torcer pra quem te derrubou se dar mal.</p>${BattleHTML()}`;
  }

  if(phase === "Placement") return mine && !ui.sentPlan ? PlanHTML(true, prompt) : `<div class="phaseTitle">Exércitos posicionados!</div><p class="hint">Esperando os outros...</p>`;

  if(phase === "Reinforce" && mine) return PlanHTML(false, prompt);
  if(phase === "Attack" && mine) return AttackHTML(prompt);
  if(phase === "Conquest" && mine) return ConquestHTML(prompt);
  if(phase === "Move" && mine) return MoveHTML();

  // ===== ESPECTADOR / DADOS =====
  const actor = PlayerName(table.actorId);

  const labels = {
    "Reinforce": `${actor} está reforçando`,
    "Attack": `${actor} escolhe quem atacar`,
    "Battle": `${actor} está atacando!`,
    "Conquest": `${actor} conquistou!`,
    "Move": `${actor} pode mover exércitos`
  };

  return `<div class="phaseTitle">${Esc(labels[phase] || "Olha a TV!")}</div>${BattleHTML()}`;
}

// ===== COLOCAÇÃO INICIAL E REFORÇO =====

function PlanHTML(initial, prompt)
{
  const total = ReserveForPlan();
  const left = total - PlanTotal();
  const title = initial ? "Posicione seus exércitos" : "Reforço";

  const steps = [{ v: 1, l: "+1" }, { v: 3, l: "+3" }, { v: 5, l: "+5" }, { v: 0, l: "Tudo" }]
    .map(s => `<button class="chip ${ui.step === s.v ? "selected" : ""}" onclick="SetStep(${s.v})">${s.l}</button>`).join("");

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
    const minus = planned ? `<button class="minus" onclick="event.stopPropagation();RemoveFromPlan('${id}')">−</button>` : "";
    const plus = planned ? `<span class="plus">+${planned}</span>` : "";

    return `<div class="choice ${planned ? "selected" : ""}" onclick="AddToPlan('${id}')">
      ${ArmyBadge(id)}<span class="grow"><b>${Esc(NameOfTerr(id))}</b><small>${frontier ? "fronteira" : "interior"}</small></span>${plus}${minus}</div>`;
  }).join("");

  const mustTrade = !!prompt.mustTrade;
  const warn = mustTrade ? `<p class="warn">Com 5 cartas, a troca é obrigatória: use as cartas abaixo primeiro.</p>` : "";
  const disabled = left > 0 || mustTrade || PlanTotal() === 0 ? "disabled" : "";

  return `<div class="phaseTitle">${title}</div>
    <p class="hint">Faltam <b>${left}</b> de ${total}. Toque nos territórios no mapa ou na lista abaixo dele.</p>${warn}
    <div class="chipGroup">${steps}</div>
    <div class="choiceList">${rows}</div>
    <button class="btn btnBig" ${disabled} onclick="ConfirmPlan()">Confirmar</button>
    ${PlanTotal() ? `<button class="btn btnGhost" onclick="ClearPlan()">Limpar</button>` : ""}`;
}

// ===== ATAQUE =====

function TerritoryRow(id, click, note, selected)
{
  return `<button class="choice ${selected ? "selected" : ""}" onclick="${click}">${ArmyBadge(id)}<span class="grow"><b>${Esc(NameOfTerr(id))}</b><small>${Esc(note || "")}</small></span></button>`;
}

function AttackHTML(prompt)
{
  const truce = table.truce ? `<p class="hint">Trégua na primeira rodada: só vale atacar neutros.</p>` : "";
  const stop = `<button class="btn btnGhost" onclick="EndAttack()">Parar de atacar</button>`;

  // ATACAR DE NOVO: mesma batalha, um toque só.
  if(RepeatPanelActive() && Armies(prompt.againFrom) >= 2)
  {
    return `<div class="phaseTitle">${Esc(NameOfTerr(prompt.againFrom))} → ${Esc(NameOfTerr(prompt.againTo))}</div>
      ${BattleHTML()}
      <p class="hint">${Armies(prompt.againFrom)} seus contra ${Armies(prompt.againTo)} deles.</p>
      ${DiceChips(prompt.againFrom)}
      <button class="btn btnBig btnDanger" onclick="DoAttack()">Atacar de novo</button>
      <button class="btn" onclick="DoBlitz()">Até o fim</button>
      <button class="btn btnGhost" onclick="ChangeTarget()">Mudar de alvo</button>
      ${stop}`;
  }

  if(!ui.from)
  {
    const origins = AttackOrigins().sort((a, b) => Armies(b) - Armies(a));

    return `<div class="phaseTitle">Atacar de onde?</div>${truce}
      <div class="choiceList">${origins.map(id => TerritoryRow(id, `PickFrom('${id}')`, `${AttackTargets(id).length} alvo(s)`)).join("")}</div>
      ${stop}`;
  }

  if(!ui.to)
  {
    const targets = AttackTargets(ui.from).sort((a, b) => Armies(a) - Armies(b));

    return `<div class="phaseTitle">${Esc(NameOfTerr(ui.from))} ataca quem?</div>
      <p class="hint">${Armies(ui.from)} exércitos aqui.</p>
      <div class="choiceList">${targets.map(id =>
      {
        const route = SeaEdges.has(EdgeKey(ui.from, id)) ? " · por mar" : "";
        return TerritoryRow(id, `PickTo('${id}')`, `${PlayerName(OwnerOf(id))}${route}`);
      }).join("")}</div>
      <button class="btn btnGhost" onclick="BackStep()">Voltar</button>`;
  }

  return `<div class="phaseTitle">${Esc(NameOfTerr(ui.from))} → ${Esc(NameOfTerr(ui.to))}</div>
    <p class="hint">${Armies(ui.from)} seus contra ${Armies(ui.to)} de ${Esc(PlayerName(OwnerOf(ui.to)))}.</p>
    ${DiceChips(ui.from)}
    <button class="btn btnBig btnDanger" onclick="DoAttack()">Atacar!</button>
    <button class="btn" onclick="DoBlitz()">Até o fim</button>
    <button class="btn btnGhost" onclick="BackStep()">Voltar</button>`;
}

function DiceChips(from)
{
  const max = MaxDice(from);
  const dice = Math.min(ui.dice, max);
  const chips = [];

  for(let d = 1; d <= max; d++) chips.push(`<button class="chip ${dice === d ? "selected" : ""}" onclick="SetDice(${d})">${d} ${d === 1 ? "dado" : "dados"}</button>`);

  return `<div class="chipGroup">${chips.join("")}</div>`;
}

// ===== CONQUISTA =====

function ConquestHTML(prompt)
{
  const min = prompt.min;
  const max = prompt.max;
  const half = Math.max(min, Math.ceil((min + max) / 2));
  const count = Math.max(min, Math.min(max, ui.count));

  return `<div class="phaseTitle">${Esc(NameOfTerr(prompt.to))} é sua!</div>
    <p class="hint">Quantos exércitos entram? Pelo menos ${min}; o resto fica em ${Esc(NameOfTerr(prompt.from))}.</p>
    <div class="stepper">
      <button onclick="SetCount(${count - 1})" ${count <= min ? "disabled" : ""}>−</button>
      <span>${count}</span>
      <button onclick="SetCount(${count + 1})" ${count >= max ? "disabled" : ""}>+</button>
    </div>
    <div class="chipGroup">
      <button class="chip" onclick="SetCount(${min})">Mínimo</button>
      <button class="chip" onclick="SetCount(${half})">Metade</button>
      <button class="chip" onclick="SetCount(${max})">Tudo</button>
    </div>
    <button class="btn btnBig" onclick="ConfirmConquest(${count})">Mover ${count}</button>`;
}

// ===== MOVIMENTO =====

function MoveHTML()
{
  const end = `<button class="btn btnGhost" onclick="EndTurn()">Terminar o turno</button>`;

  if(!ui.from)
  {
    const origins = MoveOrigins().sort((a, b) => Armies(b) - Armies(a));

    return `<div class="phaseTitle">Mover exércitos?</div>
      <p class="hint">Uma movimentação, entre territórios seus conectados.</p>
      <div class="choiceList">${origins.map(id => TerritoryRow(id, `PickFrom('${id}')`, `${ReachableFrom(id).length} destino(s)`)).join("")}</div>
      ${end}`;
  }

  if(!ui.to)
  {
    const targets = ReachableFrom(ui.from).sort((a, b) => Armies(a) - Armies(b));

    return `<div class="phaseTitle">Mover de ${Esc(NameOfTerr(ui.from))} para onde?</div>
      <div class="choiceList">${targets.map(id => TerritoryRow(id, `PickTo('${id}')`, "")).join("")}</div>
      <button class="btn btnGhost" onclick="BackStep()">Voltar</button>`;
  }

  const max = Armies(ui.from) - 1;
  const count = Math.max(1, Math.min(max, ui.count));

  return `<div class="phaseTitle">${Esc(NameOfTerr(ui.from))} → ${Esc(NameOfTerr(ui.to))}</div>
    <div class="stepper">
      <button onclick="SetCount(${count - 1})" ${count <= 1 ? "disabled" : ""}>−</button>
      <span>${count}</span>
      <button onclick="SetCount(${count + 1})" ${count >= max ? "disabled" : ""}>+</button>
    </div>
    <button class="btn btnBig" onclick="DoMove()">Mover ${count}</button>
    <button class="btn btnGhost" onclick="BackStep()">Voltar</button>`;
}


// =========================
// DADOS
// =========================

const PipPatterns = [[], [4], [0, 8], [0, 4, 8], [0, 2, 6, 8], [0, 2, 4, 6, 8], [0, 2, 3, 5, 6, 8]];

function DieFaceHTML(value)
{
  return Array.from({ length: 9 }, (_, i) => `<i class="${(PipPatterns[value] || []).includes(i) ? "pip" : ""}"></i>`).join("");
}

function BattleHTML()
{
  const b = table.battle;
  if(!b || b.attackerId !== table.currentTurnPlayerId) return "";

  const dice = (values) => AsList(values).map(v => `<span class="die" data-final="${v}">${DieFaceHTML(v)}</span>`).join("");
  const extra = b.rolls > 1 ? ` em ${b.rolls} rolagens` : "";

  const result = b.conquered
    ? `<p class="battleResult win">Conquistou! Ataque −${b.totalAttLoss}, defesa −${b.totalDefLoss}${extra}</p>`
    : `<p class="battleResult">Ataque −${b.totalAttLoss}, defesa −${b.totalDefLoss}${extra}</p>`;

  return `<div class="battleBox" data-serial="${b.serial}">
      <div class="diceGroup"><small>${Esc(NameOfTerr(b.from))}</small><div class="diceRow">${dice(b.att)}</div></div>
      <span class="versus">x</span>
      <div class="diceGroup"><small>${Esc(NameOfTerr(b.to))}</small><div class="diceRow">${dice(b.def)}</div></div>
    </div>${result}`;
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

function RenderCards()
{
  const el = document.getElementById("cardsPanel");
  const canTrade = table.phase === "Reinforce" && IsMyAction();

  const key = [canTrade, JSON.stringify(myCards), ui.picked.join(","), table.nextTradeValue, canTrade ? MyTerritories().join(",") : "", cardsHelpVisible].join("#");
  if(key === cardsKey) return;
  cardsKey = key;

  const header = `<div class="cardsHeader">
      <p class="label">Suas cartas · próxima troca +${table.nextTradeValue || 0}</p>
      <button class="helpButton ${cardsHelpVisible ? "open" : ""}" onclick="ToggleCardsHelp()" aria-label="Como funcionam as cartas">?</button>
    </div>${cardsHelpVisible ? CardsHelpHTML() : ""}`;

  if(!myCards.length)
  {
    el.innerHTML = `${header}<div class="cardsEmpty">Sem cartas. Conquiste território pra ganhar (até 2 por turno).</div>`;
    return;
  }

  const cards = myCards.map(c =>
  {
    const picked = ui.picked.includes(c.id);
    const wild = c.symbol === "coringa";
    const mine = CardIsMine(c) ? `<small>+2 aqui</small>` : "";
    const click = canTrade ? ` onclick="ToggleCard('${c.id}')"` : "";

    return `<button class="gameCard ${canTrade ? "pickable" : ""} ${picked ? "selected" : ""} ${wild ? "wild" : ""}"${click}>
      ${SymbolIcons[c.symbol] || ""}<b>${Esc(wild ? SymbolNames.coringa : c.name)}</b>${wild ? "" : `<small style="color:var(--muted)">${SymbolNames[c.symbol] || ""}</small>`}${mine}</button>`;
  }).join("");

  let controls = "";

  if(canTrade)
  {
    const picked = ui.picked.map(id => myCards.find(c => c.id === id)).filter(Boolean);
    const valid = IsValidSet(picked);
    const hasSet = BestSet() !== null;

    if(hasSet || picked.length)
    {
      controls = `<div class="row">
        <button class="btn btnGhost" ${hasSet ? "" : "disabled"} onclick="PickBestSet()">Melhor trinca</button>
        <button class="btn" ${valid ? "" : "disabled"} onclick="TradeCards()">Trocar +${table.nextTradeValue}</button>
      </div>`;
    }
    else
    {
      controls = `<p class="hint">Ainda sem trinca: 3 iguais, 3 diferentes ou 2 + coringa.</p>`;
    }
  }

  el.innerHTML = `${header}<div class="handRow">${cards}</div>${controls}`;
}


// =========================
// MAPA (SVG, mesmo arquivo de dados do telão)
// =========================

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

  let svg = `<svg viewBox="0 0 ${MAP.width} ${MAP.height}" xmlns="http://www.w3.org/2000/svg">`;

  MAP.decor.forEach(d => { svg += `<path d="${d.rings.map(RingPath).join("")}" fill="#4A5261" fill-rule="evenodd"/>`; });

  MAP.territories.forEach(t =>
  {
    svg += `<g class="terrGroup" id="g_${t.id}" onclick="TapTerritory('${t.id}')"><path id="p_${t.id}" class="terr" d="${t.rings.map(RingPath).join("")}" fill="#7B8494" fill-rule="evenodd"/></g>`;
  });

  const pos = {};
  MAP.territories.forEach(t => { pos[t.id] = t; });

  MAP.links.forEach(l =>
  {
    const a = pos[l.a];
    const b = pos[l.b];
    const cls = l.sea ? "routeLine" : "routeSolid";

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

  MAP.territories.forEach(t =>
  {
    svg += `<g onclick="TapTerritory('${t.id}')"><circle id="c_${t.id}" class="chipCircle" cx="${t.x}" cy="${t.y}" r="21" fill="#7B8494"/><text id="n_${t.id}" class="chipText" x="${t.x}" y="${t.y}"></text></g>`;
  });

  document.getElementById("mapView").innerHTML = svg + "</svg>";

  SetupMapCamera();
  ApplyMapCamera();
}

// ===== CÂMERA DO MAPA: arrastar pra mover, scroll/pinça pra zoom =====

const MAP_MAX_ZOOM = 6;
const MAP_DRAG_THRESHOLD = 6;

let mapCam = { x: 0, y: 0, w: MAP.width, h: MAP.height };
const mapPointers = new Map();
let mapMoved = false;
let mapSuppressClick = false;

function MapSvg() { return document.querySelector("#mapView svg"); }

function ApplyMapCamera()
{
  const svg = MapSvg();
  if(!svg) return;

  const c = mapCam;
  c.w = Math.min(MAP.width, Math.max(MAP.width / MAP_MAX_ZOOM, c.w));
  c.h = c.w * MAP.height / MAP.width;
  c.x = Math.min(MAP.width - c.w, Math.max(0, c.x));
  c.y = Math.min(MAP.height - c.h, Math.max(0, c.y));

  svg.setAttribute("viewBox", `${c.x} ${c.y} ${c.w} ${c.h}`);
  document.getElementById("zoomButton").style.visibility = c.w < MAP.width - 0.5 ? "visible" : "hidden";
}

// Zoom mantendo fixo o ponto do mapa que está sob (clientX, clientY).
function ZoomMapAt(clientX, clientY, factor)
{
  const rect = MapSvg().getBoundingClientRect();
  const fx = (clientX - rect.left) / rect.width;
  const fy = (clientY - rect.top) / rect.height;
  const px = mapCam.x + fx * mapCam.w;
  const py = mapCam.y + fy * mapCam.h;

  const w = Math.min(MAP.width, Math.max(MAP.width / MAP_MAX_ZOOM, mapCam.w / factor));
  const h = w * MAP.height / MAP.width;

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

function RenderMap()
{
  BuildMap();

  const picks = MapPicks();
  const choosing = picks.size > 0;

  MAP.territories.forEach(t =>
  {
    const id = t.id;
    const color = OwnerColor(id);
    const armies = Armies(id) + (ui.plan[id] || 0);

    const path = document.getElementById(`p_${id}`);
    const circle = document.getElementById(`c_${id}`);
    const text = document.getElementById(`n_${id}`);
    const group = document.getElementById(`g_${id}`);

    if(path.getAttribute("fill") !== color)
    {
      path.setAttribute("fill", color);
      circle.setAttribute("fill", color);
      text.setAttribute("fill", InkOn(color));
    }

    const label = String(armies);
    if(text.textContent !== label) text.textContent = label;

    group.classList.toggle("pick", picks.has(id));
    group.classList.toggle("dim", choosing && !picks.has(id) && id !== ui.from);
    group.classList.toggle("chosen", id === ui.from);
    group.classList.toggle("target", id === ui.to);
  });
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
  const snapshot = await get(ref(db, `rooms/${currentRoomCode}/currentState/final`));
  const final = snapshot.val();
  if(!final) return;

  const winners = AsList(final.winnerIds);
  const names = AsList(final.winnerNames);
  const won = winners.includes(currentPlayerId);

  document.getElementById("finalWinner").innerText = won
    ? "Você venceu!"
    : `${names.join(" & ")} ${names.length > 1 ? "venceram" : "venceu"}!`;

  const ranking = AsList(final.ranking);
  const winnerRow = ranking.find(r => winners.includes(r.id));

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
    const status = r.alive ? `${r.territories} territórios` : "eliminado";

    return `<div class="rankRow ${r.id === currentPlayerId ? "me" : ""}"><span class="rankPos">${i + 1}</span><span class="dot" style="background:${r.color}"></span>
      <span class="rankName">${Esc(r.name)}<small>${Esc(r.mission)}</small><small>${status}${team}</small></span><span class="rankScore">${r.progress}%</span></div>`;
  }).join("");

  if(won && navigator.vibrate) navigator.vibrate([60, 40, 120]);
}
