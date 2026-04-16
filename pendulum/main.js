const canvas = document.getElementById('simCanvas');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('status-overlay');
const statusText = document.getElementById('status-text');
const progressBar = document.getElementById('timer-bar');
const timerTextLabel = document.getElementById('timer-text');
const livesTextLabel = document.getElementById('lives-text');

// Modal Elements
const modal = document.getElementById('introModal');
const startBtn = document.getElementById('startGameBtn');
const helpBtn = document.getElementById('helpBtn');

// --- GAME CONFIG ---
const TARGET_TIME = 12.0; 
const MAX_ATTEMPTS = 3;
const MAX_TILT = 0.25;    
const GRAVITY = 0.2;      
const FRICTION = 0.98;    
const MOUSE_SENSITIVITY = 0.001; 
const KEY_SENSITIVITY = 0.01; 

const BOARD_W = 400;
const BOARD_H = 12;
const ZONE_W = 60; 
const BALL_R = 12;

// WIND
const WIND_CHANCE_BASE = 0.001; 
const WIND_CHANCE_ZONE_MULT = 100; 
const WIND_FORCE_MAX = 0.03; 
const WIND_DURATION_MIN = 30; 
const WIND_DURATION_VAR = 60; 

// --- INFO COLLECTION OBJECT ---
let info = {
    attempts: 0,
    outcomes: [], 
    attemptDurations: [],
    totalDuration: 0,
    mouseUpdates: 0,
    
    // Keystroke Tracking (Lists as requested)
    keysPressed: [], // List of keys (e.g., "ArrowLeft")
    keyTimes: [],    // List of timestamps relative to load
    keyActions: [],  // "down" or "up"
    
    // Detailed trajectory
    trajectory: { x: [], y: [], t: [] }, 
    snapshots5s: [] 
};

// --- STATE ---
let gameState = 'IDLE'; 
let isStageEnded = false;
let lives = MAX_ATTEMPTS;

let timeElapsed = 0; 
let attemptStartTime = 0;
let lastTime = 0;

let ballX = 0;
let ballVel = 0;
let boardAngle = 0;
let mouseX = 0; 

let keys = { ArrowLeft: false, ArrowRight: false };

let windActive = false;
let windForceCurrent = 0;
let windTimer = 0;

const pageLoadTime = Date.now();
let trackingInterval = null;
let snapshotInterval = null;

// --- MODAL CONTROLS ---
startBtn.addEventListener('click', () => {
    modal.classList.add('hidden');
});

helpBtn.addEventListener('click', () => {
    modal.classList.remove('hidden');
});

// --- INPUT LISTENERS ---

// 1. MOUSE / TOUCH
function handleMove(clientX) {
    if (gameState !== 'PLAYING') return;
    info.mouseUpdates++;
    
    const rect = canvas.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    let dist = (clientX - centerX);
    
    mouseX = clientX; 

    // Deadzone
    if(Math.abs(dist) < 20) dist *= 0.5; 
    
    boardAngle = dist * MOUSE_SENSITIVITY;
    clampAngle();
}

document.addEventListener('mousemove', (e) => handleMove(e.clientX));

document.addEventListener('touchmove', (e) => {
    e.preventDefault(); // Stop scrolling
    handleMove(e.touches[0].clientX);
}, { passive: false });


// 2. KEYBOARD
window.addEventListener('keydown', (e) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        if (!keys[e.key]) { 
            // Log Key Down
            info.keysPressed.push(e.key);
            info.keyTimes.push(Date.now() - pageLoadTime);
            info.keyActions.push("down");
        }
        keys[e.key] = true;
    }
});

window.addEventListener('keyup', (e) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        // Log Key Up
        info.keysPressed.push(e.key);
        info.keyTimes.push(Date.now() - pageLoadTime);
        info.keyActions.push("up");
        keys[e.key] = false;
    }
});

function clampAngle() {
    if (boardAngle > MAX_TILT) boardAngle = MAX_TILT;
    if (boardAngle < -MAX_TILT) boardAngle = -MAX_TILT;
}

statusText.addEventListener('click', () => {
    if(isStageEnded) return;
    startAttempt();
});

