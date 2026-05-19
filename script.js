// ---------- auth gate ----------
// If not logged in, bounce to login page.
if (!isAuthed()) {
    setFlash("로그인이 필요합니다");
    window.location.replace("login.html");
}

// ---------- constants ----------
const COLS = 10;
const ROWS = 20;
const CELL = 30; // matches canvas 300x600

const COLORS = {
    I: "#3ad6e0",
    O: "#f0d44d",
    T: "#b566d9",
    S: "#5cd66b",
    Z: "#e85769",
    J: "#5b8bf0",
    L: "#f0a04b",
};

// 4x4 spawn matrices — rotation is computed at runtime.
const PIECES = {
    I: [
        [0, 0, 0, 0],
        [1, 1, 1, 1],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
    ],
    O: [
        [0, 0, 0, 0],
        [0, 1, 1, 0],
        [0, 1, 1, 0],
        [0, 0, 0, 0],
    ],
    T: [
        [0, 1, 0],
        [1, 1, 1],
        [0, 0, 0],
    ],
    S: [
        [0, 1, 1],
        [1, 1, 0],
        [0, 0, 0],
    ],
    Z: [
        [1, 1, 0],
        [0, 1, 1],
        [0, 0, 0],
    ],
    J: [
        [1, 0, 0],
        [1, 1, 1],
        [0, 0, 0],
    ],
    L: [
        [0, 0, 1],
        [1, 1, 1],
        [0, 0, 0],
    ],
};

const KICKS = [0, -1, 1, -2, 2]; // wall-kick offsets to try after rotation

// ---------- elements ----------
const boardCanvas = document.getElementById("board");
const ctx = boardCanvas.getContext("2d");
const nextCanvas = document.getElementById("next");
const nctx = nextCanvas.getContext("2d");

const scoreEl = document.getElementById("score");
const levelEl = document.getElementById("level");
const linesEl = document.getElementById("lines");
const bestScoreEl = document.getElementById("bestScore");
const bestHolderEl = document.getElementById("bestHolder");

const overlay = document.getElementById("overlay");
const overlayTitle = document.getElementById("overlayTitle");
const overlaySub = document.getElementById("overlaySub");

const userBadgeEl = document.getElementById("userBadge");
const logoutBtn = document.getElementById("logoutBtn");
const toastEl = document.getElementById("toast");

// ---------- state ----------
let board, current, next, bag, score, lines, level, gameOver, paused;
let lastTime = 0;
let dropAccum = 0;
let scoreSubmitted = false; // 한 게임당 1회만 제출

// ---------- toast ----------
let toastTimer;
function toast(message, type = "") {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.className = `toast ${type}`;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, 2400);
}

// ---------- top-bar wiring ----------
const email = getEmail();
if (email) {
    userBadgeEl.textContent = email;
    userBadgeEl.hidden = false;
}
logoutBtn.hidden = false;
logoutBtn.addEventListener("click", async () => {
    const r = getRefresh();
    if (r) {
        try {
            await fetch(`${API_BASE}/auth/logout`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ refresh_token: r }),
            });
        } catch (_) { /* best-effort */ }
    }
    clearTokens();
    setFlash("로그아웃되었습니다");
    window.location.replace("login.html");
});

// ---------- highest score from server ----------
async function loadHighest() {
    try {
        const res = await publicFetch("/scores/highest");
        if (!res.ok) {
            bestScoreEl.textContent = "—";
            return;
        }
        const data = await res.json();
        if (data == null) {
            bestScoreEl.textContent = "0";
            bestHolderEl.textContent = "아직 기록 없음";
            return;
        }
        bestScoreEl.textContent = data.score.toLocaleString();
        bestHolderEl.textContent = `by ${data.email}`;
    } catch (_) {
        bestScoreEl.textContent = "—";
        bestHolderEl.textContent = "서버 응답 없음";
    }
}
loadHighest();

// ---------- score submit on game over ----------
async function submitScore() {
    if (scoreSubmitted) return;
    if (score <= 0) return; // 아무것도 안 하고 끝난 경우 굳이 저장 X
    scoreSubmitted = true;
    try {
        const res = await authedFetch("/scores", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ score, lines, level }),
        });
        if (!res.ok) {
            toast(`점수 저장 실패: ${await readError(res)}`, "error");
            scoreSubmitted = false; // 재시도 가능하도록
            return;
        }
        toast("점수 저장 완료", "success");
        loadHighest(); // 갱신
    } catch (err) {
        if (err.message === "Unauthorized") {
            setFlash("세션이 만료되었습니다. 다시 로그인하세요.");
            window.location.replace("login.html");
            return;
        }
        toast(`네트워크 오류: ${err.message}`, "error");
        scoreSubmitted = false;
    }
}

