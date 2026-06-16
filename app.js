/**
 * Client Controller: app.js
 * Role: Player Kiosk Node.
 * Manages the state machine (Attract -> Register -> Countdown -> Play -> Results).
 * Spawns tap targets inside a game arena and executes hit/miss scoring
 * and real-time Web Audio sound synthesis.
 * 
 * CSE443 Assignment 2 2025/2026 Kiosk Game
 * Note: Key algorithms are heavily annotated for drawing Control Flow Graphs (CFGs)
 * and analyzing Statement/Branch coverage.
 */

// ==========================================
// GLOBALS & CONFIGURATION STATE
// ==========================================
let ws = null;
let localScore = 0;
let consecutiveHits = 0;
let maxCombo = 0;
let myUsername = "";
let latencyStart = 0;
let latencyTimer = null;
let reconnectTimer = null;
let latestLeaderboard = [];

// Gameplay timers
let gameTimerInterval = null;
let resultsTimerInterval = null;
let timeLeft = 0; // seconds remaining in game (starts at 20)
const GAME_DURATION = 20; // 20-second gameplay sessions

// State variables for combo tracker
let tapTimes = [];
let comboTimer = null;

// Resolve network URLs dynamically based on current deployment environment
const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsUrl = window.location.host ? `${protocol}//${window.location.host}` : 'ws://localhost:3000';

// Web Audio API context
let audioCtx = null;

// ==========================================
// DOM ELEMENT REFERENCING
// ==========================================
// Screens / Overlays
const attractScreen = document.getElementById('attract-screen');
const registerScreen = document.getElementById('register-screen');
const countdownScreen = document.getElementById('countdown-screen');
const resultsScreen = document.getElementById('results-screen');
const gameScreen = document.getElementById('game-screen');

// Interactive elements
const attractStartBtn = document.getElementById('attract-start-btn');
const usernameInput = document.getElementById('username-input');
const randomUsernameBtn = document.getElementById('random-username-btn');
const joinForm = document.getElementById('join-form');
const targetArena = document.getElementById('target-arena');
const gameTimerFill = document.getElementById('game-timer-fill');
const currentScore = document.getElementById('current-score');
const resultsSubmitBtn = document.getElementById('results-submit-btn');

// Header statuses
const currentPlayerName = document.getElementById('current-player-name');
const playerCount = document.getElementById('player-count');
const latencyVal = document.getElementById('latency-val');
const statusText = document.getElementById('status-text');
const leaderboardList = document.getElementById('leaderboard-list');
const eventTicker = document.getElementById('event-ticker');
const audioToggle = document.getElementById('audio-toggle');

// Results elements
const resultsRunner = document.getElementById('results-runner');
const resultsScoreVal = document.getElementById('results-score');
const resultsComboVal = document.getElementById('results-combo');
const resultsRankVal = document.getElementById('results-rank');

// ==========================================
// KIOSK STATE ROUTER
// ==========================================
/**
 * Switches between active user journey screens.
 * @param {string} state - The target view ('attract', 'register', 'countdown', 'playing', 'results')
 */
function transitionToState(state) {
    // Hide all overlays/screens first
    attractScreen.style.display = 'none';
    registerScreen.style.display = 'none';
    countdownScreen.style.display = 'none';
    resultsScreen.style.display = 'none';
    gameScreen.classList.remove('dashboard-active');

    switch (state) {
        case 'attract':
            attractScreen.style.display = 'flex';
            break;

        case 'register':
            registerScreen.style.display = 'flex';
            usernameInput.value = '';
            usernameInput.focus();
            break;

        case 'countdown':
            countdownScreen.style.display = 'flex';
            window.scrollTo(0, 0); // Scroll to top immediately when countdown starts
            runGameCountdown();
            break;

        case 'playing':
            gameScreen.classList.add('dashboard-active');
            window.scrollTo(0, 0); // Scroll to top immediately when game active
            startGameSession();
            break;

        case 'results':
            resultsScreen.style.display = 'flex';
            resultsRunner.innerText = `Runner ID: ${myUsername}`;
            resultsScoreVal.innerText = localScore;
            resultsComboVal.innerText = maxCombo;
            updateResultsRanking();
            break;
    }
}

