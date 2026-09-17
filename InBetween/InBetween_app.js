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
// (idêntica à do resto do party pack — não mexer, o Unity escreve no
// mesmo banco usando estes mesmos caminhos)
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

const isDevMode =
  params.get("dev") === "1";


// =========================
// GAME STATE
// =========================

let currentGameState = "Lobby";
let isHost = false;
let isImpostor = false;
let currentImpostorId = null;
let alreadyAnswered = false;
let alreadyVoted = false;
let alreadyGuessed = false;
let alreadyCalledForVote = false;
let alreadySubmittedQuestion = false;
let countdownInterval = null;
let currentSecretWord = "";
let isGamePaused = false;
let accuseArmed = false;
let accuseArmTimeout = null;
let myLastAnswerText = "";
let myLastVotedName = "";
let playersCache = {};

const QUESTION_TIME_SECONDS = 30;
const ACCUSE_ARM_TIMEOUT_MS = 4000;


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

function ShowBlock(blockId, siblingIds)
{
  siblingIds.forEach(id =>
  {
    document.getElementById(id).classList.remove("active");
  });

  document.getElementById(blockId).classList.add("active");
}


// =========================
// SMALL HELPERS
// =========================

function Monogram(name)
{
  const trimmed = (name || "").trim();

  return trimmed ? trimmed.charAt(0).toUpperCase() : "?";
}

function Buzz(ms)
{
  try
  {
    if(navigator.vibrate) navigator.vibrate(ms);
  }
  catch(error)
  {
    // aparelho sem suporte a vibração — silencioso.
  }
}

function Ordinal(n)
{
  return `${n}º`;
}

function SortedPlayers()
{
  return Object
    .entries(playersCache)
    .map(([id, data]) => ({ id, ...data }))
    .sort((a, b) => (b.score || 0) - (a.score || 0));
}


// =========================
// ENTER KEY SUBMIT (input de palpite — single line)
// =========================

function HandleEnterKey(event, callback)
{
  if(event.key !== "Enter") return;

  event.preventDefault();

  callback();
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
  WireStaticInputs();

  if(isDevMode)
  {
    InitDevMode();
    return;
  }

  ListenForGameState();
  ListenForVisibilityRecovery();
  ListenForImpostor();
  ListenForWord();
  ListenForPlayers();
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
// LISTEN FOR PLAYERS
// (lista viva pra montar o lobby e, junto com currentImpostorId, revelar o
// nome do impostor só depois de um CULPADO legítimo)
// =========================

function ListenForPlayers()
{
  onValue(
    ref(db, `rooms/${currentRoomCode}/players`),
    (snapshot) =>
    {
      playersCache = snapshot.exists() ? snapshot.val() : {};

      if(currentGameState === "Lobby")
      {
        RenderLobbyRoster();
      }
    }
  );
}

function RenderLobbyRoster()
{
  const list = document.getElementById("lobbyList");
  const count = document.getElementById("lobbyCount");
  const roomCodeLabel = document.getElementById("lobbyRoomCode");

  if(roomCodeLabel) roomCodeLabel.innerText = currentRoomCode || "";

  const players = SortedPlayers();

  if(count) count.innerText = String(players.length);

  if(!list) return;

  if(players.length === 0)
  {
    list.innerHTML = `<div class="lobbyEmpty">esperando jogadores entrarem_</div>`;
    return;
  }

  list.innerHTML = "";

  players.forEach(player =>
  {
    const isSelf = player.id === currentPlayerId;

    const card = document.createElement("div");
    card.className = "lobbyCard" + (isSelf ? " self" : "");

    card.innerHTML =
      `<div class="mono">${Monogram(player.name)}</div>` +
      `<div class="lobbyName">${player.name || "???"}</div>` +
      `<div class="lobbyTag">${isSelf ? "VOCÊ" : "PRONTO"}</div>`;

    list.appendChild(card);
  });
}


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
  if(isDevMode) return;

  Buzz(10);

  await set(
    ref(db, `rooms/${currentRoomCode}/hostCommand`),
    Date.now()
  );
};

window.SendTutorialAction = async function(action)
{
  if(isDevMode) return;

  Buzz(10);

  await set(
    ref(db, `rooms/${currentRoomCode}/tutorialAction`),
    { action: action, t: Date.now() }
  );
};

