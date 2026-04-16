const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const statusEl = document.getElementById('status');
const modal = document.getElementById('introModal');
const startBtn = document.getElementById('startGameBtn');
const helpBtn = document.getElementById('helpBtn');

// --- DATA TRACKING CONFIG ---
const TRACKING_INTERVAL_MS = 50; 
const MAX_ATTEMPTS = 3;

// --- GEOMETRY CONFIG ---
const CENTER = { x: 250, y: 250 };
const TRACK_RADIUS = 150; 
const TRACK_WIDTH = 60;   
const BALL_RADIUS = 15;   
const GAP_CENTER = Math.PI / 2; 
const GAP_OFFSET = 0.8;         
const START_ANGLE = GAP_CENTER + GAP_OFFSET; 
const END_ANGLE = GAP_CENTER - GAP_OFFSET;   

// --- STATE VARIABLES ---
let player = {
    x: 0,
    y: 0,
    angle: START_ANGLE,
    isHovering: false,
    isDragging: false,
    hasWon: false,
    isGameEnded: false 
};

let hasInteracted = false; 
let currentMouse = { x: 0, y: 0 };

// NEW: Duration Logic
let isAttemptActive = false; // Is a life currently being used?
let attemptStartTime = 0;    // When did this specific life start?

// --- INFO COLLECTION OBJECT ---
let info = {
    tries: 0,
    attemptDurations: [], // Time in seconds for each life
    totalDuration: 0,     // Total time on page
    mouseMoves: 0,       
    trajectory: { x: [], y: [], t: [] }
};

// Timing Variables
const pageLoadTime = Date.now();
let trackingIntervalId = null;

// --- INITIALIZATION ---
resetPlayer();
startTracking();

// --- MODAL CONTROLS ---
startBtn.addEventListener('click', () => { modal.classList.add('hidden'); });
helpBtn.addEventListener('click', () => { modal.classList.remove('hidden'); });

// --- INPUT LISTENERS ---
// We use a helper function to get Scaled Coordinates
function getScaledPos(evt) {
    const rect = canvas.getBoundingClientRect();
    // Calculate how much the canvas is scaled via CSS
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    let clientX, clientY;
    if (evt.touches && evt.touches.length > 0) {
        clientX = evt.touches[0].clientX;
        clientY = evt.touches[0].clientY;
    } else {
        clientX = evt.clientX;
        clientY = evt.clientY;
    }

    return {
        x: (clientX - rect.left) * scaleX,
        y: (clientY - rect.top) * scaleY
    };
}

canvas.addEventListener('mousedown', (e) => startDrag(getScaledPos(e)));
window.addEventListener('mouseup', endDrag);
window.addEventListener('mousemove', (e) => {
    info.mouseMoves++;
    const pos = getScaledPos(e);
    currentMouse = pos; // Update for tracker
    onMove(pos);
});

// Mobile Listeners
canvas.addEventListener('touchstart', (e) => {
    // e.preventDefault(); // Prevents scroll on touch start
    startDrag(getScaledPos(e));
}, { passive: false });

window.addEventListener('touchmove', (e) => {
    e.preventDefault(); // CRITICAL: Stop screen scrolling while dragging
    info.mouseMoves++; 
    const pos = getScaledPos(e);
    currentMouse = pos;
    onMove(pos);
}, { passive: false });

window.addEventListener('touchend', endDrag);

// --- TRACKING LOOP ---
function startTracking() {
    trackingIntervalId = setInterval(() => {
        if (player.isGameEnded) return;
        info.trajectory.x.push(Math.round(currentMouse.x));
        info.trajectory.y.push(Math.round(currentMouse.y));
        info.trajectory.t.push(Date.now() - pageLoadTime);
    }, TRACKING_INTERVAL_MS);
}

// --- CORE GAME LOGIC ---

