"use strict";

const APP_NAME = "offline-webrtc-chat";
const SIGNAL_VERSION = 2;
const QR_PREFIX = "RTCQR";
const QR_FRAME_VERSION = "1";
const QR_CHUNK_SIZE = 420;
const QR_ERROR_CORRECTION = "M";
const BLUETOOTH_SERVICE_UUID = "7f7d0001-7b7a-4c7a-8f2f-6d8849c2a001";
const BLUETOOTH_CHARACTERISTIC_UUID = "7f7d0002-7b7a-4c7a-8f2f-6d8849c2a001";
const BLUETOOTH_CHUNK_SIZE = 160;

const els = {
  installBtn: document.querySelector("#installBtn"),
  hostBtn: document.querySelector("#hostBtn"),
  clientBtn: document.querySelector("#clientBtn"),
  bluetoothBtn: document.querySelector("#bluetoothBtn"),
  sendBluetoothBtn: document.querySelector("#sendBluetoothBtn"),
  copySignalBtn: document.querySelector("#copySignalBtn"),
  importSignalBtn: document.querySelector("#importSignalBtn"),
  clearLogsBtn: document.querySelector("#clearLogsBtn"),
  messageForm: document.querySelector("#messageForm"),
  messageInput: document.querySelector("#messageInput"),
  sendBtn: document.querySelector("#sendBtn"),
  messages: document.querySelector("#messages"),
  logs: document.querySelector("#logs"),
  localSignal: document.querySelector("#localSignal"),
  remoteSignal: document.querySelector("#remoteSignal"),
  modeBadge: document.querySelector("#modeBadge"),
  connectionStatus: document.querySelector("#connectionStatus"),
  installHelp: document.querySelector("#installHelp"),
  installDiagnostics: document.querySelector("#installDiagnostics"),
  installDetails: document.querySelector("#installDetails"),
  qrStatus: document.querySelector("#qrStatus"),
  qrCode: document.querySelector("#qrCode"),
  qrCounter: document.querySelector("#qrCounter"),
  qrPrevBtn: document.querySelector("#qrPrevBtn"),
  qrNextBtn: document.querySelector("#qrNextBtn"),
  scanQrBtn: document.querySelector("#scanQrBtn"),
  stopScanBtn: document.querySelector("#stopScanBtn"),
  qrVideo: document.querySelector("#qrVideo"),
  qrCanvas: document.querySelector("#qrCanvas"),
  qrScanProgress: document.querySelector("#qrScanProgress"),
  qrVideoBox: document.querySelector(".video-box")
};

const state = {
  mode: null,
  sessionId: null,
  pc: null,
  dataChannel: null,
  localCandidates: [],
  lastLocalSignal: null,
  qrFrames: [],
  qrIndex: 0,
  qrRx: new Map(),
  scanStream: null,
  scanRaf: 0,
  lastScannedFrame: "",
  lastScannedAt: 0,
  deferredInstallPrompt: null,
  bluetoothDevice: null,
  bluetoothCharacteristic: null,
  bluetoothRx: new Map()
};

init();

function init() {
  renderEmptyMessages();
  bindEvents();
  registerServiceWorker();
  updateInstallHelp();
  updateConnectionStatus("Aguardando modo");
  updateQrDisplay();
  log("App iniciado. Use Host no Quest e Client no iPhone/Android, ou o inverso para testes.");
}

function bindEvents() {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.deferredInstallPrompt = event;
    els.installBtn.textContent = "Instalar PWA";
    updateInstallHelp("Prompt Android/Chrome disponivel. Toque em Instalar PWA.");
    log("Prompt de instalacao PWA disponivel.");
  });

  window.addEventListener("appinstalled", () => {
    state.deferredInstallPrompt = null;
    els.installBtn.textContent = "PWA instalado";
    updateInstallHelp("PWA instalado pelo navegador.");
    log("PWA instalado pelo navegador.");
  });

  window.addEventListener("pagehide", stopQrScanner);

  els.installBtn.addEventListener("click", handleInstallCheck);
  els.hostBtn.addEventListener("click", startHostMode);
  els.clientBtn.addEventListener("click", startClientMode);
  els.bluetoothBtn.addEventListener("click", connectBluetooth);
  els.sendBluetoothBtn.addEventListener("click", sendCurrentSignalViaBluetooth);
  els.copySignalBtn.addEventListener("click", copyLocalSignal);
  els.importSignalBtn.addEventListener("click", importRemoteSignal);
  els.qrPrevBtn.addEventListener("click", () => showQrFrame(state.qrIndex - 1));
  els.qrNextBtn.addEventListener("click", () => showQrFrame(state.qrIndex + 1));
  els.scanQrBtn.addEventListener("click", startQrScanner);
  els.stopScanBtn.addEventListener("click", stopQrScanner);
  els.clearLogsBtn.addEventListener("click", () => {
    els.logs.textContent = "";
    log("Logs limpos.");
  });

  els.messageForm.addEventListener("submit", (event) => {
    event.preventDefault();
    sendMessage();
  });
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    log("Service Worker nao suportado neste navegador.", "warn");
    updateInstallHelp();
    return;
  }

  try {
    const registration = await navigator.serviceWorker.register("./service-worker.js");
    log(`Service Worker registrado: ${registration.scope}`);
    await navigator.serviceWorker.ready;
    log("Service Worker pronto.");
    updateInstallHelp();
  } catch (error) {
    log(`Falha ao registrar Service Worker: ${formatError(error)}`, "error");
    updateInstallHelp();
  }
}

