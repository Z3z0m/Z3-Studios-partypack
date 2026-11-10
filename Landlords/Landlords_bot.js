// =========================
// CÉREBRO DO BOT — Landlords (contrato em bot/README.md)
//
// Bot BURRO de propósito, com regras fixas:
//   - COMPRA: caixa ≥ 3× o preço → compra; entre 2× e 3× → 50%; abaixo → não.
//   - LEILÃO (lance): mesma regra com o próximo lance mínimo; senão "Sair".
//   - LEILOEIRO: leiloa o local livre do governo mais caro; sem livre, "Passar".
//   - PRISÃO: nunca paga. Usa o Advogado se tiver; senão tenta dupla.
//   - CARTAS GUARDADAS: usa na primeira chance — Pista livre (1d20) na próxima
//     rolagem dele; "Não valeu!" na próxima rolagem de OUTRO jogador.
//   - CONSTRÓI só no "construir aqui" (parou na própria casa), sempre que o
//     caixa ≥ custo da construção + $80. Nunca constrói pela aba Locais.
//   - NUNCA propõe troca; recusa toda proposta recebida.
//   - DÍVIDA: hipoteca do local mais barato pro mais caro; sem local, falência.
//   - Dados do morador local: os 2 maiores. Votação: sorteio pela seed.
//
// Lê o estado pelo getState() de Landlords_app.js (só leitura) e age SÓ
// tocando nos botões da tela (painel "Agora", aba Locais, pop-up de troca).
// "Hipoteca" e "Declarar falência" abrem confirm() nativo: o bot.js responde
// OK porque o diálogo nasce do toque do próprio bot.
// =========================


// =========================
// HELPERS DE ESTADO
// =========================

function Me(s) { return s.table && s.table.players ? s.table.players[s.playerId] : null; }
function Space(s, pos) { return s.board && s.board.spaces ? s.board.spaces[pos] : null; }
function OwnerOf(s, pos) { const st = s.table && s.table.board && s.table.board[pos]; return st ? st.ownerId || null : null; }
function IsOwnable(space) { return !!space && (space.type === "property" || space.type === "transport"); }
function Holds(s, hold) { return (s.heldCards || []).some(c => c.hold === hold); }

function FreeSpaces(s)
{
  return (s.board.spaces || []).filter(sp => IsOwnable(sp) && !OwnerOf(s, sp.pos));
}

function MyPlaces(s)
{
  return (s.board.spaces || []).filter(sp => IsOwnable(sp) && OwnerOf(s, sp.pos) === s.playerId);
}

// REGRA DO BOT BURRO: vale gastar `price` tendo `cash`?
function WantsToPay(ctx, cash, price, key)
{
  if(!(price > 0)) return true;
  if(cash >= 3 * price) return true;
  if(cash >= 2 * price) return ctx.chance(0.5, key);
  return false;
}

function FindSpace(ctx, s, wanted)
{
  if(typeof wanted === "number") return Space(s, wanted);

  const target = ctx.bot.normalize(wanted);
  const spaces = (s.board.spaces || []).filter(IsOwnable);

  return spaces.find(sp => ctx.bot.normalize(sp.name) === target)
    || spaces.find(sp => ctx.bot.normalize(sp.name).includes(target))
    || null;
}


// =========================
// HELPERS DE TELA
// =========================

function Q(selector) { return document.querySelector(selector); }
function OnclickSel(code) { return `button[onclick="${code}"]`; }
function ActSel(type) { return OnclickSel(`Act('${type}')`); }

function ActiveTab()
{
  const screen = document.getElementById("playingScreen");
  return screen ? screen.dataset.tab || "agora" : "agora";
}

// DECISÃO DE TROCAR DE ABA (o painel de ação só aparece na aba "Agora";
// hipoteca fica em "Locais").
function SwitchTab(ctx, tab, key)
{
  const nav = Q(`.navBtn[data-tab="${tab}"]`);
  if(!ctx.bot.isTappable(nav)) return null;

  return {
    key: `tab|${tab}|${key}`, think: "quick", label: `abre a aba ${tab}`,
    run: (c) => c.bot.tap(nav)
  };
}

