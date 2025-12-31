// 1. SETUP & CORE VARIABLES
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// --- MOBILE UI INJECTION ---
// This creates the buttons visually on your mobile screen
const mobileUI = document.createElement('div');
mobileUI.innerHTML = `
    <style>
        .mobile-ctrl { position: fixed; bottom: 20px; width: 100%; display: flex; justify-content: space-between; padding: 0 20px; z-index: 1000; pointer-events: none; }
        .ctrl-group { display: flex; gap: 10px; pointer-events: auto; }
        .btn { width: 70px; height: 70px; background: rgba(255,255,255,0.2); border: 2px solid white; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; user-select: none; -webkit-tap-highlight-color: transparent; }
        .btn:active { background: rgba(255,255,255,0.5); }
        @media (min-width: 800px) { .mobile-ctrl { display: none; } }
    </style>
    <div class="mobile-ctrl">
        <div class="ctrl-group">
            <div class="btn" id="m-left">←</div>
            <div class="btn" id="m-right">→</div>
        </div>
        <div class="ctrl-group">
            <div class="btn" id="m-nitro">N</div>
            <div class="btn" id="m-up">↑</div>
            <div class="btn" id="m-down">↓</div>
        </div>
    </div>
`;
document.body.appendChild(mobileUI);

// --- AUDIO SYSTEM START ---
const sounds = {
    music: new Audio('music.mp3'),
    engine: new Audio('engine.mp3'),
    nitro: new Audio('nitro.mp3'),
    bump: new Audio('bump.mp3'),
    crash: new Audio('crash.mp3')
};

// Setup Audio Properties
sounds.music.loop = true;
sounds.music.volume = 0.4;
sounds.engine.loop = true;
sounds.engine.volume = 0.2;
sounds.nitro.volume = 0.6;
sounds.bump.volume = 0.8;
sounds.crash.volume = 0.8;

function playSound(name) {
    if (sounds[name]) {
        if (name !== 'music' && name !== 'engine') {
            sounds[name].currentTime = 0;
        }
        sounds[name].play().catch(e => console.log("Audio waiting for interaction"));
    }
}
// --- AUDIO SYSTEM END ---

const RACE_LENGTH = 15000;
let ROAD_WIDTH = 280;

let gameState = 'MENU';
let selectedMode = 'RACING';
let countdownValue = 3;
let countdownTimer = null;

let cameraY = 0;
let shakeAmount = 0;
let gameFrame = 0;
let startTime = 0;
let finalTimeText = "00:00";

let player;
let bots = [];
let particles = [];

// 2. RESPONSIVE ENGINE
function resize() {
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    ROAD_WIDTH = canvas.width * 0.5;
}
window.addEventListener('load', resize);
window.addEventListener('resize', resize);

const keys = { ArrowUp: false, ArrowDown: false, ArrowLeft: false, ArrowRight: false, Shift: false };
window.addEventListener('keydown', e => { if(keys.hasOwnProperty(e.key)) keys[e.key] = true; });
window.addEventListener('keyup', e => { if(keys.hasOwnProperty(e.key)) keys[e.key] = false; });

// --- MOBILE CONTROLS LOGIC ---
const setupMobileBtn = (id, keyName) => {
    const el = document.getElementById(id);
    el.addEventListener('touchstart', (e) => { e.preventDefault(); keys[keyName] = true; });
    el.addEventListener('touchend', (e) => { e.preventDefault(); keys[keyName] = false; });
};
setupMobileBtn('m-left', 'ArrowLeft');
setupMobileBtn('m-right', 'ArrowRight');
setupMobileBtn('m-up', 'ArrowUp');
setupMobileBtn('m-down', 'ArrowDown');
setupMobileBtn('m-nitro', 'Shift');

// 3. MENU NAVIGATION
window.showModeSelect = function(mode) {
    selectedMode = mode;
    document.getElementById('main-menu').classList.add('hidden');
    document.getElementById('car-select').classList.remove('hidden');
    const title = document.getElementById('car-select-title');
    if(title) {
        if(mode === 'COLOR_STEAL') {
            title.innerText = "COLOR STEAL: CHOOSE YOUR THIEF";
            title.style.color = "#9b59b6";
        } else {
            title.innerText = "SELECT CLASS";
            title.style.color = "white";
        }
    }
};

