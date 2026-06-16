/**
 * Client Controller: billboard.js
 * Role: Front-end orchestration for the venue billboard view.
 * Handles WebSocket leaderboard synchronization and receives combo alert
 * broadcasts to trigger screen-flashes and audio.
 */

// ==========================================
// GLOBALS & CONFIGURATION STATE
// ==========================================
let ws = null;
let reconnectTimer = null;

// Resolve network URLs dynamically based on current deployment environment
const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsUrl = window.location.host ? `${protocol}//${window.location.host}` : 'ws://localhost:3000';

// Web Audio API context for alert beeps
let audioCtx = null;
let audioEnabled = false;

// ==========================================
// DOM ELEMENT REFERENCING
// ==========================================
const leaderboardList = document.getElementById('leaderboard-list');
const eventTicker = document.getElementById('event-ticker');
const playerCount = document.getElementById('player-count');
const audioInitBtn = document.getElementById('billboard-audio-init');

// ==========================================
// WEB AUDIO SYNTHESIZER BEHAVIOR
// ==========================================
/**
 * Synthesizes a loud, high-impact neon combo alert beep sequence.
 */
function playComboAlarm() {
    if (!audioEnabled || !audioCtx) return;
    
    try {
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }

        const now = audioCtx.currentTime;
        
        // Node 1: Oscillator (sawtooth arcade wave)
        const osc = audioCtx.createOscillator();
        // Node 2: Gain (volume dynamics)
        const gain = audioCtx.createGain();

        osc.connect(gain);
        gain.connect(audioCtx.destination);

        osc.type = 'sawtooth'; // Retro arcade buzz sound
        
        // Double tone warning sequence
        osc.frequency.setValueAtTime(440, now); // A4 note
        gain.gain.setValueAtTime(0.08, now);
        
        osc.frequency.setValueAtTime(880, now + 0.1); // A5 note (1 octave higher)
        
        // Decay to prevent popping
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

        osc.start(now);
        osc.stop(now + 0.4);
    } catch (err) {
        console.warn("Failed playing billboard sound:", err);
    }
}

/**
 * Triggers a visual screen flash overlay.
 */
function triggerScreenFlash() {
    const flashDiv = document.getElementById('screen-flash');
    flashDiv.classList.remove('active-flash');
    // Force DOM repaint to restart animation
    void flashDiv.offsetWidth;
    flashDiv.classList.add('active-flash');
    
    // Play the alert beep
    playComboAlarm();
}

// ==========================================
// REAL-TIME WEBSOCKET NETWORKING
// ==========================================
function connectWS() {
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        console.log("[WS Billboard] Connection established.");
        
        // Register role with server immediately
        ws.send(JSON.stringify({
            type: 'register_role',
            role: 'billboard'
        }));
    };

    ws.onclose = () => {
        console.log("[WS Billboard] Connection lost. Retrying in 3 seconds...");
        
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(connectWS, 3000);
    };

    ws.onerror = (err) => {
        console.error("[WS Billboard] Error observed:", err);
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
                renderLeaderboard(data.leaderboard);
                break;

            case 'leaderboard_sync':
                if (playerCount) {
                    playerCount.innerText = data.activePlayers;
                }
                renderLeaderboard(data.leaderboard);
                break;

            case 'alert_event':
                appendTickerMessage(data.message, data.timestamp);
                break;

            case 'combo_alert':
                console.log(`[Combo Broadcast Received] Triggering alert for ${data.username}`);
                triggerScreenFlash();
                break;
        }
    } catch (err) {
        console.error("[WS Billboard] Error parsing incoming packet:", err);
    }
}

// ==========================================
// RENDERERS & EVENT HANDLERS
// ==========================================
function renderLeaderboard(players) {
    leaderboardList.innerHTML = '';

    if (!players || players.length === 0) {
        leaderboardList.innerHTML = '<li class="empty-list-msg">No active scores on display.</li>';
        return;
    }

    const topScore = players[0].score || 1;

    const maxEntries = Math.min(players.length, 10);
    for (let i = 0; i < maxEntries; i++) {
        const player = players[i];
        const rank = i + 1;

        const li = document.createElement('li');
        li.className = 'leaderboard-row';

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
    if (!eventTicker) return;
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

    while (eventTicker.children.length > 50) {
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

// ==========================================
// AUDIO SYSTEM ENROLLMENT GESTURE
// ==========================================
audioInitBtn.addEventListener('click', () => {
    try {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        audioEnabled = true;
        audioInitBtn.innerText = "🎵 Audio Output Online";
        audioInitBtn.style.borderColor = "var(--neon-cyan)";
        audioInitBtn.style.color = "var(--neon-cyan)";
        
        // Play brief check sound
        const now = audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.frequency.setValueAtTime(600, now);
        gain.gain.setValueAtTime(0.04, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
        osc.start(now);
        osc.stop(now + 0.1);
    } catch (e) {
        console.error("Audio init error:", e);
    }
});

// Generate dynamic QR Code for mobile enrollment matching the current kiosk URL
function generateDynamicQRCode() {
    const qrImage = document.getElementById('qr-image');
    if (qrImage) {
        // Derive play URL dynamically (billboard display is at /billboard, game console is at /)
        const playUrl = window.location.origin + '/';
        // Generate QR code pointing to playUrl using dynamic QR Server API
        qrImage.src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(playUrl)}&color=060812&bgcolor=ffffff`;
        console.log(`[QR Generator] Rendered QR code for dynamic play URL: ${playUrl}`);
    }
}

// Initialize dynamic UI and network cycles
generateDynamicQRCode();
connectWS();