function UpdateHostButton(state)
{
  if(!isHost) return;

  const btn = document.getElementById("hostButton");

  // Só existe controle manual do host nos pontos de virada de fase
  // (começar, próxima rodada, jogar de novo). Não existe mais "pular
  // etapa" genérico — as demais etapas avançam sozinhas.
  const labels =
  {
    "Lobby":      "Começar Jogo",
    "RoundScore": "Próxima Rodada",
    "FinalScore": "Jogar de Novo",
  };

  const label = labels[state];

  if(!label)
  {
    btn.style.display = "none";
    return;
  }

  btn.style.display = "flex";
  btn.innerText = label;
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
  DisarmAccuse();

  UpdateHostButton(gameState);
  UpdateRoleBanner();

  if(gameState == "Lobby")
  {
    ShowScreen("lobbyScreen");
    RenderLobbyRoster();
  }

  if(gameState == "Tutorial")
  {
    ShowScreen("tutorialScreen");

    document
      .getElementById("tutorialControls")
      .style.display =
      isHost ? "flex" : "none";
  }

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
// Re-registrar o próprio onValue evita esse cenário.
//
// O mesmo vale pra impostorId e secretWord: se só o gameState for
// re-registrado, ele chega fresco (ex.: já em RoleReveal da rodada nova)
// enquanto isImpostor/currentSecretWord ficam presos na fila atrasada da
// rodada anterior — o que pode fazer o app mostrar a palavra secreta pra
// quem virou impostor. Por isso os três são re-registrados juntos, com
// impostor/palavra primeiro para já estarem atualizados quando o gameState
// disparar o render da tela.)
// =========================

function ListenForVisibilityRecovery()
{
  document.addEventListener("visibilitychange", () =>
  {
    if(document.visibilityState !== "visible")
    {
      return;
    }

    console.log("[In Between] Aba voltou ao foco — ressincronizando listeners de estado.");

    ListenForImpostor();
    ListenForWord();
    ListenForGameState();
  });
}


// =========================
// COUNTDOWN (contador + barra visíveis no client)
// =========================

function StartCountdown(seconds, textElId, fillElId)
{
  StopCountdown();

  let remaining = seconds;

  const textEl = document.getElementById(textElId);
  const fillEl = fillElId ? document.getElementById(fillElId) : null;

  if(fillEl)
  {
    fillEl.style.animation = "none";
    void fillEl.offsetWidth; // força o reflow antes de reiniciar a animação
    fillEl.style.animation = `shrink ${seconds}s linear both`;
  }

  function tick()
  {
    if(textEl) textEl.innerText = `${remaining}s`;

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
// WIRE STATIC INPUTS (contadores de caractere, enter-pra-enviar, etc. —
// registrado uma vez só no boot, funciona igual em qualquer estado)
// =========================

function WireStaticInputs()
{
  const questionInput = document.getElementById("writeQuestionInput");
  const questionCount = document.getElementById("writeQuestionCount");

  questionInput.addEventListener("input", () =>
  {
    questionCount.innerText = `${questionInput.value.length}/120`;
  });

  const answerInput = document.getElementById("answerInput");
  const answerCount = document.getElementById("answerCount");

  answerInput.addEventListener("input", () =>
  {
    answerCount.innerText = `${answerInput.value.length}/120`;
  });

  const guessInput = document.getElementById("impostorGuessInput");
  const guessDisplay = document.getElementById("impostorGuessDisplay");

  guessInput.addEventListener("input", () =>
  {
    guessInput.value = guessInput.value.toUpperCase();
    guessDisplay.innerText = guessInput.value;
  });

  guessInput.addEventListener("keydown", (event) =>
  {
    HandleEnterKey(event, sendImpostorGuess);
  });

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

  ShowBlock(
    isQuestioner ? "writeQuestionInputContainer" : "writeQuestionWaitingContainer",
    ["writeQuestionInputContainer", "writeQuestionWaitingContainer"]
  );

  if(isQuestioner)
  {
    // GUARDA DE SEGURANÇA: o Realtime Database não consegue esconder
    // currentState/secretWord por jogador — quem filtra é o client. Se o
    // sorteio de quem pergunta algum dia incluir o impostor, ele NUNCA pode
    // ver a palavra aqui.
    document.getElementById("writeQuestionWordText").innerText =
      isImpostor ? "" : `Palavra: ${currentSecretWord}`;

    const input = document.getElementById("writeQuestionInput");
    input.disabled = false;
    input.value = "";

    document.getElementById("writeQuestionCount").innerText = "0/120";
    document.getElementById("sendQuestionButton").disabled = false;
    document.getElementById("writeQuestionStatusText").innerText = "";

    StartCountdown(
      QUESTION_TIME_SECONDS,
      "writeQuestionCountdown",
      "writeQuestionTimerFill"
    );
  }
  else
  {
    // NÃO REVELA QUEM É O QUESTIONER — só ele mesmo sabe que foi sorteado.
    StartCountdown(
      QUESTION_TIME_SECONDS,
      "writeQuestionWaitingCountdown",
      "writeQuestionWaitingTimerFill"
    );
  }
}


// =========================
// SEND CUSTOM QUESTION
// =========================

window.sendCustomQuestion = async function()
{
  if(isDevMode || isGamePaused) return;

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

  Buzz(10);

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
  DisarmAccuse();

  // RE-HABILITA O BOTÃO — se a acusação da rodada anterior não deu maioria,
  // o jogo volta pra uma nova Discussion (próxima pergunta) e o botão
  // precisa poder ser usado de novo. DisarmAccuse() não mexe em `disabled`
  // de propósito (pra não reabilitar no meio da própria votação em curso),
  // então isso tem que ser feito aqui, na entrada do estado.
  const skipBtn = document.getElementById("skipDiscussionButton");
  skipBtn.disabled = false;
  skipBtn.classList.remove("armed");
  skipBtn.innerText = "ACUSAR AGORA";

  document.getElementById("discussionMeta").innerText = "";
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
// ACUSAR AGORA (dois toques pra confirmar — o primeiro só arma o botão)
// =========================

function DisarmAccuse()
{
  accuseArmed = false;

  if(accuseArmTimeout)
  {
    clearTimeout(accuseArmTimeout);
    accuseArmTimeout = null;
  }

  const btn = document.getElementById("skipDiscussionButton");

  if(btn && !btn.disabled)
  {
    btn.classList.remove("armed");
    btn.innerText = "ACUSAR AGORA";
  }
}

window.callForVote = async function()
{
  if(isDevMode || isGamePaused) return;

  if(alreadyCalledForVote)
  {
    return;
  }

  const btn = document.getElementById("skipDiscussionButton");

  if(!accuseArmed)
  {
    accuseArmed = true;
    Buzz(10);

    btn.classList.add("armed");
    btn.innerText = "TOQUE PRA CONFIRMAR";

    accuseArmTimeout = setTimeout(DisarmAccuse, ACCUSE_ARM_TIMEOUT_MS);

    return;
  }

  DisarmAccuse();

  alreadyCalledForVote = true;
  Buzz([10, 40, 10]);

  await set(
    ref(db, `rooms/${currentRoomCode}/currentState/skipDiscussionVotes/${currentPlayerId}`),
    true
  );

  btn.disabled = true;
  btn.innerText = "ACUSAR AGORA";

  document.getElementById("skipDiscussionStatusText").innerText =
    "isso convoca a votação de todo mundo. aguardando os outros...";

  console.log("Chamado para votação!");
};


// =========================
// LISTEN IMPOSTOR
// (re-registrado do zero em ListenForVisibilityRecovery — mesmo motivo do
// gameState: um onValue parado em segundo plano pode entregar isImpostor
// atrasado depois que o gameState já virou RoleReveal, mostrando a palavra
// pra quem virou impostor na rodada nova.)
// =========================

let impostorUnsubscribe = null;

function ListenForImpostor()
{
  if(impostorUnsubscribe)
  {
    impostorUnsubscribe();
    impostorUnsubscribe = null;
  }

  const impostorRef =
    ref(db, `rooms/${currentRoomCode}/currentState/impostorId`);

  impostorUnsubscribe = onValue(impostorRef, (snapshot) =>
  {
    currentImpostorId = snapshot.val();

    isImpostor = (currentImpostorId === currentPlayerId);

    UpdateRoleRevealScreen();
    UpdateRoleBanner();
  });
}


// =========================
// LISTEN WORD
// (a categoria não é lida aqui — é usada só internamente pelo Unity para
// escolher a pergunta certa do banco; nunca é mostrada para os jogadores)
// re-registrado do zero em ListenForVisibilityRecovery — ver comentário
// em ListenForImpostor.
// =========================

let wordUnsubscribe = null;

function ListenForWord()
{
  if(wordUnsubscribe)
  {
    wordUnsubscribe();
    wordUnsubscribe = null;
  }

  wordUnsubscribe = onValue(
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
// (a palavra fica sempre exposta — sem blur, sem toque pra esconder)
// =========================

function UpdateRoleRevealScreen()
{
  const wordContainer = document.getElementById("roleWordContainer");

  if(!wordContainer) return;

  ShowBlock(
    isImpostor ? "roleImpostorContainer" : "roleWordContainer",
    ["roleWordContainer", "roleImpostorContainer"]
  );

  document.getElementById("roleWordDisplay").innerText = currentSecretWord;

  document.getElementById("roleTopLabel").innerText = currentPlayerName
    ? currentPlayerName.toUpperCase()
    : "RODADA";

  document.getElementById("roleNoticeTitle").innerText =
    isImpostor ? "FINJA QUE SABE · DESCUBRA A PALAVRA" : "NÃO MOSTRE A NINGUÉM";

  document.getElementById("roleNoticeSub").innerText =
    isImpostor ? "se te acusarem, você tem uma última chance" : "cuidado pra ninguém mais ver a tela";
}


// =========================
// ROLE REMINDER BANNER
// (pedido dos playtests: jogadores esquecem a palavra/papel no meio da
// rodada — esse aviso fica visível em toda tela de jogo, não só no
// RoleReveal. Sempre exposto, sem mascarar.)
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
  const banner = document.getElementById("roleBanner");
  const text = document.getElementById("roleBannerText");

  if(!banner) return;

  const shouldShow =
    ROLE_BANNER_STATES.includes(currentGameState);

  banner.classList.toggle("active", shouldShow);

  if(!shouldShow) return;

  if(isImpostor)
  {
    text.innerText = "VOCÊ É O IMPOSTOR";
    banner.classList.add("impostor");
  }
  else
  {
    text.innerText = `PALAVRA: ${currentSecretWord}`;
    banner.classList.remove("impostor");
  }
}


// =========================
// OPEN QUESTION
// =========================

async function OpenQuestion()
{
  alreadyAnswered = false;
  myLastAnswerText = "";

  ShowBlock("questionAnswerContainer", ["questionAnswerContainer", "questionSentContainer"]);

  const answerInput = document.getElementById("answerInput");
  answerInput.disabled = false;
  answerInput.value = "";

  document.getElementById("answerCount").innerText = "0/120";
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

let answerCountUnsubscribe = null;

window.sendAnswer = async function()
{
  if(isDevMode || isGamePaused) return;

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

  myLastAnswerText = answerText;

  const roundKey = await GetRoundKey();

  await set(
    ref(
      db,
      `rooms/${currentRoomCode}/history/${roundKey}/answers/${currentPlayerId}`
    ),
    {
      playerName: currentPlayerName,
      text: answerText
    }
  );

  console.log("Resposta enviada!");

  alreadyAnswered = true;
  Buzz(10);

  ShowBlock("questionSentContainer", ["questionAnswerContainer", "questionSentContainer"]);

  document.getElementById("questionSentEcho").innerText = myLastAnswerText;
  document.getElementById("questionWaitingText").innerText =
    "esperando outros jogadores...";

  // CONTADOR DE QUEM JÁ RESPONDEU — leitura adicional, não escreve nada
  // novo; só acompanha o mesmo nó de histórico que o Firebase já guarda.
  if(answerCountUnsubscribe)
  {
    answerCountUnsubscribe();
    answerCountUnsubscribe = null;
  }

  const totalPlayers = Object.keys(playersCache).length || 0;

  answerCountUnsubscribe = onValue(
    ref(db, `rooms/${currentRoomCode}/history/${roundKey}/answers`),
    (snapshot) =>
    {
      const sent = snapshot.exists() ? Object.keys(snapshot.val()).length : 0;

      document.getElementById("questionSentCount").innerText =
        totalPlayers > 0 ? `${sent}/${totalPlayers}` : `${sent}`;
    }
  );
};


// =========================
// OPEN VOTING
// =========================

let votingOptionsUnsubscribe = null;

function OpenVoting()
{
  alreadyVoted = false;
  myLastVotedName = "";

  ShowBlock("votingActiveContainer", ["votingActiveContainer", "votingVotedContainer"]);

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
      const isSelf = data.playerId === currentPlayerId;

      const card = document.createElement("div");
      card.className = "voteCard" + (isSelf ? " self" : "");

      card.innerHTML =
        `<div class="voteCard__row">` +
          `<div class="mono">${Monogram(data.playerName)}</div>` +
          `<div class="voteCard__name">${data.playerName}</div>` +
        `</div>` +
        `<div class="voteCard__tag">${isSelf ? "você" : "suspeito"}</div>`;

      if(!isSelf)
      {
        card.addEventListener("click", () => Vote(data.playerId, data.playerName, card));
      }

      votingOptionsDiv.appendChild(card);
    });
  });
}


// =========================
// VOTE
// =========================

async function Vote(votedPlayerId, votedPlayerName, cardEl)
{
  if(isDevMode || isGamePaused) return;

  if(alreadyVoted)
  {
    return;
  }

  alreadyVoted = true;
  myLastVotedName = votedPlayerName || "???";

  Buzz(10);

  document
    .querySelectorAll(".voteCard")
    .forEach(card => card.classList.remove("selected"));

  if(cardEl) cardEl.classList.add("selected");

  const roundKey = await GetRoundKey();

  await set(
    ref(
      db,
      `rooms/${currentRoomCode}/history/${roundKey}/votes/${currentPlayerId}`
    ),
    {
      votedPlayerId: votedPlayerId,
      playerName: currentPlayerName
    }
  );

  console.log("Voto enviado!");

  document.getElementById("votedNameText").innerText = myLastVotedName;

  ShowBlock("votingVotedContainer", ["votingActiveContainer", "votingVotedContainer"]);
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

    const stamp = document.getElementById("voteResultStamp");
    const stampText = document.getElementById("voteResultStampText");
    const title = document.getElementById("voteResultTitle");
    const body = document.getElementById("voteResultBody");
    const topLabel = document.getElementById("voteResultTopLabel");

    document.body.classList.remove("tone-red", "tone-blue");

    if(outcome.caught)
    {
      const impostorName =
        (playersCache[currentImpostorId] && playersCache[currentImpostorId].name) || "o impostor";

      document.body.classList.add("tone-red");

      stamp.className = "stamp";
      stampText.innerText = "CULPADO";
      title.innerHTML = "A MESA<br>ACERTOU";
      body.innerHTML =
        `${impostorName} era o impostor.<br>ele tem uma última chance de virar o jogo.`;
      topLabel.className = "label label--red";
      topLabel.innerText = "VEREDITO";
    }
    else
    {
      document.body.classList.add("tone-blue");

      stamp.className = "stamp stamp--blue";
      stampText.innerText = "INOCENTE";
      title.innerHTML = "A MESA<br>ERROU";
      body.innerHTML =
        "a pessoa apontada sabia a palavra.<br>o impostor segue à solta.";
      topLabel.className = "label label--blue";
      topLabel.innerText = "VEREDITO";
    }
  });
}


