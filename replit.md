# VSteps - Pure Locomotion Step Controller with PVP Battles

## Overview

VSteps is a full-stack application that transforms your mobile phone into a locomotion controller for PC games and applications. It implements the "Pure Locomotion" (StepL-style) method, allowing users to control PC keyboard input (specifically the 'W' key for forward movement) by walking in place, using their phone's motion sensors. The project also features real-time, competitive PVP step battles, gamification elements, and a robust user authentication system.

The core purpose is to provide an immersive and intuitive way to navigate virtual environments, enhancing accessibility and engagement for users. VSteps aims to pioneer a new form of interactive gaming and exercise, leveraging mobile sensor technology for a unique control scheme.

## User Preferences

I prefer iterative development, with a focus on delivering functional increments. Please ask for clarification if anything is unclear and propose solutions before implementing major changes. I value clear, concise communication and detailed explanations when necessary. I like to be involved in key decision-making processes.

## System Architecture

**UI/UX Design:**
The application features a mobile-responsive web controller with a tactical Obsidian & Red theme: Obsidian Black (#0B0C10) background with Apex Red (#FF0000) neon accents. Key UI elements include:
- **Laser Pulse Monitor:** Canvas-based motion visualizer with neon red line, shadow glow, and pulse flash on valid steps
- **SYSTEM LINK Toggle:** Shows W key status with glowing red active state when isMoving=true
- **Sliders:** Dark grey track with glowing red neon thumb (slider-neon-red class)
- **Step Ring:** Circular counter with Apex Red gradient progress ring that flashes on detection
- **Step Cooldown:** 350ms minimum interval enforced to filter device shaking from actual walking steps
The desktop companion app (VSteps Desktop) offers a dark-themed dashboard. iOS PWA support is included with manifest, service worker, and meta tags for a native-like experience.

**Technical Implementations:**

*   **Web Controller:** Built with React, TypeScript, Vite, TailwindCSS, and Shadcn UI. It uses the `DeviceMotionEvent` API for sensor access, implementing a simplified forward-only detection algorithm.
*   **Sensor Processing:** Utilizes 3-axis linear acceleration magnitude for step detection via raw Euclidean norm (√(x² + y² + z²)). Haptic feedback (navigator.vibrate(10)) on every detected step. Uses `requestAnimationFrame` on mobile for maximum polling frequency.
*   **Apex-Pro Engine:** Consolidated StepL master engine with Triple-Tier system:
    - **Default (Level 2.4):** Baseline + 0.8 - Stable, reliable step detection (debounce 30ms)
    - **Game (Level 2.7):** Baseline + 0.4 - Responsive for competitive gaming (debounce 25ms)
    - **Cruise/Ultra (Level 3.0):** Baseline + 0.1 - Maximum Hair-Trigger (debounce 20ms)
*   **Apex-Pro Controls:**
    - **Trigger Force:** How easy it is to start walking (threshold offset 0.1-0.8)
    - **Walking Flow:** How smooth 'W' stays held between steps (buffer timer, default 800ms)
    - **Reaction Speed:** How fast it detects the next shake (debounce 20-30ms depending on preset)
    - **Ultra-Sensitive Peak Toggle:** Forces W = Baseline + 0.1, A/D = 2° threshold
*   **Apex-Pro Steering (Angle-Based):** Lateral A/D movement using tilt angle detection:
    - **Calibration Shake:** Shake left-right for 2 seconds to auto-detect lateral axis
    - **Axis Auto-Detection:** Finds dominant axis (X, Y, or Z) with highest variance during calibration
    - **SWAP A/D DIRECTION Button:** Easy fix if left/right are reversed after calibration
    - **Turning Sensitivity Slider:** 5°-40° (default 15°), with 1° hysteresis
    - **Ultra-Sensitive Peak:** Toggle for 2° turn trigger - maximum sensitivity
    - **Allow Diagonal (Referee Logic):** ON = W+A/W+D simultaneous, OFF = one key at a time (steering priority)
    - **Haptic Compass:** 20ms pulse on trigger, double-tap [10ms x 2] on release
    - **Pocket Lock:** Black screen mode for phone-in-pocket use
    - **Persistent Settings:** lateralAxis, lateralAxisSign, turningSensitivity, ultraLateralMode, allowDiagonal saved to localStorage
*   **Calibration:** 2-second Silent Check on start to find phone's idle gravity baseline
*   **Persistent Settings:** Mobile saves to localStorage, PC (Electron) saves to `vsteps-config.json`. Settings sync via Socket.io `vsteps-config-update` event.
*   **Relay Server:** A Node.js and Socket.io server facilitates real-time communication, broadcasting `movement-detected` and `jump-detected` events, and tracking step counts.
*   **Session-Based Pairing:** Multi-user support via unique 6-character session IDs:
    - Desktop creates session → gets unique session ID → displays in UI and QR code
    - Phone scans QR or enters code → joins specific session room
    - All events (movement, keys, config) are scoped to session rooms
    - Prevents cross-user interference when multiple users connect simultaneously
    - Fallback to global mode when no session ID present for backward compatibility
*   **Desktop Application (VSteps Desktop v2.0):** An Electron-based native application that provides a robust interface for PC integration. It uses `@nut-tree-fork/nut-js` for key simulation, supports WebRTC P2P for low-latency direct phone-to-PC connection, and includes features like mDNS auto-discovery, system tray integration, and sustained key holds.
*   **Legacy PC Client (Python):** A Python script (`pc_receiver.py`) using `python-socketio` and `pydirectinput` for compatibility with the web controller, implementing sustained key holds and `DirectInput` for game compatibility.
*   **UDP PC Client (Python):** A Python script (`pc_receiver_udp.py`) using raw UDP sockets and `pynput` for ultra-low latency, designed for native mobile apps.
*   **WebRTC PC Client (Node.js):** A Node.js script (`pc_receiver_webrtc.js` / `pc_receiver_keysender.js`) for direct P2P connection, bypassing cloud servers for movement data with minimal latency (5-15ms). It uses `@roamhq/wrtc` and `robotjs` (or `@nut-tree-fork/nut-js` for easier installation).
*   **Advanced Step Detection:** Employs a dynamic "Peak & Valley" algorithm with an Exponential Moving Average (EMA) filter, precision floor, 6-step validation buffer, and time window validation for accurate and adaptive step counting.
*   **Key Control:** Supports "Key Hold Mode" for sustained key presses (configurable via Buffer slider, default 800ms, extensible by consecutive steps) and an optional "Burst Mode" for rapid key taps. PC-side keyboard.config.autoDelayMs = 0 is hardcoded for all modes. Buffer duration syncs from mobile settings.
*   **Apex-Gate Controller:** Alternative controller at `/apex-gate` with strict mutual exclusion logic:
    - **Strict Gate Rules:** Only ONE action active at a time (idle, walk, sprint, steer-left, steer-right)
    - **XYZ Vector Magnitude:** Uses √(x²+y²+z²) for motion detection
    - **Walk Zone:** Triggered when XYZ is between Baseline+0.4 and Baseline+1.2
    - **Sprint Zone:** Triggered when XYZ exceeds Baseline+1.2 (sends Shift+W)
    - **Alpha (Yaw) Steering:** Uses DeviceOrientationEvent alpha at ±8° threshold for A/D keys
    - **Priority Logic:** Steering takes priority; when exiting steer zone, immediately evaluates motion
    - **Press/Release Protocol:** Sends `{press: [], release: []}` messages for clean key handling
    - **Haptic Patterns:** Walk (10ms), Sprint (30ms), Steer-Left (25ms), Steer-Right ([10,20,10])
    - **Set Forward Button:** Recalibrates alpha reference on demand
    - **2-Second Calibration:** Establishes XYZ baseline on start

**Feature Specifications:**

*   **PVP Arena:** Real-time step battles with friends, including live step comparison, winner determination by step count, leaderboards, and rankings (available for SUBSCRIBED users).
*   **Gamification:** XP system (10 XP per step), leveling based on XP, and a trophy collection for achievements.
*   **User Management:** Supabase-backed user authentication, with user tiers (DEMO, BASIC, SUBSCRIBED, ADMIN) controlling feature access.

## External Dependencies

*   **Backend as a Service:** Supabase (for user authentication, PostgreSQL database with RLS, and data persistence).
*   **Real-time Communication:** Socket.io (for WebSocket-based events between client and server).
*   **Desktop Key Simulation:** `@nut-tree-fork/nut-js` (cross-platform key control) and `robotjs` (alternative for Node.js clients).
*   **WebRTC:** `@roamhq/wrtc` (for WebRTC data channels in Node.js clients).
*   **Python Libraries:** `python-socketio`, `pydirectinput`, `websocket-client`, `pynput` (for Python-based PC clients).
*   **Service Discovery:** Bonjour / mDNS (for automatic discovery of VSteps servers).
*   **Frontend Frameworks/Libraries:** React, TypeScript, Vite, TailwindCSS, Shadcn UI.