// --- TRACKING ---
function startTracking() {
    // Trajectory (10Hz)
    trackingInterval = setInterval(() => {
        if(isStageEnded) return;
        info.trajectory.x.push(Math.round(mouseX));
        info.trajectory.y.push(Number(boardAngle.toFixed(4))); 
        info.trajectory.t.push(Date.now() - pageLoadTime);
    }, 100);

    // 5s Snapshots
    snapshotInterval = setInterval(() => {
        if(isStageEnded) return;
        info.snapshots5s.push({
            mouseX: Math.round(mouseX),
            boardAngle: boardAngle.toFixed(4),
            ballPos: ballX.toFixed(2),
            time: Date.now() - pageLoadTime
        });
    }, 5000);
}

// --- GAME LOOP ---

function startAttempt() {
    gameState = 'PLAYING';
    ballX = BOARD_W / 2 - BALL_R * 2; // Start Right
    ballVel = 0;
    boardAngle = 0;
    timeElapsed = 0;
    windActive = false;
    windForceCurrent = 0;
    
    overlay.classList.remove('visible');
    progressBar.style.width = '0%';
    progressBar.style.backgroundColor = '#4caf50';
    updateInfoUI();

    attemptStartTime = Date.now();
    lastTime = performance.now();
    
    // Start tracking ONLY on the very first attempt
    if (info.attempts === 0) startTracking();

    requestAnimationFrame(loop);
}

function endAttempt(success) {
    gameState = 'IDLE';
    
    info.attempts++;
    info.outcomes.push(success ? "success" : "fail");
    info.attemptDurations.push((Date.now() - attemptStartTime)/1000);

    if (success) {
        statusText.innerText = "WELL DONE!";
        statusText.style.color = "#4caf50";
        statusText.style.borderColor = "#4caf50";
        progressBar.style.width = "100%";
        endStage(true);
    } else {
        lives--;
        updateInfoUI();
        
        if (lives <= 0) {
            statusText.innerText = "GAME OVER";
            statusText.style.color = "#ff5252";
            endStage(false);
        } else {
            statusText.innerText = "Dropped! Click to Retry";
            statusText.style.color = "#ff5252";
            statusText.style.borderColor = "#ff5252";
            progressBar.style.backgroundColor = "#ff5252";
        }
    }
    
    overlay.classList.add('visible');
}

function endStage(success) {
    isStageEnded = true;
    clearInterval(trackingInterval);
    clearInterval(snapshotInterval);
    info.totalDuration = (Date.now() - pageLoadTime) / 1000;

    console.log("--- SIMULATION ENDED ---");
    console.log("Result:", success ? "SUCCESS" : "FAIL");
    console.log("INFO OBJECT:", info);
}

function loop(timestamp) {
    if (gameState !== 'PLAYING') return;
    const dt = (timestamp - lastTime) / 16.66; 
    lastTime = timestamp;
    update(dt);
    draw();
    requestAnimationFrame(loop);
}

function update(dt) {
    // Keyboard Control
    if (keys.ArrowLeft) {
        boardAngle -= KEY_SENSITIVITY * dt;
        clampAngle();
    }
    if (keys.ArrowRight) {
        boardAngle += KEY_SENSITIVITY * dt;
        clampAngle();
    }

    // Wind Logic
    if (windActive) {
        windTimer -= dt;
        if (windTimer <= 0) {
            windActive = false;
            windForceCurrent = 0;
        }
    } else {
        let currentChance = WIND_CHANCE_BASE;
        
        // 100x More likely in Green Zone
        if (Math.abs(ballX) < ZONE_W / 2) {
            currentChance *= WIND_CHANCE_ZONE_MULT; 
        }

        if (Math.random() < currentChance * dt) {
            windActive = true;
            const dir = Math.random() > 0.5 ? 1 : -1;
            const strengthRatio = (0.7 + Math.random() * 0.3);
            windForceCurrent = dir * WIND_FORCE_MAX * strengthRatio;
            windTimer = WIND_DURATION_MIN + Math.random() * WIND_DURATION_VAR;
        }
    }

    // Physics
    const gravityAccel = Math.sin(boardAngle) * GRAVITY;
    ballVel += gravityAccel * dt;

    if(windActive) {
        ballVel += windForceCurrent * dt;
    }

    ballVel *= FRICTION;
    ballX += ballVel * dt;

    // Boundary Logic
    const edge = BOARD_W / 2;
    if (Math.abs(ballX) > edge + BALL_R) {
        endAttempt(false); 
        return;
    }

    // Zone Logic
    if (Math.abs(ballX) < ZONE_W / 2) {
        timeElapsed += (1/60) * dt; 
    }

    // UI
    const progress = Math.min((timeElapsed / TARGET_TIME) * 100, 100);
    progressBar.style.width = `${progress}%`;
    timerTextLabel.innerText = `${timeElapsed.toFixed(1)}s / ${TARGET_TIME.toFixed(1)}s`;

    if (timeElapsed >= TARGET_TIME) {
        endAttempt(true);
    }
}

