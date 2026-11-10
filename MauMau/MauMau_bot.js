// =========================
// CÉREBRO DO BOT — MauMau (contrato em bot/README.md)
//
// Lê o estado pelo getState() que MauMau_app.js expõe (só leitura) e age SÓ
// tocando nos mesmos botões do jogador:
//   - cartas em #handContainer (o botão i é a carta i da mão, ver BuildHand)
//   - #drawButton / #passButton
//   - seletor de cor do Curinga (#colorPickerOverlay)
//   - seletor de alvo da Troca-Aqui (#swapPickerOverlay)
//   - #hostButton (Começar Jogo) e #skipTutorialBtn, se for o host
//
// COMANDOS (Z3Bot.act):
//   play     { card, color?, target? }  joga uma carta (ver ParseCardSpec)
//   draw                                 toca COMPRAR
//   pass                                 toca PASSAR
//   color    { color }                  escolhe a cor com o seletor aberto
//   target   { target }                 escolhe o alvo com o seletor da Troca aberto
//   start                                (host) toca o botão do host — Começar / Jogar de Novo
//   tutorial { dir: next|prev|skip }    (host) navega o tutorial
//   state                                mão, topo, vez, cartas jogáveis
//   help                                 lista os comandos
// =========================

const Colors = ["Red", "Blue", "Green", "Yellow"];

const ColorWords =
{
  Red:    ["red", "vermelho", "vermelha"],
  Blue:   ["blue", "azul"],
  Green:  ["green", "verde"],
  Yellow: ["yellow", "amarelo", "amarela"]
};

const ColorLabels = { Red: "Vermelho", Blue: "Azul", Green: "Verde", Yellow: "Amarelo" };

// PALAVRAS ACEITAS PRA CADA TIPO (já sem acento, minúsculas, sem espaço)
const TypeWords =
{
  DrawTwo: ["+2", "drawtwo", "draw2", "comprar2", "compra2", "maisdois", "mais2"],
  Wild:    ["wild", "curinga", "coringa"],
  Skip:    ["skip", "bloqueio", "bloquear", "pular", "pula"],
  Reverse: ["reverse", "reverter", "inverter", "inverte"],
  Shuffle: ["shuffle", "embaralhar", "embaralha"],
  Swap:    ["swap", "troca", "trocaaqui", "trocar"]
};

const TypeLabels =
{
  DrawTwo: "+2", Wild: "Curinga", Skip: "Bloqueio", Reverse: "Reverter",
  Shuffle: "Embaralhar", Swap: "Troca-Aqui"
};

const ActionTypes = ["Skip", "Reverse", "DrawTwo"];


// =========================
// HELPERS
// =========================

function CardLabel(card)
{
  if(!card) return "?";
  if(card.type === "Wild") return "Curinga";

  const color = ColorLabels[card.color] || card.color || "";

  return card.type === "Number"
    ? `${color} ${card.value}`.trim()
    : `${TypeLabels[card.type] || card.type} ${color}`.trim();
}

function CardSig(card)
{
  return card ? `${card.type}:${card.color}:${card.value}` : "-";
}

function HandButtons()
{
  const container = document.getElementById("handContainer");
  return container ? [...container.children] : [];
}

// ÍNDICES QUE O PRÓPRIO CLIENT DEIXOU HABILITADOS (BuildHand já aplica as
// regras de vez/cor/+2/carta comprada). Usa "disabled", não visibilidade:
// na cascata de distribuição as cartas ficam invisíveis por um instante e
// isso não pode virar "não tenho jogada".
function EnabledIndexes()
{
  return HandButtons()
    .map((button, index) => ({ button, index }))
    .filter(({ button }) => !button.disabled)
    .map(({ index }) => index);
}

function IsOverlayOpen(id)
{
  const el = document.getElementById(id);
  return !!el && el.classList.contains("active");
}

function IsMyTurn(state)
{
  return !!(state && state.table && state.table.currentTurnPlayerId === state.playerId);
}