// ---------- game core ----------
function emptyBoard() {
    return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
}

function rotateCW(matrix) {
    const N = matrix.length;
    const out = Array.from({ length: N }, () => Array(N).fill(0));
    for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
            out[x][N - 1 - y] = matrix[y][x];
        }
    }
    return out;
}

function clonePiece(type) {
    const shape = PIECES[type].map((row) => row.slice());
    const N = shape.length;
    return {
        type,
        shape,
        x: Math.floor((COLS - N) / 2),
        y: type === "I" ? -1 : 0,
    };
}

function refillBag() {
    const types = Object.keys(PIECES);
    for (let i = types.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [types[i], types[j]] = [types[j], types[i]];
    }
    bag.push(...types);
}

function nextFromBag() {
    if (bag.length === 0) refillBag();
    return clonePiece(bag.shift());
}

function collides(piece, dx = 0, dy = 0, shape = piece.shape) {
    for (let y = 0; y < shape.length; y++) {
        for (let x = 0; x < shape[y].length; x++) {
            if (!shape[y][x]) continue;
            const nx = piece.x + x + dx;
            const ny = piece.y + y + dy;
            if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
            if (ny >= 0 && board[ny][nx]) return true;
        }
    }
    return false;
}

function lockPiece() {
    for (let y = 0; y < current.shape.length; y++) {
        for (let x = 0; x < current.shape[y].length; x++) {
            if (!current.shape[y][x]) continue;
            const by = current.y + y;
            const bx = current.x + x;
            if (by < 0) {
                triggerGameOver();
                return;
            }
            board[by][bx] = current.type;
        }
    }
    clearLines();
    spawnNext();
}

function clearLines() {
    let cleared = 0;
    for (let y = ROWS - 1; y >= 0; y--) {
        if (board[y].every((cell) => cell !== null)) {
            board.splice(y, 1);
            board.unshift(Array(COLS).fill(null));
            cleared++;
            y++;
        }
    }
    if (cleared > 0) {
        const points = [0, 100, 300, 500, 800][cleared] * level;
        score += points;
        lines += cleared;
        const newLevel = Math.floor(lines / 10) + 1;
        if (newLevel !== level) level = newLevel;
        updateStats();
    }
}

function spawnNext() {
    if (gameOver) return;
    current = next;
    next = nextFromBag();
    drawNext();
    if (collides(current)) {
        triggerGameOver();
    }
}

function dropInterval() {
    return Math.max(80, 800 - (level - 1) * 70);
}

function softDrop() {
    if (!collides(current, 0, 1)) {
        current.y++;
        score += 1;
        updateStats();
    } else {
        lockPiece();
    }
}

function hardDrop() {
    let dropped = 0;
    while (!collides(current, 0, 1)) {
        current.y++;
        dropped++;
    }
    score += dropped * 2;
    lockPiece();
    updateStats();
}

function move(dx) {
    if (!collides(current, dx, 0)) current.x += dx;
}

function rotate() {
    const rotated = rotateCW(current.shape);
    for (const kick of KICKS) {
        if (!collides(current, kick, 0, rotated)) {
            current.shape = rotated;
            current.x += kick;
            return;
        }
    }
}

// ---------- render ----------
function drawCell(c, x, y, color, ghost = false) {
    const px = x * CELL;
    const py = y * CELL;
    if (ghost) {
        c.strokeStyle = color;
        c.lineWidth = 2;
        c.strokeRect(px + 2, py + 2, CELL - 4, CELL - 4);
        return;
    }
    c.fillStyle = color;
    c.fillRect(px, py, CELL, CELL);
    c.fillStyle = "rgba(255,255,255,0.15)";
    c.fillRect(px, py, CELL, 3);
    c.fillRect(px, py, 3, CELL);
    c.fillStyle = "rgba(0,0,0,0.25)";
    c.fillRect(px, py + CELL - 3, CELL, 3);
    c.fillRect(px + CELL - 3, py, 3, CELL);
}

function drawGrid() {
    ctx.strokeStyle = "rgba(255,255,255,0.04)";
    ctx.lineWidth = 1;
    for (let x = 1; x < COLS; x++) {
        ctx.beginPath();
        ctx.moveTo(x * CELL + 0.5, 0);
        ctx.lineTo(x * CELL + 0.5, ROWS * CELL);
        ctx.stroke();
    }
    for (let y = 1; y < ROWS; y++) {
        ctx.beginPath();
        ctx.moveTo(0, y * CELL + 0.5);
        ctx.lineTo(COLS * CELL, y * CELL + 0.5);
        ctx.stroke();
    }
}

