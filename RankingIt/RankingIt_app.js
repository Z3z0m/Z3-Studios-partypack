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
let currentGameState = "Lobby";
let isGamePaused = false;
let isHost = false;

// QUADRO DE CLASSIFICAÇÃO (Judging + Refining): estado fica só em memória —
// não recarrega a página entre as duas fases, então não precisa reler nada
// do Firebase pra continuar de onde parou.
let currentRound = null;
let answersMap = {}; // authorId -> {authorName, text}  (todas as respostas da rodada, exceto a minha)
let myGuesses = {}; // authorId -> nota (0-5) que EU dei
let selectedCardAuthorId = null;
let judgingProgressSent = false;
let refiningReadySent = false;

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
    // enquanto todo mundo ainda está mexendo no quadro. Tutorial tem seus
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
      document.getElementById("rankBoardAxis").innerText = axis;
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

    const isBoardPhase =
      gameState == "Judging" || gameState == "Refining";

    document.getElementById("rankBoardWrapper").classList.toggle("active", isBoardPhase);
    document.querySelector(".container").style.display = isBoardPhase ? "none" : "block";

    document
      .getElementById("themeBanner")
      .style.display =
        (gameState == "Writing" || isBoardPhase || gameState == "Reveal")
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
// LISTEN FOR ALL ANSWERS (respostas públicas da rodada, sem nota nenhuma)
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

      RenderBoard();
    }
  );
}


// =========================
// JUDGING (nota inicial em todas as respostas)
// =========================

async function OpenJudging()
{
  const roundSnapshot =
    await get(ref(db, `rooms/${currentRoomCode}/currentState/round`));

  const round = roundSnapshot.val();

  // RODADA NOVA: reseta o quadro (respostas voltam pra bandeja, sem nota).
  if(round !== currentRound)
  {
    currentRound = round;
    myGuesses = {};
    judgingProgressSent = false;
  }

  refiningReadySent = false;
  selectedCardAuthorId = null;

  document.getElementById("rankBoardHint").innerText =
    "Toque numa resposta e depois na nota que ela merece — dá pra trocar quantas vezes quiser.";

  document.getElementById("refiningReadyBtn").style.display = "none";

  UpdateAuthorReminder();
  RenderBoard();
  UpdateJudgingProgressUI();
}


// =========================
// REFINING (dobro do tempo — rever e reorganizar as notas já dadas)
// =========================

function OpenRefining()
{
  selectedCardAuthorId = null;

  document.getElementById("rankBoardHint").innerText =
    "Última chance! Toque numa resposta pra mover ela pra outra nota antes da revelação.";

  const readyBtn = document.getElementById("refiningReadyBtn");
  readyBtn.style.display = "block";
  readyBtn.disabled = false;
  readyBtn.innerText = "Pronto!";

  UpdateAuthorReminder();
  RenderBoard();
  document.getElementById("rankProgressText").innerText = "";
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
// AVISO PRA QUEM ESCREVEU UMA RESPOSTA NESTA RODADA
// "alreadyAnswered" já é exatamente esse sinal — vira true ao enviar a
// resposta no Writing e só é resetado quando a próxima nota secreta chega
// (ou seja, na próxima rodada).
// =========================

function UpdateAuthorReminder()
{
  document.getElementById("authorReminder").classList.toggle("active", alreadyAnswered);
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

    const card = document.createElement("div");
    card.className = "answerCard";
    card.dataset.authorId = authorId;

    if(authorId === selectedCardAuthorId)
    {
      card.classList.add("selected");
    }

    const authorSpan = document.createElement("span");
    authorSpan.className = "cardAuthor";
    authorSpan.innerText = answer.authorName ?? "???";

    const textSpan = document.createElement("span");
    textSpan.className = "cardText";
    textSpan.innerText = answer.text ?? "";

    card.appendChild(authorSpan);
    card.appendChild(textSpan);

    card.onclick = () => HandleCardTap(authorId);

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

function HandleCardTap(authorId)
{
  if(isGamePaused) return;

  // TOCOU DE NOVO NA MESMA CARTA JÁ SELECIONADA: desmarca.
  if(selectedCardAuthorId === authorId)
  {
    selectedCardAuthorId = null;
  }
  else
  {
    selectedCardAuthorId = authorId;
  }

  RenderBoard();
}

// TOCAR NUMA COLUNA COM UMA CARTA SELECIONADA: aplica a nota. O script fica
// no fim do <body> (e módulos já rodam depois do parse do documento), então
// os elementos abaixo já existem — sem precisar esperar nenhum evento de load.
document.querySelectorAll(".rankColumn").forEach((column) =>
{
  column.addEventListener("click", (event) =>
  {
    // SÓ conta clique na coluna em si (fora de uma carta específica, que já
    // tem seu próprio onclick pra (des)selecionar).
    if(event.target.closest(".answerCard")) return;

    const grade = parseInt(column.querySelector(".rankColumnCards").dataset.grade, 10);
    PlaceSelectedCard(grade);
  });
});

async function PlaceSelectedCard(grade)
{
  if(isGamePaused) return;
  if(selectedCardAuthorId === null) return;
  if(currentGameState !== "Judging" && currentGameState !== "Refining") return;

  const authorId = selectedCardAuthorId;
  myGuesses[authorId] = grade;
  selectedCardAuthorId = null;

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

  if(currentGameState === "Judging")
  {
    UpdateJudgingProgressUI();
  }
}

// TODAS AS RESPOSTAS JÁ TÊM NOTA: avisa o host que terminei (só uma vez —
// se eu mudar de ideia depois, continuo marcado como pronto mesmo assim).
async function UpdateJudgingProgressUI()
{
  const totalToJudge = Object.keys(answersMap).length;
  const totalJudged = Object.keys(myGuesses).filter(id => answersMap[id]).length;

  document.getElementById("rankProgressText").innerText =
    totalToJudge > 0 ? `${totalJudged}/${totalToJudge} respostas com nota` : "";

  if(!judgingProgressSent && totalToJudge > 0 && totalJudged >= totalToJudge)
  {
    judgingProgressSent = true;

    await set(
      ref(db, `rooms/${currentRoomCode}/currentState/judgingProgress/${currentPlayerId}`),
      true
    );
  }
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
