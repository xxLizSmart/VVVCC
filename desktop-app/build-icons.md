# VSteps Desktop Icon Generation

The desktop app needs proper icon formats for each platform. Since the source logo is a JPEG file, you'll need to convert it to proper formats.

## Required Icons

1. **icon.png** - 512x512 or 1024x1024 PNG for Linux
2. **icon.ico** - Windows icon (multi-resolution: 16, 32, 48, 256)  
3. **icon.icns** - macOS icon bundle

## Icon Generation Steps

### Option 1: Using Online Tools

1. Go to https://www.icoconverter.com/ or similar
2. Upload the source JPEG logo
3. Download the generated .ico file
4. For macOS, use https://cloudconvert.com/png-to-icns

### Option 2: Using ImageMagick (if installed)

```bash
# Navigate to assets folder
cd desktop-app/assets

# Convert JPEG to PNG first
convert source-logo.jpeg -resize 512x512 icon.png

# Create ICO for Windows
convert icon.png -define icon:auto-resize=256,128,64,48,32,16 icon.ico

# Create ICNS for macOS (requires iconutil on macOS)
mkdir icon.iconset
sips -z 16 16     icon.png --out icon.iconset/icon_16x16.png
sips -z 32 32     icon.png --out icon.iconset/icon_16x16@2x.png
sips -z 32 32     icon.png --out icon.iconset/icon_32x32.png
sips -z 64 64     icon.png --out icon.iconset/icon_32x32@2x.png
sips -z 128 128   icon.png --out icon.iconset/icon_128x128.png
sips -z 256 256   icon.png --out icon.iconset/icon_128x128@2x.png
sips -z 256 256   icon.png --out icon.iconset/icon_256x256.png
sips -z 512 512   icon.png --out icon.iconset/icon_256x256@2x.png
sips -z 512 512   icon.png --out icon.iconset/icon_512x512.png
sips -z 1024 1024 icon.png --out icon.iconset/icon_512x512@2x.png
iconutil -c icns icon.iconset
rm -rf icon.iconset
```

### Option 3: Using electron-icon-builder

```bash
npm install electron-icon-builder --save-dev
npx electron-icon-builder --input=./assets/source-logo.png --output=./assets
```

## Current Workaround

The current setup uses PNG icons only, which works for Linux and development. Windows and macOS builds may show default Electron icons until proper formats are provided.

To build with current assets:
```bash
npm run build:linux  # Works with PNG
npm run build:win    # May use default icon
npm run build:mac    # May use default icon
```