window.showMainMenu = function() {
    gameState = 'MENU';
    document.getElementById('menu-layer').classList.remove('hidden');
    document.getElementById('main-menu').classList.remove('hidden');
    document.getElementById('car-select').classList.add('hidden');  
    document.getElementById('game-over').classList.add('hidden');
    document.getElementById('hud').classList.add('hidden');
   
    // Stop all game sounds
    sounds.music.pause();
    sounds.music.currentTime = 0;
    sounds.engine.pause();
    sounds.nitro.pause();
};

// 4. PARTICLE SYSTEM
class Particle {
    constructor(x, y, color, speed, angle) {
        this.x = x; this.y = y;
        this.color = color;
        this.vx = Math.cos(angle) * speed;
        this.vy = Math.sin(angle) * speed;
        this.life = 1.0;
        this.decay = Math.random() * 0.03 + 0.02;
    }
    update() {
        this.x += this.vx;
        this.y += this.vy;
        this.life -= this.decay;
    }
    draw(camY) {
        if (this.y - camY > canvas.height + 50 || this.y - camY < -50) return;
        ctx.save();
        ctx.globalAlpha = this.life;
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(this.x, this.y - camY, 3, 0, Math.PI*2);
        ctx.fill();
        ctx.restore();
    }
}

// 5. ENVIRONMENT & HAZARDS
const decorations = [];
const oilSpills = [];

for (let y = -RACE_LENGTH - 1000; y < 1000; y += 80) {
    if (Math.random() > 0.3) decorations.push({ y: y, side: -1, type: Math.random() > 0.8 ? 'rock' : 'tree' });
    if (Math.random() > 0.3) decorations.push({ y: y, side: 1, type: Math.random() > 0.8 ? 'rock' : 'tree' });
   
    if (y < -500 && Math.random() > 0.94) {
        oilSpills.push({
            y: y,
            xOffset: (Math.random() - 0.5) * (ROAD_WIDTH * 0.7),
            w: 60 + Math.random() * 40,
            h: 40 + Math.random() * 20
        });
    }
}

function getRoadCenter(y) {
    return (canvas.width / 2) + (Math.sin(y * 0.003) * (canvas.width * 0.25)) + (Math.sin(y * 0.01) * 30);
}

// 6. CAR CLASS
class Car {
    constructor(x, y, color, isPlayer, difficulty = 1) {
        this.x = x; this.y = y;
        this.w = 34; this.h = 60;
        this.color = color;
        this.isPlayer = isPlayer;
        this.angle = 0;
        this.speed = 0;
        this.nitro = 100;
        this.isBoosting = false;
        this.respawnTimer = 0;
        this.oilImmuneTimer = 0;

        if (!isPlayer) {
            this.maxSpeed = 15 + (Math.random() * 3 * difficulty);
            this.lookAhead = 150 + (Math.random() * 100);
            this.aggression = 0.5 + (Math.random() * 0.5);
            this.lanePreference = (Math.random() - 0.5) * (ROAD_WIDTH * 0.4);
            this.steerSmoothness = 0.001 + (Math.random() * 0.001);
        } else {
            this.maxSpeed = 16;
        }
    }

