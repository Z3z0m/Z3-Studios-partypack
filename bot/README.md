# Z3Bot — modo BOT do client web

Jogadores falsos que jogam **pela interface do celular**, pra:

1. **gravar prints/vídeos** ilustrativos (com indicador de toque e flash de sincronia);
2. **playtest**: várias janelas com bots rodando partidas inteiras pra achar travamentos.

Este README é o **contrato** entre o client web e a ferramenta do Editor do Unity
que abre as janelas do Edge e controla os bots pelo Chrome DevTools Protocol (CDP).

## Regra principal

O bot age **só pela interface**. Ele toca nos mesmos botões e digita nos mesmos campos que um humano,
com `pointerdown`/`pointerup`/`click` reais no elemento e `keydown`/`input`/`change` nos campos.

- O bot **nunca escreve no Firebase**. Ele só **lê**, pelo app que a própria página já abriu,
  e só duas coisas: se ele é o host e quantos jogadores tem o lobby (pro `hoststart`).
- O cérebro de um jogo pode ler o estado que a página expõe (`getState`, só leitura),
  mas também age tocando na tela.
- Se uma ação for impossível pelo DOM (ex.: arrastar), o cérebro chama a **mesma função
  que o handler do evento chama**. Nunca o Firebase.

Um jogador normal (sem `?bot=` na URL) não baixa nenhum arquivo do bot e não muda de comportamento.
O bot é carregado com `import()` dinâmico só quando o parâmetro existe.

---

## Parâmetros de URL

| Parâmetro       | Valores        | Padrão   | Efeito |
|-----------------|----------------|----------|--------|
| `bot`           | `auto`/`manual` | —       | Liga o bot. `auto` joga sozinho. `manual` carrega a API e fica parado, e quem controla é um humano ou o Unity. Qualquer valor diferente de `manual` vale como `auto`. |
| `seed`          | inteiro        | aleatória | RNG com seed. **Mesma seed + mesmo estado = mesma escolha.** Sem seed, o bot sorteia uma e mostra no log. |
| `speed`         | número ≥ 0     | `1`      | Multiplica as pausas "de pensar" e o ritmo de digitação. `0.2` é bom pra playtest, `0` é instantâneo. |
| `tap`           | `0`            | ligado   | `tap=0` desliga o círculo que aparece no ponto tocado. |
| `hoststart`     | inteiro N      | —        | Se este bot for o **host** em `auto`, ele aperta "Começar" quando o lobby tiver **≥ N jogadores**. Sem esse parâmetro, o host bot não começa a partida sozinho. |
| `room`, `name`  | texto          | —        | Usados na tela de entrada (ver abaixo). |

Em modo bot, o título da aba vira `[bot] <nome> · <título>`, o que ajuda a achar a janela.

### Fluxo de entrada

```
index.html?room=ABCD&name=Bia&bot=auto&seed=3&speed=0.5&hoststart=4
```

1. O `index.html` preenche o código da sala (como já fazia com o QR code).
2. O bot digita o nome e espera o "Entrar" habilitar. Se a sala **ainda não existe**,
   por exemplo porque o Unity abriu as janelas antes do Play, ele redigita o código a cada 3s
   e espera até 10 minutos.
3. O bot toca "Entrar". O `app.js` registra o jogador como sempre e redireciona pra página do jogo,
   **repassando** `bot`, `seed`, `speed`, `tap` e `hoststart`.
4. Na página do jogo, o bot sobe de novo, agora com o cérebro do jogo ou com o macaco.

A entrada acontece **também em `bot=manual`**, porque entrar na sala é preparação, não jogada.

Atalho pra humanos: digitar o nome com o prefixo `bot:` (ex.: `bot:Bia`) entra como `bot=auto`
com o nome `Bia`.

---

## API: `window.Z3Bot`

Ela existe em `bot=auto` e `bot=manual`, tanto na tela de entrada quanto na página do jogo.
Todo retorno é um objeto JSON simples, seguro pra `returnByValue`.

