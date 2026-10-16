const state = {
  palette: [],
  image: null,
  imageUrl: null,
  imageName: "",
  rows: 64,
  cols: 64,
  grid: [],
  selectedCode: null,
  tool: "paint",
  zoom: 1,
  imageZoom: 1,
  imageOpacity: 0.45,
  imageOffsetX: 0,
  imageOffsetY: 0,
  imageDragMode: false,
  imageDragStart: null,
  drawing: false,
  strokeHistorySaved: false,
  history: [],
  imageSampler: null,
};

const $ = (selector) => document.querySelector(selector);
const canvas = $("#pattern-canvas");
const ctx = canvas.getContext("2d");
const stage = $("#canvas-stage");

function makeGrid(rows, cols) {
  return Array.from({ length: rows }, () => Array(cols).fill(""));
}

function cloneGrid(grid) {
  return grid.map((row) => [...row]);
}

function pushHistory() {
  state.history.push({ rows: state.rows, cols: state.cols, grid: cloneGrid(state.grid) });
  if (state.history.length > 50) state.history.shift();
}

function undo() {
  const previous = state.history.pop();
  if (!previous) {
    notify("没有可回退的操作");
    return;
  }
  state.rows = previous.rows;
  state.cols = previous.cols;
  state.grid = cloneGrid(previous.grid);
  $("#rows-input").value = state.rows;
  $("#cols-input").value = state.cols;
  updateStats();
  draw();
  notify("已回退上一步操作");
}

function paletteItem(code) {
  return state.palette.find((item) => item.code === code);
}

function nearestColor(rgb) {
  let best = null;
  let bestDist = Infinity;
  for (const item of state.palette) {
    const dr = item.rgb[0] - rgb[0];
    const dg = item.rgb[1] - rgb[1];
    const db = item.rgb[2] - rgb[2];
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bestDist) { bestDist = dist; best = item; }
  }
  return best;
}

function pickColor(event) {
  if (!state.image) { notify("请先载入参考图"); return; }
  const layout = getCanvasLayout();
  const rect = canvas.getBoundingClientRect();
  const x = (event.clientX - rect.left) * (layout.width / rect.width);
  const y = (event.clientY - rect.top) * (layout.height / rect.height);
  const coverScale = Math.max(layout.width / state.image.naturalWidth, layout.height / state.image.naturalHeight);
  const imageWidth = state.image.naturalWidth * coverScale * state.imageZoom;
  const imageHeight = state.image.naturalHeight * coverScale * state.imageZoom;
  const imageX = (layout.width - imageWidth) / 2 + layout.width * state.imageOffsetX;
  const imageY = (layout.height - imageHeight) / 2 + layout.height * state.imageOffsetY;
  const imgPxX = Math.floor((x - imageX) / imageWidth * state.image.naturalWidth);
  const imgPxY = Math.floor((y - imageY) / imageHeight * state.image.naturalHeight);
  if (imgPxX < 0 || imgPxX >= state.image.naturalWidth || imgPxY < 0 || imgPxY >= state.image.naturalHeight) {
    notify("请点击参考图区域内取色");
    return;
  }
  if (!state.imageSampler) {
    state.imageSampler = document.createElement("canvas");
    state.imageSampler.width = state.image.naturalWidth;
    state.imageSampler.height = state.image.naturalHeight;
  }
  const sctx = state.imageSampler.getContext("2d", { willReadFrequently: true });
  sctx.drawImage(state.image, 0, 0);
  const pixel = sctx.getImageData(imgPxX, imgPxY, 1, 1).data;
  const match = nearestColor([pixel[0], pixel[1], pixel[2]]);
  if (!match) { notify("色板为空，无法匹配"); return; }
  state.selectedCode = match.code;
  state.tool = "paint";
  updateToolButtons();
  notify(`取色匹配：${match.code} · ${match.name}`);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

function notify(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => toast.classList.remove("is-visible"), 2500);
}