// DECISÃO DE TOCAR UM BOTÃO DA ABA "Agora" (troca de aba antes, se precisar).
function Agora(ctx, key, label, target, think = "normal", extra = {})
{
  if(ActiveTab() !== "agora") return SwitchTab(ctx, "agora", key);

  const el = typeof target === "string" ? Q(target) : target;
  if(!el || !ctx.bot.isTappable(el)) return null;

  return { key, label, think, ...extra, run: (c) => c.bot.tap(el) };
}

// PRA COMANDOS: garante a aba e toca o primeiro seletor que estiver tocável.
async function TapIn(ctx, tab, selectors, reason)
{
  const { bot } = ctx;

  if(tab && ActiveTab() !== tab)
  {
    await bot.tap(`.navBtn[data-tab="${tab}"]`);
    await bot.sleep(150);
  }

  const list = [].concat(selectors);
  if(list.length === 0) return null; // só trocar de aba

  for(const selector of list)
  {
    const el = Q(selector);
    if(el && bot.isTappable(el))
    {
      await bot.tap(el);
      return bot.describe(el);
    }
  }

  bot.fail("not-available", reason || "botão não está na tela agora");
}

// TOP 2 DADOS (morador local): índices dos 2 maiores valores.
function BestTwoDice(values)
{
  return values
    .map((value, index) => ({ value, index }))
    .sort((a, b) => b.value - a.value || a.index - b.index)
    .slice(0, 2)
    .map(d => d.index)
    .sort((a, b) => a - b);
}

async function PickDice(ctx, picks)
{
  for(const i of picks)
  {
    await ctx.bot.tap(`#pick${i}`);
    await ctx.bot.think("quick");
  }

  await ctx.bot.tap("#confirmPick");
  return { picks };
}

// LEILOEIRO: escolhe o local na lista e confirma.
async function PickAuctionSpace(ctx, pos, isOwn)
{
  const { bot } = ctx;
  const seg = isOwn ? "#segOwn" : "#segGov";

  if(!Q(seg).classList.contains("active"))
  {
    await bot.tap(seg);
    await bot.think("quick");
  }

  await bot.tap(`#ap${pos}`);
  await bot.think("quick");
  await bot.tap("#confirmAuctionPick");
  return { auctioned: pos };
}

// CONSTRUÇÃO: sobra mínima depois de pagar a obra.
const BuildReserve = 80;

function BuildCost(s, pos)
{
  const space = Space(s, pos);
  const st = s.table.board && s.table.board[pos];
  const level = st ? st.level || 0 : 0;
  return level >= 3 ? space.hotelCost : space.houseCost;
}

// OBRA QUE O BOT FARIA AGORA: SÓ o atalho "construir aqui" (parou na própria
// casa — o host manda prompt.canBuildHere e o client mostra o botão na aba
// Agora). Nunca constrói pela aba Locais. Só se caixa ≥ custo + reserva.
function PickBuild(s, me)
{
  const prompt = s.table.prompt || {};
  if(!prompt.canBuildHere) return null;

  const pos = prompt.pos;
  const space = Space(s, pos);
  if(!space) return null;

  const button = Q(`#dock-agora ${OnclickSel(`Act('build', ${pos})`)}`);
  if(!button || button.disabled) return null;

  const cost = BuildCost(s, pos);
  if(me.cash < cost + BuildReserve) return null;

  return { pos, cost, tab: "agora", name: space.name };
}

// CHAVE DO ESTADO DA MINHA VEZ (trava: muda a cada passo da jogada).
function PhaseKey(s, me)
{
  const t = s.table;
  return [t.phase, t.turnNumber, JSON.stringify(t.prompt || {}), me.cash, me.position, JSON.stringify(t.lastRoll || null)].join("|");
}


