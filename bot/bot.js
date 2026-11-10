// =========================
// Z3Bot — MODO BOT DO CLIENT WEB (contrato completo em bot/README.md)
//
// Só é carregado via import() dinâmico quando a URL tem ?bot=… — jogador
// normal nunca baixa este arquivo.
//
// REGRA PRINCIPAL: o bot age SÓ pela interface (toques e digitação nos
// mesmos elementos que um humano usa). NUNCA escreve no Firebase. A única
// coisa que ele faz no Firebase é LER (quem é host, quantos jogadores tem
// no lobby pro ?hoststart=N), usando o app que a própria página já abriu.
// =========================

const FIREBASE_APP_URL =
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

const FIREBASE_DB_URL =
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const urlParams =
  new URLSearchParams(window.location.search);

function Log(...args)
{
  console.log("[Z3Bot]", ...args);
}

function Warn(...args)
{
  console.warn("[Z3Bot]", ...args);
}


// =========================
// RNG COM SEED
// Escolhas usam RngFor(chave): a sequência depende só de seed + chave (a
// chave descreve o estado), então mesma seed + mesmo estado = mesma escolha,
// não importa o que aconteceu antes. Pausas usam uma sequência separada.
// =========================

function HashString(str)
{
  let h = 2166136261 >>> 0;

  for(let i = 0; i < str.length; i++)
  {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }

  return h >>> 0;
}