// ==========================================
// ALGORITHM FOR COVERAGE METRICS: detectCombo
// ==========================================
/**
 * Tracks consecutive target hits within a rolling window to detect a combo event.
 * Uses counters and timeout interrupts structured for Branch/Statement coverage testing.
 * 
 * @param {number} currentTapTime - Epoch timestamp of the tap event (Date.now())
 * @param {boolean} isHit - Flag showing if the tap landed on the target
 * @returns {boolean} - True if a combo alert was triggered
 */
function detectCombo(currentTapTime, isHit) {
    // Path A: Check if the tap is a miss
    if (!isHit) {
        console.log("[CFG Path: Miss Reset] Consecutive hits broken. Resetting combo sequence.");
        resetComboTracker("miss");
        return false;
    }

    // Path B: Proceed with hit logging
    console.log("[CFG Path: Hit Check] Logging hit to queue.");
    tapTimes.push(currentTapTime);

    // Path C: Check if this is the first hit of the current sequence
    if (tapTimes.length === 1) {
        console.log("[CFG Path: First Combo Hit] Sequence started. Scheduling 3000ms window interrupt.");
        
        // Start a 3-second sliding window timer interrupt
        comboTimer = setTimeout(function() {
            console.log("[CFG Path: Timer Interrupt] 3000ms window expired. Resetting combo count.");
            resetComboTracker("timeout");
        }, 3000);

        updateComboUI(1);
        return false;
    } 
    // Path D: If sequence already contains hits
    else {
        const duration = currentTapTime - tapTimes[0];

        // Path E: Check if hits are within the 3000ms window threshold
        if (duration <= 3000) {
            // Path F: Check if target combo count of exactly 5 is reached
            if (tapTimes.length === 5) {
                console.log("[CFG Path: Combo Success] 5 consecutive hits in under 3s!");
                
                // Clear the timer interrupt so it doesn't clear the success UI
                clearTimeout(comboTimer);
                comboTimer = null;

                triggerComboEffects();
                resetComboTracker("success");
                return true;
            } 
            // Path G: Increment count, not yet at 5 hits
            else {
                console.log(`[CFG Path: Accumulating Hits] Consecutive hits: ${tapTimes.length}`);
                updateComboUI(tapTimes.length);
                return false;
            }
        } 
        // Path H: Duration exceeded 3 seconds
        else {
            console.log("[CFG Path: Window Exceeded] Sequence took longer than 3s. Restarting.");
            
            // Clear previous timer interrupt
            clearTimeout(comboTimer);
            comboTimer = null;

            // Reset and immediately restart a new sequence using this latest hit
            resetComboTracker("slow-restart");
            tapTimes.push(currentTapTime);

            // Schedule a new timer interrupt for the new sequence
            comboTimer = setTimeout(function() {
                console.log("[CFG Path: New Timer Interrupt] New 3000ms window expired. Resetting.");
                resetComboTracker("timeout");
            }, 3000);

            updateComboUI(1);
            return false;
        }
    }
}

/**
 * Resets the state of the combo tracker based on the completion reason.
 * 
 * @param {string} reason - The trigger cause ('miss', 'timeout', 'success', 'slow-restart')
 */
