const EventEmitter = require('events');
const { io } = require('socket.io-client');
const fs = require('fs');
const path = require('path');

let RTCPeerConnection, RTCSessionDescription, RTCIceCandidate;
let wrtcLoaded = false;

const CONFIG_FILE = path.join(process.cwd(), 'vsteps-config.json');

const DEFAULT_SERVER_URL = 'https://vsteps.org';

const defaultConfig = {
  mode: 'default',
  ultraSensitive: false,
  triggerForce: 0.8,
  walkingFlow: 800,
  reactionSpeed: 50
};

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

function saveConfig(config) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    console.log('[CONFIG] Settings saved to vsteps-config.json');
  } catch (err) {
    console.log('[CONFIG] Could not save config:', err.message);
  }
}

function loadWebRTC() {
  // WebRTC disabled - using reliable WebSocket mode
  // The @roamhq/wrtc module can cause stability issues on some systems
  console.log('[CONNECTION] Using WebSocket mode (stable, low-latency)');
  wrtcLoaded = true;
  return false;
}

class ConnectionManager extends EventEmitter {
  constructor() {
    super();
    this.socket = null;
    this.serverUrl = null;
    this.connected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    
    this.peerConnection = null;
    this.dataChannel = null;
    this.connectedPhoneId = null;
    this.p2pConnected = false;
    
    // Session-based pairing
    this.sessionId = null;
    this.phoneConnected = false;
    
    // Heartbeat for connection stability
    this.heartbeatInterval = null;
    this.lastHeartbeat = Date.now();
    
    this.currentConfig = loadConfig();
    
    this.stats = {
      forward: 0,
      jump: 0,
      sprint: 0,
      lateral: 0
    };
    
    this.lastLogTime = 0;
    this.LOG_INTERVAL_MS = 200;
  }
  
  getSessionId() {
    return this.sessionId;
  }
  
  isPhoneConnected() {
    return this.phoneConnected;
  }

  getConfig() {
    return this.currentConfig;
  }

  connect(serverUrl) {
    if (this.socket) {
      this.disconnect();
    }

    // Normalize the URL
    let normalizedUrl = serverUrl.trim();
    
    // Add protocol if missing
    if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
      normalizedUrl = 'https://' + normalizedUrl;
    }
    
    // Remove trailing slash
    normalizedUrl = normalizedUrl.replace(/\/$/, '');
    
    this.serverUrl = normalizedUrl;
    this.emit('log', { type: 'info', message: `Connecting to ${normalizedUrl}...` });

    try {
      this.socket = io(normalizedUrl, {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: this.maxReconnectAttempts,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 20000,
        forceNew: true,
        pingTimeout: 30000,
        pingInterval: 10000
      });
    } catch (err) {
      this.emit('log', { type: 'error', message: `Failed to create connection: ${err.message}` });
      this.emit('connection-failed', err.message);
      return;
    }

    this.socket.on('connect', () => {
      this.connected = true;
      this.reconnectAttempts = 0;
      this.lastHeartbeat = Date.now();
      this.emit('connected');
      this.emit('log', { type: 'info', message: 'Connected to signaling server' });
      
      // Create a new session for pairing
      this.socket.emit('create-session');
      this.emit('log', { type: 'info', message: 'Creating session for phone pairing...' });
      
      // Start heartbeat for connection monitoring
      this.startHeartbeat();
      
      const webrtcAvailable = loadWebRTC();
      if (!webrtcAvailable) {
        this.emit('log', { type: 'info', message: 'Using WebSocket mode (stable)' });
      }
    });
    
    // Session created - receive session ID
    this.socket.on('session-created', (data) => {
      this.sessionId = data.sessionId;
      this.emit('session-created', { sessionId: data.sessionId });
      this.emit('log', { type: 'success', message: `Session: ${data.sessionId} - Ready for phone` });
    });
    
    // Phone connected to our session
    this.socket.on('phone-connected', (data) => {
      this.phoneConnected = true;
      this.emit('phone-connected', { sessionId: data.sessionId });
      this.emit('log', { type: 'success', message: 'Phone connected! Start walking.' });
    });
    
    // Session error
    this.socket.on('session-error', (data) => {
      this.emit('log', { type: 'error', message: `Session error: ${data.message}` });
    });

    // Reconnection events
    this.socket.on('reconnect', (attemptNumber) => {
      this.emit('log', { type: 'info', message: `Reconnected after ${attemptNumber} attempts` });
      this.connected = true;
      // Re-join session if we had one
      if (this.sessionId) {
        this.emit('log', { type: 'info', message: 'Rejoining session...' });
      }
    });

