/* ===================================================================
   admin.js — settings page logic
   =================================================================== */

const PIN_KEY = "jtp_pin";
const DEFAULT_PIN = "1234";

// ---------- PIN gate ----------

const pinGate = document.getElementById("pinGate");
const pinInput = document.getElementById("pinInput");
const pinSubmit = document.getElementById("pinSubmit");
const pinError = document.getElementById("pinError");
const adminUI = document.getElementById("adminUI");

function currentPin() {
  return localStorage.getItem(PIN_KEY) || DEFAULT_PIN;
}

function tryUnlock() {
  if (pinInput.value === currentPin()) {
    pinGate.style.display = "none";
    adminUI.style.display = "block";
    initAdminUI();
  } else {
    pinError.style.display = "block";
    pinInput.value = "";
    pinInput.focus();
  }
}

pinSubmit.addEventListener("click", tryUnlock);
pinInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") tryUnlock();
});
pinInput.focus();

// ---------- main admin UI (runs once unlocked) ----------

let uiInitialized = false;

async function initAdminUI() {
  if (uiInitialized) return;
  uiInitialized = true;

  document.getElementById("redirectUriDisplay").textContent =
    Spotify.getRedirectUri();

  // Handle a return trip from Spotify's OAuth screen, if there is one.
  try {
    const justConnected = await Spotify.handleRedirectCallback();
    if (justConnected) toast("Spotify connected!");
  } catch (err) {
    toast(err.message);
  }

  document.getElementById("clientIdInput").value = Spotify.getClientId();
  refreshSpotifyStatus();
  renderCardList();

  document.getElementById("saveClientIdBtn").addEventListener("click", () => {
    const id = document.getElementById("clientIdInput").value.trim();
    if (!id) return toast("Enter a Client ID first.");
    Spotify.setClientId(id);
    toast("Client ID saved.");
  });

  document.getElementById("connectBtn").addEventListener("click", async () => {
    try {
      await Spotify.startAuth();
    } catch (err) {
      toast(err.message);
    }
  });

  document.getElementById("disconnectBtn").addEventListener("click", () => {
    Spotify.disconnect();
    refreshSpotifyStatus();
    toast("Disconnected from Spotify.");
  });

  document.getElementById("addCardBtn").addEventListener("click", () => openCardModal(null));

  document.getElementById("exportBtn").addEventListener("click", () => {
    const blob = new Blob([CardStore.exportJson()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "janae-cards-backup.json";
    a.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById("importBtn").addEventListener("click", () => {
    document.getElementById("importFile").click();
  });

  document.getElementById("importFile").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      CardStore.importJson(text);
      renderCardList();
      toast("Cards imported.");
    } catch (err) {
      toast("That file didn't work: " + err.message);
    }
    e.target.value = "";
  });

  document.getElementById("savePinBtn").addEventListener("click", () => {
    const val = document.getElementById("newPinInput").value.trim();
    if (!val) return toast("Enter a new PIN first.");
    localStorage.setItem(PIN_KEY, val);
    document.getElementById("newPinInput").value = "";
    toast("PIN updated.");
  });
}

async function refreshSpotifyStatus() {
  const disconnectedEl = document.getElementById("spotifyDisconnected");
  const connectedEl = document.getElementById("spotifyConnected");
  if (!Spotify.isConnected()) {
    disconnectedEl.style.display = "block";
    connectedEl.style.display = "none";
    return;
  }
  disconnectedEl.style.display = "none";
  connectedEl.style.display = "block";
  try {
    const me = await Spotify.getMe();
    document.getElementById("spotifyUserLabel").textContent =
      "as " + (me.display_name || me.id);
  } catch {
    document.getElementById("spotifyUserLabel").textContent = "";
  }
}

// ---------- card list ----------

function renderCardList() {
  const list = document.getElementById("cardList");
  const cards = CardStore.all();
  list.innerHTML = "";

  if (cards.length === 0) {
    list.innerHTML = '<p class="empty-note">No cards yet — tap "Add card" to create the first one.</p>';
    return;
  }

  cards.forEach((card) => {
    const row = document.createElement("div");
    row.className = "card-row";
    row.innerHTML = `
      <div class="card-swatch" style="background:${card.color}">${card.icon || "🎵"}</div>
      <div class="card-meta">
        <div class="name">${escapeHtml(card.label || "Untitled")}</div>
        <div class="sub">Tag ${escapeHtml(card.tagId)} · ${describeType(card)}</div>
      </div>
      <div class="card-actions">
        <button class="btn btn-sm btn-ghost" data-action="edit">Edit</button>
        <button class="btn btn-sm btn-danger" data-action="delete">Delete</button>
      </div>
    `;
    row.querySelector('[data-action="edit"]').addEventListener("click", () => openCardModal(card));
    row.querySelector('[data-action="delete"]').addEventListener("click", () => {
      if (confirm(`Delete "${card.label}"?`)) {
        CardStore.remove(card.id);
        renderCardList();
      }
    });
    list.appendChild(row);
  });
}

function describeType(card) {
  if (card.actionType === "song") return "Song";
  if (card.actionType === "playlist") return "Playlist";
  return "Spoken phrase";
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ---------- add/edit card modal ----------

const cardModal = document.getElementById("cardModal");
const cardModalTitle = document.getElementById("cardModalTitle");
const tagIdInput = document.getElementById("tagIdInput");
const tagScanBox = document.getElementById("tagScanBox");
const labelInput = document.getElementById("labelInput");
const iconInput = document.getElementById("iconInput");
const actionTypeToggle = document.getElementById("actionTypeToggle");
const spotifyLinkField = document.getElementById("spotifyLinkField");
const spotifyLinkInput = document.getElementById("spotifyLinkInput");
const phraseField = document.getElementById("phraseField");
const phraseInput = document.getElementById("phraseInput");

let editingCard = null; // null = creating new
let currentActionType = "song";
let scanListenerActive = false;
let scanBuffer = "";

function openCardModal(card) {
  editingCard = card;
  cardModalTitle.textContent = card ? "Edit card" : "Add a card";
  tagIdInput.value = card ? card.tagId : "";
  labelInput.value = card ? card.label : "";
  iconInput.value = card ? card.icon : "";
  currentActionType = card ? card.actionType : "song";
  setActionType(currentActionType);
  spotifyLinkInput.value = card && card.actionType !== "phrase" ? card.spotifyUri : "";
  phraseInput.value = card && card.actionType === "phrase" ? card.phraseText : "";
  cardModal.style.display = "flex";
  startScanListener();
}

function closeCardModal() {
  cardModal.style.display = "none";
  stopScanListener();
}

function setActionType(type) {
  currentActionType = type;
  [...actionTypeToggle.children].forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.type === type);
  });
  spotifyLinkField.style.display = type === "phrase" ? "none" : "flex";
  phraseField.style.display = type === "phrase" ? "flex" : "none";
}

