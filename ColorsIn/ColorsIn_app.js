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
let isGamePaused = false;
let currentSecretColor = null;

// rooms/{code}/sabotage inteiro ({ offer, request, active }) e rooms/{code}/players
let sabotageNode = null;
let latestPlayers = {};
let sabotagePanelRound = -1;
let selectedSabotageType = null;
let selectedSabotageTarget = null;


// =========================
// GUESS GRID LAYOUT
// =========================

const GUESS_GRID_WIDTH = 12;
const GUESS_GRID_HEIGHT = 6;

const rowProfiles =
[
    { sat: 0.15, val: 1.00 },
    { sat: 0.40, val: 1.00 },
    { sat: 0.70, val: 1.00 },
    { sat: 1.00, val: 1.00 },
    { sat: 1.00, val: 0.60 },
    { sat: 1.00, val: 0.30 },
];


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
  // Sem ?room=&id= na URL (ex: abrindo o arquivo direto pelo Live Server,
  // fora do fluxo real de entrada na sala) todo listener fica ouvindo um
  // caminho tipo "rooms/undefined/..." que nunca existe — a página carrega
  // (fundo aparece) mas nenhuma tela liga, dando a impressão de página em
  // branco. Aqui a gente entrega um aviso claro em vez de ficar mudo.
  if (!currentRoomCode || !currentPlayerId)
  {
      document.body.innerHTML =
        `<div style="padding:40px;text-align:center;color:#F4EBDA;font-family:Rubik,sans-serif;">
            Link inválido — falta "room" e/ou "id" na URL.<br>
            Entre pelo QR code/lobby do jogo em vez de abrir esta página direto.
        </div>`;

      return;
  }

  RenderAvatars();
  ListenForTakenAvatars();
  await CheckIfHost();
  ListenForStage();
  ListenForPause();
  ListenForSabotage();
  SetupContextModal();
  SetupHintCounter();
};


// =========================
// HINT CHARACTER COUNTER (visual only)
// =========================

function UpdateHintCounter()
{
    const input = document.getElementById("hintInput");
    const counter = document.getElementById("hintCounter");

    if (!input || !counter) return;

    counter.textContent = `${input.value.length} / 60`;
}

function SetupHintCounter()
{
    const input = document.getElementById("hintInput");
    if (!input) return;

    input.addEventListener("input", UpdateHintCounter);
    UpdateHintCounter();
}


// =========================
// COLOR CONTEXT MODAL
// =========================

function SetupContextModal()
{
    document
        .getElementById("viewContextButton")
        .onclick =
    () =>
    {
        if(!currentSecretColor) return;

        RenderColorContext(currentSecretColor);

        document
            .getElementById("contextModal")
            .classList.add("active");
    };

    document
        .getElementById("closeContextButton")
        .onclick =
    () =>
    {
        document
            .getElementById("contextModal")
            .classList.remove("active");
    };
}

function FindClosestGridCell(r,g,b)
{
    let closest =
        { x: 0, y: 0, dist: Infinity };

    for(let y=0;y<GUESS_GRID_HEIGHT;y++)
    {
        const { sat, val } = rowProfiles[y];

        for(let x=0;x<GUESS_GRID_WIDTH;x++)
        {
            const hue = x / GUESS_GRID_WIDTH;

            const cellRgb =
                HSVtoRGBValues(hue, sat, val);

            const dist =
                (cellRgb.r - r) ** 2 +
                (cellRgb.g - g) ** 2 +
                (cellRgb.b - b) ** 2;

            if(dist < closest.dist)
                closest = { x, y, dist };
        }
    }

    return closest;
}

const CONTEXT_RADIUS_X = 2;
const CONTEXT_RADIUS_Y = 1;

