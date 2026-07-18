/* ===================================================================
   spotify.js
   Small helper library for talking to Spotify from the browser using
   the Authorization Code + PKCE flow (no client secret needed, so it's
   safe to run entirely from a static site on GitHub Pages).

   This does NOT stream audio itself — it tells the Spotify app that's
   already open and logged in on the iPad what to play, using the
   "Connect to a device" Web API. That's more reliable on iPad Safari
   than trying to stream audio directly in the browser.

   Storage keys used in localStorage:
     jtp_spotify_client_id
     jtp_spotify_tokens        -> { access_token, refresh_token, expires_at }
     jtp_spotify_pkce_verifier -> transient, used only during auth redirect
   =================================================================== */

const Spotify = (() => {
  const AUTH_URL = "https://accounts.spotify.com/authorize";
  const TOKEN_URL = "https://accounts.spotify.com/api/token";
  const API_BASE = "https://api.spotify.com/v1";

  const SCOPES = [
    "user-read-playback-state",
    "user-modify-playback-state",
    "playlist-read-private",
  ].join(" ");

  function getClientId() {
    return localStorage.getItem("jtp_spotify_client_id") || "";
  }

  function setClientId(id) {
    localStorage.setItem("jtp_spotify_client_id", id.trim());
  }

  function getRedirectUri() {
    // Always send Spotify back to admin.html, in the same folder this
    // site is hosted from. This exact URL must be added to the
    // Spotify Developer Dashboard under "Redirect URIs".
    const url = new URL("admin.html", window.location.href);
    url.search = "";
    url.hash = "";
    return url.toString();
  }

  function getTokens() {
    try {
      const raw = localStorage.getItem("jtp_spotify_tokens");
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function setTokens(tokens) {
    localStorage.setItem("jtp_spotify_tokens", JSON.stringify(tokens));
  }

  function clearTokens() {
    localStorage.removeItem("jtp_spotify_tokens");
  }

  function isConnected() {
    return !!getTokens();
  }

  // --- PKCE helpers ---

  function randomString(length) {
    const chars =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let out = "";
    const values = crypto.getRandomValues(new Uint8Array(length));
    for (let i = 0; i < length; i++) out += chars[values[i] % chars.length];
    return out;
  }

  async function sha256Base64Url(input) {
    const data = new TextEncoder().encode(input);
    const digest = await crypto.subtle.digest("SHA-256", data);
    let str = "";
    new Uint8Array(digest).forEach((b) => (str += String.fromCharCode(b)));
    return btoa(str)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  }

  // --- Auth flow ---

  async function startAuth() {
    const clientId = getClientId();
    if (!clientId) {
      throw new Error("Save a Spotify Client ID before connecting.");
    }
    const verifier = randomString(64);
    localStorage.setItem("jtp_spotify_pkce_verifier", verifier);
    const challenge = await sha256Base64Url(verifier);

    const params = new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      redirect_uri: getRedirectUri(),
      code_challenge_method: "S256",
      code_challenge: challenge,
      scope: SCOPES,
    });
    window.location.href = `${AUTH_URL}?${params.toString()}`;
  }

  // Call this once on admin.html load. Returns true if a fresh token
  // was just obtained from a redirect (so the caller can show a toast).
  async function handleRedirectCallback() {
    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");

    if (error) {
      window.history.replaceState({}, "", url.pathname);
      throw new Error(`Spotify said: ${error}`);
    }
    if (!code) return false;

    const verifier = localStorage.getItem("jtp_spotify_pkce_verifier");
    if (!verifier) {
      window.history.replaceState({}, "", url.pathname);
      throw new Error("Missing PKCE verifier — try connecting again.");
    }

    const body = new URLSearchParams({
      client_id: getClientId(),
      grant_type: "authorization_code",
      code,
      redirect_uri: getRedirectUri(),
      code_verifier: verifier,
    });

    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    window.history.replaceState({}, "", url.pathname);

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Token exchange failed: ${text}`);
    }
    const json = await res.json();
    setTokens({
      access_token: json.access_token,
      refresh_token: json.refresh_token,
      expires_at: Date.now() + json.expires_in * 1000 - 30000,
    });
    localStorage.removeItem("jtp_spotify_pkce_verifier");
    return true;
  }

  async function refreshAccessToken() {
    const tokens = getTokens();
    if (!tokens || !tokens.refresh_token) {
      throw new Error("Not connected to Spotify yet.");
    }
    const body = new URLSearchParams({
      client_id: getClientId(),
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
    });
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) {
      clearTokens();
      throw new Error("Spotify session expired — reconnect in Settings.");
    }
    const json = await res.json();
    setTokens({
      access_token: json.access_token,
      refresh_token: json.refresh_token || tokens.refresh_token,
      expires_at: Date.now() + json.expires_in * 1000 - 30000,
    });
  }

  async function getValidAccessToken() {
    const tokens = getTokens();
    if (!tokens) throw new Error("Not connected to Spotify yet.");
    if (Date.now() >= tokens.expires_at) {
      await refreshAccessToken();
    }
    return getTokens().access_token;
  }

  function disconnect() {
    clearTokens();
  }

  // --- Web API calls ---

  async function apiFetch(path, options = {}) {
    const token = await getValidAccessToken();
    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });
    return res;
  }

  async function getDevices() {
    const res = await apiFetch("/me/player/devices");
    if (!res.ok) throw new Error("Could not read Spotify devices.");
    const json = await res.json();
    return json.devices || [];
  }

  // Picks the best device to play on: prefers one already active,
  // otherwise falls back to the first device Spotify can see (which
  // is normally the Spotify app open on the iPad itself).
  async function pickTargetDevice() {
    const devices = await getDevices();
    if (devices.length === 0) {
      throw new Error(
        "No Spotify device found. Open the Spotify app on the iPad first."
      );
    }
    return devices.find((d) => d.is_active) || devices[0];
  }

  async function playUris(uris) {
    const device = await pickTargetDevice();
    const res = await apiFetch(`/me/player/play?device_id=${device.id}`, {
      method: "PUT",
      body: JSON.stringify({ uris }),
    });
    if (!res.ok && res.status !== 204) {
      const text = await res.text();
      throw new Error(`Spotify wouldn't play that: ${text}`);
    }
  }

  async function playContext(contextUri) {
    const device = await pickTargetDevice();
    const res = await apiFetch(`/me/player/play?device_id=${device.id}`, {
      method: "PUT",
      body: JSON.stringify({ context_uri: contextUri }),
    });
    if (!res.ok && res.status !== 204) {
      const text = await res.text();
      throw new Error(`Spotify wouldn't play that: ${text}`);
    }
  }

  async function getMe() {
    const res = await apiFetch("/me");
    if (!res.ok) throw new Error("Could not read Spotify profile.");
    return res.json();
  }

  // Accepts open.spotify.com links OR spotify: URIs and normalizes to
  // a spotify:type:id URI, so people can just paste a share link.
  function normalizeSpotifyLink(input) {
    const value = input.trim();
    if (value.startsWith("spotify:")) return value;
    try {
      const url = new URL(value);
      const parts = url.pathname.split("/").filter(Boolean);
      // e.g. /track/abc123  or  /playlist/abc123
      if (parts.length >= 2) {
        const [type, id] = parts;
        return `spotify:${type}:${id.split("?")[0]}`;
      }
    } catch {
      // not a URL, fall through
    }
    return value;
  }

  return {
    getClientId,
    setClientId,
    getRedirectUri,
    isConnected,
    startAuth,
    handleRedirectCallback,
    getValidAccessToken,
    disconnect,
    getDevices,
    playUris,
    playContext,
    getMe,
    normalizeSpotifyLink,
  };
})();
