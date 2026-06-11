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

            if(state === "GiveHint")
            {
                OpenGiveHint();
            }
            
            if(state === "GuessColor")
            {
                OpenGuessColor();
            }
        });
}

async function OpenGiveHint()
{
    HideAllScreens();

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

            const saturation =
                1 - (
                    (1 - 0.25)
                    *
                    (y / (height - 1))
                );

            const rgb =
                HSVtoRGB(
                    hue,
                    saturation,
                    1
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

function HideAllScreens()
{
    document.getElementById("LobbyScreen").style.display = "none";
    document.getElementById("hintScreen").style.display = "none";
    document.getElementById("waitingHintScreen").style.display = "none";
    document.getElementById("guessScreen").style.display = "none";
    document.getElementById("waitingGuessScreen").style.display = "none";
}