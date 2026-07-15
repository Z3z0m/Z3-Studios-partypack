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
// GAME STATE
// =========================

let currentGameState = "Lobby";
let isHost = false;
let isGamePaused = false;
let alreadyCalledStop = false;
let currentCategories = [];
let currentRound = 0;
let countdownInterval = null;


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
// TEXT NORMALIZATION (só uma dica visual pro jogador — a pontuação de
// verdade é calculada no host, incluindo a normalização de plural)
// =========================

function StripAccents(text)
{
  // Remove os diacríticos (acentos) deixados pela normalização NFD, que
  // separa "á" em "a" + marca de acento combinante — filtra pelo código
  // numérico do caractere em vez de um escape de regex, pra não depender
  // de como este arquivo é transmitido/editado.
  return text
    .normalize("NFD")
    .split("")
    .filter(ch => ch.charCodeAt(0) < 0x0300 || ch.charCodeAt(0) > 0x036f)
    .join("");
}

function NormalizeForCompare(text)
{
  return StripAccents(text.trim().toLowerCase());
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
// HOST CONTROLS (botão único: começar / pular etapa / jogar de novo)
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
    "Reveal":     "Pular Questionamento",
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
// RECUPERA SINCRONIA AO VOLTAR O FOCO NA ABA
// (re-registra o listener do zero em vez de misturar com uma leitura pontual
// — ver o mesmo padrão/motivo em InBetween_app.js)
// =========================

function ListenForVisibilityRecovery()
{
  document.addEventListener("visibilitychange", () =>
  {
    if(document.visibilityState !== "visible") return;

    console.log("[Stop] Aba voltou ao foco — ressincronizando listener de estado.");

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

  if(gameState == "Filling")
  {
    ShowScreen("fillingScreen");
    OpenFilling();
  }

  if(gameState == "Reveal")
  {
    ShowScreen("revealScreen");
    OpenReveal();
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
// OPEN FILLING (sorteio de letra + categorias do tema)
// =========================

async function OpenFilling()
{
  alreadyCalledStop = false;

  const [letterSnapshot, categoriesSnapshot, roundSnapshot, durationSnapshot] =
    await Promise.all(
    [
      get(ref(db, `rooms/${currentRoomCode}/currentState/letter`)),
      get(ref(db, `rooms/${currentRoomCode}/currentState/categories`)),
      get(ref(db, `rooms/${currentRoomCode}/currentState/round`)),
      get(ref(db, `rooms/${currentRoomCode}/currentState/fillDuration`))
    ]);

  const letter = letterSnapshot.val() || "?";
  currentRound = roundSnapshot.val() || 0;

  currentCategories =
    categoriesSnapshot.exists()
      ? Object.values(categoriesSnapshot.val())
      : [];

  document.getElementById("letterText").innerText = letter;

  document.getElementById("themeBanner").innerText =
    `Rodada ${currentRound}`;

  document.getElementById("fillingStatusText").innerText = "";

  const stopButton = document.getElementById("stopCallButton");
  stopButton.disabled = true;
  stopButton.innerText = "PARAR!";

  BuildCategoryInputs(letter);

  if(durationSnapshot.exists())
  {
    StartCountdown(durationSnapshot.val(), "fillingCountdown");
  }
}

function BuildCategoryInputs(letter)
{
  const container =
    document.getElementById("categoryInputs");

  container.innerHTML = "";

  // CHAVEADO POR ÍNDICE (não pelo nome da categoria) na gravação no Firebase:
  // temas custom deixam o operador do host digitar qualquer nome de
  // categoria, e um nome com "." "#" "$" "[" "]" quebraria como chave de
  // path no Firebase (ver mesmo comentário em StopGameManager.CalculateScores).
  currentCategories.forEach((category, categoryIndex) =>
  {
    const row = document.createElement("div");
    row.className = "categoryRow";

    const label = document.createElement("label");
    label.innerText = category;

    const input = document.createElement("input");
    input.type = "text";
    input.className = "categoryInput";
    input.placeholder = `${letter}...`;
    input.dataset.categoryIndex = categoryIndex;

    input.addEventListener("input", () =>
    {
      HandleCategoryInput(categoryIndex, input);
    });

    row.appendChild(label);
    row.appendChild(input);
    container.appendChild(row);
  });
}

let saveDebounceTimers = {};

function HandleCategoryInput(categoryIndex, inputEl)
{
  const value = inputEl.value;
  const normalized = NormalizeForCompare(value);
  const letter = document.getElementById("letterText").innerText.toLowerCase();

  inputEl.classList.toggle(
    "invalidHint",
    value.trim().length > 0 && !normalized.startsWith(letter)
  );

  clearTimeout(saveDebounceTimers[categoryIndex]);

  saveDebounceTimers[categoryIndex] = setTimeout(() =>
  {
    SaveAnswer(categoryIndex, value);
  }, 400);

  UpdateStopButtonAvailability();
}

async function SaveAnswer(categoryIndex, value)
{
  if(isGamePaused) return;

  await set(
    ref(db, `rooms/${currentRoomCode}/history/round_${currentRound}/answers/${currentPlayerId}/${categoryIndex}`),
    value.trim()
  );
}

function UpdateStopButtonAvailability()
{
  const inputs =
    document.querySelectorAll(".categoryInput");

  const allFilled =
    inputs.length > 0 &&
    Array.from(inputs).every(input => input.value.trim().length > 0);

  const stopButton = document.getElementById("stopCallButton");

  if(!alreadyCalledStop)
  {
    stopButton.disabled = !allFilled;
  }
}


// =========================
// CALL STOP (PARAR! — encerra a rodada pra todo mundo na hora)
// =========================

window.callStop = async function()
{
  if(isGamePaused) return;

  if(alreadyCalledStop)
  {
    return;
  }

  alreadyCalledStop = true;

  document
    .querySelectorAll(".categoryInput")
    .forEach(input => input.disabled = true);

  const stopButton = document.getElementById("stopCallButton");
  stopButton.disabled = true;
  stopButton.innerText = "Parando a rodada...";

  await set(
    ref(db, `rooms/${currentRoomCode}/currentState/stopCall`),
    {
      playerId: currentPlayerId,
      playerName: currentPlayerName,
      t: Date.now()
    }
  );

  document.getElementById("fillingStatusText").innerText =
    "Você gritou PARAR! Encerrando a rodada para todo mundo...";

  console.log("PARAR enviado!");
};


// =========================
// OPEN REVEAL (uma categoria por vez — respostas iguais aparecem juntas numa
// linha só, e questionar afeta o grupo inteiro. Fica escutando o mesmo nó o
// tempo todo, porque VÁRIAS categorias passam sob o mesmo gameState "Reveal";
// ver mesmo padrão em InBetween_app.js pra estados com múltiplas sub-etapas)
// =========================

let revealUnsubscribe = null;
let lastCategoryPos = -1;
let challengedByMe = new Set();

function OpenReveal()
{
  lastCategoryPos = -1;
  challengedByMe = new Set();

  if(revealUnsubscribe)
  {
    revealUnsubscribe();
    revealUnsubscribe = null;
  }

  const revealRef =
    ref(db, `rooms/${currentRoomCode}/currentState/reveal`);

  revealUnsubscribe = onValue(revealRef, (snapshot) =>
  {
    if(!snapshot.exists()) return;

    const data = snapshot.val();

    // SÓ RECONSTRÓI A LISTA QUANDO "categoryPos" MUDA *E* OS GRUPOS JÁ
    // CHEGARAM — o host escreve categoryPos por último de propósito (ver
    // PublishCurrentCategoryGroups), então checar os dois evita montar uma
    // lista vazia no meio das escritas de uma categoria nova.
    if(data.groups && data.categoryPos !== undefined && data.categoryPos !== lastCategoryPos)
    {
      lastCategoryPos = data.categoryPos;
      challengedByMe = new Set();

      BuildCategoryScreen(data);

      if(data.duration)
      {
        StartCountdown(data.duration, "revealCountdown");
      }
    }

    // RESULTADOS (chegam depois, quando o host resolve essa categoria)
    if(data.outcomes)
    {
      Object.entries(data.outcomes).forEach(([groupIndex, outcome]) =>
      {
        const row = document.getElementById(`revealRow_${groupIndex}`);
        if(!row) return;

        row.classList.add(outcome === "invalidated" ? "revealRowInvalidated" : "revealRowKept");

        const button = row.querySelector(".challengeToggleButton");
        if(button) button.disabled = true;
      });
    }
  });
}

function BuildCategoryScreen(data)
{
  const container = document.getElementById("revealItemsList");
  container.innerHTML = "";

  const categoryPos = data.categoryPos ?? 0;
  const categoryTotal = data.categoryTotal ?? 1;

  BuildCategoryHeader(`${data.category} (${categoryPos + 1}/${categoryTotal})`);

  if(!data.groups) return;

  Object.entries(data.groups).forEach(([groupIndex, group]) =>
  {
    const playerNames = group.playerNames ? Object.values(group.playerNames) : [];
    const playerIds = group.playerIds ? Object.values(group.playerIds) : [];

    BuildRevealRow(Number(groupIndex), { word: group.word, playerNames, playerIds });
  });
}

function BuildCategoryHeader(categoryName)
{
  const container = document.getElementById("revealItemsList");

  const header = document.createElement("div");
  header.className = "revealCategoryHeader";
  header.innerText = categoryName;

  container.appendChild(header);
}

function BuildRevealRow(groupIndex, group)
{
  const container = document.getElementById("revealItemsList");

  const row = document.createElement("div");
  row.className = "revealRow";
  row.id = `revealRow_${groupIndex}`;

  const info = document.createElement("div");
  info.className = "revealRowInfo";
  info.innerHTML =
    `<span class="revealRowPlayer">${group.playerNames.join(", ")}</span>` +
    `<span class="revealRowWord">"${group.word}"</span>`;

  row.appendChild(info);

  const isOwnAnswer = group.playerIds.includes(currentPlayerId);

  if(isOwnAnswer)
  {
    // NINGUÉM QUESTIONA A PRÓPRIA RESPOSTA (nem quem dividiu o grupo com
    // ela) — só um aviso, sem botão.
    const ownLabel = document.createElement("span");
    ownLabel.className = "revealOwnLabel";
    ownLabel.innerText = "Sua resposta";
    row.appendChild(ownLabel);
  }
  else
  {
    const button = document.createElement("button");
    button.className = "challengeToggleButton";
    button.innerText = "Questionar";
    button.onclick = () => ToggleChallenge(groupIndex, button);
    row.appendChild(button);
  }

  container.appendChild(row);
}


// =========================
// QUESTIONAR (toggle — pode desfazer enquanto a janela não fechar)
// =========================

async function ToggleChallenge(index, button)
{
  if(isGamePaused) return;

  const isChallenged = challengedByMe.has(index);

  if(isChallenged)
  {
    challengedByMe.delete(index);
    button.classList.remove("selected");
    button.innerText = "Questionar";
  }
  else
  {
    challengedByMe.add(index);
    button.classList.add("selected");
    button.innerText = "Questionado!";
  }

  await set(
    ref(db, `rooms/${currentRoomCode}/currentState/reveal/challenges/${index}/${currentPlayerId}`),
    isChallenged ? null : true
  );
}


// =========================
// OPEN RESULT (pontuação da rodada — quebra por categoria + placar)
// =========================

async function OpenResult()
{
  const ownBreakdownDiv = document.getElementById("ownBreakdown");
  const scoreboardDiv = document.getElementById("resultScoreboard");

  ownBreakdownDiv.innerHTML = "";
  scoreboardDiv.innerHTML = "";

  const [ownAnswersSnapshot, ownScoresSnapshot, playersSnapshot] =
    await Promise.all(
    [
      get(ref(db, `rooms/${currentRoomCode}/history/round_${currentRound}/answers/${currentPlayerId}`)),
      get(ref(db, `rooms/${currentRoomCode}/history/round_${currentRound}/scores/${currentPlayerId}`)),
      get(ref(db, `rooms/${currentRoomCode}/players`))
    ]);

  const ownAnswers = ownAnswersSnapshot.exists() ? ownAnswersSnapshot.val() : {};
  const ownScores = ownScoresSnapshot.exists() ? ownScoresSnapshot.val() : {};

  currentCategories.forEach((category, categoryIndex) =>
  {
    const points = ownScores[categoryIndex] ?? 0;
    const word = ownAnswers[categoryIndex] || "(em branco)";

    // SÓ DISTINGUE "pontuou" (verde) de "não pontuou" (cinza) — não dá pra
    // saber, só pelo número de pontos, se foi único ou repetido sem
    // conhecer os valores configurados no host (pointsUnique/pointsDuplicate).
    const row = document.createElement("div");
    row.className = "resultRow " + (points > 0 ? "resultValid" : "resultInvalid");

    row.innerHTML =
      `<span class="resultCategory">${category}</span>` +
      `<span class="resultWord">${word}</span>` +
      `<span class="resultPoints">+${points}</span>`;

    ownBreakdownDiv.appendChild(row);
  });

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
