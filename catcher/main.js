const canvas = document.getElementById('catchCanvas');
const ctx = canvas.getContext('2d');
const titleEl = document.getElementById('title');
const scoreEl = document.getElementById('scoreDisplay');
const timerEl = document.getElementById('timerDisplay');
const instrEl = document.getElementById('instruction');
const modal = document.getElementById('introModal');
const startBtn = document.getElementById('startGameBtn');

// --- CONFIG ---
const GAME_DURATION = 30; 
const PASS_THRESHOLD = 5; 
const GRAVITY = 0.04;     
const WIND_STRENGTH = 3; 
const KEY_SPEED = 8;      
const SPAWN_RATE = 95;    
const BUCKET_WIDTH = 80;
const BUCKET_HEIGHT = 60;
const DROP_RADIUS = 8;

// --- STATE ---
let bucketX = 0;
let drops = [];
let score = 0;
let timeLeft = GAME_DURATION;
let isGameOver = false;
let isGameStarted = false;
let spawnTimer = 0;
let frameCount = 0; 
const pageLoadTime = Date.now();

// --- INFO COLLECTION ---
let info = {
    mouseUpdates: 0,
    keyPresses: 0,
    trajectory: { x: [], y: [], t: [] }, // Tracking Mouse
    keystrokes: [] // Tracking Keyboard
};

// Keyboard State
const keys = { ArrowLeft: false, ArrowRight: false };

// --- RESIZING ---
function resize() {
    const maxWidth = Math.min(window.innerWidth - 40, 600);
    const maxHeight = Math.min(window.innerHeight - 150, 500);
    canvas.width = maxWidth;
    canvas.height = maxHeight;
    bucketX = (canvas.width / 2) - (BUCKET_WIDTH / 2);
}
window.addEventListener('resize', resize);
resize();

// --- INPUT HANDLING ---

function recordMouse(x, y) {
    info.mouseUpdates++;
    info.trajectory.x.push(Math.round(x));
    info.trajectory.y.push(Math.round(y));
    info.trajectory.t.push(Date.now() - pageLoadTime);
}

function setBucketPos(clientX) {
    const rect = canvas.getBoundingClientRect();
    let x = clientX - rect.left - (BUCKET_WIDTH / 2);
    
    // Tracking
    recordMouse(clientX - rect.left, 0); // Y is 0 as we only care about X really
    
    // Bounds
    if (x < 0) x = 0;
    if (x > canvas.width - BUCKET_WIDTH) x = canvas.width - BUCKET_WIDTH;
    bucketX = x;
}

canvas.addEventListener('mousemove', (e) => { 
    if (isGameStarted && !isGameOver) {
        setBucketPos(e.clientX); 
    }
});

canvas.addEventListener('touchmove', (e) => {
    if (isGameStarted && !isGameOver) { 
        e.preventDefault(); 
        setBucketPos(e.touches[0].clientX); 
    }
}, { passive: false });

window.addEventListener('keydown', (e) => { 
    if(keys.hasOwnProperty(e.key)) {
        if (!keys[e.key]) {
            info.keyPresses++;
            info.keystrokes.push({ 
                key: e.key, 
                action: "down", 
                time: Date.now() - pageLoadTime 
            });
        }
        keys[e.key] = true; 
    }
});

window.addEventListener('keyup', (e) => { 
    if(keys.hasOwnProperty(e.key)) {
        info.keystrokes.push({ 
            key: e.key, 
            action: "up", 
            time: Date.now() - pageLoadTime 
        });
        keys[e.key] = false; 
    }
});

// --- GAME LOGIC ---
function spawnDrop() {
    const padding = 40; 
    drops.push({
        x: Math.random() * (canvas.width - padding * 2) + padding,
        y: -20,
        vy: 1.5 + Math.random(),      
        vx: (Math.random() - 0.5) * WIND_STRENGTH * 2
    });
}

function drawTeardrop(x, y, radius) {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI, false); 
    ctx.lineTo(x, y - radius * 2.5); 
    ctx.lineTo(x + radius, y); 
    ctx.fillStyle = '#2196F3'; 
    ctx.fill();
    ctx.closePath();
}