function resetPlayer() {
    if (player.isGameEnded) return;

    const pos = getPolarPos(TRACK_RADIUS, START_ANGLE);
    player.x = pos.x;
    player.y = pos.y;
    player.angle = START_ANGLE;
    
    // Reset drag state, but we do NOT reset 'isAttemptActive' here
    // 'isAttemptActive' is only reset on fail or win.
    player.isDragging = false; 
    player.isHovering = false;
    
    // If we just failed, we force a hard reset of logic
    if (!isAttemptActive) {
        // Ready for a new life
    }
    
    updateStatus();
    updateCursor();
}

function startDrag(pos) {
    if (player.hasWon || player.isGameEnded) return;

    const dist = Math.hypot(pos.x - player.x, pos.y - player.y);
    
    if (dist <= BALL_RADIUS * 2.5) { // 2.5x radius makes it easier to grab on mobile
        player.isDragging = true;
        hasInteracted = true;
        
        // ** LOGIC FIX: **
        // If this is the start of a brand new attempt (life), start the timer.
        // If they just let go for a second and are grabbing it again, DO NOT reset timer.
        if (!isAttemptActive) {
            isAttemptActive = true;
            attemptStartTime = Date.now();
            setStatus("Attempt Started...", "status-ready");
        } else {
            // They are resuming an existing attempt
            setStatus("Resuming...", "status-ready");
        }
        
        updateCursor();
    }
}

function onMove(pos) {
    if (player.isGameEnded) return;

    // Cursor Visuals
    const distToBall = Math.hypot(pos.x - player.x, pos.y - player.y);
    const isHoveringNow = (distToBall <= BALL_RADIUS * 2.5);
    if (isHoveringNow !== player.isHovering) {
        player.isHovering = isHoveringNow;
        updateCursor();
    }

    if (!player.isDragging) return;

    // --- GEOMETRY CHECKS ---
    const dx = pos.x - CENTER.x;
    const dy = pos.y - CENTER.y;
    const distFromCenter = Math.hypot(dx, dy);
    let angle = Math.atan2(dy, dx);
    if (angle < 0) angle += Math.PI * 2; 

    // Zones
    const inStart = isInZone(pos.x, pos.y, START_ANGLE);
    const inEnd = isInZone(pos.x, pos.y, END_ANGLE);
    
    // Track Safety
    const minR = TRACK_RADIUS - (TRACK_WIDTH / 2) + BALL_RADIUS;
    const maxR = TRACK_RADIUS + (TRACK_WIDTH / 2) - BALL_RADIUS;
    
    let isSafe = (distFromCenter >= minR && distFromCenter <= maxR);
    // Gap check (Bottom)
    if (angle > END_ANGLE && angle < START_ANGLE) isSafe = false; 
    // Zone Override
    if (inStart || inEnd) isSafe = true;

    if (isSafe) {
        player.x = pos.x;
        player.y = pos.y;
        if (inEnd) winGame();
    } else {
        failGame();
    }
}

function endDrag() {
    // User let go of the mouse/finger.
    // We DO NOT fail them. We just stop moving the ball.
    // The timer 'attemptStartTime' continues to run.
    if(player.hasWon || player.isGameEnded) return;
    player.isDragging = false;
    updateCursor();
}

function failGame() {
    player.isDragging = false;
    
    // 1. END THE ATTEMPT LOGIC
    if (isAttemptActive) {
        info.tries++;
        const duration = (Date.now() - attemptStartTime) / 1000;
        info.attemptDurations.push(duration);
        isAttemptActive = false; // Stop the timer for this life
    }

    // 2. Check Lives
    if (info.tries >= MAX_ATTEMPTS) {
        setStatus("Game Over.", "status-fail");
        endStage(false); 
    } else {
        setStatus("Touched Wall! Resetting...", "status-fail");
        // Delay reset slightly to show the fail
        setTimeout(() => resetPlayer(), 800);
    }
}

function winGame() {
    player.hasWon = true;
    player.isDragging = false;
    
    // 1. END THE ATTEMPT LOGIC
    if (isAttemptActive) {
        info.tries++; 
        const duration = (Date.now() - attemptStartTime) / 1000;
        info.attemptDurations.push(duration);
        isAttemptActive = false;
    }

    // Snap to end visual
    const pos = getPolarPos(TRACK_RADIUS, END_ANGLE);
    player.x = pos.x;
    player.y = pos.y;
    
    setStatus("VERIFIED HUMAN", "status-success");
    updateCursor();
    
    endStage(true); 
}

