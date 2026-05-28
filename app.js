const audio = document.querySelector("#audio");
const fileInput = document.querySelector("#file-input");
const dropZone = document.querySelector("[data-drop-zone]");
const searchInput = document.querySelector("#search-input");
const progressInput = document.querySelector("#progress");
const volumeInput = document.querySelector("#volume");
const toast = document.querySelector("#toast");

const els = {
  mixGrid: document.querySelector("#mix-grid"),
  recentList: document.querySelector("#recent-list"),
  libraryList: document.querySelector("#library-list"),
  libraryCount: document.querySelector("#library-count"),
  queueList: document.querySelector("#queue-list"),
  nowArt: document.querySelector("#now-art"),
  nowTitle: document.querySelector("#now-title-text"),
  nowArtist: document.querySelector("#now-artist-text"),
  factSource: document.querySelector("#fact-source"),
  factLength: document.querySelector("#fact-length"),
  factFormat: document.querySelector("#fact-format"),
  miniArt: document.querySelector("#mini-art"),
  miniTitle: document.querySelector("#mini-title"),
  miniArtist: document.querySelector("#mini-artist"),
  playIcon: document.querySelector("#play-icon use"),
  elapsed: document.querySelector("#elapsed"),
  duration: document.querySelector("#duration"),
};

const DB_NAME = "waveroom-library";
const DB_VERSION = 1;
const TRACK_STORE = "tracks";
const FAVORITES_KEY = "waveroom:favorites";
const VIEW_KEY = "waveroom:view";
const VOLUME_KEY = "waveroom:volume";
const RADIO_BASE = "https://all.api.radio-browser.info";
const RADIO_TAGS = ["hits", "top40", "top 40", "chart", "pop"];
const RADIO_PINNED_SEARCHES = ["Capital", "BBC Radio 1", "Z100", "KIIS", "NRJ Hits", "Hits 1", "LOS 40", "Radio 105", "1LIVE"];
const RADIO_EXCLUDE = /\b(60s|70s|80s|90s|classic|classical|oldies|vinyl|jazz|talk|news|sports)\b/i;
const RADIO_INCLUDE = /\b(hit|hits|top\s?40|chart|pop|contemporary hit|chr)\b/i;

const demoBlueprints = [
  {
    id: "demo-dreamstate-drive",
    title: "Dreamstate Drive",
    artist: "Mira Vale",
    album: "Nocturne Routes",
    cover: "assets/dreamstate-drive.jpg",
    duration: 26,
    colors: ["#20d6bd", "#ff715f"],
    playlists: ["Late Night", "Drive Home"],
    seed: 17,
    tempo: 94,
    tone: "pulse",
  },
  {
    id: "demo-mira-vale",
    title: "Mira Vale",
    artist: "Glasshouse Radio",
    album: "Sun Through Leaves",
    cover: "assets/mira-vale.jpg",
    duration: 24,
    colors: ["#f4c95d", "#1dbfae"],
    playlists: ["Deep Focus"],
    seed: 31,
    tempo: 78,
    tone: "warm",
  },
  {
    id: "demo-neon-atlas",
    title: "Neon Atlas",
    artist: "Arc & Meridian",
    album: "City Signal",
    cover: "assets/neon-atlas.jpg",
    duration: 28,
    colors: ["#28c7ff", "#ff715f"],
    playlists: ["Drive Home"],
    seed: 49,
    tempo: 108,
    tone: "bright",
  },
  {
    id: "demo-the-afterhours",
    title: "The Afterhours",
    artist: "Northline Trio",
    album: "Copper Room",
    cover: "assets/the-afterhours.jpg",
    duration: 25,
    colors: ["#be7d4b", "#f4c95d"],
    playlists: ["Late Night", "Deep Focus"],
    seed: 73,
    tempo: 86,
    tone: "soft",
  },
];

const state = {
  db: null,
  tracks: [],
  view: localStorage.getItem(VIEW_KEY) || "Library",
  selectedPlaylist: "",
  query: "",
  currentId: "",
  queue: [],
  queueIndex: 0,
  isPlaying: false,
  shuffle: false,
  repeat: "all",
  toastTimer: 0,
  favorites: new Set(readJson(FAVORITES_KEY, [])),
};

boot();

