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

const app =
  initializeApp(firebaseConfig);

const db =
  getDatabase(app);

// =========================
// URL PARAMS
// =========================

const params = new URLSearchParams(window.location.search);
const currentRoomCode = params.get("room");
const currentPlayerId = params.get("id");
let selectedAvatar = "0";


// =========================
// AVATARS
// =========================

const avatars = [];
  for(let i = 0; i < 16; i++)
  {
    avatars.push(`${i}.png`);
  }


// =========================
// RENDER
// =========================

window.onload = function()
{
  RenderAvatars();
  ListenForStage();
};


// =========================
// RENDER AVATARS
// =========================

function RenderAvatars()
{
  const grid =
    document.getElementById("avatarGrid");

  avatars.forEach((avatarName) =>
  {
    const div =
      document.createElement("div");

    div.className = "avatarItem";

    div.dataset.avatar = avatarName;

    const img =
      document.createElement("img");

    img.src =
      `imgs/${avatarName}`;

    div.appendChild(img);

    div.onclick = () =>
    {
      SelectAvatar(div, avatarName);
    };

    grid.appendChild(div);
  });
}


// =========================
// SELECT
// =========================

async function SelectAvatar(element, avatarName)
{
  // REMOVE OLD

  document
    .querySelectorAll(".avatarItem")
    .forEach(item => {item.classList.remove("selected");});

  // SELECT NEW

  element.classList.add("selected");
  selectedAvatar = avatarName.replace(".png", "");

  console.log("Avatar selecionado:",avatarName);

  // FUTURO:
    await set(
    ref(
      db,
      `rooms/${currentRoomCode}/players/${currentPlayerId}/avatar`
    ),
    selectedAvatar
  );
  // salvar firebase
}
// =========================
// STAGE LISTENER
// =========================

function ListenForStage()
{
  const stageRef =
    ref(
      db,
      `rooms/${currentRoomCode}/currentState/stage`
    );

  onValue(stageRef, async(snapshot) =>
  {
    if(!snapshot.exists())
    {
      return;
    }

    const stage =
      snapshot.val();

    console.log("Stage:", stage);

    // SHOW PLAYERS

    if(stage == "ShowPlayers")
    {
      OpenShowPlayers();
    }
  });
}
// =========================
// OPEN SHOW PLAYERS
// =========================

async function OpenShowPlayers()
{
  // HIDE AVATAR SELECT

  document
    .getElementById("avatarGrid")
    .style.display = "none";

  // SHOW SCREEN

  document
    .getElementById("showPlayersScreen")
    .style.display = "flex";

  // GET DATA

  const snapshot =
    await fetchCurrentCourtData();

  if(snapshot == null)
  {
    return;
  }

  // DATA

  const defendant =
    snapshot.defendant;

  const defense =
    snapshot.defense;

  const prosecution =
    snapshot.prosecution;

  const crime =
    snapshot.crime;

  // DEFENDANT

  document
    .getElementById("crimeText")
    .innerText = crime;

  document
    .getElementById("defendantImage")
    .src =
      `imgs/${defendant.avatar}.png`;

  // WAIT

  await Delay(2000);

  // DEFENSE

  document
    .getElementById("defenseImage")
    .src =
      `imgs/${defense.avatar}.png`;

  document
    .getElementById("defenseName")
    .innerText =
      defense.name;

  document
    .getElementById("defenseContainer")
    .style.left = "80px";

  // WAIT

  await Delay(2000);

  // PROSECUTION

  document
    .getElementById("prosecutionImage")
    .src =
      `imgs/${prosecution.avatar}.png`;

  document
    .getElementById("prosecutionName")
    .innerText =
      prosecution.name;

  document
    .getElementById("prosecutionContainer")
    .style.right = "80px";
}
function Delay(ms)
{
  return new Promise(resolve =>
  {
    setTimeout(resolve, ms);
  });
}
async function fetchCurrentCourtData()
{
  const snapshot =
    await get(
      ref(
        db,
        `rooms/${currentRoomCode}/currentState/showPlayersData`
      )
    );

  if(!snapshot.exists())
  {
    return null;
  }

  return snapshot.val();
}