// =========================
// OPEN IMPOSTOR GUESS
// =========================

let impostorGuessUnsubscribe = null;

function OpenImpostorGuess()
{
  alreadyGuessed = false;

  document.body.classList.remove("tone-red", "tone-blue");

  ShowBlock(
    isImpostor ? "impostorGuessInputContainer" : "impostorGuessWaitingContainer",
    ["impostorGuessInputContainer", "impostorGuessWaitingContainer", "impostorGuessResultContainer"]
  );

  if(isImpostor)
  {
    const input = document.getElementById("impostorGuessInput");
    input.disabled = false;
    input.value = "";

    document.getElementById("impostorGuessDisplay").innerText = "";
    document.getElementById("sendGuessButton").disabled = false;
    document.getElementById("impostorGuessStatusText").innerText = "";
  }

  // ACOMPANHA O RESULTADO DO PALPITE — leitura do mesmo nó que o Unity já
  // usa pra registrar o palpite e a correção (ver OpenFinalScore).
  if(impostorGuessUnsubscribe)
  {
    impostorGuessUnsubscribe();
    impostorGuessUnsubscribe = null;
  }

  const guessRef =
    ref(db, `rooms/${currentRoomCode}/currentState/impostorGuess`);

  impostorGuessUnsubscribe = onValue(guessRef, (snapshot) =>
  {
    if(!snapshot.exists()) return;

    const data = snapshot.val();

    if(typeof data.correct !== "boolean") return;

    RenderImpostorGuessResult(data.text || "", data.correct);
  });
}