async function boot() {
  bindEvents();
  audio.volume = Number(localStorage.getItem(VOLUME_KEY) || 0.74);
  volumeInput.value = audio.volume;

  const demos = demoBlueprints.map((track) => ({
    ...track,
    source: "Demo",
    format: "WAV",
    blob: createDemoWav(track),
  }));

  demos.forEach((track) => {
    track.url = URL.createObjectURL(track.blob);
  });

  const radioTracks = await fetchRadioStations();
  state.tracks = [...radioTracks, ...demos];
  state.queue = state.tracks.map((track) => track.id);
  state.currentId = state.tracks[0]?.id || demos[0].id;

  try {
    state.db = await openDatabase();
    const storedTracks = await readStoredTracks();
    state.tracks = [...radioTracks, ...demos, ...storedTracks.map(materializeStoredTrack)];
  } catch (error) {
    console.warn("Local library storage is unavailable.", error);
    showToast("Storage off");
  }

  syncAudioSource(false);
  render();
}

function bindEvents() {
  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-action], [data-view], [data-playlist]");
    if (!button) return;

    if (button.dataset.view) {
      setView(button.dataset.view);
      return;
    }

    if (button.dataset.playlist) {
      state.view = "Playlists";
      state.selectedPlaylist = button.dataset.playlist;
      persistView();
      render();
      return;
    }

    const id = button.dataset.trackId;
    switch (button.dataset.action) {
      case "open-files":
        fileInput.click();
        break;
      case "play-track":
        playTrack(id, getVisibleTracks().map((track) => track.id));
        break;
      case "add-queue":
        addToQueue(id);
        break;
      case "toggle-favorite":
        toggleFavorite(id || state.currentId);
        break;
      case "toggle-play":
        togglePlay();
        break;
      case "previous":
        previousTrack();
        break;
      case "next":
        nextTrack(true);
        break;
      case "toggle-shuffle":
        state.shuffle = !state.shuffle;
        renderTransportState();
        showToast(state.shuffle ? "Shuffle" : "No shuffle");
        break;
      case "toggle-repeat":
        state.repeat = state.repeat === "off" ? "all" : state.repeat === "all" ? "one" : "off";
        renderTransportState();
        showToast(`Repeat ${state.repeat}`);
        break;
      case "play-visible":
        playVisibleTracks();
        break;
      case "play-demos":
        playTrack(demoBlueprints[0].id, demoBlueprints.map((track) => track.id));
        break;
      case "clear-session":
        clearQueue();
        break;
      default:
        break;
    }
  });

  fileInput.addEventListener("change", async (event) => {
    await importFiles(event.target.files);
    fileInput.value = "";
  });

  searchInput.addEventListener("input", (event) => {
    state.query = event.target.value.trim();
    if (state.query) state.view = "Search";
    render();
  });

  progressInput.addEventListener("input", () => {
    if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
    audio.currentTime = (Number(progressInput.value) / 1000) * audio.duration;
  });

  volumeInput.addEventListener("input", () => {
    audio.volume = Number(volumeInput.value);
    localStorage.setItem(VOLUME_KEY, String(audio.volume));
  });

  audio.addEventListener("play", () => {
    state.isPlaying = true;
    renderPlayerChrome();
  });

  audio.addEventListener("pause", () => {
    state.isPlaying = false;
    renderPlayerChrome();
  });

  audio.addEventListener("loadedmetadata", () => {
    const track = getCurrentTrack();
    if (track && (!track.duration || Math.abs(track.duration - audio.duration) > 1)) {
      track.duration = audio.duration;
    }
    renderPlayerChrome();
  });

  audio.addEventListener("timeupdate", updateProgress);

  audio.addEventListener("ended", () => {
    if (state.repeat === "one") {
      audio.currentTime = 0;
      audio.play();
      return;
    }
    nextTrack(true);
  });

  document.addEventListener("keydown", (event) => {
    const editable = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
    if (editable) return;
    if (event.code === "Space") {
      event.preventDefault();
      togglePlay();
    }
  });

  ["dragenter", "dragover"].forEach((type) => {
    dropZone.addEventListener(type, (event) => {
      event.preventDefault();
      dropZone.classList.add("dragging");
    });
  });

  ["dragleave", "drop"].forEach((type) => {
    dropZone.addEventListener(type, (event) => {
      event.preventDefault();
      dropZone.classList.remove("dragging");
    });
  });

  dropZone.addEventListener("drop", async (event) => {
    await importFiles(event.dataTransfer.files);
  });

  if ("mediaSession" in navigator) {
    navigator.mediaSession.setActionHandler("play", () => togglePlay(true));
    navigator.mediaSession.setActionHandler("pause", () => togglePlay(false));
    navigator.mediaSession.setActionHandler("previoustrack", previousTrack);
    navigator.mediaSession.setActionHandler("nexttrack", () => nextTrack(true));
  }
}