    this.socket.on('reconnect_attempt', (attemptNumber) => {
      this.emit('log', { type: 'warning', message: `Reconnection attempt ${attemptNumber}/${this.maxReconnectAttempts}` });
    });

    this.socket.on('disconnect', (reason) => {
      this.connected = false;
      this.p2pConnected = false;
      this.phoneConnected = false;
      this.stopHeartbeat();
      this.emit('disconnected');
      this.emit('p2p-status', { connected: false });
      this.emit('log', { type: 'warning', message: `Disconnected: ${reason}` });
      this.emit('release-all-keys');
      
      // Auto-reconnect for certain disconnect reasons
      if (reason === 'io server disconnect' || reason === 'transport close') {
        this.emit('log', { type: 'info', message: 'Attempting to reconnect...' });
      }
    });

    this.socket.on('connect_error', (error) => {
      this.reconnectAttempts++;
      this.emit('log', { type: 'error', message: `Connection error: ${error.message}` });
      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        this.emit('connection-failed', error.message);
      }
    });

    this.socket.on('vsteps-config-update', (config) => {
      this.emit('log', { type: 'info', message: 'Received settings from mobile app' });
      
      if (config.walkingFlow !== undefined) {
        this.emit('config-update', { walkingFlow: config.walkingFlow });
      }
      if (config.buffer !== undefined && config.walkingFlow === undefined) {
        this.emit('config-update', { walkingFlow: config.buffer });
      }
      
      this.currentConfig = { ...this.currentConfig, ...config };
      saveConfig(this.currentConfig);
      this.emit('config-synced', this.currentConfig);
    });

    this.socket.on('webrtc-offer', async (data) => {
      if (!RTCPeerConnection) return;
      
      this.emit('log', { type: 'info', message: `WebRTC offer from phone: ${data.fromId.slice(0, 8)}...` });
      this.connectedPhoneId = data.fromId;
      
      await this.setupPeerConnection(data);
    });

    this.socket.on('webrtc-ice-candidate', async (data) => {
      if (this.peerConnection && data.fromId === this.connectedPhoneId) {
        try {
          await this.peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (err) {
          this.emit('log', { type: 'error', message: `ICE candidate error: ${err.message}` });
        }
      }
    });

    this.socket.on('movement-detected', (data) => {
      this.lastHeartbeat = Date.now();
      this.handleMovement(data);
    });

    this.socket.on('step-detected', (data) => {
      this.lastHeartbeat = Date.now();
      const direction = data?.direction || 'forward';
      this.handleMovement({ direction });
    });

    this.socket.on('jump-detected', () => {
      this.lastHeartbeat = Date.now();
      this.handleJump();
    });

    this.socket.on('lateral-movement', (data) => {
      this.lastHeartbeat = Date.now();
      this.handleLateral(data);
    });

    this.socket.on('apex-gate-input', (data) => {
      this.lastHeartbeat = Date.now();
      this.handleApexGate(data);
    });

    // Omni (formerly Apex-Gate) input handler
    this.socket.on('input', (data) => {
      this.lastHeartbeat = Date.now();
      this.handleApexGate(data);
    });

    this.socket.on('sensor-data', (data) => {
      this.emit('sensor-data', data);
    });

    this.socket.on('tilt-detected', (data) => {
      this.handleTilt(data);
    });

    this.socket.on('phone-settings', (data) => {
      this.emit('phone-settings', data);
    });

    this.socket.on('step-count-sync', (data) => {
      if (data && typeof data.count === 'number') {
        this.stats.forward = data.count;
        this.emit('stats-update', this.stats);
      }
    });
    
    // PVP spectator events (for desktop viewing)
    this.socket.on('pvp-update', (data) => {
      this.emit('pvp-update', data);
    });
    
    this.socket.on('pvp-ended', (data) => {
      this.emit('pvp-ended', data);
    });
  }

  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      const timeSinceLastActivity = now - this.lastHeartbeat;
      
      // If no activity for 60 seconds, check connection
      if (timeSinceLastActivity > 60000 && this.connected) {
        this.emit('log', { type: 'warning', message: 'No activity detected, checking connection...' });
        if (this.socket?.connected) {
          this.socket.emit('get-session-info');
        }
      }
    }, 30000);
  }

  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  async setupPeerConnection(data) {
    this.peerConnection = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    });

    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.emit('webrtc-ice-candidate', {
          targetId: this.connectedPhoneId,
          candidate: event.candidate
        });
      }
    };

    this.peerConnection.onconnectionstatechange = () => {
      const state = this.peerConnection.connectionState;
      this.emit('log', { type: 'info', message: `P2P state: ${state}` });
      
      if (state === 'connected') {
        this.p2pConnected = true;
        this.emit('p2p-status', { connected: true, latency: '5-15ms' });
      } else if (state === 'disconnected' || state === 'failed') {
        this.p2pConnected = false;
        this.emit('p2p-status', { connected: false });
        this.emit('release-all-keys');
      }
    };

    this.peerConnection.ondatachannel = (event) => {
      this.dataChannel = event.channel;
      this.emit('log', { type: 'info', message: `Data channel: ${this.dataChannel.label}` });
      
      this.dataChannel.onopen = () => {
        this.emit('log', { type: 'success', message: 'P2P direct connection established!' });
        this.emit('log', { type: 'info', message: 'Movement data now travels directly phone → PC' });
        this.p2pConnected = true;
        this.emit('p2p-status', { connected: true, latency: '5-15ms' });
      };

      this.dataChannel.onmessage = (event) => {
        this.handleP2PMessage(event.data);
      };

      this.dataChannel.onclose = () => {
        this.emit('log', { type: 'warning', message: 'P2P data channel closed' });
        this.p2pConnected = false;
        this.emit('p2p-status', { connected: false });
        this.emit('release-all-keys');
      };
    };

    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
    const answer = await this.peerConnection.createAnswer();
    await this.peerConnection.setLocalDescription(answer);

    this.socket.emit('webrtc-answer', {
      targetId: this.connectedPhoneId,
      answer: this.peerConnection.localDescription
    });

    this.emit('log', { type: 'info', message: 'Sent WebRTC answer to phone' });
  }

  handleP2PMessage(message) {
    try {
      const data = JSON.parse(message);
      
      if (data.type === 'movement') {
        this.handleMovement(data);
      } else if (data.type === 'jump') {
        this.handleJump();
      } else if (data.type === 'tilt') {
        this.handleTilt(data);
      } else if (data.type === 'lateral') {
        this.handleLateral(data);
      } else if (data.type === 'apex-gate') {
        this.handleApexGate(data);
      }
    } catch (err) {
      this.emit('log', { type: 'error', message: `Invalid P2P message: ${message}` });
    }
  }

  handleTilt(data) {
    this.emit('tilt', data);
  }

  handleMovement(data) {
    const direction = data.direction || 'forward';
    const isSprint = data.isSprint || false;
    const allowDiagonal = data.allowDiagonal !== false;
    
    this.stats[direction] = (this.stats[direction] || 0) + 1;
    if (isSprint) this.stats.sprint++;
    
    this.emit('movement', { direction, isSprint, allowDiagonal });
    this.emit('stats-update', this.stats);
  }

  handleJump() {
    this.stats.jump++;
    this.emit('jump');
    this.emit('stats-update', this.stats);
  }

  handleLateral(data) {
    const direction = data.direction;
    const angle = data.angle || '0';
    const allowDiagonal = data.allowDiagonal !== false;
    
    this.stats.lateral++;
    this.emit('lateral', { direction, angle, allowDiagonal });
    this.emit('stats-update', this.stats);
  }

  handleApexGate(data) {
    const { press = [], release = [] } = data;
    this.emit('apex-gate', { press, release });
  }

  sendSettings(settings) {
    if (this.socket?.connected) {
      this.socket.emit('desktop-settings', settings);
    }
  }

  disconnect() {
    this.stopHeartbeat();
    
    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    
    this.connected = false;
    this.p2pConnected = false;
    this.serverUrl = null;
    this.connectedPhoneId = null;
    this.sessionId = null;
    this.phoneConnected = false;
    
    this.emit('release-all-keys');
    this.emit('log', { type: 'info', message: 'Disconnected and cleaned up' });
  }

  isConnected() {
    return this.connected;
  }

  isP2PConnected() {
    return this.p2pConnected;
  }

  getServerUrl() {
    return this.serverUrl;
  }

  getStats() {
    return this.stats;
  }

  resetStats() {
    this.stats = { forward: 0, jump: 0, sprint: 0, lateral: 0 };
    this.emit('stats-update', this.stats);
  }
}

module.exports = { ConnectionManager };
