/**
 * Server: server.js
 * Role: Standard Node.js HTTP server serving Kiosk and Billboard pages,
 * and managing WebSocket synchronization for scores, rankings, and alerts.
 * 
 * CSE443 Assignment 2 2025/2026 Kiosk Game
 * Note: Key algorithms are heavily annotated for drawing Control Flow Graphs (CFGs)
 * and analyzing Statement/Branch coverage.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

// Global Leaderboard State
// An array representing the top scoring players: [{ name: String, score: Number, lastUpdated: Number }]
let leaderboardData = [];

// Port configuration (using Render's dynamic PORT environment variable or defaulting to 8080)
const PORT = process.env.PORT || 8080;

// ==========================================
// HTTP SERVER SETUP (Static Asset Delivery)
// ==========================================
const server = http.createServer((req, res) => {
    const urlPath = req.url;
    let filePath = '';

    // Route handling
    if (urlPath === '/' || urlPath === '/index.html') {
        filePath = './index.html';
    } else if (urlPath === '/billboard' || urlPath === '/billboard.html') {
        filePath = './billboard.html';
    } else {
        filePath = '.' + urlPath;
    }

    const extname = String(path.extname(filePath)).toLowerCase();
    const mimeTypes = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpg',
        '.gif': 'image/gif',
        '.ico': 'image/x-icon'
    };

    const contentType = mimeTypes[extname] || 'application/octet-stream';

    // Serve the requested static file
    fs.readFile(filePath, (error, content) => {
        if (error) {
            if (error.code === 'ENOENT') {
                // Return 404 for missing files
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('404 Not Found', 'utf-8');
            } else {
                // Return 500 for general system errors
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('500 Server Error: ' + error.code, 'utf-8');
            }
        } else {
            // Return 200 and serve content with correct MIME type
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
});

// ==========================================
// ALGORITHM FOR CFG ANALYSIS: updateLeaderboard
// ==========================================
/**
 * Updates the global leaderboard array when a player score increases.
 * Structured with clear loops and decision branches for CFG drawing.
 * 
 * @param {string} username - The display name of the player
 * @param {number} score - Current total score achieved by the player
 * @param {boolean} isCombo - Flag indicating if a combo multiplier is active
 * @returns {Array} - The sorted leaderboard top list
 */
function updateLeaderboard(username, score, isCombo) {
    // Branch 1: Input Validation
    if (!username || typeof username !== 'string') {
        console.log("[CFG Branch: Invalid Input] Leaderboard update bypassed.");
        return leaderboardData;
    }

    let playerFound = false;
    let playerIndex = -1;

    // Loop 1: Traverse current leaderboard list to locate existing record
    for (let i = 0; i < leaderboardData.length; i++) {
        // Branch 2: Check matching username
        if (leaderboardData[i].name === username) {
            playerFound = true;
            playerIndex = i;
            break; // Exit loop early
        }
    }

    // Branch 3: Insert new entry or update existing entry
    if (playerFound) {
        // Only update score if the new score is higher (high-score authority)
        if (score > leaderboardData[playerIndex].score) {
            leaderboardData[playerIndex].score = score;
            leaderboardData[playerIndex].lastUpdated = Date.now();
            console.log(`[CFG Branch: Update Score] Updated ${username} score to ${score}`);
        }
    } else {
        const newEntry = {
            name: username,
            score: score,
            lastUpdated: Date.now()
        };
        leaderboardData.push(newEntry);
        console.log(`[CFG Branch: Insert Player] Created new entry for: ${username} with score ${score}`);
    }

    // Loop 2: Sort the Leaderboard using Insertion Sort
    // We code the sort manually to provide structured, nested logic paths for the university report.
    const n = leaderboardData.length;
    for (let i = 1; i < n; i++) {
        let current = leaderboardData[i];
        let j = i - 1;

        // Loop 3: Shift elements backwards to determine correct ranking
        while (j >= 0) {
            let shouldSwap = false;

            // Branch 4: Compare scores for descending ranking
            if (leaderboardData[j].score < current.score) {
                shouldSwap = true;
            }
            // Branch 5: If scores are equal, apply tie-breaker
            else if (leaderboardData[j].score === current.score) {
                // Branch 6: Player who achieved the score earlier (smaller timestamp) gets ranked higher
                if (leaderboardData[j].lastUpdated > current.lastUpdated) {
                    shouldSwap = true;
                }
            }

            // Branch 7: Swap values if swap condition is met, else terminate shifting
            if (shouldSwap) {
                leaderboardData[j + 1] = leaderboardData[j];
                j--;
            } else {
                break; // Exit inner shifting loop
            }
        }
        leaderboardData[j + 1] = current;
    }

    // Branch 8: Cap the leaderboard list at 10 items (Kiosk standard)
    if (leaderboardData.length > 10) {
        leaderboardData = leaderboardData.slice(0, 10);
        console.log("[CFG Branch: Truncation] Truncated leaderboard to top 10.");
    }

    return leaderboardData;
}

