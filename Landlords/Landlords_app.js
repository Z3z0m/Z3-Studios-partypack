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
// CONSTANTES (espelham LandlordsTheme.cs / LandlordsBoard.cs)
// =========================

const PawnColors = ["#E2584B", "#3E8EDE", "#5BC27A", "#F2C230", "#B06CD9", "#F08A3C", "#3CC8C8", "#E66BA8"];
const HotelLevel = 4;

const RejectedReasonLabels = {
  "not-now": "Agora não é hora disso.",
  "bankrupt": "Você faliu — agora é só torcer!",
  "no-card": "Você não tem essa carta.",
  "no-cash": "Dinheiro insuficiente.",
  "invalid-picks": "Escolha exatamente 2 dados.",
  "invalid-pos": "Local inválido.",
  "not-yours": "Esse local não é seu.",
  "not-here": "Só dá pra construir no terreno onde você acabou de parar.",
  "max-level": "Já tem hotel aí.",
  "no-building": "Não há construção pra vender.",
  "busy": "Espere o leilão/votação terminar.",
  "no-bidders": "Não tem ninguém pra dar lance.",
  "not-available": "Esse local é de outro jogador.",
  "invalid-price": "Defina um preço inicial válido.",
  "no-auction": "O leilão já acabou.",
  "not-eligible": "Você não pode dar lance nesse leilão.",
  "called-out": "Você já saiu desse leilão.",
  "bid-too-low": "Lance baixo demais.",
  "you-are-winning": "Você está ganhando — não dá pra sair agora!",
  "no-vote": "A votação já acabou.",
  "invalid-vote": "Voto inválido.",
  "invalid-target": "Escolha outro jogador.",
  "too-many-trades": "Você já tem propostas demais pendentes.",
  "invalid-trade": "Proposta inválida (locais com construção não podem ser negociados).",
  "trade-no-longer-valid": "Essa proposta não vale mais.",
  "unknown-action": "Ação desconhecida."
};


// =========================
// ESTADO
// =========================

let currentGameState = "Lobby";
let isHost = false;
let isGamePaused = false;

let board = null;      // currentState/boardInfo (estático)
let table = null;      // currentState/table (público)
let heldCards = [];    // players/{eu}/heldCards (privado)

let lastActionT = 0;
let panelKey = null;
let tradeBuilderKey = null;
let pickedDice = [];
let auctionPick = null; // { pos, isOwn }
let auctionSeg = null;  // "gov" | "own" — botão ativo na escolha do leilão
let rejectedTimeout = null;

let activeTab = "agora";  // agora | locais | negociar (proposta, sem botão na nav) | placar
let openHeld = new Set(); // cartas guardadas abertas (texto completo)
let openPlace = null;     // local aberto (card completo) na aba Locais

let countdownInterval = null;
let countdownKey = null;
let countdownRemaining = 0;

let auctionInterval = null;
let auctionClock = null; // { yellow, white, yellowTotal, whiteTotal, key }

let autoRoll = null;            // { turn, type } — "Rolar de novo" já rola quando a fase Roll chegar
let cardOkKey = null;           // painel em que o "OK" da carta já foi mandado (carta + botão = 1 OK só)
let buyProposalUsed = null;     // "turno|local" em que a proposta já foi enviada ou fechada (uma chance só)
let dismissedTrades = new Set(); // propostas recebidas já respondidas no pop-up
let popupTradeKey = null;

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

function Me() { return table && table.players ? table.players[currentPlayerId] : null; }
function PlayerName(id) { return id && table && table.players && table.players[id] ? table.players[id].name : "governo"; }
function PawnColor(id) { const p = table && table.players ? table.players[id] : null; return p ? PawnColors[p.colorIndex % PawnColors.length] : "#888"; }

function Space(pos) { return board && board.spaces ? board.spaces[pos] : null; }
function SpaceState(pos) { return table && table.board && table.board[pos] ? table.board[pos] : { ownerId: null, level: 0 }; }
function IsOwnable(space) { return space && (space.type === "property" || space.type === "transport"); }

function GroupColor(space)
{
  if(!space || !board) return "#666";
  if(space.type === "transport") return "#FFFFFF";
  const g = (board.groups || []).find(x => x.id === space.group);
  return g ? g.color : "#666";
}

// Nome do estado: grupo → group.region → regions[].name; transporte traz region direto.
function RegionName(space)
{
  if(!space || !board) return "";
  let regionId = space.region;
  if(!regionId && space.group)
  {
    const g = (board.groups || []).find(x => x.id === space.group);
    regionId = g && g.region;
  }
  const r = (board.regions || []).find(x => x.id === regionId);
  return r ? r.name : "";
}

// Texto legível sobre uma cor de fundo qualquer (cores do JSON variam muito).
function TextOn(hex)
{
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if(!m) return "#FFFFFF";
  const n = parseInt(m[1], 16);
  const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? "#121316" : "#FFFFFF";
}

