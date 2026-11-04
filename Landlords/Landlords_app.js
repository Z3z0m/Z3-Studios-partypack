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
  "need-full-group": "Complete o grupo pra construir.",
  "max-level": "Já tem hotel aí.",
  "build-evenly": "Construa por igual no grupo.",
  "no-building": "Não há construção pra vender.",
  "sell-evenly": "Venda por igual no grupo (comece pelo mais construído).",
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
let rejectedTimeout = null;

let countdownInterval = null;
let countdownKey = null;
let countdownRemaining = 0;

let auctionInterval = null;
let auctionClock = null; // { yellow, white, yellowTotal, whiteTotal, key }

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
  if(space.type === "transport") return "#4A5568";
  const g = (board.groups || []).find(x => x.id === space.group);
  return g ? g.color : "#666";
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
  if(st.ownerId !== currentPlayerId || !OwnsFullGroup(currentPlayerId, space.group)) return false;
  if(st.level >= HotelLevel) return false;
  const minLevel = Math.min(...GroupSpaces(space.group).map(s => SpaceState(s.pos).level || 0));
  if((st.level || 0) > minLevel) return false;
  return me.cash >= NextBuildCost(space, st.level || 0);
}

function CanSellBuilding(space)
{
  if(space.type !== "property") return false;
  const st = SpaceState(space.pos);
  if(st.ownerId !== currentPlayerId || !st.level) return false;
  const maxLevel = Math.max(...GroupSpaces(space.group).map(s => SpaceState(s.pos).level || 0));
  return st.level >= maxLevel;
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
};


// =========================
// START
// =========================

window.onload = function()
{
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

  if(gameState === "Tutorial")
  {
    ShowScreen("tutorialScreen");
    document.getElementById("tutorialControls").style.display = isHost ? "flex" : "none";
  }

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
}

async function OpenPlaying()
{
  StopPlayingListeners();

  panelKey = null;
  tradeBuilderKey = null;

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
  SyncCountdown();
}


// =========================
// MEU STATUS
// =========================

