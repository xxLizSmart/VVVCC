#!/usr/bin/env node
/**
 * VSteps WebRTC PC Receiver - Ultra-Low Latency P2P Connection
 * 
 * This script establishes a direct WebRTC Data Channel with your phone
 * for the lowest possible latency step detection. Uses "unreliable" mode
 * (ordered: false, maxRetransmits: 0) for UDP-like performance.
 * 
 * Requirements:
 *   npm install wrtc socket.io-client robotjs
 * npm install wrtc socket.io-client robotjs  
 * Usage:
 *   node pc_receiver_webrtc.js
 *   Then connect from your phone's VSteps controller
 * 
 * The phone sends step data directly to your PC over local WiFi,
 * bypassing the cloud server for movement data (server only used for signaling).
 */

const { RTCPeerConnection, RTCSessionDescription, RTCIceCandidate } = require('wrtc');
const io = require('socket.io-client');
const readline = require('readline');
const fs = require('fs');
const path = require('path');

// Config file path for persistent settings
const CONFIG_FILE = path.join(process.cwd(), 'vsteps-config.json');

// Default configuration
const defaultConfig = {
  triMode: 'default',
  threshold: 12.0,
  buffer: 800,
  debounce: 250
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

let robot = null;
try {
  robot = require('robotjs');
  robot.setKeyboardDelay(0);  // Zero-latency - HARDCODED for all modes
  console.log('[INFO] RobotJS loaded - keyboard simulation enabled');
  console.log('[INFO] robot.setKeyboardDelay(0) - hardcoded');
} catch (err) {
  console.log('[WARN] RobotJS not available - keyboard simulation disabled');
  console.log('       Install with: npm install robotjs');
}

// Buffer (release timer) from config - dynamically updated
let STOP_DELAY = currentConfig.buffer || 800;

// Pure Locomotion mode - all sensor movement maps to W key
const KEY_MAP = {
  forward: 'w'
};

class KeyHoldManager {
  constructor() {
    this.heldKeys = new Map();
    this.timers = new Map();
    this.isShiftHeld = false;
  }

  holdKey(direction, isSprint = false) {
    if (!robot) return;
    
    const key = KEY_MAP[direction] || KEY_MAP.forward;
    
    if (this.timers.has(key)) {
      clearTimeout(this.timers.get(key));
    }

    if (isSprint && !this.isShiftHeld) {
      robot.keyToggle('shift', 'down');
      this.isShiftHeld = true;
      console.log('[SPRINT] SHIFT key DOWN');
    }

    if (!this.heldKeys.get(key)) {
      robot.keyToggle(key, 'down');
      this.heldKeys.set(key, true);
      const arrow = { forward: '↑', backward: '↓' }[direction] || '•';
      const sprint = isSprint ? ' SPRINT' : '';
      console.log(`[${arrow} ${direction.toUpperCase().padEnd(8)}] '${key.toUpperCase()}' key DOWN${sprint}`);
    }

    const timer = setTimeout(() => {
      this.releaseKey(key, direction);
    }, STOP_DELAY);
    this.timers.set(key, timer);
  }

  releaseKey(key, direction) {
    if (!robot) return;
    
    if (this.heldKeys.get(key)) {
      robot.keyToggle(key, 'up');
      this.heldKeys.set(key, false);
      const arrow = { forward: '↑', backward: '↓' }[direction] || '•';
      console.log(`[${arrow} ${direction.toUpperCase().padEnd(8)}] '${key.toUpperCase()}' key UP`);
    }
    this.timers.delete(key);

    const anyHeld = Array.from(this.heldKeys.values()).some(v => v);
    if (this.isShiftHeld && !anyHeld) {
      robot.keyToggle('shift', 'up');
      this.isShiftHeld = false;
      console.log('[SPRINT] SHIFT key UP');
    }
  }

  tapKey(key) {
    if (!robot) return;
    robot.keyTap(key);
  }

  releaseAll() {
    if (!robot) return;
    
    for (const [key, isHeld] of this.heldKeys.entries()) {
      if (isHeld) {
        robot.keyToggle(key, 'up');
        console.log(`[SAFETY] '${key.toUpperCase()}' released`);
      }
    }
    this.heldKeys.clear();
    
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();

    if (this.isShiftHeld) {
      robot.keyToggle('shift', 'up');
      this.isShiftHeld = false;
      console.log('[SAFETY] SHIFT released');
    }
  }
}

const keyManager = new KeyHoldManager();
let stepCounts = { forward: 0 };
let jumpCount = 0;
let sprintCount = 0;

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function prompt(question) {
  return new Promise(resolve => rl.question(question, resolve));
}

async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('  VSteps WebRTC PC Receiver - Ultra-Low Latency P2P Mode');
  console.log('='.repeat(60));
  console.log('\nThis creates a DIRECT connection between phone and PC.');
  console.log('Movement data bypasses the cloud for minimal latency.\n');

  const serverUrl = await prompt('Enter server URL (e.g., https://your-app.replit.app): ');
  
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

  // Receive config updates from mobile app
  socket.on('vsteps-config-update', (config) => {
    console.log('[CONFIG] Received settings from mobile app:', config);
    if (config.buffer) {
      STOP_DELAY = config.buffer;
      console.log(`[CONFIG] Buffer updated to ${STOP_DELAY}ms`);
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

  socket.on('movement-detected', (data) => {
    const direction = data.direction || 'forward';
    const isSprint = data.isSprint || false;
    const now = Date.now();
    
    stepCounts[direction] = (stepCounts[direction] || 0) + 1;
    if (isSprint) sprintCount++;
    
    // Rate-limited logging for Ultra Mode
    if (now - lastLogTime >= LOG_INTERVAL_MS) {
      lastLogTime = now;
      console.log(`[SOCKET] Step: ${direction} (total: ${stepCounts[direction]}, sprint=${isSprint})`);
    }
    
    keyManager.holdKey(direction, isSprint);
  });

  // Backward compatibility - step-detected is now just an alias
  socket.on('step-detected', (data) => {
    const direction = data?.direction || 'forward';
    const now = Date.now();
    
    stepCounts[direction] = (stepCounts[direction] || 0) + 1;
    
    if (now - lastLogTime >= LOG_INTERVAL_MS) {
      lastLogTime = now;
      console.log(`[SOCKET] Step: ${direction} (total: ${stepCounts[direction]})`);
    }
    
    keyManager.holdKey(direction, false);
  });

  socket.on('jump-detected', () => {
    jumpCount++;
    keyManager.tapKey('space');
    console.log(`[⬆ JUMP] SPACE pressed (Count: ${jumpCount})`);
  });

  function handleP2PMessage(message) {
    try {
      const data = JSON.parse(message);
      
      if (data.type === 'movement') {
        const direction = data.direction || 'forward';
        const isSprint = data.isSprint || false;
        
        stepCounts[direction] = (stepCounts[direction] || 0) + 1;
        if (isSprint) sprintCount++;
        
        keyManager.holdKey(direction, isSprint);
      } else if (data.type === 'jump') {
        jumpCount++;
        keyManager.tapKey('space');
        console.log(`[⬆ JUMP] SPACE pressed (Count: ${jumpCount})`);
      }
    } catch (err) {
      console.log('[P2P] Invalid message:', message);
    }
  }

  process.on('SIGINT', () => {
    console.log('\n[CLEANUP] Shutting down...');
    keyManager.releaseAll();
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