async function handleInstallCheck() {
  if ("serviceWorker" in navigator) {
    try {
      await navigator.serviceWorker.ready;
    } catch (error) {
      log(`Service Worker ainda nao ficou pronto: ${formatError(error)}`, "warn");
    }
  }

  const standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  const swReady = "serviceWorker" in navigator ? Boolean(await navigator.serviceWorker.getRegistration()) : false;
  const diagnostics = buildInstallDiagnostics(swReady, standalone);
  await runInstallabilityDiagnostics();

  log(`PWA: standalone=${standalone ? "sim" : "nao"}, serviceWorker=${swReady ? "registrado" : "nao registrado"}.`);
  updateInstallHelp(diagnostics);

  if (standalone) {
    log("Este app ja esta aberto em modo instalado/standalone.");
    alert("Este app ja esta aberto como PWA instalado.");
    return;
  }

  if (isIosDevice()) {
    const message = `No iPhone nao existe prompt automatico de instalacao. Use Safari > Compartilhar > Adicionar a Tela de Inicio. ${diagnostics}`;
    log(message, swReady && window.isSecureContext ? "info" : "warn");
    alert(message);
    return;
  }

  if (state.deferredInstallPrompt) {
    state.deferredInstallPrompt.prompt();
    const result = await state.deferredInstallPrompt.userChoice;
    log(`Resultado da instalacao: ${result.outcome}.`);
    alert(`Resultado da instalacao: ${result.outcome}.`);
    state.deferredInstallPrompt = null;
    els.installBtn.textContent = "Instalar/Verificar PWA";
    updateInstallHelp();
    return;
  }

  const androidMessage = isAndroidDevice()
    ? "No Android/Chrome, se o prompt nao apareceu, abra o menu de tres pontos e procure Instalar app. Se aparecer apenas Adicionar a tela inicial, o Chrome ainda nao reconheceu como PWA instalavel."
    : "Se o prompt nao aparecer, use o menu do navegador e escolha Instalar app ou Adicionar a tela inicial.";
  log(`${androidMessage} ${diagnostics}`, "warn");
  alert(`${androidMessage}\n\n${diagnostics}`);
}

async function updateInstallHelp(forcedText) {
  if (!els.installHelp || !els.installDiagnostics) {
    return;
  }

  const standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  const swReady = "serviceWorker" in navigator ? Boolean(await navigator.serviceWorker.getRegistration()) : false;
  els.installDiagnostics.textContent = forcedText || buildInstallDiagnostics(swReady, standalone);
  runInstallabilityDiagnostics();
}

function buildInstallDiagnostics(swReady, standalone) {
  const browserHint = isIosDevice() ? "iPhone/iPad detectado" : isAndroidDevice() ? "Android detectado" : "desktop/outro dispositivo";
  const chromeHint = isAndroidDevice() ? `Chrome/CriOS: ${/Chrome|CriOS/i.test(navigator.userAgent || "") ? "provavel" : "nao detectado"}` : "Navegador: verifique suporte PWA";
  const secureHint = window.isSecureContext ? "HTTPS/contexto seguro: sim" : "HTTPS/contexto seguro: nao";
  const protocolHint = `Protocolo: ${window.location.protocol}`;
  const swHint = `Service Worker: ${swReady ? "registrado" : "nao registrado"}`;
  const controlledHint = `Pagina controlada pelo SW: ${navigator.serviceWorker?.controller ? "sim" : "nao/recarregue"}`;
  const installedHint = `Standalone: ${standalone ? "sim" : "nao"}`;
  const promptHint = `Prompt automatico: ${state.deferredInstallPrompt ? "disponivel" : "ainda nao disponivel"}`;
  const manifestHint = "Manifest: linkado com icones PNG 192/512.";
  return `${browserHint}. ${chromeHint}. ${secureHint}. ${protocolHint}. ${swHint}. ${controlledHint}. ${manifestHint}. ${promptHint}. ${installedHint}.`;
}