// =========================
// SEND IMPOSTOR GUESS
// =========================

window.sendImpostorGuess = async function()
{
  if(isDevMode || isGamePaused) return;

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
  Buzz(10);

  document.getElementById("impostorGuessInput").disabled = true;
  document.getElementById("sendGuessButton").disabled = true;

  document.getElementById("impostorGuessStatusText").innerText =
    "palpite enviado! aguardando resultado...";

  console.log("Palpite enviado!");
};


// =========================
// RESULTADO DO PALPITE (ERROU / ACERTOU — telas 14/15 do mockup)
// Ambos os lados (impostor e mesa) veem essa revelação; o texto muda de
// acordo com quem está lendo.
// =========================

function RenderImpostorGuessResult(guessText, correct)
{
  document.body.classList.add(correct ? "tone-blue" : "tone-red");

  ShowBlock(
    "impostorGuessResultContainer",
    ["impostorGuessInputContainer", "impostorGuessWaitingContainer", "impostorGuessResultContainer"]
  );

  document.getElementById("impostorGuessResultTag").innerText = correct ? "CERTO" : "ERRADO";
  document.getElementById("impostorGuessResultTag").style.color = correct ? "var(--blue)" : "var(--red)";

  document.getElementById("impostorGuessResultWord").innerText = guessText.toUpperCase();
  document.getElementById("impostorGuessResultAnswer").innerText = currentSecretWord;

  document.getElementById("impostorGuessResultBar").style.display = correct ? "none" : "block";
  document.getElementById("impostorGuessResultDivider").style.display = correct ? "flex" : "none";

  const headline = document.getElementById("impostorGuessResultHeadline");
  const body = document.getElementById("impostorGuessResultBody");

  if(correct)
  {
    headline.innerHTML = isImpostor ? "VOCÊ VIROU<br>O JOGO" : "O IMPOSTOR<br>VIROU O JOGO";
    body.innerText = isImpostor
      ? "a mesa te pegou e ainda assim você leva a partida sozinho."
      : "ele acertou a palavra secreta e leva a partida sozinho.";
  }
  else
  {
    headline.innerHTML = isImpostor ? "VOCÊ FICOU<br>POR FORA" : "A MESA<br>VENCE";
    body.innerText = isImpostor
      ? "você não soube a palavra até o fim. a mesa vence."
      : "o impostor não soube a palavra. vocês vencem.";
  }
}


