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
// LABELS (mesmo baralho original de MauMauCard.cs — sem replicar nenhum
// produto comercial)
// =========================

// PSEUDO-DESIGN: a cor já é o fundo colorido do botão (ver ColorClass) — o
// texto da carta fica só com o número, ou um emoji pras especiais, em vez de
// escrever "Vermelho 7"/"Vermelho REVERTER" por extenso.
const CardEmojis = { Skip: "🚫", Reverse: "🔄", DrawTwo: "✋+2", Wild: "🌈" };

// MESMAS CORES DAS CLASSES .color-* (ver MauMau_style.css) — a carta do topo
// não usa fundo colorido (ela fica sozinha, sem outras cartas do lado pra
// contextualizar), então quem indica a cor ativa é a FONTE, pintada aqui via
// style.color (mesma ideia de MauMauGameManager.RefreshTableUI/ToUnityColor
// do lado do host).
const ColorHex = { None: "#ffffff", Red: "#e74c3c", Blue: "#4d94ff", Green: "#2ecc71", Yellow: "#f4d03f" };

const RejectedReasonLabels = {
  "not-your-turn": "Ainda não é sua vez!",
  "invalid-card": "Carta inválida.",
  "illegal-move": "Essa carta não pode ser jogada agora.",
  "missing-color": "Escolha uma cor pro Curinga.",
  "must-play-drawn-card-or-pass": "Jogue a carta que você comprou, ou passe.",
  "already-drew": "Você já comprou nessa vez.",
  "nothing-to-pass": "Nada pra passar agora."
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

let handUnsubscribe = null;
let tableUnsubscribe = null;
let rejectedUnsubscribe = null;


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
// COUNTDOWN (contador visível no client)
// =========================

function StartCountdown(seconds, elementId)
{
  StopCountdown();

  let remaining = Math.round(seconds);
  const el = document.getElementById(elementId);

  function tick()
  {
    if(el) el.innerText = `${remaining}s`;

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
// FORMATAÇÃO DE CARTA
// =========================

function FormatCard(card)
{
  if(!card) return "?";
  if(card.type === "Number") return `${card.value}`;
  return CardEmojis[card.type] || "?";
}

function ColorClass(color)
{
  return "color-" + (color || "none").toLowerCase();
}


// =========================
// OPEN PLAYING
// =========================

async function OpenPlaying()
{
  pendingWildIndex = null;
  HideColorPicker();

  const [roundSnapshot, playersSnapshot] =
    await Promise.all(
    [
      get(ref(db, `rooms/${currentRoomCode}/currentState/round`)),
      get(ref(db, `rooms/${currentRoomCode}/players`))
    ]);

  currentRound = roundSnapshot.val() || currentRound;

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
      currentHand = snapshot.exists() ? Object.values(snapshot.val()) : [];
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
      if(data.playerId === currentPlayerId) ShowRejectedToast(data.reason);
    }
  );
}

function ApplyTableUpdate(table)
{
  currentTable = table;

  const topCardEl = document.getElementById("topCardDisplay");
  topCardEl.innerText = FormatCard(table.topCard);
  topCardEl.style.color = ColorHex[table.activeColor] || ColorHex.None;

  const isMyTurn = table.currentTurnPlayerId === currentPlayerId;
  const bannerEl = document.getElementById("turnBannerText");

  if(isMyTurn)
  {
    bannerEl.innerText = table.awaitingDrawFollowUp
      ? "Jogue a carta que você comprou, ou passe!"
      : "SUA VEZ!";
  }
  else
  {
    const name = playerNames[table.currentTurnPlayerId] || "outro jogador";
    bannerEl.innerText = `Vez de ${name}...`;
  }

  BuildHand();
  UpdateActionButtons();

  if(table.turnDuration)
  {
    StartCountdown(table.turnDuration, "turnCountdown");
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

  currentHand.forEach((card, index) =>
  {
    const btn = document.createElement("button");
    btn.className = "cardButton " + ColorClass(card.color);
    btn.innerText = FormatCard(card);

    // DEPOIS DE COMPRAR, SÓ A CARTA RECÉM-COMPRADA (última da mão) PODE SER
    // JOGADA — mesma regra validada (de verdade) no host, ver
    // MauMauGameManager.HandlePlayAction. Aqui é só pra UX: destacar a
    // jogada certa sem esperar o host rejeitar.
    const indexAllowed = !followUp || index === currentHand.length - 1;

    btn.disabled = !isMyTurn || !IsCardPlayable(card) || !indexAllowed;
    btn.onclick = () => OnCardTapped(card, index);

    container.appendChild(btn);
  });
}

function UpdateActionButtons()
{
  const isMyTurn = currentTable && currentTable.currentTurnPlayerId === currentPlayerId;
  const followUp = currentTable && currentTable.awaitingDrawFollowUp;

  const drawButton = document.getElementById("drawButton");
  const passButton = document.getElementById("passButton");

  drawButton.style.display = followUp ? "none" : "block";
  drawButton.disabled = !isMyTurn || followUp;

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

  await SendTurnAction({ type: "play", cardIndex: index });
}

window.PickWildColor = async function(color)
{
  const index = pendingWildIndex;
  pendingWildIndex = null;
  HideColorPicker();

  if(index === null || index === undefined) return;

  await SendTurnAction({ type: "play", cardIndex: index, chosenColor: color });
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
