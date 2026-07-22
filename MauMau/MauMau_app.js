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


// =========================
// INIT FIREBASE
// =========================

const app = initializeApp(firebaseConfig);

const db = getDatabase(app);


// =========================
// URL PARAMS
// =========================

const params =
  new URLSearchParams(window.location.search);

const currentRoomCode =
  params.get("room");

const currentPlayerName =
  params.get("name");

const currentPlayerId =
  params.get("id");


// =========================
// VISUAL DAS CARTAS (design "MauMau Playing Redesign") — mesmo baralho
// original de MauMauCard.cs, sem replicar nenhum produto comercial. Cada
// carta é um ícone (SVG pras especiais, "+2" pro Comprar 2, número pras
// numéricas) sobre um fundo gradiente por cor — ver .color-* / .color-wild
// em MauMau_style.css.
// =========================

function CardVisualClass(card)
{
  return card.type === "Wild" ? "color-wild" : ColorClass(card.color);
}

// sizeKey: "top" (carta do topo do descarte) ou "hand" (cartas da mão) —
// só muda o tamanho do ícone, o desenho é o mesmo dos dois lados.
function CardVisualHTML(card, sizeKey)
{
  const svgSize = sizeKey === "top" ? 46 : 28;
  const plusSize = sizeKey === "top" ? 34 : 23;
  const wildDot = sizeKey === "top" ? 16 : 12;
  const wildHalo = sizeKey === "top" ? 4 : 3;

  if(card.type === "Number") return `<span>${card.value}</span>`;

  if(card.type === "Skip")
  {
    return `<svg width="${svgSize}" height="${svgSize}" viewBox="0 0 24 24">`
      + `<circle cx="12" cy="12" r="9" fill="none" stroke-width="2.4"></circle>`
      + `<line x1="6" y1="18" x2="18" y2="6" stroke-width="2.4"></line>`
      + `</svg>`;
  }

  if(card.type === "Reverse")
  {
    return `<svg width="${svgSize}" height="${svgSize}" viewBox="0 0 24 24" fill="none" stroke-width="2.2" stroke-linecap="round">`
      + `<path d="M4 8H17"></path><path d="M13 4L17 8L13 12"></path>`
      + `<path d="M20 16H7"></path><path d="M11 20L7 16L11 12"></path>`
      + `</svg>`;
  }

  if(card.type === "DrawTwo") return `<span style="font-size:${plusSize}px;">+2</span>`;

  // Wild
  return `<div style="width:${wildDot}px;height:${wildDot}px;border-radius:50%;background:rgba(255,255,255,.9);box-shadow:0 0 0 ${wildHalo}px rgba(255,255,255,.28);"></div>`;
}

function ColorClass(color)
{
  return "color-" + (color || "none").toLowerCase();
}

// SÓ PRO ANEL DE DESTAQUE do Curinga no topo do descarte (ver
// ApplyTableUpdate) — o Curinga sempre mostra a "pizza" de 4 cores (ver
// CardVisualClass), então sem esse anel não daria pra saber qual cor foi
// escolhida só de olhar pra carta.
const ActiveColorHex = { Red: "#e0473a", Blue: "#1f7fe8", Green: "#1fa85c", Yellow: "#eab308", None: "#ffffff" };

const RejectedReasonLabels = {
  "not-your-turn": "Ainda não é sua vez!",
  "invalid-card": "Carta inválida.",
  "illegal-move": "Essa carta não pode ser jogada agora.",
  "missing-color": "Escolha uma cor pro Curinga.",
  "must-play-drawn-card-or-pass": "Jogue a carta que você comprou, ou passe.",
  "already-drew": "Você já comprou nessa vez.",
  "nothing-to-pass": "Nada pra passar agora.",
  "must-stack-or-draw": "Só dá pra jogar outro +2 agora, ou comprar o monte!"
};


// =========================
// GAME STATE
// =========================

let currentGameState = "Lobby";
let isHost = false;
let isGamePaused = false;
let currentRound = 0;
let countdownInterval = null;

