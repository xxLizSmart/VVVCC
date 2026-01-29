const EventEmitter = require('events');

class LateralKeyManager {
  constructor(keyboardController) {
    this.controller = keyboardController;
    this.currentDirection = null;
    this.allowDiagonal = true;
  }

  async handleLateral(direction, allowDiagonal = true) {
    const keyboard = this.controller.keyboard;
    const Key = this.controller.Key;
    if (!keyboard || !Key) return;
    
    this.allowDiagonal = allowDiagonal;
    
    if (this.currentDirection && this.currentDirection !== direction) {
      await this.releaseDirection(this.currentDirection);
    }
    
    if (!allowDiagonal && direction !== null) {
      await this.controller.forceReleaseW();
    }
    
    if (direction === 'left' && this.currentDirection !== 'left') {
      try {
        await keyboard.pressKey(Key.A);
        this.currentDirection = 'left';
        this.controller.emit('log', { type: 'lateral', message: "'A' key DOWN - Strafing Left", action: 'press' });
      } catch (err) {
        console.error('[KEYBOARD] Failed to press A:', err.message);
      }
    } else if (direction === 'right' && this.currentDirection !== 'right') {
      try {
        await keyboard.pressKey(Key.D);
        this.currentDirection = 'right';
        this.controller.emit('log', { type: 'lateral', message: "'D' key DOWN - Strafing Right", action: 'press' });
      } catch (err) {
        console.error('[KEYBOARD] Failed to press D:', err.message);
      }
    } else if (direction === null && this.currentDirection !== null) {
      await this.releaseDirection(this.currentDirection);
    }
  }
  
  isSteeringActive() {
    return this.currentDirection !== null;
  }

  async releaseDirection(direction) {
    const keyboard = this.controller.keyboard;
    const Key = this.controller.Key;
    if (!keyboard || !Key) return;
    
    try {
      if (direction === 'left') {
        await keyboard.releaseKey(Key.A);
        this.controller.emit('log', { type: 'lateral', message: "'A' key UP - Strafe Stopped", action: 'release' });
      } else if (direction === 'right') {
        await keyboard.releaseKey(Key.D);
        this.controller.emit('log', { type: 'lateral', message: "'D' key UP - Strafe Stopped", action: 'release' });
      }
      this.currentDirection = null;
    } catch (err) {
      console.error('[KEYBOARD] Failed to release lateral key:', err.message);
    }
  }

  async releaseAll() {
    if (this.currentDirection) {
      await this.releaseDirection(this.currentDirection);
    }
  }
}

class DirectKeyHandler {
  constructor(keyboardController) {
    this.controller = keyboardController;
    this.activeKeys = new Set();
  }

  async handleInput(msg) {
    const keyboard = this.controller.keyboard;
    const Key = this.controller.Key;
    if (!keyboard || !Key) return;
    
    const { press = [], release = [] } = msg;
    
    for (const k of release) {
      const keyCode = this.mapKey(k);
      if (keyCode) {
        try {
          await keyboard.releaseKey(keyCode);
          if (this.activeKeys.has(k)) {
            this.activeKeys.delete(k);
            this.controller.emit('log', { type: 'apex-gate', message: `'${k.toUpperCase()}' UP`, action: 'release' });
          }
        } catch (err) {
        }
      }
    }
    
    for (const k of press) {
      const keyCode = this.mapKey(k);
      if (keyCode && !this.activeKeys.has(k)) {
        try {
          await keyboard.pressKey(keyCode);
          this.activeKeys.add(k);
          this.controller.emit('log', { type: 'apex-gate', message: `'${k.toUpperCase()}' DOWN`, action: 'press' });
        } catch (err) {
          console.error(`[KEYBOARD] Press ${k}:`, err.message);
        }
      }
    }
  }
  
  mapKey(k) {
    const Key = this.controller.Key;
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
    const keyboard = this.controller.keyboard;
    const Key = this.controller.Key;
    if (!keyboard || !Key) return;
    
    for (const k of this.activeKeys) {
      const keyCode = this.mapKey(k);
      if (keyCode) {
        try {
          await keyboard.releaseKey(keyCode);
          this.controller.emit('log', { type: 'apex-gate', message: `'${k.toUpperCase()}' released (safety)`, action: 'release' });
        } catch (err) {
          console.error(`[KEYBOARD] Release ${k}:`, err.message);
        }
      }
    }
    this.activeKeys.clear();
  }
  
