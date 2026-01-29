# VSteps Setup Guide

## Quick Start

### Step 1: Get Your Server URL

Your VSteps server is running at your Replit app URL. It looks like:
```
https://your-app-name.replit.app
```

Copy this URL - you'll need it for both your phone and PC.

---

## Phone Setup (Controller)

### Option A: Web Browser (Any Phone)

1. Open your phone's browser (Chrome, Safari, etc.)
2. Go to your server URL: `https://your-app-name.replit.app`
3. Log in or create an account
4. Tap **"Controller"** from the dashboard
5. Tap **"Start Detection"** and allow motion sensor access
6. Hold your phone upright and walk in place!

### Option B: iOS PWA (Add to Home Screen)

1. Open Safari on your iPhone
2. Go to your server URL
3. Tap the Share button (square with arrow)
4. Tap **"Add to Home Screen"**
5. Open the VSteps app from your home screen
6. Log in and use the Controller

---

## PC Setup (Receiver)

Choose ONE of these options:

### Option 1: Easy Node.js Receiver (Recommended)

**Requirements:**
- Node.js installed on your PC
- No Visual Studio Build Tools needed!

**Setup:**

1. Open Command Prompt or PowerShell

2. Navigate to your VSteps folder:
   ```bash
   cd path/to/vsteps
   ```

3. Install dependencies:
   ```bash
   npm install @roamhq/wrtc socket.io-client @nut-tree-fork/nut-js
   ```

4. Run the receiver:
   ```bash
   node pc_receiver_keysender.js
   ```

5. When prompted:
   - Type `y` for tilt-to-mouse steering (or `n` to disable)
   - Enter your server URL: `https://your-app-name.replit.app`

6. The receiver will say "Waiting for phone to connect via WebRTC..."

7. On your phone, open the Controller and start walking - your PC will receive the inputs!

---

### Option 2: Desktop App (Full GUI)

**Requirements:**
- Node.js installed on your PC

**Setup:**

1. Open Command Prompt or PowerShell

2. Navigate to the desktop-app folder:
   ```bash
   cd path/to/vsteps/desktop-app
   ```

3. Install dependencies:
   ```bash
   npm install
   ```

4. Start the app:
   ```bash
   npm start
   ```

5. In the app window:
   - Enter your server URL in the text field
   - Click **Connect**
   - Wait for "Connected to signaling server"

6. On your phone, open the Controller - they'll connect automatically via WebRTC!

---

### Option 3: RobotJS Receiver (Advanced)

**Requirements:**
- Node.js installed
- Visual Studio Build Tools (Windows) or Xcode (macOS)

**Setup:**

1. Install dependencies:
   ```bash
   npm install wrtc socket.io-client robotjs
   ```

2. Run the receiver:
   ```bash
   node pc_receiver_webrtc.js
   ```

3. Enter your server URL when prompted

---

## How It Works

```
[Phone] ──WebRTC P2P──> [PC Receiver]
   │                         │
   │    (5-15ms latency)     │
   ▼                         ▼
Walk in place          W key pressed
Tap Jump button        Space key pressed
Tilt left/right        Mouse moves or A/D keys
```

**Connection Flow:**

1. Phone and PC both connect to your server (signaling)
2. Server helps them find each other
3. WebRTC creates a direct P2P connection
4. Movement data travels directly phone → PC (no server in the middle!)

---

## Controls Mapping

| Phone Action | PC Input |
|-------------|----------|
| Walk forward | W key held |
| Fast walk/run | Shift + W (sprint) |
| Tap Jump button | Space key |
| Tilt phone left | Mouse left or A key |
| Tilt phone right | Mouse right or D key |

---

## Troubleshooting

### Phone can't detect motion
- Make sure you allowed motion sensor permissions
- Try refreshing the page
- On iOS 13+, motion access requires HTTPS (your Replit URL has this)

### PC not receiving inputs
- Check that both phone and PC are connected to the same server URL
- Make sure the PC receiver shows "Connected to signaling server"
- Try running the PC receiver as Administrator (Windows)
- Check your firewall isn't blocking the connection

### High latency / delayed response
- WebRTC P2P should give 5-15ms latency on local WiFi
- If using WebSocket fallback, latency will be higher (50-150ms)
- Make sure phone and PC are on the same WiFi network for best results

### Keys not working in game
- Run the PC receiver as Administrator
- Some games require DirectInput - the nut.js library handles this
- Make sure the game window is focused

---

## Testing Your Setup

1. Open a text editor (Notepad, etc.) on your PC
2. Start the PC receiver
3. Start the Controller on your phone
4. Walk in place - you should see "wwwwwww" typed in the text editor
5. Tap Jump - you should see a space
6. Tilt your phone - mouse should move (if enabled)

---

## PVP Battles (Multiplayer)

1. Both players need accounts (SUBSCRIBED tier for battles)
2. Add each other as friends in the Friends page
3. Go to PVP Arena
4. One player challenges the other
5. Accept the battle
6. Walk in place to accumulate steps
7. Player with most steps wins!

---

## Need Help?

Check the console output of the PC receiver for error messages. Common issues:

- `nut.js not available` - Run `npm install @nut-tree-fork/nut-js`
- `Connection error` - Check your server URL is correct
- `WebRTC not available` - Run `npm install @roamhq/wrtc`