    update() {
        if (gameState === 'COUNTDOWN') return false;
       
        if (this.oilImmuneTimer > 0) this.oilImmuneTimer--;

        if (this.respawnTimer > 0) {
            this.respawnTimer--;
            this.speed = 0;
            if (this.respawnTimer === 1) {
                this.y -= 150;
                this.x = getRoadCenter(this.y);
                this.angle = 0;
                this.speed = 8;
                this.oilImmuneTimer = 120;
            }
            return false;
        }

        let isOffRoad = false;

        if (this.isPlayer) {
            let topSpeed = this.maxSpeed;
           
            if (keys['Shift'] && this.nitro > 0) {
                topSpeed = 24; this.nitro -= 1.2;
                particles.push(new Particle(this.x, this.y + 30, '#00ffff', 4, Math.PI/2 + (Math.random()-0.5)));
                if (sounds.nitro.paused) playSound('nitro');
            } else {
                if (this.nitro < 100) this.nitro += 0.25;
                sounds.nitro.pause();
                sounds.nitro.currentTime = 0;
            }

            if (keys['ArrowUp']) this.speed += 0.35;
            else this.speed *= 0.98;
            if (keys['ArrowDown']) this.speed -= 0.5;

            if (Math.abs(this.speed) > 1) {
                let turnPower = 0.075;
                if (keys['ArrowLeft']) this.angle -= turnPower;
                if (keys['ArrowRight']) this.angle += turnPower;
            }

            let pitch = 0.5 + (Math.abs(this.speed) / 24) * 1.5;
            sounds.engine.playbackRate = Math.max(0.5, Math.min(pitch, 3.0));

        } else {
            this.speed += 0.35;
            let futureY = this.y - this.lookAhead;
            let targetX = getRoadCenter(futureY) + this.lanePreference;
            let diff = targetX - this.x;
            this.angle += diff * this.steerSmoothness;
            this.angle *= 0.92;

            let playerDist = player ? player.y - this.y : 0;
            let roadCurvature = Math.abs(getRoadCenter(this.y) - getRoadCenter(this.y - 400));
            const shouldBoost = (playerDist < -200) || (roadCurvature < 60) || (this.nitro > 80 && Math.random() < 0.05);

            if (this.nitro > 5 && shouldBoost) {
                this.isBoosting = true;
                this.nitro -= 1.0;
                if (gameFrame % 2 === 0) particles.push(new Particle(this.x, this.y + 30, '#ff4400', 4, Math.PI/2));
            } else {
                this.isBoosting = false;
                if (this.nitro < 100) this.nitro += 0.3;
            }
        }

        let currentMax = (this.isPlayer && keys['Shift'] && this.nitro > 0) ? 24 : (this.isBoosting ? 23 : this.maxSpeed);
        this.speed = Math.min(this.speed, currentMax);
        this.speed = Math.max(this.speed, -4);
       
        this.x += Math.sin(this.angle) * this.speed;
        this.y -= Math.cos(this.angle) * this.speed;

        let cx = getRoadCenter(this.y);
        if (this.x < cx - ROAD_WIDTH/2 || this.x > cx + ROAD_WIDTH/2) {
            this.speed *= 0.94; isOffRoad = true;
        }

        oilSpills.forEach(oil => {
            let oilX = getRoadCenter(oil.y) + oil.xOffset;
            if (Math.abs(this.y - oil.y) < 30 && Math.abs(this.x - oilX) < oil.w/2) {
                if (this.respawnTimer <= 0 && this.oilImmuneTimer <= 0) {
                    playSound('crash');
                    this.respawnTimer = 60;
                    shakeAmount = this.isPlayer ? 20 : shakeAmount;
                    for(let i=0; i<15; i++) particles.push(new Particle(this.x, this.y, 'white', 6, Math.random()*Math.PI*2));
                }
            }
        });

        return isOffRoad;
    }

    draw(camY) {
        if (this.respawnTimer > 0) return;
        if (this.y - camY < -100 || this.y - camY > canvas.height + 100) return;
        ctx.save();
        ctx.translate(this.x, this.y - camY);
        if (this.oilImmuneTimer > 0) ctx.globalAlpha = 0.5;
        ctx.rotate(this.angle);
        ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(-18, -20, 36, 70);
        ctx.fillStyle = '#111';
        ctx.fillRect(-18, -25, 8, 14); ctx.fillRect(10, -25, 8, 14);
        ctx.fillRect(-18, 15, 8, 14); ctx.fillRect(10, 15, 8, 14);
        ctx.fillStyle = this.color;
        ctx.beginPath(); ctx.moveTo(-15, -30); ctx.lineTo(15, -30); ctx.lineTo(17, 30); ctx.lineTo(-17, 30); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.fillRect(-5, -30, 10, 60);
        ctx.fillStyle = '#1abc9c'; ctx.beginPath(); ctx.moveTo(-13, -15); ctx.lineTo(13, -15); ctx.lineTo(14, -5); ctx.lineTo(-14, -5); ctx.fill();
        ctx.fillStyle = '#c0392b'; ctx.fillRect(-18, 25, 36, 6);
        ctx.fillStyle = '#f1c40f'; ctx.fillRect(-14, -31, 6, 4); ctx.fillRect(8, -31, 6, 4);
        if (this.isBoosting) {
            ctx.fillStyle = 'orange'; ctx.shadowBlur = 15; ctx.shadowColor = 'orange';
            ctx.fillRect(-14, 28, 28, 4);
        }
        ctx.restore();
    }
}