// =========================
// DECISÕES POR FASE
// =========================

function DecideAuction(ctx, s, me)
{
  const a = s.table.auction;
  const id = s.playerId;

  if(!(a.eligible || []).includes(id) || (a.calledOut || []).includes(id)) return null;
  if(a.highestBidderId === id) return null; // ganhando: espera

  const price = a.minBid;
  const space = Space(s, a.pos);
  const bid = me.cash >= price && WantsToPay(ctx, me.cash, price, `auction|${a.pos}|${price}|${me.cash}`);

  // LANCE: chave muda a cada lance novo. SAIR: uma chave pro leilão inteiro —
  // senão um lance dos outros chegando antes do host registrar o "Sair"
  // faria o bot tocar "Sair" de novo (painel já redesenhado → "stale").
  const key = bid
    ? `auction|${a.pos}|${a.type}|${a.highestBid}|${a.highestBidderId || "-"}`
    : `auction|${a.pos}|${a.type}|callout`;

  return Agora(ctx, key,
    bid ? `lance de $${price} em ${space ? space.name : a.pos}` : `sai do leilão (caixa $${me.cash}, lance $${price})`,
    bid ? "#bidButton" : "#calloutButton",
    "quick", { retryAfter: 3000 });
}

function DecideDebt(ctx, s, me)
{
  const t = s.table;
  const prompt = t.prompt || {};
  const missing = (prompt.amount || 0) - me.cash;

  // Já tem o dinheiro (o host cobra sozinho) ou a hipoteca está em leilão.
  if(missing <= 0 || t.auction) return null;

  const places = MyPlaces(s).sort((a, b) => a.price - b.price || a.pos - b.pos);

  if(places.length > 0)
  {
    const place = places[0];
    const key = `debt|mortgage|${place.pos}|${me.cash}`;

    if(ActiveTab() !== "locais") return SwitchTab(ctx, "locais", key);

    const button = Q(OnclickSel(`ConfirmMortgage(${place.pos})`));
    if(!button || !ctx.bot.isTappable(button)) return null;

    return {
      key, think: "normal", label: `hipoteca ${place.name} (faltam $${missing})`,
      run: (c) => c.bot.tap(button)
    };
  }

  return Agora(ctx, `debt|bankrupt|${t.turnNumber}`, `declara falência (faltam $${missing})`, OnclickSel("ConfirmBankrupt()"));
}

