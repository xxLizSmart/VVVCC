#!/usr/bin/env python3
"""
Step-to-Keyboard Bridge - PC Receiver Script (Sustained Key Holds)

This script connects to the Step-to-Keyboard Bridge relay server and 
simulates keyboard presses based on detected movement direction.

Movement uses SUSTAINED KEY HOLDS for smooth control (0.8s timeout like StepL):
  - Walk forward → Hold 'W' key (releases 0.8s after last step)
  - Sprint → Hold Shift + 'W' key (for faster/harder steps)

Jump uses quick press:
  - Tap jump button → Press Space key

Requirements:
  pip install python-socketio pydirectinput websocket-client

Usage:
  1. Start the web app on Replit
  2. Run this script: python pc_receiver.py
  3. Open a game that uses WASD + Space for movement
  4. Walk in place with your phone to control movement!
  5. Tap the Jump button on screen to jump!

Note: Uses PyDirectInput for game compatibility (DirectInput API).
      Keys are HELD DOWN while walking, not spammed.
"""

import socketio
import pydirectinput
import time
import sys
import threading
import atexit
import signal

# Configuration - Update this URL to your Replit app URL
SERVER_URL = input("Enter the server URL (e.g., https://your-app.replit.app): ").strip()

if not SERVER_URL:
    print("Error: Server URL is required!")
    sys.exit(1)

# Ensure pydirectinput doesn't pause between actions
pydirectinput.PAUSE = 0.01

# Hold duration in seconds (how long key stays held after last step)
# 0.8s matches StepL's responsive timeout for natural movement feel
HOLD_DURATION = 0.8

class KeyHoldManager:
    """
    Manages sustained key holds for smooth movement.
    
    When a step is detected:
    - If key not held: press keyDown and start release timer
    - If key already held: cancel old timer, start new one (extend hold)
    
    Key is released (keyUp) when timer expires (no new steps for HOLD_DURATION).
    
    Includes a watchdog thread that periodically checks for stuck keys
    and releases them if their deadline has passed.
    """
    
    def __init__(self):
        self.held_keys = {}      # key -> True if currently held
        self.timers = {}         # key -> Timer object
        self.deadlines = {}      # key -> timestamp when key should be released
        self.lock = threading.Lock()
        self.running = True
        self.key_map = {
            "forward": "w",
        }
        self.direction_map = {v: k for k, v in self.key_map.items()}
        
        # Start watchdog thread
        self.watchdog = threading.Thread(target=self._watchdog_loop, daemon=True)
        self.watchdog.start()
    
    def _watchdog_loop(self):
        """Background thread that checks for stuck keys every 0.5 seconds."""
        while self.running:
            time.sleep(0.5)
            self._check_expired_keys()
    
    def _check_expired_keys(self):
        """Check and release any keys past their deadline."""
        current_time = time.time()
        with self.lock:
            for key, deadline in list(self.deadlines.items()):
                if deadline is not None and current_time > deadline:
                    if self.held_keys.get(key, False):
                        try:
                            pydirectinput.keyUp(key)
                            direction = self.direction_map.get(key, "unknown")
                            arrow = {"forward": "↑"}.get(direction, "•")
                            print(f"[{arrow} {direction.upper():7}] '{key.upper()}' key UP (watchdog release)")
                        except:
                            pass
                        self.held_keys[key] = False
                    self.deadlines[key] = None
        
    def hold_key(self, direction):
        """Start or extend a key hold for the given direction."""
        if direction not in self.key_map:
            return
            
        key = self.key_map[direction]
        current_time = time.time()
        
        with self.lock:
            # Cancel existing timer if any
            if key in self.timers and self.timers[key] is not None:
                self.timers[key].cancel()
            
            # Update deadline for watchdog
            self.deadlines[key] = current_time + HOLD_DURATION
            
            # If key not currently held, press it down
            if not self.held_keys.get(key, False):
                pydirectinput.keyDown(key)
                self.held_keys[key] = True
                arrow = {"forward": "↑"}.get(direction, "•")
                print(f"[{arrow} {direction.upper():7}] '{key.upper()}' key DOWN (holding...)")
            else:
                # Key already held, just extending
                arrow = {"forward": "↑"}.get(direction, "•")
                print(f"[{arrow} {direction.upper():7}] '{key.upper()}' hold extended")
            
            # Start new timer to release key after HOLD_DURATION
            timer = threading.Timer(HOLD_DURATION, self._release_key, args=[key, direction])
            timer.daemon = True
            timer.start()
            self.timers[key] = timer
    
    def _release_key(self, key, direction):
        """Release a key after the hold duration expires."""
        with self.lock:
            if self.held_keys.get(key, False):
                pydirectinput.keyUp(key)
                self.held_keys[key] = False
                arrow = {"forward": "↑"}.get(direction, "•")
                print(f"[{arrow} {direction.upper():7}] '{key.upper()}' key UP (released)")
            self.timers[key] = None
            self.deadlines[key] = None
    
    def stop(self):
        """Stop the watchdog thread."""
        self.running = False
    
    def release_all(self):
        """Release all held keys immediately (safety mechanism)."""
        with self.lock:
            # Cancel all timers
            for key, timer in self.timers.items():
                if timer is not None:
                    timer.cancel()
            self.timers.clear()
            self.deadlines.clear()
            
            # Release all held keys
            for key, is_held in list(self.held_keys.items()):
                if is_held:
                    try:
                        pydirectinput.keyUp(key)
                        print(f"[SAFETY] '{key.upper()}' key released")
                    except:
                        pass
            self.held_keys.clear()

