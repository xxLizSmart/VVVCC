#!/usr/bin/env node
/**
 * VSteps WebRTC PC Receiver - Windows Easy Install Edition
 * 
 * Uses '@nut-tree-fork/nut-js' - a community fork with prebuilt binaries.
 * NO Visual Studio Build Tools required - works out of the box!
 * 
 * All sensor movement = W key (forward only)
 * 
 * Key Hold Logic (StepL-style):
 * - On Step: Press W and start/reset 0.8s countdown
 * - On Timer Finish: Release W only if no new steps arrived
 * - Sprint: Shift + W for fast steps
 * - Jump: Space key
 * 
 * Requirements (Windows/macOS/Linux):
 *   npm install @roamhq/wrtc socket.io-client @nut-tree-fork/nut-js
 * 
 * Usage:
 *   node pc_receiver_keysender.js
 *   Then connect from your phone's VSteps controller
 */

const { RTCPeerConnection, RTCSessionDescription, RTCIceCandidate } = require('@roamhq/wrtc');
const io = require('socket.io-client');
const readline = require('readline');
const fs = require('fs');
const path = require('path');

let keyboard = null;
let Key = null;

// Config file path for persistent settings
const CONFIG_FILE = path.join(process.cwd(), 'vsteps-config.json');

// Default configuration - Omni-Motion Engine
const defaultConfig = {
  mode: 'default',           // default, game, or cruise
  ultraSensitive: false,     // Forces Cruise mode (Baseline + 0.1)
  triggerForce: 0.8,         // Threshold offset: Default=+0.8, Game=+0.4, Cruise=+0.1
  walkingFlow: 800,          // W hold timer in ms (200-2000, default 800)
  reactionSpeed: 50          // Debounce between steps in ms (10-200, default 50)
};

// Load config from file
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, 'utf8');
      const config = JSON.parse(data);
      console.log('[CONFIG] Loaded settings from vsteps-config.json:', config);
      return { ...defaultConfig, ...config };
    }
  } catch (err) {
    console.log('[CONFIG] Could not load config file:', err.message);
  }
  console.log('[CONFIG] Using default settings');
  return defaultConfig;
}

// Save config to file
function saveConfig(config) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    console.log('[CONFIG] Settings saved to vsteps-config.json');
  } catch (err) {
    console.log('[CONFIG] Could not save config:', err.message);
  }
}

// Current config
let currentConfig = loadConfig();

async function initInputDevices() {
  try {
    const nutjs = await import('@nut-tree-fork/nut-js');
    keyboard = nutjs.keyboard;
    Key = nutjs.Key;
    
    // Zero-latency configuration - HARDCODED for all modes
    keyboard.config.autoDelayMs = 0;
    
    console.log('[INFO] nut.js loaded - keyboard simulation enabled');
    console.log('[INFO] keyboard.config.autoDelayMs = 0 (hardcoded)');
    return true;
  } catch (err) {
    console.log('[WARN] nut.js not available - input simulation disabled');
    console.log('       Install with: npm install @nut-tree-fork/nut-js');
    console.log('       Error:', err.message);
    return false;
  }
}

// Walking Flow (W hold timer) from config - dynamically updated
let STOP_DELAY = currentConfig.walkingFlow || 800;

const KEY_MAP = {
  forward: 'W'
};

// Pocket-Pro: Lateral movement key manager for A/D keys
class LateralKeyManager {
  constructor() {
    this.currentDirection = null; // 'left', 'right', or null
    this.allowDiagonal = true; // Default: allow W+A/W+D
  }

  async handleLateral(direction, allowDiagonal = true, keyManager = null) {
    if (!keyboard || !Key) return;
    
    this.allowDiagonal = allowDiagonal;
    
    // Release previous direction if any
    if (this.currentDirection && this.currentDirection !== direction) {
      await this.releaseDirection(this.currentDirection);
    }
    
    // If not allowing diagonal and steering is active, release W
    if (!allowDiagonal && direction !== null && keyManager) {
      await keyManager.forceReleaseW();
    }
    
    // Press new direction if specified
    if (direction === 'left' && this.currentDirection !== 'left') {
      try {
        await keyboard.pressKey(Key.A);
        this.currentDirection = 'left';
        console.log('[← LEFT    ] \'A\' key DOWN - Strafing Left');
      } catch (err) {
        console.log('[ERROR] Failed to press A:', err.message);
      }
    } else if (direction === 'right' && this.currentDirection !== 'right') {
      try {
        await keyboard.pressKey(Key.D);
        this.currentDirection = 'right';
        console.log('[→ RIGHT   ] \'D\' key DOWN - Strafing Right');
      } catch (err) {
        console.log('[ERROR] Failed to press D:', err.message);
      }
    } else if (direction === null && this.currentDirection !== null) {
      await this.releaseDirection(this.currentDirection);
    }
  }
  
