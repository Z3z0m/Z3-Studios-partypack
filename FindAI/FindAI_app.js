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
let alreadyVoted = false;
let currentGameState = "Lobby";
let currentRound = 0;
let isGamePaused = false;
let isHost = false;

let myAnswerText = "";
let playersCache = {};

let tutorialPage = 0;

const TUTORIAL_PAGES = [
  "A cada rodada, você recebe uma pergunta e escreve uma resposta que pareça ter sido dada por uma Inteligência Artificial.",
  "Só que tem um problema: uma das respostas exibidas na votação é DE VERDADE gerada por uma IA. As suas respostas precisam se misturar com ela!",
  "Depois que todos responderem, todo mundo vota em qual resposta acha que é da IA de verdade.",
  "Acertar a resposta da IA vale pontos. Enganar os outros jogadores com a sua resposta também vale pontos!"
];

// Estados de servidor onde faz sentido mostrar o timer/round — os valores
// abaixo NÃO vêm sincronizados do Unity (FindAIGameManager não publica
// duração nem timestamp de fim no Firebase), então a barra é só cosmética:
// ela reinicia visualmente a cada entrada na fase, mas não representa o
// relógio real do host.
const TIMER_DURATIONS = { Prompt: 40, Voting: 20 };

let answersUnsub = null;
let votingUnsub = null;

let lastVotingItems = [];
let pendingVoteKey = null;


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
// SMALL DOM HELPERS
// (montados via createElement/textContent — nunca innerHTML com texto
// vindo de jogadores, pra não abrir brecha de injeção via nome/resposta)
// =========================

function blueprintCard(extraClass)
{
  const div = document.createElement("div");

  div.className =
    "card blueprint" + (extraClass ? " " + extraClass : "");

  ["tl", "tr", "bl", "br"].forEach(pos =>
  {
    const corner = document.createElement("i");
    corner.className = "corner " + pos;
    div.appendChild(corner);
  });

  return div;
}

function renderDots(containerId, count, activeIndex)
{
  const container =
    document.getElementById(containerId);

  container.innerHTML = "";

  for(let i = 0; i < count; i++)
  {
    const dot = document.createElement("div");

    dot.className =
      "tinyDot" + (i === activeIndex ? " active" : "");

    container.appendChild(dot);
  }
}


// =========================
// ENTER KEY SUBMIT
// =========================

window.HandleEnterKey = function(event, callback)
{
  if(event.key !== "Enter") return;

  event.preventDefault();

  callback();
};


// =========================
// MATRIX RAIN BACKGROUND (decorativo)
// =========================

function buildRain()
{
  const container =
    document.getElementById("rain");

  if(!container) return;

  const glyphs =
    ["01", "10", "AI", "1", "0", "11", "00", "A1", "IA", "1A", "0I", "I0"];

  const lineH = 20;
  const lines = 44;
  const cols = 7;

  const width =
    Math.max(window.innerWidth || 0, 320);

  const h = lines * lineH;

  for(let i = 0; i < cols; i++)
  {
    const set = [];

    for(let j = 0; j < lines; j++)
    {
      set.push(glyphs[(i * 5 + j * 3) % glyphs.length]);
    }

    const dur = 7 + (i % 5);

    const col = document.createElement("div");

    col.className = "rainCol";
    col.style.left = Math.round(i * (width / cols)) + "px";
    col.style.width = Math.floor(width / cols) + "px";
    col.style.top = -h + "px";
    col.style.setProperty("--rain-shift", h + "px");
    col.style.animationDuration = dur + "s";
    col.style.animationDelay = `-${(i * 0.7) % dur}s`;
    col.textContent = set.join("\n") + "\n" + set.join("\n");

    container.appendChild(col);
  }
}


// =========================
// TIMER BAR (decorativo — ver nota em TIMER_DURATIONS)
// =========================

function runTimer(seconds)
{
  const bar = document.getElementById("timerBar");
  const fill = document.getElementById("timerFill");

  bar.style.visibility = "visible";

  fill.style.transition = "none";
  fill.style.width = "100%";

  void fill.offsetHeight; // força reflow antes de trocar a transição

  fill.style.transition = `width ${seconds}s linear`;

  requestAnimationFrame(() =>
  {
    fill.style.width = "0%";
  });
}

function hideTimer()
{
  document
    .getElementById("timerBar")
    .style.visibility = "hidden";
}


// =========================
// START
// =========================

window.onload = async function()
{
  document.getElementById("identityTag").textContent =
    currentPlayerName || "";

  buildRain();

  await CheckIfHost();

  ListenForPlayers();
  ListenForGameState();
  ListenForPrompt();
  ListenForCategory();
  ListenForPause();
};