# Global key hold manager
key_manager = KeyHoldManager()

# Create Socket.IO client
sio = socketio.Client(
    reconnection=True,
    reconnection_attempts=10,
    reconnection_delay=1,
)

# Track counts
walk_counts = {"forward": 0}
jump_count = 0

@sio.event
def connect():
    print(f"\n[CONNECTED] Successfully connected to {SERVER_URL}")
    print("[INFO] Waiting for movement... Walk in place with your phone!")
    print("\n[INFO] Movement controls (SUSTAINED HOLDS):")
    print(f"         - Walk forward  → Hold 'W' key (releases after {HOLD_DURATION}s)")
    print(f"         - Sprint        → Hold Shift + 'W' key")
    print("         - Jump button   → Press Space key")
    print("\n[INFO] Press Ctrl+C to stop\n")

@sio.event
def connect_error(data):
    print(f"[ERROR] Connection failed: {data}")

@sio.event
def disconnect():
    print("\n[DISCONNECTED] Lost connection to server")
    # Safety: release all keys on disconnect
    key_manager.release_all()

@sio.on("movement-detected")
def on_movement_detected(data):
    global walk_counts
    
    direction = data.get("direction", "forward")
    walk_counts[direction] = walk_counts.get(direction, 0) + 1
    
    # Hold the key (or extend if already held)
    key_manager.hold_key(direction)

@sio.on("jump-detected")
def on_jump_detected():
    global jump_count
    
    jump_count += 1
    pydirectinput.press('space')
    print(f"[⬆ JUMP    ] 'SPACE' key pressed! (Count: {jump_count})")

@sio.on("step-detected")
def on_step_detected(data):
    """Legacy support for old step-detected events"""
    global walk_counts
    
    walk_counts["forward"] = walk_counts.get("forward", 0) + 1
    key_manager.hold_key("forward")

@sio.on("step-count-update")
def on_step_count_update(data):
    count = data.get("count", 0)
    print(f"[SYNC] Server total step count: {count}")

@sio.on("direction-counts-update")  
def on_direction_counts_update(data):
    f = data.get("forward", 0)
    print(f"[SYNC] Direction counts - Forward: {f}")

def cleanup():
    """Cleanup function to release all keys on exit."""
    print("\n[CLEANUP] Releasing all held keys...")
    key_manager.stop()
    key_manager.release_all()

# Register cleanup handlers
atexit.register(cleanup)

def signal_handler(sig, frame):
    """Handle Ctrl+C gracefully."""
    cleanup()
    sys.exit(0)

signal.signal(signal.SIGINT, signal_handler)
signal.signal(signal.SIGTERM, signal_handler)

def main():
    print("\n" + "=" * 60)
    print("  Step-to-Keyboard Bridge - Sustained Key Hold Control")
    print("=" * 60)
    print(f"\n[INFO] Connecting to: {SERVER_URL}")
    print(f"[INFO] Key hold duration: {HOLD_DURATION} seconds")
    
    try:
        sio.connect(
            SERVER_URL,
            transports=["websocket", "polling"],
            wait_timeout=10,
        )
        
        # Keep the script running
        sio.wait()
        
    except KeyboardInterrupt:
        pass
    except Exception as e:
        print(f"\n[ERROR] {str(e)}")
        print("\nTroubleshooting tips:")
        print("  1. Make sure the Replit app is running")
        print("  2. Check that the URL is correct (include https://)")
        print("  3. Ensure your firewall allows the connection")
    finally:
        cleanup()
        if sio.connected:
            sio.disconnect()
        print(f"\n[STATS] Session summary:")
        print(f"        Walk counts - Forward: {walk_counts['forward']}")
        print(f"        Jump count  - {jump_count}")
        print("[INFO] Goodbye!")

if __name__ == "__main__":
    main()
