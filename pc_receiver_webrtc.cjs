#!/usr/bin/env node
/**
 * VSteps WebRTC PC Receiver - Ultra-Low Latency P2P Connection
 * 
 * This script establishes a direct WebRTC Data Channel with your phone
 * for the lowest possible latency step detection. Uses "unreliable" mode
 * (ordered: false, maxRetransmits: 0) for UDP-like performance.
 * 
 * Requirements:
 *   npm install @roamhq/wrtc socket.io-client robotjs
 * 
 * Usage:
 *   node pc_receiver_webrtc.js
 *   Then connect from your phone's VSteps controller
 * 
 * The phone sends step data directly to your PC over local WiFi,
 * bypassing the cloud server for movement data (server only used for signaling).
 */

// Use @roamhq/wrtc for Node.js 20+ support (the original 'wrtc' package is deprecated)
const { RTCPeerConnection, RTCSessionDescription, RTCIceCandidate } = require('@roamhq/wrtc');
const io = require('socket.io-client');
const readline = require('readline');

let robot = null;
try {
  robot = require('robotjs');
  robot.setKeyboardDelay(0);
  console.log('[INFO] RobotJS loaded - keyboard simulation enabled');
} catch (err) {
  console.log('[WARN] RobotJS not available - keyboard simulation disabled');
  console.log('       Install with: npm install robotjs');
}

const STOP_DELAY = 800;

const KEY_MAP = {
  forward: 'w',
  left: 'a',
  right: 'd',
  backward: 's'
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
      const arrow = { forward: '↑', left: '←', right: '→', backward: '↓' }[direction] || '•';
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
      const arrow = { forward: '↑', left: '←', right: '→', backward: '↓' }[direction] || '•';
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
let stepCounts = { forward: 0, left: 0, right: 0 };
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

  socket.on('movement-detected', (data) => {
    const direction = data.direction || 'forward';
    const isSprint = data.isSprint || false;
    
    stepCounts[direction] = (stepCounts[direction] || 0) + 1;
    if (isSprint) sprintCount++;
    
    keyManager.holdKey(direction, isSprint);
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
    console.log(`        Steps  - Forward: ${stepCounts.forward || 0}, Left: ${stepCounts.left || 0}, Right: ${stepCounts.right || 0}`);
    console.log(`        Sprints: ${sprintCount}`);
    console.log(`        Jumps:   ${jumpCount}`);
    console.log('[INFO] Goodbye!');
    
    rl.close();
    process.exit(0);
  });
}

main().catch(console.error);