document
  .getElementById("answerInput")
  .addEventListener("input", (event) =>
  {
    document.getElementById("draftCount").textContent =
      event.target.value.length;
  });


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

    document.body.classList.toggle("isHost", isHost);
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

    // Avanço local otimista — o Unity é quem manda de verdade (ele nunca
    // publica de volta em que página do tutorial está), isso só mantém a
    // tela do host em sincronia com os cliques que ele mesmo deu.
    if(action === "next")
    {
        tutorialPage =
            Math.min(TUTORIAL_PAGES.length - 1, tutorialPage + 1);
    }
    else if(action === "prev")
    {
        tutorialPage =
            Math.max(0, tutorialPage - 1);
    }
    else
    {
        return;
    }

    renderTutorial();
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
// LISTEN PLAYERS (cache usado por lobby, sent, result e final)
// =========================

function ListenForPlayers()
{
  onValue(
    ref(db, `rooms/${currentRoomCode}/players`),
    (snapshot) =>
    {
      playersCache = {};

      snapshot.forEach((child) =>
      {
        playersCache[child.key] = child.val() || {};
      });

      renderLobby();

      if(currentGameState === "Result") renderResult();
      if(currentGameState === "FinalScore") renderFinal();
    }
  );
}

function renderLobby()
{
  const players = Object.values(playersCache);

  document.getElementById("lobbyPlayerCount").textContent =
    players.length;

  const container =
    document.getElementById("lobbyPlayers");

  container.innerHTML = "";

  players.forEach((p) =>
  {
    const tag = document.createElement("div");

    tag.className = "tag";
    tag.textContent = p.name || "???";

    container.appendChild(tag);
  });
}


// =========================
// LISTEN PROMPT
// =========================

function ListenForPrompt()
{
  const promptRef =
    ref(
      db,
      `rooms/${currentRoomCode}/currentState/prompt`
    );

  onValue(promptRef, (snapshot) =>
  {
    const prompt = snapshot.val();

    if(!prompt) return;

    document
      .getElementById("promptText")
      .textContent = prompt;

    document
      .getElementById("votingPrompt")
      .textContent = prompt;

    alreadyAnswered = false;
    myAnswerText = "";

    const input =
      document.getElementById("answerInput");

    input.value = "";
    input.disabled = false;

    document.getElementById("draftCount").textContent = "0";
    document.getElementById("sendButton").disabled = false;

    renderPromptOrSent();
  });
}


// =========================
// LISTEN CATEGORY
// =========================

function ListenForCategory()
{
  const categoryRef =
    ref(
      db,
      `rooms/${currentRoomCode}/currentState/category`
    );

  onValue(categoryRef, (snapshot) =>
  {
    const category = snapshot.val();

    if(!category) return;

    document
      .getElementById("promptCategoryTag")
      .textContent = category;

    document
      .getElementById("promptCategoryHint")
      .textContent = `Escreva como se fosse ${category}.`;

    document
      .getElementById("votingKicker")
      .textContent = `Vote na resposta que parece ${category}`;
  });
}


// =========================
// SEND ANSWER
// =========================

window.sendAnswer = async function()
{
  if(isGamePaused) return;

  if(alreadyAnswered) return;

  const answerText =
    document
    .getElementById("answerInput")
    .value
    .trim();

  if(answerText.length <= 0) return;

  // GET ROUND

  const roundSnapshot =
    await get(
      ref(
        db,
        `rooms/${currentRoomCode}/currentState/round`
      )
    );

  const round =
    roundSnapshot.val();

  // SAVE ANSWER

  await set(
    ref(
      db,
      `rooms/${currentRoomCode}/history/round_${round}/answers/${currentPlayerId}`
    ),
    {
      playerName: currentPlayerName,
      playerId: currentPlayerId,
      text: answerText
    }
  );

  console.log("Resposta enviada!");

  myAnswerText = answerText;
  alreadyAnswered = true;

  document
    .getElementById("answerInput")
    .disabled = true;

  document
    .getElementById("sendButton")
    .disabled = true;

  renderPromptOrSent();
};

function renderPromptOrSent()
{
  if(currentGameState !== "Prompt") return;

  if(alreadyAnswered)
  {
    document
      .getElementById("sentAnswerText")
      .textContent = myAnswerText;

    ShowScreen("sentScreen");

    ListenForAnswersCount(currentRound);
  }
  else
  {
    ShowScreen("promptScreen");
  }
}

function ListenForAnswersCount(round)
{
  if(answersUnsub)
  {
    answersUnsub();
    answersUnsub = null;
  }

  answersUnsub = onValue(
    ref(
      db,
      `rooms/${currentRoomCode}/history/round_${round}/answers`
    ),
    (snapshot) =>
    {
      const count =
        snapshot.exists()
          ? Object.keys(snapshot.val()).length
          : 0;

      const total =
        Object.keys(playersCache).length;

      renderSentProgress(count, total);
    }
  );
}