```js
Z3Bot.version            // 1
Z3Bot.mode               // "auto" | "manual"
Z3Bot.setMode(mode)      // → { ok, mode } | { ok:false, reason:"invalid-mode" }
Z3Bot.setSpeed(x)        // → { ok, speed } | { ok:false, reason:"invalid-speed" }
Z3Bot.status()           // → objeto abaixo (síncrono)
Z3Bot.act(cmd, args)     // → Promise<{ ok:true, ... } | { ok:false, reason, detail }>
Z3Bot.flash(ms = 150)    // → Promise<{ ok, at, ms }>  flash branco em tela cheia
Z3Bot.tap(seletorOuEl)   // → Promise<{ ok, target } | { ok:false, reason }>  toque manual com indicador
Z3Bot.type(alvo, texto)  // → Promise<{ ok, target, text }>  digitação manual
Z3Bot.commands()         // → ["play", "draw", ..., "tap", "type", "flash", ...]
```

### `status()`

```js
{
  game: "MauMau",            // "Entry" na tela de entrada
  room: "ABCD", playerId: "…uuid…", name: "Bia",
  isHost: true,
  screen: "playingScreen",   // .screen.active (ou o primeiro "*Screen" visível)
  phase: "Playing:myTurn",   // fase segundo o cérebro (ou = screen)
  paused: false,             // #pauseOverlay ativo
  lastAction: { action: "tap", target: "#drawButton", at: 1731000000000 },
  mode: "auto", speed: 1, seed: 3, pace: 1.12,   // pace = ritmo pessoal (0.75–1.4)
  busy: false,               // agindo agora
  playerCount: 4,            // só no host com hoststart; senão null
  brain: "MauMau",           // ou "monkey"
  commands: [ ... ]
}
```

### `act(command, args)`

Os comandos passam por uma **fila**, um por vez. Um `act` corta a pausa de pensar do loop
automático, então dá pra usá-lo em `auto` também, sem os dois brigarem pela mesma tela.

Comandos que existem em qualquer jogo:

| Comando  | Args | Faz |
|----------|------|-----|
| `tap`    | `{ selector }` ou `{ target }` | toca no elemento |
| `type`   | `{ selector, text, clear?=true, perChar?=true }` | toca no campo e digita |
| `enter`  | `{ selector? }` | `keydown`/`keyup` de Enter |
| `flash`  | `{ ms? }` | igual a `Z3Bot.flash` |
| `status` | — | igual a `Z3Bot.status()` |
| `monkey` | — | faz **uma** ação do macaco agora |