function setGridSize(rows, cols, message = true) {
  if (state.grid.length) pushHistory();
  state.rows = Math.max(1, Math.min(240, Number(rows) || 32));
  state.cols = Math.max(1, Math.min(240, Number(cols) || 32));
  state.grid = makeGrid(state.rows, state.cols);
  $("#rows-input").value = state.rows;
  $("#cols-input").value = state.cols;
  updateStats();
  draw();
  if (message) notify(`已应用 ${state.rows} × ${state.cols} 网格`);
}

function updateStats() {
  const filled = state.grid.flat().filter(Boolean).length;
  $("#canvas-size").textContent = `${state.rows} × ${state.cols}`;
  $("#filled-count").textContent = filled.toLocaleString("zh-CN");
  $("#selected-code").textContent = state.tool === "eraser" ? "橡皮擦" : (state.selectedCode || "未选择");
  $("#tool-label").textContent = state.imageDragMode ? "拖动参考图" : (state.tool === "eraser" ? "橡皮擦" : state.tool === "picker" ? "取色器" : "画笔");
  $("#zoom-value").textContent = `${Math.round(state.zoom * 100)}%`;
  $("#image-zoom-value").textContent = `${Math.round(state.imageZoom * 100)}%`;
  $("#image-zoom-slider").value = Math.round(state.imageZoom * 100);
  $("#image-opacity-value").textContent = `${Math.round(state.imageOpacity * 100)}%`;
  $("#image-opacity-slider").value = Math.round(state.imageOpacity * 100);
  $("#image-offset-x-slider").value = Math.round(state.imageOffsetX * 1000) / 10;
  $("#image-offset-y-slider").value = Math.round(state.imageOffsetY * 1000) / 10;
  $("#image-offset-x-value").textContent = formatOffset(state.imageOffsetX);
  $("#image-offset-y-value").textContent = formatOffset(state.imageOffsetY);
  $("#image-drag-toggle").classList.toggle("is-active", state.imageDragMode);
  $("#image-drag-toggle").setAttribute("aria-pressed", String(state.imageDragMode));
  $("#image-drag-toggle").textContent = state.imageDragMode ? "结束拖动参考图" : "拖动参考图";
  renderSummary();
}

function formatOffset(value) {
  const percentage = Math.round(value * 1000) / 10;
  return `${percentage > 0 ? "+" : ""}${percentage}%`;
}

function luminance(rgb) {
  return ((rgb[0] * 299) + (rgb[1] * 587) + (rgb[2] * 114)) / 1000;
}

function renderPalette() {
  const query = $("#palette-search").value.trim().toLowerCase();
  const items = state.palette.filter((item) => {
    return !query || item.code.toLowerCase().includes(query) || item.name.toLowerCase().includes(query);
  });
  $("#color-count").textContent = `${state.palette.length} 色`;
  $("#palette-list").innerHTML = items.length
    ? items.map((item) => `<button class="palette-swatch ${luminance(item.rgb) < 145 ? "dark" : ""} ${state.selectedCode === item.code && state.tool === "paint" ? "is-selected" : ""}" data-code="${escapeHtml(item.code)}" type="button" title="${escapeHtml(item.code)} · ${escapeHtml(item.name)}" style="background:${item.hex}"><span>${escapeHtml(item.code)}</span></button>`).join("")
    : `<span class="muted">没有匹配的色号</span>`;
  $("#palette-list").querySelectorAll("[data-code]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedCode = button.dataset.code;
      state.tool = "paint";
      updateToolButtons();
      renderPalette();
      updateStats();
    });
  });
}

function renderSummary() {
  const counts = new Map();
  state.grid.flat().filter(Boolean).forEach((code) => counts.set(code, (counts.get(code) || 0) + 1));
  const items = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  $("#summary-count").textContent = `${items.length} 色`;
  $("#summary-list").innerHTML = items.length
    ? items.map(([code, count]) => {
      const item = paletteItem(code);
      return `<div class="summary-row"><i style="background:${item?.hex || "#ddd"}"></i><strong>${escapeHtml(code)}</strong><span>${escapeHtml(item?.name || "")}</span><span>×${count}</span></div>`;
    }).join("")
    : `<span class="muted">尚未填充颜色</span>`;
}