function setView(view) {
  state.view = view;
  if (view !== "Playlists") state.selectedPlaylist = "";
  if (view === "Search") {
    setTimeout(() => searchInput.focus(), 0);
  }
  persistView();
  render();
}

function persistView() {
  localStorage.setItem(VIEW_KEY, state.view);
}

function render() {
  renderNavigation();
  renderMixes();
  renderRecentImports();
  renderLibrary();
  renderQueue();
  renderPlayerChrome();
}

function renderNavigation() {
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === state.view);
  });
  document.querySelectorAll("[data-playlist]").forEach((button) => {
    button.classList.toggle("active", button.dataset.playlist === state.selectedPlaylist);
  });
  if (searchInput.value !== state.query) searchInput.value = state.query;
}

function getFeaturedTracks() {
  const radio = state.tracks.filter((track) => track.source === "Radio").slice(0, 4);
  return radio.length ? radio : demoBlueprints.map((track) => getTrack(track.id)).filter(Boolean);
}

function renderMixes() {
  const featured = getFeaturedTracks();
  const cards = featured.map((track) => {
    return `
      <article class="mix-card">
        ${coverMarkup(track, "cover")}
        <button class="card-play" type="button" data-action="play-track" data-track-id="${escapeAttr(track.id)}" aria-label="Play ${escapeAttr(track.title)}">
          <svg><use href="#icon-play"></use></svg>
        </button>
        <div>
          <h3>${escapeHtml(track.title)}</h3>
          <p>${escapeHtml(track.artist)}</p>
        </div>
      </article>
    `;
  });
  els.mixGrid.innerHTML = cards.join("");
}

function renderRecentImports() {
  const uploads = state.tracks
    .filter((track) => track.source === "Upload")
    .sort((a, b) => b.addedAt - a.addedAt)
    .slice(0, 5);
  const recent = uploads.length ? uploads : state.tracks.slice(0, 4);

  els.recentList.innerHTML = recent.length
    ? trackRows(recent)
    : `<div class="empty-state">Drop audio files here or open files.</div>`;
}

function renderLibrary() {
  const visible = getVisibleTracks();
  const label = visible.length === 1 ? "1 track" : `${visible.length} tracks`;
  els.libraryCount.textContent = label;
  els.libraryList.innerHTML = visible.length
    ? trackRows(visible)
    : `<div class="empty-state">No matching tracks.</div>`;
}

function renderQueue() {
  const upcoming = getUpcomingTracks();
  els.queueList.innerHTML = upcoming.length
    ? upcoming
        .map((track, index) => {
          return `
            <button class="queue-item" type="button" data-action="play-track" data-track-id="${escapeAttr(track.id)}">
              <span class="queue-index">${index + 1}</span>
              <span class="queue-copy">
                <strong>${escapeHtml(track.title)}</strong>
                <span>${escapeHtml(track.artist)}</span>
              </span>
              <span class="track-cell">${track.isRadio ? "LIVE" : formatTime(track.duration)}</span>
            </button>
          `;
        })
        .join("")
    : `<div class="empty-state">Queue is clear.</div>`;
}