  isSteeringActive() {
    return this.currentDirection !== null;
  }

  async releaseDirection(direction) {
    if (!keyboard || !Key) return;
    
    try {
      if (direction === 'left') {
        await keyboard.releaseKey(Key.A);
        console.log('[← LEFT    ] \'A\' key UP - Strafe Stopped');
      } else if (direction === 'right') {
        await keyboard.releaseKey(Key.D);
        console.log('[→ RIGHT   ] \'D\' key UP - Strafe Stopped');
      }
      this.currentDirection = null;
    } catch (err) {
      console.log('[ERROR] Failed to release lateral key:', err.message);
    }
  }

  async releaseAll() {
    if (this.currentDirection) {
      await this.releaseDirection(this.currentDirection);
    }
  }
}

class KeyHoldManager {
  constructor() {
    this.heldKeys = new Set();
    this.timers = {};
    this.isShiftHeld = false;
    this.pendingRelease = {};
  }

  async handleStep(direction, isSprint = false) {
    if (!keyboard || !Key) return;
    
    const keyName = KEY_MAP[direction] || KEY_MAP.forward;
    const key = Key[keyName];
    
    if (isSprint && !this.isShiftHeld) {
      try {
        await keyboard.pressKey(Key.LeftShift);
        this.isShiftHeld = true;
        console.log('[SPRINT] SHIFT key DOWN');
      } catch (err) {
        console.log('[ERROR] Failed to press Shift:', err.message);
      }
    }

    if (!this.heldKeys.has(keyName)) {
      try {
        await keyboard.pressKey(key);
        this.heldKeys.add(keyName);
        const arrow = { forward: '↑', backward: '↓' }[direction] || '•';
        const sprint = isSprint ? ' SPRINT' : '';
        console.log(`[${arrow} ${direction.toUpperCase().padEnd(8)}] '${keyName}' key DOWN${sprint}`);
      } catch (err) {
        console.log('[ERROR] Failed to press key:', err.message);
      }
    }

    if (this.timers[keyName]) {
      clearTimeout(this.timers[keyName]);
    }

    this.timers[keyName] = setTimeout(() => {
      this.stopKey(keyName, direction);
    }, STOP_DELAY);
  }

  async stopKey(keyName, direction) {
    if (!keyboard || !Key) return;
    
    const key = Key[keyName];
    
    if (this.heldKeys.has(keyName)) {
      try {
        await keyboard.releaseKey(key);
        this.heldKeys.delete(keyName);
        const arrow = { forward: '↑', backward: '↓' }[direction] || '•';
        console.log(`[${arrow} ${direction.toUpperCase().padEnd(8)}] '${keyName}' key UP - Character Stopped`);
      } catch (err) {
        console.log('[ERROR] Failed to release key:', err.message);
      }
    }
    
    delete this.timers[keyName];

    if (this.heldKeys.size === 0 && this.isShiftHeld) {
      try {
        await keyboard.releaseKey(Key.LeftShift);
        this.isShiftHeld = false;
        console.log('[SPRINT] SHIFT key UP');
      } catch (err) {
        console.log('[ERROR] Failed to release Shift:', err.message);
      }
    }
  }
  
  // Force release W key (for non-diagonal mode when steering takes priority)
  async forceReleaseW() {
    if (!keyboard || !Key) return;
    
    if (this.heldKeys.has('W')) {
      try {
        await keyboard.releaseKey(Key.W);
        this.heldKeys.delete('W');
        console.log('[PRIORITY] \'W\' released - Steering takes priority');
      } catch (err) {
        console.log('[ERROR] Failed to force release W:', err.message);
      }
      
      // Clear W timer
      if (this.timers['W']) {
        clearTimeout(this.timers['W']);
        delete this.timers['W'];
      }
    }
  }
  
  isWHeld() {
    return this.heldKeys.has('W');
  }

  async tapKey(keyName) {
    if (!keyboard || !Key) return;
    const key = Key[keyName] || Key.Space;
    try {
      await keyboard.pressKey(key);
      await keyboard.releaseKey(key);
    } catch (err) {
      console.log('[ERROR] Failed to tap key:', err.message);
    }
  }

