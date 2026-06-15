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

let selectedGuessX = -1;
let selectedGuessY = -1;
let isHost = false;


// =========================
// AVATARS
// =========================

const avatars =
[
    "bege",
    "black",
    "blue",

    "metal",
    "orange",
    "pink",

    "red",
    "silver",
    "yellow"
];


// =========================
// RENDER
// =========================

window.onload = async function()
{
  RenderAvatars();
  ListenForTakenAvatars();
  await CheckIfHost();
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
    `imgs/${avatarName}.png`;

    div.appendChild(img);

    div.onclick = () =>
    {
      SelectAvatar(div, avatarName);
    };

    grid.appendChild(div);
  });
}


// =========================
// TAKEN AVATARS LISTENER
// =========================

function ListenForTakenAvatars()
{
  onValue(
    ref(db, `rooms/${currentRoomCode}/players`),
    (snapshot) =>
    {
      const players = snapshot.val() || {};
      const taken = new Set();

      Object.entries(players).forEach(([playerId, data]) =>
      {
        if (playerId !== currentPlayerId && data.avatar)
          taken.add(data.avatar);
      });

      UpdateAvatarAvailability(taken);
    }
  );
}

function UpdateAvatarAvailability(taken)
{
  document.querySelectorAll(".avatarItem").forEach((item) =>
  {
    const avatarName = item.dataset.avatar;
    const isTaken = taken.has(avatarName);

    if (isTaken)
    {
      item.classList.add("taken");
      item.onclick = null;
    }
    else
    {
      item.classList.remove("taken");
      item.onclick = () => SelectAvatar(item, avatarName);
    }
  });
}


// =========================
// SELECT
// =========================

async function SelectAvatar(element, avatarName)
{
  if (element.classList.contains("taken"))
    return;

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

    const btn =
        document.getElementById("hostButton");

    const hidden =
        state === "GiveHint" ||
        state === "GuessColor" ||
        state === "Tutorial";

    if (hidden)
    {
        btn.style.display = "none";
        return;
    }

    btn.style.display = "block";

    const labels =
    {
        "Lobby":       "Começar Jogo",
        "RoundResult": "Ver Placar",
        "RoundScore":  "Próxima Rodada",
        "FinalResult": "Encerrar Jogo",
    };

    btn.innerText =
        labels[state] ?? "Próxima Etapa";
}

async function ListenForStage()
{
    onValue(
        ref(
            db,
            `rooms/${currentRoomCode}/currentState`
        ),
        async(snapshot)=>
        {
            if(!snapshot.exists())
                return;

            const state =
                snapshot.val().gameState;

            UpdateHostButton(state);

            if(state === "Tutorial")
            {
                OpenTutorial();
            }

            if(state === "GiveHint")
            {
                OpenGiveHint();
            }

            if(state === "GuessColor")
            {
                OpenGuessColor();
            }

            if(state === "RoundResult")
            {
                OpenRoundResult();
            }

            if(state === "RoundScore")
            {
                OpenRoundScore();
            }
        });
}

async function OpenGiveHint()
{
    HideAllScreens();

    document
        .getElementById("hintInput")
        .value = "";

    document
        .getElementById("sendHintButton")
        .disabled = false;

    document
        .getElementById("sendHintButton")
        .innerText =
        "Enviar Dica";

    const hinterSnapshot =
        await get(
            ref(
                db,
                `rooms/${currentRoomCode}/currentHinter`
            )
        );

    const hinter =
        hinterSnapshot.val();

    if(hinter.PlayerId === currentPlayerId)
    {
        document
            .getElementById("hintScreen")
            .style.display =
            "flex";

        const secretSnapshot =
            await get(
                ref(
                    db,
                    `rooms/${currentRoomCode}/secretColor`
                )
            );

        const color =
            secretSnapshot.val();

        const r =
            Math.round(color.r * 255);

        const g =
            Math.round(color.g * 255);

        const b =
            Math.round(color.b * 255);

        const rgb =
            `rgb(${r},${g},${b})`;

        document
            .getElementById("myColorPreview")
            .style.background =
            rgb;

        document
            .getElementById("myColorTitle")
            .style.color =
            rgb;
    }
    else
    {
        document
            .getElementById("waitingHintScreen")
            .style.display =
            "flex";

        document
            .getElementById("hintWaitingText")
            .innerHTML =
            `Esperando ${GetColoredPlayerName(
                hinter.PlayerName,
                hinter.ColorName
            )} escrever a dica...`;
    }

    document
      .getElementById("sendHintButton")
      .onclick =
    async () =>
  {
      const hint =
          document
          .getElementById("hintInput")
          .value
          .trim();

      if(hint.length < 2)
          return;

      await set(
        ref(
            db,
            `rooms/${currentRoomCode}/currentHint`
        ),
        hint
    );

    document
        .getElementById("sendHintButton")
        .disabled = true;

    document
        .getElementById("sendHintButton")
        .innerText =
        "Dica enviada!";
        
    };
}

function GetColorHex(colorName)
{
    switch(colorName)
    {
        case "Red": return "#ff4d4d";
        case "Blue": return "#4dc3ff";
        case "Orange": return "#ff9f43";
        case "Yellow": return "#ffd93d";
        case "Pink": return "#ff66cc";
        case "Silver": return "#d0d0d0";
        case "Black": return "#666666";
        case "Metal": return "#8ea0a8";
        case "Bege": return "#d8c3a5";
    }
    return "white";
}

function GetColoredPlayerName(PlayerName,ColorName)
{
    return `
    <span style="
        color:${GetColorHex(ColorName)};
        font-weight:bold;
    ">
        ${PlayerName}
    </span>`;
}