// =========================
// OPEN ROUND SCORE (placar parcial entre macro-rodadas)
// =========================

function RenderScoreList(containerId)
{
  const listDiv = document.getElementById(containerId);

  listDiv.innerHTML = "";

  const players = SortedPlayers();

  players.forEach((player, index) =>
  {
    const isSelf = player.id === currentPlayerId;

    const row = document.createElement("div");
    row.className = "scoreRow" + (isSelf ? " self" : "");

    row.innerHTML =
      `<div class="scoreRow__rank">${Ordinal(index + 1)}</div>` +
      `<div class="mono">${Monogram(player.name)}</div>` +
      `<div class="scoreRow__name">${player.name || "???"}</div>` +
      `<div class="scoreRow__pts">${player.score || 0}</div>`;

    listDiv.appendChild(row);
  });

  return players;
}

async function OpenRoundScore()
{
  RenderScoreList("roundScoreList");
}


// =========================
// OPEN FINAL SCORE
// Sem um estado de Firebase dedicado a "impostor escapou", a gente deduz a
// situação a partir do que já existe: se currentState/impostorGuess nunca
// chegou a ter um "text", é porque a última chance nunca foi acionada —
// ou seja, ninguém acusou certo nas 3 rodadas.
// =========================

async function OpenFinalScore()
{
  const guessSnapshot =
    await get(ref(db, `rooms/${currentRoomCode}/currentState/impostorGuess`));

  const guessData = guessSnapshot.exists() ? guessSnapshot.val() : null;
  const wasCaught = !!(guessData && guessData.text);

  if(wasCaught)
  {
    ShowBlock("finalScoreBoardContainer", ["finalScoreEscapedContainer", "finalScoreBoardContainer"]);
    RenderFinalBoard(guessData);
  }
  else
  {
    RenderEscapedScreen();
    ShowBlock("finalScoreEscapedContainer", ["finalScoreEscapedContainer", "finalScoreBoardContainer"]);

    document
      .getElementById("finalScoreEscapedContainer")
      .addEventListener("click", () =>
      {
        ShowBlock("finalScoreBoardContainer", ["finalScoreEscapedContainer", "finalScoreBoardContainer"]);
        RenderFinalBoard(null);
      }, { once:true });
  }
}