  async releaseAll() {
    if (!keyboard || !Key) return;
    
    for (const keyName of this.heldKeys) {
      const key = Key[keyName];
      try {
        await keyboard.releaseKey(key);
        console.log(`[SAFETY] '${keyName}' released`);
      } catch (err) {
        console.log('[ERROR] Failed to release key:', err.message);
      }
    }
    this.heldKeys.clear();
    
    for (const keyName of Object.keys(this.timers)) {
      clearTimeout(this.timers[keyName]);
    }
    this.timers = {};

    if (this.isShiftHeld) {
      try {
        await keyboard.releaseKey(Key.LeftShift);
        this.isShiftHeld = false;
        console.log('[SAFETY] SHIFT released');
      } catch (err) {
        console.log('[ERROR] Failed to release Shift:', err.message);
      }
    }
  }
}

const keyManager = new KeyHoldManager();
const lateralManager = new LateralKeyManager();
let stepCounts = { forward: 0 };
let jumpCount = 0;
let sprintCount = 0;

// Apex-Gate: Direct key press/release handler for combined movement
class DirectKeyHandler {
  constructor() {
    this.activeKeys = new Set();
  }

  async handleInput(msg) {
    if (!keyboard || !Key) return;
    
    const { press = [], release = [] } = msg;
    
    // Release keys first (order matters for clean state)
    // Always attempt release even if not tracked, for reliability
    for (const k of release) {
      const keyCode = this.mapKey(k);
      if (keyCode) {
        try {
          await keyboard.releaseKey(keyCode);
          if (this.activeKeys.has(k)) {
            this.activeKeys.delete(k);
            console.log(`[APEX-GATE] '${k.toUpperCase()}' UP`);
          }
        } catch (err) {
          // Silently ignore release errors (key might not be pressed)
        }
      }
    }
    
    // Press new keys
    for (const k of press) {
      const keyCode = this.mapKey(k);
      if (keyCode && !this.activeKeys.has(k)) {
        try {
          await keyboard.pressKey(keyCode);
          this.activeKeys.add(k);
          console.log(`[APEX-GATE] '${k.toUpperCase()}' DOWN`);
        } catch (err) {
          console.log(`[ERROR] Press ${k}:`, err.message);
        }
      }
    }
  }
  
  mapKey(k) {
    if (!Key) return null;
    const keyMap = {
      'w': Key.W,
      'a': Key.A,
      's': Key.S,
      'd': Key.D,
      'shift': Key.LeftShift,
      'space': Key.Space
    };
    return keyMap[k.toLowerCase()] || null;
  }
  
  async releaseAll() {
    if (!keyboard || !Key) return;
    for (const k of this.activeKeys) {
      const keyCode = this.mapKey(k);
      if (keyCode) {
        try {
          await keyboard.releaseKey(keyCode);
          console.log(`[SAFETY] '${k.toUpperCase()}' released`);
        } catch (err) {
          console.log(`[ERROR] Release ${k}:`, err.message);
        }
      }
    }
    this.activeKeys.clear();
  }
  
  getActiveKeys() {
    return Array.from(this.activeKeys);
  }
}

const directKeyHandler = new DirectKeyHandler();


const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function prompt(question) {
  return new Promise(resolve => rl.question(question, resolve));
}