function cropBlankEdges(grid) {
  const rows = grid.length;
  const cols = rows ? grid[0].length : 0;
  if (!rows || !cols) return [[""]];

  let top = rows;
  let bottom = -1;
  let left = cols;
  let right = -1;

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      if (!grid[row][col]) continue;
      top = Math.min(top, row);
      bottom = Math.max(bottom, row);
      left = Math.min(left, col);
      right = Math.max(right, col);
    }
  }

  if (bottom === -1) return [[""]];
  return grid.slice(top, bottom + 1).map((row) => row.slice(left, right + 1));
}

function getCanvasLayout() {
  const maxW = Math.max(240, stage.clientWidth - 68);
  const maxH = Math.max(260, stage.clientHeight - 68);
  const cellSize = Math.min(maxW / state.cols, maxH / state.rows) * state.zoom;
  return {
    width: Math.max(state.cols, Math.round(cellSize * state.cols)),
    height: Math.max(state.rows, Math.round(cellSize * state.rows)),
  };
}

function draw() {
  const layout = getCanvasLayout();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(layout.width * dpr);
  canvas.height = Math.round(layout.height * dpr);
  canvas.style.width = `${layout.width}px`;
  canvas.style.height = `${layout.height}px`;
  canvas.classList.toggle("is-dragging-reference", state.imageDragMode);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, layout.width, layout.height);
  if (state.image) {
    const coverScale = Math.max(
      layout.width / state.image.naturalWidth,
      layout.height / state.image.naturalHeight,
    );
    const imageWidth = state.image.naturalWidth * coverScale * state.imageZoom;
    const imageHeight = state.image.naturalHeight * coverScale * state.imageZoom;
    const imageX = (layout.width - imageWidth) / 2 + layout.width * state.imageOffsetX;
    const imageY = (layout.height - imageHeight) / 2 + layout.height * state.imageOffsetY;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, layout.width, layout.height);
    ctx.clip();
    ctx.globalAlpha = state.imageOpacity;
    ctx.drawImage(state.image, imageX, imageY, imageWidth, imageHeight);
    ctx.restore();
  }
  const cellW = layout.width / state.cols;
  const cellH = layout.height / state.rows;
  for (let row = 0; row < state.rows; row += 1) {
    for (let col = 0; col < state.cols; col += 1) {
      const code = state.grid[row][col];
      if (code) {
        const item = paletteItem(code);
        ctx.fillStyle = item?.hex || "#ffffff";
        ctx.globalAlpha = 0.84;
        ctx.fillRect(col * cellW + 1, row * cellH + 1, Math.max(0, cellW - 2), Math.max(0, cellH - 2));
        ctx.globalAlpha = 1;
        const padding = Math.max(1, Math.min(cellW, cellH) * 0.12);
        const maxTextWidth = Math.max(1, cellW - padding * 2);
        const maxTextHeight = Math.max(1, cellH - padding * 2);
        let fontSize = Math.max(5, Math.min(13, maxTextHeight * 0.72));
        ctx.font = `700 ${fontSize}px ${getComputedStyle(document.body).fontFamily}`;
        while (fontSize > 5 && ctx.measureText(code).width > maxTextWidth) {
          fontSize -= 0.5;
          ctx.font = `700 ${fontSize}px ${getComputedStyle(document.body).fontFamily}`;
        }
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = luminance(item?.rgb || [255, 255, 255]) < 145 ? "#ffffff" : "#16211d";
        ctx.fillText(code, col * cellW + cellW / 2, row * cellH + cellH / 2);
      }
    }
  }
  ctx.strokeStyle = "rgba(22,33,29,.48)";
  ctx.lineWidth = Math.max(0.6, Math.min(1.3, 1 / state.zoom));
  for (let col = 0; col <= state.cols; col += 1) {
    const x = Math.round(col * cellW) + 0.5;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, layout.height); ctx.stroke();
  }
  for (let row = 0; row <= state.rows; row += 1) {
    const y = Math.round(row * cellH) + 0.5;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(layout.width, y); ctx.stroke();
  }
}

