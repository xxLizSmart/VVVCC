# VSteps PC Receiver - Windows Setup Guide

Control your PC games by walking in place with your phone! This guide will help you set up the VSteps PC Receiver on Windows.

## What You Need

- **Windows 10 or 11**
- **Node.js** (version 18 or higher)
- **Your phone** with VSteps app open in browser

---

## Step 1: Install Node.js

1. Go to [https://nodejs.org](https://nodejs.org)
2. Download the **LTS** version (recommended)
3. Run the installer and follow the prompts
4. Restart your computer after installation

To verify Node.js is installed, open **Command Prompt** and type:
```
node --version
```
You should see something like `v20.10.0`

---

## Step 2: Download the PC Receiver Script

1. Create a folder for VSteps (open Command Prompt and run):
   ```
   mkdir C:\VSteps
   ```
2. Download `pc_receiver_keysender.js` from this project
3. Save it to `C:\VSteps\`

---

## Step 3: Install Required Packages

1. Open **Command Prompt** (search "cmd" in Start menu)
2. Navigate to the folder where you saved the script:
   ```
   cd C:\VSteps
   ```
3. Run this command to install the required packages:
   ```
   npm install @roamhq/wrtc socket.io-client @nut-tree-fork/nut-js
   ```
4. Wait for installation to complete (this may take a few minutes)

---

## Step 4: Run the PC Receiver

1. In Command Prompt, make sure you're in the VSteps folder:
   ```
   cd C:\VSteps
   ```
2. Start the receiver:
   ```
   node pc_receiver_keysender.js
   ```
3. You'll see:
   ```
   ============================================================
     VSteps PC Receiver - Easy Install Edition
     StepL-style Key Hold (0.8s release timer)
   ============================================================
   ```

---

## Step 5: Connect Your Phone

1. On your phone, open the VSteps web app
2. Look for the **"Connect Your PC"** section
3. Copy the server URL shown (looks like `https://your-app.replit.app`)
4. Paste this URL into the Command Prompt when asked:
   ```
   Enter server URL (e.g., https://vsteps.org): https://your-app.replit.app
   ```
5. Press Enter

---

## Step 6: Enable P2P Mode (Recommended)

For the lowest latency (fastest response):

1. On your phone, scroll to **"P2P Mode"** section
2. Tap **"Enable P2P Mode"**
3. Your PC will show:
   ```
   [WEBRTC] Received offer from phone
   [P2P] Direct connection established!
   [P2P] Movement data now travels directly phone → PC (no cloud!)
   ```

---

## Step 7: Start Walking!

1. On your phone, tap **"Start Detection"**
2. Hold your phone upright and walk in place
3. Watch your PC - you'll see:
   ```
   [↑ FORWARD ] 'W' key DOWN
   [↑ FORWARD ] 'W' key UP - Character Stopped
   ```

---

## Controls

| Phone Action | PC Key |
|--------------|--------|
| Walk forward | W (held) |
| Fast walk/run | Shift + W (sprint) |
| Tap Jump button | Space |

---

## Stopping the Receiver

Press `Ctrl + C` in Command Prompt to stop. You'll see your session stats:

```
[STATS] Session summary:
        Steps  - Forward: 42
        Sprints: 5
        Jumps:   3
```

---

## Troubleshooting

### "node is not recognized"
- Node.js isn't installed or your computer needs a restart
- Reinstall Node.js from [nodejs.org](https://nodejs.org)

### "Cannot find module" error
- You need to install the packages first
- Run: `npm install @roamhq/wrtc socket.io-client @nut-tree-fork/nut-js`

### Windows Firewall popup appeared
- Click **"Allow access"** when Windows Firewall asks
- This allows the receiver to communicate with your phone

### Keys aren't working in my game
- Run Command Prompt **as Administrator**
- Make sure your game window is focused (click on it)
- Some games require DirectInput - try the Python receiver instead

### Phone won't connect
- Make sure phone and PC are on the same WiFi network
- Check that the server URL is correct
- Try refreshing the VSteps page on your phone

### High latency (slow response)
- Enable P2P Mode on your phone for direct connection
- This reduces latency from 50-150ms to 5-15ms

---

## Quick Reference

```
cd C:\VSteps
node pc_receiver_keysender.js
```

Then paste your server URL and start walking!

---

## Need Help?

If you're still having issues:
1. Make sure Node.js version is 18 or higher: `node --version`
2. Delete the `node_modules` folder and reinstall packages
3. Try running Command Prompt as Administrator
