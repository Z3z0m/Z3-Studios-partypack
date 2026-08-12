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
let currentRound = 0;
let currentTopic = "";
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
// START
// =========================

window.onload = function()
{
  ListenForGameState();
  ListenForVisibilityRecovery();
  CheckIfHost();
  ListenForPause();

  document
    .getElementById("speechInput")
    .addEventListener("keydown", (event) =>
    {
      if(event.key !== "Enter") return;

      event.preventDefault();

      window.SendSpeechAnswer();
    });
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
    "Bidding":    "Pular Vez (emergência)",
    "Speech":     "Pular Digitação",
    "Reveal":     "Pular Votação",
    "Result":     "Pular Resultado",
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
// — mesmo padrão do Stop_app.js/InBetween_app.js)
// =========================

function ListenForVisibilityRecovery()
{
  document.addEventListener("visibilitychange", () =>
  {
    if(document.visibilityState !== "visible") return;

    console.log("[Aposta] Aba voltou ao foco — ressincronizando listener de estado.");

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

  if(gameState == "Bidding")
  {
    ShowScreen("biddingScreen");
    OpenBidding();
  }

  if(gameState == "Speech")
  {
    ShowScreen("speechScreen");
    OpenSpeech();
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
// OPEN BIDDING (sorteio de tópico + lances em turno — fica escutando
// "currentState/bidding" o tempo todo, porque VÁRIOS lances passam sob o
// mesmo gameState "Bidding"; mesmo padrão de sub-etapas do OpenReveal do Stop)
// =========================

let biddingUnsubscribe = null;
let lastMinNextBid = 1;

async function OpenBidding()
{
  if(biddingUnsubscribe)
  {
    biddingUnsubscribe();
    biddingUnsubscribe = null;
  }

  const [topicSnapshot, themeSnapshot, roundSnapshot] =
    await Promise.all(
    [
      get(ref(db, `rooms/${currentRoomCode}/currentState/topic`)),
      get(ref(db, `rooms/${currentRoomCode}/currentState/themeName`)),
      get(ref(db, `rooms/${currentRoomCode}/currentState/round`))
    ]);

  currentTopic = topicSnapshot.val() || "?";
  currentRound = roundSnapshot.val() || 0;

  document.getElementById("biddingThemeBanner").innerText =
    `${themeSnapshot.val() || ""} — Rodada ${currentRound}`;

  document.getElementById("biddingTopicText").innerText = currentTopic;

  const biddingRef =
    ref(db, `rooms/${currentRoomCode}/currentState/bidding`);

  biddingUnsubscribe = onValue(biddingRef, (snapshot) =>
  {
    if(!snapshot.exists()) return;

    ApplyBiddingState(snapshot.val());
  });
}

function ApplyBiddingState(data)
{
  const hasBidder = !!data.currentBidderId;
  const isMyTurn = data.turnPlayerId === currentPlayerId;

  lastMinNextBid = data.minNextBid || 1;

  document.getElementById("bidStatusText").innerText =
    hasBidder
      ? `Lance atual: ${data.currentBid} (${data.currentBidderName})`
      : "Ninguém apostou ainda.";

  document.getElementById("bidTurnControls").style.display =
    isMyTurn ? "flex" : "none";

  document.getElementById("bidWaitingText").style.display =
    isMyTurn ? "none" : "block";

  if(isMyTurn)
  {
    const input = document.getElementById("bidAmountInput");
    input.min = lastMinNextBid;
    input.value = lastMinNextBid;
    input.placeholder = `mín. ${lastMinNextBid}`;

    const challengeButton = document.getElementById("challengeButton");
    challengeButton.style.display = hasBidder ? "block" : "none";
  }
  else
  {
    document.getElementById("bidWaitingText").innerText =
      `Aguarde a vez de ${data.turnPlayerName}`;
  }
}

window.SendBidAction = async function(action)
{
  if(isGamePaused) return;

  let amount = 0;

  if(action === "raise")
  {
    amount = Number(document.getElementById("bidAmountInput").value);

    if(!Number.isFinite(amount) || amount < lastMinNextBid)
    {
      return;
    }
  }

  await set(
    ref(db, `rooms/${currentRoomCode}/bidAction`),
    {
      playerId: currentPlayerId,
      action: action,
      amount: amount,
      t: Date.now()
    }
  );
};


// =========================
// OPEN SPEECH (digitar as respostas dentro do tempo — só quem apostou
// digita; os outros só acompanham)
// =========================

let speechAnswersUnsubscribe = null;
let localTypedAnswers = [];
let speechIsBidder = false;

async function OpenSpeech()
{
  if(speechAnswersUnsubscribe)
  {
    speechAnswersUnsubscribe();
    speechAnswersUnsubscribe = null;
  }

  const [speechSnapshot, roundSnapshot] =
    await Promise.all(
    [
      get(ref(db, `rooms/${currentRoomCode}/currentState/speech`)),
      get(ref(db, `rooms/${currentRoomCode}/currentState/round`))
    ]);

  const data = speechSnapshot.val() || {};
  currentRound = roundSnapshot.val() || 0;

  speechIsBidder = data.bidderId === currentPlayerId;
  localTypedAnswers = [];

  document.getElementById("speechTopicText").innerText = currentTopic;

  document.getElementById("speechOwnControls").style.display =
    speechIsBidder ? "flex" : "none";

  document.getElementById("speechWaitingText").style.display =
    speechIsBidder ? "none" : "block";

  if(speechIsBidder)
  {
    document.getElementById("speechGoalText").innerText =
      `Você precisa de ${data.bidAmount} resposta(s) diferentes sobre "${currentTopic}"`;

    const input = document.getElementById("speechInput");
    input.value = "";
    input.disabled = false;
    input.focus();

    document.getElementById("speechDoneButton").disabled = false;

    RenderSpeechAnswersList();
  }
  else
  {
    document.getElementById("speechWaitingText").innerText =
      `${data.bidderName} está tentando dar ${data.bidAmount} resposta(s)...`;

    const answersRef =
      ref(db, `rooms/${currentRoomCode}/history/round_${currentRound}/speechAnswers`);

    speechAnswersUnsubscribe = onValue(answersRef, (snapshot) =>
    {
      const count = snapshot.exists() ? snapshot.size : 0;

      document.getElementById("speechWaitingText").innerText =
        `${data.bidderName} já digitou ${count} resposta(s)...`;
    });
  }

  if(data.duration)
  {
    StartCountdown(data.duration, "speechCountdown");
  }
}

function RenderSpeechAnswersList()
{
  const container = document.getElementById("speechAnswersList");
  container.innerHTML = "";

  localTypedAnswers.forEach((answer) =>
  {
    const row = document.createElement("div");
    row.className = "speechAnswerRow";
    row.innerText = answer;
    container.appendChild(row);
  });
}

window.SendSpeechAnswer = async function()
{
  if(isGamePaused || !speechIsBidder) return;

  const input = document.getElementById("speechInput");
  const value = input.value.trim();

  if(value.length === 0) return;

  const index = localTypedAnswers.length;

  await set(
    ref(db, `rooms/${currentRoomCode}/history/round_${currentRound}/speechAnswers/${index}`),
    value
  );

  localTypedAnswers.push(value);
  RenderSpeechAnswersList();

  input.value = "";
  input.focus();
};

window.callSpeechDone = async function()
{
  if(isGamePaused || !speechIsBidder) return;

  document.getElementById("speechDoneButton").disabled = true;
  document.getElementById("speechInput").disabled = true;

  await set(
    ref(db, `rooms/${currentRoomCode}/currentState/speech/doneSignal`),
    { playerId: currentPlayerId, t: Date.now() }
  );
};


// =========================
// OPEN REVEAL (votação sobre cada resposta digitada pelo apostador)
// =========================

let revealUnsubscribe = null;
let revealBuilt = false;
let revealIsBidder = false;
let revealTotalAnswers = 0;
let myVotes = new Map(); // answerIndex -> true (concordo) | false (discordo)

function OpenReveal()
{
  if(revealUnsubscribe)
  {
    revealUnsubscribe();
    revealUnsubscribe = null;
  }

  revealBuilt = false;
  myVotes = new Map();

  const revealRef =
    ref(db, `rooms/${currentRoomCode}/currentState/reveal`);

  revealUnsubscribe = onValue(revealRef, (snapshot) =>
  {
    if(!snapshot.exists()) return;

    const data = snapshot.val();

    if(data.answers && !revealBuilt)
    {
      revealBuilt = true;

      BuildRevealScreen(data);
    }

    // RESULTADOS (chegam depois, quando o host resolve a votação)
    if(data.outcomes)
    {
      Object.entries(data.outcomes).forEach(([answerIndex, outcome]) =>
      {
        const row = document.getElementById(`revealRow_${answerIndex}`);
        if(!row) return;

        row.classList.add(outcome === "invalidated" ? "revealRowInvalidated" : "revealRowKept");

        row.querySelectorAll(".voteButton").forEach((button) => { button.disabled = true; });
      });
    }
  });
}

function BuildRevealScreen(data)
{
  revealIsBidder = data.bidderId === currentPlayerId;
  revealTotalAnswers = Object.keys(data.answers).length;

  document.getElementById("revealSubtitle").innerText =
    revealIsBidder
      ? "Aguarde a votação dos outros jogadores."
      : `${data.bidderName} apostou ${data.bidAmount}. Vote CONCORDO ou DISCORDO em cada resposta — a fase só avança quando todo mundo votar!`;

  const container = document.getElementById("revealItemsList");
  container.innerHTML = "";

  Object.entries(data.answers).forEach(([answerIndex, text]) =>
  {
    BuildRevealRow(Number(answerIndex), text);
  });

  UpdateRevealVoteStatus();
}

// Texto abaixo do subtítulo: lembra de votar em tudo, depois avisa que é só
// esperar — não tem prazo, a fase só passa quando todo mundo já votou.
function UpdateRevealVoteStatus()
{
  const statusText = document.getElementById("revealVoteStatusText");
  if(!statusText) return;

  if(revealIsBidder)
  {
    statusText.innerText = "";
  }
  else if(myVotes.size >= revealTotalAnswers && revealTotalAnswers > 0)
  {
    statusText.innerText = "Você votou em tudo! Aguardando os outros jogadores...";
  }
  else
  {
    statusText.innerText = `Faltam ${revealTotalAnswers - myVotes.size} resposta(s) pra você votar.`;
  }
}

function BuildRevealRow(answerIndex, text)
{
  const container = document.getElementById("revealItemsList");

  const row = document.createElement("div");
  row.className = "revealRow";
  row.id = `revealRow_${answerIndex}`;

  const word = document.createElement("span");
  word.className = "revealRowWord";
  word.innerText = `"${text}"`;

  row.appendChild(word);

  if(revealIsBidder)
  {
    // NINGUÉM QUESTIONA A PRÓPRIA APOSTA — só um aviso, sem botão.
    const ownLabel = document.createElement("span");
    ownLabel.className = "revealOwnLabel";
    ownLabel.innerText = "Sua aposta";
    row.appendChild(ownLabel);
  }
  else
  {
    const voteButtons = document.createElement("div");
    voteButtons.className = "voteButtons";

    const agreeButton = document.createElement("button");
    agreeButton.className = "voteButton agree";
    agreeButton.innerText = "✓ Concordo";
    agreeButton.onclick = () => CastVote(answerIndex, true, agreeButton, disagreeButton);

    const disagreeButton = document.createElement("button");
    disagreeButton.className = "voteButton disagree";
    disagreeButton.innerText = "✕ Discordo";
    disagreeButton.onclick = () => CastVote(answerIndex, false, agreeButton, disagreeButton);

    voteButtons.appendChild(agreeButton);
    voteButtons.appendChild(disagreeButton);
    row.appendChild(voteButtons);
  }

  container.appendChild(row);
}


// =========================
// CONCORDO / DISCORDO (dá pra trocar de ideia enquanto a votação não fechar)
// =========================

async function CastVote(index, agree, agreeButton, disagreeButton)
{
  if(isGamePaused) return;

  // MESMO VOTO DE NOVO: não faz nada (não dá pra "desvotar", só trocar).
  if(myVotes.get(index) === agree) return;

  myVotes.set(index, agree);

  agreeButton.classList.toggle("selected", agree);
  disagreeButton.classList.toggle("selected", !agree);

  UpdateRevealVoteStatus();

  await set(
    ref(db, `rooms/${currentRoomCode}/currentState/reveal/votes/${index}/${currentPlayerId}`),
    agree
  );
}


// =========================
// OPEN RESULT (sucesso/blefe furado da rodada + placar provisório)
// =========================

async function OpenResult()
{
  const outcomeDiv = document.getElementById("resultOutcomeCard");
  const scoreboardDiv = document.getElementById("resultScoreboard");

  outcomeDiv.innerHTML = "";
  scoreboardDiv.innerHTML = "";

  const [resultSnapshot, playersSnapshot] =
    await Promise.all(
    [
      get(ref(db, `rooms/${currentRoomCode}/history/round_${currentRound}/result`)),
      get(ref(db, `rooms/${currentRoomCode}/players`))
    ]);

  if(resultSnapshot.exists())
  {
    const result = resultSnapshot.val();

    const card = document.createElement("div");
    card.className = "resultCard " + (result.success ? "resultSuccess" : "resultFail");

    card.innerHTML =
      `<p class="resultTopic">"${result.topic}"</p>` +
      `<p class="resultBidder">${result.bidderName} apostou ${result.bidAmount}</p>` +
      `<p class="resultOutcome">${result.success ? "CONSEGUIU! ✅" : "BLEFE FURADO! ❌"}</p>` +
      `<p class="resultValidCount">${result.validCount}/${result.bidAmount} respostas válidas</p>`;

    outcomeDiv.appendChild(card);
  }

  RenderScoreboard(playersSnapshot, scoreboardDiv);
}


// =========================
// OPEN FINAL SCORE
// =========================

async function OpenFinalScore()
{
  const playersSnapshot =
    await get(ref(db, `rooms/${currentRoomCode}/players`));

  RenderScoreboard(playersSnapshot, document.getElementById("finalScores"));
}


// =========================
// PLACAR (players/{id}/score — PROVISÓRIO, ver ApostaGameManager.cs)
// =========================

function RenderScoreboard(playersSnapshot, container)
{
  container.innerHTML = "";

  if(!playersSnapshot.exists()) return;

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

    container.appendChild(item);
  });
}