function renderPlayerChrome() {
  const track = getCurrentTrack() || state.tracks[0];
  if (!track) return;

  els.nowArt.innerHTML = coverInnerMarkup(track, "Now playing cover art");
  els.miniArt.innerHTML = coverInnerMarkup(track, "Current track cover art");
  applyCoverColors(els.nowArt, track);
  applyCoverColors(els.miniArt, track);
  els.nowArt.classList.toggle("generated", !track.cover);
  els.miniArt.classList.toggle("generated", !track.cover);

  els.nowTitle.textContent = track.title;
  els.nowArtist.textContent = track.artist;
  els.factSource.textContent = track.source;
  els.factLength.textContent = track.isRadio ? "LIVE" : formatTime(track.duration || audio.duration);
  els.factFormat.textContent = track.format;
  els.miniTitle.textContent = track.title;
  els.miniArtist.textContent = track.artist;
  els.playIcon.setAttribute("href", state.isPlaying ? "#icon-pause" : "#icon-play");

  document.querySelectorAll("[data-action='toggle-shuffle']").forEach((button) => {
    button.dataset.active = String(state.shuffle);
  });
  document.querySelectorAll("[data-action='toggle-repeat']").forEach((button) => {
    button.dataset.active = String(state.repeat !== "off");
    button.title = `Repeat ${state.repeat}`;
  });
  document.querySelectorAll("[data-action='toggle-favorite']").forEach((button) => {
    button.classList.toggle("favorite-on", state.favorites.has(track.id));
  });

  updateProgress();
  updateMediaSession(track);
}

function renderTransportState() {
  document.querySelectorAll("[data-action='toggle-shuffle']").forEach((button) => {
    button.dataset.active = String(state.shuffle);
  });
  document.querySelectorAll("[data-action='toggle-repeat']").forEach((button) => {
    button.dataset.active = String(state.repeat !== "off");
  });
}

function trackRows(tracks) {
  return tracks
    .map((track) => {
      const isCurrent = track.id === state.currentId;
      const isFavorite = state.favorites.has(track.id);
      const icon = isCurrent && state.isPlaying ? "#icon-pause" : "#icon-play";
      return `
        <article class="track-row ${isCurrent ? "active" : ""}">
          ${coverMarkup(track, "track-art")}
          <div class="track-main">
            <strong>${escapeHtml(track.title)}</strong>
            <span>${escapeHtml(track.artist)}</span>
          </div>
          <div class="track-cell">${escapeHtml(track.album)}</div>
          <div class="track-cell duration-cell">${track.isRadio ? "LIVE" : formatTime(track.duration)}</div>
          <div class="row-actions">
            <button class="icon-button" type="button" data-action="play-track" data-track-id="${escapeAttr(track.id)}" aria-label="Play ${escapeAttr(track.title)}">
              <svg><use href="${icon}"></use></svg>
            </button>
            <button class="icon-button ${isFavorite ? "favorite-on" : ""}" type="button" data-action="toggle-favorite" data-track-id="${escapeAttr(track.id)}" aria-label="Favorite ${escapeAttr(track.title)}">
              <svg><use href="#icon-heart"></use></svg>
            </button>
            <button class="icon-button" type="button" data-action="add-queue" data-track-id="${escapeAttr(track.id)}" aria-label="Add ${escapeAttr(track.title)} to queue">
              <svg><use href="#icon-plus"></use></svg>
            </button>
          </div>
        </article>
      `;
    })
    .join("");
}

function getVisibleTracks() {
  let tracks = [...state.tracks];
  if (state.view === "Uploads") {
    tracks = tracks.filter((track) => track.source === "Upload");
  } else if (state.view === "Favorites") {
    tracks = tracks.filter((track) => state.favorites.has(track.id));
  } else if (state.view === "Playlists" && state.selectedPlaylist) {
    tracks = tracks.filter((track) => matchesPlaylist(track, state.selectedPlaylist));
  }

  const query = state.query.toLowerCase();
  if (query) {
    tracks = tracks.filter((track) => {
      return [track.title, track.artist, track.album, track.source].some((value) =>
        value.toLowerCase().includes(query),
      );
    });
  }

  return tracks;
}

function matchesPlaylist(track, playlist) {
  if (playlist === "Fresh Imports") return track.source === "Upload";
  return track.playlists?.includes(playlist);
}

async function importFiles(fileList) {
  const files = Array.from(fileList || []).filter(isAudioFile);
  if (!files.length) {
    showToast("No audio");
    return;
  }

  const importedIds = [];
  for (const file of files) {
    const track = await createTrackFromFile(file);
    importedIds.push(track.id);
    upsertTrack(track);
    if (state.db) {
      await saveStoredTrack(track);
    }
  }

  if (importedIds.length) {
    state.view = "Uploads";
    state.selectedPlaylist = "";
    state.query = "";
    searchInput.value = "";
    persistView();
    if (!state.currentId || !getCurrentTrack()) {
      state.currentId = importedIds[0];
      syncAudioSource(false);
    }
    render();
    showToast(importedIds.length === 1 ? "Imported" : `${importedIds.length} imported`);
  }
}