function resetComboTracker(reason) {
    tapTimes = [];
    if (comboTimer !== null) {
        clearTimeout(comboTimer);
        comboTimer = null;
    }

    const blocks = document.querySelectorAll('.combo-block');
    const multiplierVal = document.getElementById('combo-multiplier-val');

    if (reason === "success") {
        blocks.forEach(block => {
            block.classList.remove('block-filled');
            block.classList.add('combo-burst-mode');
        });
        multiplierVal.innerText = '🔥 x3 COMBO';
        multiplierVal.classList.add('combo-max-glow');

        // Revert styling back to normal after 1.5 seconds
        setTimeout(() => {
            blocks.forEach(block => block.classList.remove('combo-burst-mode'));
            multiplierVal.innerText = 'x1 MULTI';
            multiplierVal.classList.remove('combo-max-glow');
        }, 1500);
    } else {
        blocks.forEach(block => {
            block.classList.remove('block-filled');
            block.classList.remove('combo-burst-mode');
        });
        multiplierVal.innerText = 'x1 MULTI';
        multiplierVal.classList.remove('combo-max-glow');
    }
}

function updateComboUI(level) {
    const blocks = document.querySelectorAll('.combo-block');
    blocks.forEach((block, index) => {
        if (index < level) {
            block.classList.add('block-filled');
        } else {
            block.classList.remove('block-filled');
        }
    });
}

// ==========================================
// ACTIVE GAMEPLAY LOOP & TARGET PHYSICS
// ==========================================
/**
 * Triggers a 3-second countdown before game starts.
 */
function runGameCountdown() {
    const countdownVal = document.getElementById('countdown-val');
    let count = 3;
    countdownVal.innerText = count;
    
    // Play starting tick sound
    playCountdownSound(500, 0.05);

    const interval = setInterval(() => {
        count--;
        if (count > 0) {
            countdownVal.innerText = count;
            playCountdownSound(500, 0.05);
        } else if (count === 0) {
            countdownVal.innerText = "GO!";
            playCountdownSound(1000, 0.2); // Higher pitch for START
        } else {
            clearInterval(interval);
            transitionToState('playing');
        }
    }, 1000);
}

/**
 * Initializes game counters and sets up active loops.
 */
function startGameSession() {
    localScore = 0;
    consecutiveHits = 0;
    maxCombo = 0;
    timeLeft = GAME_DURATION;
    currentScore.innerText = localScore;
    
    resetComboTracker("init");
    spawnTarget();

    // Smoother countdown using a 100ms interval for visual updates
    gameTimerInterval = setInterval(() => {
        timeLeft -= 0.1;
        if (timeLeft <= 0) {
            timeLeft = 0;
            clearInterval(gameTimerInterval);
            endGameSession();
        }
        
        // Update countdown fill UI
        const fillPercent = (timeLeft / GAME_DURATION) * 100;
        gameTimerFill.style.width = `${fillPercent}%`;
    }, 100);
}

/**
 * Spawns a glowing target button in a random coordinate location within the Arena.
 */
function spawnTarget() {
    // Clear existing children inside arena
    targetArena.innerHTML = '';

    const targetNode = document.createElement('div');
    targetNode.className = 'tap-target-node';
    targetNode.innerHTML = `<div class="target-inner-ring"></div>`;

    // Calculate boundary boxes to ensure targets are fully visible
    // Arena is width 100%, height 380px. Node is 56px wide/high.
    // Spawn within 10% to 90% parameters.
    const randomX = Math.floor(10 + Math.random() * 80); // X percentage offset
    const randomY = Math.floor(10 + Math.random() * 80); // Y percentage offset

    targetNode.style.left = `${randomX}%`;
    targetNode.style.top = `${randomY}%`;

    // Binds hit clicks
    targetNode.addEventListener('click', (e) => {
        e.stopPropagation(); // Avoid triggering Miss actions on parent Arena element
        handleHit(e);
    });

    targetArena.appendChild(targetNode);
}

/**
 * Handles target hits.
 * Adds score, executes combo checks, updates server, and repositions targets.
 */
