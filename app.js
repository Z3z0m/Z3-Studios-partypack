// =========================
// FIREBASE IMPORTS
// =========================

import { initializeApp }
from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

import {
  getDatabase,
  ref,
  set,
  get
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
// GLOBALS
// =========================

let detectedGameMode = "";

let roomExists = false;


// =========================
// CHECK ROOM CODE
// =========================

async function CheckRoomCode()
{
  const roomCode =
    document
    .getElementById("roomCode")
    .value
    .toUpperCase()
    .trim();

  const gameModeText =
    document.getElementById("gameModeText");

  const joinButton =
    document.getElementById("joinButton");

  // RESET

  joinButton.disabled = true;

  roomExists = false;

  // INVALID CODE

  if(roomCode.length < 4)
  {
    gameModeText.innerText = "";

    return;
  }

  try
  {
    const roomRef =
      ref(db, `rooms/${roomCode}`);

    const snapshot =
      await get(roomRef);

    // ROOM NOT FOUND

    if(!snapshot.exists())
    {
      gameModeText.innerText =
        "Sala não encontrada";

      return;
    }

    // GET GAME MODE

    const data = snapshot.val();

    detectedGameMode =
      data.game || "Desconhecido";

    roomExists = true;

    // ENABLE BUTTON

    joinButton.disabled = false;

    // UI

    gameModeText.innerText =
      `Modo encontrado: ${detectedGameMode}`;
  }
  catch(error)
  {
    console.error(error);

    gameModeText.innerText =
      "Erro ao verificar sala";
  }
}


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

  // VALIDATIONS

  if(roomCode.length < 4)
  {
    status.innerText =
      "Código inválido";

    return;
  }

  if(playerName.length < 2)
  {
    status.innerText =
      "Nome inválido";

    return;
  }

  if(!roomExists)
  {
    status.innerText =
      "Sala inválida";

    return;
  }

  // PLAYER DATA

  const playerId =
    crypto.randomUUID();

  try
  {
    // ADD PLAYER

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

    // REDIRECT

    if(detectedGameMode == "FindAI")
    {
      window.location.href =
        `FindAI/FindAI_index.html?room=${roomCode}&name=${playerName}&id=${playerId}`;
    }

    else if(detectedGameMode == "ChaosCourt")
    {
      window.location.href =
        `ChaosCourt/ChaosCourt_index.html?room=${roomCode}&name=${playerName}&id=${playerId}`;
    }

    else
    {
      status.innerText =
        "Modo de jogo desconhecido";
    }
  }
  catch(error)
  {
    console.error(error);

    status.innerText =
      "Erro ao conectar";
  }
}


// =========================
// GLOBAL EXPORTS
// =========================

window.CheckRoomCode =
  CheckRoomCode;