// 7. GAME LOGIC
function formatTime(ms) {
    let totalSeconds = Math.floor(ms / 1000);
    let mins = Math.floor(totalSeconds / 60);
    let secs = totalSeconds % 60;
    let mili = Math.floor((ms % 1000) / 10);
    return `${mins < 10 ? '0'+mins : mins}:${secs < 10 ? '0'+secs : secs}:${mili < 10 ? '0'+mili : mili}`;
}

function startGame(color) {
    let hex = color === 'red' ? '#e74c3c' : (color === 'blue' ? '#3498db' : '#f1c40f');
    resize();
    let center = canvas.width / 2;
   
    player = new Car(center, 0, hex, true);
    bots = [
        new Car(center - 100, 0, '#8e44ad', false, 1.2),
        new Car(center - 50, 0, '#27ae60', false, 1.3),
        new Car(center + 50, 0, '#e67e22', false, 1.5),
        new Car(center + 100, 0, '#ff00ff', false, 1.4)
    ];

    // --- MODE SPECIFIC SETUP ---
    if (selectedMode === 'COLOR_STEAL') {
        document.getElementById('position').style.display = 'none';
        document.getElementById('progress-text').style.display = 'none';
        player.x = canvas.width / 2;
        player.y = 0;
    } else {
        document.getElementById('position').style.display = 'block';
        document.getElementById('progress-text').style.display = 'block';
    }

    gameState = 'COUNTDOWN';
    countdownValue = 3;
    document.getElementById('menu-layer').classList.add('hidden');
    document.getElementById('hud').classList.remove('hidden');

    if(countdownTimer) clearInterval(countdownTimer);
   
    playSound('music');
    playSound('engine');

    countdownTimer = setInterval(() => {
        countdownValue--;
        if (countdownValue < 0) {
            clearInterval(countdownTimer);
            gameState = 'PLAY';
            startTime = Date.now();
        }
    }, 1000);
}

function update() {
    if (gameState !== 'PLAY' && gameState !== 'COUNTDOWN') return;
    gameFrame++;
    if (shakeAmount > 0) shakeAmount *= 0.9;
    let offRoad = player.update();
    if(offRoad && shakeAmount < 2) shakeAmount = 2;
   
    // Only update bots if we are in racing mode
    if (selectedMode === 'RACING') {
        bots.forEach(b => b.update());
    }
   
    if (gameState === 'PLAY' && selectedMode === 'RACING') {
        let allCars = [player, ...bots];
        for(let i=0; i<allCars.length; i++){
            for(let j=i+1; j<allCars.length; j++){
                let c1 = allCars[i]; let c2 = allCars[j];
                if (c1.respawnTimer > 0 || c2.respawnTimer > 0) continue;
                let dist = Math.hypot(c1.x - c2.x, c1.y - c2.y);
                if (dist < 36) {
                    let angle = Math.atan2(c2.y - c1.y, c2.x - c1.x);
                    c1.x -= Math.cos(angle) * 5; c1.y -= Math.sin(angle) * 5;
                    c2.x += Math.cos(angle) * 5; c2.y += Math.sin(angle) * 5;
                    c1.speed *= 0.8; c2.speed *= 0.8;
                    shakeAmount = 10;
                    playSound('bump');
                    for(let k=0; k<5; k++) particles.push(new Particle((c1.x+c2.x)/2, (c1.y+c2.y)/2, 'orange', 5, Math.random()*Math.PI*2));
                }
            }
        }
    }
   
    let targetCamY = player.y - canvas.height * 0.75;
    cameraY += (targetCamY - cameraY) * 0.1;
    particles.forEach(p => p.update());
    particles = particles.filter(p => p.life > 0);
   
    // End condition only matters for racing
    if (selectedMode === 'RACING' && player.y < -RACE_LENGTH) {
        gameState = 'GAMEOVER';
        sounds.engine.pause();
        document.getElementById('menu-layer').classList.remove('hidden');
        document.getElementById('game-over').classList.remove('hidden');
        document.getElementById('hud').classList.add('hidden');
        document.getElementById('final-time').innerText = "TIME: " + finalTimeText;
    }
}