function handleHit(e) {
    if (timeLeft <= 0) return;

    // Play high pitch sound
    playHitClickSound();

    // Floating visual indicator
    createFloatingText(e.clientX, e.clientY, "+1", "feedback-hit");

    // Perform combo tracking checks
    const comboTriggered = detectCombo(Date.now(), true);
    
    // Add score
    consecutiveHits++;
    if (consecutiveHits > maxCombo) {
        maxCombo = consecutiveHits;
    }

    localScore += comboTriggered ? 3 : 1;
    currentScore.innerText = localScore;

    // Reposition target immediately
    spawnTarget();

    // Push score update to server in real-time to update leaderboard rankings immediately
    ws.send(JSON.stringify({
        type: 'tap',
        score: localScore,
        isCombo: comboTriggered
    }));
}

/**
 * Handles misses.
 * Clears consecutive streaks, plays error audio, and flashes arena border.
 */
function handleMiss(e) {
    if (timeLeft <= 0) return;

    // Visual feedback
    targetArena.classList.add('arena-flash-miss');
    setTimeout(() => targetArena.classList.remove('arena-flash-miss'), 150);

    // Play low buzzer sound
    playMissSound();

    // Floating visual indicator
    createFloatingText(e.clientX, e.clientY, "MISS", "feedback-miss");

    // Reset combo trackers
    consecutiveHits = 0;
    detectCombo(Date.now(), false);
}

/**
 * Creates floating text at coordinate positions.
 */
function createFloatingText(x, y, text, cssClass) {
    // Get bounding box of target arena to place coordinates relatively
    const arenaRect = targetArena.getBoundingClientRect();
    const relativeX = x - arenaRect.left;
    const relativeY = y - arenaRect.top;

    const feedbackEl = document.createElement('span');
    feedbackEl.className = `click-feedback ${cssClass}`;
    feedbackEl.innerText = text;
    feedbackEl.style.left = `${relativeX}px`;
    feedbackEl.style.top = `${relativeY}px`;

    targetArena.appendChild(feedbackEl);

    // Prune node after animation completes
    setTimeout(() => feedbackEl.remove(), 600);
}

/**
 * Finalizes session and displays results card.
 * Automatically counts down to return to attract mode.
 */
function endGameSession() {
    targetArena.innerHTML = '';
    
    // Clear audio contexts
    resetComboTracker("gameover");
    
    // Final score submission check (redundant but safe)
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'tap',
            score: localScore,
            isCombo: false
        }));
    }
    
    // Switch view to results card
    transitionToState('results');

    // Automatic transition back to attract screen after 10 seconds
    let resultsTimeLeft = 10;
    resultsSubmitBtn.innerText = `Skip & Return to Start (${resultsTimeLeft}s)`;
    
    if (resultsTimerInterval) {
        clearInterval(resultsTimerInterval);
    }

    resultsTimerInterval = setInterval(() => {
        resultsTimeLeft--;
        if (resultsTimeLeft <= 0) {
            clearInterval(resultsTimerInterval);
            resultsTimerInterval = null;
            
            // Return to attract screen
            localScore = 0;
            consecutiveHits = 0;
            maxCombo = 0;
            transitionToState('attract');
        } else {
            resultsSubmitBtn.innerText = `Skip & Return to Start (${resultsTimeLeft}s)`;
        }
    }, 1000);
}

// ==========================================
// WEB AUDIO SYNTHESIZER BUILDERS
// ==========================================
function playCountdownSound(freq, duration) {
    try {
        if (!audioToggle.checked) return;
        initAudioContext();
        
        const now = audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now);
        gain.gain.setValueAtTime(0.04, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

        osc.start(now);
        osc.stop(now + duration);
    } catch (e) {}
}

function playHitClickSound() {
    try {
        if (!audioToggle.checked) return;
        initAudioContext();
        
        const now = audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);

        osc.type = 'sine';
        osc.frequency.setValueAtTime(750, now);
        gain.gain.setValueAtTime(0.05, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

        osc.start(now);
        osc.stop(now + 0.05);
    } catch (e) {}
}

function playMissSound() {
    try {
        if (!audioToggle.checked) return;
        initAudioContext();
        
        const now = audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(160, now); // Low buzz note
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

        osc.start(now);
        osc.stop(now + 0.15);
    } catch (e) {}
}