async function createTrackFromFile(file) {
  const id = `local-${hashString(`${file.name}-${file.size}-${file.lastModified}`)}`;
  const parsed = parseFileName(file.name);
  const url = URL.createObjectURL(file);
  const duration = await probeDuration(url);
  const colors = paletteFromString(file.name);
  return {
    id,
    title: parsed.title,
    artist: parsed.artist,
    album: "Uploads",
    cover: "",
    duration,
    colors,
    playlists: ["Fresh Imports"],
    source: "Upload",
    format: formatFromFile(file),
    size: file.size,
    type: file.type,
    addedAt: Date.now(),
    blob: file,
    url,
  };
}

function upsertTrack(track) {
  const existingIndex = state.tracks.findIndex((item) => item.id === track.id);
  if (existingIndex >= 0) {
    const oldTrack = state.tracks[existingIndex];
    if (oldTrack.source === "Upload" && oldTrack.url && oldTrack.url !== track.url) {
      URL.revokeObjectURL(oldTrack.url);
    }
    state.tracks.splice(existingIndex, 1, track);
    return;
  }
  state.tracks.push(track);
}

function isAudioFile(file) {
  return file.type.startsWith("audio/") || /\.(aac|aiff|flac|m4a|mp3|ogg|opus|wav|webm)$/i.test(file.name);
}

function parseFileName(name) {
  const clean = name.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").trim();
  const parts = clean.split(/\s+-\s+/);
  if (parts.length >= 2) {
    return {
      artist: titleCase(parts[0]),
      title: titleCase(parts.slice(1).join(" - ")),
    };
  }
  return {
    artist: "Local file",
    title: titleCase(clean || "Untitled track"),
  };
}

function playVisibleTracks() {
  const tracks = getVisibleTracks();
  if (!tracks.length) {
    showToast("Empty");
    return;
  }
  playTrack(tracks[0].id, tracks.map((track) => track.id));
}

function playTrack(id, queueIds = null) {
  const track = getTrack(id);
  if (!track) return;
  if (id === state.currentId && !audio.paused) {
    audio.pause();
    return;
  }

  if (queueIds?.length) {
    state.queue = unique(queueIds);
  } else if (!state.queue.includes(id)) {
    state.queue = unique([state.currentId, ...state.queue, id].filter(Boolean));
  }
  state.queueIndex = Math.max(0, state.queue.indexOf(id));
  state.currentId = id;
  if (track.isRadio) countRadioClick(track.stationuuid);
  syncAudioSource(true);
  render();
}

function syncAudioSource(autoplay) {
  const track = getCurrentTrack();
  if (!track) return;
  if (audio.dataset.trackId !== track.id) {
    audio.src = track.url;
    audio.dataset.trackId = track.id;
  }
  if (autoplay) {
    audio
      .play()
      .then(() => {
        state.isPlaying = true;
        renderPlayerChrome();
      })
      .catch(() => {
        showToast("Tap play");
      });
  }
}

function togglePlay(forcePlay) {
  const track = getCurrentTrack() || getVisibleTracks()[0] || state.tracks[0];
  if (!track) return;
  if (track.id !== state.currentId) {
    state.currentId = track.id;
    syncAudioSource(false);
  }

  const shouldPlay = typeof forcePlay === "boolean" ? forcePlay : audio.paused;
  if (shouldPlay) {
    syncAudioSource(false);
    audio
      .play()
      .then(() => {
        state.isPlaying = true;
        renderPlayerChrome();
      })
      .catch(() => {
        showToast("Tap play");
      });
  } else {
    audio.pause();
  }
}

function previousTrack() {
  if (audio.currentTime > 4) {
    audio.currentTime = 0;
    return;
  }

  const ids = state.queue.length ? state.queue : getVisibleTracks().map((track) => track.id);
  if (!ids.length) return;
  state.queueIndex = Math.max(0, ids.indexOf(state.currentId));
  const nextIndex = state.queueIndex <= 0 ? ids.length - 1 : state.queueIndex - 1;
  state.queue = ids;
  state.queueIndex = nextIndex;
  state.currentId = ids[nextIndex];
  syncAudioSource(!audio.paused);
  render();
}