function pointToCell(event) {
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const col = Math.floor((x / rect.width) * state.cols);
  const row = Math.floor((y / rect.height) * state.rows);
  if (row < 0 || row >= state.rows || col < 0 || col >= state.cols) return null;
  return { row, col };
}

function paint(event) {
  const cell = pointToCell(event);
  if (!cell) return;
  const nextCode = state.tool === "eraser" ? "" : state.selectedCode;
  if (state.tool === "paint" && !nextCode) { notify("请先从 MARD 色板选择一个色号"); return; }
  if (state.grid[cell.row][cell.col] === nextCode) return;
  if (!state.strokeHistorySaved) {
    pushHistory();
    state.strokeHistorySaved = true;
  }
  state.grid[cell.row][cell.col] = nextCode;
  draw();
  updateStats();
}

function updateToolButtons() {
  $("#paint-tool").classList.toggle("is-active", state.tool === "paint");
  $("#erase-tool").classList.toggle("is-active", state.tool === "eraser");
  $("#picker-tool").classList.toggle("is-active", state.tool === "picker");
  canvas.classList.toggle("is-picking", state.tool === "picker");
  renderPalette();
  updateStats();
}

function createPatternId() {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const randomId = globalThis.crypto?.randomUUID
    ? crypto.randomUUID().replaceAll("-", "").slice(0, 8)
    : Math.random().toString(16).slice(2, 10);
  return `ptn_${date}_${randomId}`;
}

function exportJson() {
  const exportGrid = cropBlankEdges(state.grid);
  const patternId = createPatternId();
  const name = state.imageName.replace(/\.[^.]+$/, "") || $("#canvas-title").textContent.trim() || "untitled";
  const data = {
    brand: "mard",
    title: name,
    categories: [],
    rows: exportGrid.length,
    cols: exportGrid[0].length,
    totalBeads: exportGrid.flat().filter(Boolean).length,
    star: 0,
    coverImage: "",
    grid: exportGrid.map((row) => row.map((code) => code || null)),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${patternId}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  notify(`已导出 ${patternId}.json`);
}

function exportCoverImage() {
  const exportGrid = cropBlankEdges(state.grid);
  if (!exportGrid.flat().some(Boolean)) { notify("画板尚未填色，无法导出封面图"); return; }
  const rows = exportGrid.length;
  const cols = exportGrid[0].length;
  const MIN_SIDE = 480;
  const MAX_SIDE = 1000;
  const MIN_MARGIN = 24;
  const cellSize = Math.max(1, Math.min(32, Math.floor((MAX_SIDE - MIN_MARGIN * 2) / Math.max(rows, cols))));
  const patternWidth = cols * cellSize;
  const patternHeight = rows * cellSize;
  const margin = Math.max(MIN_MARGIN, Math.round(Math.max(patternWidth, patternHeight) * 0.08));
  const side = Math.min(MAX_SIDE, Math.max(MIN_SIDE, Math.max(patternWidth, patternHeight) + margin * 2));
  const offsetX = Math.round((side - patternWidth) / 2);
  const offsetY = Math.round((side - patternHeight) / 2);
  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = side;
  exportCanvas.height = side;
  const exportCtx = exportCanvas.getContext("2d");
  exportCtx.fillStyle = "#ffffff";
  exportCtx.fillRect(0, 0, side, side);
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const code = exportGrid[row][col];
      if (!code) continue;
      exportCtx.fillStyle = paletteItem(code)?.hex || "#ffffff";
      exportCtx.fillRect(offsetX + col * cellSize, offsetY + row * cellSize, cellSize, cellSize);
    }
  }
  const patternId = createPatternId();
  const filename = `${patternId}_cover.png`;
  exportCanvas.toBlob((blob) => {
    if (!blob) { notify("封面图导出失败"); return; }
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify(`已导出 ${filename}（${side} × ${side}px 正方形）`);
  }, "image/png");
}

