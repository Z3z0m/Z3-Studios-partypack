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
let currentAuthorId = null;
let isGamePaused = false;
let isHost = false;

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
    // (escrever ou julgar) — não faz sentido o host "pular" enquanto todo
    // mundo ainda está com o teclado aberto. Tutorial tem seus próprios
    // botões (SendTutorialAction), então o genérico também some lá.
    const hidden =
        state === "Tutorial" ||
        state === "Writing" ||
        state === "Judging";

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
    }
  );
}


// =========================
// LISTEN FOR MY SECRET GRADE
// Só lê o próprio caminho (currentState/secretGrades/{meuId}) — nunca o nó
// inteiro de secretGrades, pra não expor a nota dos outros no console/rede
// por acidente.
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

  const currentRound =
    roundSnapshot.val();

  await set(
    ref(
      db,
      `rooms/${currentRoomCode}/history/round_${currentRound}/answers/${currentPlayerId}`
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

    document
      .getElementById("themeBanner")
      .style.display =
        (gameState == "Writing" || gameState == "Judging" || gameState == "AnswerResult")
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

    if(gameState == "AnswerResult")
    {
      ShowScreen("answerResultScreen");
      OpenAnswerResult();
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
// JUDGING
// =========================

function OpenJudging()
{
  const currentAnswerRef =
    ref(db, `rooms/${currentRoomCode}/currentState/currentAnswer`);

  onValue(currentAnswerRef, (snapshot) =>
  {
    if(!snapshot.exists()) return;

    const data = snapshot.val();

    // NOVA RESPOSTA (autor mudou): reseta o estado de julgamento local e o
    // destaque visual dos botões de nota.
    if(data.authorId !== currentAuthorId)
    {
      currentAuthorId = data.authorId;
      alreadyJudged = false;

      document
        .querySelectorAll(".gradeButton")
        .forEach(btn => btn.classList.remove("selected"));

      document.getElementById("judgingWaitingText").innerText = "";
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
  if(!currentAuthorId) return;

  alreadyJudged = true;

  document
    .querySelectorAll(".gradeButton")
    .forEach(btn => btn.classList.remove("selected"));

  document
    .querySelectorAll(".gradeButton")[grade]
    .classList.add("selected");

  const roundSnapshot =
    await get(ref(db, `rooms/${currentRoomCode}/currentState/round`));

  const currentRound = roundSnapshot.val();

  await set(
    ref(
      db,
      `rooms/${currentRoomCode}/history/round_${currentRound}/judgments/${currentAuthorId}/${currentPlayerId}`
    ),
    {
      playerName: currentPlayerName,
      guessedGrade: grade
    }
  );

  document.getElementById("judgingWaitingText").innerText =
    "Esperando os outros julgarem...";
};


// =========================
// ANSWER RESULT
// =========================

async function OpenAnswerResult()
{
  const resultSnapshot =
    await get(ref(db, `rooms/${currentRoomCode}/currentState/answerResult`));

  const mineDiv = document.getElementById("answerResultMine");
  mineDiv.innerHTML = "";

  if(!resultSnapshot.exists())
  {
    document.getElementById("answerResultRealGrade").innerText = "?";
    return;
  }

  const result = resultSnapshot.val();

  document.getElementById("answerResultRealGrade").innerText =
    result.realGrade ?? "?";

  const myEntry = result.entries ? result.entries[currentPlayerId] : null;

  if(myEntry)
  {
    const points = myEntry.points >= 0 ? `+${myEntry.points}` : myEntry.points;
    mineDiv.innerText =
      `Você chutou ${myEntry.guessedGrade} (${points} pontos)`;
  }
};


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