async function runInstallabilityDiagnostics() {
  if (!els.installDetails) {
    return;
  }

  const lines = [];
  lines.push(`URL: ${window.location.href}`);
  lines.push(`User agent: ${navigator.userAgent}`);
  lines.push(`Secure context: ${window.isSecureContext ? "ok" : "falha"}`);
  lines.push(`Manifest link: ${document.querySelector('link[rel="manifest"]') ? "ok" : "falha"}`);

  try {
    const manifestUrl = new URL(document.querySelector('link[rel="manifest"]').getAttribute("href"), window.location.href);
    const manifestResponse = await fetch(manifestUrl, { cache: "no-store" });
    lines.push(`Manifest HTTP: ${manifestResponse.status}`);
    const manifest = await manifestResponse.json();
    lines.push(`Manifest name: ${manifest.name || "ausente"}`);
    lines.push(`Manifest short_name: ${manifest.short_name || "ausente"}`);
    lines.push(`Manifest start_url: ${manifest.start_url || "ausente"}`);
    lines.push(`Manifest display: ${manifest.display || "ausente"}`);

    const icons = Array.isArray(manifest.icons) ? manifest.icons : [];
    const png192 = icons.find((icon) => String(icon.sizes || "").includes("192") && icon.type === "image/png");
    const png512 = icons.find((icon) => String(icon.sizes || "").includes("512") && icon.type === "image/png");
    lines.push(`Icone PNG 192: ${png192 ? "ok" : "falha"}`);
    lines.push(`Icone PNG 512: ${png512 ? "ok" : "falha"}`);

    if (png192) {
      lines.push(`Icone 192 HTTP: ${await checkAssetStatus(png192.src)}`);
    }
    if (png512) {
      lines.push(`Icone 512 HTTP: ${await checkAssetStatus(png512.src)}`);
    }
  } catch (error) {
    lines.push(`Manifest erro: ${formatError(error)}`);
  }

  try {
    if ("serviceWorker" in navigator) {
      const registration = await navigator.serviceWorker.getRegistration();
      lines.push(`SW registration: ${registration ? "ok" : "falha"}`);
      lines.push(`SW controller: ${navigator.serviceWorker.controller ? "ok" : "recarregue a pagina"}`);
      if (registration) {
        lines.push(`SW scope: ${registration.scope}`);
      }
    } else {
      lines.push("SW support: falha");
    }
  } catch (error) {
    lines.push(`SW erro: ${formatError(error)}`);
  }

  lines.push(`beforeinstallprompt: ${state.deferredInstallPrompt ? "disponivel" : "nao disparou"}`);
  lines.push(`Standalone: ${window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true ? "sim" : "nao"}`);
  els.installDetails.textContent = lines.join("\n");
}

async function checkAssetStatus(src) {
  try {
    const url = new URL(src, window.location.href);
    const response = await fetch(url, { cache: "no-store" });
    return String(response.status);
  } catch (error) {
    return `erro: ${formatError(error)}`;
  }
}

async function startHostMode() {
  try {
    resetPeer({ newSession: true });
    setMode("host");

    const pc = createPeerConnection();
    const channel = pc.createDataChannel("offline-chat", { ordered: true });
    setupDataChannel(channel);

    log("Host: criando offer...");
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitForIceGathering(pc);

    publishLocalSignal("offer");
    log("Host: offer pronta. Mostre o QR local para o Client escanear.");
  } catch (error) {
    log(`Host: erro ao criar offer: ${formatError(error)}`, "error");
  }
}

function startClientMode() {
  resetPeer({ newSession: false });
  setMode("client");
  createPeerConnection();
  log("Client: escaneie o QR do Host ou cole a offer em Dados recebidos.");
}

function createPeerConnection() {
  const pc = new RTCPeerConnection({ iceServers: [] });
  state.pc = pc;
  state.localCandidates = [];

  pc.addEventListener("icecandidate", (event) => {
    if (event.candidate) {
      state.localCandidates.push(candidateToPlainObject(event.candidate));
      log("ICE local encontrado.");
      return;
    }

    log("ICE local finalizado.");
    if (pc.localDescription) {
      publishLocalSignal(pc.localDescription.type);
    }
  });

  pc.addEventListener("icegatheringstatechange", () => {
    log(`ICE gathering: ${pc.iceGatheringState}.`);
  });

  pc.addEventListener("iceconnectionstatechange", () => {
    log(`ICE connection: ${pc.iceConnectionState}.`);
  });

  pc.addEventListener("connectionstatechange", () => {
    updateConnectionStatus(`WebRTC: ${pc.connectionState}`);
    log(`Peer connection: ${pc.connectionState}.`);
  });

  pc.addEventListener("datachannel", (event) => {
    log(`DataChannel recebido: ${event.channel.label}.`);
    setupDataChannel(event.channel);
  });

  updateConnectionStatus("PeerConnection criada");
  log("RTCPeerConnection criada com iceServers vazio.");
  return pc;
}