async function importPatternJson(file) {
  if (!file) return;
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    notify("JSON 解析失败，请检查文件内容");
    return;
  }
  if (!Array.isArray(data.grid) || !data.grid.length || !Array.isArray(data.grid[0])) {
    notify("JSON 中缺少有效的 grid 矩阵");
    return;
  }
  const truncated = data.grid.length > 240 || Math.max(...data.grid.map((row) => row.length)) > 240;
  pushHistory();
  state.rows = Math.max(1, Math.min(240, data.grid.length));
  state.cols = Math.max(1, Math.min(240, Math.max(...data.grid.map((row) => row.length))));
  state.grid = Array.from({ length: state.rows }, (_, row) =>
    Array.from({ length: state.cols }, (_, col) => {
      const code = data.grid[row]?.[col];
      return typeof code === "string" ? code : "";
    })
  );
  $("#rows-input").value = state.rows;
  $("#cols-input").value = state.cols;
  if (data.title) $("#canvas-title").textContent = data.title.replace(/^拼豆图纸 · /, "");
  $("#empty-canvas").style.display = "none";
  canvas.classList.add("is-visible");
  updateStats();
  draw();
  notify(truncated
    ? `已导入 ${file.name}（超过 240×240，已截断为 ${state.rows} × ${state.cols}）`
    : `已导入 ${file.name}（${state.rows} × ${state.cols}）`);
}

function loadImage(file) {
  if (!file) return;
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => {
    if (state.imageUrl) URL.revokeObjectURL(state.imageUrl);
    state.imageUrl = url;
    state.image = image;
    state.imageSampler = null;
    state.imageName = file.name;
    state.imageZoom = 1;
    state.imageOpacity = 0.45;
    state.imageOffsetX = 0;
    state.imageOffsetY = 0;
    $("#upload-label").textContent = file.name;
    $("#image-meta").textContent = `${image.naturalWidth} × ${image.naturalHeight}px`;
    $("#canvas-title").textContent = file.name.replace(/\.[^.]+$/, "");
    $("#empty-canvas").style.display = "none";
    canvas.classList.add("is-visible");
    draw();
    notify("图片已载入，可以开始绘制");
  };
  image.onerror = () => { URL.revokeObjectURL(url); notify("图片读取失败"); };
  image.src = url;
}

$("#image-input").addEventListener("change", (event) => loadImage(event.target.files[0]));
$("#palette-search").addEventListener("input", renderPalette);
$("#apply-grid-button").addEventListener("click", () => setGridSize($("#rows-input").value, $("#cols-input").value));
$("#paint-tool").addEventListener("click", () => { state.tool = "paint"; updateToolButtons(); });
$("#erase-tool").addEventListener("click", () => { state.tool = "eraser"; updateToolButtons(); });
$("#picker-tool").addEventListener("click", () => {
  if (!state.image) { notify("请先载入参考图"); return; }
  state.tool = "picker";
  updateToolButtons();
});
$("#zoom-in").addEventListener("click", () => { state.zoom = Math.min(2.5, state.zoom + .1); updateStats(); draw(); });
$("#zoom-out").addEventListener("click", () => { state.zoom = Math.max(.5, state.zoom - .1); updateStats(); draw(); });
$("#zoom-reset").addEventListener("click", () => { state.zoom = 1; updateStats(); draw(); });
function setImageZoom(value) {
  state.imageZoom = Math.max(0.5, Math.min(3, Number(value) / 100));
  updateStats();
  draw();
}

function setImageOpacity(value) {
  state.imageOpacity = Math.max(0, Math.min(1, Number(value) / 100));
  updateStats();
  draw();
}

function setImageOffset(axis, value) {
  state[axis] = Math.max(-1, Math.min(1, Number(value) / 100));
  updateStats();
  draw();
}

function resetImagePosition() {
  state.imageOffsetX = 0;
  state.imageOffsetY = 0;
  updateStats();
  draw();
  notify("参考图已居中");
}

