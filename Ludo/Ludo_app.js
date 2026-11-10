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

const Powers = {
  Escudo: { name: "Escudo", text: "Um peão seu fica imune a captura até o seu próximo turno." },
  DadoDuplo: { name: "Dado duplo", text: "Role 2 dados e escolha qual usar." },
  Turbo: { name: "Turbo", text: "Depois de rolar: some +3 ao dado." },
  Empurrao: { name: "Empurrão", text: "Empurre um adversário a até 6 casas 3 casas pra trás." },
  Atalho: { name: "Atalho", text: "No lugar de rolar: vá direto à próxima estrela." },
  Troca: { name: "Troca", text: "No lugar de rolar: troque de lugar com um adversário." },
  Liberdade: { name: "Liberdade", text: "Tire um peão da base sem precisar de 1 ou 6." },
  NaoValeu: { name: "Não valeu!", text: "Depois de qualquer rolagem: obrigue a rolar de novo." }
};

const RejectedReasonLabels = {
  "not-now": "Agora não é hora disso.",
  "no-card": "Você não tem esse poder.",
  "invalid-target": "Esse alvo não vale mais.",
  "already-active": "Esse poder já está ativo."
};

// Mesma ordem de LudoTheme.PlayerColorNames/Hex (GDD §2).
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

const TrackSize = 48;
const LastTrackStep = 47;
const FinishSteps = 53;


// =========================
// ESTADO
// =========================

let currentGameState = "Lobby";
let isHost = false;
let isGamePaused = false;

let table = null;    // currentState/table (público)
let powers = [];     // players/{eu}/powers (privado)
let config = { mode: "solo", pieces: 0, minutes: 30 };
let lobbyPlayers = {};

let lastActionT = 0;
let panelKey = null;
let handKey = null;
let situationKey = null;
let selection = null; // poder em uso: { power, piece } — escolhendo o alvo
let seenPowerCount = null;
let lastCaptureSerial = 0;
let rejectedTimeout = null;
let toastBusyUntil = 0;

let countdownInterval = null;
let countdownRemaining = 0;

let unsubscribers = [];


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
function PlayerName(id) { const p = Player(id); return p ? p.name : ""; }
function IsMyAction() { return table && table.actorId === currentPlayerId; }
function Pieces(id) { const p = Player(id); return p ? AsList(p.pieces) : []; }

function InkOn(hex)
{
  if(!hex || hex.length < 7) return "#fff";
  const r = parseInt(hex.substr(1, 2), 16) / 255, g = parseInt(hex.substr(3, 2), 16) / 255, b = parseInt(hex.substr(5, 2), 16) / 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 0.6 ? "#1E2430" : "#fff";
}

function PawnBadge(playerId, piece)
{
  const color = Player(playerId) ? Player(playerId).color : "#888";
  return `<span class="pawnBadge" style="background:${color};color:${InkOn(color)}">${piece + 1}</span>`;
}

function PieceWhere(playerId, piece)
{
  const p = Pieces(playerId)[piece];
  if(!p) return "";
  if(p.state === "base") return "na base";
  if(p.state === "done") return "na Chegada";
  if(p.state === "home") return "na reta final";
  return `faltam ${FinishSteps - p.stepsTaken} casas`;
}