function setupDataChannel(channel) {
  state.dataChannel = channel;
  channel.binaryType = "arraybuffer";

  channel.addEventListener("open", () => {
    updateConnectionStatus("DataChannel aberto");
    els.sendBtn.disabled = false;
    addSystemMessage("DataChannel aberto. Chat pronto.");
    log("DataChannel aberto.");
  });

  channel.addEventListener("close", () => {
    els.sendBtn.disabled = true;
    updateConnectionStatus("DataChannel fechado");
    log("DataChannel fechado.", "warn");
  });

  channel.addEventListener("error", (event) => {
    log(`DataChannel erro: ${formatError(event.error || event)}`, "error");
  });

  channel.addEventListener("message", (event) => {
    const parsed = parseChatPayload(event.data);
    addMessage(parsed.text, "received", parsed.time);
    log("Mensagem recebida pelo DataChannel.");
  });

  log(`DataChannel configurado: ${channel.label}.`);
}

async function importRemoteSignal() {
  let payload;
  try {
    payload = JSON.parse(els.remoteSignal.value.trim());
  } catch (error) {
    log(`JSON invalido em Dados recebidos: ${formatError(error)}`, "error");
    return;
  }

  await importSignalPayload(payload, "manual");
}

async function importSignalPayload(payload, source) {
  if (!isValidSignalPayload(payload)) {
    log("Pacote de sinalizacao invalido ou de outro app.", "error");
    return;
  }

  try {
    if (payload.description.type === "offer") {
      await acceptOffer(payload, source);
      return;
    }

    if (payload.description.type === "answer") {
      await acceptAnswer(payload, source);
      return;
    }

    log(`Tipo de description nao suportado: ${payload.description.type}.`, "error");
  } catch (error) {
    log(`Erro ao importar sinalizacao: ${formatError(error)}`, "error");
  }
}

async function acceptOffer(payload, source) {
  if (state.mode !== "client") {
    resetPeer({ newSession: false });
    setMode("client");
  }

  state.sessionId = payload.sessionId || state.sessionId || randomId("s");
  const pc = state.pc || createPeerConnection();
  log(`Client: aplicando offer remota recebida por ${source}...`);
  await pc.setRemoteDescription(new RTCSessionDescription(payload.description));
  await maybeAddRemoteCandidates(payload);

  log("Client: criando answer...");
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await waitForIceGathering(pc);

  publishLocalSignal("answer");
  log("Client: answer pronta. Mostre o QR local para o Host escanear.");
}

async function acceptAnswer(payload, source) {
  if (!state.pc || state.mode !== "host") {
    log("A answer deve ser importada no dispositivo em Modo Host depois de criar a offer.", "error");
    return;
  }

  if (payload.sessionId && state.sessionId && payload.sessionId !== state.sessionId) {
    log("A answer recebida pertence a outra sessao.", "error");
    return;
  }

  log(`Host: aplicando answer remota recebida por ${source}...`);
  await state.pc.setRemoteDescription(new RTCSessionDescription(payload.description));
  await maybeAddRemoteCandidates(payload);
  log("Host: answer aplicada. Aguardando DataChannel abrir.");
}

async function maybeAddRemoteCandidates(payload) {
  const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
  if (!candidates.length) {
    log("Nenhum candidato ICE separado no pacote remoto.");
    return;
  }

  if (payload.description.sdp && payload.description.sdp.includes("a=candidate:")) {
    log("Candidatos ICE ja estao embutidos no SDP remoto; lista mantida apenas para debug.");
    return;
  }

  for (const candidate of candidates) {
    if (!candidate || !candidate.candidate) {
      continue;
    }

    try {
      await state.pc.addIceCandidate(new RTCIceCandidate(candidate));
      log("ICE remoto adicionado.");
    } catch (error) {
      log(`Falha ao adicionar ICE remoto: ${formatError(error)}`, "warn");
    }
  }
}

function publishLocalSignal(kind) {
  if (!state.pc || !state.pc.localDescription) {
    return;
  }

  if (!state.sessionId) {
    state.sessionId = randomId("s");
  }

  const payload = {
    app: APP_NAME,
    version: SIGNAL_VERSION,
    sessionId: state.sessionId,
    messageId: randomId("m"),
    role: state.mode,
    kind,
    createdAt: new Date().toISOString(),
    description: {
      type: state.pc.localDescription.type,
      sdp: state.pc.localDescription.sdp
    },
    candidates: state.localCandidates
  };

  state.lastLocalSignal = payload;
  els.localSignal.value = JSON.stringify(payload, null, 2);
  updateLocalQr(payload);
}

function updateLocalQr(payload) {
  try {
    state.qrFrames = encodeSignalToQrFrames(payload);
    state.qrIndex = 0;
    updateQrDisplay();
    log(`QR local gerado com ${state.qrFrames.length} parte(s).`);
  } catch (error) {
    state.qrFrames = [];
    state.qrIndex = 0;
    updateQrDisplay();
    log(`Falha ao gerar QR local: ${formatError(error)}`, "error");
  }
}