function RenderColorContext(secretColor)
{
    const r = Math.round(secretColor.r * 255);
    const g = Math.round(secretColor.g * 255);
    const b = Math.round(secretColor.b * 255);

    const { x: centerX, y: centerY } =
        FindClosestGridCell(r, g, b);

    const grid =
        document.getElementById("contextGrid");

    grid.innerHTML = "";

    const columns =
        CONTEXT_RADIUS_X * 2 + 1;

    grid.style.gridTemplateColumns =
        `repeat(${columns}, 1fr)`;

    for(let dy=-CONTEXT_RADIUS_Y; dy<=CONTEXT_RADIUS_Y; dy++)
    {
        const y = centerY + dy;
        const isOutOfBounds = y < 0 || y >= GUESS_GRID_HEIGHT;

        for(let dx=-CONTEXT_RADIUS_X; dx<=CONTEXT_RADIUS_X; dx++)
        {
            const cell =
                document.createElement("div");

            cell.className = "contextCell";

            if(isOutOfBounds)
            {
                cell.classList.add("contextCellEmpty");
                grid.appendChild(cell);
                continue;
            }

            const x =
                ((centerX + dx) % GUESS_GRID_WIDTH + GUESS_GRID_WIDTH) %
                GUESS_GRID_WIDTH;

            const isCenter =
                dx === 0 && dy === 0;

            if(isCenter)
            {
                cell.style.background =
                    `rgb(${r},${g},${b})`;

                cell.classList.add("contextCellCenter");
            }
            else
            {
                const { sat, val } = rowProfiles[y];
                const hue = x / GUESS_GRID_WIDTH;

                cell.style.background =
                    HSVtoRGB(hue, sat, val);
            }

            grid.appendChild(cell);
        }
    }
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
// RENDER AVATARS
// =========================

function RenderAvatars()
{
  const grid =
    document.getElementById("avatarGrid");

  console.log(
    "[ColorsIn] RenderAvatars: grid element =",
    grid,
    "| avatares a desenhar =",
    avatars
  );

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

    img.onerror = () =>
    {
      console.error(
        "[ColorsIn] falha ao carregar avatar:",
        img.src
      );
    };

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

      latestPlayers = players;
      RenderSabotagePanel();

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

    const btn = document.getElementById("hostButton");

    // Host só controla o início (Lobby) e o "jogar de novo" (final).
    // O resto do jogo avança sozinho; o tutorial tem botões próprios.
    const labels =
    {
        "Lobby":       "Começar Jogo",
        "FinalResult": "Jogar de Novo",
    };

    const label = labels[state];

    if (!label)
    {
        btn.style.display = "none";
        return;
    }

    btn.style.display = "block";
    btn.innerText = label;
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
            console.log(
                "[ColorsIn] rooms/" + currentRoomCode + "/currentState =",
                snapshot.exists() ? snapshot.val() : "(não existe no Firebase)"
            );

            if(!snapshot.exists())
                return;

            const state =
                snapshot.val().gameState;

            UpdateHostButton(state);

            if(state === "Lobby")
            {
                OpenLobby();
            }

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

            if(state === "FinalResult")
            {
                OpenFinalResult();
            }

            if(state === "ContinueVote")
            {
                OpenContinueVote();
            }
        });
}