function DecideMine(ctx, s, me)
{
  const t = s.table;
  const prompt = t.prompt || {};
  const key = PhaseKey(s, me);

  switch(t.phase)
  {
    case "Roll":
    {
      // Pista livre na primeira chance (o botão só aparece quando pode usar).
      if(Q(ActSel("roll1d20"))) return Agora(ctx, key, "usa a Pista livre (1d20)", ActSel("roll1d20"));
      return Agora(ctx, key, prompt.type === "orderRoll" ? "rola pra ordem" : "rola os dados", ActSel("roll"));
    }

    case "JailChoice":
    {
      if(prompt.canUseLawyer) return Agora(ctx, key, "usa o Advogado", ActSel("useLawyer"));
      return Agora(ctx, key, "tenta tirar dupla", ActSel("rollJail"));
    }

    case "PickDice":
    {
      if(ActiveTab() !== "agora") return SwitchTab(ctx, "agora", key);
      if(!ctx.bot.isTappable(Q("#pick0"))) return null;

      const picks = BestTwoDice(prompt.values || []);

      return {
        key, think: "normal", label: `escolhe os dados ${picks.map(i => prompt.values[i]).join(" e ")}`,
        run: (c) => PickDice(c, picks)
      };
    }

    case "ShowCard":
      if(prompt.type !== "cardOk") return null;
      return Agora(ctx, key, "OK na carta", OnclickSel("CardOk()"), "long");

    case "TransportRoll":
      return Agora(ctx, key, "rola o aluguel do transporte", ActSel("roll"));

    case "PayRent":
      return Agora(ctx, key, `paga $${prompt.amount} de aluguel`, ActSel("ok"));

    case "BuyDecision":
    {
      const space = Space(s, prompt.pos);
      const price = prompt.amount ?? (space ? space.price : 0);
      const buyButton = Q(ActSel("buy"));

      const buy = !!buyButton && !buyButton.disabled
        && WantsToPay(ctx, me.cash, price, `buy|${prompt.pos}|${price}|${me.cash}`);

      return buy
        ? Agora(ctx, key, `compra ${space ? space.name : prompt.pos} por $${price} (caixa $${me.cash})`, buyButton)
        : Agora(ctx, key, `não compra ${space ? space.name : prompt.pos} ($${price}, caixa $${me.cash})`, ActSel("decline"));
    }

    case "AuctionChoice":
    {
      const free = FreeSpaces(s).sort((a, b) => b.price - a.price || a.pos - b.pos);

      if(free.length === 0) return Agora(ctx, key, "nada livre pra leiloar — passa", ActSel("auctionPass"));

      if(ActiveTab() !== "agora") return SwitchTab(ctx, "agora", key);
      if(!ctx.bot.isTappable(Q("#segGov"))) return null;

      const place = free[0];

      return {
        key, think: "normal", label: `leiloa ${place.name} ($${place.price})`,
        run: (c) => PickAuctionSpace(c, place.pos, false)
      };
    }

    case "Manage":
    {
      // "CONSTRUIR AQUI" ANTES de encerrar/rolar de novo, se sobrar custo + $80.
      // A chave inclui o caixa e o nível: muda a cada obra → reavalia.
      const build = PickBuild(s, me);

      if(build)
      {
        const st = t.board && t.board[build.pos];
        const buildKey = `${key}|build|${build.pos}|${st ? st.level || 0 : 0}`;

        if(ActiveTab() !== build.tab) return SwitchTab(ctx, build.tab, buildKey);

        const root = build.tab === "agora" ? "#dock-agora" : "#placesList";
        const button = Q(`${root} ${OnclickSel(`Act('build', ${build.pos})`)}`);
        if(!button || !ctx.bot.isTappable(button)) return null;

        return {
          key: buildKey, think: "normal",
          label: `constrói em ${build.name} por $${build.cost} (caixa $${me.cash})`,
          run: (c) => c.bot.tap(button)
        };
      }

      if(prompt.type === "manageRollAgain")
      {
        if(Q(OnclickSel("RollAgain('roll1d20')"))) return Agora(ctx, key, "dupla! rola de novo com a Pista livre", OnclickSel("RollAgain('roll1d20')"));
        return Agora(ctx, key, "dupla! rola de novo", OnclickSel("RollAgain('roll')"));
      }

      return Agora(ctx, key, "encerra o turno", ActSel("endTurn"));
    }

    case "Debt":
      return DecideDebt(ctx, s, me);

    default:
      return null;
  }
}


// =========================
// CÉREBRO
// =========================

