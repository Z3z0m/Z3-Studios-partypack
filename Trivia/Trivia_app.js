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

const params =
  new URLSearchParams(window.location.search);

const currentRoomCode =
  params.get("room");

const currentPlayerId =
  params.get("id");

let alreadyAnswered = false;


// =========================
// SCREEN SYSTEM
// =========================

function ShowScreen(screenId)
{
    document
        .querySelectorAll(".screen")
        .forEach(s =>
        {
            s.classList.remove("active");
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
    ListenForQuestion();
};


// =========================
// LISTEN GAME STATE
// =========================

function ListenForGameState()
{
    onValue(
        ref(
            db,
            `rooms/${currentRoomCode}/currentState/gameState`
        ),
        (snapshot) =>
        {
            const state = snapshot.val();
            if (!state) return;

            if (state === "Lobby")
            {
                ShowScreen("lobbyScreen");
            }

            if (state === "Question")
            {
                alreadyAnswered = false;
                ResetAnswerButtons();
                ShowScreen("questionScreen");
            }

            if (state === "Result")
            {
                ShowScreen("resultScreen");
            }

            if (state === "Scoreboard")
            {
                OpenScoreboard();
                ShowScreen("scoreboardScreen");
            }

            if (state === "FinalScore")
            {
                OpenFinalScore();
                ShowScreen("finalScoreScreen");
            }
        }
    );
}


// =========================
// LISTEN FOR QUESTION
// =========================

function ListenForQuestion()
{
    onValue(
        ref(
            db,
            `rooms/${currentRoomCode}/currentState`
        ),
        (snapshot) =>
        {
            if (!snapshot.exists()) return;

            const data = snapshot.val();

            if (data.question)
            {
                document
                    .getElementById("questionText")
                    .innerText = data.question;
            }

            if (data.answers)
            {
                const labels = ["A", "B", "C", "D"];

                const buttons =
                    document.querySelectorAll(".answerButton");

                Object.entries(data.answers).forEach(([index, text]) =>
                {
                    const i = parseInt(index);
                    if (buttons[i])
                        buttons[i].innerText =
                            `${labels[i]}. ${text}`;
                });
            }

            if (data.round != null)
            {
                document
                    .getElementById("roundText")
                    .innerText =
                    `Pergunta ${data.round}`;
            }
        }
    );
}


// =========================
// ANSWER QUESTION
// =========================

window.AnswerQuestion = async function(index)
{
    if (alreadyAnswered) return;

    alreadyAnswered = true;

    document
        .querySelectorAll(".answerButton")
        .forEach((btn, i) =>
        {
            btn.disabled = true;

            if (i === index)
                btn.classList.add("selected");
            else
                btn.classList.add("dimmed");
        });

    document
        .getElementById("waitingAnswerText")
        .innerText =
        "Aguardando outros jogadores...";

    const roundSnapshot = await get(
        ref(
            db,
            `rooms/${currentRoomCode}/currentState/round`
        )
    );

    const round = roundSnapshot.val();

    await set(
        ref(
            db,
            `rooms/${currentRoomCode}/history/round_${round}/answers/${currentPlayerId}`
        ),
        { answerIndex: index }
    );
};


// =========================
// RESET ANSWERS
// =========================

function ResetAnswerButtons()
{
    document
        .querySelectorAll(".answerButton")
        .forEach(btn =>
        {
            btn.disabled = false;
            btn.classList.remove("selected", "dimmed");
        });

    const waitingText =
        document.getElementById("waitingAnswerText");

    if (waitingText)
        waitingText.innerText = "";
}


// =========================
// SCOREBOARD
// =========================

async function OpenScoreboard()
{
    const snapshot = await get(
        ref(db, `rooms/${currentRoomCode}/players`)
    );

    if (!snapshot.exists()) return;

    const players =
        Object.values(snapshot.val());

    players.sort((a, b) => (b.score || 0) - (a.score || 0));

    const list =
        document.getElementById("scoreList");

    list.innerHTML = "";

    players.forEach((player) =>
    {
        const card =
            document.createElement("div");

        card.className = "scoreCard";

        const img = document.createElement("img");
        img.src = `imgs/${player.avatar || "bege"}.png`;

        const name = document.createElement("span");
        name.className = "scoreCardName";
        name.textContent = player.name;

        const pts = document.createElement("span");
        pts.className = "scoreCardPoints";
        pts.textContent = `${player.score || 0} pts`;

        card.appendChild(img);
        card.appendChild(name);
        card.appendChild(pts);

        list.appendChild(card);
    });
}


// =========================
// FINAL SCORE
// =========================

async function OpenFinalScore()
{
    const snapshot = await get(
        ref(db, `rooms/${currentRoomCode}/players`)
    );

    if (!snapshot.exists()) return;

    const players =
        Object.values(snapshot.val());

    players.sort((a, b) => (b.score || 0) - (a.score || 0));

    const list =
        document.getElementById("finalList");

    list.innerHTML = "";

    players.forEach((player, i) =>
    {
        const card =
            document.createElement("div");

        card.className = "scoreCard";

        const rank = document.createElement("span");
        rank.className = "scoreCardRank";
        rank.textContent = `#${i + 1}`;

        const img = document.createElement("img");
        img.src = `imgs/${player.avatar || "bege"}.png`;

        const name = document.createElement("span");
        name.className = "scoreCardName";
        name.textContent = player.name;

        const pts = document.createElement("span");
        pts.className = "scoreCardPoints";
        pts.textContent = `${player.score || 0} pts`;

        card.appendChild(rank);
        card.appendChild(img);
        card.appendChild(name);
        card.appendChild(pts);

        list.appendChild(card);
    });
}
