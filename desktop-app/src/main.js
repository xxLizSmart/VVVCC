const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, dialog } = require('electron');
const path = require('path');
const os = require('os');

// Global error handlers to prevent crashes
process.on('uncaughtException', (error) => {
  console.error('[MAIN] Uncaught Exception:', error.message);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[MAIN] Unhandled Rejection:', reason);
});

// Initialize app state
app.isQuitting = false;

let mainWindow = null;
let tray = null;
let keyboardController = null;
let mouseController = null;
let connectionManager = null;
let discoveryService = null;
let wKeyBlocked = false;
let uioHook = null;
let blockingPaused = false;
let steerEnabled = false;
let aKeyHeld = false;
let dKeyHeld = false;
let QRCode = null;
let KeyboardController = null;
let MouseController = null;
let ConnectionManager = null;
let DiscoveryService = null;

const DEFAULT_SERVER_URL = 'https://vsteps.org';

// Simple window creation - runs first before anything else
function createWindow() {
  console.log('[MAIN] Creating window...');

  mainWindow = new BrowserWindow({
    width: 520,
    height: 800,
    minWidth: 400,
    minHeight: 600,
    resizable: true,
    frame: true,
    show: true,
    backgroundColor: '#0a0a0a',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      sandbox: false
    },
    icon: path.join(__dirname, '../assets/icon.png')
  });

  console.log('[MAIN] Loading HTML...');
  
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  
  mainWindow.webContents.on('did-finish-load', () => {
    console.log('[MAIN] HTML loaded successfully');
  });
  
  mainWindow.webContents.on('crashed', () => {
    console.error('[MAIN] Renderer crashed');
  });

  mainWindow.on('close', (event) => {
    console.log('[MAIN] Window close event triggered, isQuitting:', app.isQuitting);
    if (app.isQuitting !== true) {
      event.preventDefault();
      mainWindow.hide();
      console.log('[MAIN] Window hidden instead of closed');
    }
  });

  mainWindow.on('closed', () => {
    console.log('[MAIN] Window closed event fired');
    mainWindow = null;
  });
  
  // Catch any renderer crashes
  mainWindow.webContents.on('render-process-gone', (event, details) => {
    console.error('[MAIN] Renderer process gone:', details.reason, details.exitCode);
  });
  
  mainWindow.webContents.on('unresponsive', () => {
    console.error('[MAIN] Window became unresponsive');
  });
  
  console.log('[MAIN] Window created');
}

function createTray() {
  try {
    const iconPath = path.join(__dirname, '../assets/tray-icon.png');
    let icon;
    try {
      icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
    } catch (e) {
      icon = nativeImage.createEmpty();
    }
    
    tray = new Tray(icon);
    
    const contextMenu = Menu.buildFromTemplate([
      { label: 'Show VSteps', click: () => mainWindow?.show() },
      { type: 'separator' },
      { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); }}
    ]);
    
    tray.setContextMenu(contextMenu);
    tray.setToolTip('VSteps Desktop');
    
    tray.on('click', () => mainWindow?.show());
    
    console.log('[MAIN] Tray created');
  } catch (err) {
    console.error('[MAIN] Tray creation failed:', err.message);
  }
}

const sendLog = (entry) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    const connectionTypes = ['info', 'success', 'warning', 'error'];
    if (connectionTypes.includes(entry.type)) {
      mainWindow.webContents.send('activity-log', {
        ...entry,
        timestamp: new Date().toLocaleTimeString()
      });
    }
  }
};

// Load modules after window is ready
async function loadModules() {
  console.log('[MAIN] Loading modules...');
  
  try {
    QRCode = require('qrcode');
    console.log('[MAIN] QRCode loaded');
  } catch (err) {
    console.log('[MAIN] QRCode not available');
  }
  
  try {
    ConnectionManager = require('./connection').ConnectionManager;
    console.log('[MAIN] ConnectionManager loaded');
  } catch (err) {
    console.error('[MAIN] ConnectionManager failed:', err.message);
  }
  
  try {
    DiscoveryService = require('./discovery').DiscoveryService;
    console.log('[MAIN] DiscoveryService loaded');
  } catch (err) {
    console.error('[MAIN] DiscoveryService failed:', err.message);
  }
  
  try {
    KeyboardController = require('./keyboard').KeyboardController;
    console.log('[MAIN] KeyboardController loaded');
  } catch (err) {
    console.error('[MAIN] KeyboardController failed:', err.message);
  }
  
  try {
    MouseController = require('./mouse').MouseController;
    console.log('[MAIN] MouseController loaded');
  } catch (err) {
    console.error('[MAIN] MouseController failed:', err.message);
  }
}