function RenderEscapedScreen()
{
  document.getElementById("finalScoreEscapedTitle").innerHTML =
    isImpostor ? "VOCÊ<br>ESCAPOU" : "ELE<br>ESCAPOU";

  document.getElementById("finalScoreEscapedBody").innerText = isImpostor
    ? "ninguém te apontou. a mesa nunca vai ter certeza."
    : "as três rodadas acabaram sem acusação certa. vocês nunca vão saber quem era.";

  document.getElementById("finalScoreEscapedWord").innerText = currentSecretWord || "???";
}

function RenderFinalBoard(guessData)
{
  const players = RenderScoreList("finalScoreList");

  const impostorName =
    (playersCache[currentImpostorId] && playersCache[currentImpostorId].name) || "???";

  let revealMsg =
    `o impostor era ${impostorName}. a palavra secreta era ${currentSecretWord || "???"}.`;

  if(guessData && typeof guessData.correct === "boolean")
  {
    revealMsg += guessData.correct
      ? " o impostor virou o jogo!"
      : " o impostor não conseguiu adivinhar a palavra.";
  }
  else
  {
    revealMsg = `a palavra secreta era ${currentSecretWord || "???"}. a identidade do impostor não é revelada.`;
  }

  document.getElementById("finalRevealText").innerText = revealMsg;
}