function endGame() {
    isGameOver = true;
    if (score >= PASS_THRESHOLD) {
        titleEl.innerText = "WELL DONE!";
        titleEl.style.color = "#4CAF50";
        instrEl.innerText = `Great job! You caught ${score} drops.`;
    } else {
        titleEl.innerText = "GAME OVER";
        titleEl.style.color = "#f44";
        instrEl.innerText = `You only caught ${score}. Refresh to try again.`;
    }
    
    // FINAL PRINT OUT
    console.log("--- CATCHER GAME ENDED ---");
    console.log("INFO OBJECT:", info);
}

function update() {
    if (!isGameStarted) return; // Wait for button press

    if (isGameOver) {
        draw(); 
        return;
    }

    // 1. Timer Logic
    if (frameCount % 60 === 0 && timeLeft > 0) {
        timeLeft--;
        timerEl.innerText = `Time: ${timeLeft}s`;
        if (timeLeft <= 0) {
            endGame();
        }
    }
    frameCount++;

    // 2. Input Logic (Keyboard Movement)
    if (keys.ArrowLeft) bucketX -= KEY_SPEED;
    if (keys.ArrowRight) bucketX += KEY_SPEED;
    if (bucketX < 0) bucketX = 0;
    if (bucketX > canvas.width - BUCKET_WIDTH) bucketX = canvas.width - BUCKET_WIDTH;

    // 3. Spawning
    spawnTimer++;
    if (spawnTimer > SPAWN_RATE) {
        spawnDrop();
        spawnTimer = 0;
    }

    // 4. Physics Loop
    for (let i = drops.length - 1; i >= 0; i--) {
        let d = drops[i];
        
        d.vy += GRAVITY; 
        d.y += d.vy;
        d.x += d.vx; 

        // Wall Bounce
        if (d.x <= 0 || d.x >= canvas.width) {
            d.vx *= -1; 
            if (d.x < 0) d.x = 0;
            if (d.x > canvas.width) d.x = canvas.width;
        }

        const bucketTop = canvas.height - BUCKET_HEIGHT;
        
        // Bucket Collision
        if (d.y > bucketTop && d.y < bucketTop + 30) { 
            if (d.x > bucketX && d.x < bucketX + BUCKET_WIDTH) {
                score++;
                drops.splice(i, 1);
                scoreEl.innerText = `Score: ${score}`;
                continue;
            }
        }

        // Missed
        if (d.y > canvas.height) {
            drops.splice(i, 1);
        }
    }

    draw();
    requestAnimationFrame(update);
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const bucketY = canvas.height - BUCKET_HEIGHT;

    // 1. Fill Level
    const fillRatio = Math.min(score / 40, 1);
    const fillHeight = (BUCKET_HEIGHT - 5) * fillRatio;
    
    if (score > 0) {
        ctx.fillStyle = '#2196F3';
        ctx.fillRect(bucketX + 5, (bucketY + BUCKET_HEIGHT) - fillHeight, BUCKET_WIDTH - 10, fillHeight);
    }

    // 2. Bucket Outline
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#555';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    ctx.beginPath();
    ctx.moveTo(bucketX, bucketY); 
    ctx.lineTo(bucketX + 5, bucketY + BUCKET_HEIGHT); 
    ctx.lineTo(bucketX + BUCKET_WIDTH - 5, bucketY + BUCKET_HEIGHT); 
    ctx.lineTo(bucketX + BUCKET_WIDTH, bucketY); 
    ctx.stroke();

    // 3. Drops
    for (let d of drops) {
        drawTeardrop(d.x, d.y, DROP_RADIUS);
    }

    // Game Over Overlay
    if (isGameOver) {
        ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        ctx.fillStyle = "#333";
        ctx.font = "bold 40px Arial";
        ctx.textAlign = "center";
        ctx.fillText("TIME UP!", canvas.width/2, canvas.height/2);
        
        ctx.font = "20px Arial";
        ctx.fillStyle = "#666";
        ctx.fillText(`Final Score: ${score}`, canvas.width/2, canvas.height/2 + 40);
    }
}

// Start Game Event
startBtn.addEventListener('click', () => {
    modal.classList.add('hidden');
    isGameStarted = true;
    update();
});

// Initial draw to show bucket
resize();
draw();