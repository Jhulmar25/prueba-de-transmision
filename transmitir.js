/* =======================================================
   transmitir.js
======================================================= */
import {
  db,
  collection,
  addDoc,
  updateDoc,
  serverTimestamp
} from "./firebase-config.js";

/* =======================================================
   CONFIG
======================================================= */
const SIGNALING_URL = "https://bodycam-server-200816039529.us-central1.run.app";

const pcConfig = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

let socket = null;
let pc = null;
let localStream = null;
let roomId = null;
let transmitting = false;

let currentDocRef = null;

/* =======================================================
   DOM
======================================================= */
const formSection = document.getElementById("formSection");
const videoSection = document.getElementById("videoSection");

const videoEl = document.getElementById("localVideo");
const estadoEl = document.getElementById("estadoText");
const gpsEl = document.getElementById("gpsText");

const btnStart = document.getElementById("btnStart");
const btnStop = document.getElementById("btnStop");

const codigoInput = document.getElementById("codigoInput");
const nombreInput = document.getElementById("nombreInput");

/* =======================================================
   UTILS
======================================================= */
function setEstado(msg) {
  estadoEl.textContent = msg;
}

function setGPS(msg) {
  gpsEl.textContent = "GPS: " + msg;
}

/* =======================================================
   FIRESTORE
======================================================= */
function getFechaYHora() {
  const now = new Date();
  const d = String(now.getDate()).padStart(2, "0");
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const y = now.getFullYear();
  const h = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");

  return {
    fechaKey: `${d}-${m}-${y}`,
    fechaTexto: `${d}-${m}-${y}`,
    horaTexto: `${h}:${min}`
  };
}

async function registrarInicio({ codigo, nombre }) {
  const { fechaKey, fechaTexto, horaTexto } = getFechaYHora();

  let lat = null, lng = null;

  setGPS("obteniendo ubicación…");

  try {
    const pos = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 8000
      });
    });

    lat = pos.coords.latitude;
    lng = pos.coords.longitude;
    setGPS(`${lat.toFixed(5)}, ${lng.toFixed(5)}`);

  } catch {
    setGPS("no disponible");
  }

  const colRef = collection(db, "videos", fechaKey, "registros");

  const payload = {
    codigo,
    nombre,
    fecha: fechaTexto,
    hora: horaTexto,
    lat,
    lng,
    activo: true,
    creadoEn: serverTimestamp()
  };

  const docRef = await addDoc(colRef, payload);
  currentDocRef = docRef;
}

/* =======================================================
   SOCKET & WEBRTC
======================================================= */
function prepararSocket() {
  if (socket) socket.disconnect();

  socket = io(SIGNALING_URL, { transports: ["websocket"] });

  socket.on("connect", () => {
    socket.emit("join-room", { roomId, role: "sender" });
  });

  socket.on("answer", async ({ answer }) => {
    if (pc.signalingState !== "closed") {
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
    }
  });

  socket.on("ice-candidate", ({ candidate }) => {
    if (candidate && pc) pc.addIceCandidate(new RTCIceCandidate(candidate));
  });

  socket.on("user-joined", () => {
    reenviarOferta();
  });

  socket.on("detener-desde-web", () => stop());
}

async function crearPeerConnection() {
  pc = new RTCPeerConnection(pcConfig);

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      socket.emit("ice-candidate", { roomId, candidate: e.candidate });
    }
  };

  localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
}

async function reenviarOferta() {
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit("offer", { roomId, offer });
}

/* =======================================================
   PRINCIPALES
======================================================= */
async function start() {
  roomId = codigoInput.value.trim();
  const nombre = nombreInput.value.trim();

  if (!roomId) return alert("Ingrese DNI");
  if (!nombre) return alert("Ingrese nombre");

  try {
    setEstado("Activando cámara...");

    localStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
      audio: true
    });


    videoEl.srcObject = localStream;

    prepararSocket();
    await crearPeerConnection();
    await reenviarOferta();

    await registrarInicio({ codigo: roomId, nombre });

    transmitting = true;

    formSection.classList.add("hidden");
    videoSection.classList.remove("hidden");

    setEstado("Esperando visor…");

  } catch (err) {
    alert("Error al iniciar cámara");
    console.error(err);
  }
}

async function stop() {
  if (socket) socket.disconnect();
  if (pc) pc.close();

  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
  }

  videoEl.srcObject = null;

  if (currentDocRef) {
    await updateDoc(currentDocRef, {
      activo: false,
      finalizadoEn: serverTimestamp()
    });
  }

  transmitting = false;

  formSection.classList.remove("hidden");
  videoSection.classList.add("hidden");

  setEstado("Transmisión detenida");
}

/* =======================================================
   EVENTOS
======================================================= */
btnStart.onclick = start;
btnStop.onclick = stop;
