#!/usr/bin/env python3
"""
VSteps UDP Receiver - Ultra-Low Latency Step-to-Keyboard Bridge

This script provides the LOWEST POSSIBLE LATENCY by using UDP sockets
for step detection. Use this with a native mobile app that sends UDP packets.

IMPORTANT: This requires a NATIVE mobile app (not the web controller) that 
can send UDP packets directly. The web controller uses WebSocket instead.

Packet Format:
  - "STEP" or "STEP:forward" → Hold 'W' key
  - "JUMP" → Press Space key
  - "SPRINT" or "SPRINT:forward" → Hold Shift + 'W' key

Movement uses SUSTAINED KEY HOLDS (0.8s timeout like StepL):
  - Each step extends the hold duration
  - Key releases 0.8s after the last step

Requirements:
  pip install pynput

Usage:
  1. Run this script: python pc_receiver_udp.py
  2. Configure your native mobile app to send UDP to your PC's IP:5005
  3. Open a game that uses WASD + Space for movement
  4. Walk in place to control movement!

Note: For the web-based controller, use pc_receiver.py instead.
"""

import socket
import threading
import time
import sys
import atexit
import signal
from pynput.keyboard import Key, Controller

# --- CONFIGURATION ---
UDP_IP = "0.0.0.0"       # Listen on all available network interfaces
UDP_PORT = 5005          # Port to listen on
STOP_DELAY = 0.8         # The "Stop Delay" (seconds) - matches StepL's 0.8s timeout

# Key mappings
KEY_MAP = {
    'forward': 'w',
}

keyboard = Controller()

class KeyHoldManager:
    """
    Manages sustained key holds for smooth movement.
    
    When a step is detected:
    - If key not held: press key and start release timer
    - If key already held: reset timer (extend hold)
    
    Key is released when timer expires (no new steps for STOP_DELAY).
    """
    
    def __init__(self):
        self.held_keys = {}      # key -> True if currently held
        self.last_step_time = {} # key -> timestamp of last step
        self.is_shift_held = False
        self.lock = threading.Lock()
        self.running = True
        
        # Start watchdog thread
        self.watchdog = threading.Thread(target=self._watchdog_loop, daemon=True)
        self.watchdog.start()
    
    def _watchdog_loop(self):
        """Background thread that checks for expired key holds every 50ms."""
        while self.running:
            time.sleep(0.05)
            self._check_expired_keys()
    
    def _check_expired_keys(self):
        """Check and release any keys past their deadline."""
        current_time = time.time()
        with self.lock:
            keys_to_release = []
            for key, last_time in list(self.last_step_time.items()):
                if last_time is not None and (current_time - last_time > STOP_DELAY):
                    if self.held_keys.get(key, False):
                        keys_to_release.append(key)
            
            for key in keys_to_release:
                try:
                    keyboard.release(key)
                    direction = {v: k for k, v in KEY_MAP.items()}.get(key, "unknown")
                    arrow = {"forward": "↑"}.get(direction, "•")
                    print(f"[{arrow} {direction.upper():8}] '{key.upper()}' key UP (timeout)")
                except Exception as e:
                    pass
                self.held_keys[key] = False
                self.last_step_time[key] = None
            
            # Release shift if no movement keys are held
            if self.is_shift_held and not any(self.held_keys.values()):
                try:
                    keyboard.release(Key.shift)
                    print("[SPRINT    ] 'SHIFT' key UP")
                except:
                    pass
                self.is_shift_held = False
    
    def hold_key(self, direction, is_sprint=False):
        """Start or extend a key hold for the given direction."""
        if direction not in KEY_MAP:
            direction = 'forward'  # Default to forward
            
        key = KEY_MAP[direction]
        current_time = time.time()
        
        with self.lock:
            # Update last step time
            self.last_step_time[key] = current_time
            
            # Handle sprint (Shift key)
            if is_sprint and not self.is_shift_held:
                keyboard.press(Key.shift)
                self.is_shift_held = True
                print("[SPRINT    ] 'SHIFT' key DOWN")
            
            # If key not currently held, press it down
            if not self.held_keys.get(key, False):
                keyboard.press(key)
                self.held_keys[key] = True
                arrow = {"forward": "↑"}.get(direction, "•")
                sprint_label = " SPRINT" if is_sprint else ""
                print(f"[{arrow} {direction.upper():8}] '{key.upper()}' key DOWN{sprint_label} (holding...)")
            else:
                # Key already held, just extending
                arrow = {"forward": "↑"}.get(direction, "•")
                print(f"[{arrow} {direction.upper():8}] '{key.upper()}' hold extended")
    
    def tap_key(self, key):
        """Quick tap a key (for jump)."""
        with self.lock:
            keyboard.press(key)
            keyboard.release(key)
    
    def stop(self):
        """Stop the watchdog thread."""
        self.running = False
    
    def release_all(self):
        """Release all held keys immediately (safety mechanism)."""
        with self.lock:
            # Release shift if held
            if self.is_shift_held:
                try:
                    keyboard.release(Key.shift)
                    print("[SAFETY] 'SHIFT' key released")
                except:
                    pass
                self.is_shift_held = False
            
            # Release all held keys
            for key, is_held in list(self.held_keys.items()):
                if is_held:
                    try:
                        keyboard.release(key)
                        print(f"[SAFETY] '{key.upper()}' key released")
                    except:
                        pass
            self.held_keys.clear()
            self.last_step_time.clear()


