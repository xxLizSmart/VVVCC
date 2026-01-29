# VSteps Desktop App v2.1

A native desktop companion app for VSteps that allows your phone to control your PC keyboard without needing Python installed. **All features from pc_receiver_keysender.js are now fully integrated** - just install and connect!

## Quick Installation Guide

### Option 1: Build from Source (Recommended)

This is the most reliable method as native modules are compiled for your specific system.

```bash
# 1. Install Node.js 18+ from https://nodejs.org

# 2. Install Visual C++ Build Tools (Windows only)
#    Download from: https://visualstudio.microsoft.com/visual-cpp-build-tools/
#    Select "Desktop development with C++" workload

# 3. Clone or download the project, then:
cd desktop-app
npm install
npm start
```

### Option 2: Pre-built Release

Download the latest release for your platform:

| Platform | Installer | Portable |
|----------|-----------|----------|
| **Windows** | `VSteps-Desktop-Setup.exe` | `VSteps-Desktop-Portable.exe` |
| **macOS** | `VSteps-Desktop.dmg` | `VSteps-Desktop.zip` |
| **Linux** | `VSteps-Desktop.deb` | `VSteps-Desktop.AppImage` |

**Important for pre-built releases:**
- Windows: Install [Visual C++ Redistributable 2019+](https://aka.ms/vs/17/release/vc_redist.x64.exe)
- If the app doesn't open, see "App Won't Open" troubleshooting below

## Features

- **No Python Required** - Everything bundled in one installer
- **Auto-Discovery** - Automatically finds VSteps servers on your network (mDNS)
- **System Tray** - Runs in background, accessible from system tray
- **Keyboard Simulation** - Native keyboard control using nut-tree
- **WebRTC P2P** - Ultra-low latency direct connection (5-15ms)
- **Tri-Mode Engine** - Syncs with mobile app settings (Default/Game/Cruise)
- **Sustained Key Holds** - Keys held for configurable duration per step
- **Step-Controller Support** - Full W key walking with A/D lateral steering
- **Apex-Gate Support** - Direct press/release protocol for Walk/Sprint/Steer zones
- **Auto Config Sync** - Settings sync automatically from mobile app
- **Diagonal Mode** - Choose W+A/W+D diagonal or steering-priority mode

## Build from Source (Detailed)

### Prerequisites

- **Node.js 18+** (LTS recommended)
- **npm** or **yarn**
- **Platform-specific build tools:**
  - **Windows**: Visual Studio Build Tools 2019+ with "Desktop development with C++"
  - **macOS**: Xcode Command Line Tools (`xcode-select --install`)
  - **Linux**: `build-essential`, `libx11-dev`, `libxtst-dev`, `libpng-dev`

### Quick Build

```bash
# Navigate to desktop-app folder
cd desktop-app

# Install dependencies (this may take a few minutes for native modules)
npm install

# Run in development mode
npm start

# Build for your current platform
npm run build
```

### Build for Specific Platforms

```bash
# Windows (NSIS installer + portable)
npm run build:win

# macOS (DMG + ZIP)
npm run build:mac

# Linux (AppImage + DEB)
npm run build:linux
```

### Cross-Platform Building Note

Electron apps must generally be built **on each target OS**:
- Build Windows `.exe` on Windows
- Build macOS `.dmg` on macOS  
- Build Linux `.AppImage`/`.deb` on Linux

Some cross-compilation is possible with `electron-builder` but native modules like `@nut-tree-fork/nut-js` work best when built natively.

### Build Output

After building, find your installers in `desktop-app/dist/`:

```
dist/
├── VSteps Desktop Setup 2.0.0.exe      # Windows NSIS installer
├── VSteps Desktop 2.0.0.exe            # Windows portable
├── VSteps Desktop-2.0.0.dmg            # macOS installer
├── VSteps Desktop-2.0.0-mac.zip        # macOS archive
├── VSteps Desktop-2.0.0.AppImage       # Linux AppImage
└── vsteps-desktop_2.0.0_amd64.deb      # Debian/Ubuntu package
```

## Usage

1. **Launch** VSteps Desktop on your PC
2. **Connect** to the VSteps server (auto-discovered or enter URL manually)
3. **Open** VSteps on your phone's browser at the same server URL
4. **Walk** in place to control your PC!

## Key Mappings

| Action | Key Pressed | Duration |
|--------|-------------|----------|
| Walk Forward | W | Configurable (800ms default) |
| Sprint | Shift + W | Held while sprinting |
| Steer Left | A | Held while tilting left |
| Steer Right | D | Held while tilting right |
| Jump Button | Space | Tap |

### Controller Modes

**Step-Controller Mode:**
- W key for forward movement (walking/running)
- A/D keys for angle-based steering (90° trigger default)
- Diagonal mode: W+A/W+D simultaneous or steering-priority

**Apex-Gate Mode:**
- Direct press/release protocol
- Walk Zone: W key
- Sprint Zone: Shift+W
- Steer zones: A/D keys based on device orientation

## Configuration Sync

Settings are saved to `vsteps-config.json` in the app directory:

```json
{
  "triMode": "default",
  "threshold": 12.0,
  "buffer": 800,
  "debounce": 250
}
```

When you change settings on the mobile app and tap "Save Settings", the PC app automatically receives and saves the new configuration.

## Tri-Mode Presets

| Mode | Threshold | Buffer | Debounce | Use Case |
|------|-----------|--------|----------|----------|
| **Default** | 12.0 | 800ms | 250ms | Standard walking |
| **Game** | 9.5 | 600ms | 150ms | Fast-paced gaming |
| **Cruise** | 0.1 | 1000ms | 10ms | Ghost Walking (ultra-sensitive) |

## Troubleshooting

### App Won't Open (Most Common Issue)

**Symptoms:** Double-click the app and nothing happens, or it closes immediately.

**Solutions (try in order):**

1. **Install Visual C++ Redistributable (Windows)**
   - Download and install: https://aka.ms/vs/17/release/vc_redist.x64.exe
   - This is required for native modules to work

2. **Run from Command Line to see errors**
   ```bash
   # Windows (open cmd in the app folder)
   "VSteps Desktop.exe"
   
   # Or for portable version
   cd path\to\portable\folder
   "VSteps Desktop.exe"
   ```

3. **Rebuild native modules**
   ```bash
   cd desktop-app
   npm rebuild
   npm start
   ```

4. **Check Windows Event Viewer**
   - Open Event Viewer → Windows Logs → Application
   - Look for errors from "VSteps" or "Electron"

5. **Build from source instead** (most reliable fix)
   ```bash
   cd desktop-app
   rm -rf node_modules
   npm install
   npm start
   ```

### Connection Issues
- Ensure phone and PC are on the **same WiFi network**
- Check that no firewall is blocking ports 5000 (HTTP) or WebRTC ports
- Try the manual URL entry if auto-discovery doesn't work
- Verify the VSteps server is running (check browser at the server URL)

### Keyboard Not Working
- **Windows**: Try running the app as Administrator (right-click → Run as administrator)
- **macOS**: Grant Accessibility permissions (System Preferences → Security & Privacy → Accessibility)
- **Linux**: May need to run with `--no-sandbox` flag or add user to `input` group
- **Games with Anti-Cheat**: Some games block simulated keyboard input

### Build Errors
- **Windows**: Install Visual Studio Build Tools with C++ workload
- **macOS**: Run `xcode-select --install` for command line tools
- **Linux**: Install `sudo apt install build-essential libx11-dev libxtst-dev libpng-dev`
- **All platforms**: Delete `node_modules` and `package-lock.json`, then reinstall

### Native Module Issues
The app uses native modules that require compilation:
- `@nut-tree-fork/nut-js` - Keyboard simulation
- `@roamhq/wrtc` - WebRTC for Node.js
- `uiohook-napi` - Global keyboard hooks

If you encounter issues, try:
```bash
npm rebuild
# or
npm run postinstall
```

## Development

### Project Structure

```
desktop-app/
├── src/
│   ├── main.js          # Electron main process, window/tray management
│   ├── preload.js       # Secure bridge between main and renderer
│   ├── index.html       # UI for connection and activity monitoring
│   ├── keyboard.js      # nut-tree keyboard controller with sustained holds
│   ├── connection.js    # Socket.IO + WebRTC client for server communication
│   ├── discovery.js     # mDNS/Bonjour service discovery
│   └── mouse.js         # Mouse control (experimental)
├── assets/
│   ├── icon.png         # App icon (512x512)
│   └── tray-icon.png    # System tray icon
├── package.json         # Dependencies and electron-builder config
└── README.md            # This file
```

### Key Technologies

- **Electron 28** - Cross-platform desktop framework
- **@nut-tree-fork/nut-js** - Native keyboard/mouse simulation
- **@roamhq/wrtc** - WebRTC DataChannel for low-latency P2P
- **Socket.IO Client** - Real-time server communication
- **Bonjour Service** - mDNS for automatic server discovery
- **electron-builder** - Packaging and distribution

## Security Notes

- Keys are automatically released when:
  - The app is closed
  - Connection is lost
  - After the buffer duration expires
- The app requests Administrator/root privileges for keyboard simulation
- WebRTC connections are encrypted (DTLS)

## License

MIT
