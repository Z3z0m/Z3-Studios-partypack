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

let alreadyAnswered = false;
let alreadyJudged = false;
let currentGameState = "Lobby";
let currentJudgingAuthorId = null;
let isGamePaused = false;
let isHost = false;

// QUADRO DE CLASSIFICAÇÃO (Refining): as notas dadas durante o Judging
// sequencial ficam guardadas aqui em memória — não precisa reler nada do
// Firebase pra já chegar no Refining com o quadro pré-preenchido.
let answersMap = {}; // authorId -> {authorName, text}  (todas as respostas da rodada, exceto a minha)
let myGuesses = {}; // authorId -> nota (0-5) que EU dei
let refiningReadySent = false;
let dragState = null; // { authorId, pointerId, offsetX, offsetY }

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

window.onload = async function()
{
  await CheckIfHost();
  ListenForGameState();
  ListenForTheme();
  ListenForMySecretGrade();
  ListenForAllAnswers();
  ListenForPause();
};


// =========================
// HOST CONTROLS
// =========================

async function CheckIfHost()
{
    const snapshot = await get(
        ref(
            db,
            `rooms/${currentRoomCode}/players/${currentPlayerId}/isHost`
        )
    );

    isHost = snapshot.val() === true;

    if (isHost)
        UpdateHostButton("Lobby");
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
    if (!isHost) return;

    const btn = document.getElementById("hostButton");

    // ESCONDE nas fases onde os próprios jogadores é que fazem a ação
    // (escrever, julgar ou reclassificar) — não faz sentido o host "pular"
    // enquanto todo mundo ainda está mexendo na tela. Tutorial tem seus
    // próprios botões (SendTutorialAction), então o genérico também some lá.
    const hidden =
        state === "Tutorial" ||
        state === "Writing" ||
        state === "Judging" ||
        state === "Refining";

    if (hidden)
    {
        btn.style.display = "none";
        return;
    }

    btn.style.display = "block";

    const labels =
    {
        "Lobby":       "Começar Jogo",
        "FinalScore":  "Jogar de Novo",
    };

    btn.innerText =
        labels[state] ?? "Próxima Etapa";
}


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
// LISTEN THEME / EIXO-GUIA
// =========================

function ListenForTheme()
{
  onValue(
    ref(db, `rooms/${currentRoomCode}/currentState/theme`),
    (snapshot) =>
    {
      const theme = snapshot.val();

      if(!theme) return;

      document.getElementById("themeBanner").innerText = theme;
      document.getElementById("themeRevealTheme").innerText = theme;
      document.getElementById("writingTheme").innerText = theme;
    }
  );

  onValue(
    ref(db, `rooms/${currentRoomCode}/currentState/axis`),
    (snapshot) =>
    {
      const axis = snapshot.val();

      if(!axis) return;

      document.getElementById("themeRevealAxis").innerText = axis;
      document.getElementById("writingAxis").innerText = axis;
      document.getElementById("judgingAxis").innerText = axis;
      document.getElementById("rankBoardAxis").innerText = axis;
    }
  );
}


// =========================
// LISTEN FOR MY SECRET GRADE
// Só lê o próprio caminho (currentState/secretGrades/{meuId}) — nunca o nó
// inteiro de secretGrades, pra não expor a nota dos outros no console/rede
// por acidente. Também é o sinal de "rodada nova" — reseta o quadro.
// =========================

function ListenForMySecretGrade()
{
  onValue(
    ref(db, `rooms/${currentRoomCode}/currentState/secretGrades/${currentPlayerId}`),
    (snapshot) =>
    {
      const grade = snapshot.val();

      if(grade === null) return;

      document.getElementById("secretGradeValue").innerText = grade;
      document.getElementById("writingSecretGradeValue").innerText = grade;

      alreadyAnswered = false;
      myGuesses = {};
      refiningReadySent = false;

      document.getElementById("answerInput").disabled = false;
      document.getElementById("sendButton").disabled = false;
      document.getElementById("answerInput").value = "";
      document.getElementById("waitingText").innerText = "";
    }
  );
}


// =========================
// SEND ANSWER
// =========================

window.sendAnswer = async function()
{
  if(isGamePaused) return;

  if(alreadyAnswered)
  {
    return;
  }

  const answerText =
    document
    .getElementById("answerInput")
    .value
    .trim();

  if(answerText.length <= 0)
  {
    return;
  }

  const roundSnapshot =
    await get(
      ref(
        db,
        `rooms/${currentRoomCode}/currentState/round`
      )
    );

  const currentRoundValue =
    roundSnapshot.val();

  await set(
    ref(
      db,
      `rooms/${currentRoomCode}/history/round_${currentRoundValue}/answers/${currentPlayerId}`
    ),
    {
      playerName: currentPlayerName,
      text: answerText
    }
  );

  console.log("Resposta enviada!");

  alreadyAnswered = true;

  document.getElementById("answerInput").disabled = true;
  document.getElementById("sendButton").disabled = true;

  document
    .getElementById("waitingText")
    .innerText =
      "Esperando outros jogadores...";
};


