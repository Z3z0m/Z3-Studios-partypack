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
const currentPlayerName = params.get("name");
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

    // DEBATE / VOTING

    if(stage == "ChaosDebate")
    {
      OpenDebate();
    }

    // RESULT

    if(stage == "Result")
    {
      OpenResult();
    }
  });
}
// =========================
// OPEN SHOW PLAYERS
// =========================

async function OpenShowPlayers()
{
  // HIDE OTHER SCREENS

  HideAllScreens();

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
// =========================
// HIDE ALL SCREENS
// =========================

function HideAllScreens()
{
  document.getElementById("avatarGrid").style.display = "none";
  document.getElementById("showPlayersScreen").style.display = "none";
  document.getElementById("defenseRoleScreen").style.display = "none";
  document.getElementById("prosecutionRoleScreen").style.display = "none";
  document.getElementById("votingScreen").style.display = "none";
  document.getElementById("resultScreen").style.display = "none";
}


// =========================
// FETCH CURRENT ROUND
// =========================

async function fetchCurrentRound()
{
  const snapshot =
    await get(
      ref(
        db,
        `rooms/${currentRoomCode}/currentState/round`
      )
    );

  return snapshot.exists() ? snapshot.val() : 0;
}


// =========================
// OPEN DEBATE
// =========================

async function OpenDebate()
{
  HideAllScreens();

  const data =
    await fetchCurrentCourtData();

  if(data == null)
  {
    return;
  }

  const defendant = data.defendant;
  const defense = data.defense;
  const prosecution = data.prosecution;
  const crime = data.crime;

  // DEFENSE LAWYER

  if(currentPlayerId == defense.id)
  {
    document
      .getElementById("defenseRoleCrime")
      .innerText = crime;

    document
      .getElementById("defenseRoleTitle")
      .innerText =
        `Defenda ${defendant.name}`;

    document
      .getElementById("defenseRoleScreen")
      .style.display = "flex";

    return;
  }

  // PROSECUTION LAWYER

  if(currentPlayerId == prosecution.id)
  {
    document
      .getElementById("prosecutionRoleCrime")
      .innerText = crime;

    document
      .getElementById("prosecutionRoleTitle")
      .innerText =
        `Acuse ${defendant.name}`;

    document
      .getElementById("prosecutionRoleScreen")
      .style.display = "flex";

    return;
  }

  // EVERYONE ELSE VOTES

  OpenVotingScreen(defense.id, prosecution.id);
}


// =========================
// OPEN VOTING SCREEN
// =========================

async function OpenVotingScreen(defenseId, prosecutionId)
{
  document
    .getElementById("votingScreen")
    .style.display = "flex";

  const round =
    await fetchCurrentRound();

  const innocentButton =
    document.getElementById("innocentButton");

  const guiltyButton =
    document.getElementById("guiltyButton");

  // RESTORE PREVIOUS VOTE

  const myVoteSnapshot =
    await get(
      ref(
        db,
        `rooms/${currentRoomCode}/history/round_${round}/votes/${currentPlayerId}`
      )
    );

  UpdateVoteButtons(
    myVoteSnapshot.exists() ? myVoteSnapshot.val().vote : null
  );

  // VOTE HANDLERS

  innocentButton.onclick =
    () => CastVote(round, "innocent", defenseId, prosecutionId);

  guiltyButton.onclick =
    () => CastVote(round, "guilty", defenseId, prosecutionId);
}

function UpdateVoteButtons(myVote)
{
  document
    .getElementById("innocentButton")
    .classList.toggle("selected", myVote == "innocent");

  document
    .getElementById("guiltyButton")
    .classList.toggle("selected", myVote == "guilty");
}


// =========================
// CAST VOTE
// =========================

async function CastVote(round, vote, defenseId, prosecutionId)
{
  UpdateVoteButtons(vote);

  await set(
    ref(
      db,
      `rooms/${currentRoomCode}/history/round_${round}/votes/${currentPlayerId}`
    ),
    {
      playerName: currentPlayerName,
      vote: vote
    }
  );

  await CheckVotingComplete(round, defenseId, prosecutionId);
}


// =========================
// CHECK IF EVERYONE VOTED
// =========================

async function CheckVotingComplete(round, defenseId, prosecutionId)
{
  const playersSnapshot =
    await get(
      ref(db, `rooms/${currentRoomCode}/players`)
    );

  if(!playersSnapshot.exists())
  {
    return;
  }

  const eligibleVoterIds =
    Object.keys(playersSnapshot.val())
      .filter(id => id != defenseId && id != prosecutionId);

  const votesSnapshot =
    await get(
      ref(
        db,
        `rooms/${currentRoomCode}/history/round_${round}/votes`
      )
    );

  const votes =
    votesSnapshot.exists() ? votesSnapshot.val() : {};

  const allVoted =
    eligibleVoterIds.every(id => votes[id] != null);

  if(!allVoted)
  {
    return;
  }

  // TALLY VOTES

  let innocentCount = 0;
  let guiltyCount = 0;

  Object.values(votes).forEach((entry) =>
  {
    if(entry.vote == "innocent")
    {
      innocentCount++;
    }
    else if(entry.vote == "guilty")
    {
      guiltyCount++;
    }
  });

  const verdict =
    guiltyCount > innocentCount
      ? "guilty"
      : innocentCount > guiltyCount
        ? "innocent"
        : "tie";

  // SAVE RESULT

  await set(
    ref(db, `rooms/${currentRoomCode}/currentState/voteResult`),
    {
      innocentCount: innocentCount,
      guiltyCount: guiltyCount,
      verdict: verdict
    }
  );

  // GO TO RESULT STAGE

  await set(
    ref(db, `rooms/${currentRoomCode}/currentState/stage`),
    "Result"
  );
}


// =========================
// OPEN RESULT
// =========================

async function OpenResult()
{
  HideAllScreens();

  document
    .getElementById("resultScreen")
    .style.display = "flex";

  const snapshot =
    await get(
      ref(db, `rooms/${currentRoomCode}/currentState/voteResult`)
    );

  if(!snapshot.exists())
  {
    return;
  }

  const result =
    snapshot.val();

  document
    .getElementById("innocentCount")
    .innerText = result.innocentCount;

  document
    .getElementById("guiltyCount")
    .innerText = result.guiltyCount;

  const verdictLabels =
  {
    guilty: "CULPADO",
    innocent: "INOCENTE",
    tie: "EMPATE"
  };

  document
    .getElementById("verdictText")
    .innerText =
      verdictLabels[result.verdict] ?? "";
}