function ParseColor(ctx, raw)
{
  if(!raw) return null;

  const wanted = ctx.bot.normalize(raw);

  return Colors.find(color => ColorWords[color].includes(wanted) || color.toLowerCase() === wanted) || null;
}

// COR PRO CURINGA: a que mais aparece no resto da mão (empate → sorteio).
function BestWildColor(ctx, hand, skipIndex, key)
{
  const counts = { Red: 0, Blue: 0, Green: 0, Yellow: 0 };

  hand.forEach((card, index) =>
  {
    if(index === skipIndex || card.type === "Wild") return;
    if(counts[card.color] !== undefined) counts[card.color]++;
  });

  const best = Math.max(...Object.values(counts));
  const tied = Colors.filter(color => counts[color] === best);

  return ctx.pick(tied, `${key}|wildcolor`);
}

// ALVOS DA TROCA-AQUI: quem ainda está na rotação, menos eu (mesma regra do
// ShowSwapPicker).
function SwapTargets(state)
{
  const order = (state.table && state.table.turnPlayerOrder) || [];

  return order
    .filter(id => id !== state.playerId)
    .map(id => ({ id, name: state.playerNames[id] || "???" }));
}

function SwapOptionsInDom()
{
  return [...document.querySelectorAll("#swapPickerList .swapPickBtn")].map(button =>
  ({
    button,
    name: (button.firstChild && button.firstChild.innerText || "").trim(),
    count: parseInt((button.querySelector(".swapPickCount") || {}).innerText, 10) || 0
  }));
}

function FindByName(ctx, list, wanted)
{
  const target = ctx.bot.normalize(wanted);

  return list.find(item => ctx.bot.normalize(item.name) === target)
    || list.find(item => ctx.bot.normalize(item.name).includes(target))
    || null;
}


// =========================
// AÇÕES (sempre via toque)
// =========================

// O BuildHand recria os botões a cada atualização (e 480ms depois de comprar,
// pra tirar a animação de entrada). Se a mão for redesenhada no meio do toque
// ("stale"), acha o botão de novo pelo índice e toca outra vez.
async function TapCard(ctx, index)
{
  for(let attempt = 0; attempt < 3; attempt++)
  {
    const button = await ctx.bot.waitFor(() =>
    {
      const b = HandButtons()[index];
      return b && ctx.bot.isTappable(b) ? b : null;
    }, 2500).catch(() => null);

    if(!button) ctx.bot.fail("not-playable", `carta ${index} não está tocável`);

    try
    {
      await ctx.bot.tap(button);
      return;
    }
    catch(e)
    {
      if(e.reason !== "stale" || attempt === 2) throw e;
      await ctx.bot.sleep(120);
    }
  }
}

async function PickColorInOverlay(ctx, color)
{
  await ctx.bot.waitFor(() => IsOverlayOpen("colorPickerOverlay"), 2500)
    .catch(() => ctx.bot.fail("picker-timeout", "seletor de cor não abriu"));

  await ctx.bot.think("quick");
  await ctx.bot.tap(`#colorPickerOverlay .colorPickBtn.color-${color.toLowerCase()}`);

  return color;
}

// wantedName: nome pedido no act(); sem ele, escolhe quem tem menos cartas.
async function PickSwapTargetInOverlay(ctx, wantedName, key)
{
  await ctx.bot.waitFor(() => IsOverlayOpen("swapPickerOverlay") && SwapOptionsInDom().length > 0, 5000)
    .catch(() => ctx.bot.fail("picker-timeout", "seletor da Troca-Aqui não abriu"));

  const options = SwapOptionsInDom();

  let choice = null;

  if(wantedName)
  {
    choice = FindByName(ctx, options, wantedName);

    if(!choice)
    {
      await ctx.bot.tap("#swapPickerOverlay .swapCancelBtn").catch(() => {});
      ctx.bot.fail("target-not-found", { target: wantedName, options: options.map(o => o.name) });
    }
  }
  else
  {
    const fewest = Math.min(...options.map(o => o.count));
    choice = ctx.pick(options.filter(o => o.count === fewest), `${key}|swaptarget`);
  }

  await ctx.bot.think("quick");
  await ctx.bot.tap(choice.button);

  return choice.name;
}