function encodeSignalToQrFrames(payload) {
  const sessionId = payload.sessionId || randomId("s");
  const messageId = payload.messageId || randomId("m");
  const json = JSON.stringify({ ...payload, sessionId, messageId });
  const encoded = utf8ToBase64Url(json);
  const hash = simpleHash(encoded);
  const chunks = chunkString(encoded, QR_CHUNK_SIZE);

  return chunks.map((chunk, index) => {
    const partIndex = String(index + 1);
    const partCount = String(chunks.length);
    return [QR_PREFIX, QR_FRAME_VERSION, sessionId, messageId, partIndex, partCount, hash, chunk].join(":");
  });
}

function decodeQrFrame(frameText) {
  if (typeof frameText !== "string" || !frameText.startsWith(`${QR_PREFIX}:`)) {
    return null;
  }

  const parts = frameText.split(":");
  if (parts.length !== 8) {
    throw new Error("Envelope QR invalido.");
  }

  const [prefix, version, sessionId, messageId, partIndexText, partCountText, hash, chunk] = parts;
  const partIndex = Number(partIndexText);
  const partCount = Number(partCountText);

  if (prefix !== QR_PREFIX || version !== QR_FRAME_VERSION) {
    throw new Error("Versao de QR nao suportada.");
  }

  if (!sessionId || !messageId || !hash || !chunk || !Number.isInteger(partIndex) || !Number.isInteger(partCount)) {
    throw new Error("Metadados do QR incompletos.");
  }

  if (partIndex < 1 || partIndex > partCount || partCount < 1) {
    throw new Error("Indice de QR fora do intervalo.");
  }

  return { sessionId, messageId, partIndex, partCount, hash, chunk };
}

function addQrFrameToAssembly(frame) {
  const key = `${frame.sessionId}:${frame.messageId}`;
  let entry = state.qrRx.get(key);

  if (!entry) {
    entry = {
      sessionId: frame.sessionId,
      messageId: frame.messageId,
      partCount: frame.partCount,
      hash: frame.hash,
      chunks: new Array(frame.partCount)
    };
    state.qrRx.set(key, entry);
  }

  if (entry.partCount !== frame.partCount || entry.hash !== frame.hash) {
    throw new Error("Partes de QR misturadas de mensagens diferentes.");
  }

  const chunkIndex = frame.partIndex - 1;
  const wasMissing = !entry.chunks[chunkIndex];
  entry.chunks[chunkIndex] = frame.chunk;

  const received = entry.chunks.filter(Boolean).length;
  els.qrScanProgress.textContent = `${received}/${entry.partCount}`;

  if (wasMissing) {
    log(`QR remoto recebido: parte ${frame.partIndex}/${entry.partCount}.`);
  }

  if (received !== entry.partCount) {
    return null;
  }

  const encoded = entry.chunks.join("");
  if (simpleHash(encoded) !== entry.hash) {
    state.qrRx.delete(key);
    throw new Error("Hash do pacote QR nao confere.");
  }

  state.qrRx.delete(key);
  return JSON.parse(base64UrlToUtf8(encoded));
}

function updateQrDisplay() {
  if (!state.qrFrames.length) {
    els.qrCode.innerHTML = "<p>Escolha Host ou Client para gerar a sinalizacao.</p>";
    els.qrCounter.textContent = "0/0";
    els.qrStatus.textContent = "Sem QR local";
    els.qrPrevBtn.disabled = true;
    els.qrNextBtn.disabled = true;
    return;
  }

  showQrFrame(state.qrIndex);
}

function showQrFrame(index) {
  if (!state.qrFrames.length) {
    updateQrDisplay();
    return;
  }

  state.qrIndex = clamp(index, 0, state.qrFrames.length - 1);
  const frame = state.qrFrames[state.qrIndex];

  if (typeof qrcode !== "function") {
    els.qrCode.innerHTML = "<p>Biblioteca de QR nao carregada.</p>";
    log("Biblioteca qrcode-generator nao esta disponivel.", "error");
    return;
  }

  try {
    const qr = qrcode(0, QR_ERROR_CORRECTION);
    qr.addData(frame);
    qr.make();
    els.qrCode.innerHTML = qr.createSvgTag({ cellSize: 7, margin: 3, scalable: true });
  } catch (error) {
    els.qrCode.innerHTML = "<p>Nao foi possivel renderizar este QR.</p>";
    log(`Erro ao renderizar QR: ${formatError(error)}`, "error");
  }

  els.qrCounter.textContent = `${state.qrIndex + 1}/${state.qrFrames.length}`;
  els.qrStatus.textContent = `${state.lastLocalSignal?.description?.type || "Sinal"} ${state.qrIndex + 1}/${state.qrFrames.length}`;
  els.qrPrevBtn.disabled = state.qrIndex === 0;
  els.qrNextBtn.disabled = state.qrIndex >= state.qrFrames.length - 1;
}

