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
let isHost = false;
let isGamePaused = false;

// Quem sou eu: último currentState/whoAmI recebido + rodada, e qual
// afirmativa ("rodada:afirmativa") este celular já chutou / já desenhou.
let whoAmIData = null;
let stateRound = null;
let whoAmISubmittedKey = null;
let whoAmIRenderedKey = null;

// Complete a frase: último currentState/fillBlank + qual rodada este celular já chutou.
let fillBlankData = null;
let fillBlankSubmittedRound = null;
let fillBlankRenderedRound = null;

// Qual é o número: último currentState/number, último seq enviado nesta
// rodada (cada chute sobe o seq; o host ignora seq repetido).
let numberData = null;
let numberSentSeq = 0;
let numberSeqRound = null;
let numberRenderedKey = null;


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

window.onload = async function()
{
    await CheckIfHost();
    ListenForGameState();
    ListenForQuestion();
    ListenForPause();
};


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
// HOST
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
        "Lobby":      "Começar Jogo",
        "FinalScore": "Jogar de Novo",
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

            UpdateHostButton(state);

            if (state === "Lobby")
            {
                // "Jogar de Novo" recomeça a contagem de rodadas
                whoAmISubmittedKey = null;
                whoAmIRenderedKey = null;
                fillBlankSubmittedRound = null;
                fillBlankRenderedRound = null;
                numberSentSeq = 0;
                numberSeqRound = null;
                numberRenderedKey = null;
                ShowScreen("lobbyScreen");
            }

            if (state === "Tutorial")
            {
                ShowScreen("tutorialScreen");

                document
                    .getElementById("tutorialControls")
                    .style.display =
                    isHost ? "flex" : "none";
            }

            if (state === "Question")
            {
                alreadyAnswered = false;
                ResetAnswerButtons();
                ShowScreen("questionScreen");
            }

            if (state === "Result")
            {
                ShowScreen("questionScreen");

                document
                    .getElementById("waitingAnswerText")
                    .innerText =
                    "Resposta enviada! Aguardando o resultado...";
            }

            if (state === "WhoAmI")
            {
                ShowScreen("whoAmIScreen");
                RenderWhoAmI();
            }

            if (state === "FillBlank")
            {
                ShowScreen("fillBlankScreen");
                RenderFillBlank();
            }

            if (state === "Number")
            {
                ShowScreen("numberScreen");
                RenderNumber();
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
                const buttons =
                    document.querySelectorAll(".answerButton");

                Object.entries(data.answers).forEach(([index, text]) =>
                {
                    const i = parseInt(index);
                    if (!buttons[i]) return;

                    const label =
                        buttons[i].querySelector(".answerLabel");

                    if (label)
                        label.textContent = text;
                    else
                        buttons[i].textContent = text;
                });
            }

            if (data.round != null)
            {
                document
                    .getElementById("roundText")
                    .innerText =
                    `Rodada ${data.round}`;
            }

            whoAmIData = data.whoAmI || null;
            stateRound = data.round;

            if (data.gameState === "WhoAmI")
                RenderWhoAmI();

            fillBlankData = data.fillBlank || null;

            if (data.gameState === "FillBlank")
                RenderFillBlank();

            numberData = data.number || null;

            if (data.gameState === "Number")
                RenderNumber();
        }
    );
}


// =========================
// ANSWER QUESTION
// =========================