# Global key hold manager
key_manager = KeyHoldManager()

# Track counts
step_counts = {"forward": 0}
jump_count = 0
sprint_count = 0


def parse_message(message):
    """Parse incoming UDP message and return (action, direction, is_sprint)."""
    message = message.strip().upper()
    
    if message == "JUMP":
        return ("jump", None, False)
    
    if message.startswith("SPRINT"):
        parts = message.split(":")
        direction = parts[1].lower() if len(parts) > 1 else "forward"
        return ("step", direction, True)
    
    if message.startswith("STEP"):
        parts = message.split(":")
        direction = parts[1].lower() if len(parts) > 1 else "forward"
        return ("step", direction, False)
    
    return (None, None, False)


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


def get_local_ip():
    """Get the local IP address for display."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except:
        return "127.0.0.1"


def main():
    global step_counts, jump_count, sprint_count
    
    local_ip = get_local_ip()
    
    print("\n" + "=" * 60)
    print("  VSteps UDP Receiver - Ultra-Low Latency Mode")
    print("=" * 60)
    print(f"\n[INFO] Listening on UDP port {UDP_PORT}")
    print(f"[INFO] Your PC's IP address: {local_ip}")
    print(f"[INFO] Configure your native app to send to: {local_ip}:{UDP_PORT}")
    print(f"[INFO] Stop delay: {STOP_DELAY}s (matches StepL)")
    print("\n[INFO] Supported packets:")
    print("         - STEP or STEP:forward  → Hold 'W' key")
    print("         - SPRINT:forward        → Hold Shift + 'W'")
    print("         - JUMP                  → Press Space")
    print("\n[INFO] Press Ctrl+C to stop\n")
    print("-" * 60)
    
    # Initialize UDP Socket
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind((UDP_IP, UDP_PORT))
    
    print(f"[READY] Waiting for UDP packets on port {UDP_PORT}...\n")
    
    try:
        while True:
            data, addr = sock.recvfrom(1024)
            message = data.decode().strip()
            
            action, direction, is_sprint = parse_message(message)
            
            if action == "step":
                step_counts[direction] = step_counts.get(direction, 0) + 1
                if is_sprint:
                    sprint_count += 1
                key_manager.hold_key(direction, is_sprint)
                
            elif action == "jump":
                jump_count += 1
                key_manager.tap_key(Key.space)
                print(f"[⬆ JUMP    ] 'SPACE' pressed! (Count: {jump_count})")
                
    except KeyboardInterrupt:
        pass
    finally:
        cleanup()
        sock.close()
        print(f"\n[STATS] Session summary:")
        print(f"        Steps  - Forward: {step_counts.get('forward', 0)}")
        print(f"        Sprints: {sprint_count}")
        print(f"        Jumps:   {jump_count}")
        print("[INFO] Goodbye!")


if __name__ == "__main__":
    main()