function renderSentProgress(count, total)
{
  document.getElementById("sentProgressLabel").textContent =
    `RESPONDERAM · ${count}/${total}`;

  const slotsContainer =
    document.getElementById("sentProgressSlots");

  slotsContainer.innerHTML = "";

  const slots = Math.max(total, 1);

  for(let i = 0; i < slots; i++)
  {
    const slot = document.createElement("div");

    slot.className =
      "slot" + (i < count ? " filled" : "");

    slotsContainer.appendChild(slot);
  }

  const waiting = Math.max(total - count, 0);

  document.getElementById("sentWaitingText").textContent =
    waiting > 0
      ? `Aguardando ${waiting} jogador${waiting === 1 ? "" : "es"}…`
      : "Todos responderam!";
}


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

  onValue(stateRef, async (snapshot) =>
  {
    const gameState = snapshot.val();

    currentGameState = gameState;

    const roundSnapshot =
      await get(
        ref(
          db,
          `rooms/${currentRoomCode}/currentState/round`
        )
      );

    currentRound = roundSnapshot.val() || 0;

    updateRoundLabel();

    if(gameState == "Lobby")
    {
      hideTimer();
      ShowScreen("lobbyScreen");
    }

    if(gameState == "Tutorial")
    {
      hideTimer();
      tutorialPage = 0;
      renderTutorial();
      ShowScreen("tutorialScreen");
    }

    if(gameState == "Prompt")
    {
      renderPromptOrSent();
      runTimer(TIMER_DURATIONS.Prompt);
    }

    if(gameState == "Voting")
    {
      ShowScreen("votingScreen");
      OpenVoting();
      runTimer(TIMER_DURATIONS.Voting);
    }

    if(gameState == "ShowAnswers")
    {
      hideTimer();
      ShowScreen("showAnswersScreen");
      OpenReveal();
    }

    if(gameState == "Result")
    {
      hideTimer();
      ShowScreen("resultScreen");
      renderResult();
    }

    if(gameState == "FinalScore")
    {
      hideTimer();
      ShowScreen("finalScoreScreen");
      renderFinal();
    }
  });
}

function updateRoundLabel()
{
  const show =
    ["Prompt", "Voting", "ShowAnswers", "Result"]
      .includes(currentGameState);

  const el =
    document.getElementById("roundLabel");

  el.style.display = show ? "" : "none";
  el.textContent = show ? `R${currentRound}` : "";
}


// =========================
// TUTORIAL
// =========================

function renderTutorial()
{
  document.getElementById("tutorialPageNum").textContent =
    `PÁGINA ${tutorialPage + 1}/${TUTORIAL_PAGES.length}`;

  document.getElementById("tutorialPageText").textContent =
    TUTORIAL_PAGES[tutorialPage];

  renderDots("tutorialDotsHost", TUTORIAL_PAGES.length, tutorialPage);

  // O jogador (não-host) não tem como saber em que página o host está —
  // o Unity não publica isso —, então aqui é só decorativo.
  renderDots("tutorialDotsPlayer", TUTORIAL_PAGES.length, 0);
}


// =========================
// VOTING
// =========================

function OpenVoting()
{
  alreadyVoted = false;
  pendingVoteKey = null;

  const confirmButton =
    document.getElementById("confirmVoteButton");

  confirmButton.style.display = "";
  confirmButton.disabled = true;

  document.getElementById("votingWaitingText").style.display = "none";

  if(votingUnsub)
  {
    votingUnsub();
    votingUnsub = null;
  }

  votingUnsub = onValue(
    ref(
      db,
      `rooms/${currentRoomCode}/currentState/votingAnswers`
    ),
    (snapshot) =>
    {
      lastVotingItems = [];

      snapshot.forEach((child) =>
      {
        lastVotingItems.push({ key: child.key, data: child.val() || {} });
      });

      renderVotingAnswers(lastVotingItems);
    }
  );
}