function toggleImageDragMode() {
  if (!state.image) { notify("请先载入参考图"); return; }
  state.imageDragMode = !state.imageDragMode;
  state.imageDragStart = null;
  updateStats();
  draw();
  notify(state.imageDragMode ? "已开启参考图拖动" : "已关闭参考图拖动");
}

$("#image-zoom-slider").addEventListener("input", (event) => setImageZoom(event.target.value));
$("#image-zoom-out").addEventListener("click", () => setImageZoom(state.imageZoom * 100 - 1));
$("#image-zoom-in").addEventListener("click", () => setImageZoom(state.imageZoom * 100 + 1));
$("#image-opacity-slider").addEventListener("input", (event) => setImageOpacity(event.target.value));
$("#image-offset-x-slider").addEventListener("input", (event) => setImageOffset("imageOffsetX", event.target.value));
$("#image-offset-y-slider").addEventListener("input", (event) => setImageOffset("imageOffsetY", event.target.value));
$("#image-position-reset").addEventListener("click", resetImagePosition);
$("#image-drag-toggle").addEventListener("click", toggleImageDragMode);
$("#clear-button").addEventListener("click", () => {
  if (state.grid.flat().some(Boolean)) pushHistory();
  state.grid = makeGrid(state.rows, state.cols);
  draw();
  updateStats();
  notify("画板已清空");
});
$("#export-button").addEventListener("click", exportJson);
$("#export-cover-button").addEventListener("click", exportCoverImage);
$("#import-json-button").addEventListener("click", () => $("#json-input").click());
$("#json-input").addEventListener("change", (event) => {
  importPatternJson(event.target.files[0]);
  event.target.value = "";
});
window.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();
  const isUndo = (event.ctrlKey || event.metaKey) && key === "z" && !event.shiftKey;
  const isPicker = (event.ctrlKey || event.metaKey) && key === "x" && !event.altKey && !event.shiftKey;
  const typing = /^(input|textarea|select)$/i.test(event.target.tagName);
  if (isUndo && !event.altKey) { event.preventDefault(); undo(); return; }
  if (isPicker && !typing) {
    event.preventDefault();
    if (!state.image) { notify("请先载入参考图"); return; }
    if (state.tool === "picker") { state.tool = "paint"; }
    else { state.tool = "picker"; }
    updateToolButtons();
  }
});
canvas.addEventListener("pointerdown", (event) => {
  if (state.imageDragMode && state.image) {
    const rect = canvas.getBoundingClientRect();
    state.imageDragStart = {
      clientX: event.clientX,
      clientY: event.clientY,
      offsetX: state.imageOffsetX,
      offsetY: state.imageOffsetY,
      width: rect.width,
      height: rect.height,
    };
    canvas.setPointerCapture(event.pointerId);
    return;
  }
  if (state.tool === "picker") {
    pickColor(event);
    return;
  }
  state.drawing = true;
  state.strokeHistorySaved = false;
  canvas.setPointerCapture(event.pointerId);
  paint(event);
});
canvas.addEventListener("pointermove", (event) => {
  if (state.imageDragMode && state.imageDragStart) {
    const { clientX, clientY, offsetX, offsetY, width, height } = state.imageDragStart;
    state.imageOffsetX = Math.max(-1, Math.min(1, offsetX + (event.clientX - clientX) / width));
    state.imageOffsetY = Math.max(-1, Math.min(1, offsetY + (event.clientY - clientY) / height));
    updateStats();
    draw();
    return;
  }
  if (state.drawing) paint(event);
});
canvas.addEventListener("pointerup", () => { state.drawing = false; state.strokeHistorySaved = false; state.imageDragStart = null; });
canvas.addEventListener("pointercancel", () => { state.drawing = false; state.strokeHistorySaved = false; state.imageDragStart = null; });
window.addEventListener("resize", draw);

fetch("./palette.mard.json")
  .then((response) => response.json())
  .then((palette) => { state.palette = palette; renderPalette(); setGridSize(state.rows, state.cols, false); })
  .catch(() => notify("MARD 色板载入失败，请检查 palette.mard.json"));