let playerNames = {};      // playerId -> nome, cacheado ao entrar em Playing/Result
let currentHand = [];      // cartas da MINHA mão (só eu leio esse nó, ver GDD)
let currentTable = null;   // último snapshot de currentState/table
let pendingWildIndex = null;
let rejectedTimeout = null;
let lastAttemptedCardIndex = null; // pro shake quando o HOST rejeita (raro — ver TriggerShake)

let handUnsubscribe = null;
let tableUnsubscribe = null;
let rejectedUnsubscribe = null;

// ANIMAÇÃO: cada par A/B existe só pra forçar o navegador a reiniciar a
// animação mesmo quando ela dispara duas vezes seguidas com o mesmo nome
// (setar o MESMO valor de "animation" de novo não reinicia sozinho).
let topCardAnimToggle = false;
let bannerAnimToggle = false;
let shakeAnimToggle = false;

let previousHandLength = 0;
let dealingHand = false;     // true só na primeira mão da rodada (cascata de distribuição)
let enteringIndex = null;    // índice da carta recém-comprada (anima entrando)
let enteringTimeout = null;
let shakeIndex = null;       // índice da carta que levou "tremida" (jogada rejeitada)
let shakeTimeout = null;
let playingIndex = null;     // índice da carta sendo jogada (anima saindo antes de confirmar)
let playingTimeout = null;


// =========================
// SCREEN SYSTEM
// =========================

function ShowScreen(screenId)
{
  document
    .querySelectorAll(".screen")
    .forEach(screen =>
    {
      screen.classList.remove("active");
    });

  document
    .getElementById(screenId)
    .classList.add("active");
}


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


// =========================
// LISTEN FOR PAUSE
// =========================

function ListenForPause()
{
  onValue(
    ref(db, `rooms/${currentRoomCode}/gamePaused`),
    (snapshot) =>
    {
      isGamePaused = snapshot.val() === true;

      document
        .getElementById("pauseOverlay")
        .classList.toggle("active", isGamePaused);
    }
  );
}


// =========================
// HOST CONTROLS (botão único: começar / forçar fim da vez / jogar de novo)
// =========================

async function CheckIfHost()
{
  const snapshot =
    await get(ref(db, `rooms/${currentRoomCode}/players/${currentPlayerId}/isHost`));

  isHost = snapshot.val() === true;

  if(isHost)
  {
    UpdateHostButton(currentGameState);
  }
}

window.SendHostCommand = async function()
{
  await set(
    ref(db, `rooms/${currentRoomCode}/hostCommand`),
    Date.now()
  );
};

window.SendTutorialAction = async function(action)
{
  await set(
    ref(db, `rooms/${currentRoomCode}/tutorialAction`),
    { action: action, t: Date.now() }
  );
};

function UpdateHostButton(state)
{
  if(!isHost) return;

  const btn = document.getElementById("hostButton");

  // ESCONDE no Tutorial — lá a navegação é feita pelos botões próprios da
  // tela (SendTutorialAction), não pelo botão genérico de host.
  if(state === "Tutorial")
  {
    btn.style.display = "none";
    return;
  }

  btn.style.display = "block";

  const labels =
  {
    "Lobby":      "Começar Jogo",
    "Playing":    "Forçar Fim da Vez",
    "Result":     "Pular Etapa",
    "FinalScore": "Jogar de Novo",
  };

  btn.innerText =
    labels[state] ?? "Pular Etapa";
}


// =========================
// LISTEN GAME STATE
// =========================

let gameStateUnsubscribe = null;

function ListenForGameState()
{
  if(gameStateUnsubscribe)
  {
    gameStateUnsubscribe();
    gameStateUnsubscribe = null;
  }

  const stateRef =
    ref(db, `rooms/${currentRoomCode}/currentState/gameState`);

  gameStateUnsubscribe = onValue(stateRef, (snapshot) =>
  {
    ApplyGameState(snapshot.val());
  });
}


// =========================
// RECUPERA SINCRONIA AO VOLTAR O FOCO NA ABA (mesmo padrão de Stop_app.js)
// =========================

function ListenForVisibilityRecovery()
{
  document.addEventListener("visibilitychange", () =>
  {
    if(document.visibilityState !== "visible") return;

    console.log("[MauMau] Aba voltou ao foco — ressincronizando listener de estado.");

    ListenForGameState();
  });
}