function renderVotingAnswers(items)
{
  const container =
    document.getElementById("votingAnswers");

  container.innerHTML = "";

  items.forEach((item, index) =>
  {
    const letter =
      String.fromCharCode(65 + index);

    const isMine =
      item.data.playerId === currentPlayerId;

    const isSelected =
      item.key === pendingVoteKey;

    const card =
      blueprintCard(
        "voteCard" +
        (isMine ? " mine" : "") +
        (isSelected ? " selected" : "")
      );

    const top = document.createElement("div");
    top.className = "voteCardTop";

    const letterEl = document.createElement("div");
    letterEl.className = "voteLetter mono";
    letterEl.textContent = "RESPOSTA " + letter;
    top.appendChild(letterEl);

    if(isMine)
    {
      const flag = document.createElement("div");
      flag.className = "voteFlag";
      flag.textContent = "SUA";
      top.appendChild(flag);
    }
    else if(isSelected)
    {
      const flag = document.createElement("div");
      flag.className = "voteFlag voted";
      flag.textContent = "VOTADA";
      top.appendChild(flag);
    }

    card.appendChild(top);

    const text = document.createElement("div");
    text.className = "voteText";
    text.textContent = item.data.text || "";
    card.appendChild(text);

    if(!isMine && !alreadyVoted)
    {
      card.addEventListener("click", () => selectVote(item.key));
    }

    container.appendChild(card);
  });
}

function selectVote(key)
{
  if(alreadyVoted) return;

  pendingVoteKey = key;

  document.getElementById("confirmVoteButton").disabled = false;

  renderVotingAnswers(lastVotingItems);
}

window.confirmVote = async function()
{
  if(isGamePaused) return;

  if(alreadyVoted || !pendingVoteKey) return;

  alreadyVoted = true;

  const roundSnapshot =
    await get(
      ref(
        db,
        `rooms/${currentRoomCode}/currentState/round`
      )
    );

  const round =
    roundSnapshot.val();

  await set(
    ref(
      db,
      `rooms/${currentRoomCode}/history/round_${round}/votes/${currentPlayerId}`
    ),
    {
      votedAnswer: pendingVoteKey,
      playerName: currentPlayerName
    }
  );

  console.log("Voto enviado!");

  document.getElementById("confirmVoteButton").style.display = "none";

  const waitingText =
    document.getElementById("votingWaitingText");

  waitingText.style.display = "";
  waitingText.textContent = "Esperando outros votos…";

  renderVotingAnswers(lastVotingItems);
};


// =========================
// REVEAL (ShowAnswers) — só a resposta real da IA. Quem cada jogador
// enganou / se acertou fica de fora de propósito: calcular isso no
// cliente duplicaria a lógica de pontuação do Unity e podia divergir
// do placar oficial.
// =========================

async function OpenReveal()
{
  const snapshot =
    await get(
      ref(
        db,
        `rooms/${currentRoomCode}/history/round_${currentRound}/fakeAnswer`
      )
    );

  document.getElementById("revealFakeAnswer").textContent =
    snapshot.val() || "";
}


// =========================
// RESULT / FINAL
// =========================

function getSortedPlayers()
{
  return Object.keys(playersCache)
    .map((id) => ({
      id,
      name: playersCache[id].name || "???",
      score: playersCache[id].score || 0
    }))
    .sort((a, b) => b.score - a.score);
}

function renderScoreRows(container, list)
{
  container.innerHTML = "";

  list.forEach((p, i) =>
  {
    const isMe = p.id === currentPlayerId;

    const row =
      blueprintCard("scoreRow" + (isMe ? " me" : " dim-corners"));

    const left = document.createElement("div");
    left.className = "scoreRowLeft";

    const rank = document.createElement("div");
    rank.className = "scoreRank mono";
    rank.textContent = String(i + 1);

    const name = document.createElement("div");
    name.className = "scoreName";
    name.textContent = p.name;

    left.appendChild(rank);
    left.appendChild(name);

    const value = document.createElement("div");
    value.className = "scoreValue mono";
    value.textContent = String(p.score);

    row.appendChild(left);
    row.appendChild(value);

    container.appendChild(row);
  });
}

function renderResult()
{
  const sorted = getSortedPlayers();
  const myIndex = sorted.findIndex((p) => p.id === currentPlayerId);

  document.getElementById("resultRoundNum").textContent =
    currentRound || "";

  renderScoreRows(document.getElementById("resultScores"), sorted);

  document.getElementById("resultMyRank").textContent =
    myIndex >= 0 ? (myIndex + 1) + "º" : "—";

  document.getElementById("resultTotalPlayers").textContent =
    sorted.length;

  document.getElementById("resultMyScore").textContent =
    myIndex >= 0 ? `${sorted[myIndex].score} pts` : "";
}

function renderFinal()
{
  const sorted = getSortedPlayers();
  const myIndex = sorted.findIndex((p) => p.id === currentPlayerId);

  document.getElementById("finalMyRank").textContent =
    myIndex >= 0 ? (myIndex + 1) + "º" : "—";

  document.getElementById("finalMyScore").textContent =
    myIndex >= 0 ? `${sorted[myIndex].score} pts` : "";

  renderScoreRows(document.getElementById("finalScores"), sorted);
}