// Avisos em fila: "capturaram seu peão" e "novo poder" chegam quase juntos.
function ShowToast(text, good)
{
  const duration = 2000;
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

function AutoPieces(count) { return count >= 6 ? 2 : 3; }

function ConfigChips(field, options)
{
  return `<div class="chipGroup">${options.map(o =>
    `<button class="chip ${config[field] === o.value ? "selected" : ""}" onclick="SetConfig('${field}', ${JSON.stringify(o.value).replace(/"/g, "'")})">${Esc(o.label)}</button>`
  ).join("")}</div>`;
}

// Mesmo esquema do avatar do ColorsIn: grava a escolha; as já tomadas ficam travadas.
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
  let html = `<p class="label" style="text-align:center">Escolha sua dupla</p>`;

  for(let t = 0; t < count / 2; t++)
  {
    const members = Object.entries(lobbyPlayers).filter(([, p]) => p && p.name && p.teamPick === t);
    const full = members.length >= 2 && mine !== t;
    const names = members.map(([, p]) => p.name).join(" + ") || "vaga livre";
    html += `<button class="teamItem ${mine === t ? "selected" : ""}" ${full ? "disabled" : `onclick="SelectTeam(${t})"`}><b>Dupla ${t + 1}</b> <small>${Esc(names)}</small></button>`;
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

  const autoLabel = `Auto (${AutoPieces(count)})`;
  const teamsProblem = config.mode === "teams" && ![4, 6, 8].includes(count);

  const warning = teamsProblem ? `<p class="warn">O modo Duplas precisa de 4, 6 ou 8 jogadores (agora: ${count}).</p>` : "";

  if(isHost)
  {
    el.innerHTML = `
      <div class="configRow"><p class="label">Modo</p>${ConfigChips("mode", [{ value: "solo", label: "Individual" }, { value: "teams", label: "Duplas" }])}</div>
      <div class="configRow"><p class="label">Peões por jogador</p>${ConfigChips("pieces", [{ value: 0, label: autoLabel }, { value: 2, label: "2" }, { value: 3, label: "3" }, { value: 4, label: "4" }])}</div>
      <div class="configRow"><p class="label">Limite de tempo</p>${ConfigChips("minutes", [{ value: 20, label: "20 min" }, { value: 30, label: "30 min" }, { value: 45, label: "45 min" }, { value: 0, label: "Sem" }])}</div>
      ${warning}`;
    return;
  }

  const mode = config.mode === "teams" ? "Duplas" : "Individual";
  const pieces = config.pieces >= 2 ? config.pieces : AutoPieces(count);
  const time = config.minutes > 0 ? `${config.minutes} min` : "sem limite de tempo";

  el.innerHTML = `<p class="label">Partida</p><p><b>${mode}</b> · ${pieces} peões · ${time}</p>${warning}`;
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
    console.log("[Ludo] Aba voltou ao foco — ressincronizando.");
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
    lastCaptureSerial = 0;
    lastAnimatedRollSerial = null;
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
// AÇÕES (caixa própria — ver LudoGameManager.HandleActionsChanged)
// =========================

async function SendAction(type, extra)
{
  if(isGamePaused) return;

  // t estritamente crescente: o host descarta ações com t <= a última vista.
  lastActionT = Math.max(Date.now(), lastActionT + 1);

  await set(ref(db, `rooms/${currentRoomCode}/actions/${currentPlayerId}`), Object.assign({ type: type, t: lastActionT }, extra || {}));
}

window.Act = function(type) { selection = null; SendAction(type); };
window.MovePiece = function(piece) { SendAction("move", { piece: piece }); };
window.PickDie = function(die) { SendAction("pickDie", { die: die }); };

// Toque na carta: reação/efeito imediato ou abre a lista de alvos no painel.
window.TapPower = function(power)
{
  const prompt = (table && table.prompt) || {};

  if(table.phase === "RerollWindow")
  {
    if(power === "NaoValeu") SendAction("reroll");
    return;
  }

  if(table.phase === "Choosing" && IsMyAction())
  {
    if(power === "Turbo" && prompt.canTurbo) SendAction("turbo");
    return;
  }

  if(table.phase !== "Roll" || !IsMyAction() || !PowerReady(power, prompt)) return;

  if(power === "DadoDuplo" || power === "Liberdade")
  {
    selection = null;
    SendAction("power", { power: power });
    return;
  }

  selection = selection && selection.power === power ? null : { power: power, piece: null };
  panelKey = null;
  handKey = null;
  RenderAll();
};

window.CancelPower = function()
{
  selection = null;
  panelKey = null;
  handKey = null;
  RenderAll();
};

window.PickOwnPiece = function(piece)
{
  if(!selection) return;

  if(selection.power === "Troca")
  {
    selection.piece = piece;
    panelKey = null;
    RenderAll();
    return;
  }

  const power = selection.power;
  selection = null;
  SendAction("power", { power: power, piece: piece });
};

window.PickTarget = function(playerId, piece)
{
  if(!selection) return;

  const extra = { power: selection.power, targetId: playerId, targetPiece: piece };
  if(selection.piece != null) extra.piece = selection.piece;

  selection = null;
  SendAction("power", extra);
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
  handKey = null;
  situationKey = null;
  selection = null;
  seenPowerCount = null;

  const me = `rooms/${currentRoomCode}/players/${currentPlayerId}`;

  unsubscribers.push(onValue(ref(db, `rooms/${currentRoomCode}/currentState/table`), (snapshot) =>
  {
    if(!snapshot.exists()) return;
    table = snapshot.val();
    TrackCapture();
    RenderAll();
  }));

  unsubscribers.push(onValue(ref(db, `${me}/powers`), (snapshot) =>
  {
    const next = AsList(snapshot.val());

    if(seenPowerCount !== null && next.length > seenPowerCount)
    {
      const fresh = next[next.length - 1];
      ShowToast(`Novo poder: ${Powers[fresh] ? Powers[fresh].name : fresh}!`, true);
      if(navigator.vibrate) navigator.vibrate([40, 30, 40]);
    }

    seenPowerCount = next.length;
    powers = next;
    handKey = null;
    RenderAll();
  }));

  unsubscribers.push(onValue(ref(db, `rooms/${currentRoomCode}/currentState/actionRejected`), (snapshot) =>
  {
    if(!snapshot.exists()) return;
    const data = snapshot.val();
    if(data.playerId !== currentPlayerId || data.t < Date.now() - 10000) return;
    ShowToast(RejectedReasonLabels[data.reason] || "Ação inválida.");
  }));
}

function TrackCapture()
{
  const c = table.capture;
  if(!c || c.serial === lastCaptureSerial) return;

  const isFirstRead = lastCaptureSerial === 0 && table.turnNumber > 1 && situationKey === null;
  lastCaptureSerial = c.serial;
  if(isFirstRead) return;

  if(AsList(c.victims).includes(currentPlayerId))
  {
    ShowToast(`${PlayerName(c.by)} capturou seu peão!`);
    if(navigator.vibrate) navigator.vibrate([120, 60, 120]);
  }
}

function RenderAll()
{
  if(!table) return;

  RenderMe();
  RenderActionPanel();
  RenderHand();
  RenderBoard();
  RenderMiniLog();
}


// =========================
// MEU STATUS
// =========================

function RenderMe()
{
  const me = Me();
  if(!me) return;

  document.getElementById("meDot").style.background = me.color;
  document.getElementById("meName").innerText = `${me.name} · ${me.colorName}`;

  const parts = [`${me.done}/${table.piecesPerPlayer} na Chegada`];
  if(me.partnerId) parts.push(`dupla com ${PlayerName(me.partnerId)}`);
  document.getElementById("meSub").innerText = parts.join(" · ");
}


// =========================
// PAINEL DA FASE
// =========================

function RenderActionPanel()
{
  const el = document.getElementById("actionPanel");
  const phase = table.phase;
  const prompt = table.prompt || {};
  const mine = IsMyAction();

  // CHAVE: só reconstrói quando a "situação" muda.
  const key = [
    phase, table.actorId, table.turnNumber, JSON.stringify(prompt),
    table.lastRoll ? `${table.lastRoll.serial}|${table.lastRoll.total}|${table.lastRoll.voided}` : "",
    selection ? `${selection.power}|${selection.piece}` : ""
  ].join("#");

  if(key === panelKey) return;
  panelKey = key;

  const situation = [phase, table.actorId, table.turnNumber, prompt.type, table.lastRoll ? table.lastRoll.serial : "", prompt.value].join("#");

  if(situation !== situationKey)
  {
    situationKey = situation;
    selection = null;
    StartCountdown(mine || phase === "RerollWindow" ? (table.phaseDuration || 0) : 0);
  }

  el.classList.toggle("mine", mine && ["Roll", "PickDie", "Choosing"].includes(phase));
  el.innerHTML = BuildPanelHTML(phase, prompt, mine);
  AnimateDice(el);

  if(mine && navigator.vibrate && (phase === "Roll" || phase === "Choosing")) navigator.vibrate(30);
}

function BuildPanelHTML(phase, prompt, mine)
{
  const actor = PlayerName(table.actorId);
  const roll = table.lastRoll;

  if(phase === "Roll" && mine)
  {
    if(selection) return SelectionHTML(prompt);

    const moverNote = prompt.moverId && prompt.moverId !== currentPlayerId
      ? `<p class="hint">Seus peões já chegaram: agora você move os de ${Esc(PlayerName(prompt.moverId))}.</p>` : "";

    return `<div class="phaseTitle">${prompt.again ? "Joga de novo!" : "Sua vez!"}</div>${moverNote}
      ${prompt.duploActive ? `<p class="hint">Dado duplo ativo: você vai rolar 2 dados.</p>` : ""}
      <button class="btn btnRoll" onclick="Act('roll')">Rolar dado</button>
      <p class="hint">Se quiser usar um poder, toque nele antes de rolar.</p>`;
  }

  if(phase === "PickDie" && mine)
  {
    const dice = AsList(prompt.dice);
    return `<div class="phaseTitle">Qual dado você quer usar?</div>
      <div class="diceRow">${dice.map((v, i) => `<button class="die" onclick="PickDie(${i})">${DieFaceHTML(v)}</button>`).join("")}</div>`;
  }

  if(phase === "Choosing" && mine) return ChoosingHTML(prompt);

  // ===== ESPECTADOR / DADO NA TELA =====
  const rollHTML = roll ? DiceHTML(roll) : "";

  if(phase === "RerollWindow")
  {
    const iHave = powers.includes("NaoValeu");
    return `<div class="phaseTitle">${Esc(PlayerName(roll && roll.rollerId))} rolou</div>${rollHTML}
      ${iHave ? `<button class="btn btnDanger" onclick="TapPower('NaoValeu')">Não valeu!</button>` : `<p class="hint">Alguém vai dizer "Não valeu!"?</p>`}`;
  }

  const labels = {
    "Roll": `${actor} vai rolar o dado`,
    "PickDie": `${actor} escolhe um dos dados`,
    "Choosing": `${actor} escolhe o peão`,
    "Moving": `${actor} está andando...`
  };

  return `<div class="phaseTitle">${labels[phase] || "Olha a TV!"}</div>${rollHTML}`;
}

function ChoosingHTML(prompt)
{
  const moves = AsList(prompt.moves);
  const mover = prompt.moverId;
  const pieces = Pieces(mover);

  let html = `<div class="phaseTitle">Escolha o peão</div>${table.lastRoll ? DiceHTML(table.lastRoll) : ""}`;

  if(prompt.forcedBlockade) html += `<p class="warn">Seu bloqueio já ficou parado demais: é obrigado a desfazer.</p>`;
  if(!moves.length) html += `<p class="hint">Sem movimento com esse dado... mas o Turbo pode salvar.</p>`;

  moves.forEach(m =>
  {
    // Peões na mesma casa dão no mesmo: mostra só o primeiro deles.
    const piece = pieces.findIndex(p => StepsOf(p) === m.from);
    const note = m.exit ? "sai da base" : (m.finish ? "entra na Chegada!" : (m.capture ? "CAPTURA!" : `${m.to - m.from} casas · ${PieceWhere(mover, piece)}`));
    html += `<button class="choice ${m.capture ? "capture" : ""} ${m.finish ? "finish" : ""}" onclick="MovePiece(${piece})">${PawnBadge(mover, piece)}<span><b>Peão ${piece + 1}</b><small>${Esc(note)}</small></span></button>`;
  });

  if(prompt.canTurbo) html += `<button class="btn" onclick="TapPower('Turbo')">Usar Turbo (+3)</button>`;

  return html;
}

function StepsOf(p) { return p.state === "base" ? -1 : p.stepsTaken; }

// LISTA DE ALVOS do poder escolhido.
function SelectionHTML(prompt)
{
  const t = prompt.targets || {};
  const power = selection.power;
  const mover = prompt.moverId;
  const title = `<div class="phaseTitle">${Esc(Powers[power].name)}</div>`;
  const cancel = `<button class="btn btnGhost" onclick="CancelPower()">Cancelar</button>`;

  const ownList = (list, hint) => `<p class="hint">${hint}</p>` + AsList(list).map(k =>
    `<button class="choice" onclick="PickOwnPiece(${k})">${PawnBadge(mover, k)}<span><b>Peão ${k + 1}</b><small>${Esc(PieceWhere(mover, k))}</small></span></button>`).join("");

  const targetList = (list, hint) => `<p class="hint">${hint}</p>` + AsList(list).map(x =>
    `<button class="choice" onclick="PickTarget('${x.playerId}', ${x.piece})">${PawnBadge(x.playerId, x.piece)}<span><b>${Esc(PlayerName(x.playerId))}</b><small>Peão ${x.piece + 1} · ${Esc(PieceWhere(x.playerId, x.piece))}</small></span></button>`).join("");

  if(power === "Escudo") return title + ownList(t.escudo, "Qual peão vai ficar imune?") + cancel;
  if(power === "Atalho") return title + ownList(t.atalho, "Qual peão vai pra próxima estrela? (substitui a rolagem)") + cancel;
  if(power === "Empurrao") return title + targetList(t.empurrao, "Qual peão vai 3 casas pra trás?") + cancel;

  if(power === "Troca")
  {
    const all = AsList(t.troca);

    if(selection.piece == null)
    {
      const own = [...new Set(all.map(x => x.ownerPiece))];
      return title + ownList(own, "Qual peão seu vai trocar de lugar? (substitui a rolagem)") + cancel;
    }

    return title + targetList(all.filter(x => x.ownerPiece === selection.piece), `Trocar o peão ${selection.piece + 1} com qual adversário?`) + cancel;
  }

  return title + cancel;
}


// =========================
// DADOS (mesma animação do Landlords)
// =========================

const PipPatterns = [[], [4], [0, 8], [0, 4, 8], [0, 2, 6, 8], [0, 2, 4, 6, 8], [0, 2, 3, 5, 6, 8]];

function DieFaceHTML(value)
{
  return Array.from({ length: 9 }, (_, i) => `<i class="${(PipPatterns[value] || []).includes(i) ? "pip" : ""}"></i>`).join("");
}

function DiceHTML(roll)
{
  const values = AsList(roll && roll.values);
  if(!values.length) return "";

  let total = roll.total > 0 ? String(roll.total) : values.join(" ou ");
  if(roll.bonus > 0) total = `${roll.total - roll.bonus} + ${roll.bonus} = ${roll.total}`;
  if(roll.voided) total = "três 6! anulada";

  const faces = values.map(v => `<span class="die" data-final="${v}">${DieFaceHTML(v)}</span>`).join("");
  return `<div class="diceRow" data-serial="${roll.serial || 0}">${faces}<span class="diceTotal">${Esc(total)}</span></div>`;
}

let lastAnimatedRollSerial = null;

function AnimateDice(container)
{
  const row = container.querySelector(".diceRow[data-serial]");
  if(!row) return;

  const serial = row.dataset.serial;
  if(serial === lastAnimatedRollSerial) return;
  lastAnimatedRollSerial = serial;

  const dice = Array.from(row.querySelectorAll(".die[data-final]"));
  const total = row.querySelector(".diceTotal");

  row.classList.add("rolling");

  dice.forEach((die, i) =>
  {
    const swap = setInterval(() => { die.innerHTML = DieFaceHTML(1 + Math.floor(Math.random() * 6)); }, 70);

    setTimeout(() =>
    {
      clearInterval(swap);
      die.innerHTML = DieFaceHTML(parseInt(die.dataset.final, 10));
      die.classList.add("landed");

      if(i === dice.length - 1)
      {
        row.classList.remove("rolling");
        if(navigator.vibrate) navigator.vibrate(30);
      }
    }, 750 + i * 120);
  });

  if(total) total.style.animationDelay = `${750 + (dice.length - 1) * 120}ms`;
}


// =========================
// MÃO DE PODERES
// =========================

function PowerReady(power, prompt)
{
  const t = (prompt && prompt.targets) || {};

  switch(power)
  {
    case "Escudo": return AsList(t.escudo).length > 0;
    case "DadoDuplo": return !prompt.duploActive;
    case "Empurrao": return AsList(t.empurrao).length > 0;
    case "Atalho": return AsList(t.atalho).length > 0;
    case "Troca": return AsList(t.troca).length > 0;
    case "Liberdade": return t.liberdade != null && t.liberdade >= 0;
    default: return false;
  }
}

function RenderHand()
{
  const el = document.getElementById("powerHand");
  const prompt = table.prompt || {};
  const mine = IsMyAction();

  const key = [table.phase, mine, JSON.stringify(prompt.targets || null), prompt.canTurbo, prompt.duploActive, powers.join(","), selection ? selection.power : ""].join("#");
  if(key === handKey) return;
  handKey = key;

  if(!powers.length)
  {
    el.innerHTML = `<div class="powerEmpty">Sem poderes na mão. Capturar ou ser capturado te dá um!</div>`;
    return;
  }

  el.innerHTML = powers.map(power =>
  {
    const info = Powers[power] || { name: power, text: "" };
    let cls = "";

    if(table.phase === "RerollWindow" && power === "NaoValeu") cls = "reaction";
    else if(table.phase === "Choosing" && mine && power === "Turbo" && prompt.canTurbo) cls = "ready";
    else if(table.phase === "Roll" && mine && PowerReady(power, prompt)) cls = "ready";

    if(selection && selection.power === power) cls += " selected";

    return `<button class="powerCard ${cls}" onclick="TapPower('${power}')"><b>${Esc(info.name)}</b><small>${Esc(info.text)}</small></button>`;
  }).join("");
}


// =========================
// TABULEIRO (SVG, mesma geometria do LudoGameManager.UI)
// =========================

function Polar(cell, radius)
{
  const angle = (90 - cell * 360 / TrackSize) * Math.PI / 180;
  return { x: 50 + Math.cos(angle) * radius, y: 50 - Math.sin(angle) * radius };
}

function RenderBoard()
{
  const el = document.getElementById("boardView");
  if(!el || !table.players) return;

  const R = 45;
  const finishR = R * 0.2;
  const homeStep = (R - finishR) / (FinishSteps - LastTrackStep);
  const cellR = R * (2 * Math.PI / TrackSize) * 0.42;

  const seating = AsList(table.seating);
  const stars = AsList(table.stars);
  const starts = {};
  seating.forEach(id => { starts[Player(id).startPos] = Player(id).color; });

  let svg = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">`;

  svg += `<circle cx="50" cy="50" r="${finishR}" fill="#25314A"/>`;
  svg += `<text x="50" y="51" text-anchor="middle" font-size="2.6" font-weight="800" fill="#F4F1EA">CHEGADA</text>`;

  for(let c = 0; c < TrackSize; c++)
  {
    const p = Polar(c, R);
    svg += `<circle cx="${p.x}" cy="${p.y}" r="${cellR}" fill="${starts[c] || "#EDE8DC"}"/>`;
    if(stars.includes(c)) svg += `<text x="${p.x}" y="${p.y + 1.1}" text-anchor="middle" font-size="3" fill="${starts[c] ? "#fff" : "#C79A14"}">★</text>`;
  }

  seating.forEach(id =>
  {
    const pl = Player(id);
    const entry = (pl.startPos + LastTrackStep) % TrackSize;

    for(let k = 0; k < FinishSteps - LastTrackStep - 1; k++)
    {
      const p = Polar(entry, R - (k + 1) * homeStep);
      svg += `<circle cx="${p.x}" cy="${p.y}" r="${cellR * 0.85}" fill="${pl.color}" opacity=".5"/>`;
    }
  });

  // Agrupa peões por casa pra abrir em círculo; destaca os escolhíveis.
  const groups = {};
  const items = [];

  seating.forEach((id, seat) =>
  {
    const pl = Player(id);
    const entry = (pl.startPos + LastTrackStep) % TrackSize;
    const next = Player(seating[(seat + 1) % seating.length]);
    const gap = ((next.startPos - pl.startPos + TrackSize) % TrackSize) || TrackSize;
    const baseCenter = Polar(pl.startPos + gap / 2, R * 0.62);

    AsList(pl.pieces).forEach((pc, k) =>
    {
      let pos, key = null, small = false;

      if(pc.state === "base") pos = { x: baseCenter.x + (k % 2 - 0.5) * cellR * 2.2, y: baseCenter.y + (Math.floor(k / 2) - 0.5) * cellR * 2.2 };
      else if(pc.state === "done")
      {
        const count = table.piecesPerPlayer;
        const t = count > 1 ? k / (count - 1) - 0.5 : 0;
        pos = Polar(entry + t * TrackSize / seating.length * 0.55, finishR * 0.62);
        small = true;
      }
      else if(pc.state === "home") { pos = Polar(entry, R - (pc.pos + 1) * homeStep); key = `h${seat}_${pc.pos}`; }
      else { pos = Polar(pc.pos, R); key = `t${pc.pos}`; }

      const item = { id, k, pl, pc, pos, key, small };
      items.push(item);
      if(key) (groups[key] = groups[key] || []).push(item);
    });
  });

  const tappable = BoardTappables();

  items.forEach(it =>
  {
    let { x, y } = it.pos;
    let r = it.small ? cellR * 0.45 : cellR * 0.82;

    if(it.key && groups[it.key].length > 1)
    {
      const i = groups[it.key].indexOf(it);
      const a = i * 2 * Math.PI / groups[it.key].length;
      x += Math.cos(a) * cellR * 0.55;
      y += Math.sin(a) * cellR * 0.55;
      r *= 0.74;
    }

    const tap = tappable[`${it.id}:${it.k}`];
    const shielded = it.pl.shieldedPiece === it.k;
    const me = it.id === currentPlayerId;

    if(tap) svg += `<circle class="pawnHalo" cx="${x}" cy="${y}" r="${r + 1.1}" fill="#F5C542"/>`;
    if(shielded) svg += `<circle cx="${x}" cy="${y}" r="${r + 0.6}" fill="#5CE1E6"/>`;

    const stroke = me ? "#fff" : "rgba(0,0,0,.6)";
    const onclick = tap ? ` class="svgTap" onclick="${tap}"` : "";

    svg += `<g${onclick}><circle cx="${x}" cy="${y}" r="${r}" fill="${it.pl.color}" stroke="${stroke}" stroke-width=".35"/>`;
    if(!it.small) svg += `<text x="${x}" y="${y + r * 0.42}" text-anchor="middle" font-size="${r * 1.2}" font-weight="800" fill="${InkOn(it.pl.color)}">${it.k + 1}</text>`;
    svg += `</g>`;
  });

  el.innerHTML = svg + "</svg>";
}

