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
let judgingAnswerUnsubscribe = null; // desliga o listener da rodada anterior antes de abrir um novo
let pendingGrade = null; // nota selecionada no Julgar, ainda não confirmada
let isGamePaused = false;
let isHost = false;

// QUADRO DE CLASSIFICAÇÃO (Refining): as notas dadas durante o Judging
// sequencial ficam guardadas aqui em memória — não precisa reler nada do
// Firebase pra já chegar no Refining com o quadro pré-preenchido.
let answersMap = {}; // authorId -> {authorName, text}  (todas as respostas da rodada, exceto a minha)
let myGuesses = {}; // authorId -> nota (0-5) que EU dei
let originalGuesses = {}; // snapshot do myGuesses de quando o Refining abriu, só pra marcar quem mudou
let refiningReadySent = false;
let refiningReadyCount = 0;
let refiningTotalPlayers = 0;
let dragState = null; // { authorId, pointerId, offsetX, offsetY }

// Tema/eixo/nota secreta chegam em listeners separados — guardados aqui pra
// poder montar a frase combinada da tela "Nota secreta" assim que os dois já
// tiverem chegado.
let lastAxisText = "";
let lastSecretGrade = null;

// =========================
// TUTORIAL (conteúdo é local — só o host navega, mas o texto de cada passo
// mora aqui no client mesmo, não vem do Firebase).
// =========================

const TUTORIAL_STEPS =
[
  "Cada rodada tem um tema e um eixo, tipo \"quão associado ao Natal\". Todo mundo recebe uma nota secreta de 0 a 5 e escreve uma resposta que valha exatamente aquilo.",
  "As respostas de todo mundo aparecem pra galera julgar — o nome de quem escreveu já vem junto. O desafio não é adivinhar o autor, é acertar a nota secreta dele.",
  "As respostas aparecem uma de cada vez. Enquanto a sua estiver sendo julgada, você não pode falar nem dar dicas.",
  "Depois de julgar todo mundo, dá uma última chance: reorganize as respostas arrastando — pode mudar de ideia quantas vezes quiser antes de confirmar.",
  "No final, quem chegou mais perto da nota secreta de cada resposta ganha pontos. Quem tiver mais pontos depois de todas as rodadas vence!"
];

let tutorialStepIndex = 0;

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
  document.getElementById("lobbyPlayerName").innerText = currentPlayerName ?? "Você";

  await CheckIfHost();
  ListenForGameState();
  ListenForTheme();
  ListenForMySecretGrade();
  ListenForAllAnswers();
  ListenForLobbyPlayers();
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

    document.getElementById("lobbyHostBadge").hidden = !isHost;

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
    if(action === "next" && tutorialStepIndex < TUTORIAL_STEPS.length - 1)
    {
        tutorialStepIndex++;
    }

    if(action === "prev" && tutorialStepIndex > 0)
    {
        tutorialStepIndex--;
    }

    RenderTutorialStep();

    await set(
        ref(db, `rooms/${currentRoomCode}/tutorialAction`),
        { action: action, t: Date.now() }
    );
};

function RenderTutorialStep()
{
    document.getElementById("tutorialStepBadge").innerText = tutorialStepIndex + 1;
    document.getElementById("tutorialStepOf").innerText = `de ${TUTORIAL_STEPS.length}`;
    document.getElementById("tutorialStepText").innerText = TUTORIAL_STEPS[tutorialStepIndex];

    document.getElementById("tutorialPrevBtn").disabled = tutorialStepIndex === 0;
}

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
        "Lobby":       "Começar",
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
// LISTEN FOR LOBBY PLAYERS
// =========================