function drawBoard() {
    ctx.clearRect(0, 0, boardCanvas.width, boardCanvas.height);
    drawGrid();
    for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
            if (board[y][x]) drawCell(ctx, x, y, COLORS[board[y][x]]);
        }
    }
    if (current) {
        let ghostY = 0;
        while (!collides(current, 0, ghostY + 1)) ghostY++;
        for (let y = 0; y < current.shape.length; y++) {
            for (let x = 0; x < current.shape[y].length; x++) {
                if (!current.shape[y][x]) continue;
                const gy = current.y + y + ghostY;
                if (gy >= 0) drawCell(ctx, current.x + x, gy, COLORS[current.type], true);
            }
        }
        for (let y = 0; y < current.shape.length; y++) {
            for (let x = 0; x < current.shape[y].length; x++) {
                if (!current.shape[y][x]) continue;
                const py = current.y + y;
                if (py >= 0) drawCell(ctx, current.x + x, py, COLORS[current.type]);
            }
        }
    }
}

function drawNext() {
    nctx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
    if (!next) return;
    const shape = next.shape;
    const N = shape.length;
    const size = 24;
    let minX = N, maxX = -1, minY = N, maxY = -1;
    for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
            if (shape[y][x]) {
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }
    }
    const w = (maxX - minX + 1) * size;
    const h = (maxY - minY + 1) * size;
    const offX = (nextCanvas.width - w) / 2 - minX * size;
    const offY = (nextCanvas.height - h) / 2 - minY * size;
    for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
            if (!shape[y][x]) continue;
            const px = offX + x * size;
            const py = offY + y * size;
            nctx.fillStyle = COLORS[next.type];
            nctx.fillRect(px, py, size, size);
            nctx.fillStyle = "rgba(255,255,255,0.15)";
            nctx.fillRect(px, py, size, 2);
            nctx.fillRect(px, py, 2, size);
            nctx.fillStyle = "rgba(0,0,0,0.25)";
            nctx.fillRect(px, py + size - 2, size, 2);
            nctx.fillRect(px + size - 2, py, 2, size);
        }
    }
}

function updateStats() {
    scoreEl.textContent = score;
    levelEl.textContent = level;
    linesEl.textContent = lines;
}

// ---------- overlay / game flow ----------
function showOverlay(title, sub) {
    overlayTitle.textContent = title;
    overlaySub.textContent = sub;
    overlay.hidden = false;
}
function hideOverlay() { overlay.hidden = true; }

function triggerGameOver() {
    gameOver = true;
    showOverlay("GAME OVER", "R 키로 재시작");
    submitScore(); // 비동기로 점수 전송 → 최고점수 갱신
}

function reset() {
    board = emptyBoard();
    bag = [];
    score = 0;
    lines = 0;
    level = 1;
    gameOver = false;
    paused = false;
    scoreSubmitted = false;
    next = nextFromBag();
    current = nextFromBag();
    drawNext();
    updateStats();
    hideOverlay();
}

function loop(time) {
    if (lastTime === 0) lastTime = time;
    const dt = time - lastTime;
    lastTime = time;

    if (!gameOver && !paused) {
        dropAccum += dt;
        if (dropAccum >= dropInterval()) {
            dropAccum = 0;
            if (!collides(current, 0, 1)) {
                current.y++;
            } else {
                lockPiece();
            }
        }
    }
    drawBoard();
    requestAnimationFrame(loop);
}

// ---------- input ----------
document.addEventListener("keydown", (e) => {
    if (e.key === "r" || e.key === "R") {
        reset();
        return;
    }
    if (e.key === "p" || e.key === "P") {
        if (gameOver) return;
        paused = !paused;
        if (paused) showOverlay("PAUSED", "P 키로 계속");
        else hideOverlay();
        return;
    }
    if (gameOver || paused) return;

    switch (e.key) {
        case "ArrowLeft":  move(-1); break;
        case "ArrowRight": move(1);  break;
        case "ArrowDown":  softDrop(); dropAccum = 0; break;
        case "ArrowUp":    rotate(); break;
        case " ":          e.preventDefault(); hardDrop(); dropAccum = 0; break;
        default: return;
    }
    if (["ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp", " "].includes(e.key)) {
        e.preventDefault();
    }
});

reset();
requestAnimationFrame(loop);