// JOGA a carta `index`: toca nela e, se abrir seletor, completa a escolha.
async function PlayIndex(ctx, index, { color = null, target = null, key = "" } = {})
{
  const state = ctx.state;
  const card = state.hand[index];

  await TapCard(ctx, index);

  const result = { played: CardLabel(card), index };

  if(card.type === "Wild")
  {
    result.color = await PickColorInOverlay(ctx, color || BestWildColor(ctx, state.hand, index, key));
  }
  else if(card.type === "Swap" && state.hand.length > 1)
  {
    result.target = await PickSwapTargetInOverlay(ctx, target, key);
  }

  return result;
}


// =========================
// ESCOLHA DE JOGADA (modo auto)
// =========================

// CHAVE DO ESTADO DA VEZ: só o que importa pra jogada (sem ids de jogador,
// que mudam a cada sessão) — assim a mesma seed reproduz as mesmas escolhas
// em outra sessão com o mesmo estado.
function TurnKey(state)
{
  const table = state.table;

  return [
    "turn",
    state.round,
    CardSig(table.topCard),
    table.activeColor,
    table.awaitingDrawFollowUp ? "followup" : "-",
    table.pendingDrawStack || 0,
    (table.turnPlayerOrder || []).length,
    state.hand.map(CardSig).join(",")
  ].join("|");
}

function CardWeight(card, state, playableCount)
{
  const hand = state.hand;

  // CURINGA: guarda pra quando precisar (última opção ou mão quase vazia).
  if(card.type === "Wild") return playableCount === 1 || hand.length <= 2 ? 3 : 0.35;

  // TROCA-AQUI: só vale a pena com a mão cheia.
  if(card.type === "Swap") return hand.length >= 5 ? 2.5 : 0.4;

  if(card.type === "Shuffle") return hand.length >= 5 ? 1.5 : 0.6;

  let weight = 1;

  if(card.color === state.table.activeColor) weight += 1.5;
  if(ActionTypes.includes(card.type)) weight += 1.2;
  if(card.type === "Number") weight += 0.4 + (Number(card.value) || 0) / 18; // larga números altos primeiro

  return weight;
}

function DecideTurn(ctx)
{
  const state = ctx.state;
  const table = state.table;
  const { bot } = ctx;

  // MÃO AINDA NÃO DESENHADA (DOM atrasado em relação ao estado): espera.
  if(HandButtons().length !== state.hand.length) return null;

  const key = TurnKey(state);
  const enabled = EnabledIndexes();
  const stack = table.pendingDrawStack || 0;

  const drawButton = document.getElementById("drawButton");
  const passButton = document.getElementById("passButton");

  const play = (index, label) => (
  {
    key, think: "normal", label,
    run: (c) => PlayIndex(c, index, { key })
  });

  const tapButton = (button, label) => (
  {
    key, think: "normal", label,
    run: () => bot.tap(button)
  });

  // A MESMA JOGADA JÁ FALHOU NESTA VEZ (ex.: host rejeitou): não insiste —
  // compra ou passa, pra não ficar parado até o tempo acabar.
  if(ctx.attempts(key) >= 2)
  {
    if(table.awaitingDrawFollowUp && bot.isTappable(passButton)) return tapButton(passButton, "passa (jogada anterior falhou)");
    if(bot.isTappable(drawButton)) return tapButton(drawButton, "compra (jogada anterior falhou)");
  }

  // DEPOIS DE COMPRAR: joga a carta comprada (quase sempre) ou passa.
  if(table.awaitingDrawFollowUp)
  {
    const last = state.hand.length - 1;

    if(enabled.includes(last) && ctx.chance(0.9, `${key}|followup`))
    {
      return play(last, `joga a carta comprada (${CardLabel(state.hand[last])})`);
    }

    return bot.isTappable(passButton) ? tapButton(passButton, "passa") : null;
  }

  // SOB ATAQUE DE +2: empilha se der, senão compra o monte.
  if(stack > 0)
  {
    if(enabled.length > 0)
    {
      const index = ctx.pick(enabled, `${key}|stack`);
      return play(index, `empilha ${CardLabel(state.hand[index])}`);
    }

    return bot.isTappable(drawButton) ? tapButton(drawButton, `compra ${stack}`) : null;
  }

  if(enabled.length === 0)
  {
    return bot.isTappable(drawButton) ? tapButton(drawButton, "compra (sem jogada)") : null;
  }

  const index = ctx.pickWeighted(
    enabled,
    i => CardWeight(state.hand[i], state, enabled.length),
    `${key}|play`);

  return play(index, `joga ${CardLabel(state.hand[index])}`);
}


