const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vsteps', {
  connect: (serverUrl) => ipcRenderer.send('connect-manual', serverUrl),
  disconnect: () => ipcRenderer.send('disconnect'),
  getStatus: () => ipcRenderer.send('get-status'),
  updateSettings: (settings) => ipcRenderer.send('settings-update', settings),
  toggleDisableWKey: (enabled) => ipcRenderer.send('toggle-disable-w-key', enabled),
  toggleSteerEnabled: (enabled) => ipcRenderer.send('toggle-steer-enabled', enabled),
  generateQRCode: (serverUrl) => ipcRenderer.invoke('generate-qr-code', serverUrl),
  getLocalIP: () => ipcRenderer.invoke('get-local-ip'),

  onConnectionStatus: (callback) => {
    ipcRenderer.on('connection-status', (event, status) => callback(status));
  },
  onP2PStatus: (callback) => {
    ipcRenderer.on('p2p-status', (event, status) => callback(status));
  },
  onMovement: (callback) => {
    ipcRenderer.on('movement', (event, data) => callback(data));
  },
  onJump: (callback) => {
    ipcRenderer.on('jump', (event) => callback());
  },
  onTilt: (callback) => {
    ipcRenderer.on('tilt', (event, data) => callback(data));
  },
  onSensorData: (callback) => {
    ipcRenderer.on('sensor-data', (event, data) => callback(data));
  },
  onPhoneSettings: (callback) => {
    ipcRenderer.on('phone-settings', (event, settings) => callback(settings));
  },
  onServerFound: (callback) => {
    ipcRenderer.on('server-found', (event, url) => callback(url));
  },
  onActivityLog: (callback) => {
    ipcRenderer.on('activity-log', (event, entry) => callback(entry));
  },
  onStats: (callback) => {
    ipcRenderer.on('stats-update', (event, stats) => callback(stats));
  },
  onWKeyBlockStatus: (callback) => {
    ipcRenderer.on('w-key-block-status', (event, status) => callback(status));
  },
  onSteerStatus: (callback) => {
    ipcRenderer.on('steer-status', (event, status) => callback(status));
  },
  onLateral: (callback) => {
    ipcRenderer.on('lateral', (event, data) => callback(data));
  },
  onApexGate: (callback) => {
    ipcRenderer.on('apex-gate', (event, data) => callback(data));
  },
  onConfigSynced: (callback) => {
    ipcRenderer.on('config-synced', (event, config) => callback(config));
  },
  onAutoConnect: (callback) => {
    ipcRenderer.on('auto-connect', (event, url) => callback(url));
  },
  onSessionCreated: (callback) => {
    ipcRenderer.on('session-created', (event, data) => callback(data));
  },
  onPhoneConnected: (callback) => {
    ipcRenderer.on('phone-connected', (event, data) => callback(data));
  }
});