actionTypeToggle.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-type]");
  if (btn) setActionType(btn.dataset.type);
});

document.getElementById("cancelCardBtn").addEventListener("click", closeCardModal);

document.getElementById("saveCardBtn").addEventListener("click", () => {
  const tagId = tagIdInput.value.trim();
  const label = labelInput.value.trim();
  if (!tagId) return toast("Tap the card or type its Tag ID first.");
  if (!label) return toast("Give the card a label.");
  if (currentActionType !== "phrase" && !spotifyLinkInput.value.trim()) {
    return toast("Paste a Spotify link for this card.");
  }
  if (currentActionType === "phrase" && !phraseInput.value.trim()) {
    return toast("Write the phrase to speak.");
  }

  const card = {
    id: editingCard ? editingCard.id : CardStore.newId(),
    tagId,
    label,
    icon: iconInput.value.trim() || "🎵",
    color: editingCard ? editingCard.color : CardStore.nextColor(),
    actionType: currentActionType,
    spotifyUri:
      currentActionType !== "phrase"
        ? Spotify.normalizeSpotifyLink(spotifyLinkInput.value.trim())
        : "",
    phraseText: currentActionType === "phrase" ? phraseInput.value.trim() : "",
  };

  CardStore.upsert(card);
  renderCardList();
  closeCardModal();
  toast("Card saved.");
});

document.getElementById("testCardBtn").addEventListener("click", async () => {
  try {
    if (currentActionType === "phrase") {
      const text = phraseInput.value.trim();
      if (!text) return toast("Write a phrase first.");
      const utter = new SpeechSynthesisUtterance(text);
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utter);
    } else {
      const uri = Spotify.normalizeSpotifyLink(spotifyLinkInput.value.trim());
      if (!uri) return toast("Paste a Spotify link first.");
      if (currentActionType === "song") {
        await Spotify.playUris([uri]);
      } else {
        await Spotify.playContext(uri);
      }
      toast("Sent to Spotify — check the iPad's Spotify app.");
    }
  } catch (err) {
    toast(err.message);
  }
});

// "tap the card now" — while the modal is open, capture the next
// burst of keystrokes + Enter into the Tag ID field, same protocol
// the kiosk screen listens for.
function startScanListener() {
  scanListenerActive = true;
  scanBuffer = "";
  tagScanBox.classList.add("listening");
  document.addEventListener("keydown", scanKeyHandler);
}

function stopScanListener() {
  scanListenerActive = false;
  tagScanBox.classList.remove("listening");
  document.removeEventListener("keydown", scanKeyHandler);
}

function scanKeyHandler(e) {
  if (!scanListenerActive) return;
  // Don't hijack typing inside a normal text field other than the
  // scan box itself.
  if (document.activeElement !== document.body && document.activeElement !== tagScanBox) {
    if (document.activeElement.tagName === "INPUT" || document.activeElement.tagName === "TEXTAREA") {
      return;
    }
  }
  if (e.key === "Enter") {
    if (scanBuffer.length >= 4) {
      tagIdInput.value = scanBuffer;
      tagScanBox.textContent = "Got it! Tag ID filled in below.";
    }
    scanBuffer = "";
    return;
  }
  if (e.key.length === 1) {
    scanBuffer += e.key;
  }
}

// ---------- toast ----------

let toastTimer = null;
function toast(message) {
  let el = document.querySelector(".toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 3200);
}