  getActiveKeys() {
    return Array.from(this.activeKeys);
  }
}

class KeyboardController extends EventEmitter {
  constructor() {
    super();
    this.keyboard = null;
    this.Key = null;
    this.heldKeys = new Map();
    this.holdDuration = 800;
    this.isShiftHeld = false;
    this.stepAccumulation = new Map();
    this.initialized = false;
    
    this.lateralManager = null;
    this.directKeyHandler = null;
    
    this.initKeyboard();
  }

  async initKeyboard() {
    try {
      const nutjs = await import('@nut-tree-fork/nut-js');
      this.keyboard = nutjs.keyboard;
      this.Key = nutjs.Key;
      
      nutjs.keyboard.config.autoDelayMs = 0;
      
      this.lateralManager = new LateralKeyManager(this);
      this.directKeyHandler = new DirectKeyHandler(this);
      
      this.initialized = true;
      console.log('[KEYBOARD] nut.js loaded - zero latency mode enabled');
      this.emit('log', { type: 'info', message: 'Keyboard simulation ready (nut.js)' });
      return true;
    } catch (err) {
      console.error('[KEYBOARD] Failed to load nut.js:', err.message);
      
      let helpMsg = `Keyboard disabled: ${err.message}`;
      if (err.message.includes('prebuild') || err.message.includes('native')) {
        helpMsg = 'Keyboard disabled: Native module not found. Try running "npm rebuild" or reinstalling.';
      } else if (err.message.includes('permission') || err.message.includes('access')) {
        helpMsg = 'Keyboard disabled: Permission denied. Try running as Administrator.';
      }
      
      this.emit('log', { type: 'error', message: helpMsg });
      return false;
    }
  }

  getKeyForDirection(direction) {
    return 'W';
  }

  async handleMovement(direction, isSprint = false, customHoldDuration = null, allowDiagonal = true) {
    if (!this.keyboard || !this.Key) return;
    
    if (!allowDiagonal && this.lateralManager && this.lateralManager.isSteeringActive()) {
      this.emit('log', { type: 'info', message: 'Step skipped - Steering takes priority (diagonal OFF)' });
      return;
    }
    
    if (!allowDiagonal && direction === 'forward' && this.lateralManager) {
      await this.lateralManager.releaseAll();
    }
    
    const keyName = this.getKeyForDirection(direction);
    if (!keyName) return;
    
    const key = this.Key[keyName];
    const duration = customHoldDuration || this.holdDuration;

    if (isSprint && !this.isShiftHeld) {
      try {
        await this.keyboard.pressKey(this.Key.LeftShift);
        this.isShiftHeld = true;
        this.emit('log', { type: 'sprint', message: 'SHIFT key DOWN' });
      } catch (err) {
        console.error('[KEYBOARD] Failed to press Shift:', err.message);
      }
    }

    const keyAlreadyHeld = this.heldKeys.has(keyName);
    
    if (keyAlreadyHeld) {
      clearTimeout(this.heldKeys.get(keyName).timer);
    } else {
      try {
        await this.keyboard.pressKey(key);
        const sprint = isSprint ? ' SPRINT' : '';
        this.emit('log', { 
          type: direction, 
          message: `'${keyName}' key DOWN${sprint}`,
          action: 'press'
        });
      } catch (err) {
        console.error('[KEYBOARD] Failed to press key:', err.message);
      }
    }

    const timer = setTimeout(async () => {
      await this.stopKey(keyName, direction);
    }, duration);

    this.heldKeys.set(keyName, { timer, pressedAt: Date.now(), isSprint, duration });
    
    return duration;
  }

