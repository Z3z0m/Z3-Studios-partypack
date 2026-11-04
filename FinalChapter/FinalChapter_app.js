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
const currentPlayerName = params.get("name");
const currentPlayerId = params.get("id");


// =========================
// CONSTANTES
// =========================

const KindLabels = { person: "QUEM", weapon: "COM O QUÊ", room: "ONDE" };
const KindColors = { weapon: "#E23B3B", room: "#2F6FD0" };

const RejectedReasonLabels = {
  "not-now": "Agora não é hora disso.",
  "unreachable": "Não dá pra chegar aí com esse dado.",
  "invalid-guess": "Escolha uma pessoa e uma arma (e o cômodo, na rodada final).",
  "invalid-item": "Escolha uma das cartas do palpite.",
  "blocked": "Não dá pra ir pra lá (parede ou outro peão)."
};

const Arrows = { up: "↑", down: "↓", left: "←", right: "→" };

// Bloquinho: vazio → ✓ tem → ✗ não tem → ? talvez (símbolos diferentes, não só cor — GDD §5).
const NoteSymbols = ["", "✓", "✗", "?"];


// =========================
// ESTADO
// =========================

let currentGameState = "Lobby";
let isHost = false;
let isGamePaused = false;

let info = null;     // currentState/info (conteúdo + mapa, estático)
let table = null;    // currentState/table (público)
let hand = [];       // players/{eu}/hand (privado)
let gossips = [];    // players/{eu}/gossips (privado)
let notes = {};      // players/{eu}/notes (bloquinho, só o celular escreve)

let lastActionT = 0;
let panelKey = null;
let situationKey = null; // fase+ator+turno: muda = zera a seleção do palpite e a contagem
let pick = { person: null, weapon: null, room: null };
let seenGossipCount = 0;
let rejectedTimeout = null;

let countdownInterval = null;
let countdownRemaining = 0;

let unsubscribers = [];

// Histórico dos "Fulano contou uma fofoca pra Ciclano" (público) pra
// etiquetar o bloquinho — guardado no aparelho pra sobreviver a um reload.
const HistoryKey = `finalchapter_history_${currentRoomCode}_${currentPlayerId}`;
let gossipHistory = LoadHistory();


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

function Content() { return info ? info.content : null; }
function StudioMap() { return info ? info.map : null; }

function People() { return AsList(Content() && Content().people); }
function Weapons() { return AsList(Content() && Content().weapons); }
function Rooms() { return AsList(Content() && Content().rooms); }

function Item(id)
{
  return People().find(x => x.id === id) || Weapons().find(x => x.id === id) || Rooms().find(x => x.id === id) || null;
}

function ItemName(id) { const it = Item(id); return it ? it.name : (id || ""); }
function KindOf(id) { if(People().some(x => x.id === id)) return "person"; if(Weapons().some(x => x.id === id)) return "weapon"; return "room"; }

function Me() { return table && table.players ? table.players[currentPlayerId] : null; }
function PlayerName(id) { return id && table && table.players && table.players[id] ? table.players[id].name : ""; }
function CharacterOf(id) { const p = table && table.players ? table.players[id] : null; return p ? p.character : null; }

function PersonColor(personId) { const p = People().find(x => x.id === personId); return p ? p.color : "#888"; }

// Peões claros/escuros (Socorrista branco, Diretor preto) ganham contorno (GDD §2).
function ToneClass(hex)
{
  if(!hex || hex.length < 7) return "";
  const r = parseInt(hex.substr(1, 2), 16) / 255, g = parseInt(hex.substr(3, 2), 16) / 255, b = parseInt(hex.substr(5, 2), 16) / 255;
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  return lum > 0.6 ? "light" : (lum < 0.18 ? "dark" : "");
}

function DotHTML(color, extra) { return `<span class="dot ${ToneClass(color)} ${extra || ""}" style="background:${color}"></span>`; }

function IsMyAction() { return table && table.actorId === currentPlayerId; }
function FaceUp() { return AsList(table && table.faceUpCards); }
function Seating() { return AsList(table && table.seating); }

function MyPawn() { const c = CharacterOf(currentPlayerId); return c && table && table.pawns ? table.pawns[c] : null; }

function WhereLabel(pawn)
{
  if(!pawn) return "";
  return pawn.room ? ItemName(pawn.room) : "no corredor";
}