function playComboBeep() {
    try {
        initAudioContext();
        
        const now = audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);

        osc.type = 'square';
        
        osc.frequency.setValueAtTime(523.25, now); // C5 note
        gain.gain.setValueAtTime(0.06, now);
        
        osc.frequency.setValueAtTime(659.25, now + 0.08); // E5 note
        
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

        osc.start(now);
        osc.stop(now + 0.35);
    } catch (e) {}
}

function triggerComboEffects() {
    const flashDiv = document.getElementById('screen-flash');
    flashDiv.classList.remove('active-flash');
    void flashDiv.offsetWidth;
    flashDiv.classList.add('active-flash');

    if (audioToggle.checked) {
        playComboBeep();
    }
}

function initAudioContext() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
}

// ==========================================
// REAL-TIME WEBSOCKET NETWORKING
// ==========================================
function connectWS() {
    if (statusText) {
        statusText.innerText = "Connecting...";
        statusText.className = "metric-value status-offline";
    }
    
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        console.log("[WS Kiosk] Connection open.");
        if (statusText) {
            statusText.innerText = "Connected";
            statusText.className = "metric-value status-online";
        }

        // Re-enroll player if already connected previously
        if (myUsername) {
            ws.send(JSON.stringify({
                type: 'join',
                username: myUsername
            }));
        }
    };

    ws.onclose = () => {
        console.log("[WS Kiosk] Connection terminated. Retrying in 3s...");
        if (statusText) {
            statusText.innerText = "Offline";
            statusText.className = "metric-value status-offline";
        }
        
        clearInterval(latencyTimer);
        
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(connectWS, 3000);
    };

    ws.onerror = (err) => {
        console.error("[WS Kiosk Error] Details:", err);
        ws.close();
    };

    ws.onmessage = (event) => {
        handleServerMessage(event.data);
    };
}

function handleServerMessage(rawData) {
    try {
        const data = JSON.parse(rawData);

        switch (data.type) {
            case 'welcome':
                myUsername = data.username;
                currentPlayerName.innerText = myUsername;
                
                // Transition to Countdown overlay state once backend accepts join
                transitionToState('countdown');
                startLatencyChecker();
                latestLeaderboard = data.leaderboard;
                renderLeaderboard(data.leaderboard);
                break;

            case 'leaderboard_sync':
                if (playerCount) {
                    playerCount.innerText = data.activePlayers;
                }
                latestLeaderboard = data.leaderboard;
                renderLeaderboard(data.leaderboard);
                updateResultsRanking();
                break;

            case 'alert_event':
                appendTickerMessage(data.message, data.timestamp);
                break;

            case 'combo_alert':
                // Other screens combo alerts are broadcasted
                // If it is another player who triggered, make a minor visual highlight in ticker
                break;

            case 'pong':
                const latency = Date.now() - data.clientTimestamp;
                if (latencyVal) {
                    latencyVal.innerText = `${latency} ms`;
                }
                break;

            case 'error':
                alert(`Kiosk Error: ${data.message}`);
                break;
        }
    } catch (err) {
        console.error("[WS Kiosk Error] Parse failure:", err);
    }
}

function startLatencyChecker() {
    clearInterval(latencyTimer);
    latencyTimer = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            latencyStart = Date.now();
            ws.send(JSON.stringify({
                type: 'ping',
                clientTimestamp: latencyStart
            }));
        }
    }, 3000);
}

/**
 * Updates the leaderboard rank displayed on the results card.
 */
function updateResultsRanking() {
    if (!resultsRankVal) return;
    
    let rank = -1;
    for (let i = 0; i < latestLeaderboard.length; i++) {
        if (latestLeaderboard[i].name === myUsername) {
            rank = i + 1;
            break;
        }
    }
    
    if (rank !== -1) {
        resultsRankVal.innerText = `#${rank}`;
    } else {
        if (localScore > 0) {
            resultsRankVal.innerText = "10+";
        } else {
            resultsRankVal.innerText = "--";
        }
    }
}