// =========================
// RESOLVER CARTA PEDIDA NO act("play", { card })
//   número           → índice na mão (0 = primeira)
//   { index }        → idem
//   { type, color?, value? } → por campos (type = "Number", "DrawTwo", "Wild"…)
//   texto            → "+2", "+2 azul", "Curinga", "Vermelho 5", "5",
//                      "Bloqueio", "Reverter", "Embaralhar", "Troca",
//                      "curinga azul" (a cor vira a cor escolhida)
// =========================

function ParseCardSpec(ctx, spec)
{
  if(typeof spec === "number") return { index: spec };

  if(spec && typeof spec === "object")
  {
    if(Number.isInteger(spec.index)) return { index: spec.index };
    return { type: spec.type || null, color: ParseColor(ctx, spec.color) || spec.color || null, value: spec.value ?? null };
  }

  const text = ctx.bot.normalize(spec);
  if(!text) return null;

  const tokens = text.split(/[\s,]+/).filter(Boolean);
  const compact = text.replace(/[\s_-]/g, "");

  let type = null;

  for(const [cardType, words] of Object.entries(TypeWords))
  {
    if(words.some(word => tokens.includes(word) || compact === word || (word.length > 3 && compact.includes(word))))
    {
      type = cardType;
      break;
    }
  }

  let color = null;

  for(const token of tokens)
  {
    const parsed = ParseColor(ctx, token);
    if(parsed) { color = parsed; break; }
  }

  let value = null;

  if(!type)
  {
    const number = tokens.find(token => /^\d+$/.test(token));
    if(number !== undefined) { value = Number(number); type = "Number"; }
  }

  if(!type && !color) return null;

  return { type, color, value };
}

function MatchesSpec(card, spec)
{
  if(spec.type && card.type !== spec.type) return false;

  // COR NUM CURINGA = cor a escolher, não filtro (o Curinga não tem cor).
  if(spec.color && card.type !== "Wild" && card.color !== spec.color) return false;

  if(spec.value !== null && spec.value !== undefined && Number(card.value) !== Number(spec.value)) return false;

  return true;
}

function TurnHint(table)
{
  if(table.awaitingDrawFollowUp) return "só a carta comprada pode ser jogada (ou passe)";
  if(table.pendingDrawStack > 0) return `sob ataque de +${table.pendingDrawStack}: só +2 ou comprar`;
  return null;
}


// =========================
// CÉREBRO
// =========================