async function startQrScanner() {
  if (typeof jsQR !== "function") {
    log("Biblioteca jsQR nao carregada.", "error");
    return;
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    log("getUserMedia nao esta disponivel neste navegador/contexto.", "error");
    return;
  }

  await stopQrScanner();
  state.qrRx.clear();
  state.lastScannedFrame = "";
  state.lastScannedAt = 0;
  els.qrScanProgress.textContent = "0/0";

  try {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
      });
    } catch (error) {
      log(`Camera traseira nao abriu: ${formatError(error)}. Tentando camera padrao...`, "warn");
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    }

    state.scanStream = stream;
    els.qrVideo.srcObject = stream;
    els.qrVideoBox.classList.add("is-active");
    els.scanQrBtn.disabled = true;
    els.stopScanBtn.disabled = false;
    await els.qrVideo.play();
    log("Scanner QR ativo.");
    scanQrFrame();
  } catch (error) {
    await stopQrScanner();
    log(`Falha ao abrir scanner QR: ${formatError(error)}`, "error");
  }
}

async function stopQrScanner() {
  if (state.scanRaf) {
    cancelAnimationFrame(state.scanRaf);
    state.scanRaf = 0;
  }

  if (state.scanStream) {
    for (const track of state.scanStream.getTracks()) {
      track.stop();
    }
  }

  state.scanStream = null;
  els.qrVideo.pause();
  els.qrVideo.removeAttribute("src");
  els.qrVideo.srcObject = null;
  els.qrVideoBox.classList.remove("is-active");
  els.scanQrBtn.disabled = false;
  els.stopScanBtn.disabled = true;
}

function scanQrFrame() {
  if (!state.scanStream) {
    return;
  }

  const video = els.qrVideo;
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0 && video.videoHeight > 0) {
    const canvas = els.qrCanvas;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const result = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: "attemptBoth" });
    if (result && result.data) {
      handleScannedQrData(result.data);
    }
  }

  state.scanRaf = requestAnimationFrame(scanQrFrame);
}

async function handleScannedQrData(data) {
  if (!data.startsWith(`${QR_PREFIX}:`)) {
    return;
  }

  const now = Date.now();
  if (data === state.lastScannedFrame && now - state.lastScannedAt < 1200) {
    return;
  }

  state.lastScannedFrame = data;
  state.lastScannedAt = now;

  try {
    const frame = decodeQrFrame(data);
    const payload = addQrFrameToAssembly(frame);
    if (!payload) {
      return;
    }

    els.remoteSignal.value = JSON.stringify(payload, null, 2);
    log("Pacote QR completo. Importando sinalizacao automaticamente.");
    await stopQrScanner();
    await importSignalPayload(payload, "QR");
  } catch (error) {
    log(`QR invalido: ${formatError(error)}`, "warn");
  }
}

async function waitForIceGathering(pc, timeoutMs = 5000) {
  if (pc.iceGatheringState === "complete") {
    return;
  }

  await new Promise((resolve) => {
    let done = false;

    const finish = (reason) => {
      if (done) {
        return;
      }
      done = true;
      clearTimeout(timer);
      pc.removeEventListener("icegatheringstatechange", checkState);
      pc.removeEventListener("icecandidate", checkCandidate);
      log(reason);
      resolve();
    };

    const checkState = () => {
      if (pc.iceGatheringState === "complete") {
        finish("ICE gathering completo.");
      }
    };

    const checkCandidate = (event) => {
      if (!event.candidate) {
        finish("ICE gathering completo.");
      }
    };

    const timer = setTimeout(() => {
      finish("Tempo de ICE gathering encerrado; usando candidatos encontrados ate agora.");
    }, timeoutMs);

    pc.addEventListener("icegatheringstatechange", checkState);
    pc.addEventListener("icecandidate", checkCandidate);
  });
}

function sendMessage() {
  const text = els.messageInput.value.trim();
  if (!text) {
    return;
  }

  if (!state.dataChannel || state.dataChannel.readyState !== "open") {
    log("DataChannel ainda nao esta aberto.", "warn");
    return;
  }

  const payload = {
    type: "chat",
    text,
    time: new Date().toISOString()
  };

  state.dataChannel.send(JSON.stringify(payload));
  addMessage(text, "sent", payload.time);
  els.messageInput.value = "";
  els.messageInput.focus();
  log("Mensagem enviada pelo DataChannel.");
}

function parseChatPayload(data) {
  if (typeof data !== "string") {
    return {
      text: "[Mensagem binaria recebida]",
      time: new Date().toISOString()
    };
  }

  try {
    const payload = JSON.parse(data);
    if (payload && payload.type === "chat" && typeof payload.text === "string") {
      return {
        text: payload.text,
        time: payload.time || new Date().toISOString()
      };
    }
  } catch (error) {
    // Texto puro tambem e aceito para facilitar testes.
  }

  return {
    text: data,
    time: new Date().toISOString()
  };
}