async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('  VSteps PC Receiver - Apex-Pro Suite');
  console.log('  Supports: Step-Controller + Apex-Gate');
  console.log('='.repeat(60));
  console.log('\nOmni-Motion Settings:');
  console.log(`  Mode: ${currentConfig.mode} | Ultra-Sensitive: ${currentConfig.ultraSensitive}`);
  console.log(`  Trigger Force: +${currentConfig.triggerForce} | Walking Flow: ${currentConfig.walkingFlow}ms`);
  console.log(`  Reaction Speed: ${currentConfig.reactionSpeed}ms`);
  console.log('\nButtery Walk Logic:');
  console.log('  - On Step: Press W key, start countdown (Walking Flow)');
  console.log('  - Consecutive steps reset the timer (W stays held)');
  console.log('  - W releases only after timer expires with no steps\n');

  await initInputDevices();

  const serverUrl = await prompt('Enter server URL (e.g., https://vsteps.org): ');
  
  if (!serverUrl) {
    console.log('[ERROR] Server URL is required');
    process.exit(1);
  }

  console.log(`\n[INFO] Connecting to signaling server: ${serverUrl}`);

  const socket = io(serverUrl, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 10
  });

  let peerConnection = null;
  let dataChannel = null;
  let connectedPhoneId = null;

  socket.on('connect', () => {
    console.log('[CONNECTED] Connected to signaling server');
    console.log('[INFO] Registering as PC receiver...');
    socket.emit('webrtc-register-pc');
    console.log('[READY] Waiting for phone to connect via WebRTC...\n');
    console.log('-'.repeat(60));
  }); 

  socket.on('disconnect', () => {
    console.log('[DISCONNECTED] Lost connection to signaling server');
    keyManager.releaseAll();
  });

  // Receive config updates from mobile app (Omni-Motion Engine)
  socket.on('vsteps-config-update', (config) => {
    console.log('[CONFIG] Received Omni-Motion settings from mobile:', config);
    
    // Update Walking Flow (W hold timer)
    if (config.walkingFlow !== undefined) {
      STOP_DELAY = config.walkingFlow;
      console.log(`[CONFIG] Walking Flow: ${STOP_DELAY}ms`);
    }
    // Legacy support for old 'buffer' property
    if (config.buffer !== undefined && config.walkingFlow === undefined) {
      STOP_DELAY = config.buffer;
      console.log(`[CONFIG] Buffer (legacy): ${STOP_DELAY}ms`);
    }
    
    // Log mode and trigger force changes
    if (config.mode) {
      console.log(`[CONFIG] Mode: ${config.mode}`);
    }
    if (config.ultraSensitive !== undefined) {
      console.log(`[CONFIG] Ultra-Sensitive: ${config.ultraSensitive}`);
    }
    if (config.triggerForce !== undefined) {
      console.log(`[CONFIG] Trigger Force: +${config.triggerForce}`);
    }
    if (config.reactionSpeed !== undefined) {
      console.log(`[CONFIG] Reaction Speed: ${config.reactionSpeed}ms`);
    }
    
    currentConfig = { ...currentConfig, ...config };
    saveConfig(currentConfig);
  });

  socket.on('webrtc-offer', async (data) => {
    console.log(`\n[WEBRTC] Received offer from phone: ${data.fromId}`);
    connectedPhoneId = data.fromId;

    peerConnection = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    });

    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('webrtc-ice-candidate', {
          targetId: connectedPhoneId,
          candidate: event.candidate
        });
      }
    };

    peerConnection.onconnectionstatechange = () => {
      console.log(`[WEBRTC] Connection state: ${peerConnection.connectionState}`);
      if (peerConnection.connectionState === 'disconnected' || 
          peerConnection.connectionState === 'failed') {
        keyManager.releaseAll();
      }
    };

    peerConnection.ondatachannel = (event) => {
      dataChannel = event.channel;
      console.log(`[WEBRTC] Data channel received: ${dataChannel.label}`);
      console.log(`[WEBRTC] Channel config - ordered: ${dataChannel.ordered}, maxRetransmits: ${dataChannel.maxRetransmits}`);
      
      dataChannel.onopen = () => {
        console.log('[P2P] Direct connection established!');
        console.log('[P2P] Movement data now travels directly phone → PC (no cloud!)');
        console.log('\n[INFO] Walk in place to control your game!\n');
      };

      dataChannel.onmessage = (event) => {
        handleP2PMessage(event.data);
      };

      dataChannel.onclose = () => {
        console.log('[P2P] Data channel closed');
        keyManager.releaseAll();
      };
    };

    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    socket.emit('webrtc-answer', {
      targetId: connectedPhoneId,
      answer: peerConnection.localDescription
    });

    console.log('[WEBRTC] Sent answer to phone');
  });

  socket.on('webrtc-ice-candidate', async (data) => {
    if (peerConnection && data.fromId === connectedPhoneId) {
      try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
      } catch (err) {
        console.log('[WEBRTC] Error adding ICE candidate:', err.message);
      }
    }
  });

  // Ultra Mode: No PC-side debounce - phone already handles 50ms debounce
  // Log rate limiting to prevent console spam at 20 steps/sec
  let lastLogTime = 0;
  const LOG_INTERVAL_MS = 200; // Log at most 5 times per second

  socket.on('movement-detected', async (data) => {
    const direction = data.direction || 'forward';
    const isSprint = data.isSprint || false;
    const allowDiagonal = data.allowDiagonal !== false; // Default true
    const now = Date.now();
    
    stepCounts[direction] = (stepCounts[direction] || 0) + 1;
    if (isSprint) sprintCount++;
    
    // Rate-limited logging for Ultra Mode
    if (now - lastLogTime >= LOG_INTERVAL_MS) {
      lastLogTime = now;
      console.log(`[SOCKET] Step: ${direction} (total: ${stepCounts[direction]}, sprint=${isSprint}, diagonal=${allowDiagonal})`);
    }
    
    // Non-diagonal mode: Skip W if steering is active
    if (!allowDiagonal && lateralManager.isSteeringActive()) {
      console.log('[PRIORITY] Step skipped - Steering active (diagonal OFF)');
      return;
    }
    
    // Non-diagonal mode: Release A/D when stepping forward
    if (!allowDiagonal && direction === 'forward') {
      await lateralManager.releaseAll();
    }
    
    await keyManager.handleStep(direction, isSprint);
  });

  // Backward compatibility - step-detected is now just an alias
  socket.on('step-detected', async (data) => {
    const direction = data?.direction || 'forward';
    const now = Date.now();
    
    stepCounts[direction] = (stepCounts[direction] || 0) + 1;
    
    if (now - lastLogTime >= LOG_INTERVAL_MS) {
      lastLogTime = now;
      console.log(`[SOCKET] Step: ${direction} (total: ${stepCounts[direction]})`);
    }
    
    await keyManager.handleStep(direction, false);
  });

  socket.on('jump-detected', async () => {
    jumpCount++;
    await keyManager.tapKey('Space');
    console.log(`[⬆ JUMP] SPACE pressed (Count: ${jumpCount})`);
  });

  // Apex-Pro: Lateral movement (A/D keys) - angle-based steering
  socket.on('lateral-movement', async (data) => {
    const direction = data.direction; // 'left', 'right', or null
    const angle = data.angle || '0';
    const allowDiagonal = data.allowDiagonal !== false; // Default true
    console.log(`[SOCKET] Lateral: ${direction || 'center'} (${angle}°) diagonal=${allowDiagonal}`);
    await lateralManager.handleLateral(direction, allowDiagonal, keyManager);
  });

  // Apex-Gate: Direct press/release protocol for combined movement (W+A, W+D, Shift+W, etc.)
  socket.on('apex-gate-input', async (data) => {
    const { press = [], release = [] } = data;
    const active = directKeyHandler.getActiveKeys();
    console.log(`[APEX-GATE] Press: [${press.join(',')}] Release: [${release.join(',')}] Active: [${active.join(',')}]`);
    await directKeyHandler.handleInput(data);
  });

  async function handleP2PMessage(message) {
    try {
      const data = JSON.parse(message);
      
      if (data.type === 'movement') {
        const direction = data.direction || 'forward';
        const isSprint = data.isSprint || false;
        const allowDiagonal = data.allowDiagonal !== false;
        
        stepCounts[direction] = (stepCounts[direction] || 0) + 1;
        if (isSprint) sprintCount++;
        
        // Non-diagonal mode: Skip W if steering is active
        if (!allowDiagonal && lateralManager.isSteeringActive()) {
          console.log('[P2P PRIORITY] Step skipped - Steering active (diagonal OFF)');
          return;
        }
        
        // Non-diagonal mode: Release A/D when stepping forward
        if (!allowDiagonal && direction === 'forward') {
          await lateralManager.releaseAll();
        }
        
        await keyManager.handleStep(direction, isSprint);
      } else if (data.type === 'jump') {
        jumpCount++;
        await keyManager.tapKey('Space');
        console.log(`[⬆ JUMP] SPACE pressed (Count: ${jumpCount})`);
      } else if (data.type === 'lateral') {
        // Apex-Pro: Lateral movement via P2P - angle-based steering
        const lateralDir = data.direction; // 'left', 'right', or null
        const angle = data.angle || '0';
        const allowDiagonal = data.allowDiagonal !== false;
        console.log(`[P2P] Lateral: ${lateralDir || 'center'} (${angle}°) diagonal=${allowDiagonal}`);
        await lateralManager.handleLateral(lateralDir, allowDiagonal, keyManager);
      } else if (data.type === 'apex-gate') {
        // Apex-Gate: Direct press/release protocol via P2P
        const { press = [], release = [] } = data;
        const active = directKeyHandler.getActiveKeys();
        console.log(`[P2P APEX-GATE] Press: [${press.join(',')}] Release: [${release.join(',')}] Active: [${active.join(',')}]`);
        await directKeyHandler.handleInput(data);
      }
    } catch (err) {
      console.log('[P2P] Invalid message:', message);
    }
  }

  process.on('SIGINT', async () => {
    console.log('\n[CLEANUP] Shutting down...');
    await keyManager.releaseAll();
    await lateralManager.releaseAll();
    await directKeyHandler.releaseAll();
    if (dataChannel) dataChannel.close();
    if (peerConnection) peerConnection.close();
    socket.disconnect();
    
    console.log('\n[STATS] Session summary:');
    console.log(`        Steps  - Forward: ${stepCounts.forward || 0}`);
    console.log(`        Sprints: ${sprintCount}`);
    console.log(`        Jumps:   ${jumpCount}`);
    console.log('[INFO] Goodbye!');
    
    rl.close();
    process.exit(0);
  });
}

main().catch(console.error);