function initializeServices() {
  console.log('[MAIN] Initializing services...');
  
  if (KeyboardController) {
    try {
      keyboardController = new KeyboardController();
      keyboardController.on('log', sendLog);
      console.log('[MAIN] KeyboardController initialized');
    } catch (err) {
      console.error('[MAIN] KeyboardController init failed:', err.message);
    }
  }
  
  if (MouseController) {
    try {
      mouseController = new MouseController();
      mouseController.on('log', sendLog);
      console.log('[MAIN] MouseController initialized');
    } catch (err) {
      console.error('[MAIN] MouseController init failed:', err.message);
    }
  }
  
  if (ConnectionManager) {
    try {
      connectionManager = new ConnectionManager();
      setupConnectionHandlers();
      console.log('[MAIN] ConnectionManager initialized');
    } catch (err) {
      console.error('[MAIN] ConnectionManager init failed:', err.message);
    }
  }
  
  if (DiscoveryService) {
    try {
      discoveryService = new DiscoveryService();
      discoveryService.on('server-found', (url) => {
        mainWindow?.webContents.send('server-found', url);
      });
      discoveryService.startBrowsing();
      console.log('[MAIN] DiscoveryService initialized');
    } catch (err) {
      console.error('[MAIN] DiscoveryService init failed:', err.message);
    }
  }
  
  console.log('[MAIN] All services initialized - app should stay running');
  
  // Auto-connect after 3 seconds with full error protection
  setTimeout(() => {
    try {
      if (connectionManager) {
        console.log('[MAIN] Auto-connecting to vsteps.org...');
        connectionManager.connect(DEFAULT_SERVER_URL);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('auto-connect', DEFAULT_SERVER_URL);
        }
        sendLog({ type: 'info', message: 'Connecting to vsteps.org...' });
      }
    } catch (err) {
      console.error('[MAIN] Auto-connect error:', err.message);
    }
  }, 3000);
}

function setupConnectionHandlers() {
  if (!connectionManager) return;
  
  connectionManager.on('log', sendLog);
  
  connectionManager.on('connected', () => {
    mainWindow?.webContents.send('connection-status', 'connected');
    sendLog({ type: 'success', message: 'Connected to vsteps.org' });
  });
  
  // Session-based pairing events
  connectionManager.on('session-created', (data) => {
    mainWindow?.webContents.send('session-created', data);
  });
  
  connectionManager.on('phone-connected', (data) => {
    mainWindow?.webContents.send('phone-connected', data);
  });
  
  connectionManager.on('connection-failed', (error) => {
    mainWindow?.webContents.send('connection-status', 'error');
    sendLog({ type: 'error', message: `Connection failed: ${error}` });
  });
  
  connectionManager.on('disconnected', () => {
    keyboardController?.releaseAllKeys();
    aKeyHeld = false;
    dKeyHeld = false;
    mainWindow?.webContents.send('connection-status', 'disconnected');
    mainWindow?.webContents.send('p2p-status', { connected: false });
  });

  connectionManager.on('p2p-status', (status) => {
    mainWindow?.webContents.send('p2p-status', status);
  });

  connectionManager.on('release-all-keys', () => {
    keyboardController?.releaseAllKeys();
  });
  
  connectionManager.on('movement', async (data) => {
    const holdDuration = data.holdDuration ?? keyboardController?.holdDuration ?? 800;
    const allowDiagonal = data.allowDiagonal !== false;
    
    if (wKeyBlocked && data.direction === 'forward') {
      blockingPaused = true;
      setTimeout(() => { blockingPaused = false; }, holdDuration + 100);
    }
    
    await keyboardController?.handleMovement(
      data.direction, 
      data.isSprint || false, 
      holdDuration,
      allowDiagonal
    );
    
    mainWindow?.webContents.send('movement', { direction: data.direction, holdDuration, isSprint: data.isSprint });
  });

  connectionManager.on('lateral', async (data) => {
    if (!steerEnabled) return;
    await keyboardController?.handleLateral(data.direction, data.allowDiagonal !== false);
    mainWindow?.webContents.send('lateral', data);
  });

  connectionManager.on('jump', async () => {
    await keyboardController?.handleJump();
    mainWindow?.webContents.send('jump');
  });

  connectionManager.on('tilt', (data) => {
    mainWindow?.webContents.send('tilt', data);
  });
  
  connectionManager.on('apex-gate', async (data) => {
    await keyboardController?.handleApexGate(data);
    mainWindow?.webContents.send('apex-gate', data);
  });

  connectionManager.on('sensor-data', (data) => {
    mainWindow?.webContents.send('sensor-data', data);
  });

  connectionManager.on('phone-settings', (settings) => {
    mainWindow?.webContents.send('phone-settings', settings);
  });

  connectionManager.on('stats', (stats) => {
    mainWindow?.webContents.send('stats-update', stats);
  });
  
  connectionManager.on('vsteps-config-update', (config) => {
    if (keyboardController) {
      keyboardController.holdDuration = config.walkingFlow || 800;
    }
    mainWindow?.webContents.send('config-synced', config);
    sendLog({ type: 'info', message: `Settings synced from mobile` });
  });
}

