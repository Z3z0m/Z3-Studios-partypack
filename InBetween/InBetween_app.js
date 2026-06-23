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
let isImpostor = false;
let alreadyAnswered = false;
let alreadyVoted = false;
let alreadyGuessed = false;
let alreadyCalledForVote = false;
let alreadySubmittedQuestion = false;
let countdownInterval = null;
let currentSecretWord = "";


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
// ROUND KEY (impostorRound_questionRound)
// =========================

async function GetRoundKey()
{
  const impostorRoundSnapshot =
    await get(
      ref(db, `rooms/${currentRoomCode}/currentState/impostorRound`)
    );

  const questionRoundSnapshot =
    await get(
      ref(db, `rooms/${currentRoomCode}/currentState/questionRound`)
    );

  return `round_${impostorRoundSnapshot.val()}_${questionRoundSnapshot.val()}`;
}


// =========================
// START
// =========================

window.onload = function()
{
  ListenForGameState();
  ListenForVisibilityRecovery();
  ListenForImpostor();
  ListenForWord();
  CheckIfHost();
};


// =========================
// HOST CONTROLS (começar jogo / pular etapa)
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

function UpdateHostButton(state)
{
  if(!isHost) return;

  const btn = document.getElementById("hostButton");

  // ESCONDE nos estados sem timer pra "pular" (RevealAnswers é uma
  // animação automática, FinalScore já é o fim de jogo).
  const hidden =
    state === "RevealAnswers" ||
    state === "FinalScore";

  if(hidden)
  {
    btn.style.display = "none";
    return;
  }

  btn.style.display = "block";

  const labels =
  {
    "Lobby":      "Começar Jogo",
    "RoundScore": "Próxima Rodada",
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
    ref(
      db,
      `rooms/${currentRoomCode}/currentState/gameState`
    );

  gameStateUnsubscribe = onValue(stateRef, (snapshot) =>
  {
    ApplyGameState(snapshot.val());
  });
}


// =========================
// APPLY GAME STATE
// (separado do listener para poder ser chamado de novo ao recuperar o foco
// da aba — ver ListenForVisibilityRecovery)
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
  UpdateRoleBanner();

  if(gameState == "Lobby") { ShowScreen("lobbyScreen"); }

  if(gameState == "RoleReveal")
  {
    ShowScreen("roleRevealScreen");
    UpdateRoleRevealScreen();
  }

  if(gameState == "WriteQuestion")
  {
    ShowScreen("writeQuestionScreen");
    OpenWriteQuestion();
  }

  if(gameState == "Question")
  {
    ShowScreen("questionScreen");
    OpenQuestion();
  }

  if(gameState == "RevealAnswers") { ShowScreen("revealAnswersScreen"); }

  if(gameState == "Discussion")
  {
    ShowScreen("discussionScreen");
    OpenDiscussion();
  }

  if(gameState == "Voting")
  {
    ShowScreen("votingScreen");
    OpenVoting();
  }

  if(gameState == "VoteResult")
  {
    ShowScreen("voteResultScreen");
    OpenVoteResult();
  }

  if(gameState == "ImpostorGuess")
  {
    ShowScreen("impostorGuessScreen");
    OpenImpostorGuess();
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
}


// =========================
// RECUPERA SINCRONIA AO VOLTAR O FOCO NA ABA
// (navegadores podem atrasar a entrega de eventos em abas em segundo plano —
// ao focar de novo, RE-REGISTRA o listener do zero, em vez de fazer uma
// leitura paralela com get(). Misturar get() com onValue no mesmo dado pode
// fazer a leitura pontual "furar a fila" de eventos pendentes do onValue e
// entregar um valor mais novo ANTES dele, fazendo o onValue, ao finalmente
// processar sua fila atrasada, sobrescrever a tela com um valor antigo.
// Re-registrar o próprio onValue evita esse cenário.)
// =========================

function ListenForVisibilityRecovery()
{
  document.addEventListener("visibilitychange", () =>
  {
    if(document.visibilityState !== "visible")
    {
      return;
    }

    console.log("[In Between] Aba voltou ao foco — ressincronizando listener de estado.");

    ListenForGameState();
  });
}


// =========================
// COUNTDOWN (contador visível no client)
// =========================

function StartCountdown(seconds, elementId)
{
  StopCountdown();

  let remaining = seconds;

  const el = document.getElementById(elementId);

  function tick()
  {
    if(el) el.innerText = `${remaining}s`;

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
// OPEN WRITE QUESTION
// =========================

async function OpenWriteQuestion()
{
  alreadySubmittedQuestion = false;

  const questionerIdSnapshot =
    await get(ref(db, `rooms/${currentRoomCode}/currentState/questionerId`));

  const questionerId = questionerIdSnapshot.val();
  const isQuestioner = questionerId === currentPlayerId;

  const writeContainer =
    document.getElementById("writeQuestionInputContainer");

  const waitingContainer =
    document.getElementById("writeQuestionWaitingContainer");

  if(isQuestioner)
  {
    writeContainer.classList.add("active");
    waitingContainer.classList.remove("active");

    document.getElementById("writeQuestionWordText").innerText =
      `Palavra: ${currentSecretWord}`;

    document.getElementById("writeQuestionInput").disabled = false;
    document.getElementById("writeQuestionInput").value = "";
    document.getElementById("sendQuestionButton").disabled = false;
    document.getElementById("writeQuestionStatusText").innerText = "";

    StartCountdown(30, "writeQuestionCountdown");
  }
  else
  {
    // NÃO REVELA QUEM É O QUESTIONER — só ele mesmo sabe que foi sorteado.
    writeContainer.classList.remove("active");
    waitingContainer.classList.add("active");

    StartCountdown(30, "writeQuestionWaitingCountdown");
  }
}


// =========================
// SEND CUSTOM QUESTION
// =========================

window.sendCustomQuestion = async function()
{
  if(alreadySubmittedQuestion)
  {
    return;
  }

  const questionText =
    document
    .getElementById("writeQuestionInput")
    .value
    .trim();

  if(questionText.length <= 0)
  {
    return;
  }

  alreadySubmittedQuestion = true;

  await set(
    ref(db, `rooms/${currentRoomCode}/currentState/customQuestion/text`),
    questionText
  );

  document.getElementById("writeQuestionInput").disabled = true;
  document.getElementById("sendQuestionButton").disabled = true;

  document.getElementById("writeQuestionStatusText").innerText =
    "Pergunta enviada!";

  StopCountdown();

  console.log("Pergunta customizada enviada!");
};


// =========================
// OPEN DISCUSSION
// =========================

let skipDiscussionUnsubscribe = null;

function OpenDiscussion()
{
  alreadyCalledForVote = false;

  document.getElementById("skipDiscussionButton").disabled = false;
  document.getElementById("skipDiscussionStatusText").innerText = "";

  // REMOVE O LISTENER DA RODADA ANTERIOR ANTES DE REGISTRAR UM NOVO —
  // sem isso, cada entrada em "Discussion" acumulava mais um onValue ativo.
  if(skipDiscussionUnsubscribe)
  {
    skipDiscussionUnsubscribe();
    skipDiscussionUnsubscribe = null;
  }

  const skipRef =
    ref(db, `rooms/${currentRoomCode}/currentState/skipDiscussionVotes`);

  skipDiscussionUnsubscribe = onValue(skipRef, (snapshot) =>
  {
    const count =
      snapshot.exists() ? Object.keys(snapshot.val()).length : 0;

    document.getElementById("skipDiscussionCountText").innerText =
      count > 0 ? `${count} jogador(es) já querem votar` : "";
  });
}


// =========================
// CALL FOR VOTE (PULAR DISCUSSÃO)
// =========================

window.callForVote = async function()
{
  if(alreadyCalledForVote)
  {
    return;
  }

  alreadyCalledForVote = true;

  await set(
    ref(db, `rooms/${currentRoomCode}/currentState/skipDiscussionVotes/${currentPlayerId}`),
    true
  );

  document.getElementById("skipDiscussionButton").disabled = true;

  document.getElementById("skipDiscussionStatusText").innerText =
    "Você quer votar! Aguardando os outros jogadores...";

  console.log("Chamado para votação!");
};


// =========================
// LISTEN IMPOSTOR
// =========================

function ListenForImpostor()
{
  const impostorRef =
    ref(db, `rooms/${currentRoomCode}/currentState/impostorId`);

  onValue(impostorRef, (snapshot) =>
  {
    const impostorId = snapshot.val();

    isImpostor = (impostorId === currentPlayerId);

    UpdateRoleRevealScreen();
    UpdateRoleBanner();
  });
}


// =========================
// LISTEN WORD
// (a categoria não é lida aqui — é usada só internamente pelo Unity para
// escolher a pergunta certa do banco; nunca é mostrada para os jogadores)
// =========================

function ListenForWord()
{
  onValue(
    ref(db, `rooms/${currentRoomCode}/currentState/secretWord`),
    (snapshot) =>
    {
      currentSecretWord = snapshot.val() || "";

      UpdateRoleRevealScreen();
      UpdateRoleBanner();
    }
  );
}


// =========================
// ROLE REVEAL SCREEN
// =========================

function UpdateRoleRevealScreen()
{
  const roleText =
    document.getElementById("roleRevealText");

  if(!roleText) return;

  if(isImpostor)
  {
    roleText.innerHTML =
      `Você é o <span class="impostorLabel">IMPOSTOR</span>!<br><br>` +
      `Você não sabe a palavra secreta. Tente se misturar nas respostas!`;
  }
  else
  {
    roleText.innerHTML =
      `Sua palavra secreta é:<br>` +
      `<span class="secretWordLabel">${currentSecretWord}</span>`;
  }
}


// =========================
// ROLE REMINDER BANNER
// (pedido dos playtests: jogadores esquecem a palavra/papel no meio da
// rodada — esse aviso fica visível em toda tela de jogo, não só no
// RoleReveal)
// =========================

const ROLE_BANNER_STATES =
[
  "RoleReveal",
  "WriteQuestion",
  "Question",
  "RevealAnswers",
  "Discussion",
  "Voting",
  "VoteResult",
  "ImpostorGuess",
  "RoundScore"
];

function UpdateRoleBanner()
{
  const banner =
    document.getElementById("roleBanner");

  if(!banner) return;

  const shouldShow =
    ROLE_BANNER_STATES.includes(currentGameState);

  banner.classList.toggle("active", shouldShow);

  if(!shouldShow) return;

  if(isImpostor)
  {
    banner.innerText = "Você é o IMPOSTOR!";
    banner.classList.add("impostor");
  }
  else
  {
    banner.innerText = `Palavra secreta: ${currentSecretWord}`;
    banner.classList.remove("impostor");
  }
}


// =========================
// OPEN QUESTION
// =========================

async function OpenQuestion()
{
  alreadyAnswered = false;

  document.getElementById("answerInput").disabled = false;
  document.getElementById("answerInput").value = "";
  document.getElementById("sendAnswerButton").disabled = false;
  document.getElementById("questionWaitingText").innerText = "";

  const questionSnapshot =
    await get(ref(db, `rooms/${currentRoomCode}/currentState/question`));

  const question = questionSnapshot.val();

  if(question)
  {
    document.getElementById("questionText").innerText = question;
  }
}


// =========================
// SEND ANSWER
// =========================

window.sendAnswer = async function()
{
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

  await set(
    ref(
      db,
      `rooms/${currentRoomCode}/history/${await GetRoundKey()}/answers/${currentPlayerId}`
    ),
    {
      playerName: currentPlayerName,
      text: answerText
    }
  );

  console.log("Resposta enviada!");

  alreadyAnswered = true;

  document
    .getElementById("answerInput")
    .disabled = true;

  document
    .getElementById("sendAnswerButton")
    .disabled = true;

  document
    .getElementById("questionWaitingText")
    .innerText =
      "Esperando outros jogadores...";
};


// =========================
// OPEN VOTING
// =========================

let votingOptionsUnsubscribe = null;

function OpenVoting()
{
  alreadyVoted = false;

  document
    .getElementById("votingWaitingText")
    .innerText = "";

  const votingOptionsDiv =
    document.getElementById("votingOptions");

  votingOptionsDiv.innerHTML = "";

  // REMOVE O LISTENER DA RODADA ANTERIOR ANTES DE REGISTRAR UM NOVO.
  if(votingOptionsUnsubscribe)
  {
    votingOptionsUnsubscribe();
    votingOptionsUnsubscribe = null;
  }

  const votingRef =
    ref(
      db,
      `rooms/${currentRoomCode}/currentState/votingOptions`
    );

  votingOptionsUnsubscribe = onValue(votingRef, (snapshot) =>
  {
    votingOptionsDiv.innerHTML = "";

    if(!snapshot.exists())
    {
      return;
    }

    snapshot.forEach((child) =>
    {
      const data = child.val();

      const button =
        document.createElement("button");

      button.className = "voteButton";

      button.innerText = data.playerName;

      if(data.playerId === currentPlayerId)
      {
        button.disabled = true;
        button.classList.add("disabledSelf");
      }
      else
      {
        button.onclick =
          (event) => Vote(data.playerId, event);
      }

      votingOptionsDiv.appendChild(button);
    });
  });
}


// =========================
// VOTE
// =========================

async function Vote(votedPlayerId, event)
{
  if(alreadyVoted)
  {
    return;
  }

  alreadyVoted = true;

  document
    .querySelectorAll(".voteButton")
    .forEach(button =>
    {
      button.classList.remove("selected");
    });

  event.target.classList.add("selected");

  await set(
    ref(
      db,
      `rooms/${currentRoomCode}/history/${await GetRoundKey()}/votes/${currentPlayerId}`
    ),
    {
      votedPlayerId: votedPlayerId,
      playerName: currentPlayerName
    }
  );

  document
    .getElementById("votingWaitingText")
    .innerText =
      "Esperando outros votos...";

  console.log("Voto enviado!");
}


// =========================
// OPEN VOTE RESULT
// =========================

let voteOutcomeUnsubscribe = null;

function OpenVoteResult()
{
  // REMOVE O LISTENER DA RODADA ANTERIOR ANTES DE REGISTRAR UM NOVO.
  if(voteOutcomeUnsubscribe)
  {
    voteOutcomeUnsubscribe();
    voteOutcomeUnsubscribe = null;
  }

  const outcomeRef =
    ref(db, `rooms/${currentRoomCode}/currentState/voteOutcome`);

  voteOutcomeUnsubscribe = onValue(outcomeRef, (snapshot) =>
  {
    if(!snapshot.exists())
    {
      return;
    }

    const outcome = snapshot.val();

    const titleEl =
      document.getElementById("voteResultTitle");

    if(outcome.caught)
    {
      titleEl.innerText = "O IMPOSTOR FOI DESCOBERTO!";
      titleEl.className = "voteResultCaught";
    }
    else
    {
      titleEl.innerText = "O IMPOSTOR ESCAPOU!";
      titleEl.className = "voteResultEscaped";
    }
  });
}


// =========================
// OPEN IMPOSTOR GUESS
// =========================

function OpenImpostorGuess()
{
  alreadyGuessed = false;

  const guessContainer =
    document.getElementById("impostorGuessInputContainer");

  const waitingContainer =
    document.getElementById("impostorGuessWaitingContainer");

  if(isImpostor)
  {
    guessContainer.classList.add("active");
    waitingContainer.classList.remove("active");

    document.getElementById("impostorGuessInput").disabled = false;
    document.getElementById("impostorGuessInput").value = "";
    document.getElementById("sendGuessButton").disabled = false;
    document.getElementById("impostorGuessStatusText").innerText = "";
  }
  else
  {
    guessContainer.classList.remove("active");
    waitingContainer.classList.add("active");
  }
}


// =========================
// SEND IMPOSTOR GUESS
// =========================

window.sendImpostorGuess = async function()
{
  if(alreadyGuessed)
  {
    return;
  }

  const guessText =
    document
    .getElementById("impostorGuessInput")
    .value
    .trim();

  if(guessText.length <= 0)
  {
    return;
  }

  await set(
    ref(db, `rooms/${currentRoomCode}/currentState/impostorGuess/text`),
    guessText
  );

  alreadyGuessed = true;

  document.getElementById("impostorGuessInput").disabled = true;
  document.getElementById("sendGuessButton").disabled = true;

  document.getElementById("impostorGuessStatusText").innerText =
    "Palpite enviado! Aguardando resultado...";

  console.log("Palpite enviado!");
};


// =========================
// OPEN ROUND SCORE (placar parcial entre macro-rodadas)
// =========================

async function OpenRoundScore()
{
  const playersSnapshot =
    await get(ref(db, `rooms/${currentRoomCode}/players`));

  const scoreListDiv =
    document.getElementById("roundScoreList");

  scoreListDiv.innerHTML = "";

  if(!playersSnapshot.exists())
  {
    return;
  }

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

    scoreListDiv.appendChild(item);
  });
}


// =========================
// OPEN FINAL SCORE
// =========================

async function OpenFinalScore()
{
  const playersSnapshot =
    await get(ref(db, `rooms/${currentRoomCode}/players`));

  const scoreListDiv =
    document.getElementById("finalScoreList");

  scoreListDiv.innerHTML = "";

  let impostorName = "???";

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
      const item =
        document.createElement("div");

      item.className = "scoreItem";

      item.innerText =
        `${player.name} - ${player.score || 0}`;

      scoreListDiv.appendChild(item);
    });

    const impostorIdSnapshot =
      await get(ref(db, `rooms/${currentRoomCode}/currentState/impostorId`));

    const impostorPlayer =
      players.find(p => p.id === impostorIdSnapshot.val());

    if(impostorPlayer) impostorName = impostorPlayer.name;
  }

  const wordSnapshot =
    await get(ref(db, `rooms/${currentRoomCode}/currentState/secretWord`));

  const guessSnapshot =
    await get(ref(db, `rooms/${currentRoomCode}/currentState/impostorGuess`));

  let revealMsg =
    `O impostor era: ${impostorName}. A palavra secreta era: ${wordSnapshot.val() || "???"}.`;

  if(guessSnapshot.exists() && guessSnapshot.val().text)
  {
    revealMsg += guessSnapshot.val().correct
      ? " O impostor adivinhou a palavra!"
      : " O impostor não conseguiu adivinhar a palavra.";
  }

  document.getElementById("finalRevealText").innerText = revealMsg;
}