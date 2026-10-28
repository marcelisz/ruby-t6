const { createConsumer } = window.ActionCable;
const { getStroke } = window.PerfectFreehand;

(() => {
  const payloadElement = document.getElementById("boardPayload");
  const editorElement = document.getElementById("boardEditor");
  if (!payloadElement || !editorElement) return;

  let payload;
  try {
    payload = JSON.parse(payloadElement.textContent);
  } catch (error) {
    console.error("Could not read board payload", error);
    return;
  }

  const board = payload.board;
  const user = payload.user;
  const canvas = document.getElementById("boardCanvas");
  const cursorCanvas = document.getElementById("cursorCanvas");
  const stage = editorElement.querySelector(".editor-stage");
  if (!canvas || !cursorCanvas || !stage) return;

  const dom = {
    zoomLabel: editorElement.querySelector("[data-zoom-label]"),
    syncWrapper: editorElement.querySelector("[data-sync-wrapper]"),
    syncLabel: editorElement.querySelector("[data-sync-label]"),
    presenceAvatars: editorElement.querySelector("[data-presence-avatars]"),
    selfAvatar: editorElement.querySelector("[data-self-avatar]"),
    canvasEmpty: editorElement.querySelector("[data-canvas-empty]"),
    colorPanel: editorElement.querySelector("[data-color-panel]"),
    widthPanel: editorElement.querySelector("[data-width-panel]"),
    shapeMenu: editorElement.querySelector("[data-shape-menu]"),
    shapeToggle: editorElement.querySelector("[data-shape-toggle]"),
    shapeIcon: editorElement.querySelector("[data-shape-icon]"),
    colorToggle: editorElement.querySelector("[data-color-toggle]"),
    widthToggle: editorElement.querySelector("[data-width-toggle]"),
    inkSwatch: editorElement.querySelector("[data-ink-swatch]"),
    sizePreview: editorElement.querySelector("[data-size-preview]"),
    boardTitle: editorElement.querySelector("[data-board-title]"),
    noteModal: document.getElementById("noteModal"),
    textModal: document.getElementById("textModal"),
    renameModal: document.getElementById("renameBoardModal"),
    shortcutsModal: document.getElementById("shortcutsModal")
  };

  const COLORS = ["#191521", "#EF5533", "#FFB703", "#0E8A79", "#2563EB", "#7C3AED", "#D62F72", "#8A8178"];
  const SHAPE_KINDS = new Set(["rectangle", "ellipse", "line", "arrow"]);
  const FREEHAND_KINDS = new Set(["pen", "highlighter", "eraser"]);
  const MIN_ZOOM = 0.12;
  const MAX_ZOOM = 4;
  const CURSOR_LIFETIME = 4200;
  const LIVE_LIFETIME = 14000;
  const STORAGE_KEY = "tandem:client-id";

  const state = {
    tool: "pen",
    lastShape: "rectangle",
    color: "#191521",
    width: 4,
    camera: { x: 0, y: 0, zoom: 1 },
    viewport: { width: 0, height: 0, dpr: 1 },
    initializedView: false,
    connection: "connecting",
    draft: null,
    pan: null,
    pinch: null,
    touchPoints: new Map(),
    suppressTouchDraw: false,
    spacePressed: false,
    liveTimer: null,
    lastLiveAt: 0,
    boardDeleted: false,
    noteAnchor: null,
    textAnchor: null
  };

  let elements = Array.isArray(payload.elements)
    ? payload.elements.map((element) => ({ ...element, pending: false }))
    : [];
  let boardName = board.name;
  const liveElements = new Map();
  const remoteCursors = new Map();
  const pathCache = new Map();
  const textLayoutCache = new Map();
  let eraserMeasureContext = null;
  const pendingCommits = new Map();
  const pendingUndos = new Map();
  const locallyDeletedUids = new Set();
  const outbox = [];
  let undoStack = [];
  let redoStack = [];

  let channelConnected = false;
  let subscription = null;
  let consumer = null;
  let selfSessionId = null;
  let drawScheduled = false;
  let cursorDrawScheduled = false;
  let lastCursorSentAt = 0;
  let lastCursorWorld = null;
  let boardContext = null;
  let cursorContext = null;
  let clientId = loadClientId();

  init();

  function init() {
    bindCanvas();
    bindTools();
    bindZoom();
    bindModals();
    bindKeyboard();
    bindEditorActions();
    setupResizeObserver();
    resizeCanvases();
    updateToolUI();
    updateColorUI();
    updateWidthUI();
    updateHistoryButtons();
    updateEmptyState();
    refreshStatus();
    connectRealtime();

    document.fonts?.ready.then(() => {
      pathCache.clear();
      textLayoutCache.clear();
      requestBoardDraw();
    });

    window.setInterval(pruneEphemeralState, 1200);
    window.addEventListener("resize", () => {
      resizeCanvases();
    });
    window.addEventListener("orientationchange", () => {
      window.setTimeout(resizeCanvases, 150);
    });
    window.addEventListener("blur", () => {
      state.spacePressed = false;
      updateCursorStyle();
      sendCursorLeave();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) sendCursorLeave();
    });
  }

  /* Identity & realtime */

  function loadClientId() {
    const valid = (value) => /^[a-zA-Z0-9_-]{8,64}$/.test(value || "");
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (valid(saved)) return saved;

      const generated = window.crypto?.randomUUID
        ? window.crypto.randomUUID()
        : `client-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      window.localStorage.setItem(STORAGE_KEY, generated);
      return generated;
    } catch (error) {
      try {
        const saved = window.sessionStorage.getItem(STORAGE_KEY);
        if (valid(saved)) return saved;
        const generated = `client-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
        window.sessionStorage.setItem(STORAGE_KEY, generated);
        return generated;
      } catch (storageError) {
        return `client-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      }
    }
  }

  function connectRealtime() {
    consumer = createConsumer();
    subscription = consumer.subscriptions.create(
      {
        channel: "BoardChannel",
        board_id: board.id,
        client_id: clientId,
        nickname: user.nickname,
        last_element_id: payload.last_element_id || 0
      },
      {
        connected() {
          channelConnected = true;
          state.connection = "online";
          flushOutbox();
          refreshStatus();
        },
        disconnected() {
          channelConnected = false;
          state.connection = "disconnected";
          refreshStatus();
        },
        rejected() {
          channelConnected = false;
          state.connection = "rejected";
          refreshStatus();
          notify("This board is no longer available.", "danger");
          redirectToBoards(1800);
        },
        received(message) {
          handleMessage(message);
        }
      }
    );
  }

  function handleMessage(message) {
    if (!message || typeof message !== "object") return;

    switch (message.type) {
      case "welcome":
        selfSessionId = message.session_id;
        if (message.color) user.color = message.color;
        break;
      case "sync":
        handleSync(message);
        break;
      case "presence":
        handlePresence(message);
        break;
      case "cursor":
        handleRemoteCursor(message);
        break;
      case "cursor_gone":
        handleCursorGone(message);
        break;
      case "live":
        handleLiveElement(message);
        break;
      case "live_cancel":
        handleLiveCancel(message);
        break;
      case "element_created":
        handleElementCreated(message);
        break;
      case "element_deleted":
        handleElementDeleted(message);
        break;
      case "delete_failed":
        handleDeleteFailed(message);
        break;
      case "board_renamed":
        handleBoardRenamed(message);
        break;
      case "board_deleted":
        handleBoardDeleted();
        break;
      case "rename_failed":
        notify(message.message || "The board name could not be saved.", "danger");
        break;
      case "error":
        handleServerError(message);
        break;
      default:
        break;
    }
  }

  function sendAction(action, data, { queue = true } = {}) {
    if (channelConnected && subscription) {
      subscription.perform(action, data);
      return true;
    }

    if (queue) {
      outbox.push({ action, data });
      if (state.connection === "online") {
        state.connection = "disconnected";
      }
      refreshStatus();
    }
    return false;
  }

  function flushOutbox() {
    if (!subscription) return;

    while (outbox.length > 0) {
      const operation = outbox.shift();
      subscription.perform(operation.action, operation.data);
    }
  }

  function handleSync(message) {
    if (!Array.isArray(message.elements)) return;

    message.elements.forEach((element) => {
      mergeServerElement(element);
      clearPendingCommitForUid(element.client_uid);
    });

    updateEmptyState();
    refreshStatus();
    requestBoardDraw();
  }

  function mergeServerElement(element) {
    if (!element || !element.client_uid) return;

    const index = elements.findIndex((item) => item.client_uid === element.client_uid);
    const normalized = { ...element, pending: false };
    if (index >= 0) {
      elements[index] = { ...elements[index], ...normalized };
    } else {
      elements.push(normalized);
    }
    updateEmptyState();
  }

  function handleElementCreated(message) {
    const element = message.element;
    if (!element) return;

    if (message.temp_id) {
      liveElements.delete(message.temp_id);
    }

    clearPendingCommitForUid(element.client_uid);
    if (message.temp_id && pendingCommits.has(message.temp_id)) {
      pendingCommits.delete(message.temp_id);
    }

    if (!locallyDeletedUids.has(element.client_uid)) {
      mergeServerElement(element);
    } else if (element.kind === "note" || element.kind === "text") {
      sendAction("erase", { client_uid: element.client_uid });
    }

    updateHistoryButtons();
    refreshStatus();
    requestBoardDraw();
    requestCursorDraw();
  }

  function handleElementDeleted(message) {
    const element = message.element || {};
    const clientUid = element.client_uid;
    if (!clientUid) return;

    elements = elements.filter((item) => item.client_uid !== clientUid);
    locallyDeletedUids.delete(clientUid);

    if (pendingUndos.has(clientUid)) {
      const pending = pendingUndos.get(clientUid);
      redoStack.push(pending.entry);
      pendingUndos.delete(clientUid);
    } else {
      undoStack = undoStack.filter((entry) => entry.client_uid !== clientUid);
      redoStack = redoStack.filter((entry) => entry.client_uid !== clientUid);
    }

    for (const [tempId, pending] of pendingCommits.entries()) {
      if (pending.clientUid === clientUid) {
        pendingCommits.delete(tempId);
      }
    }

    updateHistoryButtons();
    updateEmptyState();
    refreshStatus();
    requestBoardDraw();
  }

  function handleDeleteFailed(message) {
    const clientUid = message.client_uid;
    const pending = pendingUndos.get(clientUid);

    if (pending) {
      if (!elements.some((element) => element.client_uid === clientUid)) {
        elements.push(pending.entry.element);
      }
      eraseRestoredElements(pending.entry);
      undoStack.push(pending.entry);
      pendingUndos.delete(clientUid);
      locallyDeletedUids.delete(clientUid);
    }

    notify(message.message || "That mark could not be undone.", "danger");
    updateHistoryButtons();
    updateEmptyState();
    refreshStatus();
    requestBoardDraw();
  }

  function handleServerError(message) {
    if (message.temp_id && pendingCommits.has(message.temp_id)) {
      const pending = pendingCommits.get(message.temp_id);
      pendingCommits.delete(message.temp_id);
      elements = elements.filter((element) => element.client_uid !== pending.clientUid);
      undoStack = undoStack.filter((entry) => entry.client_uid !== pending.clientUid);
      sendAction("live_cancel", { temp_id: message.temp_id }, { queue: false });
    }

    notify(message.message || "That change could not be saved.", "danger");
    updateHistoryButtons();
    updateEmptyState();
    refreshStatus();
    requestBoardDraw();
  }

  function clearPendingCommitForUid(clientUid) {
    for (const [tempId, pending] of pendingCommits.entries()) {
      if (pending.clientUid === clientUid) pendingCommits.delete(tempId);
    }
  }

  function handlePresence(message) {
    const participants = Array.isArray(message.participants) ? message.participants : [];
    const activeIds = new Set(participants.map((participant) => participant.id));

    renderPresence(participants);

    remoteCursors.forEach((cursor, sessionId) => {
      if (!activeIds.has(sessionId)) remoteCursors.delete(sessionId);
    });
    liveElements.forEach((live, tempId) => {
      if (!activeIds.has(live.senderSessionId)) liveElements.delete(tempId);
    });

    updateEmptyState();
    requestBoardDraw();
    requestCursorDraw();
  }

  function handleRemoteCursor(message) {
    if (!message.sender_session_id || message.sender_session_id === selfSessionId) return;

    const x = Number(message.x);
    const y = Number(message.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;

    remoteCursors.set(message.sender_session_id, {
      x,
      y,
      nickname: message.nickname || "Guest",
      color: message.color || "#6554E8",
      initials: message.initials || "?",
      lastSeen: performance.now()
    });
    requestCursorDraw();
  }

  function handleCursorGone(message) {
    if (!message.sender_session_id) return;

    remoteCursors.delete(message.sender_session_id);
    liveElements.forEach((live, tempId) => {
      if (live.senderSessionId === message.sender_session_id) {
        liveElements.delete(tempId);
      }
    });
    updateEmptyState();
    requestBoardDraw();
    requestCursorDraw();
  }

  function handleLiveElement(message) {
    if (!message.element || !message.temp_id) return;
    if (message.sender_session_id === selfSessionId) return;

    liveElements.set(message.temp_id, {
      element: message.element,
      senderSessionId: message.sender_session_id,
      lastSeen: performance.now()
    });
    updateEmptyState();
    requestBoardDraw();
  }

  function handleLiveCancel(message) {
    if (!message.temp_id) return;
    liveElements.delete(message.temp_id);
    updateEmptyState();
    requestBoardDraw();
  }

  function handleBoardRenamed(message) {
    if (!message.name) return;
    setBoardName(message.name);

    if (message.sender_session_id && message.sender_session_id !== selfSessionId) {
      notify(`Board renamed to \u201C${message.name}\u201D.`);
    }
  }

  function handleBoardDeleted() {
    if (state.boardDeleted) return;
    state.boardDeleted = true;
    notify("This board was deleted by someone in the room.", "danger");
    redirectToBoards(1800);
  }

  function redirectToBoards(delay = 0) {
    const redirect = () => {
      window.location.href = "/";
    };
    if (delay > 0) {
      window.setTimeout(redirect, delay);
    } else {
      redirect();
    }
  }

  function setBoardName(name) {
    boardName = name;
    if (dom.boardTitle) dom.boardTitle.textContent = name;
    const renameInput = dom.renameModal?.querySelector("[data-rename-input]");
    if (renameInput && document.activeElement !== renameInput) renameInput.value = name;
    document.title = `${name} \u00B7 Tandem`;
  }

  /* Presence */

  function renderPresence(participants) {
    const ordered = [...participants].sort((a, b) => {
      if (a.id === selfSessionId) return -1;
      if (b.id === selfSessionId) return 1;
      return Number(a.joined_at) - Number(b.joined_at);
    });

    if (!dom.presenceAvatars) return;
    dom.presenceAvatars.replaceChildren();

    const visible = ordered.slice(0, 4);
    visible.forEach((participant) => {
      const avatar = document.createElement("span");
      avatar.className = "avatar avatar--sm";
      avatar.style.setProperty("--avatar-color", participant.color || "#6554E8");
      avatar.textContent = participant.initials || initialsFor(participant.nickname);
      avatar.title = participant.id === selfSessionId ? `${participant.nickname} (you)` : participant.nickname;
      avatar.setAttribute("role", "img");
      avatar.setAttribute("aria-label", participant.id === selfSessionId ? `${participant.nickname} (you)` : participant.nickname);
      dom.presenceAvatars.appendChild(avatar);
    });

    if (ordered.length > visible.length) {
      const extra = document.createElement("span");
      extra.className = "presence-extra";
      extra.textContent = `+${ordered.length - visible.length}`;
      extra.title = ordered.slice(4).map((participant) => participant.nickname).join(", ");
      dom.presenceAvatars.appendChild(extra);
    }

    if (ordered.length === 0) {
      const avatar = document.createElement("span");
      avatar.className = "avatar avatar--sm";
      avatar.style.setProperty("--avatar-color", user.color || "#6554E8");
      avatar.textContent = user.initials || initialsFor(user.nickname);
      avatar.title = `${user.nickname} (you)`;
      dom.presenceAvatars.appendChild(avatar);
    }
  }

  function initialsFor(name) {
    const parts = `${name || ""}`.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "?";
    if (parts.length === 1) return Array.from(parts[0]).slice(0, 2).join("").toUpperCase();
    return `${Array.from(parts[0])[0] || ""}${Array.from(parts[parts.length - 1])[0] || ""}`.toUpperCase();
  }

  function sendCursor(worldPoint) {
    if (!channelConnected || !subscription || !worldPoint) return;

    const now = performance.now();
    if (now - lastCursorSentAt < 65) return;

    lastCursorSentAt = now;
    lastCursorWorld = worldPoint;
    subscription.perform("cursor", {
      x: Math.round(worldPoint.x * 10) / 10,
      y: Math.round(worldPoint.y * 10) / 10
    });
  }

  function sendCursorLeave() {
    lastCursorWorld = null;
    if (!channelConnected || !subscription) return;
    subscription.perform("cursor_leave", {});
  }

  function pruneEphemeralState() {
    const now = performance.now();
    let boardChanged = false;
    let cursorChanged = false;

    remoteCursors.forEach((cursor, sessionId) => {
      if (now - cursor.lastSeen > CURSOR_LIFETIME) {
        remoteCursors.delete(sessionId);
        cursorChanged = true;
      }
    });

    liveElements.forEach((live, tempId) => {
      if (now - live.lastSeen > LIVE_LIFETIME) {
        liveElements.delete(tempId);
        boardChanged = true;
      }
    });

    if (cursorChanged) requestCursorDraw();
    if (boardChanged) {
      updateEmptyState();
      requestBoardDraw();
    }
  }

  /* Canvas sizing, camera & rendering */

  function setupResizeObserver() {
    if (window.ResizeObserver) {
      const observer = new ResizeObserver(() => resizeCanvases());
      observer.observe(stage);
    }
  }

  function resizeCanvases() {
    const rect = stage.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    state.viewport = {
      width: Math.floor(rect.width),
      height: Math.floor(rect.height),
      dpr
    };

    [canvas, cursorCanvas].forEach((target) => {
      target.width = Math.round(state.viewport.width * dpr);
      target.height = Math.round(state.viewport.height * dpr);
      target.style.width = `${state.viewport.width}px`;
      target.style.height = `${state.viewport.height}px`;
    });

    boardContext = canvas.getContext("2d");
    cursorContext = cursorCanvas.getContext("2d");

    if (!state.initializedView) {
      state.initializedView = true;
      if (elements.length > 0) {
        fitToContent({ maxZoom: 1.15 });
      } else {
        resetCamera();
      }
    }

    updateZoomUI();
    requestBoardDraw();
    requestCursorDraw();
  }

  function requestBoardDraw() {
    if (drawScheduled) return;
    drawScheduled = true;
    window.requestAnimationFrame(() => {
      drawScheduled = false;
      drawBoard();
    });
  }

  function drawBoard() {
    if (!boardContext) return;

    const { width, height, dpr } = state.viewport;
    const ctx = boardContext;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = board.background;
    ctx.fillRect(0, 0, width, height);

    drawDotGrid(ctx);

    const zoom = state.camera.zoom;
    const offsetX = width / 2 - state.camera.x * zoom;
    const offsetY = height / 2 - state.camera.y * zoom;
    ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * offsetX, dpr * offsetY);

    elements.forEach((element) => {
      drawElement(ctx, element);
    });

    liveElements.forEach((live) => {
      drawElement(ctx, live.element);
    });

    if (state.draft) {
      drawElement(ctx, state.draft.element, { cache: false });
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  function drawDotGrid(ctx) {
    const { width, height } = state.viewport;
    const zoom = state.camera.zoom;
    let stepWorld = 32;
    let spacing = stepWorld * zoom;
    while (spacing < 22) {
      stepWorld *= 2;
      spacing = stepWorld * zoom;
    }

    const originX = modulo(width / 2 - state.camera.x * zoom, spacing);
    const originY = modulo(height / 2 - state.camera.y * zoom, spacing);
    const radius = Math.max(0.72, Math.min(1.6, 0.72 + zoom * 0.55));

    ctx.save();
    ctx.fillStyle = board.dots;
    ctx.globalAlpha = 0.72;
    ctx.beginPath();
    for (let x = originX; x < width + spacing; x += spacing) {
      for (let y = originY; y < height + spacing; y += spacing) {
        ctx.moveTo(x + radius, y);
        ctx.arc(x, y, radius, 0, Math.PI * 2);
      }
    }
    ctx.fill();
    ctx.restore();
  }

  function drawElement(ctx, element, options = {}) {
    if (!element || !element.kind) return;

    switch (element.kind) {
      case "pen":
      case "highlighter":
      case "eraser":
        drawFreehand(ctx, element, options);
        break;
      case "rectangle":
        drawRectangle(ctx, element);
        break;
      case "ellipse":
        drawEllipse(ctx, element);
        break;
      case "line":
      case "arrow":
        drawLine(ctx, element);
        break;
      case "note":
        drawNote(ctx, element);
        break;
      case "text":
        drawText(ctx, element);
        break;
      default:
        break;
    }
  }

  function drawFreehand(ctx, element, options = {}) {
    const points = element.payload?.points;
    if (!Array.isArray(points) || points.length === 0) return;

    const key = element.client_uid
      ? `${element.client_uid}:${element.kind}:${element.width}:${element.color}`
      : null;
    let path = key ? pathCache.get(key) : null;

    if (!path) {
      path = buildFreehandPath(element);
      if (!path) return;
      if (key) pathCache.set(key, path);
    }

    ctx.save();
    if (element.kind === "highlighter") {
      ctx.globalAlpha = 0.34;
      ctx.fillStyle = element.color;
    } else if (element.kind === "eraser") {
      ctx.fillStyle = board.background;
    } else {
      ctx.fillStyle = element.color;
    }
    ctx.fill(path);
    ctx.restore();
  }

  function buildFreehandPath(element) {
    const points = element.payload?.points;
    if (!Array.isArray(points) || points.length === 0) return null;

    const safePoints = points
      .filter((point) => Array.isArray(point) && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1])))
      .map((point) => [Number(point[0]), Number(point[1])]);

    if (safePoints.length === 0) return null;

    let size = Number(element.width) || 4;
    let thinning = 0.56;
    if (element.kind === "highlighter") {
      size *= 4;
      thinning = 0.08;
    } else if (element.kind === "eraser") {
      size *= 3.5;
      thinning = 0.24;
    }

    const outline = getStroke(safePoints, {
      size,
      thinning,
      smoothing: 0.55,
      streamline: 0.46,
      simulatePressure: true,
      last: true,
      start: { taper: 0, cap: true },
      end: { taper: 0, cap: true }
    });

    if (!outline.length) return null;

    const path = new Path2D();
    const first = outline[0];
    path.moveTo(first[0], first[1]);
    for (let index = 1; index < outline.length; index += 1) {
      path.lineTo(outline[index][0], outline[index][1]);
    }
    path.closePath();
    return path;
  }

  function drawRectangle(ctx, element) {
    const data = normalizedBox(element.payload);
    if (!data) return;

    const radius = Math.min(18, Math.max(0, Math.min(data.w, data.h) * 0.08));
    ctx.save();
    ctx.strokeStyle = element.color;
    ctx.lineWidth = Number(element.width) || 4;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    roundedRectPath(ctx, data.x, data.y, data.w, data.h, radius);
    ctx.stroke();
    ctx.restore();
  }

  function drawEllipse(ctx, element) {
    const data = normalizedBox(element.payload);
    if (!data) return;

    ctx.save();
    ctx.strokeStyle = element.color;
    ctx.lineWidth = Number(element.width) || 4;
    ctx.beginPath();
    ctx.ellipse(data.x + data.w / 2, data.y + data.h / 2, Math.max(0.5, data.w / 2), Math.max(0.5, data.h / 2), 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawLine(ctx, element) {
    const data = element.payload || {};
    const x1 = Number(data.x1) || 0;
    const y1 = Number(data.y1) || 0;
    const x2 = Number(data.x2) || 0;
    const y2 = Number(data.y2) || 0;
    const width = Number(element.width) || 4;

    ctx.save();
    ctx.strokeStyle = element.color;
    ctx.fillStyle = element.color;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    if (element.kind === "arrow") {
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const headLength = Math.max(16, width * 4.2);
      const spread = Math.PI / 7;
      const p1x = x2 - headLength * Math.cos(angle - spread);
      const p1y = y2 - headLength * Math.sin(angle - spread);
      const p2x = x2 - headLength * Math.cos(angle + spread);
      const p2y = y2 - headLength * Math.sin(angle + spread);
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(p1x, p1y);
      ctx.lineTo(p2x, p2y);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  function drawNote(ctx, element) {
    const data = element.payload || {};
    const x = Number(data.x) || 0;
    const y = Number(data.y) || 0;
    const width = Math.max(80, Number(data.w) || 232);
    const height = Math.max(60, Number(data.h) || 180);
    const text = `${data.text || ""}`;
    const author = element.nickname || "Guest";
    const authorColor = element.author_color || "#6554E8";

    ctx.save();
    ctx.shadowColor = "rgba(48, 34, 20, 0.16)";
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 8;
    ctx.fillStyle = element.color;
    roundedRectPath(ctx, x, y, width, height, 9);
    ctx.fill();
    ctx.restore();

    ctx.save();
    roundedRectPath(ctx, x, y, width, height, 9);
    ctx.clip();

    ctx.fillStyle = "rgba(43, 33, 24, 0.14)";
    roundedRectPath(ctx, x + 16, y + 15, 28, 4, 2);
    ctx.fill();

    ctx.fillStyle = "rgba(43, 33, 24, 0.52)";
    ctx.font = '700 10px "Plus Jakarta Sans", "Segoe UI", sans-serif';
    ctx.textBaseline = "middle";
    const authorLabel = truncateText(author.toUpperCase(), 16);
    ctx.fillText(authorLabel, x + 16, y + 31);

    ctx.fillStyle = authorColor;
    ctx.beginPath();
    ctx.arc(x + width - 20, y + 28, 3.5, 0, Math.PI * 2);
    ctx.fill();

    const fontSize = 18;
    const lineHeight = 24;
    const contentX = x + 16;
    const contentY = y + 52;
    const maxWidth = width - 34;
    const maxLines = Math.max(1, Math.floor((height - 66) / lineHeight));

    ctx.fillStyle = "#2b2118";
    ctx.font = `500 ${fontSize}px "Plus Jakarta Sans", "Segoe UI", sans-serif`;
    ctx.textBaseline = "top";
    const lines = wrapText(ctx, text, maxWidth, maxLines).lines;
    lines.forEach((line, index) => {
      ctx.fillText(line, contentX, contentY + index * lineHeight);
    });

    ctx.restore();
  }

  function drawText(ctx, element) {
    const data = element.payload || {};
    const x = Number(data.x) || 0;
    const y = Number(data.y) || 0;
    const fontSize = Math.max(12, Number(data.font_size) || 32);
    const maxWidth = Math.max(60, Number(data.max_width) || 560);
    const lineHeight = fontSize * 1.32;

    ctx.save();
    ctx.fillStyle = element.color;
    ctx.font = `600 ${fontSize}px "Plus Jakarta Sans", "Segoe UI", sans-serif`;
    ctx.textBaseline = "top";
    const lines = wrapText(ctx, `${data.text || ""}`, maxWidth, 80).lines;
    lines.forEach((line, index) => {
      ctx.fillText(line, x, y + index * lineHeight);
    });
    ctx.restore();
  }

  function wrapText(ctx, text, maxWidth, maxLines) {
    const font = ctx.font;
    const cacheKey = `${font}|${maxWidth}|${maxLines}|${text}`;
    if (textLayoutCache.has(cacheKey)) return textLayoutCache.get(cacheKey);

    const paragraphs = `${text || ""}`.split(/\r?\n/);
    const lines = [];

    for (const paragraph of paragraphs) {
      if (paragraph.length === 0) {
        lines.push("");
        continue;
      }

      const words = paragraph.split(/\s+/);
      let current = "";

      for (const word of words) {
        const candidate = current ? `${current} ${word}` : word;
        if (ctx.measureText(candidate).width <= maxWidth || current === "") {
          if (ctx.measureText(candidate).width > maxWidth && current === "") {
            const broken = breakLongWord(ctx, word, maxWidth);
            broken.forEach((piece, index) => {
              if (index < broken.length - 1) lines.push(piece);
              else current = piece;
            });
          } else {
            current = candidate;
          }
        } else {
          lines.push(current);
          current = word;
        }
      }
      if (current) lines.push(current);
    }

    let truncated = false;
    if (lines.length > maxLines) {
      lines.length = maxLines;
      truncated = true;
    }
    if (truncated) {
      const last = lines.length - 1;
      lines[last] = `${lines[last].slice(0, Math.max(0, lines[last].length - 1))}\u2026`;
    }

    const result = { lines: lines.length ? lines : [""], truncated };
    if (textLayoutCache.size > 700) textLayoutCache.clear();
    textLayoutCache.set(cacheKey, result);
    return result;
  }

  function breakLongWord(ctx, word, maxWidth) {
    const chunks = [];
    let current = "";
    for (const character of Array.from(word)) {
      const candidate = `${current}${character}`;
      if (ctx.measureText(candidate).width > maxWidth && current) {
        chunks.push(current);
        current = character;
      } else {
        current = candidate;
      }
    }
    if (current) chunks.push(current);
    return chunks.length ? chunks : [word];
  }

  function normalizedBox(payload) {
    if (!payload) return null;
    const x = Number(payload.x) || 0;
    const y = Number(payload.y) || 0;
    const w = Math.abs(Number(payload.w) || 0);
    const h = Math.abs(Number(payload.h) || 0);
    if (w < 0.5 || h < 0.5) return null;
    return { x, y, w, h };
  }

  function roundedRectPath(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function truncateText(text, maxLength) {
    return text.length > maxLength ? `${text.slice(0, maxLength - 1)}\u2026` : text;
  }

  function modulo(value, divisor) {
    return ((value % divisor) + divisor) % divisor;
  }

  /* Cursor overlay */

  function requestCursorDraw() {
    if (cursorDrawScheduled) return;
    cursorDrawScheduled = true;
    window.requestAnimationFrame(() => {
      cursorDrawScheduled = false;
      drawCursorOverlay();
    });
  }

  function drawCursorOverlay() {
    if (!cursorContext) return;

    const { width, height, dpr } = state.viewport;
    const ctx = cursorContext;
    const zoom = state.camera.zoom;
    const now = performance.now();

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cursorCanvas.width, cursorCanvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    remoteCursors.forEach((cursor) => {
      const age = now - cursor.lastSeen;
      if (age > CURSOR_LIFETIME) return;

      const x = width / 2 + (cursor.x - state.camera.x) * zoom;
      const y = height / 2 + (cursor.y - state.camera.y) * zoom;
      if (x < -40 || y < -40 || x > width + 160 || y > height + 40) return;

      const alpha = age > CURSOR_LIFETIME - 700
        ? Math.max(0, (CURSOR_LIFETIME - age) / 700)
        : 1;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(x, y);
      ctx.fillStyle = cursor.color;
      ctx.strokeStyle = "rgba(255, 255, 255, 0.92)";
      ctx.lineWidth = 1.4;
      ctx.shadowColor = "rgba(20, 15, 12, 0.18)";
      ctx.shadowBlur = 6;
      ctx.shadowOffsetY = 2;

      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, 17);
      ctx.lineTo(4.4, 13.1);
      ctx.lineTo(7.8, 20.3);
      ctx.lineTo(11.1, 18.8);
      ctx.lineTo(7.6, 11.8);
      ctx.lineTo(13, 11.2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.shadowColor = "transparent";
      ctx.font = '600 10.5px "Plus Jakarta Sans", "Segoe UI", sans-serif';
      const name = truncateText(cursor.nickname || "Guest", 18);
      const labelWidth = Math.ceil(ctx.measureText(name).width) + 14;
      const labelX = 12;
      const labelY = 19;
      ctx.fillStyle = cursor.color;
      roundedRectPath(ctx, labelX, labelY, labelWidth, 20, 6);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.textBaseline = "middle";
      ctx.fillText(name, labelX + 7, labelY + 10.5);
      ctx.restore();
    });

    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  /* Geometry, camera & zoom */

  function screenToWorld(screenX, screenY) {
    return {
      x: (screenX - state.viewport.width / 2) / state.camera.zoom + state.camera.x,
      y: (screenY - state.viewport.height / 2) / state.camera.zoom + state.camera.y
    };
  }

  function eventPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      screenX: event.clientX - rect.left,
      screenY: event.clientY - rect.top
    };
  }

  function eventWorldPoint(event) {
    const point = eventPoint(event);
    return screenToWorld(point.screenX, point.screenY);
  }

  function setZoomAt(newZoom, screenX, screenY) {
    const clamped = clamp(newZoom, MIN_ZOOM, MAX_ZOOM);
    const world = screenToWorld(screenX, screenY);
    state.camera.zoom = clamped;
    state.camera.x = world.x - (screenX - state.viewport.width / 2) / clamped;
    state.camera.y = world.y - (screenY - state.viewport.height / 2) / clamped;
    updateZoomUI();
    requestBoardDraw();
    requestCursorDraw();
  }

  function zoomBy(factor) {
    setZoomAt(
      state.camera.zoom * factor,
      state.viewport.width / 2,
      state.viewport.height / 2
    );
  }

  function resetZoom() {
    const center = screenToWorld(state.viewport.width / 2, state.viewport.height / 2);
    state.camera.zoom = 1;
    state.camera.x = center.x;
    state.camera.y = center.y;
    updateZoomUI();
    requestBoardDraw();
    requestCursorDraw();
  }

  function resetCamera() {
    state.camera = { x: 0, y: 0, zoom: 1 };
    updateZoomUI();
    requestBoardDraw();
    requestCursorDraw();
  }

  function updateZoomUI() {
    if (!dom.zoomLabel) return;
    dom.zoomLabel.textContent = `${Math.round(state.camera.zoom * 100)}%`;
  }

  function fitToContent(options = {}) {
    const bounds = contentBounds();
    if (!bounds) {
      resetCamera();
      return;
    }

    const maxZoom = options.maxZoom || 1.4;
    const mobile = window.matchMedia("(max-width: 767.98px)").matches;
    const padding = mobile
      ? { left: 24, right: 24, top: 70, bottom: 155 }
      : { left: 105, right: 75, top: 75, bottom: 105 };

    const availableWidth = Math.max(120, state.viewport.width - padding.left - padding.right);
    const availableHeight = Math.max(100, state.viewport.height - padding.top - padding.bottom);
    const contentWidth = Math.max(24, bounds.maxX - bounds.minX);
    const contentHeight = Math.max(24, bounds.maxY - bounds.minY);
    const zoom = clamp(Math.min(availableWidth / contentWidth, availableHeight / contentHeight), MIN_ZOOM, maxZoom);

    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;
    const horizontalOffset = (padding.left - padding.right) / 2;
    const verticalOffset = (padding.top - padding.bottom) / 2;

    state.camera.zoom = zoom;
    state.camera.x = centerX - horizontalOffset / zoom;
    state.camera.y = centerY - verticalOffset / zoom;

    updateZoomUI();
    requestBoardDraw();
    requestCursorDraw();
  }

  function contentBounds() {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let found = false;

    elements.forEach((element) => {
      const bounds = elementBounds(element);
      if (!bounds) return;
      found = true;
      minX = Math.min(minX, bounds.minX);
      minY = Math.min(minY, bounds.minY);
      maxX = Math.max(maxX, bounds.maxX);
      maxY = Math.max(maxY, bounds.maxY);
    });

    if (!found) return null;
    return { minX, minY, maxX, maxY };
  }

  function elementBounds(element) {
    const payload = element.payload || {};
    const width = Number(element.width) || 4;

    if (FREEHAND_KINDS.has(element.kind)) {
      const points = payload.points;
      if (!Array.isArray(points) || points.length === 0) return null;
      const xs = [];
      const ys = [];
      points.forEach((point) => {
        if (Array.isArray(point) && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1]))) {
          xs.push(Number(point[0]));
          ys.push(Number(point[1]));
        }
      });
      if (!xs.length) return null;
      const pad = strokeSizeFor(element) / 2 + 8;
      return {
        minX: Math.min(...xs) - pad,
        minY: Math.min(...ys) - pad,
        maxX: Math.max(...xs) + pad,
        maxY: Math.max(...ys) + pad
      };
    }

    if (element.kind === "rectangle" || element.kind === "ellipse") {
      const box = normalizedBox(payload);
      if (!box) return null;
      const pad = width + 12;
      return { minX: box.x - pad, minY: box.y - pad, maxX: box.x + box.w + pad, maxY: box.y + box.h + pad };
    }

    if (element.kind === "line" || element.kind === "arrow") {
      const x1 = Number(payload.x1) || 0;
      const y1 = Number(payload.y1) || 0;
      const x2 = Number(payload.x2) || 0;
      const y2 = Number(payload.y2) || 0;
      const pad = width * 2 + 22;
      return {
        minX: Math.min(x1, x2) - pad,
        minY: Math.min(y1, y2) - pad,
        maxX: Math.max(x1, x2) + pad,
        maxY: Math.max(y1, y2) + pad
      };
    }

    if (element.kind === "note") {
      const x = Number(payload.x) || 0;
      const y = Number(payload.y) || 0;
      const w = Number(payload.w) || 232;
      const h = Number(payload.h) || 180;
      return { minX: x - 18, minY: y - 18, maxX: x + w + 18, maxY: y + h + 24 };
    }

    if (element.kind === "text") {
      const x = Number(payload.x) || 0;
      const y = Number(payload.y) || 0;
      const maxWidth = Number(payload.max_width) || 560;
      const fontSize = Number(payload.font_size) || 32;
      const lineCount = Math.max(1, `${payload.text || ""}`.split("\n").length);
      return {
        minX: x - 16,
        minY: y - 16,
        maxX: x + maxWidth + 20,
        maxY: y + lineCount * fontSize * 1.35 + 20
      };
    }

    return null;
  }

  function strokeSizeFor(element) {
    const width = Number(element.width) || 4;
    if (element.kind === "highlighter") return width * 4;
    if (element.kind === "eraser") return width * 3.5;
    return width;
  }

  function eraserTargetBounds(element) {
    const data = element.payload || {};

    if (element.kind === "note") {
      const x = Number(data.x) || 0;
      const y = Number(data.y) || 0;
      const width = Math.max(80, Number(data.w) || 232);
      const height = Math.max(60, Number(data.h) || 180);
      return { minX: x, minY: y, maxX: x + width, maxY: y + height };
    }

    if (element.kind === "text") {
      if (!eraserMeasureContext) {
        eraserMeasureContext = document.createElement("canvas").getContext("2d");
      }
      if (!eraserMeasureContext) return elementBounds(element);

      const x = Number(data.x) || 0;
      const y = Number(data.y) || 0;
      const fontSize = Math.max(12, Number(data.font_size) || 32);
      const maxWidth = Math.max(60, Number(data.max_width) || 560);
      const lineHeight = fontSize * 1.32;
      eraserMeasureContext.font = `600 ${fontSize}px "Plus Jakarta Sans", "Segoe UI", sans-serif`;
      const lines = wrapText(eraserMeasureContext, `${data.text || ""}`, maxWidth, 80).lines;
      const actualWidth = lines.reduce(
        (widest, line) => Math.max(widest, eraserMeasureContext.measureText(line).width),
        0
      );

      return {
        minX: x,
        minY: y,
        maxX: x + Math.max(actualWidth, fontSize * 0.6),
        maxY: y + Math.max(lines.length * lineHeight, fontSize)
      };
    }

    return null;
  }

  function segmentIntersectsBox(x1, y1, x2, y2, minX, minY, maxX, maxY) {
    let t0 = 0;
    let t1 = 1;
    const dx = x2 - x1;
    const dy = y2 - y1;

    const clip = (p, q) => {
      if (p === 0) return q >= 0;
      const ratio = q / p;
      if (p < 0) {
        if (ratio > t1) return false;
        if (ratio > t0) t0 = ratio;
      } else {
        if (ratio < t0) return false;
        if (ratio < t1) t1 = ratio;
      }
      return true;
    };

    return (
      clip(-dx, x1 - minX) &&
      clip(dx, maxX - x1) &&
      clip(-dy, y1 - minY) &&
      clip(dy, maxY - y1)
    );
  }

  function eraseObjectsAlong(from, to) {
    if (state.tool !== "eraser") return;

    const radius = Math.max(3, (Number(state.width) || 4) * 1.75);
    const targets = elements.filter((element) => {
      if (element.kind !== "note" && element.kind !== "text") return false;
      if (!element.client_uid || locallyDeletedUids.has(element.client_uid)) return false;

      const bounds = eraserTargetBounds(element);
      if (!bounds) return false;

      return segmentIntersectsBox(
        from.x,
        from.y,
        to.x,
        to.y,
        bounds.minX - radius,
        bounds.minY - radius,
        bounds.maxX + radius,
        bounds.maxY + radius
      );
    });

    if (targets.length === 0) return;

    const draft = state.draft;
    if (draft?.kind === "eraser") {
      targets.forEach((element) => {
        draft.erasedElements.push({
          kind: element.kind,
          color: element.color,
          width: element.width,
          payload: clonePayload(element.payload)
        });
      });
    }

    const targetUids = new Set(targets.map((element) => element.client_uid));
    elements = elements.filter((element) => !targetUids.has(element.client_uid));
    undoStack = undoStack.filter((entry) => !targetUids.has(entry.client_uid));
    redoStack = redoStack.filter((entry) => !targetUids.has(entry.client_uid));

    targetUids.forEach((clientUid) => {
      locallyDeletedUids.add(clientUid);
      sendAction("erase", { client_uid: clientUid });
    });

    updateHistoryButtons();
    updateEmptyState();
    requestBoardDraw();
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  /* Pointer & drawing interactions */

  function bindCanvas() {
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerCancel);
    canvas.addEventListener("pointerleave", onPointerLeave);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  }

  function onPointerDown(event) {
    if (state.boardDeleted) return;
    if (event.pointerType === "touch") {
      state.touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });

      if (state.touchPoints.size === 2) {
        beginPinch();
        event.preventDefault();
        return;
      }
      if (state.touchPoints.size > 2 || state.suppressTouchDraw) return;
    }

    if (state.pinch) return;

    const wantsPan = event.button === 1 || (event.button === 0 && (state.tool === "hand" || state.spacePressed));
    if (event.button !== 0 && event.button !== 1) return;
    if (event.button === 2) return;

    if (!wantsPan && event.pointerType === "touch" && state.suppressTouchDraw) return;

    event.preventDefault();
    canvas.focus({ preventScroll: true });

    if (wantsPan) {
      beginPan(event);
      return;
    }

    if (event.button !== 0) return;
    const world = eventWorldPoint(event);
    sendCursor(world);

    if (state.tool === "note") {
      openNoteModal(world);
      return;
    }

    if (state.tool === "text") {
      openTextModal(world);
      return;
    }

    beginDraft(event, world);
  }

  function onPointerMove(event) {
    if (event.pointerType === "touch" && state.touchPoints.has(event.pointerId)) {
      state.touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }

    if (state.pinch) {
      updatePinch(event);
      return;
    }

    const world = eventWorldPoint(event);

    if (state.pan && state.pan.pointerId === event.pointerId) {
      const dx = event.clientX - state.pan.startClientX;
      const dy = event.clientY - state.pan.startClientY;
      state.camera.x = state.pan.startCameraX - dx / state.camera.zoom;
      state.camera.y = state.pan.startCameraY - dy / state.camera.zoom;
      state.pan.moved = true;
      requestBoardDraw();
      requestCursorDraw();
      sendCursor(world);
      return;
    }

    if (state.draft && state.draft.pointerId === event.pointerId) {
      updateDraft(event, world);
      return;
    }

    sendCursor(world);
  }

  function onPointerUp(event) {
    if (event.pointerType === "touch") {
      state.touchPoints.delete(event.pointerId);
      if (state.pinch) {
        if (state.touchPoints.size < 2) {
          state.pinch = null;
          state.suppressTouchDraw = true;
        }
        if (state.touchPoints.size === 0) {
          state.suppressTouchDraw = false;
        }
        return;
      }
      if (state.suppressTouchDraw && state.touchPoints.size === 0) {
        state.suppressTouchDraw = false;
      }
    }

    if (state.pan && state.pan.pointerId === event.pointerId) {
      endPan(event);
      return;
    }

    if (state.draft && state.draft.pointerId === event.pointerId) {
      finishDraft(event);
    }
  }

  function onPointerCancel(event) {
    if (event.pointerType === "touch") {
      state.touchPoints.delete(event.pointerId);
      if (state.touchPoints.size === 0) {
        state.suppressTouchDraw = false;
      }
    }

    if (state.pinch) {
      state.pinch = null;
      state.suppressTouchDraw = state.touchPoints.size > 0;
    }

    if (state.pan && state.pan.pointerId === event.pointerId) {
      state.pan = null;
      updateCursorStyle();
    }

    if (state.draft && state.draft.pointerId === event.pointerId) {
      cancelDraft();
    }
  }

  function onPointerLeave() {
    if (!state.pan && !state.draft) {
      sendCursorLeave();
    }
  }

  function beginPan(event) {
    if (state.draft) cancelDraft();
    state.pan = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startCameraX: state.camera.x,
      startCameraY: state.camera.y,
      moved: false
    };
    canvas.setPointerCapture?.(event.pointerId);
    canvas.classList.add("is-panning");
    updateCursorStyle();
  }

  function endPan(event) {
    state.pan = null;
    try {
      canvas.releasePointerCapture?.(event.pointerId);
    } catch (error) {
      
    }
    canvas.classList.remove("is-panning");
    updateCursorStyle();
  }

  function beginPinch() {
    if (state.draft) cancelDraft();
    if (state.pan) {
      state.pan = null;
      canvas.classList.remove("is-panning");
    }

    const points = Array.from(state.touchPoints.values()).slice(0, 2);
    if (points.length < 2) return;

    const rect = canvas.getBoundingClientRect();
    const first = { x: points[0].x - rect.left, y: points[0].y - rect.top };
    const second = { x: points[1].x - rect.left, y: points[1].y - rect.top };
    const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
    const distance = Math.hypot(second.x - first.x, second.y - first.y);

    state.pinch = {
      startDistance: Math.max(distance, 1),
      startZoom: state.camera.zoom,
      anchorWorld: screenToWorld(midpoint.x, midpoint.y)
    };
    state.suppressTouchDraw = true;
    updateCursorStyle();
  }

  function updatePinch() {
    if (!state.pinch || state.touchPoints.size < 2) return;

    const points = Array.from(state.touchPoints.values()).slice(0, 2);
    const rect = canvas.getBoundingClientRect();
    const first = { x: points[0].x - rect.left, y: points[0].y - rect.top };
    const second = { x: points[1].x - rect.left, y: points[1].y - rect.top };
    const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
    const distance = Math.hypot(second.x - first.x, second.y - first.y);
    const factor = distance / state.pinch.startDistance;
    const zoom = clamp(state.pinch.startZoom * factor, MIN_ZOOM, MAX_ZOOM);

    state.camera.zoom = zoom;
    state.camera.x = state.pinch.anchorWorld.x - (midpoint.x - state.viewport.width / 2) / zoom;
    state.camera.y = state.pinch.anchorWorld.y - (midpoint.y - state.viewport.height / 2) / zoom;

    updateZoomUI();
    requestBoardDraw();
    requestCursorDraw();
  }

  function onWheel(event) {
    if (state.boardDeleted) return;
    event.preventDefault();

    if (event.ctrlKey || event.metaKey) {
      const point = eventPoint(event);
      const lineHeight = 26;
      const deltaY =
        event.deltaMode === 1
          ? event.deltaY * lineHeight
          : event.deltaMode === 2
            ? event.deltaY * state.viewport.height
            : event.deltaY;
      const factor = Math.exp(-deltaY * 0.0012);
      setZoomAt(state.camera.zoom * factor, point.screenX, point.screenY);
      return;
    }

    const multiplier = event.deltaMode === 1 ? 18 : 1;
    state.camera.x += (event.deltaX * multiplier) / state.camera.zoom;
    state.camera.y += (event.deltaY * multiplier) / state.camera.zoom;
    requestBoardDraw();
    requestCursorDraw();
  }

  function beginDraft(event, world) {
    closePanels();
    const tempId = newTempId();
    let element;

    if (FREEHAND_KINDS.has(state.tool)) {
      element = {
        kind: state.tool,
        color: state.color,
        width: state.width,
        payload: { points: [[roundCoordinate(world.x), roundCoordinate(world.y)]] }
      };
    } else if (SHAPE_KINDS.has(state.tool)) {
      element =
        state.tool === "line" || state.tool === "arrow"
          ? {
              kind: state.tool,
              color: state.color,
              width: state.width,
              payload: {
                x1: roundCoordinate(world.x),
                y1: roundCoordinate(world.y),
                x2: roundCoordinate(world.x),
                y2: roundCoordinate(world.y)
              }
            }
          : {
              kind: state.tool,
              color: state.color,
              width: state.width,
              payload: {
                x: roundCoordinate(world.x),
                y: roundCoordinate(world.y),
                w: 1,
                h: 1
              }
            };
    } else {
      return;
    }

    state.draft = {
      pointerId: event.pointerId,
      kind: state.tool,
      tempId,
      startWorld: { x: world.x, y: world.y },
      lastPoint: { x: world.x, y: world.y },
      element,
      moved: false,
      erasedElements: []
    };
    state.lastLiveAt = 0;
    canvas.setPointerCapture?.(event.pointerId);

    if (state.draft.kind === "eraser") {
      eraseObjectsAlong(world, world);
    }

    sendLive(true);
    updateEmptyState();
    requestBoardDraw();
  }

  function updateDraft(event, world) {
    const draft = state.draft;
    if (!draft) return;

    if (FREEHAND_KINDS.has(draft.kind)) {
      const last = draft.lastPoint;
      const distance = Math.hypot(world.x - last.x, world.y - last.y) * state.camera.zoom;
      if (distance < 1.25) return;
      draft.element.payload.points.push([roundCoordinate(world.x), roundCoordinate(world.y)]);
      draft.lastPoint = world;
      if (draft.kind === "eraser") {
        eraseObjectsAlong(last, world);
      }
    } else if (draft.kind === "line" || draft.kind === "arrow") {
      let x2 = world.x;
      let y2 = world.y;

      if (event.shiftKey) {
        const dx = x2 - draft.startWorld.x;
        const dy = y2 - draft.startWorld.y;
        const angle = Math.atan2(dy, dx);
        const snapped = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
        const length = Math.hypot(dx, dy);
        x2 = draft.startWorld.x + Math.cos(snapped) * length;
        y2 = draft.startWorld.y + Math.sin(snapped) * length;
      }

      draft.element.payload.x2 = roundCoordinate(x2);
      draft.element.payload.y2 = roundCoordinate(y2);
    } else if (SHAPE_KINDS.has(draft.kind)) {
      let dx = world.x - draft.startWorld.x;
      let dy = world.y - draft.startWorld.y;

      if (event.shiftKey) {
        const size = Math.max(Math.abs(dx), Math.abs(dy));
        dx = Math.sign(dx || 1) * size;
        dy = Math.sign(dy || 1) * size;
      }

      draft.element.payload.x = roundCoordinate(Math.min(draft.startWorld.x, draft.startWorld.x + dx));
      draft.element.payload.y = roundCoordinate(Math.min(draft.startWorld.y, draft.startWorld.y + dy));
      draft.element.payload.w = roundCoordinate(Math.max(1, Math.abs(dx)));
      draft.element.payload.h = roundCoordinate(Math.max(1, Math.abs(dy)));
    }

    draft.moved = true;
    sendLive(false);
    requestBoardDraw();
  }

  function finishDraft(event) {
    const draft = state.draft;
    state.draft = null;
    clearLiveTimer();
    if (draft) {
      try {
        canvas.releasePointerCapture?.(event.pointerId);
      } catch (error) {
        
      }
    }
    if (!draft) {
      requestBoardDraw();
      return;
    }

    if (FREEHAND_KINDS.has(draft.kind)) {
      const points = draft.element.payload.points;
      if (points.length === 1) {
        points.push([points[0][0] + 0.08, points[0][1] + 0.08]);
      }
      if (points.length < 2) {
        discardDraft(draft);
        return;
      }
    } else if (draft.kind === "line" || draft.kind === "arrow") {
      const length = Math.hypot(
        (draft.element.payload.x2 - draft.element.payload.x1) * state.camera.zoom,
        (draft.element.payload.y2 - draft.element.payload.y1) * state.camera.zoom
      );
      if (length < 4) {
        discardDraft(draft);
        return;
      }
    } else if (SHAPE_KINDS.has(draft.kind)) {
      if (draft.element.payload.w * state.camera.zoom < 4 && draft.element.payload.h * state.camera.zoom < 4) {
        discardDraft(draft);
        return;
      }
    }

    const undoMeta =
      draft.kind === "eraser" && draft.erasedElements.length > 0
        ? { erasedElements: draft.erasedElements }
        : null;

    persistNewElement(draft.element, draft.tempId, undoMeta ? { undoMeta } : {});
    requestBoardDraw();
    updateEmptyState();
  }

  function discardDraft(draft) {
    sendAction("live_cancel", { temp_id: draft.tempId }, { queue: false });
    requestBoardDraw();
    updateEmptyState();
  }

  function cancelDraft() {
    if (!state.draft) return;
    const draft = state.draft;
    if (draft.kind === "eraser" && draft.erasedElements.length > 0) {
      finishDraft({ pointerId: draft.pointerId });
      return;
    }
    state.draft = null;
    clearLiveTimer();
    discardDraft(draft);
  }

  function persistNewElement(
    element,
    tempId = newTempId(),
    { clearRedo = true, recordUndo = true, undoMeta = null } = {}
  ) {
    const clientUid = newClientUid();
    const localElement = {
      ...element,
      client_uid: clientUid,
      id: null,
      nickname: user.nickname,
      author_color: user.color,
      pending: true
    };

    elements.push(localElement);
    if (recordUndo) {
      undoStack.push({
        client_uid: clientUid,
        element: {
          kind: element.kind,
          color: element.color,
          width: element.width,
          payload: clonePayload(element.payload)
        },
        ...(undoMeta || {})
      });
    }
    if (clearRedo) redoStack = [];

    pendingCommits.set(tempId, { clientUid });
    sendAction("commit", {
      client_uid: clientUid,
      temp_id: tempId,
      element: wireElement(element)
    });

    updateHistoryButtons();
    updateEmptyState();
    refreshStatus();
    requestBoardDraw();
    return clientUid;
  }

  function undoLast() {
    if (state.draft) return;
    if (undoStack.length === 0) return;

    const entry = undoStack.pop();
    const uid = entry.client_uid;
    const index = elements.findIndex((element) => element.client_uid === uid);

    if (index >= 0) {
      elements.splice(index, 1);
    }
    locallyDeletedUids.add(uid);

    if (Array.isArray(entry.erasedElements) && entry.erasedElements.length > 0) {
      entry.restoredUids = entry.erasedElements.map((element) =>
        persistNewElement(element, newTempId(), { clearRedo: false, recordUndo: false })
      );
    }

    pendingUndos.set(uid, { entry });
    sendAction("delete", { client_uid: uid });

    updateHistoryButtons();
    updateEmptyState();
    refreshStatus();
    requestBoardDraw();
  }

  function redoLast() {
    if (state.draft) return;
    if (redoStack.length === 0) return;

    const entry = redoStack.pop();
    eraseRestoredElements(entry);
    const tempId = newTempId();
    const undoMeta =
      Array.isArray(entry.erasedElements) && entry.erasedElements.length > 0
        ? { erasedElements: entry.erasedElements }
        : null;
    persistNewElement(entry.element, tempId, { clearRedo: false, undoMeta });
    updateHistoryButtons();
  }

  function eraseRestoredElements(entry) {
    if (!Array.isArray(entry.restoredUids) || entry.restoredUids.length === 0) return;

    const restoredUids = new Set(entry.restoredUids);
    elements = elements.filter((element) => !restoredUids.has(element.client_uid));
    restoredUids.forEach((clientUid) => {
      locallyDeletedUids.add(clientUid);
      sendAction("erase", { client_uid: clientUid });
    });
    entry.restoredUids = [];

    updateEmptyState();
    requestBoardDraw();
  }

  function updateHistoryButtons() {
    document.querySelectorAll("[data-undo]").forEach((button) => {
      button.disabled = undoStack.length === 0;
    });
    document.querySelectorAll("[data-redo]").forEach((button) => {
      button.disabled = redoStack.length === 0;
    });
  }

  function sendLive(force = false) {
    if (!state.draft || !channelConnected || !subscription) return;

    const now = performance.now();
    if (!force && now - state.lastLiveAt < 48) {
      if (!state.liveTimer) {
        state.liveTimer = window.setTimeout(() => {
          state.liveTimer = null;
          sendLive(true);
        }, 48);
      }
      return;
    }

    if (!state.draft) return;
    state.lastLiveAt = now;
    subscription.perform("live", {
      temp_id: state.draft.tempId,
      element: wireElement(state.draft.element)
    });
  }

  function clearLiveTimer() {
    if (state.liveTimer) {
      window.clearTimeout(state.liveTimer);
      state.liveTimer = null;
    }
  }

  function wireElement(element) {
    return {
      kind: element.kind,
      color: element.color,
      width: element.width,
      payload: element.payload
    };
  }

  function clonePayload(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function roundCoordinate(value) {
    return Math.round(value * 100) / 100;
  }

  function newTempId() {
    return `temp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function newClientUid() {
    return `mark-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function updateEmptyState() {
    if (!dom.canvasEmpty) return;
    dom.canvasEmpty.hidden = elements.length > 0 || Boolean(state.draft) || liveElements.size > 0;
  }

  /* Tool UI, panels & shortcuts */

  function bindTools() {
    document.querySelectorAll("[data-tool]").forEach((button) => {
      button.addEventListener("click", () => {
        if (button.closest("[data-shape-menu]")) closePanels();
        selectTool(button.dataset.tool);
      });
    });

    dom.shapeToggle?.addEventListener("click", () => {
      const shouldOpen = dom.shapeMenu?.hidden;
      closePanels();
      if (shouldOpen) {
        openPanel(dom.shapeMenu, dom.shapeToggle);
        if (dom.shapeToggle) dom.shapeToggle.setAttribute("aria-expanded", "true");
      }
    });

    dom.colorToggle?.addEventListener("click", () => {
      const shouldOpen = dom.colorPanel?.hidden;
      closePanels();
      if (shouldOpen) openPanel(dom.colorPanel, dom.colorToggle);
    });

    dom.widthToggle?.addEventListener("click", () => {
      const shouldOpen = dom.widthPanel?.hidden;
      closePanels();
      if (shouldOpen) openPanel(dom.widthPanel, dom.widthToggle);
    });

    document.querySelectorAll("[data-color]").forEach((button) => {
      button.addEventListener("click", () => {
        setColor(button.dataset.color);
        closePanels();
      });
    });

    document.querySelector("[data-color-custom]")?.addEventListener("input", (event) => {
      setColor(event.target.value);
    });

    document.querySelectorAll("[data-width]").forEach((button) => {
      button.addEventListener("click", () => {
        setWidth(Number(button.dataset.width));
        closePanels();
      });
    });

    document.addEventListener("pointerdown", (event) => {
      if (
        event.target.closest(".style-panel") ||
        event.target.closest(".shape-menu") ||
        event.target.closest("[data-color-toggle]") ||
        event.target.closest("[data-width-toggle]") ||
        event.target.closest("[data-shape-toggle]")
      ) {
        return;
      }
      closePanels();
    });
  }

  function selectTool(tool) {
    if (!tool) return;
    if (SHAPE_KINDS.has(tool)) {
      state.tool = tool;
      state.lastShape = tool;
    } else {
      state.tool = tool;
    }

    closePanels();
    updateToolUI();
    updateCursorStyle();
  }

  function openPanel(panel, trigger) {
    if (!panel) return;
    panel.hidden = false;
    if (trigger) {
      trigger.setAttribute("aria-expanded", "true");
      if (trigger === dom.colorToggle || trigger === dom.widthToggle) {
        trigger.classList.add("is-active");
      }
    }

    if (window.matchMedia("(min-width: 768px)").matches && stage) {
      const stageRect = stage.getBoundingClientRect();
      const triggerRect = trigger.getBoundingClientRect();
      const panelHeight = panel.offsetHeight;
      let top = triggerRect.top - stageRect.top + triggerRect.height / 2;
      top = clamp(top, panelHeight / 2 + 12, stageRect.height - panelHeight / 2 - 12);
      panel.style.top = `${top}px`;
    }
  }

  function closePanels() {
    [dom.colorPanel, dom.widthPanel, dom.shapeMenu].forEach((panel) => {
      if (panel) panel.hidden = true;
    });
    dom.colorToggle?.classList.remove("is-active");
    dom.widthToggle?.classList.remove("is-active");
    dom.shapeToggle?.setAttribute("aria-expanded", "false");
  }

  function updateToolUI() {
    const shapeActive = SHAPE_KINDS.has(state.tool);

    document.querySelectorAll(".tool-button[data-tool], .shape-choice[data-tool]").forEach((button) => {
      const active = button.dataset.tool === state.tool;
      button.classList.toggle("is-active", active);
      if (button.closest(".tool-rail")) {
        button.setAttribute("aria-pressed", active ? "true" : "false");
      }
    });

    dom.shapeToggle?.classList.toggle("is-active", shapeActive);
    if (dom.shapeToggle) {
      dom.shapeToggle.setAttribute("aria-pressed", shapeActive ? "true" : "false");
    }

    const icon = shapeIconFor(state.tool);
    if (dom.shapeIcon) dom.shapeIcon.className = `bi ${icon}`;

    document.querySelectorAll(".shape-choice[data-tool]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.tool === state.tool);
    });
  }

  function shapeIconFor(tool) {
    switch (tool) {
      case "ellipse": return "bi-circle";
      case "line": return "bi-slash-lg";
      case "arrow": return "bi-arrow-up-right";
      default: return "bi-square";
    }
  }

  function updateCursorStyle() {
    const pan = state.tool === "hand" || state.spacePressed;
    canvas.classList.toggle("is-pan-tool", pan);
    canvas.classList.toggle("is-text-tool", state.tool === "text");
    canvas.classList.toggle("is-note-tool", state.tool === "note");
    canvas.classList.toggle("is-panning", Boolean(state.pan));
  }

  function setColor(color) {
    if (!/^#[0-9a-fA-F]{6}$/.test(color || "")) return;
    state.color = color;
    updateColorUI();
  }

  function updateColorUI() {
    if (dom.inkSwatch) dom.inkSwatch.style.background = state.color;
    const custom = document.querySelector("[data-color-custom]");
    if (custom) custom.value = state.color;

    let matched = false;
    document.querySelectorAll(".color-swatch[data-color]").forEach((button) => {
      const active = button.dataset.color.toLowerCase() === state.color.toLowerCase();
      button.classList.toggle("is-active", active);
      if (active) matched = true;
    });
    document.querySelector(".color-swatch--custom")?.classList.toggle("is-active", !matched);
  }

  function setWidth(width) {
    if (!Number.isFinite(width)) return;
    state.width = clamp(width, 1, 72);
    updateWidthUI();
  }

  function updateWidthUI() {
    document.querySelectorAll(".width-choice[data-width]").forEach((button) => {
      button.classList.toggle("is-active", Number(button.dataset.width) === state.width);
    });

    if (dom.sizePreview) {
      const visual = clamp(5 + state.width * 1.35, 7, 22);
      dom.sizePreview.style.width = `${visual}px`;
      dom.sizePreview.style.height = `${visual}px`;
    }
  }

  function bindZoom() {
    document.querySelectorAll("[data-zoom-in]").forEach((button) => {
      button.addEventListener("click", () => zoomBy(1.22));
    });
    document.querySelectorAll("[data-zoom-out]").forEach((button) => {
      button.addEventListener("click", () => zoomBy(1 / 1.22));
    });
    document.querySelectorAll("[data-zoom-reset]").forEach((button) => {
      button.addEventListener("click", resetZoom);
    });
    document.querySelectorAll("[data-zoom-fit]").forEach((button) => {
      button.addEventListener("click", () => fitToContent({ maxZoom: 1.4 }));
    });
    document.querySelectorAll("[data-undo]").forEach((button) => {
      button.addEventListener("click", undoLast);
    });
    document.querySelectorAll("[data-redo]").forEach((button) => {
      button.addEventListener("click", redoLast);
    });
  }

  function bindEditorActions() {
    document.querySelector("[data-export-jpg]")?.addEventListener("click", exportJpg);

    dom.renameModal?.querySelector("[data-rename-form]")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const input = dom.renameModal.querySelector("[data-rename-input]");
      const name = (input?.value || "").trim().slice(0, 80);
      if (!name) {
        notify("Give the board a name first.", "danger");
        input?.focus();
        return;
      }

      sendAction("rename_board", { name });
      bootstrapModal(dom.renameModal)?.hide();
    });
  }

  function bindModals() {
    const bootstrapApi = window.bootstrap;
    if (bootstrapApi) {
      dom.noteModal?.addEventListener("shown.bs.modal", () => {
        dom.noteModal.querySelector("[data-note-text]")?.focus();
      });
      dom.textModal?.addEventListener("shown.bs.modal", () => {
        dom.textModal.querySelector("[data-text-content]")?.focus();
      });
      dom.renameModal?.addEventListener("shown.bs.modal", () => {
        const input = dom.renameModal.querySelector("[data-rename-input]");
        input?.focus();
        input?.select();
      });
    }

    dom.noteModal?.addEventListener("hidden.bs.modal", () => {
      state.noteAnchor = null;
    });
    dom.textModal?.addEventListener("hidden.bs.modal", () => {
      state.textAnchor = null;
    });

    dom.noteModal?.querySelector("[data-note-form]")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const text = dom.noteModal.querySelector("[data-note-text]")?.value.trim();
      if (!text || !state.noteAnchor) return;

      const color =
        dom.noteModal.querySelector('input[name="note_color"]:checked')?.value || "#FFD97D";
      const element = {
        kind: "note",
        color,
        width: 4,
        payload: {
          x: roundCoordinate(state.noteAnchor.x),
          y: roundCoordinate(state.noteAnchor.y),
          w: 236,
          h: 180,
          text: text.slice(0, 1000)
        }
      };

      persistNewElement(element);
      dom.noteModal.querySelector("[data-note-text]").value = "";
      bootstrapModal(dom.noteModal)?.hide();
    });

    dom.textModal?.querySelector("[data-text-form]")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const text = dom.textModal.querySelector("[data-text-content]")?.value.trim();
      if (!text || !state.textAnchor) return;

      const fontSize = Number(dom.textModal.querySelector('input[name="font_size"]:checked')?.value) || 32;
      const element = {
        kind: "text",
        color: state.color,
        width: state.width,
        payload: {
          x: roundCoordinate(state.textAnchor.x),
          y: roundCoordinate(state.textAnchor.y),
          text: text.slice(0, 2000),
          font_size: fontSize,
          max_width: 560
        }
      };

      persistNewElement(element);
      dom.textModal.querySelector("[data-text-content]").value = "";
      bootstrapModal(dom.textModal)?.hide();
    });
  }

  function openNoteModal(world) {
    state.noteAnchor = { ...world };
    const modal = bootstrapModal(dom.noteModal);
    if (modal) {
      modal.show();
    } else {
      const text = window.prompt("Sticky note text");
      if (text && text.trim()) {
        persistNewElement({
          kind: "note",
          color: "#FFD97D",
          width: 4,
          payload: {
            x: roundCoordinate(world.x),
            y: roundCoordinate(world.y),
            w: 236,
            h: 180,
            text: text.trim().slice(0, 1000)
          }
        });
      }
    }
    closePanels();
  }

  function openTextModal(world) {
    state.textAnchor = { ...world };
    const modal = bootstrapModal(dom.textModal);
    modal?.show();
    closePanels();
  }

  function bootstrapModal(element) {
    if (!element || !window.bootstrap) return null;
    return window.bootstrap.Modal.getOrCreateInstance(element);
  }

  function bindKeyboard() {
    if (window.hotkeys) {
      const guard = (event) => {
        if (modalIsOpen() || state.draft) return false;
        if (event?.target?.closest?.("input, textarea, select, button, a, [contenteditable='true']")) return false;
        return true;
      };

      const toolShortcuts = {
        p: "pen",
        l: "highlighter",
        e: "eraser",
        r: "rectangle",
        o: "ellipse",
        n: "note",
        t: "text",
        h: "hand"
      };

      Object.entries(toolShortcuts).forEach(([key, tool]) => {
        window.hotkeys(key, (event) => {
          if (!guard(event)) return;
          event.preventDefault();
          selectTool(tool);
        });
      });

      window.hotkeys("ctrl+z,meta+z", (event) => {
        if (!guard(event)) return;
        event.preventDefault();
        undoLast();
      });

      window.hotkeys("ctrl+shift+z,meta+shift+z,ctrl+y", (event) => {
        if (!guard(event)) return;
        event.preventDefault();
        redoLast();
      });
    }

    document.addEventListener("keydown", (event) => {
      const targetIsEditable = event.target?.closest?.(
        "input, textarea, select, button, a, [contenteditable='true']"
      );

      if (event.code === "Space" && !targetIsEditable && !modalIsOpen()) {
        if (!state.spacePressed) {
          state.spacePressed = true;
          updateCursorStyle();
        }
        if (!event.repeat) event.preventDefault();
        return;
      }

      if (event.key === "Escape") {
        closePanels();
        if (state.draft) cancelDraft();
        updateCursorStyle();
        return;
      }

      if (targetIsEditable || modalIsOpen()) return;

      if (event.key === "?") {
        event.preventDefault();
        bootstrapModal(dom.shortcutsModal)?.show();
        return;
      }

      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        zoomBy(1.18);
        return;
      }

      if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        zoomBy(1 / 1.18);
        return;
      }

      if (event.key === "0") {
        event.preventDefault();
        resetZoom();
      }
    });

    document.addEventListener("keyup", (event) => {
      if (event.code === "Space") {
        state.spacePressed = false;
        updateCursorStyle();
      }
    });
  }

  function modalIsOpen() {
    return Boolean(document.querySelector(".modal.show"));
  }

  /* Status, notifications & export */

  function refreshStatus() {
    if (!dom.syncLabel || !dom.syncWrapper) return;

    const pending = pendingCommits.size + pendingUndos.size;

    dom.syncWrapper.classList.remove("is-reconnecting", "is-offline");

    if (state.connection === "connecting") {
      dom.syncLabel.textContent = "Connecting\u2026";
      return;
    }

    if (state.connection === "disconnected") {
      dom.syncWrapper.classList.add("is-reconnecting");
      dom.syncLabel.textContent = "Reconnecting\u2026";
      return;
    }

    if (state.connection === "rejected" || state.boardDeleted) {
      dom.syncWrapper.classList.add("is-offline");
      dom.syncLabel.textContent = "Session ended";
      return;
    }

    dom.syncLabel.textContent = pending > 0 ? "Saving\u2026" : "Live";
  }

  function notify(message, variant = "success") {
    if (window.TandemUI?.toast) {
      window.TandemUI.toast(message, variant);
    } else {
      console[variant === "danger" ? "error" : "log"](message);
    }
  }

  function exportJpg() {
    const bounds = contentBounds();
    if (!bounds || elements.length === 0) {
      notify("There isn\u2019t anything on the board to export yet.", "danger");
      return;
    }

    const padding = 100;
    const worldWidth = Math.max(1, bounds.maxX - bounds.minX + padding * 2);
    const worldHeight = Math.max(1, bounds.maxY - bounds.minY + padding * 2);
    const exportScale = Math.min(2, 6000 / Math.max(worldWidth, worldHeight));
    const outputWidth = Math.max(1, Math.round(worldWidth * exportScale));
    const outputHeight = Math.max(1, Math.round(worldHeight * exportScale));
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = outputWidth;
    exportCanvas.height = outputHeight;
    const ctx = exportCanvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = board.background;
    ctx.fillRect(0, 0, outputWidth, outputHeight);

    const originX = bounds.minX - padding;
    const originY = bounds.minY - padding;
    ctx.setTransform(exportScale, 0, 0, exportScale, -originX * exportScale, -originY * exportScale);

    const gridStartX = Math.ceil(originX / 32) * 32;
    const gridStartY = Math.ceil(originY / 32) * 32;
    ctx.fillStyle = board.dots;
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    for (let x = gridStartX; x < originX + worldWidth; x += 32) {
      for (let y = gridStartY; y < originY + worldHeight; y += 32) {
        ctx.moveTo(x + 1.15, y);
        ctx.arc(x, y, 1.15, 0, Math.PI * 2);
      }
    }
    ctx.fill();
    ctx.globalAlpha = 1;

    elements.forEach((element) => {
      drawElement(ctx, element);
    });

    ctx.setTransform(1, 0, 0, 1, 0, 0);

    exportCanvas.toBlob((blob) => {
      if (!blob) {
        notify("The JPG could not be generated. Please try again.", "danger");
        return;
      }

      const safeName = boardName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "tandem-board";
      const filename = `${safeName}.jpg`;

      if (typeof window.saveAs === "function") {
        window.saveAs(blob, filename);
      } else {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }

      notify("Your board was downloaded as a JPG.");
    }, "image/jpeg", 0.92);
  }

  window.TandemBoard = {
    undo: undoLast,
    redo: redoLast,
    exportJpg,
    fit: () => fitToContent({ maxZoom: 1.4 }),
    reset: resetCamera,
    elementCount: () => elements.length,
    livePreviewCount: () => liveElements.size,
    undoCount: () => undoStack.length,
    redoCount: () => redoStack.length
  };
})();