// =========================
// APPLY GAME STATE
// =========================

function ApplyGameState(gameState)
{
  if(!gameState || gameState === currentGameState)
  {
    return;
  }

  currentGameState = gameState;

  StopCountdown();
  UpdateHostButton(gameState);

  if(gameState == "Lobby") { ShowScreen("lobbyScreen"); }

  if(gameState == "Tutorial")
  {
    ShowScreen("tutorialScreen");

    document
      .getElementById("tutorialControls")
      .style.display =
      isHost ? "flex" : "none";
  }

  if(gameState == "Playing")
  {
    ShowScreen("playingScreen");
    OpenPlaying();
  }

  if(gameState == "Result")
  {
    ShowScreen("resultScreen");
    OpenResult();
  }

  if(gameState == "FinalScore")
  {
    ShowScreen("finalScoreScreen");
    OpenFinalScore();
  }
}


// =========================
// COUNTDOWN (número + anel circular — ver .timerRing em MauMau_style.css)
// =========================

function StartCountdown(seconds, textElementId, ringElementId)
{
  StopCountdown();

  const total = seconds || 1;
  let remaining = Math.round(seconds);

  const textEl = document.getElementById(textElementId);
  const ringEl = ringElementId ? document.getElementById(ringElementId) : null;

  function applyRing()
  {
    if(!ringEl) return;

    const deg = Math.max(0, Math.round((remaining / total) * 360));
    ringEl.style.background = `conic-gradient(#ffd76b ${deg}deg, rgba(255,255,255,.18) 0deg)`;
  }

  function tick()
  {
    if(textEl) textEl.innerText = `${remaining}`;
    applyRing();

    if(isGamePaused) return;

    if(remaining <= 0)
    {
      StopCountdown();
      return;
    }

    remaining--;
  }

  tick();

  countdownInterval = setInterval(tick, 1000);
}