  async forceReleaseW() {
    if (!this.keyboard || !this.Key) return;
    
    if (this.heldKeys.has('W')) {
      try {
        await this.keyboard.releaseKey(this.Key.W);
        const data = this.heldKeys.get('W');
        if (data && data.timer) clearTimeout(data.timer);
        this.heldKeys.delete('W');
        this.emit('log', { type: 'info', message: "'W' released - Steering takes priority" });
      } catch (err) {
        console.error('[KEYBOARD] Failed to force release W:', err.message);
      }
    }
  }

  async handleLateral(direction, allowDiagonal = true) {
    if (this.lateralManager) {
      await this.lateralManager.handleLateral(direction, allowDiagonal);
    }
  }

  async handleApexGate(data) {
    if (this.directKeyHandler) {
      await this.directKeyHandler.handleInput(data);
    }
  }

  async stopKey(keyName, direction) {
    if (!this.keyboard || !this.Key) return;
    
    const key = this.Key[keyName];
    
    if (this.heldKeys.has(keyName)) {
      try {
        await this.keyboard.releaseKey(key);
        this.heldKeys.delete(keyName);
        this.emit('log', { 
          type: direction, 
          message: `'${keyName}' key UP`,
          action: 'release'
        });
      } catch (err) {
        console.error('[KEYBOARD] Failed to release key:', err.message);
      }
    }

    if (this.heldKeys.size === 0 && this.isShiftHeld) {
      try {
        await this.keyboard.releaseKey(this.Key.LeftShift);
        this.isShiftHeld = false;
        this.emit('log', { type: 'sprint', message: 'SHIFT key UP' });
      } catch (err) {
        console.error('[KEYBOARD] Failed to release Shift:', err.message);
      }
    }
  }

  async handleJump() {
    if (!this.keyboard || !this.Key) return;
    
    try {
      await this.keyboard.pressKey(this.Key.Space);
      await this.keyboard.releaseKey(this.Key.Space);
      this.emit('log', { type: 'jump', message: 'SPACE pressed', action: 'tap' });
    } catch (err) {
      console.error('[KEYBOARD] Failed to tap Space:', err.message);
    }
  }

  async pressKey(keyName) {
    if (!this.keyboard || !this.Key) return false;
    
    const key = this.Key[keyName];
    if (!key) return false;
    
    try {
      await this.keyboard.pressKey(key);
      return true;
    } catch (err) {
      console.error(`[KEYBOARD] Failed to press ${keyName}:`, err.message);
      return false;
    }
  }

  async releaseKey(keyName) {
    if (!this.keyboard || !this.Key) return false;
    
    const key = this.Key[keyName];
    if (!key) return false;
    
    try {
      await this.keyboard.releaseKey(key);
      return true;
    } catch (err) {
      console.error(`[KEYBOARD] Failed to release ${keyName}:`, err.message);
      return false;
    }
  }

  async releaseAllKeys() {
    if (!this.keyboard || !this.Key) return;
    
    for (const [keyName, data] of this.heldKeys) {
      clearTimeout(data.timer);
      const key = this.Key[keyName];
      try {
        await this.keyboard.releaseKey(key);
        console.log(`[SAFETY] '${keyName}' released`);
      } catch (err) {
        console.error('[KEYBOARD] Failed to release key:', err.message);
      }
    }
    this.heldKeys.clear();
    
    if (this.isShiftHeld) {
      try {
        await this.keyboard.releaseKey(this.Key.LeftShift);
        this.isShiftHeld = false;
        console.log('[SAFETY] SHIFT released');
      } catch (err) {
        console.error('[KEYBOARD] Failed to release Shift:', err.message);
      }
    }
    
    if (this.lateralManager) {
      await this.lateralManager.releaseAll();
    }
    
    if (this.directKeyHandler) {
      await this.directKeyHandler.releaseAll();
    }
    
    const safetyKeys = ['W', 'A', 'D', 'Space', 'LeftShift'];
    for (const keyName of safetyKeys) {
      try {
        const key = this.Key[keyName];
        if (key) await this.keyboard.releaseKey(key);
      } catch (err) {
      }
    }
    
    this.emit('log', { type: 'info', message: 'All keys released (safety)' });
  }

  setHoldDuration(ms) {
    this.holdDuration = ms;
  }
}

module.exports = { KeyboardController };