function ListenForLobbyPlayers()
{
  onValue(
    ref(db, `rooms/${currentRoomCode}/players`),
    (snapshot) =>
    {
      const listDiv = document.getElementById("lobbyPlayerList");
      listDiv.innerHTML = "";

      let count = 0;

      snapshot.forEach((child) =>
      {
        count++;

        const data = child.val();

        const row = document.createElement("div");
        row.className = "lobbyPlayerRow";

        if(child.key === currentPlayerId) row.classList.add("isMe");

        row.innerText = data.name ?? "???";

        listDiv.appendChild(row);
      });

      document.getElementById("lobbyPlayerCount").innerText = `${count} na sala`;
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

      lastAxisText = axis;

      document.getElementById("writingAxis").innerText = axis;
      document.getElementById("rankBoardAxis").innerText = axis;

      UpdateSecretSentence();
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

      lastSecretGrade = grade;

      document.getElementById("secretGradeValue").innerText = grade;
      document.getElementById("writingSecretGradeValue").innerText = grade;

      UpdateSecretSentence();

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

// Monta a frase "Escreva algo que valha exatamente X no eixo 'Y'." assim que
// o tema/eixo E a nota secreta já tiverem chegado (via DOM em vez de innerHTML
// pra não depender de escapar o texto do eixo à mão).
function UpdateSecretSentence()
{
  if(lastSecretGrade === null || !lastAxisText) return;

  const sentence = document.getElementById("themeRevealSentence");
  sentence.innerHTML = "";

  sentence.append("Escreva algo que valha exatamente ");

  const gradeStrong = document.createElement("strong");
  gradeStrong.innerText = lastSecretGrade;
  sentence.append(gradeStrong);

  sentence.append(" no eixo ");

  const axisStrong = document.createElement("strong");
  axisStrong.innerText = `"${lastAxisText}"`;
  sentence.append(axisStrong);

  sentence.append(".");
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

    if(gameState == "Lobby") { ShowScreen("lobbyScreen") }

    if(gameState == "Tutorial")
    {
      ShowScreen("tutorialScreen");

      document.getElementById("tutorialHostView").hidden = !isHost;
      document.getElementById("tutorialWaitingText").hidden = isHost;
      document.getElementById("tutorialControls").style.display = isHost ? "flex" : "none";

      if(isHost)
      {
        tutorialStepIndex = 0;
        RenderTutorialStep();
      }
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
// PLAYERS (ordenados por pontuação — usado no Reveal e no placar final)
// =========================

async function GetSortedPlayers()
{
  const snapshot =
    await get(ref(db, `rooms/${currentRoomCode}/players`));

  if(!snapshot.exists()) return [];

  const players = [];

  snapshot.forEach((child) =>
  {
    players.push({ id: child.key, ...child.val() });
  });

  players.sort((a, b) => (b.score || 0) - (a.score || 0));

  return players;
}


// =========================
// JUDGING (sequencial — uma resposta por vez). O julgador SELECIONA uma nota
// (fica destacada) e só grava no Firebase quando aperta "Confirmar" — dá pra
// mudar de ideia antes de confirmar.
// =========================

function OpenJudging()
{
  // Cada rodada chama OpenJudging de novo — sem isso, os listeners de
  // rodadas anteriores continuam ativos e disparam junto com o novo,
  // dessincronizando alreadyJudged/pendingGrade logo na 1ª resposta da rodada.
  if(judgingAnswerUnsubscribe)
  {
    judgingAnswerUnsubscribe();
    judgingAnswerUnsubscribe = null;
  }

  const currentAnswerRef =
    ref(db, `rooms/${currentRoomCode}/currentState/currentAnswer`);

  judgingAnswerUnsubscribe = onValue(currentAnswerRef, (snapshot) =>
  {
    if(!snapshot.exists()) return;
    if(currentGameState !== "Judging") return;

    const data = snapshot.val();

    // NOVA RESPOSTA (autor mudou): reseta o estado local de julgamento.
    if(data.authorId !== currentJudgingAuthorId)
    {
      currentJudgingAuthorId = data.authorId;
      alreadyJudged = myGuesses[data.authorId] !== undefined;
      pendingGrade = alreadyJudged ? myGuesses[data.authorId] : null;

      RenderGradeSelection();

      document.getElementById("judgingConfirmBtn").disabled = alreadyJudged || pendingGrade === null;
      document.getElementById("judgingConfirmBtn").innerText = alreadyJudged ? "Julgado" : "Confirmar";

      document.getElementById("judgingWaitingText").innerText =
        alreadyJudged ? "Esperando os outros julgarem..." : "";
    }

    document.getElementById("judgingAuthorLine").innerText = `${data.authorName ?? "???"} escreveu`;
    document.getElementById("judgingAnswerText").innerText = data.text ?? "";
    document.getElementById("judgingProgress").innerText =
      `resposta ${data.index ?? "?"} de ${data.total ?? "?"}`;

    const isAuthor = data.authorId === currentPlayerId;

    document.getElementById("judgingScreen").classList.toggle("authorBlocked", isAuthor);
    document.getElementById("judgingContent").hidden = isAuthor;
    document.getElementById("authorBlockedContent").hidden = !isAuthor;

    document.getElementById("authorBlockedAnswerText").innerText = data.text ?? "";
  });
}

function RenderGradeSelection()
{
  document
    .querySelectorAll(".gradeButton")
    .forEach((btn, index) =>
    {
      btn.classList.toggle("selected", index === pendingGrade);
      btn.disabled = alreadyJudged;
    });
}

window.selectJudgmentGrade = function(grade)
{
  if(isGamePaused) return;
  if(alreadyJudged) return;

  pendingGrade = grade;

  RenderGradeSelection();

  document.getElementById("judgingConfirmBtn").disabled = false;
};

window.confirmJudgment = async function()
{
  if(isGamePaused) return;
  if(alreadyJudged) return;
  if(pendingGrade === null) return;
  if(!currentJudgingAuthorId) return;

  alreadyJudged = true;
  myGuesses[currentJudgingAuthorId] = pendingGrade;

  RenderGradeSelection();

  document.getElementById("judgingConfirmBtn").disabled = true;
  document.getElementById("judgingConfirmBtn").innerText = "Julgado";

  const roundSnapshot =
    await get(ref(db, `rooms/${currentRoomCode}/currentState/round`));

  const round =
    roundSnapshot.val();

  await set(
    ref(db, `rooms/${currentRoomCode}/history/round_${round}/judgments/${currentJudgingAuthorId}/${currentPlayerId}`),
    {
      playerName: currentPlayerName,
      guessedGrade: pendingGrade
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

  // Guarda a nota que cada resposta tinha ANTES do rebalanceamento, só pra
  // conseguir destacar visualmente quem mudou (ver RenderBoard).
  originalGuesses = { ...myGuesses };

  const readyBtn = document.getElementById("refiningReadyBtn");
  readyBtn.disabled = false;
  readyBtn.innerText = "Tô pronto";

  document.getElementById("authorReminder").classList.toggle("active", alreadyAnswered);
  document.getElementById("rankProgressText").innerText = "";

  RenderBoard();
  ListenForRefiningReady();
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

// Conta "X/Y prontos" a partir de dois nós que já existem no Firebase (não
// inventa nenhum campo novo): a lista de jogadores da sala e o nó de
// refiningReady que markRefiningReady já escreve.
function ListenForRefiningReady()
{
  onValue(
    ref(db, `rooms/${currentRoomCode}/players`),
    (snapshot) =>
    {
      let count = 0;
      snapshot.forEach(() => { count++; });

      refiningTotalPlayers = count;
      UpdateRefiningProgressText();
    }
  );

  onValue(
    ref(db, `rooms/${currentRoomCode}/currentState/refiningReady`),
    (snapshot) =>
    {
      let count = 0;
      snapshot.forEach((child) => { if(child.val() === true) count++; });

      refiningReadyCount = count;
      UpdateRefiningProgressText();
    }
  );
}

function UpdateRefiningProgressText()
{
  if(currentGameState !== "Refining") return;

  document.getElementById("rankProgressText").innerText =
    `${refiningReadyCount}/${refiningTotalPlayers} prontos`;
}


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
    const grade = myGuesses[authorId];
    const originalGrade = originalGuesses[authorId];
    const hasChanged = originalGrade !== undefined && originalGrade !== grade;

    const card = document.createElement("div");
    card.className = "answerCard";
    if(hasChanged) card.classList.add("changed");
    card.dataset.authorId = authorId;

    const gradeChip = document.createElement("span");
    gradeChip.className = "cardGrade";
    gradeChip.innerText = (grade === undefined || grade === null) ? "?" : grade;

    const body = document.createElement("span");
    body.className = "cardBody";

    const answerSpan = document.createElement("span");
    answerSpan.className = "cardAuthor";
    answerSpan.innerText = answer.text ?? "";

    const metaSpan = document.createElement("span");
    metaSpan.className = "cardMeta";
    metaSpan.innerText =
      hasChanged
        ? `${answer.authorName ?? "???"} · ${originalGrade} → ${grade}`
        : (answer.authorName ?? "???");

    body.appendChild(answerSpan);
    body.appendChild(metaSpan);

    const handle = document.createElement("span");
    handle.className = "cardHandle";
    handle.innerText = "⠿";

    card.appendChild(gradeChip);
    card.appendChild(body);
    card.appendChild(handle);

    AttachDragHandlers(card, authorId);

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

  // Sem isso, a própria carta arrastada (que fica bem em cima do cursor)
  // é o elemento "atingido" pelo elementFromPoint usado pra achar a coluna.
  card.style.pointerEvents = "none";

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

// Acha a coluna sob o CENTRO da carta (não sob o cursor) — o cursor pode
// estar em qualquer ponto da carta (ex: segurando pelo "⠿" na ponta), então
// usar a posição dele como referência deixa a hitbox torta perto da borda
// entre colunas.
function GetColumnUnderCard(card)
{
  const rect = card.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;

  const elementBelow = document.elementFromPoint(centerX, centerY);
  return elementBelow ? elementBelow.closest(".rankColumn") : null;
}

function OnDragMove(event)
{
  if(!dragState || event.pointerId !== dragState.pointerId) return;

  const card = event.currentTarget;

  MoveCardTo(card, event.clientX, event.clientY);
  HighlightDropTarget(card);
}

function HighlightDropTarget(card)
{
  document
    .querySelectorAll(".rankColumn.dragOver")
    .forEach(col => col.classList.remove("dragOver"));

  const column = GetColumnUnderCard(card);

  if(column) column.classList.add("dragOver");
}

async function OnDragEnd(event)
{
  if(!dragState || event.pointerId !== dragState.pointerId) return;

  const card = event.currentTarget;

  card.removeEventListener("pointermove", OnDragMove);
  card.removeEventListener("pointerup", OnDragEnd);
  card.removeEventListener("pointercancel", OnDragEnd);

  // Precisa calcular ANTES de desfazer os estilos de arraste, senão a carta
  // já volta pro layout normal e o rect deixa de refletir onde ela foi solta.
  const column = GetColumnUnderCard(card);

  card.classList.remove("dragging");
  card.style.position = "";
  card.style.left = "";
  card.style.top = "";
  card.style.width = "";
  card.style.zIndex = "";
  card.style.pointerEvents = "";

  document
    .querySelectorAll(".rankColumn.dragOver")
    .forEach(col => col.classList.remove("dragOver"));

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
// RESULTADO PESSOAL (Reveal) — uma resposta por vez, só assistir
// =========================

function ResultLabelForDiff(diff)
{
  if(diff === 0) return "Na mosca";
  if(diff === 1) return "Quase lá";
  if(diff === 2) return "Por pouco";
  if(diff <= 4) return "Longe disso";
  return "Muito longe";
}

async function OpenReveal()
{
  // O resultado detalhado só aparece na tela do host (segurando o celular
  // pra galera ver junto) — os outros só acompanham por ali, igual no
  // Tutorial. Evita ficar lendo o Firebase à toa em quem nem vai mostrar nada.
  document.getElementById("revealHostView").hidden = !isHost;
  document.getElementById("revealWaitingText").hidden = isHost;

  if(!isHost) return;

  const answerSnapshot =
    await get(ref(db, `rooms/${currentRoomCode}/currentState/currentAnswer`));

  const answer = answerSnapshot.val() ?? {};

  document.getElementById("revealProgress").innerText =
    `resposta de ${answer.authorName ?? "???"} · ${answer.text ?? "?"}`;

  // "seu total" — reaproveita o mesmo nó de players/score já usado no
  // placar da rodada e no placar final, só pra saber a colocação atual.
  const players = await GetSortedPlayers();
  const myRank = players.findIndex((player) => player.id === currentPlayerId);
  const myPlayer = myRank >= 0 ? players[myRank] : null;

  document.getElementById("revealTotalRank").innerText =
    myRank >= 0 ? `${myRank + 1}º lugar` : "";
  document.getElementById("revealTotalScore").innerText =
    myPlayer ? (myPlayer.score || 0) : 0;

  const resultSnapshot =
    await get(ref(db, `rooms/${currentRoomCode}/currentState/answerResult`));

  if(!resultSnapshot.exists())
  {
    document.getElementById("revealMyGuess").innerText = "?";
    document.getElementById("revealRealGrade").innerText = "?";
    document.getElementById("revealResultLabel").innerText = "";
    document.getElementById("revealPoints").innerText = "";
    return;
  }

  const result = resultSnapshot.val();
  const realGrade = result.realGrade ?? "?";

  document.getElementById("revealRealGrade").innerText = realGrade;

  // Escritor e julgadores pontuam sempre: quem é o autor da resposta atual
  // vê os pontos que ganhou pela soma dos acertos de todo mundo; quem julgou
  // vê os pontos que ganhou pelo próprio chute.
  const isMeTheAuthor = answer.authorId === currentPlayerId;

  if(isMeTheAuthor)
  {
    document.getElementById("revealMyGuess").innerText = "—";
    document.getElementById("revealResultLabel").innerText = "Sua resposta";
    document.getElementById("revealPoints").innerText =
      `+${result.authorPoints ?? 0} pontos pra você`;

    return;
  }

  const myEntry = result.entries ? result.entries[currentPlayerId] : null;

  if(myEntry)
  {
    const diff = Math.abs((myEntry.guessedGrade ?? 0) - (result.realGrade ?? 0));
    const points = myEntry.points >= 0 ? `+${myEntry.points}` : myEntry.points;

    document.getElementById("revealMyGuess").innerText = myEntry.guessedGrade;
    document.getElementById("revealResultLabel").innerText = ResultLabelForDiff(diff);
    document.getElementById("revealPoints").innerText = `${points} pontos`;
  }
  else
  {
    document.getElementById("revealMyGuess").innerText = "—";
    document.getElementById("revealResultLabel").innerText = "";
    document.getElementById("revealPoints").innerText = "";
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
// FIM (Final Score)
// =========================

async function OpenFinalScore()
{
  const players = await GetSortedPlayers();

  const finalDiv = document.getElementById("finalScores");
  finalDiv.innerHTML = "";

  document.getElementById("finalWinnerBanner").innerHTML = "";
  document.getElementById("finalMeta").innerText = "";

  if(players.length <= 0) return;

  const winner = players[0];

  const banner = document.getElementById("finalWinnerBanner");
  banner.append(`${winner.name ?? "???"} `);

  const winnerTag = document.createElement("span");
  winnerTag.innerText = "venceu";
  banner.append(winnerTag);

  const roundSnapshot =
    await get(ref(db, `rooms/${currentRoomCode}/currentState/round`));

  const round = roundSnapshot.val();

  document.getElementById("finalMeta").innerText =
    round
      ? `${winner.score || 0} pontos · ${round} rodada${round === 1 ? "" : "s"}`
      : `${winner.score || 0} pontos`;

  players
    .slice(1)
    .forEach((player, index) =>
    {
      const rank = index + 2;

      const row = document.createElement("div");
      row.className = "finalScoreRow";
      if(player.id === currentPlayerId) row.classList.add("isMe");

      const nameSpan = document.createElement("span");
      nameSpan.innerText = `${rank}º ${player.name ?? "???"}`;

      const valueSpan = document.createElement("span");
      valueSpan.className = "finalScoreValue";
      valueSpan.innerText = player.score || 0;

      row.appendChild(nameSpan);
      row.appendChild(valueSpan);

      finalDiv.appendChild(row);
    });
}
