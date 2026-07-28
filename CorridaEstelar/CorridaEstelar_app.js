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
// URL PARAMS
// =========================

const params =
  new URLSearchParams(window.location.search);

const currentRoomCode =
  params.get("room");

const currentPlayerName =
  params.get("name");

const currentPlayerId =
  params.get("id");


// =========================
// RÓTULOS (feedback de rejeição — nunca usar nome comercial em texto nenhum)
// =========================

const TurnRejectedReasonLabels = {
  "not-your-turn": "Ainda não é a vez da sua equipe (ou do seu papel).",
  "invalid-clue": "Pista inválida — escreva uma palavra e um número de 0 a 9.",
  "invalid-tile": "Essa palavra já foi revelada ou não existe.",
  "unknown-action": "Ação desconhecida."
};

function LabelForStartRejected(reason)
{
  if(reason === "not-enough-players") return "Precisa de pelo menos 4 jogadores pra começar.";

  if(reason && reason.startsWith("team-too-small:"))
  {
    const team = reason.split(":")[1];
    return `Equipe ${TeamDisplayName(team)} precisa de pelo menos 2 jogadores.`;
  }

  if(reason && reason.startsWith("missing-explorer:"))
  {
    const team = reason.split(":")[1];
    return `Equipe ${TeamDisplayName(team)} precisa de um Explorador.`;
  }

  return "Não foi possível começar o jogo.";
}

function TeamDisplayName(team)
{
  return team === "Solar" ? "Equipe Solar" : team === "Lunar" ? "Equipe Lunar" : "???";
}


// =========================
// GAME STATE
// =========================

let currentGameState = "Lobby";
let isHost = false;
let isGamePaused = false;
let countdownInterval = null;

let rosterData = {};      // playerId -> {name, team, role, score}
let myTeam = null;
let myRole = null;

let teamsData = {};       // "Solar"/"Lunar" -> {name, memberIds, explorerId}
let gridData = [];        // 25 {word, revealed, revealedAsTeam}
let secretMapData = null; // {index: team} — só existe quando myRole === "Explorador" (ver UpdateExplorerAccess)

let currentTeamTurn = null;
let turnPhase = null;
let currentClue = null;
let guessesRemaining = 0;

let secretMapUnsubscribe = null;
let gridUnsubscribe = null;
let turnMetaUnsubscribes = [];
let turnRejectedUnsubscribe = null;

let lobbyToastTimeout = null;
let rejectedTimeout = null;


// =========================
// SCREEN SYSTEM
// =========================

function ShowScreen(screenId)
{
  document
    .querySelectorAll(".screen")
    .forEach(screen =>
    {
      screen.classList.remove("active");
    });

  document
    .getElementById(screenId)
    .classList.add("active");
}


// =========================
// ENTER KEY SUBMIT
// =========================

window.HandleEnterKey = function(event, callback)
{
  if(event.key !== "Enter") return;

  event.preventDefault();

  callback();
};


// =========================
// START
// =========================

