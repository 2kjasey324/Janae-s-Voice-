/* ===================================================================
   app.js — kiosk screen logic

   Assumption (see README): the NFC reader is configured in "keyboard
   emulation" mode, so tapping a card types its tag ID followed by
   Enter, as if someone had typed it and hit return. This is the most
   reliable way to get NFC input into Safari on iPad, since Safari
   does not support the Web NFC / Web Serial / Web HID APIs that a
   more "native" integration would need.

   If your reader instead talks over USB serial or HID, swap out the
   listenForReaderInput() function below for one that reads from that
   API — everything past "a tag ID string came in" stays the same.
   =================================================================== */

const captureInput = document.getElementById("captureInput");
const stage = document.getElementById("stage");
const idleCopy = document.getElementById("idleCopy");
const reveal = document.getElementById("reveal");
const revealIcon = document.getElementById("revealIcon");
const revealLabel = document.getElementById("revealLabel");
const revealStatus = document.getElementById("revealStatus");
const debugStrip = document.getElementById("debugStrip");

let buffer = "";
let bufferTimer = null;
let revealTimer = null;

const DEBUG = new URLSearchParams(window.location.search).get("debug") === "1";
if (DEBUG) debugStrip.style.display = "block";

function log(msg) {
  if (!DEBUG) return;
  debugStrip.textContent = msg;
  console.log("[tap-and-play]", msg);
}

// Keep focus on the invisible input at all times so keystrokes from
// the reader are always captured, even after Guided Access locks
// touch elsewhere on the screen.
function keepFocus() {
  captureInput.focus({ preventScroll: true });
}
keepFocus();
document.addEventListener("visibilitychange", keepFocus);
stage.addEventListener("click", keepFocus);
setInterval(keepFocus, 1500);

function listenForReaderInput() {
  captureInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const tagId = buffer.trim();
      buffer = "";
      captureInput.value = "";
      if (tagId) processTag(tagId);
      return;
    }
    if (e.key.length === 1) {
      buffer += e.key;
    }
    clearTimeout(bufferTimer);
    // Readers type fast; if there's a pause of more than a second,
    // assume it was stray input (e.g. someone tapping the screen)
    // and reset rather than mixing two taps together.
    bufferTimer = setTimeout(() => {
      buffer = "";
      captureInput.value = "";
    }, 1000);
  });
}

async function processTag(tagId) {
  log(`tag: ${tagId}`);
  const card = CardStore.findByTagId(tagId);

  if (!card) {
    showReveal({
      icon: "❓",
      label: "New card",
      status: "Not set up yet — add it in Settings",
      color: null,
      unknown: true,
    });
    return;
  }

  showReveal({
    icon: card.icon || "🎵",
    label: card.label,
    status: describeAction(card),
    color: card.color,
    unknown: false,
  });

  try {
    if (card.actionType === "phrase") {
      speakPhrase(card.phraseText);
    } else if (card.actionType === "song") {
      await Spotify.playUris([card.spotifyUri]);
    } else if (card.actionType === "playlist") {
      await Spotify.playContext(card.spotifyUri);
    }
  } catch (err) {
    log(err.message);
    updateStatus(err.message);
  }
}

function describeAction(card) {
  if (card.actionType === "phrase") return "Saying it now";
  if (card.actionType === "playlist") return "Playing the playlist";
  return "Playing the song";
}

function speakPhrase(text) {
  if (!("speechSynthesis" in window)) return;
  const utter = new SpeechSynthesisUtterance(text);
  utter.rate = 0.95;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utter);
}

function updateStatus(text) {
  revealStatus.textContent = text;
}

function showReveal({ icon, label, status, color, unknown }) {
  clearTimeout(revealTimer);
  idleCopy.style.opacity = "0";

  revealIcon.textContent = icon;
  revealLabel.textContent = label;
  revealStatus.textContent = status;

  reveal.classList.toggle("reveal-unknown", !!unknown);
  reveal.style.background = unknown ? "" : color;
  reveal.classList.add("show");

  revealTimer = setTimeout(() => {
    reveal.classList.remove("show");
    idleCopy.style.opacity = "1";
  }, 6000);
}

listenForReaderInput();
log("ready");