// ==========================================
// RENDERERS & EVENT HANDLERS
// ==========================================
function renderLeaderboard(players) {
    leaderboardList.innerHTML = '';

    if (!players || players.length === 0) {
        leaderboardList.innerHTML = '<li class="empty-list-msg">Waiting for display sync...</li>';
        return;
    }

    const topScore = players[0].score || 1;

    for (let i = 0; i < players.length; i++) {
        const player = players[i];
        const rank = i + 1;

        const li = document.createElement('li');
        li.className = 'leaderboard-row';
        
        if (player.name === myUsername) {
            li.classList.add('user-row-self');
        }

        let rankClass = 'rank-other';
        if (rank === 1) rankClass = 'rank-gold';
        else if (rank === 2) rankClass = 'rank-silver';
        else if (rank === 3) rankClass = 'rank-bronze';

        const widthPercent = Math.min(100, Math.round((player.score / topScore) * 100));

        li.innerHTML = `
            <div class="player-progress-track" style="width: ${widthPercent}%"></div>
            <div class="rank-badge ${rankClass}">${rank}</div>
            <div class="player-name">${escapeHTML(player.name)}</div>
            <div class="player-score-area">
                <span class="player-score">${player.score}</span>
                <span class="player-pts-label">PTS</span>
            </div>
        `;
        leaderboardList.appendChild(li);
    }
}

function appendTickerMessage(msg, timestamp) {
    const msgEl = document.createElement('div');
    msgEl.className = 'event-message';

    if (msg.includes('🔥 COMBO') || msg.includes('BURST')) {
        msgEl.classList.add('combo-burst-msg');
    } else {
        msgEl.classList.add('system-msg');
    }

    const timeStr = new Date(timestamp).toLocaleTimeString([], { 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit' 
    });

    msgEl.innerText = `[${timeStr}] ${msg}`;
    eventTicker.appendChild(msgEl);
    eventTicker.scrollTop = eventTicker.scrollHeight;

    while (eventTicker.children.length > 20) {
        eventTicker.removeChild(eventTicker.firstChild);
    }
}

function escapeHTML(str) {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function generateRandomUsername() {
    const prefixes = ["Neo", "Volt", "Cyber", "Grid", "Flux", "Core", "Byte", "Pulse", "Void", "Holo", "Kilo", "Zenith"];
    const suffixes = ["Runner", "Rider", "Ghost", "Scout", "Viper", "Tapper", "Glider", "Spark", "Daemon", "Tracker", "Nova", "Stalker"];
    
    const pre = prefixes[Math.floor(Math.random() * prefixes.length)];
    const suf = suffixes[Math.floor(Math.random() * suffixes.length)];
    const num = Math.floor(100 + Math.random() * 900);

    usernameInput.value = `${pre}${suf}_${num}`;
}

// ==========================================
// EVENT SUITE REGISTRATION
// ==========================================
attractStartBtn.addEventListener('click', () => {
    initAudioContext();
    transitionToState('register');
});

randomUsernameBtn.addEventListener('click', generateRandomUsername);

joinForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = usernameInput.value.trim();
    if (name) {
        myUsername = name;
        initAudioContext();
        
        // Connect socket registry join
        ws.send(JSON.stringify({
            type: 'join',
            username: myUsername
        }));
    }
});

resultsSubmitBtn.addEventListener('click', () => {
    if (resultsTimerInterval) {
        clearInterval(resultsTimerInterval);
        resultsTimerInterval = null;
    }
    // Reset local parameters and return to attract state
    localScore = 0;
    consecutiveHits = 0;
    maxCombo = 0;
    transitionToState('attract');
});

// Start network pipeline
connectWS();

// Display Attract Screen initially
transitionToState('attract');