function draw() {
    ctx.save();
    if (shakeAmount > 0.5) ctx.translate((Math.random()-0.5)*shakeAmount, (Math.random()-0.5)*shakeAmount);
   
    // Background based on mode
    if (selectedMode === 'COLOR_STEAL') {
        ctx.fillStyle = '#ffffff';
    } else {
        ctx.fillStyle = '#0a2f15';
    }
    ctx.fillRect(0, 0, canvas.width, canvas.height);
   
    if (gameState === 'PLAY' || gameState === 'COUNTDOWN') {
       
        // ONLY draw world if NOT Color Steal
        if (selectedMode === 'RACING') {
            let startY = Math.floor(cameraY / 20) * 20;
            let endY = startY + canvas.height + 200;
           
            for (let y = startY; y < endY; y += 20) {
                let cx = getRoadCenter(y);
                let cxNext = getRoadCenter(y+20);
                ctx.fillStyle = (Math.floor(y/60)%2===0) ? '#c0392b' : '#ecf0f1';
                ctx.beginPath(); ctx.moveTo(cx - ROAD_WIDTH/2 - 15, y - cameraY); ctx.lineTo(cx + ROAD_WIDTH/2 + 15, y - cameraY);
                ctx.lineTo(cxNext + ROAD_WIDTH/2 + 15, y+20 - cameraY); ctx.lineTo(cxNext - ROAD_WIDTH/2 - 15, y+20 - cameraY); ctx.fill();
                ctx.fillStyle = '#34495e';
                ctx.beginPath(); ctx.moveTo(cx - ROAD_WIDTH/2, y - cameraY); ctx.lineTo(cx + ROAD_WIDTH/2, y - cameraY);
                ctx.lineTo(cxNext + ROAD_WIDTH/2, y+20 - cameraY); ctx.lineTo(cxNext - ROAD_WIDTH/2, y+20 - cameraY); ctx.fill();
                if (Math.floor(y/60)%2===0) {
                    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 4;
                    ctx.beginPath(); ctx.moveTo(cx, y - cameraY); ctx.lineTo(cxNext, y+20 - cameraY); ctx.stroke();
                }
            }
           
            let startCX = getRoadCenter(0);
            ctx.fillStyle = 'white';
            ctx.fillRect(startCX - ROAD_WIDTH/2, 0 - cameraY - 10, ROAD_WIDTH, 20);
           
            oilSpills.forEach(oil => {
                if (oil.y > startY && oil.y < endY) {
                    let oilX = getRoadCenter(oil.y) + oil.xOffset;
                    ctx.fillStyle = '#111';
                    ctx.beginPath(); ctx.ellipse(oilX, oil.y - cameraY, oil.w/2, oil.h/2, 0, 0, Math.PI*2); ctx.fill();
                    ctx.fillStyle = 'rgba(255,255,255,0.1)';
                    ctx.beginPath(); ctx.ellipse(oilX - 10, oil.y - cameraY - 5, oil.w/4, oil.h/4, 0, 0, Math.PI*2); ctx.fill();
                }
            });

            decorations.forEach(d => {
                if (d.y > startY && d.y < endY) {
                    let roadCX = getRoadCenter(d.y);
                    let x = roadCX + (d.side * (ROAD_WIDTH/2 + 80));
                    let screenY = d.y - cameraY;
                    if (d.type === 'tree') {
                        ctx.fillStyle = '#2ecc71'; ctx.beginPath(); ctx.arc(x, screenY, 30, 0, Math.PI*2); ctx.fill();
                        ctx.fillStyle = '#27ae60'; ctx.beginPath(); ctx.arc(x-5, screenY-5, 20, 0, Math.PI*2); ctx.fill();
                    } else {
                        ctx.fillStyle = '#7f8c8d'; ctx.beginPath(); ctx.moveTo(x, screenY-10); ctx.lineTo(x+20, screenY+10); ctx.lineTo(x-20, screenY+10); ctx.fill();
                    }
                }
            });

            if (-RACE_LENGTH > cameraY && -RACE_LENGTH < cameraY + canvas.height) {
                let cx = getRoadCenter(-RACE_LENGTH); let sy = -RACE_LENGTH - cameraY;
                for(let i=0; i<10; i++) { ctx.fillStyle = i%2===0 ? '#fff' : '#000'; ctx.fillRect(cx - ROAD_WIDTH/2 + (i*(ROAD_WIDTH/10)), sy, ROAD_WIDTH/10, 40); }
            }
        }

        particles.forEach(p => p.draw(cameraY));
        player.draw(cameraY);

        if (selectedMode === 'RACING') {
            bots.forEach(b => b.draw(cameraY));
        }

        if(gameState === 'PLAY') {
            let currentTime = Date.now() - startTime;
            finalTimeText = formatTime(currentTime);
            document.getElementById('timer').innerText = finalTimeText;
        }

   
        if (selectedMode === 'RACING') {
            let percent = Math.min(100, Math.max(0, Math.floor((Math.abs(player.y) / RACE_LENGTH) * 100)));
            document.getElementById('progress-text').innerText = percent + "%";
            let rank = bots.filter(b => b.y < player.y).length + 1;
            document.getElementById('position').innerText = `POS: ${rank}/4`;
        }
       
        document.getElementById('speedometer').innerHTML = `${Math.floor(player.speed * 20)} <span class="unit">KM/H</span>`;
        document.getElementById('nitro-fill').style.width = `${player.nitro}%`;

        if (gameState === 'COUNTDOWN') {
            ctx.fillStyle = 'rgba(0,0,0,0.3)';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = selectedMode === 'COLOR_STEAL' ? 'black' : 'white';
            ctx.font = 'bold 120px Orbitron';
            ctx.textAlign = 'center';
            let displayVal = countdownValue === 0 ? "GO!" : countdownValue;
            ctx.fillText(displayVal, canvas.width/2, canvas.height/2);
        }
    }
    ctx.restore();
    requestAnimationFrame(gameLoop);
}