function JoinNames(names)
{
  if(names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`;
}

function GroupSpaces(groupId) { return (board.spaces || []).filter(s => s.type === "property" && s.group === groupId); }

function OwnsFullGroup(playerId, groupId)
{
  return GroupSpaces(groupId).every(s => SpaceState(s.pos).ownerId === playerId);
}

function NextBuildCost(space, level) { return level >= 3 ? space.hotelCost : space.houseCost; }

function LevelLabel(level)
{
  if(!level) return "";
  return level >= HotelLevel ? "HOTEL" : "●".repeat(level);
}

function DiceName(dice)
{
  if(dice === "1d6back") return "1d6 pra trás";
  if(dice === "3d6pick2") return "3d6, usa 2";
  return dice || "2d6";
}

function MyPlaces()
{
  if(!board) return [];
  return (board.spaces || []).filter(s => IsOwnable(s) && SpaceState(s.pos).ownerId === currentPlayerId);
}

// MESMAS REGRAS de LandlordsGameManager.Economy (o host valida de verdade;
// aqui é só pra habilitar/desabilitar os botões certos).
function CanBuild(space)
{
  const me = Me();
  if(!me || space.type !== "property") return false;
  const st = SpaceState(space.pos);

  // As 3 condições (ver ValidateBuild no host):
  //   1. o terreno é meu;
  if(st.ownerId !== currentPlayerId || st.level >= HotelLevel) return false;

  //   2. acabei de me movimentar e parei em cima dele (o host manda
  //      prompt.pos + canBuildHere na fase Manage; 1 construção por parada);
  const p = table && table.prompt;
  if(!IsMyAction() || table.phase !== "Manage" || !p || !p.canBuildHere || p.pos !== space.pos || me.position !== space.pos) return false;

  //   3. tenho dinheiro pra construir.
  return me.cash >= NextBuildCost(space, st.level || 0);
}

function CanSellBuilding(space)
{
  if(space.type !== "property") return false;
  const st = SpaceState(space.pos);
  return st.ownerId === currentPlayerId && !!st.level;
}

function IsTradable(playerId, pos)
{
  const space = Space(pos);
  if(!IsOwnable(space) || SpaceState(pos).ownerId !== playerId) return false;
  if(space.type !== "property") return true;
  return GroupSpaces(space.group).every(s => !SpaceState(s.pos).level);
}

function IsMyAction() { return table && table.actorId === currentPlayerId; }
function HoldsCard(hold) { return heldCards.some(c => c.hold === hold); }

// Proposta de COMPRA: só do local onde o jogador parou, na própria vez,
// depois de resolver a casa (aluguel pago → fase Manage).
function TradeHere()
{
  const me = Me();
  if(!me || me.bankrupt || !IsMyAction() || table.phase !== "Manage") return null;

  const space = Space(me.position);
  if(!IsOwnable(space)) return null;

  const ownerId = SpaceState(space.pos).ownerId;
  if(!ownerId || ownerId === currentPlayerId) return null;

  const owner = table.players[ownerId];
  if(!owner || owner.bankrupt) return null;

  return { pos: space.pos, ownerId, tradable: IsTradable(ownerId, space.pos) };
}

function CanBuildAny() { return MyPlaces().some(s => CanBuild(s)); }

// Uma chance por parada: enviou ou fechou no "X", acabou.
function BuyKey(here) { return `${table.turnNumber}|${here.pos}`; }
function CanBuyHere() { const h = TradeHere(); return !!(h && h.tradable && BuyKey(h) !== buyProposalUsed); }

// Fases em que o ator precisa tocar em algo (Moving/ShowCard/Idle não contam).
const DecisionPhases = ["Roll", "JailChoice", "PickDice", "BuyDecision", "AuctionChoice", "Debt", "Manage", "TransportRoll", "PayRent"];

// "Precisam de mim agora?" — usado no aviso da aba Agora e no contorno da placa.
function NeedsMe()
{
  const me = Me();
  if(!table || !me || me.bankrupt) return false;

  if(IsMyAction() && DecisionPhases.includes(table.phase)) return true;

  // Carta tirada: o host espera o "OK, li" de quem tirou.
  if(IsMyAction() && table.phase === "ShowCard" && table.prompt && table.prompt.type === "cardOk") return true;

  const a = table.auction;
  if(table.phase === "Auction" && a && (a.eligible || []).includes(currentPlayerId) && !(a.calledOut || []).includes(currentPlayerId)) return true;

  const v = table.vote;
  if(table.phase === "Vote" && v && !v.closed && (v.voters || []).includes(currentPlayerId) && !(v.voted || []).includes(currentPlayerId)) return true;

  if(table.phase === "RerollWindow" && HoldsCard("reroll")) return true;

  return false;
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
  activeTab = tab;
  document.getElementById("playingScreen").dataset.tab = tab;
  document.querySelectorAll(".navBtn").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  document.querySelectorAll(".tabBody").forEach(b => b.classList.toggle("active", b.id === `tab-${tab}`));
  document.querySelectorAll(".dockSet").forEach(b => b.classList.toggle("active", b.id === `dock-${tab}`));
  document.getElementById("mainScroll").scrollTop = 0;
  RenderNavAlerts();
};

function RenderNavAlerts()
{
  if(!table || !board) return;

  const agora = document.getElementById("agoraBadge");
  const needsMe = activeTab !== "agora" && NeedsMe();
  agora.innerText = needsMe ? "!" : "";
  agora.classList.toggle("alert", needsMe);

  // Dívida: aponta pra Locais (onde se vende/hipoteca) enquanto está em Agora.
  const locais = document.getElementById("locaisBadge");
  locais.innerText = activeTab === "agora" && table.phase === "Debt" && IsMyAction() ? "!" : "";
}


// =========================
// START
// =========================

window.onload = function()
{
  document.getElementById("lobbyName").innerText = currentPlayerName || "";
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
// HOST CONTROLS
// =========================

async function CheckIfHost()
{
  const snapshot = await get(ref(db, `rooms/${currentRoomCode}/players/${currentPlayerId}/isHost`));
  isHost = snapshot.val() === true;
  UpdateHostButton(currentGameState);

  // "Pular decisão atual" mora na faixa de botões da aba Agora.
  panelKey = null;
  RenderAll();
}

window.SendHostCommand = async function()
{
  await set(ref(db, `rooms/${currentRoomCode}/hostCommand`), Date.now());
};

window.SendTutorialAction = async function(action)
{
  await set(ref(db, `rooms/${currentRoomCode}/tutorialAction`), { action: action, t: Date.now() });
};

// Os botões do host ficam em cada tela (.hostOnly): "Começar Jogo" no lobby,
// controles no tutorial, "Jogar de Novo" no fim. Em Playing, "Pular decisão
// atual" (mesmo efeito do timeout) é montado na faixa de botões — ver HostSkipHTML.
function UpdateHostButton(state)
{
  document.body.classList.toggle("isHost", isHost);
}

function HostSkipHTML()
{
  return isHost ? Btn("Pular decisão atual", "SendHostCommand()", { kind: "ghost" }) : "";
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
    console.log("[Landlords] Aba voltou ao foco — ressincronizando.");
    ListenForGameState();
    if(currentGameState === "Playing") OpenPlaying();
  });
}

function ApplyGameState(gameState)
{
  if(!gameState || gameState === currentGameState) return;

  currentGameState = gameState;
  UpdateHostButton(gameState);

  if(gameState === "Lobby") { StopPlayingListeners(); ShowScreen("lobbyScreen"); }

  if(gameState === "Tutorial") ShowScreen("tutorialScreen"); // controles: .hostOnly

  if(gameState === "Playing") { ShowScreen("playingScreen"); OpenPlaying(); }

  if(gameState === "FinalScore") { StopPlayingListeners(); ShowScreen("finalScoreScreen"); OpenFinalScore(); }
}


// =========================
// AÇÕES (cada jogador escreve na PRÓPRIA caixa — ver LandlordsGameManager.HandleActionsChanged)
// =========================

async function SendAction(type, extra)
{
  if(isGamePaused) return;

  // t estritamente crescente: o host descarta ações com t <= a última vista.
  lastActionT = Math.max(Date.now(), lastActionT + 1);

  await set(ref(db, `rooms/${currentRoomCode}/actions/${currentPlayerId}`), Object.assign({ type: type, t: lastActionT }, extra || {}));
}

window.Act = function(type, pos)
{
  SendAction(type, pos === undefined ? {} : { pos: pos });
};


// =========================
// OPEN PLAYING
// =========================

function StopPlayingListeners()
{
  unsubscribers.forEach(u => u());
  unsubscribers = [];
  StopCountdown();
  StopAuctionClock();
  HideTradePopup();
}

async function OpenPlaying()
{
  StopPlayingListeners();

  panelKey = null;
  tradeBuilderKey = null;
  if(activeTab === "negociar") ShowTab("agora");

  const boardSnapshot = await get(ref(db, `rooms/${currentRoomCode}/currentState/boardInfo`));
  board = boardSnapshot.val();

  unsubscribers.push(onValue(ref(db, `rooms/${currentRoomCode}/currentState/table`), (snapshot) =>
  {
    if(!snapshot.exists()) return;
    table = snapshot.val();
    RenderAll();
  }));

  unsubscribers.push(onValue(ref(db, `rooms/${currentRoomCode}/players/${currentPlayerId}/heldCards`), (snapshot) =>
  {
    heldCards = snapshot.exists() ? Object.values(snapshot.val()) : [];
    panelKey = null; // "Não valeu!"/Pista livre dependem das cartas
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

function RenderAll()
{
  if(!table || !board) return;

  RenderMe();
  RenderActionPanel();
  RenderPlaces();
  RenderTrades();
  RenderPlayers();
  RenderMiniLog();
  RenderNavAlerts();
  SyncCountdown();
}


// =========================
// MEU STATUS
// =========================

function RenderMe()
{
  const me = Me();
  if(!me) return;

  const color = me.bankrupt ? "#9AA0A8" : PawnColors[me.colorIndex % PawnColors.length];
  document.getElementById("meName").innerText = me.name;

  const space = Space(me.position);
  let sub = space ? space.name : "";
  if(me.inJail) sub = `Na Prisão (${me.jailTurns}/${board.maxJailTurns || 3})`;
  if(me.pendingDiceMod) sub += ` · próxima jogada: ${DiceName(me.pendingDiceMod)}`;
  if(me.bankrupt) sub = "Faliu";

  const band = document.getElementById("mePlace");
  band.innerText = sub;
  band.style.background = color;
  band.style.color = TextOn(color);

  document.getElementById("mePlate").classList.toggle("turn", NeedsMe());

  const cashEl = document.getElementById("meCash");
  cashEl.innerText = me.bankrupt ? "FALIU" : `$${me.cash}`;
  cashEl.classList.toggle("out", !!me.bankrupt);

  RenderHeldCards();
}

// Compactas (só o título); tocar abre o texto completo.
function HeldKey(c) { return `${c.hold}|${c.title}`; }

function RenderHeldCards()
{
  const me = Me();
  const cards = me && me.bankrupt ? [] : heldCards;

  document.getElementById("heldCards").innerHTML = cards
    .map((c, i) => `<button class="heldCard${openHeld.has(HeldKey(c)) ? " open" : ""}" onclick="ToggleHeld(${i})" aria-expanded="${openHeld.has(HeldKey(c))}">
      <span class="heldTitle">${Esc(c.title)}</span><span class="heldText">${Esc(c.text)}</span></button>`)
    .join("");
}

window.ToggleHeld = function(i)
{
  const c = heldCards[i];
  if(!c) return;
  const key = HeldKey(c);
  if(openHeld.has(key)) openHeld.delete(key); else openHeld.add(key);
  RenderHeldCards();
};


// =========================
// PAINEL DA FASE
// =========================

function RenderActionPanel()
{
  const el = document.getElementById("actionPanel");
  const phase = table.phase;
  const prompt = table.prompt || {};
  const mine = IsMyAction();
  const me = Me();

  // CHAVE: só reconstrói o HTML quando a "situação" muda — evita perder o
  // foco/valor de inputs (lance, preço inicial) a cada atualização da mesa.
  const key = [
    phase, table.actorId, table.turnNumber, JSON.stringify(prompt),
    table.auction ? `${table.auction.pos}|${table.auction.type}|${(table.auction.calledOut || []).includes(currentPlayerId)}` : "",
    table.vote ? `${table.vote.cardId}|${(table.vote.voted || []).includes(currentPlayerId)}|${table.vote.closed}` : "",
    phase === "RerollWindow" || phase === "Idle" ? JSON.stringify(table.lastRoll || {}) : "",
    phase === "Manage" || phase === "Debt" ? me && me.cash : "",
    phase === "Manage" ? `${CanBuildAny()}|${CanBuyHere()}|${HoldsCard("roll1d20")}` : "",
    JSON.stringify(table.orderRoll || "")
  ].join("#");

  if(key !== panelKey)
  {
    panelKey = key;
    pickedDice = [];
    if(phase !== "AuctionChoice") { auctionPick = null; auctionSeg = null; }

    const built = BuildPanelHTML(phase, prompt, mine);
    el.innerHTML = built.body;
    document.getElementById("dock-agora").innerHTML = built.dock || "";
    if(activeTab === "agora") document.getElementById("mainScroll").scrollTop = 0;

    AnimateDice(el);
    if(phase === "AuctionChoice" && mine) RestoreAuctionChoice();
  }

  UpdatePanelDynamic(phase);
}

// ---- peças do painel ----

function Btn(label, onclick, o)
{
  o = o || {};
  const kind = { primary: "btnPrimary", ghost: "btnGhost", danger: "btnDanger", light: "btnGhostLight" }[o.kind || "primary"];
  const cls = ["btn", kind, o.big ? "btnBig" : "", o.half ? "btnHalf" : "", o.cls || ""].filter(Boolean).join(" ");
  return `<button class="${cls}"${o.id ? ` id="${o.id}"` : ""}${o.disabled ? " disabled" : ""} onclick="${onclick}">${label}</button>`;
}

// Placa da fase. O relógio (.panelTimer) some sozinho quando não há contagem.
function Head(title, o)
{
  o = o || {};
  return `<div class="head${o.tone ? ` tone-${o.tone}` : ""}"><div class="headInner">
    <div class="headText"><div class="headTitle">${title}</div>${o.small ? `<div class="headSmall">${o.small}</div>` : ""}</div>
    ${o.timer === false ? "" : `<span class="timer panelTimer"></span>`}</div></div>`;
}

function Line(text, kind) { return `<p class="line${kind ? " " + kind : ""}">${text}</p>`; }

function DiceCount(dice)
{
  if(dice === "3d6pick2") return 3;
  if(dice && dice !== "2d6" && dice.startsWith("1")) return 1;
  return 2;
}

function HeroDiceHTML(n)
{
  return `<div class="grow heroDice">${`<div class="heroDie">?</div>`.repeat(n)}</div>`;
}

// Pontinhos na grade 3×3 (mesma tabela de LandlordsDieUI.cs); acima de 6
// (1d12, 1d20) mostra o número.
const PipPatterns = [[], [4], [0, 8], [0, 4, 8], [0, 2, 6, 8], [0, 2, 4, 6, 8], [0, 2, 3, 5, 6, 8]];

function DieFaceHTML(value)
{
  if(value < 1 || value > 6) return `<span class="dieNumber">${value}</span>`;
  return Array.from({ length: 9 }, (_, i) => `<i class="${PipPatterns[value].includes(i) ? "pip" : ""}"></i>`).join("");
}

function MaxFace(dice)
{
  return { "1d4": 4, "1d12": 12, "1d20": 20 }[dice] || 6;
}

function DiceHTML(roll)
{
  if(!roll || !roll.values) return "";

  // Cada celular só mostra as PRÓPRIAS rolagens — as dos outros ficam na TV.
  if(roll.rollerId && roll.rollerId !== currentPlayerId) return "";

  const values = roll.values || [];
  const picked = roll.picked || [];

  const faces = values.map((v, i) =>
  {
    const dim = roll.dice === "3d6pick2" && picked.length === 2 && !picked.includes(i);
    return `<span class="die${dim ? " dim" : ""}" data-final="${v}">${DieFaceHTML(v)}</span>`;
  }).join("");

  const tag = roll.dice && roll.dice !== "2d6" ? `<span class="diceTag">${DiceName(roll.dice)}</span>` : "";
  const total = roll.dice === "1d6back" ? `← ${values[0]}` : (roll.total ? `= ${roll.total}` : "");
  const extra = [roll.doubles ? "DUPLA!" : "", roll.rerolled ? "Não valeu!" : ""].filter(Boolean).join(" · ");

  return `<div class="diceRow" data-serial="${roll.serial || 0}" data-max="${MaxFace(roll.dice)}">${tag}${faces}<span class="diceTotal">${total}${extra ? `<small>${extra}</small>` : ""}</span></div>`;
}

// ANIMAÇÃO DE ROLAGEM: só na primeira vez que uma rolagem (serial) aparece
// na tela — rebuilds do painel com a mesma rolagem mostram o resultado direto.
let lastAnimatedRollSerial = null;

function AnimateDice(container)
{
  const row = container.querySelector(".diceRow[data-serial]");
  if(!row) return;

  const serial = row.dataset.serial;
  if(serial === lastAnimatedRollSerial) return;
  lastAnimatedRollSerial = serial;

  const max = parseInt(row.dataset.max, 10) || 6;
  const dice = Array.from(row.querySelectorAll(".die[data-final]"));
  const total = row.querySelector(".diceTotal");

  row.classList.add("rolling");

  dice.forEach((die, i) =>
  {
    const swap = setInterval(() => { die.innerHTML = DieFaceHTML(1 + Math.floor(Math.random() * max)); }, 70);

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

// MESMA CONTA de LandlordsGameManager.ComputePropertyRent / PayRent:
// construção → rent[nível]; terreno → rent[0] (×2 com grupo completo);
// depois cada modificador de carta soma +% (arredondando pra cima).
// Transporte não tem valor fixo: 2d6 × multiplicador (pela qtd. do dono).
function CeilPercent(value, percent)
{
  if(value <= 0 || percent <= 0) return 0;
  return Math.floor((value * percent + 99) / 100);
}

function CurrentRent(space)
{
  const st = SpaceState(space.pos);
  const tags = space.tags || [];
  const transport = space.type === "transport";

  // Feriadão (com tag) só vale pros locais da tag; transporte só pega os sem tag.
  const mods = (table.modifiers || []).filter(m => m.tag == null || (!transport && tags.includes(m.tag)));
  const notes = mods.map(m => `${m.title} +${m.percent}%`);

  if(transport)
  {
    const m = board.transportRentMultipliers || [4, 8, 15, 25];
    const count = Math.max(1, (board.spaces || []).filter(s => s.type === "transport" && SpaceState(s.pos).ownerId === st.ownerId).length);
    const index = Math.min(count, m.length) - 1;
    return { text: `2d6×${m[index]}${mods.length ? "+" : ""}`, index, notes };
  }

  const level = Math.min(st.level || 0, HotelLevel);
  const full = level === 0 && !!st.ownerId && OwnsFullGroup(st.ownerId, space.group);

  let amount = level > 0 ? space.rent[level] : space.rent[0] * (full ? 2 : 1);
  mods.forEach(m => { amount += CeilPercent(amount, m.percent); });

  if(full) notes.unshift("grupo completo ×2");
  return { amount, text: `$${amount}`, index: level, notes };
}

// o.current: destaca em vermelho o aluguel que vale AGORA (aba Locais).
function SpaceCardHTML(pos, o)
{
  const s = Space(pos);
  if(!s) return "";

  o = o || {};
  const cur = o.current && IsOwnable(s) ? CurrentRent(s) : null;
  const nowNote = cur && cur.notes.length ? `<p class="spaceNote nowNote">Agora: ${Esc(cur.notes.join(" · "))}</p>` : "";

  let rentRows = "";

  if(s.type === "property" && s.rent)
  {
    const labels = ["Terreno", "1 casa", "2 casas", "3 casas", "Hotel"];
    rentRows = `<div class="rentTable">${s.rent.map((r, i) => cur && cur.index === i
        ? `<span class="now">${labels[i]} · agora</span><b class="now">$${cur.amount}</b>`
        : `<span>${labels[i]}</span><b>$${r}</b>`).join("")}</div>
      ${nowNote}
      <div class="buildCosts">
        <div class="buildCost"><span>Construir casa</span><b>$${s.houseCost}</b></div>
        <div class="buildCost"><span>Construir hotel</span><b>$${s.hotelCost}</b></div>
      </div>
      <p class="spaceNote">Grupo completo sem construção: aluguel base em dobro.</p>`;
  }
  else if(s.type === "transport")
  {
    const m = board.transportRentMultipliers || [4, 8, 15, 25];
    const list = m.map((x, i) => cur && cur.index === i ? `<b class="now">${x}</b>` : x).join(" / ");
    rentRows = `<p class="spaceNote">Aluguel = rolagem nova de 2d6 × ${list} (1 a ${m.length} transportes do dono).</p>`
      + (cur ? `<p class="spaceNote nowNote">Agora: 2d6 × ${m[cur.index]}${cur.notes.length ? " · " + Esc(cur.notes.join(" · ")) : ""}</p>` : "");
  }

  const region = RegionName(s).toUpperCase();
  const kicker = s.type === "transport" ? `TRANSPORTE${region ? " · " + region : ""}` : region;
  const color = GroupColor(s);
  const group = GroupLineText(s);

  return `<div class="spaceCard">
    <div class="spaceBand" style="background:${color}; color:${TextOn(color)}"><div class="spaceBandInner">
      <div class="spaceBandText"><div class="spaceState">${Esc(kicker)}</div><div class="spaceName">${Esc(s.name)}</div></div>
      <div class="spacePrice">$${s.price}</div>
    </div></div>
    ${rentRows}
    ${group ? `<div class="spaceGroup">${group}</div>` : ""}
  </div>`;
}

// "No grupo: Arraial do Cabo e Búzios são de Bia · Urca está livre"
function GroupLineText(space)
{
  const others = space.type === "transport"
    ? (board.spaces || []).filter(s => s.type === "transport" && s.pos !== space.pos)
    : GroupSpaces(space.group).filter(s => s.pos !== space.pos);

  if(!others.length) return "";

  const buckets = new Map(); // dono ("" = livre) → nomes
  others.forEach(s =>
  {
    const owner = SpaceState(s.pos).ownerId || "";
    if(!buckets.has(owner)) buckets.set(owner, []);
    buckets.get(owner).push(Esc(s.name));
  });

  const parts = Array.from(buckets, ([owner, names]) =>
  {
    const many = names.length > 1;
    const list = JoinNames(names);
    if(!owner) return `${list} ${many ? "estão livres" : "está livre"}`;
    if(owner === currentPlayerId) return `${list} ${many ? "são seus" : "é seu"}`;
    return `${list} ${many ? "são" : "é"} de ${Esc(PlayerName(owner))}`;
  });

  return `${space.type === "transport" ? "Outros transportes" : "No grupo"}: ${parts.join(" · ")}`;
}

function CardHTML(card, tappable)
{
  const kind = ["imprevisto", "sorte", "global", "neutra"].includes(card.kind) ? card.kind : "imprevisto";
  const tap = tappable ? ` tappable" role="button" tabindex="0" aria-label="OK" onclick="CardOk()` : "";

  return `<div class="grow"><div class="drawnCard kind-${kind}${tap}"><div class="drawnInner">
    <span class="cardIcon" aria-hidden="true"></span>
    <div class="cardKind">${Esc(KindLabel(card.kind))} · ${Esc(PlayerName(card.drawnBy))}</div>
    <div class="cardTitle">${Esc(card.title)}</div>
    <div class="cardText">${Esc(card.text)}</div>
  </div></div></div>`;
}

function BuildPanelHTML(phase, prompt, mine)
{
  const actor = Esc(PlayerName(table.actorId));
  const me = Me();
  const skip = HostSkipHTML();
  const gray = { tone: "gray" };

  // Devolve { body, dock }: corpo rola no meio, dock fica fixo embaixo (polegar).
  const out = (body, dock) => ({ body, dock: (dock || "") + skip });

  if(me && me.bankrupt) return out(Head("Você faliu.", { tone: "dark", timer: false }) + Line("Acompanhe a viagem pela TV!"));

  switch(phase)
  {
    case "Roll":
    {
      // Sorteio da ordem (antes do 1º turno): maior soma começa.
      if(prompt.type === "orderRoll")
      {
        if(!mine) return out(Head(`Quem começa? Vez de ${actor}`, gray) + OrderRollHTML());
        return out(
          Head("QUEM COMEÇA?")
          + Line("Role os dados: maior soma joga primeiro.", "hint")
          + HeroDiceHTML(2)
          + OrderRollHTML(),
          Btn("ROLAR 2D6", "Act('roll')", { big: true }));
      }

      if(!mine) return out(Head(`Vez de ${actor}`, gray) + Line("Rolando os dados...", "hint"));

      // Tirou dupla e apertou "Rolar de novo": rola direto, sem segundo toque.
      if(autoRoll && autoRoll.turn === table.turnNumber && prompt.type === "roll" && !isGamePaused)
      {
        const type = autoRoll.type === "roll1d20" && prompt.canUse1d20 ? "roll1d20" : "roll";
        autoRoll = null;
        setTimeout(() => Act(type), 0);
        return out(Head("Rolando de novo...") + HeroDiceHTML(type === "roll1d20" ? 1 : DiceCount(prompt.dice)));
      }

      return out(
        Head("SUA VEZ!")
        + (prompt.dice && prompt.dice !== "2d6" ? Line(`Carta ativa: role ${DiceName(prompt.dice)}`, "warn") : "")
        + HeroDiceHTML(DiceCount(prompt.dice)),
        Btn(`ROLAR ${DiceName(prompt.dice).toUpperCase()}`, "Act('roll')", { big: true })
        + (prompt.canUse1d20 ? Btn("Usar Pista livre (1d20)", "Act('roll1d20')", { kind: "ghost" }) : ""));
    }

    case "JailChoice":
    {
      if(!mine) return out(Head(`${actor} está na Prisão`, gray));
      const maxJail = board.maxJailTurns || 3;
      const fine = board.jailFine != null ? board.jailFine : prompt.amount;
      return out(
        Head("Você está na Prisão", { tone: "dark" })
        + Line(`Dupla sai de graça. Na ${maxJail}ª tentativa sem dupla, paga $${fine} e sai.`, "hint")
        + HeroDiceHTML(2),
        Btn("Tentar tirar dupla", "Act('rollJail')")
        + Btn(`Pagar $${prompt.amount}`, "Act('payJail')", { kind: "ghost", half: prompt.canUseLawyer, disabled: !prompt.canPayJail })
        + (prompt.canUseLawyer ? Btn("Usar Advogado", "Act('useLawyer')", { kind: "ghost", half: true }) : ""));
    }

    case "RerollWindow":
    {
      const rollerId = table.lastRoll && table.lastRoll.rollerId;
      const roller = Esc(PlayerName(rollerId));
      const can = HoldsCard("reroll");
      return out(
        Head(`Rolagem de ${roller}`, { tone: "yellow" }) + DiceHTML(table.lastRoll)
        + (rollerId !== currentPlayerId ? Line("Confira os dados na TV.", "hint") : "")
        + (can ? "" : Line(`Alguém pode dizer "Não valeu!"...`, "hint")),
        can ? Btn("NÃO VALEU!", "Act('reroll')", { kind: "danger", big: true }) : "");
    }

    case "PickDice":
    {
      if(!mine) return out(Head(`${actor} escolhe 2 dos 3 dados`, gray) + DiceHTML(table.lastRoll));
      const dice = (prompt.values || []).map((v, i) =>
        `<button class="die pickable" id="pick${i}" aria-label="Dado ${v}" onclick="TogglePick(${i})">${DieFaceHTML(v)}</button>`).join("");
      return out(
        Head("Morador local: escolha 2 dados") + `<div class="grow"><div id="pickRow" class="diceRow pickRow">${dice}</div></div>`,
        Btn("Andar", "ConfirmPick()", { id: "confirmPick", disabled: true }));
    }

    case "Moving":
      return out(Head(`${actor} na estrada...`, gray) + DiceHTML(table.lastRoll));

    case "ShowCard":
    {
      // Quem tirou confirma que leu (o host segura o jogo até o OK ou o timeout).
      // Tocar na própria carta também vale como OK.
      const canOk = mine && prompt.type === "cardOk";
      const card = CardHTML(table.lastCard || {}, canOk);
      if(canOk) return out(card, Btn("OK", "CardOk()", { big: true }));
      return out(card + (prompt.type === "cardOk" ? Line(`Esperando ${actor} ler a carta...`, "hint") : ""));
    }

    case "TransportRoll":
    {
      const place = Space(prompt.pos);
      const placeName = Esc(place ? place.name : "Transporte");
      const owner = Esc(PlayerName(prompt.creditorId));
      if(!mine) return out(Head(`${actor} caiu em ${placeName}`, gray) + Line(`Vai rolar 2d6 × ${prompt.amount} pro aluguel de ${owner}.`, "hint"));
      return out(
        Head(`Transporte de ${owner}`, { tone: "orange" })
        + Line(`${placeName}: aluguel = 2d6 × ${prompt.amount}.`)
        + HeroDiceHTML(2),
        Btn("ROLAR 2D6", "Act('roll')", { big: true }));
    }

    case "PayRent":
    {
      // Aluguel calculado: o jogador vê quanto e pra quem e confirma antes da cobrança.
      const owner = Esc(PlayerName(prompt.creditorId));
      const transportRoll = table.lastRoll && table.lastRoll.purpose === "transport";
      if(!mine) return out(Head(`${actor} paga $${prompt.amount} a ${owner}`, gray) + SpaceCardHTML(prompt.pos));
      return out(
        Head(`Aluguel: $${prompt.amount}`, { tone: "red" })
        + Line(`${Esc(prompt.reason || "Esse local")} é de ${owner}. Você tem $${me ? me.cash : 0}.`)
        + (transportRoll ? DiceHTML(table.lastRoll) : SpaceCardHTML(prompt.pos))
        + (prompt.canAfford ? "" : Line("Dinheiro insuficiente: depois de confirmar, você vai precisar levantar o valor.", "warn")),
        Btn(`PAGAR $${prompt.amount}`, "Act('ok')", { big: true }));
    }

    case "BuyDecision":
    {
      if(!mine) return out(Head(`${actor} decide se compra`, gray) + SpaceCardHTML(prompt.pos));
      return out(
        Head("Comprar?") + SpaceCardHTML(prompt.pos) + (prompt.canAfford ? "" : Line("Dinheiro insuficiente.", "warn")),
        Btn(`Comprar $${prompt.amount}`, "Act('buy')", { half: true, disabled: !prompt.canAfford })
        + Btn("Não comprar", "Act('decline')", { kind: "ghost", half: true }));
    }

    case "AuctionChoice":
    {
      if(!mine) return out(Head(`${actor} caiu no Leilão`, gray) + Line("Escolhendo o que leiloar...", "hint"));
      const built = BuildAuctionChoiceHTML();
      return out(built.body, built.dock);
    }

    case "Auction":
    {
      const built = BuildAuctionHTML();
      return out(built.body, built.dock);
    }

    case "Vote":
      return out(BuildVoteHTML());

    case "Debt":
    {
      if(!mine) return out(Head(`${actor} precisa levantar $${prompt.amount}`, gray));
      const cash = me ? me.cash : 0;
      const missing = (prompt.amount || 0) - cash;
      const creditor = Esc(PlayerName(prompt.creditorId));
      return out(
        Head(`Você deve $${prompt.amount}`, { tone: "red" })
        + Line(`${prompt.reason ? `${Esc(prompt.reason)} — para` : "Para"}: ${creditor}. Você tem $${cash}.`)
        + (missing > 0 ? Line(`Faltam $${missing}`, "warn") : "")
        + Line("Venda construções ou faça hipoteca em Locais.", "hint"),
        Btn("Ver meus locais", "ShowTab('locais')")
        + Btn("Declarar falência", "ConfirmBankrupt()", { kind: "danger" }));
    }

    case "Manage":
    {
      if(!mine) return out(Head(`Vez de ${actor}`, gray) + Line("Construindo ou negociando...", "hint"));
      const again = prompt.type === "manageRollAgain";

      // Parou num terreno seu e tem dinheiro: botão de construir lá.
      const spot = prompt.pos >= 0 ? Space(prompt.pos) : null;
      const here = spot && CanBuild(spot) ? spot : null;
      const hereSt = here ? SpaceState(here.pos) : null;
      const hereBtn = here
        ? Btn(`+ ${(hereSt.level || 0) >= 3 ? "Hotel" : "Casa"} em ${Esc(here.name)} $${NextBuildCost(here, hereSt.level || 0)}`, `Act('build', ${here.pos})`)
        : "";

      // Só oferece construir/negociar quando dá pra fazer de fato.
      const trade = TradeHere();
      const canBuy = CanBuyHere();
      const can1d20 = again && HoldsCard("roll1d20") && me && !me.pendingDiceMod;

      const endBtn = again
        ? Btn("ROLAR DE NOVO", "RollAgain('roll')", { big: true })
          + (can1d20 ? Btn("Rolar com Pista livre (1d20)", "RollAgain('roll1d20')", { kind: "ghost" }) : "")
        : Btn("ENCERRAR TURNO", "Act('endTurn')", { big: true });

      return out(
        Head(ManageTitle())
        + (here ? Line(`Você parou em ${Esc(here.name)}: pode construir lá agora.`, "warn") : "")
        + (canBuy ? Line(`Quer ${Esc(Space(trade.pos).name)}? Faça uma proposta de compra a ${Esc(PlayerName(trade.ownerId))}.`, "hint") : ""),
        hereBtn
        + (canBuy ? Btn("Fazer proposta", "OpenBuyProposal()", { kind: "ghost" }) : "")
        + endBtn);
    }

    default:
      if(table.orderRoll && table.orderRoll.active)
      {
        const o = table.orderRoll;
        if(o.done) return out(Head("Ordem definida!", { timer: false }) + OrderRollHTML());
        if(o.tiePause) return out(Head("Empate! Rolam de novo", { tone: "yellow", timer: false }) + OrderRollHTML());
        return out(Head("Quem começa?", gray) + DiceHTML(table.lastRoll) + OrderRollHTML());
      }

      // Idle logo depois de uma rolagem (antes do peão andar): é aqui que a
      // animação dos dados roda no celular.
      return out(Head(`Vez de ${Esc(PlayerName(table.currentTurnPlayerId))}`, gray) + DiceHTML(table.lastRoll));
  }
}

// Lista do sorteio da ordem: quanto cada um tirou (desempates com "/"); no
// fim, na ordem de jogo com a posição.
function OrderRollHTML()
{
  const o = table.orderRoll;
  if(!o) return "";

  const ids = o.done && o.order ? o.order : (table.seating || []);
  const tied = o.tied || [];

  const rows = ids.map((id, i) =>
  {
    const p = table.players[id];
    if(!p) return "";

    const rolls = (o.rolls && o.rolls[id]) || [];
    const value = rolls.length ? rolls.join(" / ") : "…";
    const rank = o.done ? `<span class="orderRank">${i + 1}º</span>` : "";
    const tie = !o.done && tied.includes(id) ? `<small>EMPATE</small>` : "";
    const rolling = !o.done && table.phase === "Roll" && table.actorId === id;

    return `<div class="orderRow${rolling ? " rolling" : ""}">
      <span class="orderStrip" style="background:${PawnColors[p.colorIndex % PawnColors.length]}"></span>
      ${rank}<span class="orderName">${Esc(p.name)}${id === currentPlayerId ? " (você)" : ""}</span>
      <span class="orderValue">${value}${tie}</span>
    </div>`;
  }).join("");

  return `<div class="orderList">${rows}</div>`;
}

function ManageTitle()
{
  if(table.prompt && table.prompt.type === "manageRollAgain") return "Dupla! Rola de novo";
  return CanBuildAny() || CanBuyHere() ? "Construa ou negocie" : "Fim da jogada";
}

window.RollAgain = function(type)
{
  if(isGamePaused) return;
  autoRoll = { turn: table.turnNumber, type };
  Act("endTurn");
};

window.CardOk = function()
{
  if(isGamePaused || cardOkKey === panelKey) return;
  cardOkKey = panelKey;
  Act("ok");
};

window.OpenBuyProposal = function()
{
  if(!CanBuyHere()) return;

  document.getElementById("tradeOfferCash").value = "";
  tradeBuilderKey = null;
  RenderTradeBuilder();
  ShowTab("negociar");
};

// Fechar no "X" (ou a vez acabar) gasta a chance da proposta.
window.CloseBuyProposal = function()
{
  const here = TradeHere();
  if(here) buyProposalUsed = BuyKey(here);
  panelKey = null;
  ShowTab("agora");
  RenderAll();
};

function KindLabel(kind)
{
  return { sorte: "SORTE", imprevisto: "IMPREVISTO", global: "EVENTO GLOBAL", neutra: "NA ESTRADA" }[kind] || "SORTE OU IMPREVISTO";
}

function UpdatePanelDynamic(phase)
{
  if(phase === "Auction") UpdateAuctionDynamic();
}

window.TogglePick = function(i)
{
  const idx = pickedDice.indexOf(i);
  if(idx >= 0) pickedDice.splice(idx, 1);
  else if(pickedDice.length < 2) pickedDice.push(i);

  document.querySelectorAll(".die.pickable").forEach((el, j) => el.classList.toggle("selected", pickedDice.includes(j)));
  document.getElementById("pickRow").classList.toggle("hasPick", pickedDice.length > 0);
  document.getElementById("confirmPick").disabled = pickedDice.length !== 2;
};

window.ConfirmPick = function()
{
  if(pickedDice.length !== 2) return;
  SendAction("pickDice", { picks: pickedDice.slice() });
};

window.ConfirmBankrupt = function()
{
  if(confirm("Tem certeza? Você sai do jogo.")) Act("bankrupt");
};


// =========================
// LEILÃO — escolha (casa 20)
// =========================

function BuildAuctionChoiceHTML()
{
  const free = (board.spaces || []).filter(s => IsOwnable(s) && !SpaceState(s.pos).ownerId);
  const own = MyPlaces();

  if(!auctionSeg || (auctionSeg === "gov" && !free.length) || (auctionSeg === "own" && !own.length))
    auctionSeg = free.length || !own.length ? "gov" : "own";

  const item = (s, isOwn) =>
    `<button class="pickItem" id="ap${s.pos}" onclick="PickAuctionSpace(${s.pos}, ${isOwn})">
      <span class="swatch" style="background:${GroupColor(s)}"></span>
      <span class="pickName">${Esc(s.name)}</span>
      <span class="pickPrice">$${s.price}${isOwn && SpaceState(s.pos).level ? " · " + LevelLabel(SpaceState(s.pos).level) : ""}</span></button>`;

  const body = Head("Leilão! O que vai à venda?")
    + `<div class="seg">
        <button id="segGov" class="segBtn" ${free.length ? "" : "disabled"} onclick="SetAuctionSeg('gov')">Do governo</button>
        <button id="segOwn" class="segBtn" ${own.length ? "" : "disabled"} onclick="SetAuctionSeg('own')">Meus locais</button>
      </div>`
    + (!free.length && !own.length ? Line("Nenhum local disponível pra leiloar.", "hint") : "")
    + `<div id="segListGov" class="segList">
        ${Line("Livres do governo (você ganha 5% de cashback)", "hint")}
        <div class="pickList">${free.map(s => item(s, false)).join("")}</div>
      </div>
      <div id="segListOwn" class="segList">
        ${Line("Seus locais (você define o preço inicial)", "hint")}
        <div class="pickList">${own.map(s => item(s, true)).join("")}</div>
        <div id="ownAuctionOptions" class="ownOptions" style="display:none">
          <label class="fieldRow">Preço inicial
            <input id="auctionStartPrice" class="numInput" type="number" min="1" step="1" inputmode="numeric" placeholder="$" />
          </label>
          <label id="withBuildingsRow" class="checkRow" style="display:none"><input id="auctionWithBuildings" type="checkbox" /> Vender junto com as construções (senão, são destruídas)</label>
        </div>
      </div>`;

  const dock = Btn("Leiloar", "ConfirmAuctionPick()", { id: "confirmAuctionPick", half: true, disabled: true })
    + Btn("Passar", "Act('auctionPass')", { kind: "ghost", half: true });

  return { body, dock };
}

// Depois de (re)montar o painel: aplica o botão ativo e a seleção atual.
function RestoreAuctionChoice()
{
  SetAuctionSeg(auctionSeg || "gov");
  if(auctionPick && document.getElementById(`ap${auctionPick.pos}`)) PickAuctionSpace(auctionPick.pos, auctionPick.isOwn);
}

window.SetAuctionSeg = function(seg)
{
  auctionSeg = seg;

  const gov = document.getElementById("segGov");
  if(!gov) return;
  gov.classList.toggle("active", seg === "gov");
  document.getElementById("segOwn").classList.toggle("active", seg === "own");
  document.getElementById("segListGov").style.display = seg === "gov" ? "" : "none";
  document.getElementById("segListOwn").style.display = seg === "own" ? "" : "none";

  // Seleção da outra lista não vale mais.
  if(auctionPick && auctionPick.isOwn !== (seg === "own"))
  {
    auctionPick = null;
    document.querySelectorAll(".pickItem").forEach(el => el.classList.remove("selected"));
    document.getElementById("ownAuctionOptions").style.display = "none";
    document.getElementById("confirmAuctionPick").disabled = true;
  }
};

window.PickAuctionSpace = function(pos, isOwn)
{
  auctionPick = { pos, isOwn };

  document.querySelectorAll(".pickItem").forEach(el => el.classList.toggle("selected", el.id === `ap${pos}`));
  document.getElementById("ownAuctionOptions").style.display = isOwn ? "flex" : "none";
  document.getElementById("withBuildingsRow").style.display = isOwn && SpaceState(pos).level ? "flex" : "none";
  document.getElementById("confirmAuctionPick").disabled = false;

  if(isOwn) document.getElementById("auctionStartPrice").value = Space(pos).price;
};

window.ConfirmAuctionPick = function()
{
  if(!auctionPick) return;

  const extra = { pos: auctionPick.pos };

  if(auctionPick.isOwn)
  {
    const price = parseInt(document.getElementById("auctionStartPrice").value, 10);
    if(!Number.isInteger(price) || price < 1) { ShowToast("Defina um preço inicial válido."); return; }
    extra.amount = price;
    extra.withBuildings = document.getElementById("auctionWithBuildings").checked;
  }

  SendAction("auctionPick", extra);
};


// =========================
// LEILÃO — lances + relógios
// =========================

function BuildAuctionHTML()
{
  const a = table.auction;
  if(!a) return { body: Head("Leilão encerrando...", { tone: "orange", timer: false }) };

  const eligible = (a.eligible || []).includes(currentPlayerId);
  const calledOut = (a.calledOut || []).includes(currentPlayerId);
  const who = a.type === "Government" ? "do governo" : `de ${Esc(PlayerName(a.sellerId))}`;
  const note = a.type === "Emergency" ? "Hipoteca: sem lance, o governo compra pela metade." : (a.withBuildings ? "Vai com as construções!" : "");

  let controls = "";
  let dock = "";

  if(!eligible) controls = Line("Você está vendendo — só assiste.", "hint");
  else if(calledOut) controls = Line("Você saiu desse leilão.", "hint");
  else
  {
    controls = `
      <label class="fieldRow">Seu lance
        <input id="bidInput" class="numInput numBig" type="number" min="1" step="1" inputmode="numeric" placeholder="$" />
      </label>
      <div class="quickBids">
        <button class="btn btnGhost btnQuick" onclick="QuickBid(1)">+1</button>
        <button class="btn btnGhost btnQuick" onclick="QuickBid(10)">+10</button>
        <button class="btn btnGhost btnQuick" onclick="QuickBid(50)">+50</button>
      </div>`;

    dock = Btn("DAR LANCE", "SendBid()", { id: "bidButton", half: true })
      + Btn("Sair", "Act('callout')", { id: "calloutButton", kind: "ghost", half: true });
  }

  const body = Head(`LEILÃO · ${Esc(Space(a.pos).name)}`, { tone: "orange", small: who, timer: false })
    + (note ? Line(note, "hint") : "")
    + `<div class="bidTop">
        <div id="clockWhite" class="clock" aria-hidden="true"><span class="clockGap"></span><span id="clockYellow" class="clockYellow"></span><span id="clockNumber" class="clockHole"></span></div>
        <div class="led bidLed"><div id="auctionHighest" class="bidValue"></div><div id="auctionHighestName" class="bidWho"></div></div>
      </div>`
    + controls;

  return { body, dock };
}

function UpdateAuctionDynamic()
{
  const a = table.auction;
  if(!a) return;

  const highestEl = document.getElementById("auctionHighest");
  if(highestEl) highestEl.innerText = a.highestBidderId ? `$${a.highestBid}` : `$${a.startPrice}`;

  const nameEl = document.getElementById("auctionHighestName");
  if(nameEl) nameEl.innerText = a.highestBidderId ? (a.highestBidderId === currentPlayerId ? "Você está ganhando!" : PlayerName(a.highestBidderId)) : "preço inicial — sem lances";

  const me = Me();
  const bidInput = document.getElementById("bidInput");

  if(bidInput)
  {
    bidInput.min = a.minBid;
    bidInput.max = me ? me.cash : 0;
    if(!bidInput.value || parseInt(bidInput.value, 10) < a.minBid) bidInput.value = Math.min(a.minBid, me ? me.cash : a.minBid);
  }

  const bidButton = document.getElementById("bidButton");
  if(bidButton) bidButton.disabled = !me || me.cash < a.minBid;

  const calloutButton = document.getElementById("calloutButton");
  if(calloutButton) calloutButton.disabled = a.highestBidderId === currentPlayerId;

  StartAuctionClock(a);
}

window.QuickBid = function(delta)
{
  const a = table && table.auction;
  if(!a) return;

  const input = document.getElementById("bidInput");
  const base = a.highestBidderId ? a.highestBid : a.startPrice - 1;
  input.value = Math.max(a.minBid, base + delta);
};

window.SendBid = function()
{
  const a = table && table.auction;
  const me = Me();
  if(!a || !me) return;

  const value = parseInt(document.getElementById("bidInput").value, 10);

  // Lance: só inteiro, maior que o atual, e o celular bloqueia acima do caixa (GDD §8).
  if(!Number.isInteger(value) || value < a.minBid) { ShowToast(`Lance mínimo: $${a.minBid}`); return; }
  if(value > me.cash) { ShowToast("Lance acima do seu caixa."); return; }

  SendAction("bid", { amount: value });
};

// Relógio local: o host só publica nas viradas (lance novo, amarelo zerou);
// entre elas o celular anima sozinho — amarelo gasta primeiro, branco depois.
function StartAuctionClock(a)
{
  const key = `${a.pos}|${a.highestBid}|${a.highestBidderId}|${Math.round(a.yellowRemaining * 10)}|${Math.round(a.whiteRemaining * 10)}`;
  if(auctionClock && auctionClock.key === key) return;

  auctionClock = { yellow: a.yellowRemaining, white: a.whiteRemaining, yellowTotal: a.yellowTotal || 10, whiteTotal: a.whiteTotal || 15, key };

  if(!auctionInterval) auctionInterval = setInterval(TickAuctionClock, 100);
  TickAuctionClock();
}

function TickAuctionClock()
{
  if(!auctionClock || !table || table.phase !== "Auction") { StopAuctionClock(); return; }

  if(!isGamePaused)
  {
    if(auctionClock.yellow > 0) auctionClock.yellow = Math.max(0, auctionClock.yellow - 0.1);
    else auctionClock.white = Math.max(0, auctionClock.white - 0.1);
  }

  const yellowRunning = auctionClock.yellow > 0;
  const yDeg = Math.round(360 * auctionClock.yellow / auctionClock.yellowTotal);
  const wDeg = Math.round(360 * auctionClock.white / auctionClock.whiteTotal);

  const yEl = document.getElementById("clockYellow");
  const wEl = document.getElementById("clockWhite");
  const nEl = document.getElementById("clockNumber");

  if(yEl) yEl.style.background = `conic-gradient(#F2C230 0 ${yDeg}deg, #33373D ${yDeg}deg 360deg)`;
  if(wEl) wEl.style.background = `conic-gradient(#F4F1EA 0 ${wDeg}deg, #33373D ${wDeg}deg 360deg)`;

  if(nEl)
  {
    nEl.innerText = Math.ceil(yellowRunning ? auctionClock.yellow : auctionClock.white);
    nEl.style.color = yellowRunning ? "#F2C230" : "#F4F1EA";
  }
}

function StopAuctionClock()
{
  if(auctionInterval) { clearInterval(auctionInterval); auctionInterval = null; }
  auctionClock = null;
}


// =========================
// VOTAÇÃO
// =========================

// Duas placas de estrada com setas opostas (opção 0 ←, opção 1 →).
function VoteSignHTML(i, label, o)
{
  const arrow = `<svg width="62" height="38" viewBox="0 0 56 34" style="transform:scaleX(${i === 0 ? 1 : -1})" aria-hidden="true"><path d="M20 3 4 17l16 14v-9h32V12H20z" fill="currentColor"></path></svg>`;
  const cls = ["voteSign", o.dim ? "dim" : "", o.lost ? "lost" : ""].filter(Boolean).join(" ");

  return `<button class="${cls}"${o.enabled ? ` onclick="SendVote(${i})"` : " disabled"}>
    <span class="voteSignInner">${arrow}<span class="voteLabel">${Esc(label)}</span>${o.count != null ? `<span class="voteCount">${o.count}</span>` : ""}</span></button>`;
}

function BuildVoteHTML()
{
  const v = table.vote;
  if(!v) return "";

  const options = v.options || ["A", "B"];

  // "continue" = fim do tempo/rodadas: continuar a partida? (choice 0 = continuar).
  const isContinue = v.kind === "continue";
  const rule = isContinue
    ? "A maioria decide. Empate encerra."
    : `A minoria paga $${v.amount} ao governo. Quem não votar também paga.`;

  if(v.closed)
  {
    const tally = v.tally || [0, 0];
    const tie = tally[0] === tally[1];
    return Head(Esc(v.title), { tone: "blue", timer: false })
      + Line(v.result ? Esc(v.result) : rule, "hint")
      + `<div class="grow voteRow">
          ${VoteSignHTML(0, options[0], { count: tally[0], lost: tally[0] < tally[1] || (isContinue && tie) })}
          ${VoteSignHTML(1, options[1], { count: tally[1], lost: tally[1] < tally[0] })}
        </div>`;
  }

  const canVote = (v.voters || []).includes(currentPlayerId);
  const voted = (v.voted || []).includes(currentPlayerId);

  // A escolha de cada um não é publicada (só "voted"): depois de votar, as
  // duas placas ficam apagadas por igual.
  const open = canVote && !voted;

  return Head(Esc(v.title), { tone: "blue" })
    + Line(rule, "hint")
    + (voted ? Line("Voto registrado! Esperando os outros...") : "")
    + `<div class="grow voteRow">
        ${VoteSignHTML(0, options[0], { enabled: open, dim: !open })}
        ${VoteSignHTML(1, options[1], { enabled: open, dim: !open })}
      </div>`;
}

window.SendVote = function(choice)
{
  SendAction("vote", { choice: choice });
};


// =========================
// MEUS LOCAIS (construir / vender / hipoteca)
// =========================

function RenderPlaces()
{
  const el = document.getElementById("placesList");
  const places = MyPlaces();
  const manageable = IsMyAction() && (table.phase === "Manage" || table.phase === "Debt");

  // Durante a Gestão/Dívida, a placa da fase (com o relógio) vem junto.
  let head = "";
  if(manageable && table.phase === "Debt")
  {
    const p = table.prompt || {};
    const me = Me();
    const missing = (p.amount || 0) - (me ? me.cash : 0);
    head = Head(`Você deve $${p.amount}`, { tone: "red", small: missing > 0 ? `Faltam $${missing}` : "" });
  }
  else if(manageable) head = Head(ManageTitle());
  document.getElementById("placesHead").innerHTML = head;

  if(!places.length) { el.innerHTML = Line("Você ainda não tem locais.", "hint"); return; }

  const refundPct = 50;

  el.innerHTML = places.map(s =>
  {
    const st = SpaceState(s.pos);
    const color = GroupColor(s);

    let actions = "";

    if(manageable)
    {
      if(s.type === "property" && table.phase === "Manage")
      {
        actions += `<button class="actBtn solid" ${CanBuild(s) ? "" : "disabled"} onclick="Act('build', ${s.pos})">+ ${(st.level || 0) >= 3 ? "Hotel" : "Casa"} $${NextBuildCost(s, st.level || 0)}</button>`;
      }

      if(st.level)
      {
        actions += `<button class="actBtn" ${CanSellBuilding(s) ? "" : "disabled"} onclick="Act('sellBuilding', ${s.pos})">Vender +$${Math.floor(NextBuildCost(s, st.level - 1) * refundPct / 100)}</button>`;
      }

      actions += `<button class="actBtn" ${table.auction ? "disabled" : ""} onclick="ConfirmMortgage(${s.pos})">Hipoteca</button>`;
    }

    // Fechado: só o nome + aluguel de agora. Tocar abre o card completo;
    // tocar de novo (ou em outro local) fecha.
    const open = openPlace === s.pos;
    const header = open
      ? `<div class="placeInfo" role="button" tabindex="0" aria-expanded="true" onclick="TogglePlace(${s.pos})">${SpaceCardHTML(s.pos, { current: true })}</div>`
      : `<button class="placeBand" style="background:${color}; color:${TextOn(color)}" aria-expanded="false" onclick="TogglePlace(${s.pos})">
          <span class="placeName">${Esc(s.name)}</span><span class="placeRent">${CurrentRent(s).text}</span>
        </button>`;

    return `<div class="placeCard${open ? " open" : ""}">${header}<div class="placeActions">${actions}</div></div>`;
  }).join("");
}

window.TogglePlace = function(pos)
{
  openPlace = openPlace === pos ? null : pos;
  RenderPlaces();
};

window.ConfirmMortgage = function(pos)
{
  const s = Space(pos);
  if(confirm(`Hipoteca de ${s.name}: vai a leilão por $${s.price}. Sem lance, o governo compra por $${Math.floor(s.price / 2)}. Construções são destruídas. Continuar?`))
  {
    Act("mortgage", pos);
  }
};


// =========================
// NEGOCIAÇÃO
// =========================

// Negociação só existe como PROPOSTA DE COMPRA: o jogador da vez parou no
// local de alguém, pagou o aluguel e toca em "Fazer proposta" (uma chance).
// Quem recebe responde num pop-up — não há aba nem lista de propostas.
function RenderTrades()
{
  const incoming = (table.trades || []).filter(t => t.toId === currentPlayerId);
  RenderTradePopup(incoming);

  if(activeTab === "negociar")
  {
    // A vez acabou/mudou de fase com a tela aberta: fecha (e gasta a chance).
    if(!CanBuyHere()) { CloseBuyProposal(); return; }
    RenderTradeBuilder();
  }
}

function DescribeTradeSide(cash, positions)
{
  const parts = (positions || []).map(p => Esc(Space(p).name));
  if(cash) parts.push(`$${cash}`);
  return parts.length ? parts.join(", ") : "nada";
}

// t (timestamp da proposta) entra na chave: os ids ("t1"...) recomeçam numa
// partida nova.
function TradeKey(t) { return `${t.id}|${t.t}`; }

// Proposta recebida: pop-up por cima de qualquer aba, até aceitar ou recusar.
function RenderTradePopup(incoming)
{
  const el = document.getElementById("tradePopup");
  const me = Me();
  const t = me && !me.bankrupt ? incoming.find(x => !dismissedTrades.has(TradeKey(x))) : null;
  const key = t ? TradeKey(t) : null;

  if(key === popupTradeKey) return;
  popupTradeKey = key;

  el.classList.toggle("active", !!t);
  if(!t) { el.innerHTML = ""; return; }

  if(navigator.vibrate) navigator.vibrate(60);

  el.innerHTML = `<div class="offerSign modalCard" role="dialog" aria-modal="true" aria-labelledby="tradePopupTitle"><div class="offerInner">
    <div id="tradePopupTitle" class="offerTitle">Proposta de ${Esc(PlayerName(t.fromId))}</div>
    <div class="offerLine">Oferece: <b>${DescribeTradeSide(t.offerCash, t.offerPos)}</b></div>
    <div class="offerLine">E pede: <b>${DescribeTradeSide(t.requestCash, t.requestPos)}</b></div>
    <div class="offerButtons">
      <button class="btn btnPrimary btnMid" onclick="TradeRespond('tradeAccept', '${t.id}')">Aceitar</button>
      <button class="btn btnGhostLight btnMid" onclick="TradeRespond('tradeReject', '${t.id}')">Recusar</button>
    </div>
  </div></div>`;
}

function HideTradePopup()
{
  popupTradeKey = null;
  const el = document.getElementById("tradePopup");
  el.classList.remove("active");
  el.innerHTML = "";
}

function RenderTradeBuilder()
{
  const here = TradeHere();
  if(!here) return;

  // Reconstrói só quando muda o local ou a posse de algum local — senão
  // perderia as caixas marcadas a cada atualização da mesa.
  const key = `${here.pos}|${here.ownerId}|${JSON.stringify((table.board || []).map(s => s ? `${s.ownerId}:${s.level}` : ""))}`;
  if(key === tradeBuilderKey) return;
  tradeBuilderKey = key;

  const space = Space(here.pos);
  document.getElementById("proposalSub").innerText = `${space.name} · de ${PlayerName(here.ownerId)}`;

  document.getElementById("tradeOfferList").innerHTML = (board.spaces || [])
    .filter(s => IsOwnable(s) && SpaceState(s.pos).ownerId === currentPlayerId)
    .map(s =>
    {
      const ok = IsTradable(currentPlayerId, s.pos);
      return `<label class="checkRow ${ok ? "" : "disabled"}">
        <input type="checkbox" data-pos="${s.pos}" class="offerPos" ${ok ? "" : "disabled"} />
        <span class="swatch" style="background:${GroupColor(s)}"></span><span>${Esc(s.name)}</span></label>`;
    })
    .join("") || Line("nenhum local", "hint");

  // Pedido fixo: o local onde você parou.
  document.getElementById("tradeRequestList").innerHTML =
    `<div class="checkRow"><span class="swatch" style="background:${GroupColor(space)}"></span><span>${Esc(space.name)}</span></div>`;
}

window.SendTradeProposal = function()
{
  const here = TradeHere();
  if(!here || !CanBuyHere()) { CloseBuyProposal(); return; }

  const offerPos = Array.from(document.querySelectorAll("input.offerPos:checked")).map(el => parseInt(el.dataset.pos, 10));
  const offerCash = Math.max(0, parseInt(document.getElementById("tradeOfferCash").value, 10) || 0);

  if(!offerPos.length && !offerCash) { ShowToast("Ofereça dinheiro ou algum local."); return; }

  const me = Me();
  if(me && offerCash > me.cash) { ShowToast("Você não tem esse dinheiro."); return; }

  SendAction("tradePropose", { targetId: here.ownerId, offerPos, requestPos: [here.pos], offerCash, requestCash: 0 });

  buyProposalUsed = BuyKey(here);
  document.getElementById("tradeOfferCash").value = "";
  tradeBuilderKey = null;
  panelKey = null;
  ShowTab("agora");
  RenderAll();
  ShowToast("Proposta enviada!");
};

window.TradeRespond = function(type, tradeId)
{
  const t = (table.trades || []).find(x => x.id === tradeId);
  if(t) dismissedTrades.add(TradeKey(t));
  SendAction(type, { tradeId });
  RenderTrades();
};


// =========================
// PLACAR + LOG
// =========================

function RenderPlayers()
{
  const el = document.getElementById("scoreList");

  el.innerHTML = (table.seating || []).map(id =>
  {
    const p = table.players[id];
    if(!p) return "";

    const places = (board.spaces || []).filter(s => IsOwnable(s) && SpaceState(s.pos).ownerId === id).length;
    const isTurn = id === table.currentTurnPlayerId;

    return `<div class="scoreRow${isTurn ? " turn" : ""}${p.bankrupt ? " bankrupt" : ""}">
      <div class="scoreStrip" style="background:${p.bankrupt ? "#9AA0A8" : PawnColors[p.colorIndex % PawnColors.length]}"></div>
      <div class="scoreBody">
        <div class="scoreTop"><span class="scoreName">${Esc(p.name)}${id === currentPlayerId ? " (você)" : ""}</span>
          <span class="scoreCash${p.bankrupt ? " out" : ""}">${p.bankrupt ? "FALIU" : "$" + p.cash}</span></div>
        <div class="scoreSub">${places} locais · patrimônio $${p.netWorth}${p.inJail ? " · PRESO" : ""}${p.holdsReroll ? " · tem \"Não valeu!\"" : ""}</div>
      </div>
    </div>`;
  }).join("");
}

// Agora: só a última mensagem (LED). Placar: as 3 últimas, a mais nova em cima.
function RenderMiniLog()
{
  const log = table.log || [];
  document.getElementById("ledLine").innerText = log.length ? log[log.length - 1] : "";
  document.getElementById("scoreLog").innerHTML = log.slice(-3).reverse().map(l => `<p>${Esc(l)}</p>`).join("");
}


// =========================
// CONTAGEM DA DECISÃO ATUAL
// =========================

function SyncCountdown()
{
  const key = `${table.phase}|${table.actorId}|${table.turnNumber}|${JSON.stringify(table.prompt || {})}|${(table.log || []).length}|${(table.log || []).slice(-1)[0]}`;

  if(key !== countdownKey)
  {
    countdownKey = key;
    countdownRemaining = Math.round(table.phaseDuration || 0);
    StopCountdown();

    if(countdownRemaining > 0 && table.phase !== "Auction")
    {
      countdownInterval = setInterval(() =>
      {
        if(!isGamePaused && countdownRemaining > 0) countdownRemaining--;
        PaintCountdown();
      }, 1000);
    }
  }

  PaintCountdown();
}

function PaintCountdown()
{
  // Pode haver mais de um relógio (Agora e o topo de Locais).
  const text = countdownInterval && countdownRemaining > 0 ? `${countdownRemaining}s` : "";
  document.querySelectorAll(".panelTimer").forEach(el => { el.innerText = text; });
}

function StopCountdown()
{
  if(countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
}


// =========================
// TOAST
// =========================

function ShowToast(text)
{
  const el = document.getElementById("rejectedText");
  el.innerText = text;
  el.classList.add("active");

  clearTimeout(rejectedTimeout);
  rejectedTimeout = setTimeout(() => el.classList.remove("active"), 2400);
}


// =========================
// FINAL
// =========================

async function OpenFinalScore()
{
  const snapshot = await get(ref(db, `rooms/${currentRoomCode}/currentState/final`));
  const final = snapshot.val() || {};

  const reasons = {
    domination: "Dominou um estado inteiro!",
    monopolies: "Completou os grupos necessários!",
    lastSolvent: "Último de pé — todo mundo faliu!",
    backup: "Fim do tempo — maior patrimônio!"
  };

  const ranking = final.ranking || [];
  const winner = ranking.find(r => r.id === final.winnerId);

  document.getElementById("finalWinner").innerText = final.winnerId === currentPlayerId ? "VOCÊ VENCEU!" : (winner ? winner.name : "");
  document.getElementById("finalReason").innerText = reasons[final.reason] || "";

  document.getElementById("finalRanking").innerHTML = ranking.map((r, i) =>
  {
    const color = r.bankrupt ? "#9AA0A8" : PawnColors[(r.colorIndex || 0) % PawnColors.length];
    return `<div class="rankRow${r.id === currentPlayerId ? " me" : ""}${r.bankrupt ? " bankrupt" : ""}">
      <div class="rankNum" style="background:${color}; color:${TextOn(color)}">${i + 1}º</div>
      <div class="rankBody"><span class="rankName">${Esc(r.name)}</span><span class="rankValue">${r.bankrupt ? "FALIU" : "$" + r.netWorth}</span></div>
    </div>`;
  }).join("");
}


// =========================
// MODO BOT (só carrega com ?bot=… na URL — ver bot/README.md)
// getState é SÓ LEITURA: o cérebro (Landlords_bot.js) decide olhando o
// estado, mas age tocando nos mesmos botões que o jogador.
// =========================

if(params.has("bot"))
{
  import("../bot/bot.js")
    .then((bot) => bot.StartBot(
    {
      game: "Landlords",
      brain: () => import("./Landlords_bot.js"),
      getState: () => (
      {
        gameState: currentGameState,
        isHost,
        isGamePaused,
        playerId: currentPlayerId,
        activeTab,
        board,
        table,
        heldCards: heldCards.slice()
      })
    }))
    .catch((error) => console.error("[Z3Bot]", error));
}