function StopCountdown()
{
  if(countdownInterval)
  {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
}


// =========================
// OPEN PLAYING
// =========================

async function OpenPlaying()
{
  pendingWildIndex = null;
  HideColorPicker();

  previousHandLength = 0;
  dealingHand = false;
  enteringIndex = null;
  shakeIndex = null;
  playingIndex = null;
  lastAttemptedCardIndex = null;

  const [roundSnapshot, playersSnapshot] =
    await Promise.all(
    [
      get(ref(db, `rooms/${currentRoomCode}/currentState/round`)),
      get(ref(db, `rooms/${currentRoomCode}/players`))
    ]);

  currentRound = roundSnapshot.val() || currentRound;
  document.getElementById("playingRoundNum").innerText = currentRound;

  playerNames = {};

  if(playersSnapshot.exists())
  {
    playersSnapshot.forEach((child) =>
    {
      playerNames[child.key] = (child.val() || {}).name || "???";
    });
  }

  if(handUnsubscribe) { handUnsubscribe(); handUnsubscribe = null; }

  handUnsubscribe = onValue(
    ref(db, `rooms/${currentRoomCode}/players/${currentPlayerId}/hand`),
    (snapshot) =>
    {
      const newHand = snapshot.exists() ? Object.values(snapshot.val()) : [];

      if(previousHandLength === 0 && newHand.length > 0)
      {
        // PRIMEIRA MÃO DA RODADA: cascata de distribuição em todas as cartas.
        dealingHand = true;
        setTimeout(() => { dealingHand = false; }, 400 + newHand.length * 60);
      }
      else if(newHand.length > previousHandLength)
      {
        // COMPROU (ou levou +2): só a carta nova entra animada.
        enteringIndex = newHand.length - 1;
        clearTimeout(enteringTimeout);
        enteringTimeout = setTimeout(() => { enteringIndex = null; BuildHand(); }, 480);
      }

      previousHandLength = newHand.length;
      currentHand = newHand;

      BuildHand();
    }
  );

  if(tableUnsubscribe) { tableUnsubscribe(); tableUnsubscribe = null; }

  tableUnsubscribe = onValue(
    ref(db, `rooms/${currentRoomCode}/currentState/table`),
    (snapshot) =>
    {
      if(!snapshot.exists()) return;
      ApplyTableUpdate(snapshot.val());
    }
  );

  if(rejectedUnsubscribe) { rejectedUnsubscribe(); rejectedUnsubscribe = null; }

  rejectedUnsubscribe = onValue(
    ref(db, `rooms/${currentRoomCode}/currentState/turnRejected`),
    (snapshot) =>
    {
      if(!snapshot.exists()) return;

      const data = snapshot.val();
      if(data.playerId !== currentPlayerId) return;

      ShowRejectedToast(data.reason);

      // SHAKE só na carta que a gente tentou jogar (raro — o host já rejeita
      // localmente a maioria via bot disabled, isso aqui cobre corrida de
      // estado, ex. o timer virar a vez bem na hora do toque).
      if(lastAttemptedCardIndex !== null) TriggerShake(lastAttemptedCardIndex);
    }
  );
}

function ApplyTableUpdate(table)
{
  const previous = currentTable;
  currentTable = table;

  const topCardChanged = !previous || JSON.stringify(previous.topCard) !== JSON.stringify(table.topCard);
  const turnChanged = !previous
    || previous.currentTurnPlayerId !== table.currentTurnPlayerId
    || previous.awaitingDrawFollowUp !== table.awaitingDrawFollowUp
    || previous.pendingDrawStack !== table.pendingDrawStack;

  const topCardEl = document.getElementById("topCardDisplay");
  topCardEl.className = "cardBox topCardBox " + CardVisualClass(table.topCard);
  topCardEl.innerHTML = CardVisualHTML(table.topCard, "top");

  topCardEl.style.boxShadow = table.topCard && table.topCard.type === "Wild"
    ? `0 0 0 4px ${ActiveColorHex[table.activeColor] || ActiveColorHex.None}, 0 10px 26px rgba(0,0,0,.45)`
    : "";

  if(topCardChanged)
  {
    topCardAnimToggle = !topCardAnimToggle;
    topCardEl.style.animation = `cardPop${topCardAnimToggle ? "A" : "B"} 0.4s cubic-bezier(.34,1.56,.64,1) both`;
  }

  const isMyTurn = table.currentTurnPlayerId === currentPlayerId;
  const bannerEl = document.getElementById("turnBannerText");

  if(isMyTurn)
  {
    if(table.pendingDrawStack > 0) bannerEl.innerText = `Jogue +2 ou compre ${table.pendingDrawStack}!`;
    else if(table.awaitingDrawFollowUp) bannerEl.innerText = "Jogue a carta que você comprou, ou passe!";
    else bannerEl.innerText = "SUA VEZ!";
  }
  else
  {
    const name = playerNames[table.currentTurnPlayerId] || "outro jogador";
    bannerEl.innerText = table.pendingDrawStack > 0
      ? `Vez de ${name} (sob ataque de +${table.pendingDrawStack})...`
      : `Vez de ${name}...`;
  }

  if(turnChanged)
  {
    bannerAnimToggle = !bannerAnimToggle;
    bannerEl.style.animation = `bannerFade${bannerAnimToggle ? "A" : "B"} 0.3s ease both`;
  }

  BuildHand();
  UpdateActionButtons();

  if(table.turnDuration)
  {
    StartCountdown(table.turnDuration, "turnCountdown", "timerRing");
  }
}

function IsCardPlayable(card)
{
  if(!currentTable || !currentTable.topCard) return false;

  if(card.type === "Wild") return true;
  if(card.color === currentTable.activeColor) return true;
  if(card.type !== "Number" && card.type === currentTable.topCard.type) return true;
  if(card.type === "Number" && currentTable.topCard.type === "Number" && card.value === currentTable.topCard.value) return true;

  return false;
}

function BuildHand()
{
  const container = document.getElementById("handContainer");
  container.innerHTML = "";

  const isMyTurn = currentTable && currentTable.currentTurnPlayerId === currentPlayerId;
  const followUp = currentTable && currentTable.awaitingDrawFollowUp;
  const underAttack = currentTable && currentTable.pendingDrawStack > 0;

  currentHand.forEach((card, index) =>
  {
    const btn = document.createElement("button");
    btn.className = "cardButton " + CardVisualClass(card);
    btn.innerHTML = CardVisualHTML(card, "hand");

    // DEPOIS DE COMPRAR, SÓ A CARTA RECÉM-COMPRADA (última da mão) PODE SER
    // JOGADA — mesma regra validada (de verdade) no host, ver
    // MauMauGameManager.HandlePlayAction. Aqui é só pra UX: destacar a
    // jogada certa sem esperar o host rejeitar.
    const indexAllowed = !followUp || index === currentHand.length - 1;
    const isPlaying = index === playingIndex;

    // SOB ATAQUE DE +2 EMPILHADO: só outro Comprar 2 (qualquer cor) é
    // jogável — ignora o casamento normal de cor/tipo (mesma regra de
    // verdade em HandlePlayAction).
    const playableNow = underAttack ? card.type === "DrawTwo" : IsCardPlayable(card);

    btn.disabled = !isMyTurn || !playableNow || !indexAllowed || isPlaying;
    btn.onclick = () => OnCardTapped(card, index);

    if(isPlaying)
    {
      // VOANDO PRA FORA — a jogada já foi confirmada localmente, só esperando
      // o host aplicar de verdade (ver PlayCardWithAnimation).
      btn.style.transform = "translateY(-90px) scale(1.18) rotate(-6deg)";
      btn.style.opacity = "0";
    }
    else if(index === enteringIndex)
    {
      btn.style.animation = "cardDeal 0.4s cubic-bezier(.34,1.56,.64,1) both";
    }
    else if(dealingHand)
    {
      btn.style.animation = "cardDeal 0.4s cubic-bezier(.34,1.56,.64,1) both";
      btn.style.animationDelay = `${index * 60}ms`;
    }
    else if(index === shakeIndex)
    {
      btn.style.animation = `cardShake${shakeAnimToggle ? "A" : "B"} 0.35s ease`;
    }

    container.appendChild(btn);
  });
}

function UpdateActionButtons()
{
  const isMyTurn = currentTable && currentTable.currentTurnPlayerId === currentPlayerId;
  const followUp = currentTable && currentTable.awaitingDrawFollowUp;
  const stack = currentTable ? currentTable.pendingDrawStack || 0 : 0;

  const drawButton = document.getElementById("drawButton");
  const passButton = document.getElementById("passButton");

  drawButton.style.display = followUp ? "none" : "block";
  drawButton.disabled = !isMyTurn || followUp;
  drawButton.innerText = stack > 0 ? `COMPRAR ${stack}` : "COMPRAR";

  passButton.style.display = followUp ? "block" : "none";
  passButton.disabled = !isMyTurn;
}

async function OnCardTapped(card, index)
{
  if(isGamePaused) return;
  if(!currentTable || currentTable.currentTurnPlayerId !== currentPlayerId) return;

  if(card.type === "Wild")
  {
    pendingWildIndex = index;
    ShowColorPicker();
    return;
  }

  PlayCardWithAnimation(index, null);
}

// ANIMA A CARTA SAINDO E SÓ DEPOIS manda a ação de verdade pro host — dá
// tempo da animação (380ms) rodar antes do turno mudar de verdade.
function PlayCardWithAnimation(index, chosenColor)
{
  playingIndex = index;
  BuildHand();

  clearTimeout(playingTimeout);
  playingTimeout = setTimeout(async () =>
  {
    playingIndex = null;
    await SendTurnAction({ type: "play", cardIndex: index, chosenColor });
  }, 380);
}

window.PickWildColor = function(color)
{
  const index = pendingWildIndex;
  pendingWildIndex = null;
  HideColorPicker();

  if(index === null || index === undefined) return;

  PlayCardWithAnimation(index, color);
};

function ShowColorPicker()
{
  document.getElementById("colorPickerOverlay").classList.add("active");
}

function HideColorPicker()
{
  document.getElementById("colorPickerOverlay").classList.remove("active");
}

window.OnDrawTapped = async function()
{
  if(isGamePaused) return;
  if(!currentTable || currentTable.currentTurnPlayerId !== currentPlayerId) return;

  await SendTurnAction({ type: "draw" });
};

window.OnPassTapped = async function()
{
  if(isGamePaused) return;
  if(!currentTable || currentTable.currentTurnPlayerId !== currentPlayerId) return;

  await SendTurnAction({ type: "pass" });
};

async function SendTurnAction(action)
{
  if(isGamePaused) return;

  lastAttemptedCardIndex = action.type === "play" ? action.cardIndex : null;

  await set(
    ref(db, `rooms/${currentRoomCode}/currentState/turnAction`),
    {
      playerId: currentPlayerId,
      type: action.type,
      cardIndex: action.cardIndex ?? null,
      chosenColor: action.chosenColor ?? null,
      t: Date.now()
    }
  );
}

function TriggerShake(index)
{
  shakeAnimToggle = !shakeAnimToggle;
  shakeIndex = index;
  BuildHand();

  clearTimeout(shakeTimeout);
  shakeTimeout = setTimeout(() => { shakeIndex = null; BuildHand(); }, 400);
}

function ShowRejectedToast(reason)
{
  const el = document.getElementById("rejectedText");
  el.innerText = RejectedReasonLabels[reason] || "Jogada inválida.";
  el.classList.add("active");

  clearTimeout(rejectedTimeout);
  rejectedTimeout = setTimeout(() => el.classList.remove("active"), 2200);
}


// =========================
// OPEN RESULT
// =========================

async function OpenResult()
{
  const [placementsSnapshot, playersSnapshot] =
    await Promise.all(
    [
      get(ref(db, `rooms/${currentRoomCode}/history/round_${currentRound}/placements`)),
      get(ref(db, `rooms/${currentRoomCode}/players`))
    ]);

  // COLOCAÇÃO DA RODADA (ver MauMauGameManager.FinishRoundAndGoToResult):
  // índice 0 = 1º lugar (nº de jogadores - 1 pontos), até o último (0 pontos).
  const placements = placementsSnapshot.exists() ? Object.values(placementsSnapshot.val()) : [];
  const numPlayers = placements.length;

  const winnerId = placements[0];
  const winnerName = playerNames[winnerId] || winnerId || "???";

  document.getElementById("resultWinnerText").innerText =
    winnerId === currentPlayerId ? "Você ficou em 1º lugar!" : `${winnerName} ficou em 1º lugar!`;

  const placementsDiv = document.getElementById("resultPlacements");
  placementsDiv.innerHTML = "";

  placements.forEach((playerId, index) =>
  {
    const place = index + 1;
    const points = numPlayers - place;
    const name = playerNames[playerId] || playerId;

    const item = document.createElement("div");
    item.className = "scoreItem" + (playerId === currentPlayerId ? " scoreItemSelf" : "");
    item.innerText = `${place}º ${name} — +${points}`;

    placementsDiv.appendChild(item);
  });

  const scoreboardDiv = document.getElementById("resultScoreboard");
  scoreboardDiv.innerHTML = "";

  if(playersSnapshot.exists())
  {
    const players = [];

    playersSnapshot.forEach((child) =>
    {
      players.push({ id: child.key, ...child.val() });
    });

    players.sort((a, b) => (b.score || 0) - (a.score || 0));

    players.forEach((player) =>
    {
      const item = document.createElement("div");
      item.className = "scoreItem";

      item.innerText =
        `${player.name} - ${player.score || 0}`;

      scoreboardDiv.appendChild(item);
    });
  }
}


// =========================
// OPEN FINAL SCORE
// =========================

async function OpenFinalScore()
{
  const playersSnapshot =
    await get(ref(db, `rooms/${currentRoomCode}/players`));

  const finalDiv =
    document.getElementById("finalScores");

  finalDiv.innerHTML = "";

  if(!playersSnapshot.exists()) return;

  const players = [];

  playersSnapshot.forEach((child) =>
  {
    players.push({ id: child.key, ...child.val() });
  });

  players.sort((a, b) => (b.score || 0) - (a.score || 0));

  players.forEach((player) =>
  {
    const item =
      document.createElement("div");

    item.className = "scoreItem";

    item.innerText =
      `${player.name} - ${player.score || 0}`;

    finalDiv.appendChild(item);
  });
}