async function OpenGiveHint()
{
    HideAllScreens();

    document
        .getElementById("hintInput")
        .value = "";

    UpdateHintCounter();

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

    if(hinter.playerId === currentPlayerId)
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

        currentSecretColor = color;

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
        currentSecretColor = null;

        document
            .getElementById("waitingHintScreen")
            .style.display =
            "flex";

        document
            .getElementById("hintWaitingText")
            .innerHTML =
            `Esperando ${GetColoredPlayerName(
                hinter.playerName || "alguém",
                hinter.colorName
            )} escrever a dica...`;

        RenderSabotagePanel();
    }

    document
      .getElementById("sendHintButton")
      .onclick =
    async () =>
  {
      if(isGamePaused) return;

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
        case "red": return "#ff4d4d";
        case "blue": return "#4dc3ff";
        case "orange": return "#ff9f43";
        case "yellow": return "#ffd93d";
        case "pink": return "#ff66cc";
        case "silver": return "#d0d0d0";
        case "black": return "#666666";
        case "metal": return "#8ea0a8";
        case "bege": return "#d8c3a5";
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

// activeSabotage: sabotage/active quando o alvo sou eu, senão null
function GenerateGuessGrid(activeSabotage)
{
    const grid =
        document.getElementById(
            "guessGrid"
        );

    grid.innerHTML = "";

    const cells = [];

    for(let y=0;y<GUESS_GRID_HEIGHT;y++)
    {
        for(let x=0;x<GUESS_GRID_WIDTH;x++)
        {
            const cell =
                document.createElement("div");

            cell.className =
                "guessCell";

            const hue =
                x / GUESS_GRID_WIDTH;

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

            cells.push(cell);
            grid.appendChild(cell);
        }
    }

    const sabotage =
        activeSabotage ? SABOTAGES[activeSabotage.type] : null;

    if(sabotage && sabotage.applyToGuessGrid)
        sabotage.applyToGuessGrid(grid, cells, activeSabotage.seed);
}

function HSVtoRGBValues(h,s,v)
{
    let f =
        (n,k=(n+h*6)%6)=>
        v-v*s*Math.max(
            Math.min(k,4-k,1),
            0
        );

    return {
        r: Math.round(f(5)*255),
        g: Math.round(f(3)*255),
        b: Math.round(f(1)*255)
    };
}

function HSVtoRGB(h,s,v)
{
    const { r, g, b } =
        HSVtoRGBValues(h,s,v);

    return `rgb(${r},${g},${b})`;
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
    if(hinter.playerId === currentPlayerId)
    {
        HideAllScreens();

        document.getElementById("waitingGuessScreen").style.display = "flex";

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

    // a Unity grava sabotage/active ainda no GiveHint, antes de mudar o gameState
    const sabotageSnapshot =
        await get(
            ref(
                db,
                `rooms/${currentRoomCode}/sabotage/active`
            )
        );

    const activeSabotage =
        sabotageSnapshot.exists() &&
        sabotageSnapshot.val().target === currentPlayerId &&
        SABOTAGES[sabotageSnapshot.val().type]
            ? sabotageSnapshot.val()
            : null;

    const banner =
        document.getElementById("sabotagedBanner");

    banner.style.display = activeSabotage ? "block" : "none";
    banner.innerText =
        activeSabotage ? SABOTAGES[activeSabotage.type].victimMessage : "";

    GenerateGuessGrid(activeSabotage);

    document
        .getElementById("confirmGuessButton")
        .onclick =
    async () =>
    {
        if(isGamePaused) return;

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

function OpenLobby()
{
    HideAllScreens();

    document
        .getElementById("LobbyScreen")
        .style.display =
        "flex";
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

// =========================
// SABOTAGEM DO UNDERDOG
// Unity grava rooms/{code}/sabotage/offer no GiveHint (quem é o lanterninha
// e os alvos válidos de cada sabotagem). O lanterninha grava
// sabotage/request; a Unity valida e grava sabotage/active, que o celular
// do alvo aplica no GuessColor. A tela grande não muda nada.
// Nova sabotagem: mesma chave do Id em ColorsInSabotage.cs (Unity).
// =========================

const SABOTAGES =
{
    shuffle:
    {
        label: "🌀 Embaralhar",
        description: "As cores da grade do alvo ficam todas fora de lugar nesta rodada.",
        victimMessage: "🌀 Você foi sabotado! Suas cores foram embaralhadas.",

        // sorteia a posição de cada célula na grade inteira. As células são as
        // mesmas da grade normal (já guardam o x/y real no onclick), então só
        // muda o lugar na tela — o voto continua valendo a cor tocada.
        applyToGuessGrid(grid, cells, seed)
        {
            const random = SeededRandom(seed);

            // appendChild de um nó que já está na grade só move ele pro fim
            ShuffledIndexes(cells.length, random)
                .forEach(index => grid.appendChild(cells[index]));
        }
    }
};

// mesma semente = mesma grade, mesmo se o celular recarregar no meio
function SeededRandom(seed)
{
    let a = seed >>> 0;

    return function()
    {
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// [0..count-1] embaralhado; nunca devolve a ordem original, senão a
// sabotagem passaria em branco
function ShuffledIndexes(count, random)
{
    const order = [...Array(count).keys()];

    for(let i = count - 1; i > 0; i--)
    {
        const j = Math.floor(random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
    }

    if(count > 1 && order.every((value, index) => value === index))
        order.push(order.shift());

    return order;
}

// Firebase devolve lista como array ou como objeto {"0":..,"1":..}
function AsArray(value)
{
    if(!value) return [];
    return Array.isArray(value) ? value : Object.values(value);
}

function ListenForSabotage()
{
    onValue(
        ref(db, `rooms/${currentRoomCode}/sabotage`),
        (snapshot) =>
        {
            sabotageNode = snapshot.val();
            RenderSabotagePanel();
        }
    );
}

function RenderSabotagePanel()
{
    const panel = document.getElementById("sabotagePanel");
    const offer = sabotageNode ? sabotageNode.offer : null;

    const waitingForHint =
        document.getElementById("waitingHintScreen").style.display === "flex";

    if(!offer || offer.underdogId !== currentPlayerId || !waitingForHint)
    {
        panel.style.display = "none";
        return;
    }

    panel.style.display = "flex";

    // round novo: zera a escolha anterior
    if(offer.round !== sabotagePanelRound)
    {
        sabotagePanelRound = offer.round;
        selectedSabotageType = null;
        selectedSabotageTarget = null;
    }

    const options =
        AsArray(offer.options).filter(o => SABOTAGES[o.type]);

    const typesRow = document.getElementById("sabotageTypes");
    const targetsRow = document.getElementById("sabotageTargets");
    const description = document.getElementById("sabotageDescription");
    const confirmButton = document.getElementById("sabotageConfirmButton");
    const status = document.getElementById("sabotageStatus");

    typesRow.innerHTML = "";
    targetsRow.innerHTML = "";

    const active = sabotageNode.active;

    if(active && active.round === offer.round)
    {
        const victim = latestPlayers[active.target];

        panel.classList.add("used");
        description.innerText = "";
        confirmButton.style.display = "none";
        status.innerText =
            `Sabotagem feita em ${victim ? victim.name : "alguém"}! 😈`;

        return;
    }

    panel.classList.remove("used");
    confirmButton.style.display = "block";

    if(options.length === 0)
    {
        panel.style.display = "none";
        return;
    }

    if(!options.some(o => o.type === selectedSabotageType))
    {
        selectedSabotageType = options[0].type;
        selectedSabotageTarget = null;
    }

    options.forEach((option) =>
    {
        const button = document.createElement("button");

        button.className = "sabotageTypeButton";
        button.classList.toggle("selected", option.type === selectedSabotageType);
        button.innerText = SABOTAGES[option.type].label;

        button.onclick = () =>
        {
            selectedSabotageType = option.type;
            selectedSabotageTarget = null;
            RenderSabotagePanel();
        };

        typesRow.appendChild(button);
    });

    description.innerText =
        SABOTAGES[selectedSabotageType].description;

    const selectedOption =
        options.find(o => o.type === selectedSabotageType);

    const targets = AsArray(selectedOption.targets);

    if(!targets.includes(selectedSabotageTarget))
        selectedSabotageTarget = null;

    targets.forEach((targetId) =>
    {
        const player = latestPlayers[targetId];
        if(!player) return;

        const button = document.createElement("button");

        button.className = "sabotageTarget";
        button.classList.toggle("selected", targetId === selectedSabotageTarget);

        const img = document.createElement("img");
        img.src = `imgs/${player.avatar}.png`;

        const name = document.createElement("span");
        name.textContent = player.name;

        button.appendChild(img);
        button.appendChild(name);

        button.onclick = () =>
        {
            selectedSabotageTarget = targetId;
            RenderSabotagePanel();
        };

        targetsRow.appendChild(button);
    });

    const request = sabotageNode.request;
    const waitingConfirm =
        request && request.round === offer.round && request.by === currentPlayerId;

    confirmButton.disabled = !selectedSabotageTarget || waitingConfirm;
    confirmButton.innerText = waitingConfirm ? "Enviando..." : "Sabotar";

    status.innerText =
        selectedSabotageTarget ? "" : "Escolha quem vai sofrer.";
}

window.SubmitSabotage = async function()
{
    if(isGamePaused) return;

    const offer = sabotageNode ? sabotageNode.offer : null;

    if(!offer || !selectedSabotageType || !selectedSabotageTarget)
        return;

    await set(
        ref(db, `rooms/${currentRoomCode}/sabotage/request`),
        {
            by: currentPlayerId,
            type: selectedSabotageType,
            target: selectedSabotageTarget,
            round: offer.round,
            t: Date.now()
        }
    );
};

// =========================
// VOTAÇÃO "DESEJA CONTINUAR?"
// Unity lê rooms/{code}/continueVotes/{playerId} = true/false;
// maioria estrita de "sim" = mais um ciclo de dicas.
// =========================

async function OpenContinueVote()
{
    HideAllScreens();

    document
        .getElementById("continueVoteScreen")
        .style.display =
        "flex";

    // se o celular recarregou no meio da votação, mostra o voto que já foi dado
    const voteSnapshot =
        await get(
            ref(
                db,
                `rooms/${currentRoomCode}/continueVotes/${currentPlayerId}`
            )
        );

    UpdateContinueVoteUI(
        voteSnapshot.exists() ? voteSnapshot.val() : null
    );
}

window.SubmitContinueVote = async function(wantsToContinue)
{
    if(isGamePaused) return;

    await set(
        ref(
            db,
            `rooms/${currentRoomCode}/continueVotes/${currentPlayerId}`
        ),
        wantsToContinue
    );

    UpdateContinueVoteUI(wantsToContinue);
};

function UpdateContinueVoteUI(vote)
{
    const yesBtn = document.getElementById("continueYesButton");
    const noBtn = document.getElementById("continueNoButton");
    const status = document.getElementById("continueVoteStatus");

    yesBtn.classList.toggle("selected", vote === true);
    noBtn.classList.toggle("selected", vote === false);

    if(vote === null)
        status.innerText = "";
    else
        status.innerText =
            (vote ? "Você votou SIM." : "Você votou NÃO.") +
            " Toque na outra opção para mudar.";
}

function HideAllScreens()
{
    document
        .getElementById("contextModal")
        .classList.remove("active");

    document.getElementById("LobbyScreen").style.display = "none";
    document.getElementById("tutorialScreen").style.display = "none";
    document.getElementById("tutorialControls").style.display = "none";
    document.getElementById("roundResultScreen").style.display = "none";
    document.getElementById("roundScoreScreen").style.display = "none";
    document.getElementById("hintScreen").style.display = "none";
    document.getElementById("waitingHintScreen").style.display = "none";
    document.getElementById("guessScreen").style.display = "none";
    document.getElementById("waitingGuessScreen").style.display = "none";
    document.getElementById("finalResultScreen").style.display = "none";
    document.getElementById("continueVoteScreen").style.display = "none";
}

async function OpenFinalResult()
{
    HideAllScreens();

    const list =
        document.getElementById("finalScoreList");

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
        .getElementById("finalResultScreen")
        .style.display =
        "flex";
}