export default
{
  name: "Landlords",

  phase(ctx)
  {
    const s = ctx.state;
    if(!s || s.gameState !== "Playing" || !s.table) return s ? s.gameState : ctx.screen;

    const t = s.table;
    const mine = t.actorId === s.playerId;
    return `Playing:${t.phase}${mine ? ":mine" : ""}`;
  },

  decide(ctx)
  {
    const s = ctx.state;
    if(!s) return null;

    const { bot } = ctx;

    if(s.gameState === "Lobby")
    {
      if(!ctx.isHost || !ctx.config.hostStart) return null;
      if((ctx.playerCount ?? 0) < ctx.config.hostStart) return null;

      const start = Q("#lobbyScreen .hostOnly");
      if(!bot.isTappable(start)) return null;

      return {
        key: "lobby|start", think: "normal", retryAfter: 15000,
        label: `lobby com ${ctx.playerCount} jogadores — começando`,
        run: () => bot.tap(start)
      };
    }

    if(s.gameState === "Tutorial")
    {
      if(!ctx.isHost) return null;

      const skip = Q(OnclickSel("SendTutorialAction('skip')"));
      if(!bot.isTappable(skip)) return null;

      return {
        key: "tutorial|skip", think: "long", retryAfter: 8000,
        label: "pula o tutorial",
        run: () => bot.tap(skip)
      };
    }

    if(s.gameState !== "Playing" || !s.table || !s.board) return null;

    const t = s.table;
    const me = Me(s);
    if(!me || me.bankrupt) return null;

    // PROPOSTA RECEBIDA (pop-up por cima de tudo): sempre recusa.
    const popup = Q("#tradePopup.active");
    if(popup)
    {
      const reject = popup.querySelector(`button[onclick^="TradeRespond('tradeReject'"]`);
      if(!reject || !bot.isTappable(reject)) return null;

      return {
        key: `trade|${reject.getAttribute("onclick")}`, think: "normal", label: "recusa a proposta",
        run: (c) => c.bot.tap(reject)
      };
    }

    // VOTAÇÃO (todo mundo vota): sorteio pela seed.
    if(t.phase === "Vote")
    {
      const v = t.vote;
      if(!v || v.closed || !(v.voters || []).includes(s.playerId) || (v.voted || []).includes(s.playerId)) return null;

      // "continue" (fim do tempo/rodadas: continuar a partida?) → sempre
      // continua (choice 0), pra jogar até alguém vencer ou sobrar 1.
      // As outras votações: sorteio pela seed.
      const choice = v.kind === "continue" ? 0 : ctx.pick([0, 1], `vote|${v.cardId}|${v.kind}|${v.title}`);
      const options = v.options || ["A", "B"];

      return Agora(ctx, `vote|${t.turnNumber}|${v.cardId}|${v.kind}`, `vota "${options[choice]}"`, OnclickSel(`SendVote(${choice})`));
    }

    // LEILÃO (quem é elegível dá lance ou sai).
    if(t.phase === "Auction" && t.auction) return DecideAuction(ctx, s, me);

    // "NÃO VALEU!": na próxima rolagem de OUTRO jogador.
    if(t.phase === "RerollWindow" && Holds(s, "reroll"))
    {
      const roller = t.lastRoll && t.lastRoll.rollerId;
      if(!roller || roller === s.playerId) return null;

      return Agora(ctx, `reroll|${t.turnNumber}|${JSON.stringify(t.lastRoll)}`, "NÃO VALEU!", ActSel("reroll"), "quick");
    }

    if(t.actorId !== s.playerId) return null;

    return DecideMine(ctx, s, me);
  },


  // =========================
  // COMANDOS (Z3Bot.act)
  // =========================

  commands:
  {
    state(ctx)
    {
      const s = ctx.state;
      if(!s || !s.table || !s.board) return { ok: false, reason: "no-state", detail: s ? s.gameState : null };

      const t = s.table;
      const me = Me(s) || {};
      const a = t.auction;

      return {
        gameState: s.gameState,
        phase: t.phase,
        mine: t.actorId === s.playerId,
        actor: t.players && t.players[t.actorId] ? t.players[t.actorId].name : null,
        prompt: t.prompt || null,
        tab: ActiveTab(),
        cash: me.cash, position: me.position, inJail: !!me.inJail, bankrupt: !!me.bankrupt,
        place: Space(s, me.position) ? Space(s, me.position).name : null,
        heldCards: (s.heldCards || []).map(c => ({ hold: c.hold, title: c.title })),
        myPlaces: MyPlaces(s).map(sp => ({ pos: sp.pos, name: sp.name, price: sp.price })),
        freePlaces: FreeSpaces(s).length,
        auction: a ? { pos: a.pos, place: Space(s, a.pos) ? Space(s, a.pos).name : null, type: a.type, minBid: a.minBid, highestBid: a.highestBid,
          winning: a.highestBidderId === s.playerId, eligible: (a.eligible || []).includes(s.playerId), calledOut: (a.calledOut || []).includes(s.playerId) } : null,
        vote: t.vote && !t.vote.closed ? { title: t.vote.title, options: t.vote.options || ["A", "B"], voted: (t.vote.voted || []).includes(s.playerId) } : null
      };
    },

    async roll(ctx, args = {})
    {
      const d20 = !!args.d20;
      const tapped = await TapIn(ctx, "agora", d20
        ? [ActSel("roll1d20"), OnclickSel("RollAgain('roll1d20')")]
        : [ActSel("roll"), OnclickSel("RollAgain('roll')")], d20 ? "Pista livre indisponível agora" : "não é hora de rolar");
      return { tapped };
    },

    async buy(ctx) { return { tapped: await TapIn(ctx, "agora", ActSel("buy"), "não há compra agora (ou falta dinheiro)") }; },
    async decline(ctx) { return { tapped: await TapIn(ctx, "agora", ActSel("decline"), "não há compra agora") }; },
    async ok(ctx) { return { tapped: await TapIn(ctx, "agora", [OnclickSel("CardOk()"), ActSel("ok")], "nada pra confirmar agora") }; },
    async endTurn(ctx) { return { tapped: await TapIn(ctx, "agora", ActSel("endTurn"), "não dá pra encerrar o turno agora") }; },
    async reroll(ctx) { return { tapped: await TapIn(ctx, "agora", ActSel("reroll"), "sem \"Não valeu!\" ou fora da janela") }; },
    async callout(ctx) { return { tapped: await TapIn(ctx, "agora", "#calloutButton", "fora de leilão (ou você está ganhando)") }; },
    async auctionPass(ctx) { return { tapped: await TapIn(ctx, "agora", ActSel("auctionPass"), "não é a escolha do leilão") }; },
    async bankrupt(ctx) { return { tapped: await TapIn(ctx, "agora", OnclickSel("ConfirmBankrupt()"), "falência só durante uma dívida") }; },

    async jail(ctx, args = {})
    {
      const mode = args.mode || "roll";
      const selector = { roll: ActSel("rollJail"), pay: ActSel("payJail"), lawyer: ActSel("useLawyer") }[mode];
      if(!selector) ctx.bot.fail("bad-mode", "use roll, pay ou lawyer");
      return { tapped: await TapIn(ctx, "agora", selector, "fora da prisão ou opção indisponível") };
    },

    async bid(ctx, args = {})
    {
      const { bot } = ctx;
      if(ActiveTab() !== "agora") await TapIn(ctx, "agora", [], "");

      const input = Q("#bidInput");
      if(!input || !bot.isTappable(Q("#bidButton"))) bot.fail("not-available", "sem leilão aberto pra você (ou falta caixa)");

      if(args.amount !== undefined) await bot.type(input, String(args.amount));
      const amount = parseInt(input.value, 10);

      await bot.tap("#bidButton");
      return { bid: amount };
    },

    async auction(ctx, args = {})
    {
      const s = ctx.state;
      const space = args.place !== undefined ? FindSpace(ctx, s, args.place) : null;
      if(args.place !== undefined && !space) ctx.bot.fail("place-not-found", args.place);

      if(ActiveTab() !== "agora") await TapIn(ctx, "agora", [], "");
      if(!Q("#segGov")) ctx.bot.fail("not-available", "não é a escolha do leilão");

      const target = space || FreeSpaces(s).sort((a, b) => b.price - a.price)[0];
      if(!target) ctx.bot.fail("nothing-to-auction");

      const isOwn = OwnerOf(s, target.pos) === s.playerId;
      if(!isOwn && OwnerOf(s, target.pos)) ctx.bot.fail("not-available", `${target.name} é de outro jogador`);

      return PickAuctionSpace(ctx, target.pos, isOwn);
    },

    async vote(ctx, args = {})
    {
      const choice = Number(args.choice);
      if(choice !== 0 && choice !== 1) ctx.bot.fail("bad-choice", "use choice 0 ou 1");
      return { tapped: await TapIn(ctx, "agora", OnclickSel(`SendVote(${choice})`), "sem votação aberta pra você") };
    },

    async pickDice(ctx, args = {})
    {
      const s = ctx.state;
      const values = (s.table && s.table.prompt && s.table.prompt.values) || [];
      if(s.table.phase !== "PickDice" || s.table.actorId !== s.playerId) ctx.bot.fail("not-available", "não é a escolha de dados");

      if(ActiveTab() !== "agora") await TapIn(ctx, "agora", [], "");
      return PickDice(ctx, Array.isArray(args.picks) ? args.picks : BestTwoDice(values));
    },

    async build(ctx, args = {})
    {
      const s = ctx.state;
      const space = FindSpace(ctx, s, args.place);
      if(!space) ctx.bot.fail("place-not-found", args.place);

      const here = Q(`#dock-agora ${OnclickSel(`Act('build', ${space.pos})`)}`);
      if(here && ctx.bot.isTappable(here) && ActiveTab() === "agora") { await ctx.bot.tap(here); return { built: space.name }; }

      return { tapped: await TapIn(ctx, "locais", `#placesList ${OnclickSel(`Act('build', ${space.pos})`)}`, "não dá pra construir aí agora (grupo, por igual, caixa ou fase)"), built: space.name };
    },

    async mortgage(ctx, args = {})
    {
      const s = ctx.state;
      const space = FindSpace(ctx, s, args.place);
      if(!space) ctx.bot.fail("place-not-found", args.place);
      if(OwnerOf(s, space.pos) !== s.playerId) ctx.bot.fail("not-yours", space.name);

      return { tapped: await TapIn(ctx, "locais", OnclickSel(`ConfirmMortgage(${space.pos})`), "hipoteca só na sua vez (gestão ou dívida)"), place: space.name };
    },

    async trade(ctx, args = {})
    {
      const prefix = args.accept ? "tradeAccept" : "tradeReject";
      const button = Q(`#tradePopup.active button[onclick^="TradeRespond('${prefix}'"]`);
      if(!button) ctx.bot.fail("not-available", "nenhuma proposta aberta");
      await ctx.bot.tap(button);
      return { action: prefix };
    },

    async tab(ctx, args = {})
    {
      if(!["agora", "locais", "placar"].includes(args.tab)) ctx.bot.fail("bad-tab", "use agora, locais ou placar");
      await ctx.bot.tap(`.navBtn[data-tab="${args.tab}"]`);
      return { tab: args.tab };
    },

    async start(ctx)
    {
      if(!ctx.isHost) ctx.bot.fail("not-host");
      return { tapped: await TapIn(ctx, null, ["#lobbyScreen .hostOnly", "#finalScoreScreen .hostOnly"], "botão do host não aparece nesta fase") };
    },

    help()
    {
      return {
        commands:
        {
          state: "fase, caixa, cartas, locais, leilão, votação",
          roll: "{ d20?: true } rola (ou rola de novo na dupla)",
          buy: "compra o local", decline: "não compra",
          ok: "OK da carta / paga o aluguel", endTurn: "encerra o turno",
          jail: "{ mode: roll | pay | lawyer }",
          bid: "{ amount? } dá lance (sem amount = lance mínimo)", callout: "sai do leilão",
          auction: "{ place?: nome | pos } leiloa (padrão: livre mais caro)", auctionPass: "não leiloa",
          vote: "{ choice: 0 | 1 }", pickDice: "{ picks?: [i, j] } (padrão: 2 maiores)",
          reroll: "usa o \"Não valeu!\"", build: "{ place } constrói (casa/hotel)", mortgage: "{ place } hipoteca", bankrupt: "declara falência",
          trade: "{ accept: bool } responde a proposta", tab: "{ tab: agora | locais | placar }",
          start: "(host) Começar Jogo / Jogar de Novo"
        }
      };
    }
  }
};