// =========================
// LISTEN GAME STATE
// =========================

function ListenForGameState()
{
  const stateRef =
    ref(
      db,
      `rooms/${currentRoomCode}/currentState/gameState`
    );

  onValue(stateRef, (snapshot) =>
  {
    const gameState = snapshot.val();

    currentGameState = gameState;

    UpdateHostButton(gameState);

    const isRefiningPhase = gameState == "Refining";

    document.getElementById("rankBoardWrapper").classList.toggle("active", isRefiningPhase);
    document.querySelector(".container").style.display = isRefiningPhase ? "none" : "block";

    document
      .getElementById("themeBanner")
      .style.display =
        (gameState == "Writing" || gameState == "Judging" || isRefiningPhase || gameState == "Reveal")
          ? "block" : "none";

    if(gameState == "Lobby") { ShowScreen("lobbyScreen") }

    if(gameState == "Tutorial")
    {
      ShowScreen("tutorialScreen");

      document
        .getElementById("tutorialControls")
        .style.display =
        isHost ? "flex" : "none";
    }

    if(gameState == "ThemeReveal") { ShowScreen("themeRevealScreen"); }

    if(gameState == "Writing") { ShowScreen("writingScreen"); }

    if(gameState == "Judging")
    {
      ShowScreen("judgingScreen");
      OpenJudging();
    }

    if(gameState == "Refining")
    {
      ShowScreen("refiningScreen");
      OpenRefining();
    }

    if(gameState == "Reveal")
    {
      ShowScreen("revealScreen");
      OpenReveal();
    }

    if(gameState == "RoundScore")
    {
      ShowScreen("roundScoreScreen");
      OpenRoundScore();
    }

    if(gameState == "FinalScore")
    {
      ShowScreen("finalScoreScreen");
      OpenFinalScore();
    }
  });
}


// =========================
// LISTEN FOR ALL ANSWERS (respostas públicas da rodada, sem nota nenhuma —
// usado só pra montar o quadro do Refining)
// =========================

function ListenForAllAnswers()
{
  onValue(
    ref(db, `rooms/${currentRoomCode}/currentState/allAnswers`),
    (snapshot) =>
    {
      answersMap = {};

      snapshot.forEach((child) =>
      {
        if(child.key === currentPlayerId) return; // não julgo a própria resposta

        answersMap[child.key] = child.val();
      });

      if(currentGameState === "Refining") RenderBoard();
    }
  );
}


// =========================
// JUDGING (sequencial — uma resposta por vez)
// =========================

function OpenJudging()
{
  const currentAnswerRef =
    ref(db, `rooms/${currentRoomCode}/currentState/currentAnswer`);

  onValue(currentAnswerRef, (snapshot) =>
  {
    if(!snapshot.exists()) return;
    if(currentGameState !== "Judging") return;

    const data = snapshot.val();

    // NOVA RESPOSTA (autor mudou): reseta o estado local de julgamento.
    if(data.authorId !== currentJudgingAuthorId)
    {
      currentJudgingAuthorId = data.authorId;
      alreadyJudged = myGuesses[data.authorId] !== undefined;

      document
        .querySelectorAll(".gradeButton")
        .forEach(btn => btn.classList.remove("selected"));

      if(alreadyJudged)
      {
        const btn = document.querySelectorAll(".gradeButton")[myGuesses[data.authorId]];
        if(btn) btn.classList.add("selected");
      }

      document.getElementById("judgingWaitingText").innerText =
        alreadyJudged ? "Esperando os outros julgarem..." : "";
    }

    document.getElementById("judgingAuthorName").innerText = data.authorName ?? "???";
    document.getElementById("judgingAnswerText").innerText = `"${data.text ?? ""}"`;
    document.getElementById("judgingProgress").innerText =
      `Resposta ${data.index ?? "?"}/${data.total ?? "?"}`;

    const isAuthor = data.authorId === currentPlayerId;

    document.getElementById("authorWaitingBox").classList.toggle("active", isAuthor);
    document.getElementById("judgeGradeBox").classList.toggle("hidden", isAuthor);
  });
}