function updateInfoUI() {
    livesTextLabel.innerText = `Lives: ${lives}`;
    timerTextLabel.innerText = `0.0s / ${TARGET_TIME.toFixed(1)}s`;
}

// --- RENDERING ---
function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    const cx = canvas.width / 2;
    const cy = canvas.height / 2 + 50; 

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(boardAngle);

    // Board
    ctx.fillStyle = '#555';
    ctx.fillRect(-BOARD_W/2, -BOARD_H/2, BOARD_W, BOARD_H);

    // Safe Zone
    ctx.fillStyle = 'rgba(76, 175, 80, 0.3)';
    ctx.fillRect(-ZONE_W/2, -BOARD_H/2, ZONE_W, BOARD_H);
    ctx.fillStyle = '#4caf50';
    ctx.fillRect(-ZONE_W/2 - 1, -BOARD_H/2 - 5, 2, BOARD_H + 10);
    ctx.fillRect(ZONE_W/2 - 1, -BOARD_H/2 - 5, 2, BOARD_H + 10);

    // Ball
    ctx.beginPath();
    ctx.arc(ballX, -BOARD_H/2 - BALL_R, BALL_R, 0, Math.PI * 2);
    const isSafe = Math.abs(ballX) < ZONE_W/2;
    ctx.fillStyle = isSafe ? '#2196F3' : '#FFC107'; 
    ctx.fill();
    
    // Shine
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.beginPath();
    ctx.arc(ballX - 3, -BOARD_H/2 - BALL_R - 3, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();

    // Pivot
    ctx.fillStyle = '#777';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx - 20, cy + 40);
    ctx.lineTo(cx + 20, cy + 40);
    ctx.fill();

    if (windActive) {
        drawWindIndicator(cx, cy - 100);
    }
}

function drawWindIndicator(x, y) {
    ctx.save();
    ctx.translate(x, y);

    const strengthRatio = Math.abs(windForceCurrent) / WIND_FORCE_MAX;
    const opacity = 0.4 + strengthRatio * 0.6;

    ctx.fillStyle = `rgba(255, 255, 255, ${opacity})`;
    ctx.strokeStyle = `rgba(255, 255, 255, ${opacity + 0.2})`;
    ctx.lineWidth = 4;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    const dir = Math.sign(windForceCurrent);
    const arrowSize = 40 + strengthRatio * 20;
    const arrowHeight = 25;

    ctx.beginPath();
    if (dir > 0) { 
        ctx.moveTo(-arrowSize, -arrowHeight/2);
        ctx.lineTo(0, -arrowHeight/2);
        ctx.lineTo(0, -arrowHeight);
        ctx.lineTo(arrowSize, 0);
        ctx.lineTo(0, arrowHeight);
        ctx.lineTo(0, arrowHeight/2);
        ctx.lineTo(-arrowSize, arrowHeight/2);
    } else { 
        ctx.moveTo(arrowSize, -arrowHeight/2);
        ctx.lineTo(0, -arrowHeight/2);
        ctx.lineTo(0, -arrowHeight);
        ctx.lineTo(-arrowSize, 0);
        ctx.lineTo(0, arrowHeight);
        ctx.lineTo(0, arrowHeight/2);
        ctx.lineTo(arrowSize, arrowHeight/2);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.font = "bold 18px Arial";
    ctx.textAlign = "center";
    const text = dir > 0 ? "WIND >>>" : "<<< WIND";
    ctx.fillText(text, 0, -arrowHeight - 8);

    ctx.restore();
}