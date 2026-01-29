const EventEmitter = require('events');

class MouseController extends EventEmitter {
  constructor() {
    super();
    this.mouse = null;
    this.initialized = false;
    this.lastMoveTime = 0;
    
    this.initMouse();
  }

  async initMouse() {
    try {
      const nutjs = await import('@nut-tree-fork/nut-js');
      this.mouse = nutjs.mouse;
      
      nutjs.mouse.config.autoDelayMs = 0;
      nutjs.mouse.config.mouseSpeed = 0;
      
      this.initialized = true;
      console.log('[MOUSE] nut.js loaded - zero latency mode enabled');
      this.emit('log', { type: 'info', message: 'Mouse control ready (nut.js)' });
      return true;
    } catch (err) {
      console.error('[MOUSE] Failed to load nut.js:', err.message);
      this.emit('log', { type: 'error', message: `Mouse disabled: ${err.message}` });
      return false;
    }
  }

  async moveMouse(deltaX) {
    if (!this.mouse || !this.initialized) return;
    
    const now = Date.now();
    this.lastMoveTime = now;
    
    try {
      const currentPos = await this.mouse.getPosition();
      const newX = Math.max(0, currentPos.x + deltaX);
      
      await this.mouse.setPosition({ x: newX, y: currentPos.y });
      
      return true;
    } catch (err) {
      console.error('[MOUSE] Failed to move mouse:', err.message);
      return false;
    }
  }

  async moveMouseRelative(deltaX) {
    if (!this.mouse || !this.initialized) return;
    
    try {
      const currentPos = await this.mouse.getPosition();
      const newX = currentPos.x + deltaX;
      
      await this.mouse.setPosition({ x: newX, y: currentPos.y });
      
      return true;
    } catch (err) {
      console.error('[MOUSE] Failed to move mouse relative:', err.message);
      return false;
    }
  }
}

module.exports = { MouseController };
