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
// ENTER KEY SUBMIT
// =========================

window.HandleEnterKey = function(event, callback)
{
  if(event.key !== "Enter") return;

  event.preventDefault();

  callback();
};

// =========================
// START
// =========================

window.onload = async function()
{
  await CheckIfHost();
  ListenForGameState();
  ListenForPrompt();
  ListenForCategory();
  ListenForPause();
};


// =========================
// HOST (só usado hoje pro "Jogar de Novo" na tela final)
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
        UpdateHostButton(currentGameState);
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
    if (!isHost) return;

    const btn = document.getElementById("hostButton");

    if (state !== "FinalScore")
    {
        btn.style.display = "none";
        return;
    }

    btn.style.display = "block";
    btn.innerText = "Jogar de Novo";
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

    if(prompt)
    {
      document
        .getElementById("promptText")
        .innerText = prompt;

      alreadyAnswered = false;

      document
        .getElementById("votingPrompt")
        .innerText = prompt;

      document
        .getElementById("answerInput")
        .disabled = false;

      document
        .getElementById("sendButton")
        .disabled = false;

      document
        .getElementById("waitingText")
        .innerText = "";

      document
        .getElementById("answerInput")
        .value = "";
    }

    document
      .getElementById("promptText")
      

    if(currentGameState == "Prompt")
    {
      document
        .getElementById("answerInput")
        

      document
        .getElementById("sendButton")
        
    }

    document
      .getElementById("votingContainer")

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

    if(!category)
    {
      return;
    }

    document
      .getElementById("categoryText")
      .innerText = `Escreva como se fosse ${category}`;

    document
      .getElementById("voteCategoryText")
      .innerText = `Vote na resposta que parece ${category}`;
  });
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

  // GET ROUND

  const roundSnapshot =
    await get(
      ref(
        db,
        `rooms/${currentRoomCode}/currentState/round`
      )
    );

  const currentRound =
    roundSnapshot.val();

  // SAVE ANSWER

  await set(
    ref(
      db,
      `rooms/${currentRoomCode}/history/round_${currentRound}/answers/${currentPlayerId}`
    ),
    {
      playerName: currentPlayerName,
      playerId: currentPlayerId,
      text: answerText
    }
  );

  console.log("Resposta enviada!");

  alreadyAnswered = true;

  document
    .getElementById("answerInput")
    .disabled = true;

  document
    .getElementById("sendButton")
    .disabled = true;

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
      .getElementById("categoryText")
      .classList.toggle("active", gameState == "Prompt");

    document
      .getElementById("voteCategoryText")
      .classList.toggle("active", gameState == "Voting");

    if(gameState == "Lobby") { ShowScreen("lobbyScreen") }

    if(gameState == "Prompt") { ShowScreen("promptScreen"); }

    if(gameState == "Voting")
    {
      ShowScreen("votingScreen");
      OpenVoting();

    }

    if(gameState == "ShowAnswers") { ShowScreen("showAnswersScreen"); }

    if(gameState == "Result")
      { ShowScreen("resultScreen");
        OpenResult();
      }

    if(gameState == "FinalScore")
      { ShowScreen("finalScoreScreen");
        OpenFinalScore();
      }
  });
}


// =========================
// OPEN VOTING
// =========================

async function OpenVoting()
{
  alreadyVoted = false;

  document
  .getElementById("votingWaitingText")
  .innerText = "";

  const votingAnswersDiv =
    document.getElementById("votingAnswers");

  votingAnswersDiv.innerHTML = "";

  const votingRef =
    ref(
      db,
      `rooms/${currentRoomCode}/currentState/votingAnswers`
    );

  onValue(votingRef, (snapshot) =>
  {
    votingAnswersDiv.innerHTML = "";

    if(!snapshot.exists())
    {
      return;
    }

    snapshot.forEach((child) =>
    {
      const answerData = child.val();

      const button =
        document.createElement("button");

      button.className = "voteButton";

      button.innerText = answerData.text;

      button.onclick =
        (event) => Vote(child.key, event);

      votingAnswersDiv.appendChild(button);
    });
  });
}


// =========================
// VOTE
// =========================

async function Vote(answerId, event)
{
  if(isGamePaused) return;

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
      `rooms/${currentRoomCode}/history/round_${currentRound}/votes/${currentPlayerId}`
    ),
    {
      votedAnswer: answerId,
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
// OPEN RESULT
// =========================

function OpenResult()
{
  const resultRef =
    ref(
      db,
      `rooms/${currentRoomCode}/players`
    );

  onValue(resultRef, (snapshot) =>
  {
    const resultDiv =
      document.getElementById("resultScores");

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