function nextTrack(autoplay) {
  const ids = state.queue.length ? state.queue : getVisibleTracks().map((track) => track.id);
  if (!ids.length) return;

  state.queueIndex = Math.max(0, ids.indexOf(state.currentId));
  let nextIndex = state.queueIndex + 1;

  if (state.shuffle && ids.length > 1) {
    do {
      nextIndex = Math.floor(Math.random() * ids.length);
    } while (ids[nextIndex] === state.currentId);
  } else if (nextIndex >= ids.length) {
    if (state.repeat === "all") {
      nextIndex = 0;
    } else {
      audio.pause();
      audio.currentTime = 0;
      return;
    }
  }

  state.queue = ids;
  state.queueIndex = nextIndex;
  state.currentId = ids[nextIndex];
  syncAudioSource(autoplay);
  render();
}

function addToQueue(id) {
  const track = getTrack(id);
  if (!track) return;
  if (!state.queue.length && state.currentId) state.queue = [state.currentId];
  state.queue = unique([...state.queue, id]);
  state.queueIndex = Math.max(0, state.queue.indexOf(state.currentId));
  renderQueue();
  showToast("Queued");
}

function clearQueue() {
  state.queue = state.currentId ? [state.currentId] : [];
  state.queueIndex = 0;
  renderQueue();
  showToast("Cleared");
}

function toggleFavorite(id) {
  const track = getTrack(id);
  if (!track) return;
  if (state.favorites.has(id)) {
    state.favorites.delete(id);
    showToast("Unliked");
  } else {
    state.favorites.add(id);
    showToast("Liked");
  }
  localStorage.setItem(FAVORITES_KEY, JSON.stringify([...state.favorites]));
  render();
}

function getUpcomingTracks() {
  if (!state.queue.length) return [];
  const currentIndex = Math.max(0, state.queue.indexOf(state.currentId));
  return state.queue.slice(currentIndex + 1).map(getTrack).filter(Boolean);
}

function getCurrentTrack() {
  return getTrack(state.currentId);
}

function getTrack(id) {
  return state.tracks.find((track) => track.id === id);
}

