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
// VISUAL DAS CARTAS — CONTEÚDO ORIGINAL (GDD_Classics.pdf seção 9): nenhuma
// arte de banco de imagens comercial, só formas abstratas geradas na hora a
// partir do cardId (mesmo id em todo mundo que olha pra carta, então todo
// mundo vê o mesmo desenho, mas ele nunca sai do celular — o host só guarda
// o número). "Placeholder simples" (ver Próximos Passos do GDD): dá pra
// trocar por ilustração de verdade depois sem mexer em nenhuma lógica de
// jogo, já que o resto do sistema só conhece o cardId.
// =========================

function mulberry32(seed)
{
  let state = seed | 0;

  return function()
  {
    state = (state + 0x6D2B79F5) | 0;

    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// PALETA "ORGANIC" (ver Design UI completo do Glimpse) — tons das rampas
// accent/accent-2/neutral do design system, pra combinar com o resto da UI.
const CARD_PALETTE =
[
  "#ffc6a5", "#f6a06b", "#d67f48",
  "#ccdbb2", "#aebf92", "#8fa073",
  "#dcd3c4", "#ffe1d0", "#e1eecc"
];

const CARD_SHAPES = ["circle", "triangle", "square", "star", "blob"];

function ShapeSVG(shape, x, y, size, rotation, color)
{
  const transform = `translate(${x} ${y}) rotate(${rotation})`;

  if(shape === "circle")
  {
    return `<circle cx="0" cy="0" r="${(size / 2).toFixed(1)}" fill="${color}" transform="${transform}"></circle>`;
  }

  if(shape === "square")
  {
    return `<rect x="${(-size / 2).toFixed(1)}" y="${(-size / 2).toFixed(1)}" width="${size.toFixed(1)}" height="${size.toFixed(1)}" rx="4" fill="${color}" transform="${transform}"></rect>`;
  }

  if(shape === "triangle")
  {
    const h = size / 2;
    return `<polygon points="0,${-h.toFixed(1)} ${h.toFixed(1)},${h.toFixed(1)} ${(-h).toFixed(1)},${h.toFixed(1)}" fill="${color}" transform="${transform}"></polygon>`;
  }

  if(shape === "blob")
  {
    return `<ellipse cx="0" cy="0" rx="${(size / 2).toFixed(1)}" ry="${(size / 2.9).toFixed(1)}" fill="${color}" transform="${transform}"></ellipse>`;
  }

  // star
  const outer = size / 2;
  const inner = size / 4.2;
  const points = [];

  for(let i = 0; i < 10; i++)
  {
    const r = i % 2 === 0 ? outer : inner;
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    points.push(`${(r * Math.cos(angle)).toFixed(1)},${(r * Math.sin(angle)).toFixed(1)}`);
  }

  return `<polygon points="${points.join(" ")}" fill="${color}" transform="${transform}"></polygon>`;
}

function CardArtSVG(cardId)
{
  const rand = mulberry32(cardId);

  const bgColor = CARD_PALETTE[Math.floor(rand() * CARD_PALETTE.length)];
  let accentColor = CARD_PALETTE[Math.floor(rand() * CARD_PALETTE.length)];

  if(accentColor === bgColor)
  {
    accentColor = CARD_PALETTE[(CARD_PALETTE.indexOf(accentColor) + 3) % CARD_PALETTE.length];
  }

  const bgAngle = Math.floor(rand() * 360);
  const shapeCount = 2 + Math.floor(rand() * 3);

  let shapesSVG = "";

  for(let i = 0; i < shapeCount; i++)
  {
    const shape = CARD_SHAPES[Math.floor(rand() * CARD_SHAPES.length)];
    const x = 22 + rand() * 56;
    const y = 22 + rand() * 56;
    const size = 16 + rand() * 26;
    const rotation = Math.floor(rand() * 360);
    const color = i % 2 === 0 ? "#f5ead8" : accentColor;

    shapesSVG += ShapeSVG(shape, x, y, size, rotation, color);
  }

  return `<div class="cardArt" style="background:linear-gradient(${bgAngle}deg, ${bgColor}, ${accentColor})">`
    + `<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">${shapesSVG}</svg>`
    + `</div>`;
}


// =========================
// GAME STATE
// =========================

let currentGameState = "Lobby";
let isHost = false;
let isGamePaused = false;
let currentRound = 0;

let playerNames = {};       // playerId -> nome
let totalPlayerCount = 0;

let currentNarratorId = null;
let currentNarratorName = "???";
let currentHint = "";

let currentHand = [];              // MINHA mão (só eu leio esse nó, ver GDD)
let mySubmittedCardId = null;      // carta que EU coloquei na mesa nessa rodada (narrador ou palpiteiro) — usado pra travar o próprio voto
let selectedNarratorCardId = null; // seleção em andamento na tela de narrar, antes de confirmar
let hintLocked = false;
let submissionLocked = false;
let voteLocked = false;

let handUnsubscribe = null;
let submissionsCountUnsubscribe = null;
let votesCountUnsubscribe = null;
let votingCardsUnsubscribe = null;

// Contagem local da página do tutorial (0-4) — só de exibição pro host (ver
// GDD/GlimpseGameManager.cs no projeto Unity: quem manda de verdade na página
// é o host TV, aqui só espelhamos otimisticamente pra mostrar "página X/5" no
// celular do host enquanto ele navega.
const TUTORIAL_PAGE_COUNT = 5;
let localTutorialPage = 0;


// =========================
// SCREEN SYSTEM
// =========================

function ShowScreen(screenId)
{
  document
    .querySelectorAll(".screen")
    .forEach((screen) => screen.classList.remove("active"));

  document
    .getElementById(screenId)
    .classList.add("active");
}


// =========================
// START
// =========================

window.onload = function()
{
  document.getElementById("lobbyPlayerTag").innerText =
    `você entrou como ${currentPlayerName || "???"}`;

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
// HOST CONTROLS
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
  // Espelha localmente a página que o host acabou de pedir — só pra exibir
  // "página X/5" no próprio celular (ver LocalTutorial* acima); quem manda
  // de verdade é o host TV (GlimpseGameManager.cs, projeto Unity).
  if(action === "next") LocalTutorialNext();
  if(action === "prev") LocalTutorialPrev();

  await set(
    ref(db, `rooms/${currentRoomCode}/tutorialAction`),
    { action: action, t: Date.now() }
  );
};

function LocalTutorialReset()
{
  localTutorialPage = 0;
  RefreshTutorialPageTag();
}

function LocalTutorialNext()
{
  localTutorialPage = Math.min(localTutorialPage + 1, TUTORIAL_PAGE_COUNT - 1);
  RefreshTutorialPageTag();
}

function LocalTutorialPrev()
{
  localTutorialPage = Math.max(localTutorialPage - 1, 0);
  RefreshTutorialPageTag();
}

function RefreshTutorialPageTag()
{
  document.getElementById("tutorialPageTag").innerText =
    `página ${localTutorialPage + 1}/${TUTORIAL_PAGE_COUNT}`;
}

function UpdateHostButton(state)
{
  if(!isHost) return;

  const btn = document.getElementById("hostButton");

  if(state === "Tutorial")
  {
    btn.style.display = "none";
    return;
  }

  btn.style.display = "flex";

  const labels =
  {
    "Lobby":      "começar jogo",
    "Narrating":  "pular etapa",
    "Submitting": "pular etapa",
    "Voting":     "pular etapa",
    "Result":     "pular etapa",
    "FinalScore": "jogar de novo",
  };

  btn.innerText =
    labels[state] ?? "pular etapa";
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

function ListenForVisibilityRecovery()
{
  document.addEventListener("visibilitychange", () =>
  {
    if(document.visibilityState !== "visible") return;

    console.log("[Glimpse] Aba voltou ao foco — ressincronizando listener de estado.");

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

  UpdateHostButton(gameState);

  if(gameState === "Lobby") ShowScreen("lobbyScreen");

  if(gameState === "Tutorial")
  {
    ShowScreen("tutorialScreen");

    LocalTutorialReset();

    document
      .getElementById("tutorialControls")
      .style.display =
      isHost ? "flex" : "none";
  }

  if(gameState === "Narrating")
  {
    ShowScreen("narratingScreen");
    OpenNarrating();
  }

  if(gameState === "Submitting")
  {
    ShowScreen("submittingScreen");
    OpenSubmitting();
  }

  if(gameState === "Voting")
  {
    ShowScreen("votingScreen");
    OpenVoting();
  }

  if(gameState === "Result")
  {
    ShowScreen("resultScreen");
    OpenResult();
  }

  if(gameState === "FinalScore")
  {
    ShowScreen("finalScoreScreen");
    OpenFinalScore();
  }
}


// =========================
// SHARED HELPERS
// =========================

async function LoadPlayerNames()
{
  const snapshot = await get(ref(db, `rooms/${currentRoomCode}/players`));

  playerNames = {};
  totalPlayerCount = 0;

  if(snapshot.exists())
  {
    snapshot.forEach((child) =>
    {
      playerNames[child.key] = (child.val() || {}).name || "???";
      totalPlayerCount++;
    });
  }
}

async function LoadNarratorInfo()
{
  const [roundSnapshot, narratorIdSnapshot, narratorNameSnapshot, hintSnapshot] =
    await Promise.all(
    [
      get(ref(db, `rooms/${currentRoomCode}/currentState/round`)),
      get(ref(db, `rooms/${currentRoomCode}/currentState/narratorId`)),
      get(ref(db, `rooms/${currentRoomCode}/currentState/narratorName`)),
      get(ref(db, `rooms/${currentRoomCode}/currentState/hint`))
    ]);

  currentRound = roundSnapshot.val() || currentRound;
  currentNarratorId = narratorIdSnapshot.val() || null;
  currentNarratorName = narratorNameSnapshot.val() || "???";
  currentHint = hintSnapshot.val() || "";
}

function IAmNarrator()
{
  return currentNarratorId === currentPlayerId;
}

function StopHandListener()
{
  if(handUnsubscribe) { handUnsubscribe(); handUnsubscribe = null; }
}

function ListenOwnHand(onChange)
{
  StopHandListener();

  handUnsubscribe = onValue(
    ref(db, `rooms/${currentRoomCode}/players/${currentPlayerId}/hand`),
    (snapshot) =>
    {
      currentHand = snapshot.exists() ? Object.values(snapshot.val()) : [];
      onChange();
    }
  );
}


// =========================
// NARRATING (narrador escolhe carta + dica)
// =========================

async function OpenNarrating()
{
  await LoadPlayerNames();
  await LoadNarratorInfo();

  mySubmittedCardId = null;
  selectedNarratorCardId = null;
  hintLocked = false;

  document.getElementById("narratingRoundNum").innerText = currentRound;

  const asNarrator = document.getElementById("narratingAsNarrator");
  const asGuesser = document.getElementById("narratingAsGuesser");

  if(IAmNarrator())
  {
    asNarrator.style.display = "flex";
    asGuesser.style.display = "none";

    document.getElementById("hintInput").value = "";
    document.getElementById("hintInput").disabled = false;
    document.getElementById("confirmHintButton").disabled = true;
    document.getElementById("narratorWaitingText").innerText = "";

    ListenOwnHand(BuildNarratorHand);
  }
  else
  {
    asNarrator.style.display = "none";
    asGuesser.style.display = "flex";

    document.getElementById("narratingNarratorName").innerText = currentNarratorName;
    document.getElementById("narratorAvatar").innerText = currentNarratorName[0] || "?";
  }
}

function BuildNarratorHand()
{
  const container = document.getElementById("narratorHandContainer");
  container.innerHTML = "";

  currentHand.forEach((cardId) =>
  {
    const selected = cardId === selectedNarratorCardId;

    const btn = document.createElement("button");
    btn.className = "cardButton";
    btn.innerHTML = CardArtSVG(cardId);
    btn.disabled = hintLocked;

    btn.style.borderColor = selected ? "var(--color-accent)" : "transparent";
    btn.style.borderWidth = selected ? "3px" : "1px";
    btn.style.opacity = hintLocked && !selected ? ".4" : "1";

    btn.onclick = () =>
    {
      selectedNarratorCardId = cardId;
      BuildNarratorHand();
      RefreshConfirmHintButton();
    };

    container.appendChild(btn);
  });
}

function RefreshConfirmHintButton()
{
  const hint = document.getElementById("hintInput").value.trim();
  document.getElementById("confirmHintButton").disabled =
    hintLocked || selectedNarratorCardId === null || hint.length === 0;
}

document.addEventListener("input", (event) =>
{
  if(event.target && event.target.id === "hintInput") RefreshConfirmHintButton();
});

window.OnConfirmHintTapped = async function()
{
  if(hintLocked || selectedNarratorCardId === null) return;

  const hint = document.getElementById("hintInput").value.trim();
  if(hint.length === 0) return;

  hintLocked = true;
  mySubmittedCardId = selectedNarratorCardId;

  document.getElementById("hintInput").disabled = true;
  document.getElementById("confirmHintButton").disabled = true;
  document.getElementById("narratorWaitingText").innerText = "aguardando os jogadores escolherem uma carta…";

  BuildNarratorHand();

  await set(
    ref(db, `rooms/${currentRoomCode}/currentState/narratorSubmission`),
    {
      playerId: currentPlayerId,
      cardId: selectedNarratorCardId,
      hint: hint,
      t: Date.now()
    }
  );
};


// =========================
// SUBMITTING (demais escolhem carta da mão)
// =========================

async function OpenSubmitting()
{
  await LoadPlayerNames();
  await LoadNarratorInfo();

  submissionLocked = false;

  document.getElementById("submittingRoundNum").innerText = currentRound;
  document.getElementById("submittingHintText").innerText = currentHint;

  const asNarrator = document.getElementById("submittingAsNarrator");
  const asGuesser = document.getElementById("submittingAsGuesser");

  if(submissionsCountUnsubscribe) { submissionsCountUnsubscribe(); submissionsCountUnsubscribe = null; }

  // O NARRADOR NÃO PRECISA MAIS DA PRÓPRIA MÃO nesta etapa (já jogou a carta
  // em Narrating) — encerra aqui o listener aberto em ListenOwnHand pra não
  // ficar reconstruindo, à toa, um container escondido a cada atualização.
  StopHandListener();

  if(IAmNarrator())
  {
    asNarrator.style.display = "flex";
    asGuesser.style.display = "none";

    submissionsCountUnsubscribe = onValue(
      ref(db, `rooms/${currentRoomCode}/history/round_${currentRound}/submissions`),
      (snapshot) =>
      {
        const count = snapshot.exists() ? Object.keys(snapshot.val()).length : 0;
        const expected = Math.max(0, totalPlayerCount - 1);

        document.getElementById("submittingCountText").innerText = `${count}/${expected}`;
      }
    );
  }
  else
  {
    asNarrator.style.display = "none";
    asGuesser.style.display = "flex";

    document.getElementById("submittingWaitingText").innerText = "";

    ListenOwnHand(BuildGuesserSubmitHand);
  }
}

function BuildGuesserSubmitHand()
{
  const container = document.getElementById("guesserHandContainer");
  container.innerHTML = "";

  currentHand.forEach((cardId) =>
  {
    const mine = cardId === mySubmittedCardId;

    const btn = document.createElement("button");
    btn.className = "cardButton";
    btn.innerHTML = CardArtSVG(cardId);
    btn.disabled = submissionLocked;

    btn.style.borderColor = mine ? "var(--color-accent-2)" : "transparent";
    btn.style.borderWidth = mine ? "3px" : "1px";
    btn.style.opacity = submissionLocked && !mine ? ".4" : "1";

    btn.onclick = () => OnSubmitCardTapped(cardId);

    container.appendChild(btn);
  });
}

async function OnSubmitCardTapped(cardId)
{
  if(submissionLocked) return;

  submissionLocked = true;
  mySubmittedCardId = cardId;

  document.getElementById("submittingWaitingText").innerText = "aguardando os outros jogadores…";
  BuildGuesserSubmitHand();

  await set(
    ref(db, `rooms/${currentRoomCode}/history/round_${currentRound}/submissions/${currentPlayerId}`),
    cardId
  );
}


// =========================
// VOTING (cartas embaralhadas, vota em qual é a do narrador)
// =========================

async function OpenVoting()
{
  // NINGUÉM PRECISA MAIS DA PRÓPRIA MÃO aqui (já jogou a carta em
  // Submitting/Narrating) — encerra o listener de "hand" que ainda estivesse
  // aberto, mesmo motivo do StopHandListener() em OpenSubmitting.
  StopHandListener();

  await LoadPlayerNames();
  await LoadNarratorInfo();

  voteLocked = false;

  document.getElementById("votingRoundNum").innerText = currentRound;
  document.getElementById("votingHintText").innerText = currentHint;

  const asNarrator = document.getElementById("votingAsNarrator");
  const asGuesser = document.getElementById("votingAsGuesser");

  if(votesCountUnsubscribe) { votesCountUnsubscribe(); votesCountUnsubscribe = null; }
  if(votingCardsUnsubscribe) { votingCardsUnsubscribe(); votingCardsUnsubscribe = null; }

  if(IAmNarrator())
  {
    asNarrator.style.display = "flex";
    asGuesser.style.display = "none";

    votesCountUnsubscribe = onValue(
      ref(db, `rooms/${currentRoomCode}/history/round_${currentRound}/votes`),
      (snapshot) =>
      {
        const count = snapshot.exists() ? Object.keys(snapshot.val()).length : 0;
        const expected = Math.max(0, totalPlayerCount - 1);

        document.getElementById("votingCountText").innerText = `${count}/${expected}`;
      }
    );
  }
  else
  {
    asNarrator.style.display = "none";
    asGuesser.style.display = "flex";

    document.getElementById("votingWaitingText").innerText = "";

    votingCardsUnsubscribe = onValue(
      ref(db, `rooms/${currentRoomCode}/currentState/votingCards`),
      (snapshot) =>
      {
        const cards = snapshot.exists() ? Object.values(snapshot.val()) : [];
        BuildVotingGrid(cards);
      }
    );
  }
}

// POR CONVENÇÃO (ver GDD), o dono de cada carta só é revelado depois — aqui
// a gente só usa o cardId (nunca ownerId) pra saber qual botão é o MEU
// próprio palpite/dica, e desabilitar ele (não dá pra votar na própria carta).
function BuildVotingGrid(cards)
{
  const container = document.getElementById("votingCardsContainer");
  container.innerHTML = "";

  cards.forEach((card, index) =>
  {
    const isMine = card.cardId === mySubmittedCardId;

    const btn = document.createElement("button");
    btn.className = "cardButton";
    btn.innerHTML = CardArtSVG(card.cardId);
    btn.disabled = voteLocked || isMine;

    btn.style.borderColor = "transparent";
    btn.style.borderWidth = "1px";
    btn.style.opacity = isMine ? ".4" : "1";

    btn.onclick = () => OnVoteTapped(index);

    container.appendChild(btn);
  });
}

async function OnVoteTapped(index)
{
  if(voteLocked) return;

  voteLocked = true;

  document.getElementById("votingWaitingText").innerText = "aguardando os outros jogadores…";

  const container = document.getElementById("votingCardsContainer");
  Array.from(container.children).forEach((child, i) =>
  {
    const chosen = i === index;

    child.disabled = true;
    child.style.borderColor = chosen ? "var(--color-accent-2)" : "transparent";
    child.style.borderWidth = chosen ? "3px" : "1px";
    if(!chosen) child.style.opacity = ".4";
  });

  await set(
    ref(db, `rooms/${currentRoomCode}/history/round_${currentRound}/votes/${currentPlayerId}`),
    index
  );
}


// =========================
// RESULT (revela dono de cada carta + pontos da rodada)
// =========================

async function OpenResult()
{
  await LoadPlayerNames();

  const [narratorIdSnapshot, hintSnapshot, votingCardsSnapshot, votesSnapshot, scoresSnapshot, playersSnapshot] =
    await Promise.all(
    [
      get(ref(db, `rooms/${currentRoomCode}/currentState/narratorId`)),
      get(ref(db, `rooms/${currentRoomCode}/currentState/hint`)),
      get(ref(db, `rooms/${currentRoomCode}/currentState/votingCards`)),
      get(ref(db, `rooms/${currentRoomCode}/history/round_${currentRound}/votes`)),
      get(ref(db, `rooms/${currentRoomCode}/history/round_${currentRound}/scores`)),
      get(ref(db, `rooms/${currentRoomCode}/players`))
    ]);

  const narratorId = narratorIdSnapshot.val() || null;
  document.getElementById("resultHintText").innerText = hintSnapshot.val() || "";

  const cards = votingCardsSnapshot.exists() ? Object.values(votingCardsSnapshot.val()) : [];
  const votes = votesSnapshot.exists() ? votesSnapshot.val() : {};
  const scores = scoresSnapshot.exists() ? scoresSnapshot.val() : {};

  const voteCountByIndex = {};
  Object.values(votes).forEach((votedIndex) =>
  {
    voteCountByIndex[votedIndex] = (voteCountByIndex[votedIndex] || 0) + 1;
  });

  const cardsContainer = document.getElementById("resultCardsContainer");
  cardsContainer.innerHTML = "";

  cards.forEach((card, index) =>
  {
    const isNarratorCard = card.ownerId === narratorId;
    const ownerName = playerNames[card.ownerId] || "???";
    const voteCount = voteCountByIndex[index] || 0;

    const item = document.createElement("div");
    item.className = "cardButton cardReveal";
    item.style.borderColor = isNarratorCard ? "var(--color-accent)" : "transparent";
    item.style.borderWidth = isNarratorCard ? "2px" : "1px";
    item.innerHTML =
      CardArtSVG(card.cardId)
      + (isNarratorCard ? `<span class="cardBadge">★</span>` : "")
      + `<div class="cardCaption"></div>`;

    const caption = item.querySelector(".cardCaption");
    caption.append(
      document.createTextNode(ownerName),
      document.createElement("br"),
      document.createTextNode(voteCount === 1 ? "1 voto" : `${voteCount} votos`)
    );

    cardsContainer.appendChild(item);
  });

  const deltas = Object.keys(scores)
    .map((playerId) => ({ name: playerNames[playerId] || "???", points: scores[playerId] || 0 }))
    .filter((entry) => entry.points !== 0)
    .sort((a, b) => b.points - a.points);

  document.getElementById("resultOutcomeText").innerText =
    deltas.length > 0
      ? deltas.map((entry) => `${entry.name} +${entry.points}`).join("  ·  ")
      : "ninguém pontuou nessa rodada";

  const scoreboardDiv = document.getElementById("resultScoreboard");
  scoreboardDiv.innerHTML = "";

  if(playersSnapshot.exists())
  {
    const players = [];

    playersSnapshot.forEach((child) => players.push({ id: child.key, ...child.val() }));
    players.sort((a, b) => (b.score || 0) - (a.score || 0));

    players.forEach((player) =>
    {
      const item = document.createElement("div");
      item.className = "scoreRow" + (player.id === currentPlayerId ? " self" : "");

      const nameSpan = document.createElement("span");
      nameSpan.innerText = player.name;

      const scoreSpan = document.createElement("span");
      scoreSpan.innerText = player.score || 0;

      item.append(nameSpan, scoreSpan);
      scoreboardDiv.appendChild(item);
    });
  }
}


// =========================
// FINAL SCORE
// =========================

async function OpenFinalScore()
{
  const playersSnapshot = await get(ref(db, `rooms/${currentRoomCode}/players`));

  const finalDiv = document.getElementById("finalScores");
  finalDiv.innerHTML = "";

  if(!playersSnapshot.exists()) return;

  const players = [];
  playersSnapshot.forEach((child) => players.push({ id: child.key, ...child.val() }));
  players.sort((a, b) => (b.score || 0) - (a.score || 0));

  players.forEach((player, index) =>
  {
    const item = document.createElement("div");
    item.className = "scoreRow" + (player.id === currentPlayerId ? " self" : "");

    const nameSpan = document.createElement("span");
    nameSpan.innerText = `${index + 1}º ${player.name}`;

    const scoreSpan = document.createElement("span");
    scoreSpan.className = "scoreRank";
    scoreSpan.innerText = player.score || 0;

    item.append(nameSpan, scoreSpan);
    finalDiv.appendChild(item);
  });
}