// ==========================================
// WEBSOCKET MULTIPLAYER PROTOCOL
// ==========================================
const wss = new WebSocket.Server({ server });

// Set of all active connections mapping connection ID to connection metadata
const clients = new Map(); // WebSocket connection -> { role, username, joinedTime }

/**
 * Broadcasts a serialized JSON message to all connected clients.
 * @param {Object} messageObj - The object to send
 */
function broadcast(messageObj) {
    const rawData = JSON.stringify(messageObj);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(rawData);
        }
    });
}

// Main Connection Handler
wss.on('connection', (ws) => {
    console.log(`[WebSocket] New client connected. Active connections: ${wss.clients.size}`);

    // Initialize connection metadata
    clients.set(ws, { role: null, username: null, joinedTime: Date.now() });

    // Client message listener
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            const clientData = clients.get(ws);

            switch (data.type) {
                case 'register_role':
                    // Map client as a "billboard" or "kiosk"
                    clientData.role = data.role;
                    console.log(`[Role Registered] Client registered as: ${data.role}`);

                    // Sync leaderboard state to the new client
                    ws.send(JSON.stringify({
                        type: 'welcome',
                        username: 'SYSTEM',
                        leaderboard: leaderboardData
                    }));

                    // Update player counts
                    broadcast({
                        type: 'leaderboard_sync',
                        leaderboard: leaderboardData,
                        activePlayers: wss.clients.size
                    });
                    break;

                case 'join':
                    // Map client as a "kiosk" playing game
                    clientData.role = 'kiosk';
                    clientData.username = data.username.trim() || `Runner-${Math.floor(1000 + Math.random() * 9000)}`;
                    console.log(`[Player Kiosk Join] Runner ID registered: ${clientData.username}`);

                    // Welcome player with initial setup state
                    ws.send(JSON.stringify({
                        type: 'welcome',
                        username: clientData.username,
                        leaderboard: leaderboardData
                    }));

                    // Broadcast "Player Enrolled" event alert to all billboards and kiosks
                    broadcast({
                        type: 'alert_event',
                        message: `📢 Runner '${clientData.username}' enrolled on Kiosk!`,
                        timestamp: Date.now()
                    });

                    // Send updated leaderboard and player count
                    broadcast({
                        type: 'leaderboard_sync',
                        leaderboard: leaderboardData,
                        activePlayers: wss.clients.size
                    });
                    break;

                case 'tap':
                    // Validate role states
                    if (clientData.role !== 'kiosk' || !clientData.username) {
                        ws.send(JSON.stringify({ type: 'error', message: 'Unauthorized tap command.' }));
                        break;
                    }

                    const score = data.score || 0;
                    const isCombo = data.isCombo || false;

                    // Execute CFG-heavy leaderboard update
                    const updatedScores = updateLeaderboard(clientData.username, score, isCombo);

                    // Broadcast updated rankings to all displays
                    broadcast({
                        type: 'leaderboard_sync',
                        leaderboard: updatedScores,
                        activePlayers: wss.clients.size
                    });

                    // If a combo burst was triggered, broadcast to all screens to fire beeps and flashes
                    if (isCombo) {
                        console.log(`[Combo Broadcast] Pushing combo event from ${clientData.username} to all screens.`);
                        broadcast({
                            type: 'combo_alert',
                            username: clientData.username
                        });

                        broadcast({
                            type: 'alert_event',
                            message: `🔥 COMBO BURST! ${clientData.username} hit 5 consecutive targets!`,
                            timestamp: Date.now()
                        });
                    }
                    break;

                case 'ping':
                    ws.send(JSON.stringify({
                        type: 'pong',
                        clientTimestamp: data.clientTimestamp
                    }));
                    break;

                default:
                    console.warn(`[WebSocket] Unrecognized packet: ${data.type}`);
            }
        } catch (err) {
            console.error('[WebSocket Error] Error parsing client packet:', err);
        }
    });

    // Close Handler
    ws.on('close', () => {
        const clientData = clients.get(ws);
        console.log(`[WebSocket] Connection terminated.`);

        if (clientData && clientData.username) {
            const username = clientData.username;
            console.log(`[Player Disconnect] Player '${username}' left.`);

            // Broadcast disconnect exit notification
            broadcast({
                type: 'alert_event',
                message: `💤 Player '${username}' went offline.`,
                timestamp: Date.now()
            });
        }

        clients.delete(ws);

        // Update player counts across screens
        broadcast({
            type: 'leaderboard_sync',
            leaderboard: leaderboardData,
            activePlayers: wss.clients.size
        });
    });
});

// Startup HTTP and WebSocket servers
server.listen(PORT, () => {
    console.log(`========================================================`);
    console.log(`🚀 DIGITAL MARKETING KIOSK PROTOCOL STARTED SUCCESSFULLY`);
    console.log(`👉 Access Player Kiosk at:    http://localhost:${PORT}`);
    console.log(`👉 Access Venue Billboard at: http://localhost:${PORT}/billboard`);
    console.log(`👉 WebSocket Server Bound to port: ${PORT}`);
    console.log(`========================================================`);
});