// Peões que dá pra tocar direto no tabuleiro: escolha do movimento ou alvo do poder.
function BoardTappables()
{
  const result = {};
  const prompt = table.prompt || {};
  if(!IsMyAction()) return result;

  const mover = prompt.moverId;

  if(table.phase === "Choosing")
  {
    const pieces = Pieces(mover);

    AsList(prompt.moves).forEach(m =>
    {
      pieces.forEach((p, k) => { if(StepsOf(p) === m.from) result[`${mover}:${k}`] = `MovePiece(${k})`; });
    });
  }

  if(table.phase === "Roll" && selection)
  {
    const t = prompt.targets || {};

    if(selection.power === "Escudo") AsList(t.escudo).forEach(k => { result[`${mover}:${k}`] = `PickOwnPiece(${k})`; });
    if(selection.power === "Atalho") AsList(t.atalho).forEach(k => { result[`${mover}:${k}`] = `PickOwnPiece(${k})`; });
    if(selection.power === "Empurrao") AsList(t.empurrao).forEach(x => { result[`${x.playerId}:${x.piece}`] = `PickTarget('${x.playerId}',${x.piece})`; });

    if(selection.power === "Troca")
    {
      AsList(t.troca).forEach(x =>
      {
        if(selection.piece == null) result[`${mover}:${x.ownerPiece}`] = `PickOwnPiece(${x.ownerPiece})`;
        else if(x.ownerPiece === selection.piece) result[`${x.playerId}:${x.piece}`] = `PickTarget('${x.playerId}',${x.piece})`;
      });
    }
  }

  return result;
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

  document.getElementById("finalReason").innerText = final.reason === "time"
    ? "Acabou o tempo: venceu o maior progresso total."
    : "Todos os peões na Chegada!";

  document.getElementById("finalRanking").innerHTML = AsList(final.ranking).map((r, i) =>
  {
    const team = final.teams ? ` · Dupla ${r.team + 1}` : "";
    return `<div class="rankRow ${r.id === currentPlayerId ? "me" : ""}"><span class="rankPos">${i + 1}</span><span class="dot" style="background:${r.color}"></span>
      <span class="rankName">${Esc(r.name)}<small>${r.done} na Chegada${team}</small></span><span class="rankScore">${r.progress} casas</span></div>`;
  }).join("");

  if(won && navigator.vibrate) navigator.vibrate([60, 40, 120]);
}


// =========================
// MODO BOT (só carrega com ?bot=… na URL — ver bot/README.md)
// Sem cérebro próprio ainda: usa o "macaco" genérico do bot/bot.js.
// =========================

if(params.has("bot"))
{
  import("../bot/bot.js")
    .then((bot) => bot.StartBot({ game: "Ludo" }))
    .catch((error) => console.error("[Z3Bot]", error));
}