function initKeyboardBlocker() {
  try {
    uioHook = require('uiohook-napi');
    console.log('[MAIN] uiohook-napi loaded');
    
    uioHook.uIOhook.on('keydown', (e) => {
      if (blockingPaused) return;
      const isInjected = e.isInjected || e.isTrusted === false;
      if (wKeyBlocked && !isInjected && (e.keycode === 17 || e.keycode === 0x11)) {
        e.preventDefault = true;
      }
    });
  } catch (err) {
    console.log('[MAIN] uiohook-napi not available');
  }
}

function startKeyboardBlocking() {
  if (uioHook && !wKeyBlocked) {
    try {
      uioHook.uIOhook.start();
      wKeyBlocked = true;
      mainWindow?.webContents.send('w-key-block-status', { enabled: true, success: true });
    } catch (err) {
      wKeyBlocked = false;
      mainWindow?.webContents.send('w-key-block-status', { enabled: false, success: false, error: err.message });
    }
  }
}

function stopKeyboardBlocking() {
  if (uioHook && wKeyBlocked) {
    try {
      uioHook.uIOhook.stop();
      wKeyBlocked = false;
    } catch (err) {
      console.error('[MAIN] Stop blocking error:', err.message);
    }
  }
}

function getLocalIPAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

// IPC Handlers
ipcMain.on('connect-manual', (event, serverUrl) => {
  if (connectionManager) {
    connectionManager.connect(serverUrl || DEFAULT_SERVER_URL);
  }
});

ipcMain.on('disconnect', () => {
  connectionManager?.disconnect();
  keyboardController?.releaseAllKeys();
});

ipcMain.on('get-status', () => {
  mainWindow?.webContents.send('connection-status', connectionManager?.isConnected ? 'connected' : 'disconnected');
  mainWindow?.webContents.send('steer-status', { enabled: steerEnabled });
});

ipcMain.on('settings-update', (event, settings) => {
  if (keyboardController && settings.holdDuration !== undefined) {
    keyboardController.holdDuration = settings.holdDuration;
  }
});

ipcMain.on('toggle-disable-w-key', (event, enabled) => {
  if (enabled) {
    startKeyboardBlocking();
  } else {
    stopKeyboardBlocking();
    mainWindow?.webContents.send('w-key-block-status', { enabled: false, success: true });
  }
});

ipcMain.on('toggle-steer-enabled', (event, enabled) => {
  steerEnabled = enabled;
  if (!enabled) {
    keyboardController?.lateralManager?.releaseAll();
    aKeyHeld = false;
    dKeyHeld = false;
  }
  mainWindow?.webContents.send('steer-status', { enabled });
});

ipcMain.handle('generate-qr-code', async (event, urlOrBase) => {
  if (!QRCode) {
    return { success: false, error: 'QR Code module not available' };
  }
  
  try {
    // If it already looks like a full URL with path, use it directly
    // Otherwise, append /controller
    let controllerUrl = urlOrBase;
    if (!urlOrBase.includes('/controller')) {
      controllerUrl = `${urlOrBase}/controller`;
    }
    
    const dataUrl = await QRCode.toDataURL(controllerUrl, {
      width: 200,
      margin: 1,
      color: { dark: '#ffffff', light: '#00000000' }
    });
    return { success: true, dataUrl, url: controllerUrl };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-local-ip', async () => {
  return getLocalIPAddress();
});

// Keep-alive interval to prevent app from exiting
let keepAliveInterval = null;
let heartbeatCount = 0;

// App lifecycle
app.whenReady().then(async () => {
  console.log('[MAIN] ========================================');
  console.log('[MAIN] VSteps Desktop v2.1.0 starting...');
  console.log('[MAIN] ========================================');
  
  // Keep the process alive with visible heartbeat
  keepAliveInterval = setInterval(() => {
    heartbeatCount++;
    if (heartbeatCount % 5 === 0) {
      console.log(`[HEARTBEAT] App alive - ${heartbeatCount}s`);
    }
  }, 1000);
  
  // Step 1: Create window FIRST
  createWindow();
  
  // Step 2: Create tray
  createTray();
  
  // Step 3: Wait for window to be ready, then load modules
  mainWindow.webContents.on('did-finish-load', async () => {
    console.log('[MAIN] Window ready, loading modules...');
    
    await loadModules();
    initializeServices();
    initKeyboardBlocker();
    
    sendLog({ type: 'info', message: 'VSteps Desktop ready!' });
    console.log('[MAIN] Initialization complete!');
    console.log('[MAIN] App is now running. Window should be visible.');
  });
});

app.on('window-all-closed', (event) => {
  // Don't quit - keep running in tray
  console.log('[MAIN] window-all-closed event - NOT quitting');
  // Explicitly prevent default
  if (event && event.preventDefault) {
    event.preventDefault();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', async () => {
  console.log('[MAIN] Quitting...');
  app.isQuitting = true;
  
  // Clear keep-alive
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
  }
  
  stopKeyboardBlocking();
  await keyboardController?.releaseAllKeys();
  connectionManager?.disconnect();
  discoveryService?.stop();
});