Cada cérebro acrescenta os seus (ver [MauMau](#comandos-do-maumau)). Passe `{ think: true }`
(ou `"quick"`, `"long"`, `[min,max]` em ms) em qualquer `act` pra ele esperar uma pausa
"humana" antes de agir. Sem isso, o comando age na hora.

**Motivos de erro (`reason`) comuns:**

| reason | quando |
|--------|--------|
| `unknown-command` | o comando não existe (o retorno traz `commands`) |
| `paused` | o jogo está pausado (`#pauseOverlay`); passe `{ force: true }` pra ignorar |
| `not-found` / `hidden` / `disabled` / `covered` / `offscreen` / `stale` | o toque não foi possível: o elemento não existe, está invisível, desabilitado, coberto por outro elemento (ex.: overlay), não alcançável, ou a tela foi redesenhada no meio do toque |
| `timeout` | esperou algo aparecer na tela e não apareceu |
| `not-your-turn`, `not-playable`, `not-host`, `not-available`… | erros do cérebro (documentados por jogo) |

### `flash(ms)`

Cobre a tela de branco por `ms` milissegundos. `at` é o `Date.now()` do início.
Serve pra sincronizar a gravação de várias janelas: dispare o `flash` em todas de uma vez
e alinhe os vídeos pelo frame branco.

---

## Controle pelo Unity (CDP)

### Abrir as janelas

Uma janela do Edge por bot, cada uma com **perfil próprio** (isola sessão e processo)
e **porta própria** de depuração:

```
"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
  --app="https://<site>/index.html?room=ABCD&name=Bia&bot=auto&seed=1&hoststart=4"
  --window-size=390,844 --window-position=0,0
  --user-data-dir="%TEMP%\z3bot\Bia"
  --remote-debugging-port=9301
  --no-first-run --no-default-browser-check --disable-extensions
  --disable-background-timer-throttling
  --disable-renderer-backgrounding
  --disable-backgrounding-occluded-windows
```

- As três flags `--disable-*backgrounding*`/`throttling` são **importantes**. Sem elas,
  as janelas que não estão em foco têm os timers estrangulados e os bots ficam lentos.
- `--disable-extensions` evita ruído no console vindo das extensões internas do Edge.
- **Abra uma janela de cada vez, com ~500ms de intervalo, e o host primeiro.**
  O `app.js` decide o host com get+set sem transação, então dois jogadores entrando
  no mesmo instante podem os dois virar host.
- Com `--window-size`, a borda da janela conta, então o viewport fica um pouco menor.

### Achar a página e mandar comandos

1. `GET http://127.0.0.1:9301/json/list` → pegue a entrada com `"type": "page"` e use o
   `webSocketDebuggerUrl` dela.
2. Abra um WebSocket nessa URL (no Unity: `System.Net.WebSockets.ClientWebSocket`).
3. Mande `Runtime.evaluate` com `awaitPromise` e `returnByValue`:

```json
{ "id": 1, "method": "Runtime.evaluate", "params": {
    "expression": "Z3Bot.act('play', { card: '+2', target: 'Rafa' })",
    "awaitPromise": true, "returnByValue": true } }
```

A resposta vem em `result.result.value`, por exemplo `{ "ok": true, "played": "+2 Azul", "index": 3 }`.

- **Pronto pra receber comandos?** Rode `typeof Z3Bot !== 'undefined' && Z3Bot.status().game`
  até voltar o nome do jogo e não `"Entry"`. O redirecionamento da entrada pro jogo
  acontece **na mesma aba**: o target e o WebSocket continuam valendo, mas o `Z3Bot`
  é recriado na página nova.
- Se a página navegar no meio de um `evaluate`, a resposta vem com erro de contexto destruído.
  Tente de novo depois que o `Z3Bot` reaparecer.
- Strings com nomes de jogadores entram dentro do JS. Escape aspas, ou serialize os args
  com JSON: `"Z3Bot.act('play', " + json + ")"`.

### Exemplos

```js
Z3Bot.setMode("manual")                         // para o bot (pra roteirizar uma cena)
Z3Bot.act("state")                              // o que tem na mão, de quem é a vez…
Z3Bot.act("play", { card: "Curinga", color: "Azul" })
Z3Bot.act("play", { card: "Troca", target: "Rafa", think: true })
Z3Bot.flash(150)                                // em todas as janelas, pra sincronizar
Z3Bot.setMode("auto"); Z3Bot.setSpeed(0.2)      // volta a jogar sozinho, rápido
```

---

## Comandos do MauMau

Cérebro: [`MauMau/MauMau_bot.js`](../MauMau/MauMau_bot.js).

| Comando | Args | Faz |
|---------|------|-----|
| `play` | `{ card, color?, target? }` | toca na carta. Se for Curinga, escolhe a cor; se for Troca-Aqui, escolhe o alvo. |
| `draw` | — | toca COMPRAR (ou COMPRAR N sob ataque) |
| `pass` | — | toca PASSAR (só depois de comprar) |
| `color` | `{ color }` | escolhe a cor com o seletor do Curinga já aberto |
| `target` | `{ target }` | escolhe o alvo com o seletor da Troca-Aqui já aberto |
| `start` | — | (host) botão do host: "Começar Jogo" / "Jogar de Novo" |
| `tutorial` | `{ dir: "next" \| "prev" \| "skip" }` | (host) navega o tutorial |
| `state` | — | `{ gameState, myTurn, turnOf, topCard, activeColor, pendingDrawStack, awaitingDrawFollowUp, hand:[{index,label,type,color,value,playable}], swapTargets }` |
| `help` | — | lista os comandos |

**`card`** aceita:

- **número**: índice na mão (`0` = primeira), ou `{ index: 2 }`;
- **texto** (sem diferenciar acento ou maiúscula): `"+2"`, `"+2 azul"`, `"Curinga"`, `"Vermelho 5"`,
  `"5"`, `"azul"`, `"Bloqueio"`/`"Skip"`, `"Reverter"`, `"Embaralhar"`, `"Troca"`/`"Troca-Aqui"`.
  Num Curinga, a cor escrita é a **cor escolhida**: `"curinga azul"`;
- **objeto**: `{ type: "Number" | "DrawTwo" | "Wild" | "Skip" | "Reverse" | "Shuffle" | "Swap", color?, value? }`.

Se várias cartas casarem, o bot joga a primeira que estiver jogável. `color` aceita PT ou EN
(`"Azul"`, `"blue"`). `target` é o nome do jogador.

> O MauMau não tem +4. O equivalente é o `+2`, que empilha.

**Erros do `play`:** `not-playing`, `not-your-turn`, `missing-card`, `bad-card`,
`no-such-card` (o `detail.hand` lista a mão), `not-playable` (o `detail.hint` explica,
ex.: "sob ataque de +2: só +2 ou comprar"), `bad-color`, `target-not-found`
(o alvo é validado **antes** de tocar na carta; `detail.options` lista os alvos).

**Em `auto`:**

- **Lobby:** o host toca "Começar Jogo" quando houver ≥ `hoststart` jogadores.
- **Tutorial:** o host toca "Pular".
- **Na sua vez:**
  - Sob ataque de +2, empilha um +2 se tiver, senão compra.
  - Depois de comprar, joga a carta comprada (90%), senão passa.
  - No resto, escolhe a carta por peso, com sorteio pela seed. Ele prefere a cor ativa,
    cartas de ação e números altos, guarda o Curinga e só usa a Troca-Aqui com a mão cheia.
  - No Curinga, escolhe a cor que mais aparece na mão. Na Troca-Aqui, escolhe quem tem menos cartas.
  - Se a mesma jogada falhar duas vezes na mesma vez, compra ou passa.
- **Fim de jogo:** o host **não** aperta "Jogar de Novo" sozinho, pra não estragar uma gravação.
  Use `act("start")`.

---

## Comandos do Landlords

Cérebro: [`Landlords/Landlords_bot.js`](../Landlords/Landlords_bot.js). É um bot **burro de propósito**.

**Em `auto`:**

- **Comprar:** com caixa ≥ 3× o preço, compra. Entre 2× e 3×, tem 50% de chance (sorteio pela seed). Abaixo de 2×, não compra.
- **Lance em leilão:** usa a mesma regra com o próximo lance mínimo, e se não for dar lance, toca "Sair".
  Ele dá sempre o lance **mínimo** e nunca digita valor.
- **Leiloeiro:** leiloa o local livre (do governo) mais caro. Se não tiver nenhum livre, toca "Passar".
  Nunca leiloa os próprios locais.
- **Prisão:** nunca paga. Usa o Advogado se tiver, senão tenta a dupla.
- **Cartas guardadas:** usa na primeira chance que aparecer.
  - "Pista livre (1d20)": na próxima rolagem dele.
  - "Não valeu!": na próxima rolagem de **outro** jogador.
- **Construir:** só pelo atalho "construir aqui", quando para na própria casa, e só se o caixa for
  ≥ custo + $80. Ele repete enquanto sobrar. Nunca constrói pela aba Locais.
- **Turno:** nunca propõe troca e recusa toda proposta recebida. Na gestão do turno, depois de
  construir (se for o caso), toca "Encerrar turno". Se tirou dupla, rola de novo.
- **Dívida:** hipoteca do local mais barato pro mais caro. Se não tiver local, declara falência.
- **Morador local:** escolhe os 2 maiores dados.
- **Votação:** escolhe por sorteio pela seed. Na votação "continuar a partida?" (fim do tempo ou das
  rodadas), vota sempre **continuar**, pra jogar até alguém vencer ou sobrar só 1.
- **Lobby e tutorial:** o host começa com `hoststart` e pula o tutorial, como no MauMau.
  O "Pular decisão atual" do host nunca é tocado.
- **Abas:** o bot troca de aba sozinho quando precisa. As ações ficam em "Agora" e a hipoteca fica em "Locais".

| Comando | Args | Faz |
|---------|------|-----|
| `state` | — | fase, se é a minha vez, caixa, posição, cartas guardadas, meus locais, leilão, votação |
| `roll` | `{ d20?: true }` | rola, ou rola de novo na dupla. Com `d20`, usa a Pista livre |
| `buy` / `decline` | — | compra / não compra |
| `ok` | — | OK da carta, ou confirmar o aluguel |
| `endTurn` | — | encerra o turno |
| `jail` | `{ mode: "roll" \| "pay" \| "lawyer" }` | prisão |
| `bid` | `{ amount? }` | dá lance. Sem `amount`, dá o lance mínimo |
| `callout` | — | sai do leilão |
| `auction` | `{ place?: nome \| pos }` | leiloeiro escolhe o local. Sem `place`, escolhe o livre mais caro |
| `auctionPass` | — | não leiloa |
| `vote` | `{ choice: 0 \| 1 }` | vota |
| `pickDice` | `{ picks?: [i, j] }` | morador local. Sem `picks`, escolhe os 2 maiores |
| `reroll` | — | usa o "Não valeu!" |
| `build` | `{ place }` | constrói casa/hotel (pelo "construir aqui" ou pela aba Locais) |
| `mortgage` | `{ place }` | hipoteca, que abre a aba Locais |
| `bankrupt` | — | declara falência |
| `trade` | `{ accept: bool }` | responde a proposta recebida |
| `tab` | `{ tab: "agora" \| "locais" \| "placar" }` | troca de aba |
| `start` | — | (host) Começar Jogo / Jogar de Novo |

Erros: `not-available` (o botão não está na tela agora; o `detail` explica), `place-not-found`,
`not-yours`, `bad-mode`, `bad-choice`, `bad-tab`, `not-host`.

### Diálogos nativos (`confirm`/`alert`/`prompt`)

"Hipoteca" e "Declarar falência" usam o `confirm()` nativo, e nenhum toque no DOM consegue responder esse diálogo.
Quando o diálogo nasce **de um toque do próprio bot** (no `auto` ou num `act`/`tap`), o bot responde OK.
Pra responder Cancelar, use `Z3Bot.act("tap", { selector, confirm: false })`.
Se um humano tocar (em `bot=manual`), o diálogo aparece normal.

---

## O macaco (jogos sem cérebro)

Todo jogo carrega o bot. Os que não têm `<Jogo>_bot.js` usam o **macaco** genérico. A cada tela, ele:

1. preenche um campo vazio: um texto aleatório em `input`/`textarea`, ou um número entre
   `min` e `max` em `input[type=number]`, e aperta Enter se for `<input>`;
2. senão, toca um botão habilitado e visível aleatório (`button`, `[onclick]`, `[role=button]`…).

Fica de fora:

- elementos desabilitados, invisíveis ou cobertos (overlay);
- links e botões que navegam (`onclick` com `location`, `index.html`…);
- qualquer coisa dentro de `[data-bot="ignore"]`;
- o `#hostButton`, a menos que o bot seja host com `hoststart` e o lobby esteja cheio.
  Nesse caso o macaco toca o botão do host **em qualquer fase**, inclusive "Jogar de Novo".

Se a tela não mudar, ele tenta outro botão a cada 4s. Isso já serve de playtest básico:
mostra se dá pra chegar ao fim só tocando em coisas, e se algum toque quebra a página.

---

## Escrevendo um cérebro novo

### 1. Ligar na página do jogo

No fim de `<Jogo>_app.js`, cada jogo já tem esta linha (com o macaco):

```js
if(params.has("bot"))
{
  import("../bot/bot.js")
    .then((bot) => bot.StartBot({ game: "Stop" }))
    .catch((error) => console.error("[Z3Bot]", error));
}
```

Pra usar um cérebro, acrescente `brain` e, se precisar, `getState`. O `getState` devolve
**só leitura** das variáveis que a página já tem. Não mude a lógica do jogo:

```js
    .then((bot) => bot.StartBot(
    {
      game: "Stop",
      brain: () => import("./Stop_bot.js"),
      getState: () => ({ gameState: currentGameState, isHost, letter: currentLetter })
    }))
```

### 2. O arquivo `<Jogo>/<Jogo>_bot.js`

Esqueleto ilustrativo: os seletores e campos abaixo não são do Stop de verdade.
O exemplo completo e real é o [`MauMau/MauMau_bot.js`](../MauMau/MauMau_bot.js).

```js
export default
{
  name: "Stop",

  // OPCIONAL: string pro status().phase
  phase(ctx) { return ctx.state ? ctx.state.gameState : ctx.screen; },

  // Chamado a cada mudança no DOM e a cada 1s, em modo auto.
  // Retorna null (nada a fazer), "monkey" (deixa o macaco agir) ou uma decisão:
  decide(ctx)
  {
    const s = ctx.state;
    if(!s || s.gameState !== "Filling") return null;

    const field = ctx.bot.find("#fillingScreen input:placeholder-shown");
    if(!field) return null;

    const key = `fill|${s.round}|${field.dataset.category}`;   // descreve o estado

    return {
      key,                 // a mesma key não roda de novo antes de retryAfter
      think: "normal",     // "quick" | "normal" | "long" | [min,max] ms | número
      retryAfter: 6000,    // padrão 6000ms; se a ação FALHAR, tenta de novo em ~1s
      label: "preenche categoria",                 // vai pro log
      run: async (ctx) =>
      {
        const word = ctx.pick(["Banana", "Bola"], key);   // determinístico: seed + key
        await ctx.bot.type(field, word);
      }
    };
  },

  // OPCIONAL: comandos pro Z3Bot.act(nome, args). Pra erro, use ctx.bot.fail(reason, detail).
  commands:
  {
    async answer(ctx, { text }) { /* ... */ return { typed: text }; }
  }
};
```

**Como o loop funciona:**

1. O loop chama `decide`.
2. Se a `key` não estiver travada, ele espera a pausa `think`.
3. Ele chama `decide` **de novo**. Só se a `key` for a mesma é que roda o `run`
   da segunda decisão. Assim, se a tela mudou durante a pausa (outro jogador votou,
   o tempo acabou), o bot desiste em vez de agir em cima de uma tela velha.
4. Nada roda com o jogo pausado.

**Dicas:**

- A `key` deve mudar quando muda o que o bot deveria fazer: rodada, fase, conteúdo da tela.
  Não coloque ids de jogador ou timestamps nela, senão a mesma seed não reproduz as mesmas
  escolhas entre sessões.
- Pra escolhas, use `ctx.pick(lista, key)`, `ctx.pickWeighted(lista, pesoFn, key)` e
  `ctx.chance(p, key)`. Elas dependem só de seed + key.
- Decida pelo **estado** (`ctx.state`) ou pela tela, mas **aja tocando**.
- Na hora de ver se dá pra jogar, prefira `!button.disabled` a `isTappable`.
  Durante animações de entrada os elementos ficam invisíveis por um instante.
  O `tap` já espera e tenta de novo.
- Se o elemento é recriado o tempo todo (listas redesenhadas), procure-o de novo
  na hora de tocar e trate `e.reason === "stale"` tentando outra vez (veja `TapCard` no MauMau).
- `ctx.attempts(key)` diz quantas vezes essa `key` já rodou. Use pra mudar de ideia
  depois de uma falha.

**`ctx` tem:**

- `state`, `screen`, `paused`, `isHost`, `playerCount`, `playerId`, `name`, `config`, `mode`;
- `attempts(key)`, `rng(key)`, `pick`, `pickWeighted`, `chance`;
- `bot`, com as ferramentas:

| `ctx.bot.` | |
|---|---|
| `tap(el \| seletor)` | toque real com indicador (rola até o elemento; falha se coberto/desabilitado) |
| `type(el, texto, { clear, tapFirst, perChar })` | digita caractere a caractere, respeitando `maxlength` |
| `pressEnter(el)` | Enter |
| `find(seletor)` / `findAll(seletor)` | primeiro / todos os elementos **tocáveis** |
| `findByText(seletor, texto)` | tocável cujo texto bate (sem acento/caixa) |
| `isTappable` / `isVisible` / `isEnabled` | checagens |
| `waitFor(fn, timeoutMs)` | espera `fn()` ser truthy (falha com `timeout`) |
| `think(kind)` / `sleep(ms)` | pausa humana (escalada por speed e ritmo) / pausa fixa |
| `text(el)` / `normalize(str)` / `describe(el)` | utilitários |
| `fail(reason, detail)` | lança erro que vira `{ ok:false, reason, detail }` |
| `log(...)` | `console.log` com prefixo `[Z3Bot]` |

---

## Testando

### Local, sem Unity

ES modules não funcionam via `file://`, então sirva a pasta:

```
python -m http.server 8000
```

Abra `http://localhost:8000/index.html?room=ABCD&name=Bia&bot=auto`. O Firebase é o de
verdade, então a sala precisa existir, criada pelo Unity. Logs no console com `[Z3Bot]`.

### Com o Unity

1. Abra o projeto Unity, entre em **Play** com o MauMau e anote o código da sala na TV
   (ex.: `ABCD`).
2. Sirva este repo (`python -m http.server 8000`) ou use o site publicado.
3. Abra N abas ou janelas, **uma de cada vez, o host primeiro**:
   ```
   http://localhost:8000/index.html?room=ABCD&name=Bia&bot=auto&seed=1&speed=0.5&hoststart=4
   http://localhost:8000/index.html?room=ABCD&name=Rafa&bot=auto&seed=2&speed=0.5
   http://localhost:8000/index.html?room=ABCD&name=Caio&bot=auto&seed=3&speed=0.5
   http://localhost:8000/index.html?room=ABCD&name=Duda&bot=auto&seed=4&speed=0.5
   ```
   A primeira a entrar vira host. Com `hoststart=4`, ela começa a partida quando os 4 estiverem no lobby.
4. **Abas de fundo:** o Chrome e o Edge estrangulam os timers de abas que não estão visíveis,
   e os bots ficam lentos. Pra playtest, use **janelas separadas** (lado a lado) ou as flags
   da seção [CDP](#abrir-as-janelas).
5. Pra controlar à mão: `bot=manual` e, no console da aba, `await Z3Bot.act("state")`,
   `await Z3Bot.act("play", { card: "+2" })` etc.

## Limitações conhecidas

- O determinismo vale por decisão: mesma seed + mesmo estado = mesma escolha. Uma partida
  inteira só se repete se o host (Unity) também for determinístico, porque ele embaralha o baralho.
- O `app.js` escolhe o host com get+set sem transação (bug antigo, fora do escopo).
  Abra as janelas em sequência.
- O nome entra na URL do jogo sem `encodeURIComponent`, então nomes com `&` ou `#` quebram
  (comportamento antigo, mantido).