window.AnswerQuestion = async function(index)
{
    if (isGamePaused) return;
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
// QUEM SOU EU
// =========================

function RenderWhoAmI()
{
    const d = whoAmIData;
    if (!d) return;

    const clues = d.clues ? Object.values(d.clues) : [];
    const clueIndex = d.clueIndex ?? 0;
    const clueCount = d.clueCount ?? clues.length;
    const isReveal = d.phase === "reveal";
    const key = `${stateRound}:${clueIndex}`;

    document
        .getElementById("whoAmICounter")
        .innerText =
        isReveal ? "Revelação" : `Afirmativa ${clueIndex + 1}/${clueCount}`;

    const list = document.getElementById("whoAmIClues");
    list.innerHTML = "";

    clues.forEach((text, i) =>
    {
        const li = document.createElement("li");
        if (i === clueIndex || isReveal) li.classList.add("current");

        const number = document.createElement("span");
        number.className = "clueNumber";
        number.textContent = i + 1;

        const label = document.createElement("span");
        label.textContent = text;

        li.appendChild(number);
        li.appendChild(label);
        list.appendChild(li);
    });

    const input = document.getElementById("whoAmIInput");
    const submit = document.getElementById("whoAmISubmit");
    const status = document.getElementById("whoAmIStatus");

    // afirmativa nova: campo limpo pra quem ainda não acertou
    if (key !== whoAmIRenderedKey)
    {
        whoAmIRenderedKey = key;
        input.value = "";
    }

    const verdict = d.verdicts ? d.verdicts[currentPlayerId] : null;
    const gotIt = verdict && verdict.correct === true;
    const lastClue = clueIndex >= clueCount - 1;

    let canGuess = false;
    let message = "";
    let messageClass = "";

    if (isReveal)
    {
        message = `Eu sou: ${d.answer || "?"}` + (gotIt ? ` · +${verdict.points}` : "");
        messageClass = "reveal";
    }
    else if (gotIt)
    {
        message = `Acertou! +${verdict.points} · aguarde os outros`;
        messageClass = "correct";
    }
    else if (verdict && verdict.clue === clueIndex)
    {
        message = lastClue
            ? "Errou! Aguarde a revelação..."
            : "Errou! Tente de novo na próxima afirmativa";
    }
    else if (whoAmISubmittedKey === key)
    {
        message = "Chute enviado! Aguardando...";
    }
    else
    {
        canGuess = true;
    }

    input.disabled = !canGuess;
    submit.disabled = !canGuess;

    status.innerText = message;
    status.className = messageClass;
}

window.SubmitWhoAmIGuess = async function(event)
{
    event.preventDefault();

    if (isGamePaused) return;

    const d = whoAmIData;
    if (!d || d.phase === "reveal") return;

    const input = document.getElementById("whoAmIInput");
    const guess = input.value.trim();
    if (!guess) return;

    const clueIndex = d.clueIndex ?? 0;
    const round = stateRound;
    const key = `${round}:${clueIndex}`;

    // um chute por afirmativa
    if (whoAmISubmittedKey === key) return;
    whoAmISubmittedKey = key;

    input.blur();
    RenderWhoAmI();

    await set(
        ref(
            db,
            `rooms/${currentRoomCode}/history/round_${round}/clue_${clueIndex}/answers/${currentPlayerId}`
        ),
        { guess: guess }
    );
};


// =========================
// COMPLETE A FRASE
// =========================

function RenderFillBlank()
{
    const d = fillBlankData;
    if (!d) return;

    const isReveal = d.phase === "reveal";
    const round = stateRound;

    // frase montada com textContent (o texto vem do Firebase), lacuna destacada
    const phraseEl = document.getElementById("fillBlankPhrase");
    phraseEl.innerHTML = "";

    const parts = (d.phrase || "").split("___");
    parts.forEach((part, i) =>
    {
        phraseEl.appendChild(document.createTextNode(part));

        if (i < parts.length - 1)
        {
            const blank = document.createElement("span");
            blank.className = "blank";
            blank.textContent = isReveal ? (d.answer || "?") : "______";
            phraseEl.appendChild(blank);
        }
    });

    const input = document.getElementById("fillBlankInput");
    const submit = document.getElementById("fillBlankSubmit");
    const status = document.getElementById("fillBlankStatus");

    // rodada nova: campo limpo
    if (round !== fillBlankRenderedRound)
    {
        fillBlankRenderedRound = round;
        input.value = "";
    }

    const verdict = d.verdicts ? d.verdicts[currentPlayerId] : null;
    const gotIt = verdict && verdict.correct === true;

    let canGuess = false;
    let message = "";
    let messageClass = "";

    if (isReveal)
    {
        message = gotIt ? `Acertou! +${verdict.points}` : `Resposta: ${d.answer || "?"}`;
        messageClass = "reveal";
    }
    else if (gotIt)
    {
        message = `Acertou! +${verdict.points} · aguarde os outros`;
        messageClass = "correct";
    }
    else if (verdict)
    {
        message = "Errou! Aguarde a revelação...";
    }
    else if (fillBlankSubmittedRound === round)
    {
        message = "Resposta enviada! Aguardando...";
    }
    else
    {
        canGuess = true;
    }

    input.disabled = !canGuess;
    submit.disabled = !canGuess;

    status.innerText = message;
    status.className = messageClass;
}

window.SubmitFillBlankGuess = async function(event)
{
    event.preventDefault();

    if (isGamePaused) return;

    const d = fillBlankData;
    if (!d || d.phase === "reveal") return;

    const input = document.getElementById("fillBlankInput");
    const guess = input.value.trim();
    if (!guess) return;

    const round = stateRound;

    // um chute só
    if (fillBlankSubmittedRound === round) return;
    fillBlankSubmittedRound = round;

    input.blur();
    RenderFillBlank();

    await set(
        ref(
            db,
            `rooms/${currentRoomCode}/history/round_${round}/fillBlank/answers/${currentPlayerId}`
        ),
        { guess: guess }
    );
};


// =========================
// QUAL É O NÚMERO
// =========================

// mesmos valores padrão do TriviaGameManager.Number.cs (o host manda os pontos reais no veredito)
const NumberFirstTryPoints = 250;
const NumberBasePoints = 200;
const NumberMissPenalty = 20;
const NumberMinPoints = 20;

function NumberPointsForAttempt(attempt)
{
    if (attempt <= 1) return NumberFirstTryPoints;
    return Math.max(NumberMinPoints, NumberBasePoints - NumberMissPenalty * (attempt - 1));
}

function RenderNumber()
{
    const d = numberData;
    if (!d) return;

    const round = stateRound;
    if (numberSeqRound !== round)
    {
        numberSeqRound = round;
        numberSentSeq = 0;
    }

    const me = d.players ? d.players[currentPlayerId] : null;
    const min = me ? me.min : d.min;
    const max = me ? me.max : d.max;
    const attempts = me ? me.attempts : 0;
    const ackSeq = me ? me.seq : 0;
    const gotIt = me && me.correct === true;
    const isReveal = d.phase === "reveal";
    const waiting = numberSentSeq > ackSeq;

    document.getElementById("numberQuestion").innerText = d.question || "";
    document.getElementById("numberMin").innerText = min;
    document.getElementById("numberMax").innerText = max;

    document
        .getElementById("numberCounter")
        .innerText =
        isReveal || gotIt
            ? `${attempts} chute${attempts === 1 ? "" : "s"}`
            : `Chute ${attempts + 1} · vale ${NumberPointsForAttempt(attempts + 1)}`;

    // feedback do último chute
    let feedback = "";
    if (me && !gotIt)
    {
        if (me.last === "higher") feedback = `É MAIOR que ${me.lastGuess} ↑`;
        else if (me.last === "lower") feedback = `É MENOR que ${me.lastGuess} ↓`;
        else if (me.last === "invalid") feedback = "Fora do intervalo!";
    }
    document.getElementById("numberFeedback").innerText = feedback;

    const input = document.getElementById("numberInput");
    const submit = document.getElementById("numberSubmit");
    const status = document.getElementById("numberStatus");

    input.min = min;
    input.max = max;

    // veredito novo chegou: campo limpo pro próximo chute
    const key = `${round}:${ackSeq}`;
    if (key !== numberRenderedKey)
    {
        numberRenderedKey = key;
        input.value = "";
    }

    let canGuess = false;
    let message = "";
    let messageClass = "";

    if (isReveal)
    {
        message = gotIt ? `Acertou! +${me.points} · Resposta: ${d.answer}` : `Resposta: ${d.answer || "?"}`;
        messageClass = "reveal";
    }
    else if (gotIt)
    {
        message = `Acertou em ${attempts} chute${attempts === 1 ? "" : "s"}! +${me.points}`;
        messageClass = "correct";
    }
    else if (waiting)
    {
        message = "Conferindo...";
    }
    else
    {
        canGuess = true;
    }

    // esperando o veredito: só o botão trava — desabilitar o campo fecharia o
    // teclado do celular a cada chute
    input.disabled = !canGuess && !waiting;
    submit.disabled = !canGuess;

    status.innerText = message;
    status.className = messageClass;
}

window.SubmitNumberGuess = async function(event)
{
    event.preventDefault();

    if (isGamePaused) return;

    const d = numberData;
    if (!d || d.phase === "reveal") return;

    const me = d.players ? d.players[currentPlayerId] : null;
    if (me && me.correct) return;

    const ackSeq = me ? me.seq : 0;
    if (numberSentSeq > ackSeq) return; // esperando o veredito do chute anterior

    const input = document.getElementById("numberInput");
    const text = input.value.trim();
    if (!/^[0-9]+$/.test(text)) return; // só números inteiros

    const value = parseInt(text, 10);
    const min = me ? me.min : d.min;
    const max = me ? me.max : d.max;

    if (value < min || value > max)
    {
        document.getElementById("numberFeedback").innerText = `O número está entre ${min} e ${max}!`;
        return;
    }

    const round = stateRound;
    numberSentSeq = ackSeq + 1;
    RenderNumber();

    await set(
        ref(
            db,
            `rooms/${currentRoomCode}/history/round_${round}/number/guesses/${currentPlayerId}`
        ),
        { value: value, seq: numberSentSeq }
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