async function fetchRadioStations() {
  try {
    const pinnedRequests = RADIO_PINNED_SEARCHES.map((name) => {
      const params = new URLSearchParams({
        name,
        hidebroken: "true",
        order: "clickcount",
        reverse: "true",
        limit: "6",
      });
      return fetch(`${RADIO_BASE}/json/stations/search?${params}`).then((response) =>
        response.ok ? response.json() : [],
      );
    });
    const tagRequests = RADIO_TAGS.map((tag) => {
      const params = new URLSearchParams({
        tag,
        hidebroken: "true",
        order: "clickcount",
        reverse: "true",
        limit: "18",
      });
      return fetch(`${RADIO_BASE}/json/stations/search?${params}`).then((response) =>
        response.ok ? response.json() : [],
      );
    });
    const pinnedGroups = await Promise.all(pinnedRequests);
    const tagGroups = await Promise.all(tagRequests);
    const seen = new Set();
    const pinned = pinnedGroups
      .map((group, index) => {
        const station = group.find((item) => isGoodRadioStation(item, { allowLowClicks: true }));
        return station ? { ...station, preferredRank: index } : null;
      })
      .filter(Boolean);
    const scored = tagGroups
      .flat()
      .filter((station) => isGoodRadioStation(station))
      .sort((a, b) => scoreRadioStation(b) - scoreRadioStation(a));

    return [...pinned, ...scored]
      .filter((station) => {
        const key = station.stationuuid || station.url_resolved || station.url || station.name;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 18)
      .map((station) => ({
        id: `radio-${station.stationuuid}`,
        stationuuid: station.stationuuid,
        title: cleanStationName(station.name),
        artist: [shortCountry(station.country), station.codec].filter(Boolean).slice(0, 2).join(" · ") || "Live radio",
        album: "Radio",
        cover: station.favicon || "",
        duration: 0,
        colors: paletteFromString(station.name || station.stationuuid),
        playlists: ["Fresh Imports"],
        source: "Radio",
        format: station.codec || "LIVE",
        addedAt: Date.now(),
        isRadio: true,
        url: station.url_resolved || station.url,
      }));
  } catch (error) {
    console.warn("Radio stations unavailable.", error);
    showToast("Radio off");
    return [];
  }
}

function countRadioClick(stationuuid) {
  if (!stationuuid) return;
  fetch(`${RADIO_BASE}/json/url/${encodeURIComponent(stationuuid)}`).catch(() => {});
}

function isGoodRadioStation(station, options = {}) {
  const url = station?.url_resolved || station?.url || "";
  const codec = String(station?.codec || "").toLowerCase();
  const name = String(station?.name || "");
  const label = `${name} ${station?.tags || ""}`;
  const playable = url && !url.includes(".m3u8") && !url.includes(".pls");
  const commonCodec = !codec || ["mp3", "aac", "aac+", "ogg", "opus", "unknown"].includes(codec);
  const saneName = name.trim().length > 1 && name.trim().length < 70 && !/^[#\-\s]+/.test(name);
  const currentMusic = RADIO_INCLUDE.test(label);
  return Boolean(playable && commonCodec && saneName && !RADIO_EXCLUDE.test(label) && (options.allowLowClicks || currentMusic));
}

function scoreRadioStation(station) {
  const country = String(station.country || "").toLowerCase();
  const label = `${station.name || ""} ${station.tags || ""}`.toLowerCase();
  let score = Number(station.clickcount || 0);
  if (country.includes("united states")) score += 180;
  if (country.includes("united kingdom")) score += 150;
  if (country.includes("canada") || country.includes("australia")) score += 90;
  if (/top\s?40|contemporary hit|chr/.test(label)) score += 120;
  if (/\bhits?\b|chart|pop/.test(label)) score += 80;
  return score;
}

function updateProgress() {
  const track = getCurrentTrack();
  if (track?.isRadio) {
    els.elapsed.textContent = "";
    els.duration.textContent = "LIVE";
    els.factLength.textContent = "LIVE";
    progressInput.value = "0";
    progressInput.disabled = true;
    return;
  }
  progressInput.disabled = false;
  const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : track?.duration || 0;
  const currentTime = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
  els.elapsed.textContent = formatTime(currentTime);
  els.duration.textContent = formatTime(duration);
  els.factLength.textContent = formatTime(duration);
  progressInput.value = duration ? String(Math.min(1000, Math.round((currentTime / duration) * 1000))) : "0";
}

function updateMediaSession(track) {
  if (!("mediaSession" in navigator) || !track) return;
  const artwork = track.cover
    ? [
        {
          src: new URL(track.cover, window.location.href).href,
          sizes: "800x800",
          type: "image/jpeg",
        },
      ]
    : [];
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title,
    artist: track.artist,
    album: track.album,
    artwork,
  });
}

function coverMarkup(track, className) {
  const colorStyle = `--c1:${escapeAttr(track.colors?.[0] || "#20d6bd")};--c2:${escapeAttr(track.colors?.[1] || "#ff715f")}`;
  return `
    <div class="${className} ${track.cover ? "" : "generated"}" style="${colorStyle}">
      ${coverInnerMarkup(track, `${track.title} cover art`)}
    </div>
  `;
}

function coverInnerMarkup(track, alt) {
  if (track.cover) {
    return `<img src="${escapeAttr(track.cover)}" alt="${escapeAttr(alt)}" />`;
  }
  return `<span>${escapeHtml(initials(track.title))}</span>`;
}