function Mulberry32(seed)
{
  let a = seed >>> 0;

  return function()
  {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}


// =========================
// CONFIG (parâmetros de URL)
// =========================

function ParseSpeed(raw)
{
  const value = parseFloat(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

const seedFromUrl =
  parseInt(urlParams.get("seed"), 10);

const config =
{
  mode: urlParams.get("bot") === "manual" ? "manual" : "auto",
  seed: Number.isFinite(seedFromUrl) ? seedFromUrl : Math.floor(Math.random() * 1e9),
  speed: ParseSpeed(urlParams.get("speed")) ?? 1,
  tapIndicator: urlParams.get("tap") !== "0",
  hostStart: Math.max(0, parseInt(urlParams.get("hoststart"), 10) || 0),
  room: (urlParams.get("room") || "").toUpperCase().trim(),
  name: (urlParams.get("name") || "").trim(),
  playerId: urlParams.get("id") || ""
};

// RITMO PESSOAL (0.75x–1.4x): cada bot pensa num ritmo levemente diferente,
// pra que votos/jogadas cheguem um por um em vez de todos juntos. Depende de
// seed + nome, então é o mesmo na tela de entrada e na do jogo.
const pace =
  0.75 + Mulberry32(HashString(`${config.seed}|pace|${config.name}`))() * 0.65;

const timingRng =
  Mulberry32(HashString(`${config.seed}|timing|${config.name}|${config.playerId}`));

function RngFor(key)
{
  return Mulberry32(HashString(`${config.seed}|${key}`));
}

function Pick(list, key)
{
  if(!list || list.length === 0) return undefined;
  return list[Math.floor(RngFor(key)() * list.length)];
}

function PickWeighted(list, weightOf, key)
{
  if(!list || list.length === 0) return undefined;

  const weights = list.map(item => Math.max(0, Number(weightOf(item)) || 0));
  const total = weights.reduce((a, b) => a + b, 0);

  if(total <= 0) return Pick(list, key);

  let roll = RngFor(key)() * total;

  for(let i = 0; i < list.length; i++)
  {
    roll -= weights[i];
    if(roll < 0) return list[i];
  }

  return list[list.length - 1];
}

function Chance(probability, key)
{
  return RngFor(key)() < probability;
}


// =========================
// PAUSAS "DE PENSAR" (interrompíveis — um act() corta a pausa do loop)
// =========================

const ThinkPresets =
{
  quick:  [250, 700],
  normal: [700, 2000],
  long:   [1500, 3800]
};

function ThinkMs(kind = "normal")
{
  let range = ThinkPresets.normal;

  if(Array.isArray(kind)) range = kind;
  else if(typeof kind === "number") range = [kind, kind];
  else if(ThinkPresets[kind]) range = ThinkPresets[kind];

  const [min, max] = range;

  return (min + timingRng() * (max - min)) * pace * config.speed;
}

function Sleep(ms)
{
  return new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
}

let interruptThink = null;

function Think(kind)
{
  const ms = ThinkMs(kind);

  return new Promise(resolve =>
  {
    const timer = setTimeout(done, Math.max(0, ms));

    function done()
    {
      clearTimeout(timer);
      if(interruptThink === done) interruptThink = null;
      resolve();
    }

    interruptThink = done;
  });
}

function InterruptThink()
{
  if(interruptThink) interruptThink();
}


// =========================
// ERROS (viram { ok:false, reason, detail } no act())
// =========================

class BotError extends Error
{
  constructor(reason, detail)
  {
    super(reason);
    this.reason = reason;
    this.detail = detail;
  }
}

function Fail(reason, detail)
{
  throw new BotError(reason, detail);
}


// =========================
// DOM: ACHAR ELEMENTOS VISÍVEIS E HABILITADOS
// =========================

function Resolve(target)
{
  if(!target) return null;
  if(target instanceof Element) return target;
  if(typeof target === "string") return document.querySelector(target);
  return null;
}

// OPACIDADE 0 em si ou num ancestral = invisível. EXCEÇÃO: com a aba/janela
// escondida (document.hidden), o navegador congela as animações CSS — um
// fadeIn de entrada fica parado em opacity 0 pra sempre. Nesse caso, opacidade
// vinda de animação em andamento não conta (o elemento "já teria aparecido").
function HasZeroOpacity(el)
{
  for(let e = el; e && e.nodeType === 1; e = e.parentElement)
  {
    if(parseFloat(getComputedStyle(e).opacity) !== 0) continue;

    const frozenAnimation = document.hidden
      && typeof e.getAnimations === "function"
      && e.getAnimations().some(a => a.playState === "running");

    if(!frozenAnimation) return true;
  }

  return false;
}

function IsVisible(el)
{
  if(!el || !el.isConnected) return false;

  if(typeof el.checkVisibility === "function")
  {
    if(!el.checkVisibility({ visibilityProperty: true })) return false;
  }
  else
  {
    const style = getComputedStyle(el);
    if(style.display === "none" || style.visibility === "hidden") return false;
  }

  if(HasZeroOpacity(el)) return false;

  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function IsEnabled(el)
{
  if(!el) return false;
  if(el.matches(":disabled")) return false;
  if(el.closest("[aria-disabled='true'], [inert]")) return false;
  if(getComputedStyle(el).pointerEvents === "none") return false;
  return true;
}

// PARTE DO ELEMENTO QUE APARECE DE VERDADE: recorta pela janela e por todo
// ancestral com overflow (ex.: a mão do MauMau rola na horizontal — uma
// carta pode estar "dentro da janela" mas cortada pelo container).
// null = nada aparece (precisa rolar). fraction = quanto do elemento aparece.
function VisibleRect(el)
{
  const rect = el.getBoundingClientRect();
  if(rect.width <= 0 || rect.height <= 0) return null;

  let left = Math.max(rect.left, 0);
  let top = Math.max(rect.top, 0);
  let right = Math.min(rect.right, window.innerWidth);
  let bottom = Math.min(rect.bottom, window.innerHeight);

  if(getComputedStyle(el).position !== "fixed")
  {
    for(let a = el.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement)
    {
      const style = getComputedStyle(a);
      const clipX = style.overflowX !== "visible";
      const clipY = style.overflowY !== "visible";
      if(!clipX && !clipY) continue;

      const ar = a.getBoundingClientRect();
      if(clipX) { left = Math.max(left, ar.left); right = Math.min(right, ar.right); }
      if(clipY) { top = Math.max(top, ar.top); bottom = Math.min(bottom, ar.bottom); }
    }
  }

  const width = right - left;
  const height = bottom - top;
  if(width < 1 || height < 1) return null;

  return { left, top, width, height, fraction: (width * height) / (rect.width * rect.height) };
}

function PointIn(visible, jitter)
{
  const fx = 0.5 + (jitter ? (timingRng() - 0.5) * 0.4 : 0);
  const fy = 0.5 + (jitter ? (timingRng() - 0.5) * 0.4 : 0);

  return { x: visible.left + visible.width * fx, y: visible.top + visible.height * fy };
}

function ScrollIntoReach(el)
{
  el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
}

// O ELEMENTO ESTÁ "POR CIMA" no ponto? (overlay de pausa, seletor de cor etc.
// bloqueiam o toque igual bloqueariam um dedo de verdade)
function HitAt(el, point)
{
  const hit = document.elementFromPoint(point.x, point.y);
  return hit && (hit === el || el.contains(hit)) ? hit : null;
}

function IsTappable(el)
{
  if(!IsVisible(el) || !IsEnabled(el)) return false;

  // FORA DA TELA (lista com scroll): assume que dá — o tap rola até ele e
  // aí confere de verdade se não tem nada por cima.
  const visible = VisibleRect(el);
  if(!visible) return true;

  return !!HitAt(el, PointIn(visible, false));
}

function Tappables(selector, root = document)
{
  return [...root.querySelectorAll(selector)].filter(IsTappable);
}

function Find(selector, root = document)
{
  return Tappables(selector, root)[0] || null;
}

function Normalize(str)
{
  return String(str ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function TextOf(el)
{
  if(!el) return "";
  return (el.innerText || el.value || el.getAttribute("aria-label") || "")
    .replace(/\s+/g, " ")
    .trim();
}

// PRIMEIRO ELEMENTO TOCÁVEL cujo texto contém `text` (sem acento/caixa).
function FindByText(selector, text, root = document)
{
  const wanted = Normalize(text);
  const list = Tappables(selector, root);
  return list.find(el => Normalize(TextOf(el)) === wanted)
    || list.find(el => Normalize(TextOf(el)).includes(wanted))
    || null;
}

function Describe(el)
{
  if(!el) return "?";
  if(el.id) return `#${el.id}`;

  const text = TextOf(el).slice(0, 30);
  return `${el.tagName.toLowerCase()}${text ? ` "${text}"` : ""}`;
}

async function WaitFor(fn, timeoutMs = 3000, intervalMs = 80)
{
  const start = Date.now();

  while(true)
  {
    const value = fn();
    if(value) return value;
    if(Date.now() - start > timeoutMs) Fail("timeout");
    await Sleep(intervalMs);
  }
}

function ActiveScreen()
{
  const active =
    [...document.querySelectorAll(".screen.active")].find(IsVisible)
    || document.querySelector(".screen.active");

  if(active) return active.id || "screen";

  // JOGOS SEM .screen (ChaosCourt, ColorsIn…): primeiro "*Screen" visível.
  const candidate =
    [...document.querySelectorAll("[id$='Screen'], [id$='screen']")].find(IsVisible);

  return candidate ? candidate.id : null;
}

function IsPaused()
{
  const overlay = document.getElementById("pauseOverlay");
  return !!overlay && (overlay.classList.contains("active") || IsVisible(overlay));
}


// =========================
// INDICADOR DE TOQUE + FLASH
// =========================

let stylesInjected = false;

function InjectStyles()
{
  if(stylesInjected) return;
  stylesInjected = true;

  const style = document.createElement("style");
  style.id = "z3bot-style";
  style.textContent = `
    .z3bot-tap {
      position: fixed; width: 46px; height: 46px; margin: -23px 0 0 -23px;
      border-radius: 50%; pointer-events: none; z-index: 2147483647;
      background: rgba(255,255,255,.38);
      border: 3px solid rgba(255,255,255,.95);
      box-shadow: 0 0 0 2px rgba(0,0,0,.22), 0 2px 10px rgba(0,0,0,.3);
      animation: z3botTap .5s ease-out forwards;
    }
    @keyframes z3botTap {
      0%   { transform: scale(.45); opacity: 1; }
      35%  { transform: scale(.8);  opacity: 1; }
      100% { transform: scale(1.35); opacity: 0; }
    }
    .z3bot-flash {
      position: fixed; inset: 0; background: #fff;
      pointer-events: none; z-index: 2147483647;
    }`;

  document.head.appendChild(style);
}

function ShowTapIndicator(x, y)
{
  if(!config.tapIndicator) return;

  const dot = document.createElement("div");
  dot.className = "z3bot-tap";
  dot.style.left = `${x}px`;
  dot.style.top = `${y}px`;
  document.body.appendChild(dot);

  setTimeout(() => dot.remove(), 560);
}

function Flash(ms = 150)
{
  InjectStyles();

  const duration = Math.max(16, Number(ms) || 150);
  const at = Date.now();

  const overlay = document.createElement("div");
  overlay.className = "z3bot-flash";
  document.body.appendChild(overlay);

  return new Promise(resolve =>
  {
    setTimeout(() =>
    {
      overlay.remove();
      resolve({ ok: true, at, ms: duration });
    }, duration);
  });
}


// =========================
// TOCAR E DIGITAR (eventos reais no elemento, como um dedo faria)
// =========================

let lastAction = null;

function RecordAction(action, target, extra)
{
  lastAction = { action, target, at: Date.now(), ...(extra || {}) };
  Log(action, target, extra ?? "");
}

function IsTextField(el)
{
  return el.matches("input, textarea, select, [contenteditable='true']");
}

// DIÁLOGOS NATIVOS: confirm()/alert()/prompt() bloqueiam a página e nenhum
// toque no DOM responde. Se o diálogo nasce DENTRO de um toque do bot, o bot
// responde (confirm = OK, a menos que o toque peça { confirm: false }). Se
// foi um humano tocando (bot=manual), o diálogo aparece normal.
let botClickDepth = 0;
let botConfirmAnswer = true;

function InstallDialogHooks()
{
  const nativeConfirm = window.confirm;
  const nativeAlert = window.alert;
  const nativePrompt = window.prompt;

  window.confirm = function(message)
  {
    if(botClickDepth === 0) return nativeConfirm.call(window, message);
    RecordAction("confirm", String(message ?? "").slice(0, 80), { answer: botConfirmAnswer });
    return botConfirmAnswer;
  };

  window.alert = function(message)
  {
    if(botClickDepth === 0) return nativeAlert.call(window, message);
    RecordAction("alert", String(message ?? "").slice(0, 80));
  };

  window.prompt = function(message, defaultValue)
  {
    if(botClickDepth === 0) return nativePrompt.call(window, message, defaultValue);
    RecordAction("prompt", String(message ?? "").slice(0, 80));
    return botConfirmAnswer ? (defaultValue ?? "") : null;
  };
}

async function Tap(target, { jitter = true, confirm = true } = {})
{
  const el = Resolve(target);

  if(!el) Fail("not-found", String(target));
  if(!IsVisible(el)) Fail("hidden", Describe(el));
  if(!IsEnabled(el)) Fail("disabled", Describe(el));

  // CORTADO OU FORA DA TELA: rola até ele, como um humano rolaria.
  let visible = VisibleRect(el);

  if(!visible || visible.fraction < 0.6)
  {
    ScrollIntoReach(el);
    visible = VisibleRect(el);
  }

  if(!visible) Fail("offscreen", Describe(el));

  let point = PointIn(visible, jitter);
  let hit = HitAt(el, point);

  if(!hit)
  {
    point = PointIn(visible, false);
    hit = HitAt(el, point);
  }

  if(!hit)
  {
    // PODE ESTAR NO MEIO DE UMA ANIMAÇÃO (carta entrando etc.)
    await Sleep(220);
    if(!el.isConnected) Fail("stale", Describe(el));
    visible = VisibleRect(el);
    if(!visible) Fail("offscreen", Describe(el));
    point = PointIn(visible, false);
    hit = HitAt(el, point);
  }

  if(!hit) Fail("covered", Describe(el));

  const base =
  {
    bubbles: true, cancelable: true, composed: true, view: window,
    clientX: point.x, clientY: point.y,
    screenX: point.x + window.screenX, screenY: point.y + window.screenY,
    button: 0
  };

  const pointer =
  {
    ...base, pointerId: 1, pointerType: "touch", isPrimary: true,
    width: 18, height: 18
  };

  ShowTapIndicator(point.x, point.y);

  hit.dispatchEvent(new PointerEvent("pointerdown", { ...pointer, buttons: 1, pressure: 0.5 }));
  hit.dispatchEvent(new MouseEvent("mousedown", { ...base, buttons: 1 }));

  if(IsTextField(el)) el.focus({ preventScroll: true });

  await Sleep(60 + timingRng() * 70);

  // A TELA PODE TER SE REDESENHADO ENTRE O "DEDO DESCER" E "SUBIR" — igual
  // num celular, aí o toque não vale.
  if(!hit.isConnected) hit = el;
  if(!el.isConnected) Fail("stale", Describe(el));

  hit.dispatchEvent(new PointerEvent("pointerup", { ...pointer, buttons: 0, pressure: 0 }));
  hit.dispatchEvent(new MouseEvent("mouseup", { ...base, buttons: 0 }));

  if(!IsEnabled(el)) Fail("disabled", Describe(el));

  // Registra antes do click: um confirm() disparado pelo click aparece
  // depois do tap no lastAction/log, na ordem em que aconteceu.
  RecordAction("tap", Describe(el));

  botConfirmAnswer = confirm !== false;
  botClickDepth++;

  try { hit.dispatchEvent(new MouseEvent("click", { ...base, buttons: 0, detail: 1 })); }
  finally { botClickDepth--; }

  return { ok: true, target: Describe(el) };
}

function SetNativeValue(el, value)
{
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;

  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;

  if(setter) setter.call(el, value);
  else el.value = value;
}

// DIGITA caractere por caractere (keydown → valor → input → keyup), respeita
// maxlength e termina com "change". { perChar:false } cola o texto de uma vez.
async function Type(target, text, { clear = true, tapFirst = true, perChar = true } = {})
{
  const el = Resolve(target);

  if(!el) Fail("not-found", String(target));
  if(!IsVisible(el)) Fail("hidden", Describe(el));
  if(el.disabled || el.readOnly) Fail("disabled", Describe(el));

  if(tapFirst) await Tap(el, { jitter: false });
  else el.focus({ preventScroll: true });

  const content = String(text ?? "");
  const max = el.maxLength > 0 ? el.maxLength : Infinity;

  let value = clear ? "" : el.value;

  if(clear && el.value !== "")
  {
    SetNativeValue(el, "");
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));
  }

  if(!perChar)
  {
    value = (value + content).slice(0, max === Infinity ? undefined : max);
    SetNativeValue(el, value);
    el.dispatchEvent(new InputEvent("input", { bubbles: true, data: content, inputType: "insertFromPaste" }));
  }
  else
  {
    for(const ch of content)
    {
      if(value.length + ch.length > max) break;

      const allowed =
        el.dispatchEvent(new KeyboardEvent("keydown", { key: ch, bubbles: true, cancelable: true }));

      if(allowed)
      {
        value += ch;
        SetNativeValue(el, value);
        el.dispatchEvent(new InputEvent("input", { bubbles: true, data: ch, inputType: "insertText" }));
      }

      el.dispatchEvent(new KeyboardEvent("keyup", { key: ch, bubbles: true }));

      await Sleep((35 + timingRng() * 90) * pace * config.speed);
    }
  }

  el.dispatchEvent(new Event("change", { bubbles: true }));

  RecordAction("type", Describe(el), { text: el.value });

  return { ok: true, target: Describe(el), text: el.value };
}

function PressEnter(target)
{
  const el = Resolve(target) || document.activeElement;
  if(!el) Fail("not-found", String(target));

  const opts = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true };
  el.dispatchEvent(new KeyboardEvent("keydown", opts));
  el.dispatchEvent(new KeyboardEvent("keyup", opts));

  RecordAction("enter", Describe(el));
  return { ok: true, target: Describe(el) };
}


// =========================
// FIREBASE — SÓ LEITURA (usa o app que a página já inicializou)
// =========================

const roomInfo = { isHost: null, playerCount: null };

let firebase = null;

async function GetFirebase()
{
  if(firebase) return firebase;

  const [appModule, dbModule] =
    await Promise.all([import(FIREBASE_APP_URL), import(FIREBASE_DB_URL)]);

  const app = appModule.getApps()[0];
  if(!app) return null;

  firebase =
  {
    db: dbModule.getDatabase(app),
    ref: dbModule.ref,
    get: dbModule.get,
    onValue: dbModule.onValue
  };

  return firebase;
}

async function WatchRoomInfo()
{
  if(!config.room || !config.playerId) return;

  const fb = await GetFirebase();
  if(!fb) return;

  const hostSnapshot =
    await fb.get(fb.ref(fb.db, `rooms/${config.room}/players/${config.playerId}/isHost`));

  roomInfo.isHost = hostSnapshot.val() === true;

  // CONTAGEM DO LOBBY: só o host com ?hoststart=N precisa.
  if(roomInfo.isHost && config.hostStart > 0)
  {
    fb.onValue(fb.ref(fb.db, `rooms/${config.room}/players`), (snapshot) =>
    {
      roomInfo.playerCount = snapshot.size;
      Schedule();
    });
  }

  Schedule();
}


// =========================
// MACACO — fallback genérico pra jogos sem cérebro: preenche campo de texto
// vazio com uma palavra qualquer, senão toca um botão habilitado aleatório.
// =========================

const MonkeySelector =
  "button, input[type=button], input[type=submit], [role=button], [onclick]";

const MonkeyTextSelector =
  "input[type=text], input:not([type]), input[type=search], input[type=number], textarea";

const MonkeyWords =
[
  "banana", "pizza", "dinossauro", "geladeira", "abacaxi", "tartaruga",
  "chocolate", "foguete", "cachorro quente", "unicórnio", "sim", "talvez",
  "minha avó", "pastel de feira", "um pato", "vinte reais"
];

function MonkeyNumber(field, key)
{
  const min = Number.isFinite(parseFloat(field.min)) ? Math.ceil(parseFloat(field.min)) : 1;
  const max = Number.isFinite(parseFloat(field.max)) ? Math.floor(parseFloat(field.max)) : min + 9;

  return String(min + Math.floor(RngFor(key)() * (Math.max(max, min) - min + 1)));
}

function IsNavigationElement(el)
{
  if(el.tagName === "A") return true;
  const onclick = el.getAttribute("onclick") || "";
  return /location|index\.html|history\.|reload/i.test(onclick);
}

function MonkeyButtons(ctx)
{
  const list = Tappables(MonkeySelector).filter(el =>
  {
    if(el.closest("[data-bot='ignore']")) return false;
    if(IsNavigationElement(el)) return false;

    // BOTÃO DO HOST: só com ?hoststart=N e lobby cheio (vale pra qualquer
    // estado do botão: começar, próxima rodada, jogar de novo…).
    if(el.id === "hostButton")
    {
      return ctx.isHost && config.hostStart > 0 && (ctx.playerCount ?? 0) >= config.hostStart;
    }

    return true;
  });

  // [onclick] dentro de <button> etc.: fica só o mais externo.
  return list.filter(el => !list.some(other => other !== el && other.contains(el)));
}

function MonkeyDecide(ctx)
{
  const emptyFields =
    Tappables(MonkeyTextSelector)
    .filter(el => !el.readOnly && !el.value.trim() && !el.closest("[data-bot='ignore']"));

  const buttons = MonkeyButtons(ctx);

  if(emptyFields.length === 0 && buttons.length === 0) return null;

  const key =
    `monkey|${ctx.screen}|${emptyFields.length}|${buttons.map(Describe).join(",")}`;

  const choiceKey = `${key}#${ctx.attempts(key)}`;

  if(emptyFields.length > 0)
  {
    const field = emptyFields[0];
    const word = field.type === "number" ? MonkeyNumber(field, choiceKey) : Pick(MonkeyWords, choiceKey);

    // <input> costuma enviar com Enter; <textarea> não (Enter = nova linha).
    return {
      key, think: "normal", retryAfter: 4000,
      label: `macaco digita "${word}" em ${Describe(field)}`,
      run: async () =>
      {
        await Type(field, word);
        if(field.tagName === "INPUT" && field.isConnected) PressEnter(field);
      }
    };
  }

  const button = Pick(buttons, choiceKey);

  return {
    key, think: "normal", retryAfter: 4000,
    label: `macaco toca ${Describe(button)}`,
    run: () => Tap(button)
  };
}


// =========================
// LOOP (MutationObserver + checagem periódica, com trava por chave)
// Cérebro: decide(ctx) → null (nada a fazer) | "monkey" | { key, run, think,
// retryAfter, label }. A mesma chave não roda de novo antes de retryAfter ms.
// =========================

let gameName = "Entry";
let brain = null;
let getState = null;
let loopStarted = false;
let busy = false;
let tickQueued = false;
let actPending = 0;

const doneKeys = new Map(); // key -> { at, attempts }

function Attempts(key)
{
  return doneKeys.get(key)?.attempts || 0;
}

function SafeState()
{
  if(!getState) return null;

  try { return getState(); }
  catch(e) { Warn("getState falhou:", e); return null; }
}

function MakeContext()
{
  const state = SafeState();

  return {
    state,
    game: gameName,
    screen: ActiveScreen(),
    paused: IsPaused(),
    isHost: (state && state.isHost === true) || roomInfo.isHost === true,
    playerCount: roomInfo.playerCount,
    playerId: config.playerId,
    name: config.name,
    config: { ...config },
    mode: config.mode,
    attempts: Attempts,
    rng: RngFor,
    pick: Pick,
    pickWeighted: PickWeighted,
    chance: Chance,
    bot: BotTools
  };
}

function Decide(ctx)
{
  if(brain && typeof brain.decide === "function")
  {
    const decision = brain.decide(ctx);
    if(decision === "monkey") return MonkeyDecide(ctx);
    return decision || null;
  }

  return MonkeyDecide(ctx);
}

function Schedule(delay = 120)
{
  if(tickQueued) return;
  tickQueued = true;

  setTimeout(() =>
  {
    tickQueued = false;
    Tick();
  }, delay);
}

function PruneKeys()
{
  const limit = Date.now() - 5 * 60 * 1000;
  for(const [key, entry] of doneKeys) if(entry.at < limit) doneKeys.delete(key);
}

async function Tick()
{
  if(!loopStarted || config.mode !== "auto" || busy || actPending > 0) return;

  let ctx = MakeContext();
  if(ctx.paused) return;

  let decision;

  try { decision = Decide(ctx); }
  catch(e) { Warn("decide() falhou:", e); return; }

  if(!decision || !decision.key || typeof decision.run !== "function") return;

  const retryAfter = decision.retryAfter ?? 6000;
  const previous = doneKeys.get(decision.key);

  if(previous && Date.now() - previous.at < retryAfter) return;

  PruneKeys();

  busy = true;
  doneKeys.set(decision.key, { at: Date.now(), attempts: (previous?.attempts || 0) + 1 });

  try
  {
    await Think(decision.think ?? "normal");

    // DURANTE A PAUSA: virou manual, chegou um act(), ou a tela mudou →
    // desiste sem agir (a chave é liberada pra decidir de novo).
    if(config.mode !== "auto" || actPending > 0)
    {
      doneKeys.delete(decision.key);
      return;
    }

    ctx = MakeContext();

    const again = ctx.paused ? null : Decide(ctx);

    if(!again || again.key !== decision.key)
    {
      doneKeys.delete(decision.key);
      return;
    }

    if(again.label) Log(again.label);

    await again.run(ctx);

    doneKeys.set(decision.key, { at: Date.now(), attempts: doneKeys.get(decision.key)?.attempts || 1 });
  }
  catch(e)
  {
    Warn(`ação "${decision.key}" falhou:`, e.reason || e.message || e, e.detail ?? "");

    // FALHOU: libera a chave pra tentar de novo em ~1s (não espera o
    // retryAfter inteiro); o cérebro vê attempts() subir e pode mudar de ideia.
    const entry = doneKeys.get(decision.key);
    if(entry) entry.at = Date.now() - retryAfter + 1000;
  }
  finally
  {
    busy = false;
    Schedule(250);
  }
}

function StartLoop()
{
  if(loopStarted) return;
  loopStarted = true;

  new MutationObserver(() => Schedule()).observe(document.documentElement,
  {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["class", "style", "disabled", "hidden"]
  });

  setInterval(() => Schedule(0), 1000);

  Schedule(400);
}


// =========================
// API DE CONTROLE — window.Z3Bot (contrato com o Unity, ver README)
// =========================

const BotTools =
{
  tap: Tap,
  type: Type,
  pressEnter: PressEnter,
  find: Find,
  findAll: Tappables,
  findByText: FindByText,
  isTappable: IsTappable,
  isVisible: IsVisible,
  isEnabled: IsEnabled,
  waitFor: WaitFor,
  think: Think,
  sleep: Sleep,
  text: TextOf,
  normalize: Normalize,
  describe: Describe,
  flash: Flash,
  fail: Fail,
  log: Log
};

const BuiltinCommands =
{
  tap: (ctx, args) => Tap(args.selector ?? args.target, { confirm: args.confirm }),
  type: (ctx, args) => Type(args.selector ?? args.target, args.text, args),
  enter: (ctx, args) => PressEnter(args.selector ?? args.target),
  flash: (ctx, args) => Flash(args.ms),
  status: () => Status(),
  monkey: async (ctx) =>
  {
    const decision = MonkeyDecide(ctx);
    if(!decision) Fail("nothing-to-do");
    return decision.run(ctx);
  }
};

function CommandList()
{
  const own = brain && brain.commands ? Object.keys(brain.commands) : [];
  return [...new Set([...own, ...Object.keys(BuiltinCommands)])];
}

function Plain(value)
{
  try { return JSON.parse(JSON.stringify(value ?? null)); }
  catch { return { ok: false, reason: "unserializable" }; }
}

function Status()
{
  const ctx = MakeContext();

  let phase = null;

  try { phase = brain && brain.phase ? brain.phase(ctx) : null; }
  catch(e) { Warn("phase() falhou:", e); }

  return Plain(
  {
    game: gameName,
    room: config.room,
    playerId: config.playerId || null,
    name: config.name,
    isHost: ctx.isHost,
    screen: ctx.screen,
    phase: phase ?? ctx.screen,
    paused: ctx.paused,
    lastAction,
    mode: config.mode,
    speed: config.speed,
    seed: config.seed,
    pace: Math.round(pace * 100) / 100,
    busy: busy || actPending > 0,
    playerCount: roomInfo.playerCount,
    brain: brain ? (brain.name || gameName) : "monkey",
    commands: CommandList()
  });
}

// COMANDOS PASSAM NUMA FILA: um por vez, e corta a pausa de pensar do loop
// automático pra não brigarem pela mesma tela.
let actQueue = Promise.resolve();

function Act(command, args = {})
{
  actPending++;
  InterruptThink();

  const run = actQueue.then(() => RunAct(command, args || {}));
  actQueue = run.catch(() => {});
  return run;
}

async function RunAct(command, args)
{
  try
  {
    const handler =
      (brain && brain.commands && brain.commands[command]) || BuiltinCommands[command];

    if(!handler)
    {
      return { ok: false, reason: "unknown-command", command, commands: CommandList() };
    }

    while(busy) await Sleep(40);
    busy = true;

    const ctx = MakeContext();

    if(ctx.paused && !["flash", "status", "state", "help"].includes(command) && !args.force)
    {
      return { ok: false, reason: "paused" };
    }

    if(args.think) await Think(args.think === true ? "normal" : args.think);

    const result = await handler(ctx, args);

    let out;

    if(result && typeof result === "object" && "ok" in result) out = result;
    else if(result && typeof result === "object") out = { ok: true, ...result };
    else if(result !== undefined) out = { ok: true, value: result };
    else out = { ok: true };

    out = Plain(out);
    Log(`act("${command}") →`, out);
    return out;
  }
  catch(e)
  {
    const out = Plain({ ok: false, reason: e.reason || "error", detail: e.detail ?? e.message ?? String(e) });
    Warn(`act("${command}") →`, out);
    return out;
  }
  finally
  {
    busy = false;
    actPending--;
    Schedule(250);
  }
}

function SetMode(mode)
{
  if(mode !== "auto" && mode !== "manual")
  {
    return { ok: false, reason: "invalid-mode", detail: "use \"auto\" ou \"manual\"" };
  }

  config.mode = mode;
  Log("modo:", mode);

  if(mode === "auto") Schedule(0);
  else InterruptThink();

  return { ok: true, mode };
}

function SetSpeed(multiplier)
{
  const value = ParseSpeed(multiplier);
  if(value === null) return { ok: false, reason: "invalid-speed" };

  config.speed = value;
  Log("speed:", value);
  return { ok: true, speed: value };
}

let installed = false;

function Install()
{
  if(installed) return;
  installed = true;

  InjectStyles();
  InstallDialogHooks();

  window.Z3Bot =
  {
    version: 1,
    get mode() { return config.mode; },
    setMode: SetMode,
    setSpeed: SetSpeed,
    status: Status,
    act: Act,
    flash: Flash,
    tap: (target) => Act("tap", { target }),
    type: (target, text, options) => Act("type", { ...(options || {}), target, text }),
    commands: CommandList
  };

  if(config.name) document.title = `[bot] ${config.name} · ${document.title}`;

  Log(`ativo — modo=${config.mode} seed=${config.seed} speed=${config.speed} ritmo=${pace.toFixed(2)}`
    + (config.hostStart ? ` hoststart=${config.hostStart}` : ""));
}


// =========================
// ENTRADA PÚBLICA 1: página do jogo
// Chamado pelo <Jogo>_app.js:
//   StartBot({ game, brain?: () => import("./<Jogo>_bot.js"), getState?: () => ({...}) })
// =========================

export async function StartBot({ game, brain: loadBrain, getState: stateFn } = {})
{
  gameName = game || "?";
  getState = typeof stateFn === "function" ? stateFn : null;

  Install();

  if(loadBrain)
  {
    try
    {
      const module = await loadBrain();
      brain = module.default || module;
      Log(`cérebro "${gameName}" carregado — comandos: ${CommandList().join(", ")}`);
    }
    catch(e)
    {
      Warn("falha ao carregar o cérebro, usando o macaco:", e);
    }
  }
  else
  {
    Log(`"${gameName}" sem cérebro próprio — usando o macaco`);
  }

  WatchRoomInfo().catch(e => Warn("leitura do Firebase falhou:", e));

  StartLoop();
}


// =========================
// ENTRADA PÚBLICA 2: tela de entrada (index.html)
// Digita o nome e toca "Entrar" quando a sala existir. Se a sala ainda não
// existe (Unity abriu as janelas antes do Play), redigita o código a cada 3s.
// Vale pra bot=auto e bot=manual: entrar na sala é preparação, não jogada.
// =========================

export async function RunEntry()
{
  gameName = "Entry";
  Install();

  const roomInput = document.getElementById("roomCode");
  const nameInput = document.getElementById("playerName");
  const joinButton = document.getElementById("joinButton");
  const statusText = document.getElementById("status");

  const room = config.room.slice(0, 4);

  if(!room || !config.name)
  {
    Log("sem room/name na URL — esperando entrada manual.");
    return;
  }

  try
  {
    await Think("quick");

    if(roomInput.value.toUpperCase().trim() !== room)
    {
      await Type(roomInput, room);
    }

    await Think("quick");
    await Type(nameInput, config.name);

    const startedAt = Date.now();
    let lastRetype = Date.now();

    while(Date.now() - startedAt < 10 * 60 * 1000)
    {
      if(IsTappable(joinButton))
      {
        await Think("quick");
        await Tap(joinButton);
        Log("entrando na sala", room, "como", config.name);

        // SE CONTINUAR NESTA PÁGINA, algo deu errado (modo desconhecido,
        // erro de conexão). Não tenta de novo pra não criar jogador duplicado.
        await Sleep(8000);
        Warn("ainda na tela de entrada depois de tocar Entrar:", TextOf(statusText));
        return;
      }

      if(Date.now() - lastRetype > 3000)
      {
        lastRetype = Date.now();
        await Type(roomInput, room, { perChar: false, tapFirst: false });
      }

      await Sleep(250);
    }

    Warn(`sala ${room} não apareceu em 10 minutos — desisti.`);
  }
  catch(e)
  {
    Warn("entrada falhou:", e.reason || e.message || e, e.detail ?? "");
  }
}