// =========================
// GLOBAL EXPORTS (usados por onclick= no HTML)
// =========================

window.HandleEnterKey = HandleEnterKey;


// =========================
// MODO DE REVISÃO VISUAL (?dev=1)
// Só ativa telas com dados fictícios pra revisão de design — nunca lê nem
// escreve no Firebase. Fica isolado do fluxo real do jogo (todo write acima
// já tem um `if(isDevMode) return;` de guarda).
// =========================

const DEV_PLAYERS =
{
  p1: { name: "MADAME VERA", score: 9 },
  p2: { name: "O DUQUE", score: 4 },
  p3: { name: "GATO PRETO", score: 0 },
  p4: { name: currentPlayerName || "ALMA", score: 7 },
  p5: { name: "BIDU", score: 5 },
  p6: { name: "DOUTOR LEAL", score: 2 },
};

const DEV_STATES =
[
  { key: "Lobby",             label: "01 ESPERANDO" },
  { key: "RoleReveal:word",   label: "02 PALAVRA" },
  { key: "RoleReveal:imp",    label: "03 IMPOSTOR" },
  { key: "WriteQuestion:me",  label: "04 PERGUNTA" },
  { key: "WriteQuestion:wait",label: "05 AGUARDE" },
  { key: "Question:me",       label: "06 RESPONDA" },
  { key: "Question:sent",     label: "07 ENVIADA" },
  { key: "RevealAnswers",     label: "08 NA TV" },
  { key: "Discussion",        label: "09 ACUSAR" },
  { key: "Voting:active",     label: "10 VOTE" },
  { key: "Voting:voted",      label: "11 VOTO OK" },
  { key: "VoteResult:caught", label: "12 CULPADO" },
  { key: "VoteResult:clear",  label: "13 INOCENTE" },
  { key: "ImpostorGuess:me",  label: "14 CHUTE" },
  { key: "GuessResult:wrong", label: "15 ERROU" },
  { key: "GuessResult:right", label: "16 ACERTOU" },
  { key: "FinalScore:escapeI",label: "17 ESCAPOU·EU" },
  { key: "FinalScore:escapeM",label: "18 ESCAPOU·MESA" },
  { key: "FinalScore:board",  label: "19 PLACAR" },
];

function InitDevMode()
{
  playersCache = DEV_PLAYERS;
  currentImpostorId = "p3";
  currentSecretWord = "ESCADA";

  const strip = document.getElementById("devStrip");
  strip.classList.add("active");

  DEV_STATES.forEach(entry =>
  {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.innerText = entry.label;

    btn.addEventListener("click", () =>
    {
      strip.querySelectorAll("button").forEach(b => b.classList.remove("on"));
      btn.classList.add("on");
      DevShow(entry.key);
    });

    strip.appendChild(btn);
  });

  strip.querySelector("button").click();
}