window.submitJudgment = async function(grade)
{
  if(isGamePaused) return;
  if(alreadyJudged) return;
  if(!currentJudgingAuthorId) return;

  alreadyJudged = true;
  myGuesses[currentJudgingAuthorId] = grade;

  document
    .querySelectorAll(".gradeButton")
    .forEach(btn => btn.classList.remove("selected"));

  document
    .querySelectorAll(".gradeButton")[grade]
    .classList.add("selected");

  const roundSnapshot =
    await get(ref(db, `rooms/${currentRoomCode}/currentState/round`));

  const round = roundSnapshot.val();

  await set(
    ref(db, `rooms/${currentRoomCode}/history/round_${round}/judgments/${currentJudgingAuthorId}/${currentPlayerId}`),
    {
      playerName: currentPlayerName,
      guessedGrade: grade
    }
  );

  document.getElementById("judgingWaitingText").innerText =
    "Esperando os outros julgarem...";
};


// =========================
// REFINING (quadro com todas as respostas — arrastar pra reorganizar)
// =========================

function OpenRefining()
{
  refiningReadySent = false;

  const readyBtn = document.getElementById("refiningReadyBtn");
  readyBtn.disabled = false;
  readyBtn.innerText = "Pronto!";

  document.getElementById("authorReminder").classList.toggle("active", alreadyAnswered);
  document.getElementById("rankProgressText").innerText = "";

  RenderBoard();
}

window.markRefiningReady = async function()
{
  if(isGamePaused) return;
  if(refiningReadySent) return;

  refiningReadySent = true;

  await set(
    ref(db, `rooms/${currentRoomCode}/currentState/refiningReady/${currentPlayerId}`),
    true
  );

  const readyBtn = document.getElementById("refiningReadyBtn");
  readyBtn.disabled = true;
  readyBtn.innerText = "Aguardando os outros...";
};


// =========================
// QUADRO: RENDERIZAÇÃO
// =========================

function RenderBoard()
{
  const tray = document.getElementById("rankTray");
  tray.innerHTML = "";

  document
    .querySelectorAll(".rankColumnCards")
    .forEach(col => col.innerHTML = "");

  Object.keys(answersMap).forEach((authorId) =>
  {
    const answer = answersMap[authorId];

    const card = document.createElement("div");
    card.className = "answerCard";
    card.dataset.authorId = authorId;

    const authorSpan = document.createElement("span");
    authorSpan.className = "cardAuthor";
    authorSpan.innerText = answer.authorName ?? "???";

    const textSpan = document.createElement("span");
    textSpan.className = "cardText";
    textSpan.innerText = answer.text ?? "";

    card.appendChild(authorSpan);
    card.appendChild(textSpan);

    AttachDragHandlers(card, authorId);

    const grade = myGuesses[authorId];

    if(grade === undefined || grade === null)
    {
      tray.appendChild(card);
    }
    else
    {
      const column = document.querySelector(`.rankColumnCards[data-grade="${grade}"]`);
      if(column) column.appendChild(card);
      else tray.appendChild(card);
    }
  });
}

// =========================
// ARRASTAR (Pointer Events — funciona com mouse E touch, sem precisar de
// nenhuma lib. HTML5 drag-and-drop nativo não é confiável em touch/mobile,
// por isso o gesto inteiro é feito na mão aqui.)
// =========================

function AttachDragHandlers(card, authorId)
{
  card.addEventListener("pointerdown", (event) => StartDrag(card, authorId, event));
}

function StartDrag(card, authorId, event)
{
  if(isGamePaused) return;
  if(currentGameState !== "Refining") return;

  event.preventDefault();

  const rect = card.getBoundingClientRect();

  dragState =
  {
    authorId: authorId,
    pointerId: event.pointerId,
    offsetX: event.clientX - rect.left,
    offsetY: event.clientY - rect.top
  };

  card.setPointerCapture(event.pointerId);
  card.classList.add("dragging");
  card.style.position = "fixed";
  card.style.width = rect.width + "px";
  card.style.zIndex = 1000;

  MoveCardTo(card, event.clientX, event.clientY);

  card.addEventListener("pointermove", OnDragMove);
  card.addEventListener("pointerup", OnDragEnd);
  card.addEventListener("pointercancel", OnDragEnd);
}

function MoveCardTo(card, clientX, clientY)
{
  card.style.left = (clientX - dragState.offsetX) + "px";
  card.style.top = (clientY - dragState.offsetY) + "px";
}

function OnDragMove(event)
{
  if(!dragState || event.pointerId !== dragState.pointerId) return;

  MoveCardTo(event.currentTarget, event.clientX, event.clientY);
  HighlightDropTarget(event.clientX, event.clientY);
}

function HighlightDropTarget(x, y)
{
  document
    .querySelectorAll(".rankColumn.dragOver")
    .forEach(col => col.classList.remove("dragOver"));

  const elementBelow = document.elementFromPoint(x, y);
  const column = elementBelow ? elementBelow.closest(".rankColumn") : null;

  if(column) column.classList.add("dragOver");
}