async function connectBluetooth() {
  if (!("bluetooth" in navigator)) {
    log("Web Bluetooth nao esta disponivel neste navegador ou contexto. QR/manual sao os fluxos recomendados.", "warn");
    return;
  }

  try {
    log("Abrindo seletor Web Bluetooth para o servico GATT customizado experimental...");
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [BLUETOOTH_SERVICE_UUID] }],
      optionalServices: [BLUETOOTH_SERVICE_UUID]
    });

    state.bluetoothDevice = device;
    device.addEventListener("gattserverdisconnected", () => {
      state.bluetoothCharacteristic = null;
      log("Bluetooth desconectado.", "warn");
    });

    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(BLUETOOTH_SERVICE_UUID);
    const characteristic = await service.getCharacteristic(BLUETOOTH_CHARACTERISTIC_UUID);
    state.bluetoothCharacteristic = characteristic;

    if (characteristic.properties.notify || characteristic.properties.indicate) {
      await characteristic.startNotifications();
      characteristic.addEventListener("characteristicvaluechanged", handleBluetoothChunk);
      log("Bluetooth conectado com notificacoes ativas.");
    } else {
      log("Bluetooth conectado, mas a characteristic nao envia notificacoes.", "warn");
    }

    log("Bluetooth segue experimental: dois navegadores comuns nao anunciam servico GATT entre si.", "warn");
  } catch (error) {
    log(`Falha no Web Bluetooth: ${formatError(error)}. Use QR Code ou copiar/colar.`, "warn");
  }
}

async function sendCurrentSignalViaBluetooth() {
  if (!state.lastLocalSignal) {
    log("Nao ha sinal local para enviar por Bluetooth.", "warn");
    return;
  }

  if (!state.bluetoothCharacteristic) {
    log("Bluetooth GATT nao conectado. Use QR Code ou copie manualmente.", "warn");
    return;
  }

  if (!state.bluetoothCharacteristic.properties.write && !state.bluetoothCharacteristic.properties.writeWithoutResponse) {
    log("A characteristic Bluetooth nao aceita escrita.", "warn");
    return;
  }

  try {
    const signalText = JSON.stringify(state.lastLocalSignal);
    await writeBluetoothText(signalText);
    log("Sinalizacao enviada por Bluetooth em blocos.");
  } catch (error) {
    log(`Falha ao enviar por Bluetooth: ${formatError(error)}`, "error");
  }
}

async function writeBluetoothText(text) {
  const id = Math.random().toString(16).slice(2);
  const encoded = btoa(unescape(encodeURIComponent(text)));
  const total = Math.ceil(encoded.length / BLUETOOTH_CHUNK_SIZE);

  for (let index = 0; index < total; index += 1) {
    const chunk = encoded.slice(index * BLUETOOTH_CHUNK_SIZE, (index + 1) * BLUETOOTH_CHUNK_SIZE);
    const frame = `PWA-RTC|${id}|${index + 1}|${total}|${chunk}`;
    const bytes = new TextEncoder().encode(frame);

    if (state.bluetoothCharacteristic.properties.writeWithoutResponse) {
      await state.bluetoothCharacteristic.writeValueWithoutResponse(bytes);
    } else {
      await state.bluetoothCharacteristic.writeValue(bytes);
    }

    await delay(40);
  }
}

function handleBluetoothChunk(event) {
  try {
    const frame = new TextDecoder().decode(event.target.value);
    const parts = frame.split("|");

    if (parts.length !== 5 || parts[0] !== "PWA-RTC") {
      log("Bluetooth: pacote recebido em formato desconhecido.", "warn");
      return;
    }

    const [, id, indexText, totalText, chunk] = parts;
    const index = Number(indexText);
    const total = Number(totalText);

    if (!state.bluetoothRx.has(id)) {
      state.bluetoothRx.set(id, { total, chunks: [] });
    }

    const entry = state.bluetoothRx.get(id);
    entry.chunks[index - 1] = chunk;
    log(`Bluetooth: bloco ${index}/${total} recebido.`);

    if (entry.chunks.filter(Boolean).length === entry.total) {
      const encoded = entry.chunks.join("");
      const text = decodeURIComponent(escape(atob(encoded)));
      const payload = JSON.parse(text);
      els.remoteSignal.value = JSON.stringify(payload, null, 2);
      state.bluetoothRx.delete(id);
      log("Bluetooth: sinalizacao recebida e colocada em Dados recebidos.");
    }
  } catch (error) {
    log(`Bluetooth: erro ao processar bloco: ${formatError(error)}`, "error");
  }
}

async function copyLocalSignal() {
  if (!els.localSignal.value.trim()) {
    log("Nao ha dados locais para copiar.", "warn");
    return;
  }

  try {
    await navigator.clipboard.writeText(els.localSignal.value);
    log("Dados locais copiados para a area de transferencia.");
  } catch (error) {
    els.localSignal.select();
    log(`Copia automatica falhou: ${formatError(error)}. Selecione e copie manualmente.`, "warn");
  }
}

