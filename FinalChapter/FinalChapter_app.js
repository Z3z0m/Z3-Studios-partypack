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

// Fases em que o ator decide algo no dispositivo (painel vira folha de papel).
const DecisionPhases = ["Roll", "Moving", "Guess", "FinalGuess", "Gossip"];

const RejectedReasonLabels = {
  "not-now": "Agora não é hora disso.",
  "unreachable": "Não dá pra chegar aí com esse dado.",
  "invalid-guess": "Escolha uma pessoa e uma arma (e o cômodo, na rodada final).",
  "invalid-item": "Escolha uma das cartas do palpite.",
  "blocked": "Não dá pra ir pra lá (parede ou outro peão)."
};

const Arrows = { up: "↑", down: "↓", left: "←", right: "→" };
const ArrowWords = { up: "para cima", down: "para baixo", left: "para a esquerda", right: "para a direita" };

// Bloquinho: vazio → ✓ tem → ✗ não tem → ? talvez (símbolos diferentes, não só cor — GDD §5).
const NoteSymbols = ["", "✓", "✗", "?"];
const NoteWords = ["vazio", "tem", "não tem", "talvez"];


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
let notes = {};      // players/{eu}/notes (bloquinho, só o dispositivo escreve)

let lastActionT = 0;
let panelKey = null;
let situationKey = null; // fase+ator+turno: muda = zera a seleção do palpite e a contagem
let pick = { person: null, weapon: null, room: null };
let seenGossipCount = 0;
let rejectedTimeout = null;

let currentTab = "cena";
let decisionKey = null;  // fase+ator+turno+tipo (sem os passos): muda = nova decisão → pula pra aba Cena
let guessOpen = false;   // "Palpitar aqui" (chamado) abre o formulário na mesma folha

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

function PersonColor(personId) { const p = People().find(x => x.id === personId); return p ? p.color : "#888888"; }