function DevShow(key)
{
  const [state, variant] = key.split(":");

  document.body.classList.remove("tone-red", "tone-blue");

  if(state === "Lobby")
  {
    ShowScreen("lobbyScreen");
    RenderLobbyRoster();
  }

  if(state === "RoleReveal")
  {
    isImpostor = variant === "imp";
    ShowScreen("roleRevealScreen");
    UpdateRoleRevealScreen();
  }

  if(state === "WriteQuestion")
  {
    ShowScreen("writeQuestionScreen");
    ShowBlock(
      variant === "me" ? "writeQuestionInputContainer" : "writeQuestionWaitingContainer",
      ["writeQuestionInputContainer", "writeQuestionWaitingContainer"]
    );
    document.getElementById("writeQuestionWordText").innerText = `Palavra: ${currentSecretWord}`;
    StartCountdown(30, variant === "me" ? "writeQuestionCountdown" : "writeQuestionWaitingCountdown",
      variant === "me" ? "writeQuestionTimerFill" : "writeQuestionWaitingTimerFill");
  }

  if(state === "Question")
  {
    ShowScreen("questionScreen");
    document.getElementById("questionText").innerText = "você confiaria nisso com o olho fechado?";

    if(variant === "me")
    {
      ShowBlock("questionAnswerContainer", ["questionAnswerContainer", "questionSentContainer"]);
    }
    else
    {
      ShowBlock("questionSentContainer", ["questionAnswerContainer", "questionSentContainer"]);
      document.getElementById("questionSentEcho").innerText = "de dia sim, de noite nunca";
      document.getElementById("questionSentCount").innerText = "5/6";
      document.getElementById("questionWaitingText").innerText = "falta 1 jogador";
    }
  }

  if(state === "RevealAnswers")
  {
    ShowScreen("revealAnswersScreen");
  }

  if(state === "Discussion")
  {
    ShowScreen("discussionScreen");
  }

  if(state === "Voting")
  {
    isImpostor = false;
    ShowScreen("votingScreen");

    if(variant === "active")
    {
      ShowBlock("votingActiveContainer", ["votingActiveContainer", "votingVotedContainer"]);
      const optionsDiv = document.getElementById("votingOptions");
      optionsDiv.innerHTML = "";
      Object.entries(DEV_PLAYERS).forEach(([id, data]) =>
      {
        const isSelf = id === "p4";
        const card = document.createElement("div");
        card.className = "voteCard" + (isSelf ? " self" : "");
        card.innerHTML =
          `<div class="voteCard__row"><div class="mono">${Monogram(data.name)}</div>` +
          `<div class="voteCard__name">${data.name}</div></div>` +
          `<div class="voteCard__tag">${isSelf ? "você" : "suspeito"}</div>`;
        optionsDiv.appendChild(card);
      });
    }
    else
    {
      ShowBlock("votingVotedContainer", ["votingActiveContainer", "votingVotedContainer"]);
      document.getElementById("votedNameText").innerText = "GATO PRETO";
    }
  }

  if(state === "VoteResult")
  {
    ShowScreen("voteResultScreen");
    const outcome = { caught: variant === "caught" };
    OpenVoteResultDevPreview(outcome);
  }

  if(state === "ImpostorGuess")
  {
    isImpostor = true;
    ShowScreen("impostorGuessScreen");
    ShowBlock("impostorGuessInputContainer",
      ["impostorGuessInputContainer", "impostorGuessWaitingContainer", "impostorGuessResultContainer"]);
  }

  if(state === "GuessResult")
  {
    isImpostor = true;
    ShowScreen("impostorGuessScreen");
    RenderImpostorGuessResult("ELEVADOR", variant === "right");
  }

  if(state === "FinalScore")
  {
    ShowScreen("finalScoreScreen");

    if(variant === "board")
    {
      ShowBlock("finalScoreBoardContainer", ["finalScoreEscapedContainer", "finalScoreBoardContainer"]);
      RenderFinalBoard({ text:"ELEVADOR", correct:false });
    }
    else
    {
      isImpostor = variant === "escapeI";
      RenderEscapedScreen();
      ShowBlock("finalScoreEscapedContainer", ["finalScoreEscapedContainer", "finalScoreBoardContainer"]);
    }
  }
}

function OpenVoteResultDevPreview(outcome)
{
  const stamp = document.getElementById("voteResultStamp");
  const stampText = document.getElementById("voteResultStampText");
  const title = document.getElementById("voteResultTitle");
  const body = document.getElementById("voteResultBody");
  const topLabel = document.getElementById("voteResultTopLabel");

  if(outcome.caught)
  {
    document.body.classList.add("tone-red");
    stamp.className = "stamp";
    stampText.innerText = "CULPADO";
    title.innerHTML = "A MESA<br>ACERTOU";
    body.innerHTML = "GATO PRETO era o impostor.<br>ele tem uma última chance de virar o jogo.";
    topLabel.className = "label label--red";
  }
  else
  {
    document.body.classList.add("tone-blue");
    stamp.className = "stamp stamp--blue";
    stampText.innerText = "INOCENTE";
    title.innerHTML = "A MESA<br>ERROU";
    body.innerHTML = "a pessoa apontada sabia a palavra.<br>o impostor segue à solta.";
    topLabel.className = "label label--blue";
  }
}
