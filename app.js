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
// GAME PAGES (modo de jogo da sala -> página do jogo)
// =========================

const GamePages =
{
  FindAI:         "FindAI/FindAI_index.html",
  ChaosCourt:     "ChaosCourt/ChaosCourt_index.html",
  ColorsIn:       "ColorsIn/ColorsIn_index.html",
  NextAthena:     "Trivia/Trivia_index.html",
  InBetween:      "InBetween/InBetween_index.html",
  RankingIt:      "RankingIt/RankingIt_index.html",
  Stop:           "Stop/Stop_index.html",
  MauMau:         "MauMau/MauMau_index.html",
  CorridaEstelar: "CorridaEstelar/CorridaEstelar_index.html",
  Glimpse:        "Glimpse/Glimpse_index.html",
  Aposta:         "Aposta/Aposta_index.html",
  Landlords:      "Landlords/Landlords_index.html",
  FinalChapter:   "FinalChapter/FinalChapter_index.html",
  Ludo:           "Ludo/Ludo_index.html",
  SemPiedade:     "SemPiedade/SemPiedade_index.html"
};

// MODOS QUE NÃO RECEBEM O NOME NA URL
const GamesWithoutName = ["NextAthena"];

// PARÂMETROS DO MODO BOT repassados da tela de entrada pra página do jogo
// (ver bot/README.md). Sem eles na URL, a URL do jogo fica igual a antes.
const BotParamKeys = ["bot", "seed", "speed", "tap", "hoststart"];

function ReadBotParams()
{
  const params =
    new URLSearchParams(window.location.search);

  const botParams = {};

  BotParamKeys.forEach((key) =>
  {
    if(params.has(key)) botParams[key] = params.get(key);
  });

  return botParams;
}

function BuildGameUrl(gameMode, roomCode, playerName, playerId, botParams)
{
  const page = GamePages[gameMode];

  if(!page) return null;

  let url = GamesWithoutName.includes(gameMode)
    ? `${page}?room=${roomCode}&id=${playerId}`
    : `${page}?room=${roomCode}&name=${playerName}&id=${playerId}`;

  BotParamKeys.forEach((key) =>
  {
    const value = botParams[key];

    if(value !== undefined && value !== null && value !== "")
    {
      url += `&${key}=${encodeURIComponent(value)}`;
    }
  });

  return url;
}


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
// ENTER KEY NAVIGATION
// =========================

function HandleRoomCodeKeydown(event)
{
  if(event.key !== "Enter") return;

  event.preventDefault();

  document
    .getElementById("playerName")
    .focus();
}

function HandlePlayerNameKeydown(event)
{
  if(event.key !== "Enter") return;

  event.preventDefault();

  const joinButton =
    document.getElementById("joinButton");

  if(!joinButton.disabled)
  {
    joinRoom();
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

  let playerName =
    document
    .getElementById("playerName")
    .value
    .trim();

  const status =
    document.getElementById("status");

  // MODO BOT: parâmetros da URL, ou nome digitado com prefixo "bot:"
  // (ex.: "bot:Bia" entra como bot=auto com o nome "Bia").

  const botParams = ReadBotParams();

  if(playerName.toLowerCase().startsWith("bot:"))
  {
    playerName = playerName.slice(4).trim();

    if(!botParams.bot) botParams.bot = "auto";
  }

  // VALIDATIONS

  if(roomCode.length < 4)
  {
    status.innerText =
      "Código inválido";

    return;
  }

  if(playerName.length < 1)
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
    // CHECK IF FIRST PLAYER (HOST)

    const playersSnapshot =
      await get(
        ref(db, `rooms/${roomCode}/players`)
      );

    const isHost =
      !playersSnapshot.exists() ||
      Object.keys(playersSnapshot.val() ?? {}).length === 0;

    // ADD PLAYER

    await set(
      ref(
        db,
        `rooms/${roomCode}/players/${playerId}`
      ),
      {
        name: playerName,
        isHost: isHost
      }
    );

    console.log("Jogador conectado!");

    // REDIRECT

    const gameUrl =
      BuildGameUrl(detectedGameMode, roomCode, playerName, playerId, botParams);

    if(gameUrl)
    {
      window.location.href = gameUrl;
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
// PREFILL ROOM CODE FROM URL
// (used when joining via QR code, e.g. ?room=ABCD)
// =========================

function PrefillRoomFromUrl()
{
  const params =
    new URLSearchParams(window.location.search);

  const roomFromUrl =
    params.get("room");

  if(!roomFromUrl) return;

  const roomCodeInput =
    document.getElementById("roomCode");

  roomCodeInput.value =
    roomFromUrl
    .toUpperCase()
    .trim()
    .slice(0, 4);

  CheckRoomCode();

  document
    .getElementById("playerName")
    .focus();
}

PrefillRoomFromUrl();


// =========================
// GLOBAL EXPORTS
// =========================

window.CheckRoomCode =
  CheckRoomCode;

window.HandleRoomCodeKeydown =
  HandleRoomCodeKeydown;

window.HandlePlayerNameKeydown =
  HandlePlayerNameKeydown;


// =========================
// MODO BOT (só carrega com ?bot=… na URL — ver bot/README.md)
// =========================

if(new URLSearchParams(window.location.search).has("bot"))
{
  import("./bot/bot.js")
    .then((bot) => bot.RunEntry())
    .catch((error) => console.error("[Z3Bot]", error));
}