export default
{
  name: "MauMau",

  phase(ctx)
  {
    const state = ctx.state;
    if(!state) return ctx.screen;

    if(state.gameState !== "Playing") return state.gameState;
    if(IsOverlayOpen("colorPickerOverlay")) return "Playing:pickColor";
    if(IsOverlayOpen("swapPickerOverlay")) return "Playing:pickSwapTarget";
    if(!IsMyTurn(state)) return "Playing:waiting";
    if(state.table.awaitingDrawFollowUp) return "Playing:myTurn:afterDraw";
    if(state.table.pendingDrawStack > 0) return "Playing:myTurn:underAttack";
    return "Playing:myTurn";
  },

  decide(ctx)
  {
    const state = ctx.state;
    if(!state) return null;

    const { bot } = ctx;

    if(state.gameState === "Lobby")
    {
      if(!ctx.isHost || !ctx.config.hostStart) return null;
      if((ctx.playerCount ?? 0) < ctx.config.hostStart) return null;

      const hostButton = document.getElementById("hostButton");
      if(!bot.isTappable(hostButton)) return null;

      return {
        key: "lobby|start", think: "normal", retryAfter: 15000,
        label: `lobby com ${ctx.playerCount} jogadores — começando`,
        run: () => bot.tap(hostButton)
      };
    }

    if(state.gameState === "Tutorial")
    {
      if(!ctx.isHost) return null;

      const skip = document.getElementById("skipTutorialBtn");
      if(!bot.isTappable(skip)) return null;

      return {
        key: "tutorial|skip", think: "long", retryAfter: 8000,
        label: "pula o tutorial",
        run: () => bot.tap(skip)
      };
    }

    if(state.gameState !== "Playing" || !state.table || !state.table.topCard) return null;

    // SELETOR ABERTO SEM SER POR NÓS (humano tocou em modo auto, ou um act()
    // falhou no meio): completa a escolha.
    if(IsOverlayOpen("colorPickerOverlay"))
    {
      const key = `overlay|color|${TurnKey(state)}`;
      const color = BestWildColor(ctx, state.hand, -1, key);

      return {
        key, think: "quick", label: `escolhe a cor ${ColorLabels[color]}`,
        run: (c) => PickColorInOverlay(c, color)
      };
    }

    if(IsOverlayOpen("swapPickerOverlay"))
    {
      const key = `overlay|swap|${TurnKey(state)}`;

      return {
        key, think: "quick", label: "escolhe o alvo da Troca-Aqui",
        run: (c) => PickSwapTargetInOverlay(c, null, key)
      };
    }

    if(!IsMyTurn(state)) return null;

    return DecideTurn(ctx);
  },

  commands:
  {
    async play(ctx, args = {})
    {
      const state = ctx.state;
      const { bot } = ctx;

      if(!state || state.gameState !== "Playing" || !state.table) bot.fail("not-playing", state && state.gameState);
      if(!IsMyTurn(state)) bot.fail("not-your-turn", `vez de ${state.playerNames[state.table.currentTurnPlayerId] || "outro jogador"}`);
      if(args.card === undefined || args.card === null || args.card === "") bot.fail("missing-card", "use { card: \"+2\" | \"Vermelho 5\" | 0 … }");

      const spec = ParseCardSpec(ctx, args.card);
      if(!spec) bot.fail("bad-card", String(args.card));

      const hand = state.hand;
      const enabled = EnabledIndexes();

      let candidates;

      if(spec.index !== undefined)
      {
        if(!hand[spec.index]) bot.fail("no-such-card", { index: spec.index, hand: hand.map(CardLabel) });
        candidates = [spec.index];
      }
      else
      {
        candidates = hand.map((card, i) => i).filter(i => MatchesSpec(hand[i], spec));
        if(candidates.length === 0) bot.fail("no-such-card", { card: args.card, hand: hand.map(CardLabel) });
      }

      const index = candidates.find(i => enabled.includes(i));

      if(index === undefined)
      {
        bot.fail("not-playable", { card: candidates.map(i => CardLabel(hand[i])), hint: TurnHint(state.table) });
      }

      const card = hand[index];

      // COR (Curinga): args.color, ou a cor escrita junto ("curinga azul").
      let color = null;

      if(card.type === "Wild")
      {
        color = ParseColor(ctx, args.color) || spec.color || null;
        if(args.color && !ParseColor(ctx, args.color)) bot.fail("bad-color", args.color);
      }

      // ALVO (Troca-Aqui): valida ANTES de tocar, pra não deixar a jogada pela metade.
      let target = null;

      if(card.type === "Swap" && hand.length > 1 && args.target)
      {
        const found = FindByName(ctx, SwapTargets(state), args.target);
        if(!found) bot.fail("target-not-found", { target: args.target, options: SwapTargets(state).map(t => t.name) });
        target = found.name;
      }

      return PlayIndex(ctx, index, { color, target, key: `act|${TurnKey(state)}` });
    },

    async draw(ctx)
    {
      const { bot, state } = ctx;

      if(!IsMyTurn(state)) bot.fail("not-your-turn");

      const button = document.getElementById("drawButton");
      if(!bot.isTappable(button)) bot.fail("not-available", TurnHint(state.table) || "COMPRAR indisponível agora");

      await bot.tap(button);
      return { action: "draw" };
    },

    async pass(ctx)
    {
      const { bot, state } = ctx;

      if(!IsMyTurn(state)) bot.fail("not-your-turn");

      const button = document.getElementById("passButton");
      if(!bot.isTappable(button)) bot.fail("not-available", "só dá pra passar depois de comprar");

      await bot.tap(button);
      return { action: "pass" };
    },

    async color(ctx, args = {})
    {
      const color = ParseColor(ctx, args.color);
      if(!color) ctx.bot.fail("bad-color", args.color);
      if(!IsOverlayOpen("colorPickerOverlay")) ctx.bot.fail("not-available", "seletor de cor fechado");

      return { color: await PickColorInOverlay(ctx, color) };
    },

    async target(ctx, args = {})
    {
      if(!IsOverlayOpen("swapPickerOverlay")) ctx.bot.fail("not-available", "seletor da Troca-Aqui fechado");

      return { target: await PickSwapTargetInOverlay(ctx, args.target || args.name || null, `act|target`) };
    },

    async start(ctx)
    {
      const { bot } = ctx;

      if(!ctx.isHost) bot.fail("not-host");

      const button = document.getElementById("hostButton");
      if(!bot.isTappable(button)) bot.fail("not-available", "botão do host não aparece nesta fase");

      const label = bot.text(button);
      await bot.tap(button);
      return { action: label };
    },

    async tutorial(ctx, args = {})
    {
      const { bot } = ctx;

      if(!ctx.isHost) bot.fail("not-host");

      const dir = args.dir || "skip";

      const selectors =
      {
        next: "#tutorialControls .tutorialNavRow button:last-child",
        prev: "#tutorialControls .tutorialNavRow button:first-child",
        skip: "#skipTutorialBtn"
      };

      if(!selectors[dir]) bot.fail("bad-dir", "use next, prev ou skip");

      const button = document.querySelector(selectors[dir]);
      if(!bot.isTappable(button)) bot.fail("not-available", "tutorial não está na tela");

      await bot.tap(button);
      return { action: `tutorial:${dir}` };
    },

    state(ctx)
    {
      const state = ctx.state;
      if(!state) return { ok: false, reason: "no-state" };

      const table = state.table;
      const enabled = EnabledIndexes();

      return {
        gameState: state.gameState,
        round: state.round,
        myTurn: IsMyTurn(state),
        turnOf: table ? state.playerNames[table.currentTurnPlayerId] || null : null,
        topCard: table ? CardLabel(table.topCard) : null,
        activeColor: table ? table.activeColor : null,
        pendingDrawStack: table ? table.pendingDrawStack || 0 : 0,
        awaitingDrawFollowUp: table ? !!table.awaitingDrawFollowUp : false,
        hand: state.hand.map((card, index) =>
          ({ index, label: CardLabel(card), ...card, playable: enabled.includes(index) })),
        swapTargets: table ? SwapTargets(state).map(t => t.name) : []
      };
    },

    help()
    {
      return {
        commands:
        {
          play: "{ card: 0 | \"+2\" | \"Vermelho 5\" | \"Curinga\" | \"Troca\" …, color?: \"Azul\", target?: \"Rafa\" }",
          draw: "toca COMPRAR",
          pass: "toca PASSAR (depois de comprar)",
          color: "{ color } com o seletor do Curinga aberto",
          target: "{ target } com o seletor da Troca-Aqui aberto",
          start: "(host) botão do host: Começar Jogo / Jogar de Novo",
          tutorial: "(host) { dir: next | prev | skip }",
          state: "mão, topo, vez, jogáveis"
        }
      };
    }
  }
};
