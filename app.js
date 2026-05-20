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
// PLAYER DATA
// =========================

let currentRoomCode = "";

let currentPlayerName = "";

let currentPlayerId = "";

let alreadyAnswered = false;
let alreadyVoted = false;


// =========================
// JOIN ROOM
// =========================

window.joinRoom = async function()
{
  const roomCode =
    document
    .getElementById("roomCode")
    .value
    .toUpperCase()
    .trim();

  const playerName =
    document
    .getElementById("playerName")
    .value
    .trim();

  const status =
    document.getElementById("status");

  if(roomCode.length < 4)
  {
    status.innerText = "Código inválido";

    return;
  }

  if(playerName.length < 2)
  {
    status.innerText = "Nome inválido";

    return;
  }

  const playerId = crypto.randomUUID();

  currentRoomCode = roomCode;

  currentPlayerName = playerName;

  currentPlayerId = playerId;

  try
  {
    // VERIFICA SE SALA EXISTE

    const roomRef =
      ref(db, `rooms/${roomCode}`);

    const snapshot =
      await get(roomRef);

    if(!snapshot.exists())
    {
      status.innerText =
        "Sala não encontrada";

      return;
    }

    // ENTRA NA SALA

    await set(
      ref(
        db,
        `rooms/${roomCode}/players/${playerId}`
      ),
      {
        name: playerName
      }
    );

    console.log("Jogador conectado!");

    // TROCA TELA

    document
      .getElementById("loginScreen")
      .style.display = "none";

    document
      .getElementById("gameScreen")
      .style.display = "flex";

    // COMEÇA LISTENER

    ListenForPrompt();
    ListenForGameState();
  }
  catch(error)
  {
    console.error(error);

    status.innerText =
      "Erro ao conectar";
  }
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
    .style.display = "block";

    document
      .getElementById("answerInput")
      .style.display = "block";

    document
      .getElementById("sendButton")
      .style.display = "block";

    document
      .getElementById("votingContainer")
      .style.display = "none";
  });
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
  const answerText = document
      .getElementById("answerInput")
      .value
      .trim();

  if(answerText.length <= 0)
  {
    return;
  }

  // GET CURRENT ROUND

  const roundSnapshot = await get(ref(db,`rooms/${currentRoomCode}/currentState/round`));

  const currentRound = roundSnapshot.val();

  // SAVE ANSWER

  await set(ref(db,`rooms/${currentRoomCode}/history/round_${currentRound}/answers/${currentPlayerId}`),
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
}

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

    if(gameState == "Voting")
    {
      OpenVoting();
    }
  });
}
async function OpenVoting()
{
  alreadyVoted = false;

  document
    .getElementById("promptText")
    .style.display = "none";

  // ESCONDE INPUT RESPOSTA

  document
    .getElementById("answerInput")
    .style.display = "none";

  document
    .getElementById("sendButton")
    .style.display = "none";

  document
    .getElementById("waitingText")
    .innerText = "";

  // MOSTRA VOTAÇÃO

  document
    .getElementById("votingContainer")
    .style.display = "flex";

  const votingAnswersDiv =
    document.getElementById("votingAnswers");

  votingAnswersDiv.innerHTML = "";

  // GET VOTING ANSWERS

  const votingRef =
  ref(
    db,
    `rooms/${currentRoomCode}/currentState/votingAnswers`
  );

onValue(votingRef,(snapshot)=>
{
  votingAnswersDiv.innerHTML = "";

  if(!snapshot.exists())
  {
    return;
  }

  snapshot.forEach((child)=>
  {
        const answerData = child.val();

    const button =
      document.createElement("button");

    button.className = "voteButton";

    button.innerText = answerData.text;

    button.onclick = () =>
      Vote(child.key);

    votingAnswersDiv.appendChild(button);
  });
});

async function Vote(answerId)
{
  if(alreadyVoted)
  {
    return;
  }

  alreadyVoted = true;

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

  // SAVE VOTE

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

  // UI

  document
    .getElementById("votingContainer")
    .innerHTML =
    "<h2>Esperando outros votos...</h2>";

  console.log("Voto enviado!");
}
}