function GenerateGuessGrid()
{
    const grid =
        document.getElementById(
            "guessGrid"
        );

    grid.innerHTML = "";

    const width = 12;
    const height = 6;

    const rowProfiles =
    [
        { sat: 0.15, val: 1.00 },
        { sat: 0.40, val: 1.00 },
        { sat: 0.70, val: 1.00 },
        { sat: 1.00, val: 1.00 },
        { sat: 1.00, val: 0.60 },
        { sat: 1.00, val: 0.30 },
    ];

    for(let y=0;y<height;y++)
    {
        for(let x=0;x<width;x++)
        {
            const cell =
                document.createElement("div");

            cell.className =
                "guessCell";

            const hue =
                x / width;

            const { sat, val } =
                rowProfiles[y];

            const rgb =
                HSVtoRGB(
                    hue,
                    sat,
                    val
                );

            cell.style.background =
                rgb;

            cell.onclick =
              () =>
              {
                  document
                      .querySelectorAll(".guessCell")
                      .forEach(
                          c => c.classList.remove("selected")
                      );

                  cell.classList.add("selected");

                  selectedGuessX = x;
                  selectedGuessY = y;
              };

            grid.appendChild(cell);
        }
    }
}

function HSVtoRGB(h,s,v)
{
    let f =
        (n,k=(n+h*6)%6)=>
        v-v*s*Math.max(
            Math.min(k,4-k,1),
            0
        );

    return `rgb(
        ${Math.round(f(5)*255)},
        ${Math.round(f(3)*255)},
        ${Math.round(f(1)*255)}
    )`;
}

async function SubmitGuess(x,y)
{
    await set(
        ref(
            db,
            `rooms/${currentRoomCode}/guesses/${currentPlayerId}`
        ),
        {
            x:x,
            y:y
        }
    );

}

async function OpenGuessColor()
{
    document
        .getElementById("confirmGuessButton")
        .disabled = false;

    document
        .getElementById("confirmGuessButton")
        .innerText =
        "Confirmar Escolha";

    const hinterSnapshot =
        await get(
                ref(
                    db,
                    `rooms/${currentRoomCode}/currentHinter`
                )
            );

    const hinter = hinterSnapshot.val();
    if(hinter.PlayerId === currentPlayerId)
    {
        HideAllScreens();

        document.getElementById("waitingGuessScreen").style.display = "flex";

        return;
    }

    
    if(hinter.PlayerId === currentPlayerId)
    {
        document
            .getElementById("waitingGuessScreen")
            .style.display =
            "flex";

        return;
    }  
    HideAllScreens();
    document
        .getElementById("guessScreen")
        .style.display =
        "flex";

    const hintSnapshot =
        await get(
            ref(
                db,
                `rooms/${currentRoomCode}/currentHint`
            )
        );

    if(hintSnapshot.exists())
    {
        document
          .getElementById("guessHintText")
          .innerText =
          `A dica é "${hintSnapshot.val()}"`;
    }

    selectedGuessX = -1;
    selectedGuessY = -1;

    GenerateGuessGrid();

    document
        .getElementById("confirmGuessButton")
        .onclick =
    async () =>
    {
        if(
            selectedGuessX < 0 ||
            selectedGuessY < 0
        )
        {
            alert(
                "Escolha uma cor primeiro."
            );

            return;
        }

        await SubmitGuess(
            selectedGuessX,
            selectedGuessY
        );

        document
            .getElementById("confirmGuessButton")
            .innerText =
            "Escolha enviada!";
    };
}

function OpenRoundResult()
{
    HideAllScreens();

    document
        .getElementById("roundResultScreen")
        .style.display =
        "flex";
}

function OpenTutorial()
{
    HideAllScreens();

    document
        .getElementById("tutorialScreen")
        .style.display =
        "flex";

    if (isHost)
    {
        document
            .getElementById("tutorialControls")
            .style.display =
            "flex";
    }
}

async function OpenRoundScore()
{
    HideAllScreens();

    const list =
        document.getElementById("scoreList");

    list.innerHTML = "";

    const snapshot =
        await get(
            ref(db, `rooms/${currentRoomCode}/players`)
        );

    if (!snapshot.exists())
        return;

    const players =
        Object.values(snapshot.val());

    players.sort((a, b) => (b.score || 0) - (a.score || 0));

    players.forEach((player) =>
    {
        const card =
            document.createElement("div");

        card.className = "scoreCard";

        const img =
            document.createElement("img");

        img.src =
            `imgs/${player.avatar}.png`;

        const name =
            document.createElement("span");

        name.className = "scoreCardName";
        name.textContent = player.name;

        const pts =
            document.createElement("span");

        pts.className = "scoreCardPoints";
        pts.textContent = `${player.score || 0} pts`;

        card.appendChild(img);
        card.appendChild(name);
        card.appendChild(pts);

        list.appendChild(card);
    });

    document
        .getElementById("roundScoreScreen")
        .style.display =
        "flex";
}

function HideAllScreens()
{
    document.getElementById("LobbyScreen").style.display = "none";
    document.getElementById("tutorialScreen").style.display = "none";
    document.getElementById("tutorialControls").style.display = "none";
    document.getElementById("roundResultScreen").style.display = "none";
    document.getElementById("roundScoreScreen").style.display = "none";
    document.getElementById("hintScreen").style.display = "none";
    document.getElementById("waitingHintScreen").style.display = "none";
    document.getElementById("guessScreen").style.display = "none";
    document.getElementById("waitingGuessScreen").style.display = "none";
}