function ItemCardHTML(id)
{
  const kind = KindOf(id);
  const color = kind === "person" ? PersonColor(id) : KindColors[kind];
  const ink = ToneClass(color) === "light" ? "#26232D" : "#fff";
  return `<div class="itemCard"><div class="kind" style="background:${color};color:${ink}">${KindLabels[kind]}</div><div class="name">${Esc(ItemName(id))}</div></div>`;
}

function ShowToast(text)
{
  const el = document.getElementById("rejectedText");
  el.innerText = text;
  el.classList.add("active");
  clearTimeout(rejectedTimeout);
  rejectedTimeout = setTimeout(() => el.classList.remove("active"), 2600);
}

function LoadHistory()
{
  try { return JSON.parse(localStorage.getItem(HistoryKey) || "[]"); }
  catch { return []; }
}

function SaveHistory()
{
  try { localStorage.setItem(HistoryKey, JSON.stringify(gossipHistory.slice(-30))); }
  catch { }
}


// =========================
// SCREEN SYSTEM
// =========================

function ShowScreen(screenId)
{
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById(screenId).classList.add("active");
}

window.ShowTab = function(tab)
{
  document.querySelectorAll(".tab").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  document.querySelectorAll(".tabBody").forEach(b => b.classList.toggle("active", b.id === `tab-${tab}`));

  if(tab === "gossips")
  {
    seenGossipCount = gossips.length;
    RenderGossips();
  }
};


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
// LOBBY — ESCOLHA DE PERSONAGEM (mesmo esquema do avatar do ColorsIn:
// grava players/{eu}/character; os já escolhidos ficam bloqueados)
// =========================

let lobbyPlayers = {};

function ListenForLobby()
{
  onValue(ref(db, `rooms/${currentRoomCode}/currentState/info`), (snapshot) =>
  {
    if(snapshot.exists()) info = snapshot.val();
    RenderCharacterGrid();
  });

  onValue(ref(db, `rooms/${currentRoomCode}/players`), (snapshot) =>
  {
    lobbyPlayers = snapshot.val() || {};
    RenderCharacterGrid();
  });
}

function RenderCharacterGrid()
{
  const el = document.getElementById("characterGrid");
  if(!el) return;

  const people = People();
  if(!people.length) { el.innerHTML = `<p class="hint">Carregando o elenco...</p>`; return; }

  const mine = lobbyPlayers[currentPlayerId] ? lobbyPlayers[currentPlayerId].character : null;
  const takenBy = {};

  Object.entries(lobbyPlayers).forEach(([id, p]) =>
  {
    if(id !== currentPlayerId && p && p.character) takenBy[p.character] = p.name;
  });

  el.innerHTML = people.map(p =>
  {
    const taken = takenBy[p.id];
    const cls = `charItem ${mine === p.id ? "selected" : ""} ${taken ? "taken" : ""}`;
    const click = taken ? "" : ` onclick="SelectCharacter('${p.id}')"`;
    return `<button class="${cls}"${click}>${DotHTML(p.color)}<b>${Esc(p.name)}</b><small>${Esc(p.tagline || "")}</small>${taken ? `<span class="takenBy">${Esc(taken)}</span>` : ""}</button>`;
  }).join("");

  document.getElementById("lobbyWaitingText").innerText = mine
    ? `Você é ${ItemName(mine)}. Esperando o anfitrião começar a gravação...`
    : "Escolha seu personagem! (sem escolha, o elenco sorteia um pra você)";
}

window.SelectCharacter = async function(characterId)
{
  if(currentGameState !== "Lobby") return;

  const p = lobbyPlayers[currentPlayerId];
  const next = p && p.character === characterId ? null : characterId; // tocar de novo = desmarcar

  await set(ref(db, `rooms/${currentRoomCode}/players/${currentPlayerId}/character`), next);
};


// =========================
// HOST CONTROLS
// =========================