async function OnDragEnd(event)
{
  if(!dragState || event.pointerId !== dragState.pointerId) return;

  const card = event.currentTarget;

  card.removeEventListener("pointermove", OnDragMove);
  card.removeEventListener("pointerup", OnDragEnd);
  card.removeEventListener("pointercancel", OnDragEnd);

  card.classList.remove("dragging");
  card.style.position = "";
  card.style.left = "";
  card.style.top = "";
  card.style.width = "";
  card.style.zIndex = "";

  document
    .querySelectorAll(".rankColumn.dragOver")
    .forEach(col => col.classList.remove("dragOver"));

  const elementBelow = document.elementFromPoint(event.clientX, event.clientY);
  const column = elementBelow ? elementBelow.closest(".rankColumn") : null;

  const authorId = dragState.authorId;
  dragState = null;

  if(column)
  {
    const grade = parseInt(column.querySelector(".rankColumnCards").dataset.grade, 10);
    await PlaceCard(authorId, grade);
  }
  else
  {
    // SOLTOU FORA de qualquer coluna: a carta volta pra onde estava.
    RenderBoard();
  }
}

async function PlaceCard(authorId, grade)
{
  if(currentGameState !== "Refining") return;

  myGuesses[authorId] = grade;

  RenderBoard();

  const roundSnapshot =
    await get(ref(db, `rooms/${currentRoomCode}/currentState/round`));

  const round = roundSnapshot.val();

  await set(
    ref(db, `rooms/${currentRoomCode}/history/round_${round}/judgments/${authorId}/${currentPlayerId}`),
    {
      playerName: currentPlayerName,
      guessedGrade: grade
    }
  );
}


// =========================
// REVEAL (uma resposta por vez — só assistir)
// =========================

async function OpenReveal()
{
  const answerSnapshot =
    await get(ref(db, `rooms/${currentRoomCode}/currentState/currentAnswer`));

  const answer = answerSnapshot.val() ?? {};

  document.getElementById("revealProgress").innerText =
    `Resposta ${answer.index ?? "?"}/${answer.total ?? "?"}`;

  document.getElementById("revealAuthorName").innerText = answer.authorName ?? "???";
  document.getElementById("revealAnswerText").innerText = `"${answer.text ?? ""}"`;

  const resultSnapshot =
    await get(ref(db, `rooms/${currentRoomCode}/currentState/answerResult`));

  const mineDiv = document.getElementById("revealMine");
  mineDiv.innerHTML = "";

  if(!resultSnapshot.exists())
  {
    document.getElementById("revealRealGrade").innerText = "?";
    return;
  }

  const result = resultSnapshot.val();

  document.getElementById("revealRealGrade").innerText =
    result.realGrade ?? "?";

  // MODO EXPERIMENTAL: pontos vão pro escritor (ver pointsGoToWriters no
  // GameManager) — mostra quanto o AUTOR ganhou em vez do chute individual.
  if(result.pointsGoToWriters)
  {
    if(answer.authorId === currentPlayerId)
    {
      mineDiv.innerText = `Você ganhou ${result.authorPoints ?? 0} pontos!`;
    }
    else
    {
      mineDiv.innerText = `${answer.authorName ?? "O escritor"} ganhou ${result.authorPoints ?? 0} pontos!`;
    }

    return;
  }

  const myEntry = result.entries ? result.entries[currentPlayerId] : null;

  if(myEntry)
  {
    const points = myEntry.points >= 0 ? `+${myEntry.points}` : myEntry.points;
    mineDiv.innerText =
      `Você chutou ${myEntry.guessedGrade} (${points} pontos)`;
  }
  else if(answer.authorId === currentPlayerId)
  {
    mineDiv.innerText = "Era a sua resposta!";
  }
}


// =========================
// ROUND SCORE
// =========================

function OpenRoundScore()
{
  const resultRef =
    ref(db, `rooms/${currentRoomCode}/players`);

  onValue(resultRef, (snapshot) =>
  {
    const resultDiv =
      document.getElementById("roundScores");

    resultDiv.innerHTML = "";

    snapshot.forEach((child) =>
    {
      const data = child.val();

      const score =
        data.score || 0;

      const item =
        document.createElement("div");

      item.className = "scoreItem";

      item.innerText =
        `${data.name} - ${score}`;

      resultDiv.appendChild(item);
    });
  });
}


// =========================
// FINAL SCORE
// =========================

async function OpenFinalScore()
{
  const playersSnapshot =
    await get(ref(db, `rooms/${currentRoomCode}/players`));

  const finalDiv =
    document.getElementById("finalScores");

  finalDiv.innerHTML = "";

  if(!playersSnapshot.exists()) return;

  const players =
    Object.values(playersSnapshot.val());

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