function gameLoop() { update(); draw(); }
gameLoop();

// --- FINAL TOUCH BINDING ENGINE ---
const setupMobileControls = () => {
    const mobileStyles = document.createElement('style');
    mobileStyles.innerHTML = `
        .touch-controls { 
            position: absolute; bottom: 30px; left: 50%; transform: translateX(-50%); 
            width: 100%; max-width: 600px; display: flex; justify-content: space-around; 
            align-items: center; z-index: 10000; pointer-events: none; 
        }
        .ctrl-set { display: flex; gap: 15px; pointer-events: auto; }
        .speed-set { flex-direction: column; gap: 5px; }
        .t-btn { 
            width: 80px; height: 80px; background: rgba(255,255,255,0.2); 
            border: 3px solid white; border-radius: 15px; display: flex; 
            align-items: center; justify-content: center; color: white; 
            font-weight: bold; user-select: none; touch-action: none; 
            -webkit-tap-highlight-color: transparent; font-size: 30px;
        }
        .t-btn:active { background: rgba(0, 255, 0, 0.4); scale: 0.9; }
        #b-nitro { 
            width: 100px; height: 60px; background: rgba(0, 255, 255, 0.3); 
            border-color: #00ffff; font-size: 16px; border-radius: 40px;
        }
    `;
    document.head.appendChild(mobileStyles);

    const touchUI = document.createElement('div');
    touchUI.className = 'touch-controls';
    touchUI.innerHTML = `
        <div class="ctrl-set">
            <div class="t-btn" id="b-left">◀</div>
            <div class="t-btn" id="b-right">▶</div>
        </div>
        <div class="ctrl-set">
            <div class="t-btn" id="b-nitro">NITRO</div>
        </div>
        <div class="ctrl-set speed-set">
            <div class="t-btn" id="b-up">▲</div>
            <div class="t-btn" id="b-down">▼</div>
        </div>
    `;
    document.body.appendChild(touchUI);

    // This function binds the visual buttons to your existing 'keys' object
    const bind = (id, keyName) => {
        const btn = document.getElementById(id);
        
        const startAction = (e) => {
            e.preventDefault();
            keys[keyName] = true; // This triggers the movement logic in your Car class
        };
        
        const stopAction = (e) => {
            e.preventDefault();
            keys[keyName] = false; // This stops the movement
        };

        // Standard touch events for mobile
        btn.addEventListener('touchstart', startAction, {passive: false});
        btn.addEventListener('touchend', stopAction, {passive: false});
        btn.addEventListener('touchcancel', stopAction, {passive: false});
        
        // Mouse events for testing on laptop with clicks
        btn.addEventListener('mousedown', startAction);
        btn.addEventListener('mouseup', stopAction);
        btn.addEventListener('mouseleave', stopAction);
    };

    // BINDING TO YOUR EXACT KEYS
    bind('b-left', 'ArrowLeft');
    bind('b-right', 'ArrowRight');
    bind('b-up', 'ArrowUp');
    bind('b-down', 'ArrowDown');
    bind('b-nitro', 'Shift');
};

// Run the setup
setupMobileControls();