async function CheckIfHost()
{
  const snapshot = await get(ref(db, `rooms/${currentRoomCode}/players/${currentPlayerId}/isHost`));
  isHost = snapshot.val() === true;
  UpdateHostButton(currentGameState);
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
    console.log("[FinalChapter] Aba voltou ao foco — ressincronizando.");
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
    gossipHistory = [];
    SaveHistory();
    ShowScreen("lobbyScreen");
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
// AÇÕES (caixa própria — ver FinalChapterGameManager.HandleActionsChanged)
// =========================

async function SendAction(type, extra)
{
  if(isGamePaused) return;

  // t estritamente crescente: o host descarta ações com t <= a última vista.
  lastActionT = Math.max(Date.now(), lastActionT + 1);

  await set(ref(db, `rooms/${currentRoomCode}/actions/${currentPlayerId}`), Object.assign({ type: type, t: lastActionT }, extra || {}));
}

window.Act = function(type) { SendAction(type); };

window.Step = function(dir) { SendAction("step", { dir: dir }); };
window.ExitDoor = function(door) { SendAction("step", { door: door }); };

window.Pick = function(kind, id)
{
  pick[kind] = pick[kind] === id ? null : id;
  panelKey = null;
  RenderActionPanel();
};

window.SendGuess = function(needRoom)
{
  if(!pick.person || !pick.weapon || (needRoom && !pick.room)) { ShowToast(RejectedReasonLabels["invalid-guess"]); return; }

  const extra = { person: pick.person, weapon: pick.weapon };
  if(needRoom) extra.room = pick.room;
  SendAction("guess", extra);
};

window.SendGossip = function(item) { SendAction("gossip", { item: item }); };


// =========================
// OPEN PLAYING
// =========================

function StopPlayingListeners()
{
  unsubscribers.forEach(u => u());
  unsubscribers = [];
  StopCountdown();
}

async function OpenPlaying()
{
  StopPlayingListeners();

  panelKey = null;
  situationKey = null;

  const infoSnapshot = await get(ref(db, `rooms/${currentRoomCode}/currentState/info`));
  info = infoSnapshot.val();

  const me = `rooms/${currentRoomCode}/players/${currentPlayerId}`;

  unsubscribers.push(onValue(ref(db, `rooms/${currentRoomCode}/currentState/table`), (snapshot) =>
  {
    if(!snapshot.exists()) return;
    table = snapshot.val();
    TrackGossipHistory();
    RenderAll();
  }));

  unsubscribers.push(onValue(ref(db, `${me}/hand`), (snapshot) =>
  {
    hand = AsList(snapshot.val());
    RenderAll();
  }));

  unsubscribers.push(onValue(ref(db, `${me}/gossips`), (snapshot) =>
  {
    gossips = AsList(snapshot.val());
    panelKey = null;
    RenderAll();
  }));

  unsubscribers.push(onValue(ref(db, `${me}/notes`), (snapshot) =>
  {
    notes = snapshot.val() || {};
    RenderNotes();
  }));

  unsubscribers.push(onValue(ref(db, `rooms/${currentRoomCode}/currentState/actionRejected`), (snapshot) =>
  {
    if(!snapshot.exists()) return;
    const data = snapshot.val();
    if(data.playerId !== currentPlayerId || data.t < Date.now() - 10000) return;
    ShowToast(RejectedReasonLabels[data.reason] || "Ação inválida.");
  }));
}

// Guarda cada "Fulano contou uma fofoca pra Ciclano" (com os 3 itens do
// palpite) pra virar botão de etiqueta no bloquinho.
function TrackGossipHistory()
{
  const g = table && table.gossip;
  const guess = table && table.guess;
  if(!g || !g.from || !guess || guess.n !== g.n) return;
  if(gossipHistory.some(h => h.n === g.n)) return;

  gossipHistory.push({ n: g.n, from: g.from, to: g.to, items: [guess.person, guess.weapon, guess.room] });
  SaveHistory();
}

function RenderAll()
{
  if(!table || !info) return;

  RenderMe();
  RenderActionPanel();
  RenderNotes();
  RenderHand();
  RenderGossips();
  RenderMapTab();
  RenderMiniLog();
}


// =========================
// MEU STATUS
// =========================

function RenderMe()
{
  const me = Me();
  if(!me) return;

  const color = PersonColor(me.character);
  const dot = document.getElementById("meDot");
  dot.style.background = color;
  dot.className = `dot ${ToneClass(color)}`;

  document.getElementById("meName").innerText = `${me.name} · ${ItemName(me.character)}`;
  document.getElementById("meSub").innerText = WhereLabel(MyPawn()) + (table.finalRound ? " · RODADA FINAL" : "");
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

  // CHAVE: só reconstrói quando a "situação" muda (e a seleção do palpite,
  // que reseta panelKey em Pick).
  const key = [
    phase, table.actorId, table.turnNumber, JSON.stringify(prompt),
    table.guess ? `${table.guess.n}|${table.guess.result}` : "",
    table.gossip ? `${table.gossip.n}|${table.gossip.from}` : "",
    table.lastRoll ? table.lastRoll.serial : "",
    gossips.length
  ].join("#");

  if(key === panelKey) return;
  panelKey = key;

  const situation = [phase, table.actorId, table.turnNumber, prompt.type, prompt.again, prompt.steps].join("#");

  if(situation !== situationKey)
  {
    situationKey = situation;
    pick = { person: null, weapon: null, room: null };
    StartCountdown(mine ? (table.phaseDuration || 0) : 0);
  }

  el.classList.toggle("mine", mine && phase !== "Showing" && phase !== "Idle");
  el.innerHTML = BuildPanelHTML(phase, prompt, mine);
  AnimateDice(el);
}

function BuildPanelHTML(phase, prompt, mine)
{
  const actor = PlayerName(table.actorId);
  const roll = table.lastRoll;
  const rollHTML = roll && roll.rollerId === table.actorId && (phase === "Moving" || phase === "Idle" || phase === "Roll") ? DiceHTML(roll) : "";

  if(phase === "Roll" && mine)
  {
    let html = `<div class="phaseTitle">${prompt.again ? "Dupla! Rola de novo" : "Sua vez!"}</div>${rollHTML}`;
    html += `<button class="btn btnSpot" onclick="Act('roll')">🎲 Rolar dados</button>`;
    if(prompt.canPassage) html += `<button class="btn btnPassage" onclick="Act('passage')">Passagem secreta → ${Esc(ItemName(prompt.passageRoom))}</button>`;

    if(prompt.canGuess)
    {
      html += `<p class="hint">Você foi chamado pra ${Esc(ItemName(prompt.room))} — pode palpitar aqui sem sair.</p>`;
      html += GuessFormHTML(prompt.room, false);
      html += `<button class="btn" onclick="SendGuess(false)">Palpitar aqui</button>`;
    }

    return html;
  }

  if(phase === "Moving" && mine) return MovePanelHTML(prompt);

  if(phase === "Guess" && mine)
  {
    return `<div class="phaseTitle">Palpite em ${Esc(ItemName(prompt.room))}</div>
      <p class="hint">Quem matou o Roteirista, e com o quê? O cômodo é este.</p>
      ${GuessFormHTML(prompt.room, false)}
      <button class="btn" onclick="SendGuess(false)">Palpitar</button>
      <button class="btn btnGhost" onclick="Act('pass')">Encerrar turno sem palpitar</button>`;
  }

  if(phase === "FinalGuess" && mine)
  {
    return `<div class="phaseTitle">Seu último palpite</div>
      <p class="hint">Acabou o tempo! Escolha pessoa, arma e cômodo — vale qualquer cômodo.</p>
      ${GuessFormHTML(null, true)}
      <button class="btn" onclick="SendGuess(true)">Dar o último palpite</button>
      <button class="btn btnGhost" onclick="Act('pass')">Não arriscar</button>`;
  }

  if(phase === "Gossip" && mine)
  {
    const options = AsList(prompt.options);
    return `<div class="phaseTitle">Fofoca da Produção!</div>
      <p>${Esc(PlayerName(prompt.guessBy))} palpitou e você tem ${options.length} dessas cartas. Escolha UMA pra contar (só ${Esc(PlayerName(prompt.guessBy))} vê):</p>
      <div class="guessSummary">${options.map(id => `<div onclick="SendGossip('${id}')" style="cursor:pointer">${ItemCardHTML(id)}</div>`).join("")}</div>
      <p class="hint">Toque numa carta pra contar.</p>`;
  }

  // ===== ESPECTADOR / RESULTADO =====
  let html = "";
  const guess = table.guess;

  if(guess && (phase === "Showing" || phase === "Gossip" || phase === "Idle"))
  {
    const result = guess.result === "correct" ? ` <span class="yes">ACERTOU!</span>` : (guess.result === "wrong" ? ` <span class="no">errou</span>` : "");
    html += `<div class="phaseTitle">Palpite #${guess.n} · ${Esc(PlayerName(guess.by))}${result}</div>`;
    html += `<div class="guessSummary">${[guess.person, guess.weapon, guess.room].map(ItemCardHTML).join("")}</div>`;

    const g = table.gossip;

    if(phase === "Gossip")
    {
      html += `<p class="hint">${Esc(actor)} está escolhendo qual fofoca contar...</p>`;
    }
    else if(g && g.n === guess.n)
    {
      html += g.from
        ? `<p><b>${Esc(PlayerName(g.from))}</b> contou uma fofoca pra <b>${Esc(PlayerName(g.to))}</b>.</p>`
        : `<p class="hint">Ninguém tinha fofoca sobre esse palpite!</p>`;

      // Quem palpitou vê a fofoca recebida (só no próprio celular).
      if(g.to === currentPlayerId && g.from)
      {
        const mineGossip = gossips.filter(x => x.n === g.n).pop();
        if(mineGossip) html += GossipCardHTML(mineGossip, true);
      }
    }

    return html;
  }

  const labels = {
    "Roll": `${actor} vai rolar os dados`,
    "Moving": `${actor} está andando pelo estúdio${prompt.steps ? ` (${prompt.steps} passos)` : ""}`,
    "Guess": `${actor} pensa no palpite...`,
    "FinalGuess": `Último palpite de ${actor}`,
    "Showing": "Conferindo o envelope..."
  };

  html += `<div class="phaseTitle">${labels[phase] || "Aguardando..."}</div>${rollHTML}`;

  const turnChar = CharacterOf(table.currentTurnPlayerId);
  if(turnChar) html += `<p class="hint">${DotHTML(PersonColor(turnChar))} ${Esc(PlayerName(table.currentTurnPlayerId))} é ${Esc(ItemName(turnChar))}.</p>`;

  return html;
}

// MOVIMENTO PASSO A PASSO: 4 setas no corredor (desabilitadas onde tem
// parede ou outro peão; vira "Entrar" na porta de um cômodo), uma saída
// por porta dentro de um cômodo, e "Parar aqui" pra encerrar com passos
// sobrando. O host valida cada passo.
function MovePanelHTML(prompt)
{
  const moves = AsList(prompt.moves);
  const roll = table.lastRoll;

  let html = `<div class="phaseTitle">Ande pelo estúdio</div>${roll ? DiceHTML(roll) : ""}`;
  html += `<p class="stepsLeft">${prompt.steps}<small>PASSOS RESTANTES</small></p>`;

  if(prompt.inRoom)
  {
    html += `<p class="hint">Você está em ${Esc(ItemName(prompt.inRoom))}. Saia por uma porta:</p>`;
    html += moves.map((m, i) => `<button class="btn btnSpot" onclick="ExitDoor(${m.door})">${Arrows[m.dir] || ""} Sair pela porta${moves.length > 1 ? ` ${i + 1}` : ""}</button>`).join("");
  }
  else
  {
    const pad = ["up", "left", "right", "down"].map(dir =>
    {
      const m = moves.find(x => x.dir === dir);
      if(m && m.room) return `<button class="arrow ${dir} enter" onclick="Step('${dir}')">${Arrows[dir]}<br>Entrar<br>${Esc(ItemName(m.room))}</button>`;
      return `<button class="arrow ${dir}" ${m ? `onclick="Step('${dir}')"` : "disabled"}>${Arrows[dir]}</button>`;
    }).join("");

    html += `<div class="dpad">${pad}<div class="dpadCenter">${DotHTML(PersonColor(CharacterOf(currentPlayerId)))}</div></div>`;
  }

  html += `<button class="btn btnGhost" onclick="Act('stop')">Parar aqui${prompt.steps ? ` (sobram ${prompt.steps})` : ""}</button>`;
  html += MapHTML(true);
  return html;
}

// Pessoa + arma (+ cômodo na rodada final). Cartas suas/visíveis aparecem
// riscadas (ainda dá pra escolher — blefar com carta própria é estratégia).
function GuessFormHTML(fixedRoom, needRoom)
{
  const known = new Set([...hand, ...FaceUp()]);

  const chips = (list, kind) => list.map(it =>
  {
    const dot = kind === "person" ? DotHTML(it.color) : "";
    return `<button class="chip ${pick[kind] === it.id ? "selected" : ""} ${known.has(it.id) ? "known" : ""}" onclick="Pick('${kind}','${it.id}')">${dot}${Esc(it.name)}</button>`;
  }).join("");

  let html = `<p class="label">Quem</p><div class="chipGroup">${chips(People(), "person")}</div>`;
  html += `<p class="label">Com o quê</p><div class="chipGroup">${chips(Weapons(), "weapon")}</div>`;

  if(needRoom) html += `<p class="label">Onde</p><div class="chipGroup">${chips(Rooms(), "room")}</div>`;
  else if(fixedRoom) html += `<p class="label">Onde</p><p><b>${Esc(ItemName(fixedRoom))}</b></p>`;

  return html;
}

function GossipCardHTML(g, fresh)
{
  return `<div class="gossipCard ${fresh ? "fresh" : ""}"><span class="label">Fofoca #${g.n} · de ${Esc(g.fromName || PlayerName(g.from))}</span>
    <b>${Esc(ItemName(g.item))}</b><span>${Esc(g.text)}</span></div>`;
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

  const faces = values.map(v => `<span class="die" data-final="${v}">${DieFaceHTML(v)}</span>`).join("");
  return `<div class="diceRow" data-serial="${roll.serial || 0}">${faces}<span class="diceTotal">${roll.total}${roll.doubles ? " · DUPLA!" : ""}</span></div>`;
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
// MAPA
// =========================

function MapHTML(interactive)
{
  const map = StudioMap();
  if(!map) return "";

  const prompt = table.prompt || {};
  const reachCells = new Set();
  const reachRooms = new Set();

  if(interactive && table.phase === "Moving" && IsMyAction())
  {
    AsList(prompt.moves).forEach(m =>
    {
      if(m.room) reachRooms.add(m.room);
      else reachCells.add(`${m.x},${m.y}`);
    });
  }

  const rooms = AsList(map.rooms);
  const doorSet = new Set();
  rooms.forEach(r => AsList(r.doors).forEach(d => doorSet.add(`${d.x},${d.y}`)));

  const inside = (x, y) =>
  {
    const s = map.stage;
    if(s && x >= s.x && x < s.x + s.w && y >= s.y && y < s.y + s.h) return true;
    return rooms.some(r => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
  };

  // Peões por cômodo / por casa.
  const pawnsByRoom = {};
  const pawnsByCell = {};
  const myChar = CharacterOf(currentPlayerId);

  People().forEach(p =>
  {
    const st = table.pawns ? table.pawns[p.id] : null;
    if(!st) return;
    const html = `<span class="pawn ${ToneClass(p.color)} ${p.id === myChar ? "me" : ""}" style="background:${p.color}" title="${Esc(p.name)}"></span>`;
    if(st.room) (pawnsByRoom[st.room] = pawnsByRoom[st.room] || []).push(html);
    else pawnsByCell[`${st.x},${st.y}`] = html;
  });

  let html = `<div class="map" style="grid-template-columns:repeat(${map.width},1fr);grid-template-rows:repeat(${map.height},1fr)">`;

  for(let y = 0; y < map.height; y++)
  {
    for(let x = 0; x < map.width; x++)
    {
      if(inside(x, y)) continue;

      const k = `${x},${y}`;
      const reach = reachCells.has(k);
      const move = reach ? AsList(prompt.moves).find(m => !m.room && m.x === x && m.y === y) : null;
      const click = move ? (move.door >= 0 ? ` onclick="ExitDoor(${move.door})"` : ` onclick="Step('${move.dir}')"`) : "";
      html += `<div class="mCell ${doorSet.has(k) ? "door" : ""} ${reach ? "reach" : ""}" style="grid-column:${x + 1};grid-row:${y + 1}"${click}>${pawnsByCell[k] || ""}</div>`;
    }
  }

  if(map.stage)
  {
    const s = map.stage;
    html += `<div class="mStage" style="grid-column:${s.x + 1}/span ${s.w};grid-row:${s.y + 1}/span ${s.h}">PALCO</div>`;
  }

  const myPawn = MyPawn();
  const passages = AsList(map.passages);

  rooms.forEach(r =>
  {
    const reach = reachRooms.has(r.id);
    const here = myPawn && myPawn.room === r.id;
    const pass = passages.find(p => p.a === r.id || p.b === r.id);
    const enter = reach ? AsList(prompt.moves).find(m => m.room === r.id) : null;
    const click = enter ? ` onclick="Step('${enter.dir}')"` : "";
    const it = Item(r.id);

    html += `<div class="mRoom ${reach ? "reach" : ""} ${here ? "here" : ""}" style="grid-column:${r.x + 1}/span ${r.w};grid-row:${r.y + 1}/span ${r.h}"${click}>
      <span>${Esc(it ? it.name : r.id)}</span><div class="pawns">${(pawnsByRoom[r.id] || []).join("")}</div>${pass ? `<span class="pass">${pass.id}</span>` : ""}</div>`;
  });

  return html + "</div>";
}

function RenderMapTab()
{
  document.getElementById("mapView").innerHTML = MapHTML(false) +
    `<p class="hint">Bolinha amarela = você. A e B = passagens secretas (Elevador de Carga, Túnel dos Bastidores).</p>`;
}


// =========================
// BLOQUINHO (GDD §5)
// =========================

// Colunas: você + os outros na ordem da mesa a partir de você.
function NoteColumns()
{
  const seats = Seating();
  const i = seats.indexOf(currentPlayerId);
  const others = i < 0 ? seats : seats.slice(i + 1).concat(seats.slice(0, i));
  return [currentPlayerId, ...others.filter(id => id !== currentPlayerId)];
}

function NoteOf(itemId, colId)
{
  const n = notes[itemId] && notes[itemId][colId];
  return n ? { s: n.s || 0, tag: n.tag || "" } : { s: 0, tag: "" };
}

let activeTag = null; // { n, colId, items } — próxima ação etiqueta essas 3 células

function RenderNotes()
{
  const el = document.getElementById("notesGrid");
  if(!el || !table || !info) return;

  const cols = NoteColumns();
  const faceUp = new Set(FaceUp());
  const mine = new Set(hand);

  const header = `<tr><th class="itemCol">Item</th>${cols.map(id =>
  {
    const c = CharacterOf(id);
    const name = id === currentPlayerId ? "Você" : (PlayerName(id) || "?").slice(0, 6);
    return `<th>${DotHTML(PersonColor(c))}${Esc(name)}</th>`;
  }).join("")}</tr>`;

  const section = (title, list) =>
  {
    let rows = `<tr class="section"><td colspan="${cols.length + 1}">${title}</td></tr>`;

    list.forEach(it =>
    {
      const isFace = faceUp.has(it.id);
      const isMine = mine.has(it.id);

      rows += `<tr class="${isFace ? "faceUp" : ""} ${isMine ? "mine" : ""}"><td class="itemCol">${Esc(it.name)}</td>`;

      cols.forEach(colId =>
      {
        // AUTOMÁTICO: a sua coluna (suas cartas) e as cartas visíveis a todos.
        if(colId === currentPlayerId || isFace)
        {
          const s = colId === currentPlayerId && isMine ? 1 : 2;
          rows += `<td><button class="cell auto s${s}" disabled>${NoteSymbols[s]}</button></td>`;
          return;
        }

        const n = NoteOf(it.id, colId);
        rows += `<td><button class="cell s${n.s}" onclick="TapNote('${it.id}','${colId}')">${NoteSymbols[n.s]}${n.tag ? `<small>${Esc(n.tag)}</small>` : ""}</button></td>`;
      });

      rows += "</tr>";
    });

    return rows;
  };

  el.innerHTML = `<table class="notes">${header}${section("PESSOAS", People())}${section("ARMAS", Weapons())}${section("CÔMODOS", Rooms())}</table>`;

  RenderTagBar();
}

window.TapNote = function(itemId, colId)
{
  const n = NoteOf(itemId, colId);
  const next = (n.s + 1) % NoteSymbols.length;
  set(ref(db, `rooms/${currentRoomCode}/players/${currentPlayerId}/notes/${itemId}/${colId}`), { s: next, tag: n.tag || "" });
};

// TAG DE PALPITE: ao ver "Fulano contou uma fofoca", marca as 3 células do
// palpite na coluna de Fulano com "#n" (GDD §5). Quando descobrir que ele não
// tem 2 delas, sabe que é a terceira.
function RenderTagBar()
{
  const el = document.getElementById("tagBar");
  if(!el) return;

  const recent = gossipHistory.filter(h => h.from !== currentPlayerId).slice(-4).reverse();

  el.innerHTML = recent.map(h =>
  {
    const label = `#${h.n}: ${PlayerName(h.from).slice(0, 8)} → ${h.to === currentPlayerId ? "você" : PlayerName(h.to).slice(0, 8)}`;
    return `<button class="chip" onclick="ApplyTag(${h.n})">Etiquetar ${Esc(label)}</button>`;
  }).join("");
}

window.ApplyTag = function(n)
{
  const h = gossipHistory.find(x => x.n === n);
  if(!h) return;

  h.items.forEach(itemId =>
  {
    const cur = NoteOf(itemId, h.from);
    const tags = new Set((cur.tag || "").split(" ").filter(Boolean));
    tags.add(`#${n}`);
    set(ref(db, `rooms/${currentRoomCode}/players/${currentPlayerId}/notes/${itemId}/${h.from}`), { s: cur.s || 3, tag: Array.from(tags).join(" ") });
  });

  ShowTab("notes");
};

// Atalho da aba Fofocas: quem contou TEM aquela carta → ✓ na coluna dele.
window.MarkGossip = function(itemId, fromId)
{
  const cur = NoteOf(itemId, fromId);
  set(ref(db, `rooms/${currentRoomCode}/players/${currentPlayerId}/notes/${itemId}/${fromId}`), { s: 1, tag: cur.tag || "" });
  ShowToast("Anotado no bloquinho!");
};


// =========================
// CARTAS / FOFOCAS
// =========================

function RenderHand()
{
  const el = document.getElementById("tab-hand");
  if(!el || !info) return;

  const faceUp = FaceUp();

  el.innerHTML = `<p class="label">Suas cartas (inocentes)</p><div class="handGrid">${hand.map(ItemCardHTML).join("")}</div>` +
    (faceUp.length ? `<p class="label" style="margin-top:14px">Na mesa (todo mundo sabe)</p><div class="handGrid">${faceUp.map(ItemCardHTML).join("")}</div>` : "");
}

function RenderGossips()
{
  const el = document.getElementById("tab-gossips");
  if(!el) return;

  const badge = document.getElementById("gossipBadge");
  const onTab = document.querySelector(".tab[data-tab='gossips']").classList.contains("active");
  if(onTab) seenGossipCount = gossips.length;
  badge.innerText = gossips.length > seenGossipCount ? gossips.length - seenGossipCount : "";

  if(!gossips.length)
  {
    el.innerHTML = `<p class="hint">Nenhuma fofoca ainda. Dê um palpite num cômodo pra alguém te contar uma!</p>`;
    return;
  }

  el.innerHTML = gossips.slice().reverse().map(g =>
    GossipCardHTML(g, false) + `<button class="btn btnGhost" style="margin-top:-4px" onclick="MarkGossip('${g.item}','${g.from}')">Anotar: ${Esc(g.fromName || PlayerName(g.from))} tem ${Esc(ItemName(g.item))}</button>`
  ).join("");
}

function RenderMiniLog()
{
  const log = AsList(table.log);
  document.getElementById("miniLog").innerHTML = log.slice(-4).reverse().map(l => `<p>${Esc(l)}</p>`).join("");
}


// =========================
// CONTAGEM (só da minha decisão)
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

  if(!info)
  {
    const infoSnapshot = await get(ref(db, `rooms/${currentRoomCode}/currentState/info`));
    info = infoSnapshot.val();
  }

  const won = final.winnerId === currentPlayerId;
  document.getElementById("finalWinner").innerText = final.winnerId
    ? (won ? "Você resolveu o caso!" : `${final.winnerName} resolveu o caso!`)
    : "Caso sem solução...";

  document.getElementById("finalSolution").innerHTML = [final.person, final.weapon, final.room].map(ItemCardHTML).join("");
  document.getElementById("finalLine").innerText = final.line || "";

  if(won && navigator.vibrate) navigator.vibrate([60, 40, 120]);
}