function resetPeer(options = {}) {
  const { newSession = false } = options;
  stopQrScanner();

  if (state.dataChannel) {
    try {
      state.dataChannel.close();
    } catch (error) {
      log(`Erro ao fechar DataChannel anterior: ${formatError(error)}`, "warn");
    }
  }

  if (state.pc) {
    try {
      state.pc.close();
    } catch (error) {
      log(`Erro ao fechar PeerConnection anterior: ${formatError(error)}`, "warn");
    }
  }

  state.pc = null;
  state.dataChannel = null;
  state.localCandidates = [];
  state.lastLocalSignal = null;
  state.qrFrames = [];
  state.qrIndex = 0;
  state.qrRx.clear();
  state.sessionId = newSession ? randomId("s") : null;
  els.localSignal.value = "";
  els.remoteSignal.value = "";
  els.qrScanProgress.textContent = "0/0";
  els.sendBtn.disabled = true;
  updateQrDisplay();
}

function setMode(mode) {
  state.mode = mode;
  els.modeBadge.textContent = mode === "host" ? "Host" : "Client";
  els.hostBtn.classList.toggle("ghost", mode !== "host");
  els.clientBtn.classList.toggle("ghost", mode !== "client");
  updateConnectionStatus(mode === "host" ? "Modo Host" : "Modo Client");
  addSystemMessage(`Modo ${mode === "host" ? "Host" : "Client"} selecionado.`);
}

function updateConnectionStatus(text) {
  els.connectionStatus.textContent = text;
}

function addMessage(text, kind, time) {
  removeEmptyMessages();

  const item = document.createElement("article");
  item.className = `message ${kind}`;

  const meta = document.createElement("small");
  meta.textContent = `${kind === "sent" ? "Enviada" : "Recebida"} - ${formatTime(time)}`;

  const body = document.createElement("div");
  body.textContent = text;

  item.append(meta, body);
  els.messages.append(item);
  els.messages.scrollTop = els.messages.scrollHeight;
}

function addSystemMessage(text) {
  removeEmptyMessages();

  const item = document.createElement("article");
  item.className = "message system";
  item.textContent = text;
  els.messages.append(item);
  els.messages.scrollTop = els.messages.scrollHeight;
}

function renderEmptyMessages() {
  els.messages.innerHTML = '<p class="empty-note">As mensagens enviadas e recebidas aparecerao aqui.</p>';
}

function removeEmptyMessages() {
  const empty = els.messages.querySelector(".empty-note");
  if (empty) {
    empty.remove();
  }
}

function log(message, level = "info") {
  const time = new Date().toLocaleTimeString("pt-BR", { hour12: false });
  const prefix = level.toUpperCase();
  els.logs.textContent += `[${time}] ${prefix}: ${message}\n`;
  els.logs.scrollTop = els.logs.scrollHeight;
}

function isValidSignalPayload(payload) {
  return Boolean(
    payload &&
      payload.app === APP_NAME &&
      Number(payload.version) >= 1 &&
      payload.description &&
      typeof payload.description.type === "string" &&
      typeof payload.description.sdp === "string"
  );
}

function isIosDevice() {
  const platform = navigator.platform || "";
  const userAgent = navigator.userAgent || "";
  const iPadOnDesktopMode = platform === "MacIntel" && navigator.maxTouchPoints > 1;
  return /iPad|iPhone|iPod/.test(userAgent) || iPadOnDesktopMode;
}

function isAndroidDevice() {
  return /Android/i.test(navigator.userAgent || "");
}

function candidateToPlainObject(candidate) {
  if (typeof candidate.toJSON === "function") {
    return candidate.toJSON();
  }

  return {
    candidate: candidate.candidate,
    sdpMid: candidate.sdpMid,
    sdpMLineIndex: candidate.sdpMLineIndex,
    usernameFragment: candidate.usernameFragment
  };
}

function utf8ToBase64Url(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToUtf8(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new TextDecoder().decode(bytes);
}

function simpleHash(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

function chunkString(text, size) {
  const chunks = [];
  for (let index = 0; index < text.length; index += size) {
    chunks.push(text.slice(index, index + size));
  }

  return chunks.length ? chunks : [""];
}

function randomId(prefix) {
  const bytes = new Uint8Array(8);
  const randomSource = globalThis.crypto;
  if (randomSource && randomSource.getRandomValues) {
    randomSource.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  const value = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${prefix}${value}`;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function formatTime(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    return new Date().toLocaleTimeString("pt-BR", { hour12: false });
  }
  return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

function formatError(error) {
  if (!error) {
    return "erro desconhecido";
  }

  if (error.name && error.message) {
    return `${error.name}: ${error.message}`;
  }

  if (error.message) {
    return error.message;
  }

  return String(error);
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