function endStage(success) {
    player.isGameEnded = true;
    clearInterval(trackingIntervalId); 
    info.totalDuration = (Date.now() - pageLoadTime) / 1000;

    console.log("--- STAGE ENDED ---");
    console.log("Result:", success ? "SUCCESS" : "FAILURE");
    console.table(info)

    if(!success) {
        // Grey out screen
        ctx.fillStyle = "rgba(255,255,255,0.8)";
        ctx.fillRect(0,0,canvas.width, canvas.height);
    }
}

// --- HELPERS ---

function updateStatus() {
    const livesLeft = MAX_ATTEMPTS - info.tries;
    if (livesLeft > 0) {
        statusEl.innerText = `Status: Ready (Lives: ${livesLeft})`;
        statusEl.className = "status-ready";
    }
}

function setStatus(txt, cls) {
    const livesLeft = MAX_ATTEMPTS - info.tries;
    statusEl.innerText = `${txt} (Lives: ${livesLeft})`;
    statusEl.className = cls;
}

function updateCursor() {
    canvas.classList.remove('can-grab', 'is-grabbing');
    if (player.hasWon || player.isGameEnded) return;

    if (player.isDragging) {
        canvas.classList.add('is-grabbing');
    } else if (player.isHovering) {
        canvas.classList.add('can-grab');
    }
}

function getPolarPos(r, theta) {
    return {
        x: CENTER.x + r * Math.cos(theta),
        y: CENTER.y + r * Math.sin(theta)
    };
}

function isInZone(mx, my, theta) {
    const zonePos = getPolarPos(TRACK_RADIUS, theta);
    const dist = Math.hypot(mx - zonePos.x, my - zonePos.y);
    return dist < TRACK_WIDTH / 1.5;
}

// --- DRAW LOOP ---
function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Arch
    ctx.beginPath();
    ctx.arc(CENTER.x, CENTER.y, TRACK_RADIUS, START_ANGLE, END_ANGLE, false);
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = TRACK_WIDTH;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Zones
    const startPos = getPolarPos(TRACK_RADIUS, START_ANGLE);
    const endPos = getPolarPos(TRACK_RADIUS, END_ANGLE);

    ctx.beginPath(); ctx.arc(startPos.x, startPos.y, TRACK_WIDTH/2, 0, Math.PI*2);
    ctx.fillStyle = '#90CAF9'; ctx.fill();
    
    ctx.beginPath(); ctx.arc(endPos.x, endPos.y, TRACK_WIDTH/2, 0, Math.PI*2);
    ctx.fillStyle = '#A5D6A7'; ctx.fill();

    // Labels
    ctx.fillStyle = '#555';
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText("START", startPos.x, startPos.y);
    ctx.fillText("STOP", endPos.x, endPos.y);

    // Initial Arrow 
    if (!hasInteracted && !player.hasWon && !player.isGameEnded) {
        drawArrow(startPos.x - 80, startPos.y, startPos.x - BALL_RADIUS - 10, startPos.y);
    }

    // Player Ball
    ctx.beginPath();
    ctx.arc(player.x, player.y, BALL_RADIUS, 0, Math.PI*2);
    if (player.hasWon) ctx.fillStyle = '#2E7D32'; 
    else if (player.isDragging) ctx.fillStyle = '#2196F3'; 
    else ctx.fillStyle = '#ef5350'; 
    ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.stroke();

    requestAnimationFrame(draw);
}

function drawArrow(fromX, fromY, toX, toY) {
    const headlen = 15; 
    const angle = Math.atan2(toY - fromY, toX - fromX);
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.lineTo(toX - headlen * Math.cos(angle - Math.PI / 6), toY - headlen * Math.sin(angle - Math.PI / 6));
    ctx.moveTo(toX, toY);
    ctx.lineTo(toX - headlen * Math.cos(angle + Math.PI / 6), toY - headlen * Math.sin(angle + Math.PI / 6));
    ctx.strokeStyle = '#FFC107'; 
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
}

draw();