window.onload = function()
{
  ListenForGameState();
  ListenForVisibilityRecovery();
  ListenForRoster();
  ListenForRoleRejected();
  ListenForStartRejected();
  CheckIfHost();
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
// HOST CONTROLS (botão único: começar / forçar fim da fase / jogar de novo)
// =========================

async function CheckIfHost()
{
  const snapshot =
    await get(ref(db, `rooms/${currentRoomCode}/players/${currentPlayerId}/isHost`));

  isHost = snapshot.val() === true;

  if(isHost)
  {
    UpdateHostButton(currentGameState);
  }
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
  if(!isHost) return;

  const btn = document.getElementById("hostButton");

  // ESCONDE no Tutorial — lá a navegação é feita pelos botões próprios da
  // tela (SendTutorialAction), não pelo botão genérico de host.
  if(state === "Tutorial")
  {
    btn.style.display = "none";
    return;
  }

  btn.style.display = "block";

  const labels =
  {
    "Lobby":      "Começar Jogo",
    "Playing":    "Forçar Fim da Fase",
    "Result":     "Pular Etapa",
    "FinalScore": "Jogar de Novo",
  };

  btn.innerText =
    labels[state] ?? "Pular Etapa";
}


// =========================
// LISTEN GAME STATE
// =========================

let gameStateUnsubscribe = null;

function ListenForGameState()
{
  if(gameStateUnsubscribe)
  {
    gameStateUnsubscribe();
    gameStateUnsubscribe = null;
  }

  const stateRef =
    ref(db, `rooms/${currentRoomCode}/currentState/gameState`);

  gameStateUnsubscribe = onValue(stateRef, (snapshot) =>
  {
    ApplyGameState(snapshot.val());
  });
}


// =========================
// RECUPERA SINCRONIA AO VOLTAR O FOCO NA ABA (mesmo padrão de MauMau_app.js)
// =========================

function ListenForVisibilityRecovery()
{
  document.addEventListener("visibilitychange", () =>
  {
    if(document.visibilityState !== "visible") return;

    console.log("[CorridaEstelar] Aba voltou ao foco — ressincronizando listener de estado.");

    ListenForGameState();
  });
}


// =========================
// APPLY GAME STATE
// =========================

function ApplyGameState(gameState)
{
  if(!gameState || gameState === currentGameState)
  {
    return;
  }

  currentGameState = gameState;

  StopCountdown();
  UpdateHostButton(gameState);

  if(gameState == "Lobby") { ShowScreen("lobbyScreen"); RenderLobbyRoster(); }

  if(gameState == "Tutorial")
  {
    ShowScreen("tutorialScreen");

    document
      .getElementById("tutorialControls")
      .style.display =
      isHost ? "flex" : "none";
  }

  if(gameState == "Playing")
  {
    ShowScreen("playingScreen");
    OpenPlaying();
  }

  if(gameState == "Result")
  {
    ShowScreen("resultScreen");
    OpenResult();
  }

  if(gameState == "FinalScore")
  {
    ShowScreen("finalScoreScreen");
    OpenFinalScore();
  }
}


// =========================
// COUNTDOWN (número + anel circular)
// =========================

function StartCountdown(seconds, textElementId, ringElementId)
{
  StopCountdown();

  const total = seconds || 1;
  let remaining = Math.round(seconds);

  const textEl = document.getElementById(textElementId);
  const ringEl = ringElementId ? document.getElementById(ringElementId) : null;

  function applyRing()
  {
    if(!ringEl) return;

    const deg = Math.max(0, Math.round((remaining / total) * 360));
    ringEl.style.background = `conic-gradient(#7fd8ff ${deg}deg, rgba(255,255,255,.18) 0deg)`;
  }

  function tick()
  {
    if(textEl) textEl.innerText = `${remaining}`;
    applyRing();

    if(isGamePaused) return;

    if(remaining <= 0)
    {
      StopCountdown();
      return;
    }

    remaining--;
  }

  tick();

  countdownInterval = setInterval(tick, 1000);
}

function StopCountdown()
{
  if(countdownInterval)
  {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
}


// =========================
// LOBBY: ROSTER + ESCOLHA DE TIME/PAPEL
// =========================

function ListenForRoster()
{
  onValue(
    ref(db, `rooms/${currentRoomCode}/players`),
    (snapshot) =>
    {
      rosterData = {};

      if(snapshot.exists())
      {
        snapshot.forEach((child) =>
        {
          rosterData[child.key] = child.val();
        });
      }

      const me = rosterData[currentPlayerId] || {};
      const previousRole = myRole;

      myTeam = me.team || null;
      myRole = me.role || null;

      UpdateExplorerAccess(previousRole);

      if(currentGameState === "Lobby") RenderLobbyRoster();
      if(currentGameState === "Playing") RefreshPlayingUI();
    }
  );
}

// SÓ ASSINA "secretMap" quando o PRÓPRIO papel é Explorador — e desassina na
// hora se o papel mudar (ex.: perdeu a corrida de reivindicação pro host via
// ReconcileRoles). Sem regra de segurança no servidor: é convenção de
// código, mesmo espírito do "hand" do MauMau — mas aqui reage a QUALQUER
// mudança de papel, não só uma checagem única no início.
function UpdateExplorerAccess(previousRole)
{
  const isExplorerNow = myRole === "Explorador";

  if(isExplorerNow && !secretMapUnsubscribe)
  {
    secretMapUnsubscribe = onValue(
      ref(db, `rooms/${currentRoomCode}/secretMap`),
      (snapshot) =>
      {
        secretMapData = snapshot.exists() ? snapshot.val() : null;
        RefreshPlayingUI();
      }
    );
  }
  else if(!isExplorerNow && secretMapUnsubscribe)
  {
    secretMapUnsubscribe();
    secretMapUnsubscribe = null;
    secretMapData = null;
  }
}

window.SelectTeam = async function(team)
{
  await set(ref(db, `rooms/${currentRoomCode}/players/${currentPlayerId}/team`), team);

  if(!myRole)
  {
    await set(ref(db, `rooms/${currentRoomCode}/players/${currentPlayerId}/role`), "Observador");
  }
};

window.ToggleExplorer = async function()
{
  if(myRole === "Explorador")
  {
    await set(ref(db, `rooms/${currentRoomCode}/players/${currentPlayerId}/role`), "Observador");
    return;
  }

  await set(ref(db, `rooms/${currentRoomCode}/players/${currentPlayerId}/role`), "Explorador");
  await set(ref(db, `rooms/${currentRoomCode}/players/${currentPlayerId}/roleClaimedAt`), Date.now());
};

function RenderLobbyRoster()
{
  const solarBtn = document.getElementById("teamSolarBtn");
  const lunarBtn = document.getElementById("teamLunarBtn");

  if(solarBtn) solarBtn.classList.toggle("selected", myTeam === "Solar");
  if(lunarBtn) lunarBtn.classList.toggle("selected", myTeam === "Lunar");

  const explorerBtn = document.getElementById("explorerToggleBtn");

  if(explorerBtn)
  {
    explorerBtn.style.display = myTeam ? "block" : "none";
    explorerBtn.innerText = myRole === "Explorador" ? "Virar Observador" : "Virar Explorador";
    explorerBtn.classList.toggle("selected", myRole === "Explorador");
  }

  const rosterDiv = document.getElementById("lobbyRoster");
  if(!rosterDiv) return;

  rosterDiv.innerHTML = "";

  Object.keys(rosterData).forEach((id) =>
  {
    const p = rosterData[id];
    if(!p || !p.name) return;

    const item = document.createElement("div");
    item.className = "rosterItem" + (id === currentPlayerId ? " rosterItemSelf" : "");

    const teamLabel = p.team === "Solar" ? "Solar" : p.team === "Lunar" ? "Lunar" : "sem time";
    const roleLabel = p.role === "Explorador" ? "Explorador" : p.role === "Observador" ? "Observador" : "-";

    item.innerText = `${p.name} — ${teamLabel} (${roleLabel})`;
    rosterDiv.appendChild(item);
  });
}

function ListenForRoleRejected()
{
  onValue(
    ref(db, `rooms/${currentRoomCode}/players/${currentPlayerId}/roleRejected`),
    (snapshot) =>
    {
      if(!snapshot.exists()) return;

      ShowLobbyToast("Alguém já reivindicou o papel de Explorador nessa equipe — você virou Observador.");
    }
  );
}

function ListenForStartRejected()
{
  onValue(
    ref(db, `rooms/${currentRoomCode}/currentState/startRejected`),
    (snapshot) =>
    {
      if(!snapshot.exists()) return;

      const data = snapshot.val();
      ShowLobbyToast(LabelForStartRejected(data.reason));
    }
  );
}

function ShowLobbyToast(message)
{
  const el = document.getElementById("startRejectedText");
  if(!el) return;

  el.innerText = message;
  el.classList.add("active");

  clearTimeout(lobbyToastTimeout);
  lobbyToastTimeout = setTimeout(() => el.classList.remove("active"), 3200);
}


// =========================
// OPEN PLAYING
// =========================

async function OpenPlaying()
{
  if(gridUnsubscribe) { gridUnsubscribe(); gridUnsubscribe = null; }
  turnMetaUnsubscribes.forEach((unsub) => unsub());
  turnMetaUnsubscribes = [];
  if(turnRejectedUnsubscribe) { turnRejectedUnsubscribe(); turnRejectedUnsubscribe = null; }

  const teamsSnapshot = await get(ref(db, `rooms/${currentRoomCode}/teams`));
  teamsData = teamsSnapshot.exists() ? teamsSnapshot.val() : {};

  gridUnsubscribe = onValue(
    ref(db, `rooms/${currentRoomCode}/grid`),
    (snapshot) =>
    {
      gridData = snapshot.exists() ? Object.values(snapshot.val()) : [];
      RefreshPlayingUI();
    }
  );

  // CAMPOS PÚBLICOS de currentState — assinados um por um (não o nó inteiro)
  // pra nunca correr risco de puxar "secretMap" ou qualquer coisa sensível
  // junto (aqui nem existiria, já que secretMap mora fora de currentState,
  // mas mantém o hábito de granularidade mínima por segurança).
  ["currentTeam", "turnPhase", "currentClue", "guessesRemainingThisTurn", "turnDuration"].forEach((field) =>
  {
    const unsub = onValue(
      ref(db, `rooms/${currentRoomCode}/currentState/${field}`),
      (snapshot) =>
      {
        ApplyTurnField(field, snapshot.exists() ? snapshot.val() : null);
      }
    );

    turnMetaUnsubscribes.push(unsub);
  });

  turnRejectedUnsubscribe = onValue(
    ref(db, `rooms/${currentRoomCode}/currentState/turnRejected`),
    (snapshot) =>
    {
      if(!snapshot.exists()) return;

      const data = snapshot.val();
      if(data.playerId !== currentPlayerId) return;

      ShowRejectedToast(data.reason);
    }
  );
}

function ApplyTurnField(field, value)
{
  if(field === "currentTeam") currentTeamTurn = value;
  else if(field === "turnPhase") turnPhase = value;
  else if(field === "currentClue") currentClue = value;
  else if(field === "guessesRemainingThisTurn") guessesRemaining = value || 0;
  else if(field === "turnDuration" && value) StartCountdown(value, "turnCountdown", "timerRing");

  RefreshPlayingUI();
}

function RefreshPlayingUI()
{
  if(currentGameState !== "Playing") return;

  const isMyTurnToClue = myTeam && myTeam === currentTeamTurn && myRole === "Explorador" && turnPhase === "GivingClue";
  const isMyTurnToGuess = myTeam && myTeam === currentTeamTurn && myRole === "Observador" && turnPhase === "Guessing";

  const bannerEl = document.getElementById("turnBannerText");

  if(bannerEl)
  {
    const teamLabel = TeamDisplayName(currentTeamTurn);

    if(isMyTurnToClue) bannerEl.innerText = "SUA VEZ — mande a pista pra sua equipe!";
    else if(isMyTurnToGuess) bannerEl.innerText = `SUA VEZ — aponte palavras (${guessesRemaining} palpite(s) restante(s))`;
    else if(turnPhase === "GivingClue") bannerEl.innerText = `${teamLabel} — Explorador está dando a pista...`;
    else bannerEl.innerText = `${teamLabel} — Observadores estão apontando...`;
  }

  const clueEl = document.getElementById("clueDisplayText");
  if(clueEl)
  {
    clueEl.innerText = currentClue ? `Pista: "${currentClue.word}" (${currentClue.number})` : "";
  }

  const clueForm = document.getElementById("clueForm");
  if(clueForm) clueForm.style.display = isMyTurnToClue ? "flex" : "none";

  const guessControls = document.getElementById("guessControls");
  if(guessControls) guessControls.style.display = isMyTurnToGuess ? "flex" : "none";

  const guessesText = document.getElementById("guessesRemainingText");
  if(guessesText) guessesText.innerText = `Palpites restantes: ${guessesRemaining}`;

  BuildGrid(isMyTurnToGuess);
}

function BuildGrid(isMyTurnToGuess)
{
  const container = document.getElementById("starGrid");
  if(!container) return;

  container.innerHTML = "";

  gridData.forEach((tile, index) =>
  {
    const cell = document.createElement("button");
    cell.className = "starTile " + TileColorClass(tile, index);
    cell.innerText = tile ? (tile.word || "") : "";
    cell.disabled = !tile || tile.revealed || !isMyTurnToGuess;
    cell.onclick = () => SubmitGuess(index);

    container.appendChild(cell);
  });
}

function TileColorClass(tile, index)
{
  if(!tile) return "tile-hidden";

  if(tile.revealed)
  {
    return "tile-" + (tile.revealedAsTeam || "Neutral").toLowerCase();
  }

  // EXPLORADOR VÊ A CLASSIFICAÇÃO SECRETA mesmo antes de revelada —
  // secretMapData só existe quando o próprio papel é Explorador (ver
  // UpdateExplorerAccess), então isso nunca vaza pra Observadores.
  if(secretMapData)
  {
    const team = secretMapData[String(index)];
    return "tile-secret-" + (team || "neutral").toLowerCase();
  }

  return "tile-hidden";
}

window.SubmitClue = async function()
{
  const wordInput = document.getElementById("clueWordInput");
  const numberInput = document.getElementById("clueNumberInput");

  const word = wordInput.value.trim();
  const number = parseInt(numberInput.value, 10);

  if(!word || isNaN(number)) return;

  await SendTurnAction({ type: "clue", word, number });

  wordInput.value = "";
  numberInput.value = "";
};

window.SubmitGuess = async function(tileIndex)
{
  await SendTurnAction({ type: "guess", tileIndex });
};

window.PassTurn = async function()
{
  await SendTurnAction({ type: "pass" });
};

async function SendTurnAction(action)
{
  if(isGamePaused) return;

  await set(
    ref(db, `rooms/${currentRoomCode}/currentState/turnAction`),
    {
      playerId: currentPlayerId,
      type: action.type,
      word: action.word ?? null,
      number: action.number ?? null,
      tileIndex: action.tileIndex ?? null,
      t: Date.now()
    }
  );
}

function ShowRejectedToast(reason)
{
  const el = document.getElementById("rejectedText");
  if(!el) return;

  el.innerText = TurnRejectedReasonLabels[reason] || "Ação inválida.";
  el.classList.add("active");

  clearTimeout(rejectedTimeout);
  rejectedTimeout = setTimeout(() => el.classList.remove("active"), 2200);
}


// =========================
// OPEN RESULT
// =========================

async function OpenResult()
{
  const stateSnapshot =
    await get(ref(db, `rooms/${currentRoomCode}/currentState`));

  const state = stateSnapshot.exists() ? stateSnapshot.val() : {};
  const winnerTeam = state.winner;
  const winReason = state.winReason;

  const winnerLabel = TeamDisplayName(winnerTeam);

  let text;

  if(winReason === "BlackHole")
  {
    const loserTeam = winnerTeam === "Solar" ? "Lunar" : "Solar";
    text = `Sinal perdido no Buraco Negro — ${TeamDisplayName(loserTeam)} perdeu contato. ${winnerLabel} vence!`;
  }
  else
  {
    text = `${winnerLabel} mapeou todo o setor!`;
  }

  const winnerEl = document.getElementById("resultWinnerText");
  if(winnerEl) winnerEl.innerText = text;

  const gridSnapshot = await get(ref(db, `rooms/${currentRoomCode}/grid`));
  const grid = gridSnapshot.exists() ? Object.values(gridSnapshot.val()) : [];

  const gridContainer = document.getElementById("resultGrid");

  if(gridContainer)
  {
    gridContainer.innerHTML = "";

    grid.forEach((tile) =>
    {
      const cell = document.createElement("div");
      cell.className = "starTile tile-" + (tile.revealedAsTeam || "Neutral").toLowerCase();
      cell.innerText = tile.word || "";
      gridContainer.appendChild(cell);
    });
  }

  const playersSnapshot = await get(ref(db, `rooms/${currentRoomCode}/players`));
  const scoreboardDiv = document.getElementById("resultScoreboard");

  if(scoreboardDiv)
  {
    scoreboardDiv.innerHTML = "";

    if(playersSnapshot.exists())
    {
      const players = [];

      playersSnapshot.forEach((child) =>
      {
        players.push({ id: child.key, ...child.val() });
      });

      players.sort((a, b) => (b.score || 0) - (a.score || 0));

      players.forEach((player) =>
      {
        const item = document.createElement("div");
        item.className = "scoreItem";

        const teamLabel = player.team === "Solar" ? " [Solar]" : player.team === "Lunar" ? " [Lunar]" : "";
        item.innerText = `${player.name}${teamLabel} - ${player.score || 0}`;

        scoreboardDiv.appendChild(item);
      });
    }
  }
}


// =========================
// OPEN FINAL SCORE
// =========================

async function OpenFinalScore()
{
  const playersSnapshot =
    await get(ref(db, `rooms/${currentRoomCode}/players`));

  const finalDiv =
    document.getElementById("finalScores");

  finalDiv.innerHTML = "";

  if(!playersSnapshot.exists()) return;

  const players = [];

  playersSnapshot.forEach((child) =>
  {
    players.push({ id: child.key, ...child.val() });
  });

  players.sort((a, b) => (b.score || 0) - (a.score || 0));

  players.forEach((player) =>
  {
    const item =
      document.createElement("div");

    item.className = "scoreItem";

    const teamLabel = player.team === "Solar" ? " [Solar]" : player.team === "Lunar" ? " [Lunar]" : "";

    item.innerText =
      `${player.name}${teamLabel} - ${player.score || 0}`;

    finalDiv.appendChild(item);
  });
}