function applyCoverColors(element, track) {
  element.style.setProperty("--c1", track.colors?.[0] || "#20d6bd");
  element.style.setProperty("--c2", track.colors?.[1] || "#ff715f");
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(state.toastTimer);
  state.toastTimer = window.setTimeout(() => toast.classList.remove("show"), 2600);
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(TRACK_STORE)) {
        db.createObjectStore(TRACK_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function readStoredTracks() {
  return new Promise((resolve, reject) => {
    const transaction = state.db.transaction(TRACK_STORE, "readonly");
    const request = transaction.objectStore(TRACK_STORE).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function saveStoredTrack(track) {
  const { url, ...record } = track;
  return new Promise((resolve, reject) => {
    const transaction = state.db.transaction(TRACK_STORE, "readwrite");
    const request = transaction.objectStore(TRACK_STORE).put(record);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function materializeStoredTrack(record) {
  return {
    ...record,
    url: URL.createObjectURL(record.blob),
  };
}

function createDemoWav(track) {
  const sampleRate = 22050;
  const seconds = track.duration;
  const totalSamples = Math.floor(sampleRate * seconds);
  const buffer = new ArrayBuffer(44 + totalSamples * 2);
  const view = new DataView(buffer);
  const bpm = track.tempo;
  const beatLength = 60 / bpm;
  const root = 110 + (track.seed % 5) * 12;
  const isSoft = track.tone === "soft";
  const isWarm = track.tone === "warm";
  const isBright = track.tone === "bright";

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + totalSamples * 2, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, totalSamples * 2, true);

  for (let i = 0; i < totalSamples; i += 1) {
    const t = i / sampleRate;
    const beat = (t % beatLength) / beatLength;
    const bar = Math.floor(t / beatLength);
    const chordStep = [0, 3, 7, 10][bar % 4];
    const bassFreq = root * Math.pow(2, chordStep / 12);
    const leadFreq = bassFreq * (isBright ? 2.52 : 2.01);
    const padFreq = bassFreq * (isWarm ? 1.5 : 1.25);
    const fadeIn = Math.min(1, t / 1.6);
    const fadeOut = Math.min(1, (seconds - t) / 1.6);
    const envelope = fadeIn * fadeOut;
    const pulse = Math.exp(-beat * (isSoft ? 7 : 11));
    const hat = Math.exp(-((t + beatLength / 2) % beatLength) * 26);
    const noise = seededNoise(i + track.seed * 101);
    const bass = Math.sin(Math.PI * 2 * bassFreq * t) * (isSoft ? 0.17 : 0.24) * pulse;
    const pad =
      (Math.sin(Math.PI * 2 * padFreq * t) + Math.sin(Math.PI * 2 * padFreq * 1.505 * t) * 0.56) *
      (isBright ? 0.08 : 0.12);
    const lead =
      Math.sin(Math.PI * 2 * leadFreq * t + Math.sin(t * 2.1) * 0.6) *
      (0.08 + 0.04 * Math.sin(t * 0.7)) *
      (isWarm ? 0.55 : 1);
    const percussion = noise * (isSoft ? 0.018 : 0.034) * hat;
    const sample = softClip((bass + pad + lead + percussion) * envelope * 0.88);
    view.setInt16(44 + i * 2, sample * 32767, true);
  }

  return new Blob([buffer], { type: "audio/wav" });
}

function writeString(view, offset, value) {
  for (let i = 0; i < value.length; i += 1) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}

function seededNoise(value) {
  const x = Math.sin(value * 12.9898) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

function softClip(value) {
  return Math.max(-1, Math.min(1, value - (value ** 3) / 3));
}

function probeDuration(url) {
  return new Promise((resolve) => {
    const probe = new Audio();
    const done = (duration = 0) => {
      probe.removeAttribute("src");
      resolve(Number.isFinite(duration) ? duration : 0);
    };
    probe.addEventListener("loadedmetadata", () => done(probe.duration), { once: true });
    probe.addEventListener("error", () => done(0), { once: true });
    window.setTimeout(() => done(0), 3500);
    probe.src = url;
  });
}

function formatTime(value) {
  if (!Number.isFinite(value) || value <= 0) return "0:00";
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function formatFromFile(file) {
  const ext = file.name.includes(".") ? file.name.split(".").pop() : "";
  return (ext || file.type.replace("audio/", "") || "audio").slice(0, 8).toUpperCase();
}

function cleanStationName(value) {
  return String(value || "Radio")
    .replace(/^\s+/, "")
    .replace(/\s+-\s+.*$/g, "")
    .replace(/\s*\|\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 48);
}

function shortCountry(value) {
  return String(value || "")
    .replace("The United States Of America", "US")
    .replace("The United Kingdom Of Great Britain And Northern Ireland", "UK")
    .replace("Türkiye", "Turkey");
}

function paletteFromString(value) {
  const palettes = [
    ["#20d6bd", "#ff715f"],
    ["#f4c95d", "#2ec4b6"],
    ["#28c7ff", "#be7d4b"],
    ["#ff715f", "#f4c95d"],
    ["#73e0a9", "#e26d5c"],
  ];
  return palettes[Math.abs(hashNumber(value)) % palettes.length];
}

function hashString(value) {
  return Math.abs(hashNumber(value)).toString(36);
}

function hashNumber(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

function titleCase(value) {
  return value
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function initials(value) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function readJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) || fallback;
  } catch {
    return fallback;
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    return {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[char];
  });
}

function escapeAttr(value) {
  return escapeHtml(value);
}