function RenderMe()
{
  const me = Me();
  if(!me) return;

  document.getElementById("meDot").style.background = PawnColors[me.colorIndex % PawnColors.length];
  document.getElementById("meName").innerText = me.name;

  const space = Space(me.position);
  let sub = space ? space.name : "";
  if(me.inJail) sub = `Na Prisão (${me.jailTurns}/${board.maxJailTurns || 3})`;
  if(me.pendingDiceMod) sub += ` · próxima jogada: ${DiceName(me.pendingDiceMod)}`;
  if(me.bankrupt) sub = "Faliu";
  document.getElementById("mePlace").innerText = sub;

  const cashEl = document.getElementById("meCash");
  cashEl.innerText = me.bankrupt ? "—" : `$${me.cash}`;

  document.getElementById("heldCards").innerHTML = heldCards
    .map(c => `<div class="heldCard" title="${Esc(c.text)}"><b>${Esc(c.title)}</b><span>${Esc(c.text)}</span></div>`)
    .join("");
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
  const me = Me();

  // CHAVE: só reconstrói o HTML quando a "situação" muda — evita perder o
  // foco/valor de inputs (lance, preço inicial) a cada atualização da mesa.
  const key = [
    phase, table.actorId, table.turnNumber, JSON.stringify(prompt),
    table.auction ? `${table.auction.pos}|${table.auction.type}|${(table.auction.calledOut || []).includes(currentPlayerId)}` : "",
    table.vote ? `${table.vote.cardId}|${(table.vote.voted || []).includes(currentPlayerId)}|${table.vote.closed}` : "",
    phase === "RerollWindow" || phase === "Idle" ? JSON.stringify(table.lastRoll || {}) : "",
    phase === "Manage" || phase === "Debt" ? me && me.cash : ""
  ].join("#");

  if(key !== panelKey)
  {
    panelKey = key;
    pickedDice = [];
    if(phase !== "AuctionChoice") auctionPick = null;
    el.innerHTML = BuildPanelHTML(phase, prompt, mine);
    AnimateDice(el);
  }

  UpdatePanelDynamic(phase);
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

  const values = roll.values || [];
  const picked = roll.picked || [];

  const faces = values.map((v, i) =>
  {
    const dim = roll.dice === "3d6pick2" && picked.length === 2 && !picked.includes(i);
    return `<span class="die${dim ? " dim" : ""}" data-final="${v}">${DieFaceHTML(v)}</span>`;
  }).join("");

  const tag = roll.dice !== "2d6" ? `<span class="diceTag">${DiceName(roll.dice)}</span>` : "";
  const total = roll.dice === "1d6back" ? `← ${values[0]}` : (roll.total || "");
  const extra = (roll.doubles ? " · DUPLA!" : "") + (roll.rerolled ? " · Não valeu!" : "");

  return `<div class="diceRow" data-serial="${roll.serial || 0}" data-max="${MaxFace(roll.dice)}">${tag}${faces}<span class="diceTotal">${total}${extra}</span></div>`;
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

function SpaceCardHTML(pos)
{
  const s = Space(pos);
  if(!s) return "";

  let rentRows = "";

  if(s.type === "property" && s.rent)
  {
    const labels = ["Terreno", "1 casa", "2 casas", "3 casas", "Hotel"];
    rentRows = `<div class="rentTable">${s.rent.map((r, i) => `<span>${labels[i]}</span><b>$${r}</b>`).join("")}</div>
      <p class="hint">Grupo completo sem construção: aluguel base em dobro. Casa $${s.houseCost} · Hotel $${s.hotelCost}</p>`;
  }
  else if(s.type === "transport")
  {
    const m = board.transportRentMultipliers || [4, 8, 15, 25];
    rentRows = `<p class="hint">Aluguel = rolagem nova de 2d6 × ${m.join(" / ")} (1 a ${m.length} transportes do dono).</p>`;
  }

  return `<div class="spaceCard"><div class="spaceBand" style="background:${GroupColor(s)}">${Esc(s.group || "TRANSPORTE")}</div>
    <div class="spaceName">${Esc(s.name)}</div><div class="spacePrice">$${s.price}</div>${rentRows}</div>`;
}

function BuildPanelHTML(phase, prompt, mine)
{
  const actor = PlayerName(table.actorId);
  const timer = `<span id="panelTimer" class="timer"></span>`;
  const me = Me();

  if(me && me.bankrupt) return `<p class="phaseTitle">Você faliu.</p><p>Acompanhe a viagem pela TV!</p>`;

  switch(phase)
  {
    case "Roll":
      if(!mine) return `<p class="phaseTitle">Vez de ${Esc(actor)} ${timer}</p><p>Rolando os dados...</p>`;
      return `<p class="phaseTitle">SUA VEZ! ${timer}</p>
        ${prompt.dice && prompt.dice !== "2d6" ? `<p class="warn">Carta ativa: role ${DiceName(prompt.dice)}</p>` : ""}
        <button class="btn btnBig" onclick="Act('roll')">ROLAR ${DiceName(prompt.dice).toUpperCase()}</button>
        ${prompt.canUse1d20 ? `<button class="btn btnGhost" onclick="Act('roll1d20')">Usar Pista livre (1d20)</button>` : ""}`;

    case "JailChoice":
      if(!mine) return `<p class="phaseTitle">${Esc(actor)} está na Prisão ${timer}</p>`;
      return `<p class="phaseTitle">Você está na Prisão ${timer}</p>
        <button class="btn" onclick="Act('rollJail')">Tentar tirar dupla</button>
        <button class="btn btnGhost" ${prompt.canPayJail ? "" : "disabled"} onclick="Act('payJail')">Pagar $${prompt.amount}</button>
        ${prompt.canUseLawyer ? `<button class="btn btnGhost" onclick="Act('useLawyer')">Usar Advogado de plantão</button>` : ""}`;

    case "RerollWindow":
      return `<p class="phaseTitle">Rolagem de ${Esc(PlayerName(table.lastRoll && table.lastRoll.rollerId))}</p>${DiceHTML(table.lastRoll)}
        ${HoldsCard("reroll") ? `<button class="btn btnBig btnDanger" onclick="Act('reroll')">NÃO VALEU!</button>` : `<p class="hint">Alguém pode dizer "Não valeu!"...</p>`}`;

    case "PickDice":
      if(!mine) return `<p class="phaseTitle">${Esc(actor)} escolhe 2 dos 3 dados ${timer}</p>${DiceHTML(table.lastRoll)}`;
      return `<p class="phaseTitle">Morador local: escolha 2 dados ${timer}</p>
        <div class="diceRow">${(prompt.values || []).map((v, i) => `<button class="die pickable" id="pick${i}" onclick="TogglePick(${i})">${v}</button>`).join("")}</div>
        <button id="confirmPick" class="btn" disabled onclick="ConfirmPick()">Andar</button>`;

    case "Moving":
      return `<p class="phaseTitle">${Esc(actor)} na estrada...</p>${DiceHTML(table.lastRoll)}`;

    case "ShowCard":
      const card = table.lastCard || {};
      return `<div class="drawnCard kind-${Esc(card.kind)}"><p class="label">${Esc(KindLabel(card.kind))} · ${Esc(PlayerName(card.drawnBy))}</p>
        <p class="cardTitle">${Esc(card.title)}</p><p>${Esc(card.text)}</p></div>`;

    case "BuyDecision":
      if(!mine) return `<p class="phaseTitle">${Esc(actor)} decide se compra ${timer}</p>${SpaceCardHTML(prompt.pos)}`;
      return `<p class="phaseTitle">Comprar? ${timer}</p>${SpaceCardHTML(prompt.pos)}
        <div class="row">
          <button class="btn" ${prompt.canAfford ? "" : "disabled"} onclick="Act('buy')">Comprar $${prompt.amount}</button>
          <button class="btn btnGhost" onclick="Act('decline')">Não comprar</button>
        </div>
        ${prompt.canAfford ? "" : `<p class="warn">Dinheiro insuficiente.</p>`}`;

    case "AuctionChoice":
      if(!mine) return `<p class="phaseTitle">${Esc(actor)} caiu no Leilão ${timer}</p><p>Escolhendo o que leiloar...</p>`;
      return BuildAuctionChoiceHTML(timer);

    case "Auction":
      return BuildAuctionHTML();

    case "Vote":
      return BuildVoteHTML(timer);

    case "Debt":
      if(!mine) return `<p class="phaseTitle">${Esc(actor)} precisa levantar $${prompt.amount} ${timer}</p>`;
      return `<p class="phaseTitle warn">Você deve $${prompt.amount} ${timer}</p>
        <p>${Esc(prompt.reason || "")} — para: ${Esc(PlayerName(prompt.creditorId))}. Você tem $${me ? me.cash : 0}.</p>
        <p class="hint">Venda construções ou faça hipoteca em "Meus locais", ou negocie com alguém.</p>
        <button class="btn btnDanger" onclick="ConfirmBankrupt()">Declarar falência</button>`;

    case "Manage":
      if(!mine) return `<p class="phaseTitle">Vez de ${Esc(actor)} ${timer}</p><p>Construindo ou negociando...</p>`;
      const again = prompt.type === "manageRollAgain";
      return `<p class="phaseTitle">${again ? "Dupla! Rola de novo" : "Construa ou negocie"} ${timer}</p>
        <p class="hint">Construção e hipoteca em "Meus locais".</p>
        <button class="btn btnBig" onclick="Act('endTurn')">${again ? "ROLAR DE NOVO" : "ENCERRAR TURNO"}</button>`;

    default:
      // Idle logo depois de uma rolagem (antes do peão andar): é aqui que a
      // animação dos dados roda no celular.
      return `<p class="phaseTitle">Vez de ${Esc(PlayerName(table.currentTurnPlayerId))}</p>${DiceHTML(table.lastRoll)}`;
  }
}

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

function BuildAuctionChoiceHTML(timer)
{
  const free = (board.spaces || []).filter(s => IsOwnable(s) && !SpaceState(s.pos).ownerId);
  const own = MyPlaces();

  const item = (s, isOwn) =>
    `<button class="pickItem" id="ap${s.pos}" onclick="PickAuctionSpace(${s.pos}, ${isOwn})">
      <span class="swatch" style="background:${GroupColor(s)}"></span>${Esc(s.name)} <small>$${s.price}${isOwn && SpaceState(s.pos).level ? " · " + LevelLabel(SpaceState(s.pos).level) : ""}</small></button>`;

  return `<p class="phaseTitle">Leilão! O que vai à venda? ${timer}</p>
    ${free.length ? `<p class="label">Livres do governo (você ganha 5% de cashback)</p><div class="pickList">${free.map(s => item(s, false)).join("")}</div>` : ""}
    ${own.length ? `<p class="label">Seus locais (você define o preço inicial)</p><div class="pickList">${own.map(s => item(s, true)).join("")}</div>` : ""}
    <div id="ownAuctionOptions" style="display:none">
      <input id="auctionStartPrice" type="number" min="1" step="1" inputmode="numeric" placeholder="Preço inicial" />
      <label id="withBuildingsRow" class="checkRow" style="display:none"><input id="auctionWithBuildings" type="checkbox" /> Vender junto com as construções (senão, são destruídas)</label>
    </div>
    <div class="row">
      <button class="btn" id="confirmAuctionPick" disabled onclick="ConfirmAuctionPick()">Leiloar</button>
      <button class="btn btnGhost" onclick="Act('auctionPass')">Passar</button>
    </div>`;
}

window.PickAuctionSpace = function(pos, isOwn)
{
  auctionPick = { pos, isOwn };

  document.querySelectorAll(".pickItem").forEach(el => el.classList.toggle("selected", el.id === `ap${pos}`));
  document.getElementById("ownAuctionOptions").style.display = isOwn ? "block" : "none";
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
  if(!a) return `<p class="phaseTitle">Leilão encerrando...</p>`;

  const eligible = (a.eligible || []).includes(currentPlayerId);
  const calledOut = (a.calledOut || []).includes(currentPlayerId);
  const who = a.type === "Government" ? "do governo" : `de ${Esc(PlayerName(a.sellerId))}`;
  const note = a.type === "Emergency" ? "Hipoteca: sem lance, o governo compra pela metade." : (a.withBuildings ? "Vai com as construções!" : "");

  let controls;

  if(!eligible) controls = `<p class="hint">Você está vendendo — só assiste.</p>`;
  else if(calledOut) controls = `<p class="hint">Você saiu desse leilão.</p>`;
  else controls = `
    <input id="bidInput" type="number" min="1" step="1" inputmode="numeric" placeholder="Seu lance" />
    <div class="row quickBids">
      <button class="btn btnGhost" onclick="QuickBid(1)">+1</button>
      <button class="btn btnGhost" onclick="QuickBid(10)">+10</button>
      <button class="btn btnGhost" onclick="QuickBid(50)">+50</button>
    </div>
    <div class="row">
      <button class="btn" id="bidButton" onclick="SendBid()">DAR LANCE</button>
      <button class="btn btnGhost" id="calloutButton" onclick="Act('callout')">Sair</button>
    </div>`;

  return `<p class="phaseTitle">LEILÃO · ${Esc(Space(a.pos).name)} <small>${who}</small></p>
    ${note ? `<p class="hint">${note}</p>` : ""}
    <div class="auctionTop">
      <div class="clock"><div id="clockWhite" class="ring ringWhite"></div><div id="clockYellow" class="ring ringYellow"></div><div class="clockHole"><span id="clockNumber">25</span></div></div>
      <div class="auctionBid"><p class="label">Maior lance</p><p id="auctionHighest" class="bigNumber"></p><p id="auctionHighestName" class="hint"></p></div>
    </div>
    ${controls}`;
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

  if(yEl) yEl.style.background = `conic-gradient(#F2C230 ${yDeg}deg, transparent 0deg)`;
  if(wEl) wEl.style.background = `conic-gradient(#F4F1EA ${wDeg}deg, rgba(255,255,255,.1) 0deg)`;

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

function BuildVoteHTML(timer)
{
  const v = table.vote;
  if(!v) return "";

  const options = v.options || ["A", "B"];

  if(v.closed)
  {
    const tally = v.tally || [0, 0];
    return `<p class="phaseTitle">${Esc(v.title)}</p><p class="bigNumber">${Esc(options[0])}: ${tally[0]} · ${Esc(options[1])}: ${tally[1]}</p><p class="hint">A minoria paga $${v.amount}.</p>`;
  }

  const canVote = (v.voters || []).includes(currentPlayerId);
  const voted = (v.voted || []).includes(currentPlayerId);

  return `<p class="phaseTitle">${Esc(v.title)} ${timer}</p><p class="hint">A minoria paga $${v.amount} ao governo. Empate: ninguém paga.</p>
    ${!canVote ? "" : voted ? `<p>Voto registrado! Esperando os outros...</p>` : `
      <div class="row">
        <button class="btn btnBig" onclick="SendVote(0)">${Esc(options[0])}</button>
        <button class="btn btnBig" onclick="SendVote(1)">${Esc(options[1])}</button>
      </div>`}`;
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
  const el = document.getElementById("tab-places");
  const places = MyPlaces();

  if(!places.length) { el.innerHTML = `<p class="hint">Você ainda não tem locais.</p>`; return; }

  const manageable = IsMyAction() && (table.phase === "Manage" || table.phase === "Debt");
  const refundPct = 50;

  el.innerHTML = places.map(s =>
  {
    const st = SpaceState(s.pos);
    const full = s.type === "property" && OwnsFullGroup(currentPlayerId, s.group);

    let actions = "";

    if(manageable)
    {
      if(s.type === "property" && table.phase === "Manage")
      {
        actions += `<button class="btn btnSmall" ${CanBuild(s) ? "" : "disabled"} onclick="Act('build', ${s.pos})">+ ${(st.level || 0) >= 3 ? "Hotel" : "Casa"} $${NextBuildCost(s, st.level || 0)}</button>`;
      }

      if(st.level)
      {
        actions += `<button class="btn btnSmall btnGhost" ${CanSellBuilding(s) ? "" : "disabled"} onclick="Act('sellBuilding', ${s.pos})">Vender construção (+$${Math.floor(NextBuildCost(s, st.level - 1) * refundPct / 100)})</button>`;
      }

      actions += `<button class="btn btnSmall btnGhost" ${table.auction ? "disabled" : ""} onclick="ConfirmMortgage(${s.pos})">Hipoteca</button>`;
    }

    return `<div class="placeRow">
      <span class="swatch" style="background:${GroupColor(s)}"></span>
      <div class="placeInfo"><b>${Esc(s.name)}</b><small>${s.type === "transport" ? "Transporte" : Esc(s.group)}${full ? " · grupo completo" : ""} ${LevelLabel(st.level)}</small></div>
      <div class="placeActions">${actions}</div>
    </div>`;
  }).join("");
}

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

function RenderTrades()
{
  const trades = table.trades || [];
  const incoming = trades.filter(t => t.toId === currentPlayerId);
  const outgoing = trades.filter(t => t.fromId === currentPlayerId);

  const badge = document.getElementById("tradeBadge");
  badge.innerText = incoming.length ? incoming.length : "";

  const describe = (cash, positions) =>
  {
    const parts = (positions || []).map(p => Esc(Space(p).name));
    if(cash) parts.push(`$${cash}`);
    return parts.length ? parts.join(", ") : "nada";
  };

  document.getElementById("incomingTrades").innerHTML = incoming.map(t => `
    <div class="panel tradeCard">
      <p><b>${Esc(PlayerName(t.fromId))}</b> oferece: ${describe(t.offerCash, t.offerPos)}</p>
      <p>e pede: ${describe(t.requestCash, t.requestPos)}</p>
      <div class="row">
        <button class="btn btnSmall" onclick="TradeRespond('tradeAccept', '${t.id}')">Aceitar</button>
        <button class="btn btnSmall btnGhost" onclick="TradeRespond('tradeReject', '${t.id}')">Recusar</button>
      </div>
    </div>`).join("");

  document.getElementById("outgoingTrades").innerHTML = outgoing.map(t => `
    <div class="panel tradeCard">
      <p>Pra <b>${Esc(PlayerName(t.toId))}</b>: você dá ${describe(t.offerCash, t.offerPos)} · pede ${describe(t.requestCash, t.requestPos)}</p>
      <button class="btn btnSmall btnGhost" onclick="TradeRespond('tradeCancel', '${t.id}')">Cancelar</button>
    </div>`).join("");

  RenderTradeBuilder();
}

window.RenderTradeBuilder = function()
{
  const select = document.getElementById("tradeTarget");
  const others = (table.seating || []).filter(id => id !== currentPlayerId && table.players[id] && !table.players[id].bankrupt);

  const selected = others.includes(select.value) ? select.value : others[0];

  // Reconstrói só quando muda o alvo ou a posse de algum local — senão
  // perderia as caixas marcadas a cada atualização da mesa.
  const key = `${others.join(",")}|${selected}|${JSON.stringify((table.board || []).map(s => s ? `${s.ownerId}:${s.level}` : ""))}`;
  if(key === tradeBuilderKey) return;
  tradeBuilderKey = key;

  select.innerHTML = others.map(id => `<option value="${id}">${Esc(PlayerName(id))}</option>`).join("");
  if(selected) select.value = selected;

  const list = (playerId, prefix) => (board.spaces || [])
    .filter(s => IsOwnable(s) && SpaceState(s.pos).ownerId === playerId)
    .map(s => `<label class="checkRow ${IsTradable(playerId, s.pos) ? "" : "disabled"}">
      <input type="checkbox" data-pos="${s.pos}" class="${prefix}" ${IsTradable(playerId, s.pos) ? "" : "disabled"} />
      <span class="swatch" style="background:${GroupColor(s)}"></span>${Esc(s.name)}</label>`)
    .join("") || `<p class="hint">nenhum local</p>`;

  document.getElementById("tradeOfferList").innerHTML = list(currentPlayerId, "offerPos");
  document.getElementById("tradeRequestList").innerHTML = selected ? list(selected, "requestPos") : "";
};

window.SendTradeProposal = function()
{
  const targetId = document.getElementById("tradeTarget").value;
  if(!targetId) { ShowToast("Escolha com quem negociar."); return; }

  const checked = cls => Array.from(document.querySelectorAll(`input.${cls}:checked`)).map(el => parseInt(el.dataset.pos, 10));
  const cash = id => Math.max(0, parseInt(document.getElementById(id).value, 10) || 0);

  const proposal = {
    targetId,
    offerPos: checked("offerPos"),
    requestPos: checked("requestPos"),
    offerCash: cash("tradeOfferCash"),
    requestCash: cash("tradeRequestCash")
  };

  if(!proposal.offerPos.length && !proposal.requestPos.length && !proposal.offerCash && !proposal.requestCash)
  {
    ShowToast("Monte a proposta primeiro.");
    return;
  }

  SendAction("tradePropose", proposal);

  document.getElementById("tradeOfferCash").value = "";
  document.getElementById("tradeRequestCash").value = "";
  tradeBuilderKey = null;
  ShowToast("Proposta enviada!");
};

window.TradeRespond = function(type, tradeId)
{
  SendAction(type, { tradeId });
};


// =========================
// PLACAR + LOG
// =========================

function RenderPlayers()
{
  const el = document.getElementById("tab-players");

  el.innerHTML = (table.seating || []).map(id =>
  {
    const p = table.players[id];
    if(!p) return "";

    const places = (board.spaces || []).filter(s => IsOwnable(s) && SpaceState(s.pos).ownerId === id).length;
    const isTurn = id === table.currentTurnPlayerId;

    return `<div class="playerRow${isTurn ? " turn" : ""}${p.bankrupt ? " bankrupt" : ""}">
      <span class="dot" style="background:${PawnColors[p.colorIndex % PawnColors.length]}"></span>
      <div class="placeInfo"><b>${Esc(p.name)}${id === currentPlayerId ? " (você)" : ""}</b>
        <small>${places} locais · patrimônio $${p.netWorth}${p.inJail ? " · PRESO" : ""}${p.holdsReroll ? " · tem \"Não valeu!\"" : ""}</small></div>
      <b class="money">${p.bankrupt ? "FALIU" : "$" + p.cash}</b>
    </div>`;
  }).join("");
}

function RenderMiniLog()
{
  const log = table.log || [];
  document.getElementById("miniLog").innerHTML = log.slice(-3).reverse().map(l => `<p>${Esc(l)}</p>`).join("");
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
  const el = document.getElementById("panelTimer");
  if(el) el.innerText = countdownInterval && countdownRemaining > 0 ? `${countdownRemaining}s` : "";
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

  document.getElementById("finalRanking").innerHTML = ranking.map((r, i) => `
    <div class="playerRow${r.id === currentPlayerId ? " turn" : ""}">
      <b class="rank">${i + 1}º</b>
      <span class="dot" style="background:${PawnColors[(r.colorIndex || 0) % PawnColors.length]}"></span>
      <div class="placeInfo"><b>${Esc(r.name)}</b></div>
      <b class="money">${r.bankrupt ? "FALIU" : "$" + r.netWorth}</b>
    </div>`).join("");
}