// Cor do texto sobre a cor do personagem: rosa, laranja e branco ficam com
// tinta escura; o resto, branco.
function Luminance(hex)
{
  if(!hex || hex.length < 7 || hex[0] !== "#") return 0;
  const r = parseInt(hex.substr(1, 2), 16) / 255, g = parseInt(hex.substr(3, 2), 16) / 255, b = parseInt(hex.substr(5, 2), 16) / 255;
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function InkOn(hex) { return Luminance(hex) > 0.55 ? "var(--ink)" : "#FFFFFF"; }

// "O Herói" → H, "A Figurante" → F (pula o artigo).
function Initial(name)
{
  const words = String(name || "").trim().split(/\s+/);
  const word = words.length > 1 && /^(o|a|os|as)$/i.test(words[0]) ? words[1] : words[0];
  return (word || "").charAt(0).toUpperCase();
}

// Peão: bolinha na cor do personagem com a inicial.
function PawnHTML(personId, size, extraCls)
{
  const p = People().find(x => x.id === personId);
  const color = p ? p.color : "#888888";
  const font = size <= 17 ? 11 : Math.round(size * 0.6);
  return `<span class="pawnDot ${extraCls || ""}" aria-hidden="true" style="width:${size}px;height:${size}px;font-size:${font}px;background:${color};color:${InkOn(color)}">${p ? Initial(p.name) : ""}</span>`;
}

function DotHTML(color, size, extraCls)
{
  return `<span class="pawnDot ${extraCls || ""}" aria-hidden="true" style="width:${size}px;height:${size}px;background:${color}"></span>`;
}

// Nome curto e legível pro mapa, pro "Entrar" e pra legenda: "Cenário da
// Mansão" → "Mansão", "Depósito de Cenários" → "Depósito". (O shortName do
// conteúdo é sigla de 3 letras, feita pro cabeçalho compacto da TV.)
function MapName(id)
{
  return ItemName(id).replace(/^Cenário d[aoe]s?\s+/i, "").replace(/\s+de Cenários$/i, "");
}

// Artigo do conteúdo: "com o Martelo" / "com a Claquete", "no Camarim" / "na Cidade".
function Article(id) { const it = Item(id); return it && it.article ? it.article : ""; }
function WithArticle(id) { const a = Article(id); return a ? `com ${a}` : "com"; }
function InArticle(id) { const a = Article(id); return a === "o" ? "no" : (a === "a" ? "na" : "em"); }

// Faixa de tipo da carta: QUEM na cor do personagem, COM O QUÊ caneta, ONDE tinta.
function Band(id)
{
  const kind = KindOf(id);
  // Cor quase branca (Socorrista) some sobre o papel: ganha um filete de tinta.
  if(kind === "person") { const c = PersonColor(id); return { label: KindLabels.person, bg: c, ink: InkOn(c), cls: Luminance(c) > 0.9 ? "pale" : "" }; }
  if(kind === "weapon") return { label: KindLabels.weapon, bg: "var(--pen)", ink: "#FFFFFF", cls: "" };
  return { label: KindLabels.room, bg: "var(--ink-2)", ink: "#FFFFFF", cls: "" };
}

function BandHTML(id) { const b = Band(id); return `<span class="band ${b.cls}" style="background:${b.bg};color:${b.ink}">${b.label}</span>`; }

function IsMyAction() { return table && table.actorId === currentPlayerId; }
function IsMyDecision() { return !!table && IsMyAction() && DecisionPhases.includes(table.phase); }
function FaceUp() { return AsList(table && table.faceUpCards); }
function Seating() { return AsList(table && table.seating); }

function MyPawn() { const c = CharacterOf(currentPlayerId); return c && table && table.pawns ? table.pawns[c] : null; }

function WhereLabel(pawn)
{
  if(!pawn) return "";
  return pawn.room ? ItemName(pawn.room) : "no corredor";
}

function MiniCardHTML(id) { return `<div class="miniCard">${BandHTML(id)}<span class="name">${Esc(ItemName(id))}</span></div>`; }
function HandCardHTML(id) { return `<div class="handCard">${BandHTML(id)}<span class="name">${Esc(ItemName(id))}</span></div>`; }
function TableCardHTML(id) { return `<div class="tableCard"><span class="band">${KindLabels[KindOf(id)]}</span><span class="name">${Esc(ItemName(id))}</span></div>`; }

function StripCardHTML(id)
{
  const b = Band(id);
  return `<div class="stripCard"><span class="band ${b.cls}" style="background:${b.bg};color:${b.ink}">${b.label}</span><span class="name">${Esc(ItemName(id))}</span></div>`;
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
  currentTab = tab;

  document.querySelectorAll(".tab").forEach(b =>
  {
    const on = b.dataset.tab === tab;
    b.classList.toggle("active", on);
    if(on) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });

  document.querySelectorAll(".tabBody").forEach(b => b.classList.toggle("active", b.id === `tab-${tab}`));

  if(tab === "gossips")
  {
    seenGossipCount = gossips.length;
    RenderGossips();
  }

  UpdateCenaAlert();
};

// Aba Cena amarela: tenho uma decisão pendente e estou em outra aba.
function UpdateCenaAlert()
{
  const tab = document.querySelector(".tab[data-tab='cena']");
  if(tab) tab.classList.toggle("alert", currentTab !== "cena" && IsMyDecision());
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
  if(!people.length) { el.innerHTML = `<p class="loadingText">Carregando o elenco...</p>`; return; }

  const mine = lobbyPlayers[currentPlayerId] ? lobbyPlayers[currentPlayerId].character : null;
  const takenBy = {};

  Object.entries(lobbyPlayers).forEach(([id, p]) =>
  {
    if(id !== currentPlayerId && p && p.character) takenBy[p.character] = p.name;
  });

  el.innerHTML = people.map(p =>
  {
    const taken = takenBy[p.id];
    const selected = mine === p.id;
    const cls = `charItem ${selected ? "selected" : ""} ${taken ? "taken" : ""}`;
    const action = taken ? " disabled" : ` onclick="SelectCharacter('${p.id}')" aria-pressed="${selected}"`;
    const sub = taken ? `com ${taken}` : (p.tagline || "");
    return `<button class="${cls}"${action}><span class="charTop">${PawnHTML(p.id, 28)}<span class="charName">${Esc(p.name)}</span></span><span class="charSub">${Esc(sub)}</span></button>`;
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

// Cada tela tem o seu botão do anfitrião, no fluxo da página, todos mandando
// o mesmo hostCommand: "Começar Jogo" (lobby), "Pular decisão atual" (aba
// Cena — mesmo efeito do timeout de quem está AFK) e "Jogar de Novo" (final).
function UpdateHostButton(state)
{
  if(!isHost) return;
  document.querySelectorAll(".hostOnly").forEach(b => { b.style.display = ""; });
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

// Chamado pra um cômodo: "Palpitar aqui" abre o formulário na mesma folha.
window.OpenGuess = function() { guessOpen = true; panelKey = null; RenderActionPanel(); };
window.CloseGuess = function() { guessOpen = false; panelKey = null; RenderActionPanel(); };


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
  UpdateCenaAlert();
}


// =========================
// TOPO (aba na cor do meu personagem)
// =========================

function RenderMe()
{
  const me = Me();
  if(!me) return;

  const color = PersonColor(me.character);
  const topo = document.getElementById("celTopo");
  topo.style.background = color;
  topo.style.color = InkOn(color);

  document.getElementById("meName").innerText = `${me.name} · ${ItemName(me.character)}`;
  document.getElementById("meSub").innerText = WhereLabel(MyPawn()) + (table.finalRound ? " · RODADA FINAL" : "");
}


// =========================
// PAINEL DA FASE (aba Cena)
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
  const sameSituation = situation === situationKey;

  if(!sameSituation)
  {
    situationKey = situation;
    pick = { person: null, weapon: null, room: null };
    guessOpen = false;
    StartCountdown(mine ? (table.phaseDuration || 0) : 0);
  }

  // NOVA DECISÃO MINHA: pula pra aba Cena e vibra. Sem os passos na chave,
  // pra não vibrar a cada casa andada.
  const decision = [phase, table.actorId, table.turnNumber, prompt.type, prompt.again].join("#");

  if(decision !== decisionKey)
  {
    decisionKey = decision;

    if(IsMyDecision())
    {
      if(currentTab !== "cena") ShowTab("cena");
      if(navigator.vibrate) navigator.vibrate(40);
    }
  }

  // Rebuild do formulário (ao tocar num chip) mantém a rolagem do meio.
  const oldBody = el.querySelector(".guessBody");
  const scroll = oldBody && sameSituation ? oldBody.scrollTop : 0;

  const view = BuildPanelHTML(phase, prompt, mine);
  el.className = `panel ${view.cls}`;
  el.innerHTML = view.html;

  const cena = document.getElementById("tab-cena");
  cena.classList.remove("mode-mine", "mode-watch", "mode-result");
  cena.classList.add(`mode-${view.mode}`);

  const newBody = el.querySelector(".guessBody");
  if(newBody && scroll) newBody.scrollTop = scroll;

  AnimateDice(el);
}

// Devolve { mode, cls, html }:
//   mode "mine"   → minha decisão, folha de papel
//   mode "result" → resultado do palpite / fofoca
//   mode "watch"  → vez de outra pessoa (carbono)
function BuildPanelHTML(phase, prompt, mine)
{
  const actor = PlayerName(table.actorId);
  const roll = table.lastRoll;
  const rollHTML = roll && roll.rollerId === table.actorId && (phase === "Moving" || phase === "Idle" || phase === "Roll") ? DiceHTML(roll) : "";

  if(phase === "Roll" && mine)
  {
    if(prompt.canGuess && guessOpen)
    {
      return GuessPanel({
        title: `Palpite em ${ItemName(prompt.room)}`,
        fixedRoom: prompt.room,
        needRoom: false,
        primary: "Palpitar",
        secondary: "Voltar",
        secondaryClick: "CloseGuess()"
      });
    }

    const again = !!prompt.again;
    const dice = again && roll && roll.rollerId === table.actorId ? DiceHTML(roll, "big") : BlankDiceHTML();

    let html = table.turnNumber ? `<div class="sceneNo">CENA ${table.turnNumber}</div>` : "";
    html += `<h1 class="rollTitle ${again ? "small" : ""}">${again ? "Dupla! Rola de novo" : "Sua vez!"}</h1>${dice}`;

    if(prompt.canGuess)
    {
      html += `<p class="rollHint">Você foi chamado pra ${Esc(ItemName(prompt.room))} — pode palpitar aqui sem sair.</p>`;
      html += `<button class="btn btnCalled" onclick="OpenGuess()">Palpitar aqui</button>`;
    }

    html += `<button class="btn btnMarker btnRoll" onclick="Act('roll')">Rolar dados</button>`;

    if(prompt.canPassage)
    {
      html += `<button class="btn btnInk btnPassage" onclick="Act('passage')"><span class="passKey" aria-hidden="true">${Esc(PassageKey(prompt.passageRoom))}</span><span>Passagem secreta → ${Esc(ItemName(prompt.passageRoom))}</span></button>`;
    }

    return { mode: "mine", cls: "sheet roll", html };
  }

  if(phase === "Moving" && mine) return { mode: "mine", cls: "sheet bleed", html: MovePanelHTML(prompt) };

  if(phase === "Guess" && mine)
  {
    return GuessPanel({
      title: `Palpite em ${ItemName(prompt.room)}`,
      fixedRoom: prompt.room,
      needRoom: false,
      primary: "Palpitar",
      secondary: "Encerrar turno sem palpitar",
      secondaryClick: "Act('pass')"
    });
  }

  if(phase === "FinalGuess" && mine)
  {
    return GuessPanel({
      title: "Seu último palpite",
      big: true,
      hint: "Acabou o tempo! Escolha pessoa, arma e cômodo — vale qualquer cômodo.",
      needRoom: true,
      primary: "Dar o último palpite",
      secondary: "Não arriscar",
      secondaryClick: "Act('pass')"
    });
  }

  if(phase === "Gossip" && mine)
  {
    const options = AsList(prompt.options);
    const by = Esc(PlayerName(prompt.guessBy));

    const buttons = options.map(id =>
      `<button class="gpOption" onclick="SendGossip('${id}')">${BandHTML(id)}<span class="name">${Esc(ItemName(id))}</span></button>`).join("");

    return {
      mode: "mine",
      cls: "gossipPick",
      html: `<div class="gpHead"><h1>Fofoca da Produção!</h1></div>
        <div class="gpBody">
          <p>${by} palpitou e você tem ${options.length} dessas cartas. Escolha <b>UMA</b> pra contar (só ${by} vê):</p>
          ${buttons}
          <p class="gpFoot">Toque numa carta pra contar.</p>
        </div>`
    };
  }

  // ===== RESULTADO DO PALPITE =====
  const guess = table.guess;

  if(guess && (phase === "Showing" || phase === "Gossip" || phase === "Idle"))
  {
    const stamp = guess.result === "correct" ? `<span class="stamp ok">ACERTOU!</span>` : (guess.result === "wrong" ? `<span class="stamp">ERROU</span>` : "");

    let html = `<div class="resultHead"><h1>Palpite #${guess.n} · ${Esc(PlayerName(guess.by))}</h1>${stamp}</div>`;
    html += `<div class="miniCards">${[guess.person, guess.weapon, guess.room].map(MiniCardHTML).join("")}</div>`;

    const g = table.gossip;

    if(phase === "Gossip")
    {
      html += `<p class="resultLine">${Esc(actor)} está escolhendo qual fofoca contar...</p>`;
    }
    else if(g && g.n === guess.n)
    {
      html += g.from
        ? `<p class="resultLine"><b>${Esc(PlayerName(g.from))}</b> contou uma fofoca pra <b>${Esc(PlayerName(g.to))}</b>.</p>`
        : `<p class="resultLine">Ninguém tinha fofoca sobre esse palpite!</p>`;

      // Quem palpitou vê a fofoca recebida (só no próprio dispositivo).
      if(g.to === currentPlayerId && g.from)
      {
        const mineGossip = gossips.filter(x => x.n === g.n).pop();
        if(mineGossip) html += FreshGossipHTML(mineGossip);
      }
    }

    return { mode: "result", cls: "result", html };
  }

  // ===== ESPECTADOR =====
  const who = Esc(actor);
  const labels = {
    "Roll": `${who} vai rolar os dados`,
    "Moving": `${who} está andando pelo estúdio${prompt.steps ? ` <span class="mk">(${prompt.steps} passos)</span>` : ""}`,
    "Guess": `${who} pensa no palpite...`,
    "FinalGuess": `Último palpite de ${who}`,
    "Showing": "Conferindo o envelope..."
  };

  let html = `<h1 class="watchTitle">${labels[phase] || "Aguardando..."}</h1>${rollHTML}`;

  const turnChar = CharacterOf(table.currentTurnPlayerId);
  if(turnChar) html += `<p class="turnWho">${DotHTML(PersonColor(turnChar), 20, "onBg")}<span>${Esc(PlayerName(table.currentTurnPlayerId))} é ${Esc(ItemName(turnChar))}.</span></p>`;

  return { mode: "watch", cls: "watch", html };
}

function PassageKey(roomId)
{
  const map = StudioMap();
  const p = AsList(map && map.passages).find(x => x.a === roomId || x.b === roomId);
  return p ? p.id : "";
}

// MOVIMENTO PASSO A PASSO: 4 setas no corredor (desabilitadas onde tem
// parede ou outro peão; vira "Entrar" na porta de um cômodo), uma saída
// por porta dentro de um cômodo, e "Parar aqui" pra encerrar com passos
// sobrando. O host valida cada passo.
function MovePanelHTML(prompt)
{
  const moves = AsList(prompt.moves);
  const roll = table.lastRoll;

  let html = `<div class="moveTop">
    <div class="stepsLeft"><span class="stepsNum">${prompt.steps}</span><span class="stepsLbl">PASSOS<br>RESTANTES</span></div>
    ${roll ? DiceHTML(roll, "small") : ""}
  </div>`;

  if(prompt.inRoom)
  {
    html += `<p class="moveHint">Você está em ${Esc(ItemName(prompt.inRoom))}. Saia por uma porta:</p>`;
    html += moves.map((m, i) => `<button class="btn doorBtn" onclick="ExitDoor(${m.door})">${Arrows[m.dir] || ""} Sair pela porta${moves.length > 1 ? ` ${i + 1}` : ""}</button>`).join("");
  }
  else
  {
    const pad = ["up", "left", "right", "down"].map(dir =>
    {
      const m = moves.find(x => x.dir === dir);
      if(m && m.room)
      {
        // Fonte pelo tamanho da maior palavra, pra não quebrar "Depósito" no
        // meio (~58px úteis no botão; Courier = 0,6em por letra).
        const label = `Entrar ${MapName(m.room)}`;
        const longest = Math.max(...label.split(/\s+/).map(w => w.length));
        const size = Math.max(10, Math.min(15, Math.floor(58 / (longest * 0.6))));
        return `<button class="arrow ${dir} enter" style="font-size:${size}px" aria-label="Entrar em ${Esc(ItemName(m.room))}" onclick="Step('${dir}')">${Esc(label)}</button>`;
      }
      return `<button class="arrow ${dir}" aria-label="Andar ${ArrowWords[dir]}" ${m ? `onclick="Step('${dir}')"` : "disabled"}>${Arrows[dir]}</button>`;
    }).join("");

    html += `<div class="dpad">${pad}<div class="dpadCenter">${PawnHTML(CharacterOf(currentPlayerId), 46)}</div></div>`;
  }

  html += `<button class="btn btnGhostInk btnStop" onclick="Act('stop')">Parar aqui${prompt.steps ? ` (sobram ${prompt.steps})` : ""}</button>`;
  html += `<div class="moveMap">${MapHTML(true)}</div>`;
  return html;
}

// FOLHA DE PALPITE em 3 zonas: cabeçalho fixo (título + frase montada),
// meio rolável (chips) e rodapé fixo (botões).
function GuessPanel(o)
{
  const complete = pick.person && pick.weapon && (!o.needRoom || pick.room);

  const html = `<div class="guessHead">
      <h1 class="${o.big ? "big" : ""}">${Esc(o.title)}</h1>
      ${o.hint ? `<p class="hintLine">${Esc(o.hint)}</p>` : ""}
      <p class="sentence">${SentenceHTML(o.fixedRoom, o.needRoom)}</p>
    </div>
    <div class="guessBody">${GuessFormHTML(o.needRoom)}</div>
    <div class="guessFoot">
      <button class="btn btnGuess" ${complete ? "" : "disabled"} onclick="SendGuess(${o.needRoom})">${Esc(o.primary)}</button>
      <button class="btn btnGhostInk btnPass" onclick="${o.secondaryClick}">${Esc(o.secondary)}</button>
    </div>`;

  return { mode: "mine", cls: "sheet guess", html };
}

// "{quem}, com o/a {arma}, no/na {cômodo}" — lacunas "_______", escolhas no marca-texto.
function SentenceHTML(fixedRoom, needRoom)
{
  const blank = "_______";
  const mark = id => `<mark>${Esc(ItemName(id))}</mark>`;

  const who = pick.person ? mark(pick.person) : blank;
  const what = pick.weapon ? `${WithArticle(pick.weapon)} ${mark(pick.weapon)}` : `com ${blank}`;

  let where = "";
  if(needRoom) where = pick.room ? `${InArticle(pick.room)} ${mark(pick.room)}` : `em ${blank}`;
  else if(fixedRoom) where = `${InArticle(fixedRoom)} ${Esc(ItemName(fixedRoom))}`;

  return `${who}, ${what}${where ? `, ${where}` : ""}`;
}

// Pessoa + arma (+ cômodo na rodada final). Cartas suas/visíveis aparecem
// riscadas (ainda dá pra escolher — blefar com carta própria é estratégia).
function GuessFormHTML(needRoom)
{
  const known = new Set([...hand, ...FaceUp()]);

  const chips = (list, kind) => list.map(it =>
  {
    const dot = kind === "person" ? DotHTML(it.color, 14) : "";
    const selected = pick[kind] === it.id;
    return `<button class="chip ${selected ? "selected" : ""} ${known.has(it.id) ? "known" : ""}" aria-pressed="${selected}" onclick="Pick('${kind}','${it.id}')">${dot}<span>${Esc(it.name)}</span></button>`;
  }).join("");

  let html = `<h2 class="groupLabel">QUEM</h2><div class="chipGroup">${chips(People(), "person")}</div>`;
  html += `<h2 class="groupLabel">COM O QUÊ</h2><div class="chipGroup">${chips(Weapons(), "weapon")}</div>`;

  if(needRoom) html += `<h2 class="groupLabel">ONDE</h2><div class="chipGroup">${chips(Rooms(), "room")}</div>`;

  return html;
}

// Fofoca recebida (só pra quem palpitou) + atalho pro bloquinho.
function FreshGossipHTML(g)
{
  const from = g.fromName || PlayerName(g.from);

  return `<div class="gossipFresh">
      <div class="head">FOFOCA #${g.n} · DE ${Esc(from.toUpperCase())}</div>
      <div class="item">${Esc(ItemName(g.item))}</div>
      <p class="text">${Esc(g.text)}</p>
    </div>
    <button class="btn btnMarker btnNote" onclick="MarkGossip('${g.item}','${g.from}')">Anotar: ${Esc(from)} tem ${Esc(ItemName(g.item))}</button>`;
}


// =========================
// DADOS (mesma animação do Landlords)
// =========================

const PipPatterns = [[], [4], [0, 8], [0, 4, 8], [0, 2, 6, 8], [0, 2, 4, 6, 8], [0, 2, 3, 5, 6, 8]];

function DieFaceHTML(value)
{
  return Array.from({ length: 9 }, (_, i) => `<i class="${(PipPatterns[value] || []).includes(i) ? "pip" : ""}"></i>`).join("");
}

// size: "" (espectador, 66px), "big" (sua vez, 104px), "small" (andando, ao lado dos passos).
function DiceHTML(roll, size)
{
  const values = AsList(roll && roll.values);
  if(!values.length) return "";

  const faces = values.map(v => `<span class="die" data-final="${v}">${DieFaceHTML(v)}</span>`).join("");

  let total = `${roll.total}${roll.doubles ? "<small>DUPLA!</small>" : ""}`;
  if(size === "big") total = `${roll.total}${roll.doubles ? "<br>DUPLA!" : ""}`;
  if(size === "small") total = `= ${roll.total}`;

  return `<div class="diceRow ${size || ""}" role="img" aria-label="Dados: ${values.join(" e ")}, total ${roll.total}" data-serial="${roll.serial || 0}">${faces}<span class="diceTotal">${total}</span></div>`;
}

// Antes de rolar: dois dados com os pips apagados.
function BlankDiceHTML()
{
  const die = `<span class="die blank">${DieFaceHTML(5)}</span>`;
  return `<div class="diceRow big" aria-hidden="true">${die}${die}</div>`;
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
    const html = PawnHTML(p.id, 17, p.id === myChar ? "me" : "");
    if(st.room) (pawnsByRoom[st.room] = pawnsByRoom[st.room] || []).push(html);
    else pawnsByCell[`${st.x},${st.y}`] = html;
  });

  let html = `<div class="map" style="grid-template-columns:repeat(${map.width},minmax(0,1fr));grid-template-rows:repeat(${map.height},minmax(0,1fr));aspect-ratio:${map.width}/${map.height}">`;

  for(let y = 0; y < map.height; y++)
  {
    for(let x = 0; x < map.width; x++)
    {
      if(inside(x, y)) continue;

      const k = `${x},${y}`;
      const reach = reachCells.has(k);
      const move = reach ? AsList(prompt.moves).find(m => !m.room && m.x === x && m.y === y) : null;
      const click = move ? (move.door >= 0 ? ` onclick="ExitDoor(${move.door})"` : ` onclick="Step('${move.dir}')"`) : "";
      html += `<div class="mCell ${reach ? "reach" : ""}" style="grid-column:${x + 1};grid-row:${y + 1}"${click}>${pawnsByCell[k] || ""}</div>`;
    }
  }

  if(map.stage)
  {
    const s = map.stage;
    html += `<div class="mStage" style="grid-column:${s.x + 1}/span ${s.w};grid-row:${s.y + 1}/span ${s.h}">Palco</div>`;
  }

  const passages = AsList(map.passages);

  rooms.forEach(r =>
  {
    const reach = reachRooms.has(r.id);
    const pass = passages.find(p => p.a === r.id || p.b === r.id);
    const enter = reach ? AsList(prompt.moves).find(m => m.room === r.id) : null;
    const click = enter ? ` onclick="Step('${enter.dir}')" role="button" aria-label="Entrar em ${Esc(ItemName(r.id))}"` : "";
    const doors = AsList(r.doors).map(d => DoorHTML(r, d)).join("");

    html += `<div class="mRoom ${reach ? "reach" : ""}" style="grid-column:${r.x + 1}/span ${r.w};grid-row:${r.y + 1}/span ${r.h}"${click}>`
      + `<span class="mName">${Esc(MapName(r.id))}</span>${doors}`
      + (pass ? `<span class="mPass">${Esc(pass.id)}</span>` : "")
      + `<div class="pawns">${(pawnsByRoom[r.id] || []).join("")}</div></div>`;
  });

  return html + "</div>";
}

// Porta = traço de caneta sobre a parede. A porta do JSON é a casa de
// corredor colada no cômodo; o lado vem da posição dela em relação ao
// retângulo. Os -4px compensam a borda de 2px (o traço fica metade pra fora).
function DoorHTML(r, d)
{
  const fx = (d.x - r.x + 0.5) / r.w * 100;
  const fy = (d.y - r.y + 0.5) / r.h * 100;
  const along = (f, n) => `${(f - 40 / n).toFixed(2)}%`;

  if(d.y >= r.y + r.h) return `<i class="mDoor" style="bottom:-4px;height:4px;left:${along(fx, r.w)};width:${(80 / r.w).toFixed(2)}%"></i>`;
  if(d.y < r.y) return `<i class="mDoor" style="top:-4px;height:4px;left:${along(fx, r.w)};width:${(80 / r.w).toFixed(2)}%"></i>`;
  if(d.x >= r.x + r.w) return `<i class="mDoor" style="right:-4px;width:4px;top:${along(fy, r.h)};height:${(80 / r.h).toFixed(2)}%"></i>`;
  return `<i class="mDoor" style="left:-4px;width:4px;top:${along(fy, r.h)};height:${(80 / r.h).toFixed(2)}%"></i>`;
}

function RenderMapTab()
{
  const map = StudioMap();
  const me = Me();
  const myColor = me ? PersonColor(me.character) : "var(--paper)";

  const legend = [`<div><span class="legendMe" aria-hidden="true" style="background:${myColor}"></span><span>Bolinha amarela = você</span></div>`]
    .concat(AsList(map && map.passages).map(p =>
      `<div><span class="legendKey" aria-hidden="true">${Esc(p.id)}</span><span>${Esc(p.name || "Passagem secreta")}: ${Esc(MapName(p.a))} ↔ ${Esc(MapName(p.b))}</span></div>`))
    .join("");

  document.getElementById("mapView").innerHTML = `<div class="mapFrame">${MapHTML(false)}</div>`
    + `<div class="legend">${legend}</div>`
    + `<div id="mapLog" class="miniLog">${LogHTML()}</div>`;
}


// =========================
// BLOQUINHO (GDD §5)
// =========================

// Colunas: só os OUTROS jogadores, na ordem da mesa a partir de você. (A
// coluna "Você" era toda automática; suas cartas viram linha "sua carta".)
function NoteColumns()
{
  const seats = Seating();
  const i = seats.indexOf(currentPlayerId);
  const others = i < 0 ? seats : seats.slice(i + 1).concat(seats.slice(0, i));
  return others.filter(id => id !== currentPlayerId);
}

// Símbolos em SVG inline (não dependem da fonte).
function NoteSymbolHTML(s)
{
  if(s === 1) return `<svg aria-hidden="true" width="20" height="18" viewBox="0 0 20 18"><path d="M3 10 L8 15 L17 3" style="fill:none;stroke:var(--yes);stroke-width:3.5;stroke-linecap:round;stroke-linejoin:round"></path></svg>`;
  if(s === 2) return `<svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18"><path d="M3 3 L15 15 M15 3 L3 15" style="fill:none;stroke:var(--pen);stroke-width:3.5;stroke-linecap:round"></path></svg>`;
  if(s === 3) return `<span class="q" aria-hidden="true">?</span>`;
  return "";
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

  const header = `<div class="nHead"><div class="nItemCol"></div>${cols.map(id =>
    `<div class="nCol">${PawnHTML(CharacterOf(id), 26)}<span class="nName">${Esc((PlayerName(id) || "?").slice(0, 5))}</span></div>`).join("")}</div>`;

  const section = (title, list) => `<h2 class="nSection">${title}</h2>` + list.map(it =>
  {
    // CONHECIDAS (minha mão ou na mesa): uma linha só, sem células.
    if(mine.has(it.id) || faceUp.has(it.id))
    {
      const isMine = mine.has(it.id);
      return `<div class="nKnown ${isMine ? "mine" : "face"}"><span class="nKnownName">${Esc(it.name)}</span><span class="why">${isMine ? "sua carta" : "na mesa"}</span></div>`;
    }

    const cells = cols.map(colId =>
    {
      const n = NoteOf(it.id, colId);
      const label = `${it.name}, ${PlayerName(colId)}: ${NoteWords[n.s]}${n.tag ? ` ${n.tag}` : ""}`;
      return `<button class="cell" aria-label="${Esc(label)}" onclick="TapNote('${it.id}','${colId}')">${NoteSymbolHTML(n.s)}${n.tag ? `<small>${Esc(n.tag)}</small>` : ""}</button>`;
    }).join("");

    return `<div class="nRow"><div class="nItem">${Esc(it.name)}</div>${cells}</div>`;
  }).join("");

  el.innerHTML = header + section("PESSOAS", People()) + section("ARMAS", Weapons()) + section("CÔMODOS", Rooms());

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
    return `<button class="tagChip" onclick="ApplyTag(${h.n})">Etiquetar ${Esc(label)}</button>`;
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

  el.innerHTML = `<h1 class="cardsTitle">Suas cartas <span>(inocentes)</span></h1><div class="cardsGrid">${hand.map(HandCardHTML).join("")}</div>` +
    (faceUp.length ? `<h2 class="cardsTitle second">Na mesa <span>(todo mundo sabe)</span></h2><div class="cardsGrid">${faceUp.map(TableCardHTML).join("")}</div>` : "");
}

function RenderGossips()
{
  const el = document.getElementById("tab-gossips");
  if(!el) return;

  const badge = document.getElementById("gossipBadge");
  if(currentTab === "gossips") seenGossipCount = gossips.length;
  badge.innerText = gossips.length > seenGossipCount ? gossips.length - seenGossipCount : "";

  if(!gossips.length)
  {
    el.innerHTML = `<p class="emptyText">Nenhuma fofoca ainda. Dê um palpite num cômodo pra alguém te contar uma!</p>`;
    return;
  }

  el.innerHTML = gossips.slice().reverse().map(g =>
  {
    const from = g.fromName || PlayerName(g.from);
    return `<div class="gossipItem">
        <div class="body">
          <div class="head">FOFOCA #${g.n} · DE ${Esc(from.toUpperCase())}</div>
          <div class="item">${Esc(ItemName(g.item))}</div>
          <p class="text">${Esc(g.text)}</p>
        </div>
        <button class="btnNoteRow" onclick="MarkGossip('${g.item}','${g.from}')">Anotar: ${Esc(from)} tem ${Esc(ItemName(g.item))}</button>
      </div>`;
  }).join("");
}

function LogHTML()
{
  return AsList(table && table.log).slice(-4).reverse().map(l => `<p>${Esc(l)}</p>`).join("");
}

function RenderMiniLog()
{
  document.getElementById("miniLog").innerHTML = LogHTML();
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

  document.getElementById("finalSolution").innerHTML = [final.person, final.weapon, final.room].map(StripCardHTML).join("");

  // A fala do culpado (entre “ ”) vai no marca-texto.
  document.getElementById("finalLine").innerHTML = Esc(final.line || "").replace(/“[^”]*”/, m => `<mark>${m}</mark>`);

  if(won && navigator.vibrate) navigator.vibrate([60, 40, 120]);
}
