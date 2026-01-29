# Design Guidelines: Step-to-Keyboard Bridge App

## Design Approach
**System-Based Approach**: Material Design principles adapted for real-time utility applications. This tool prioritizes immediate clarity, responsive feedback, and functional efficiency over visual embellishment.

## Typography
- **Primary Font**: Inter (Google Fonts) - clean, highly legible at all sizes
- **Hierarchy**:
  - Step Counter: 72px/font-bold (massive, center focus)
  - Section Headers: 20px/font-semibold
  - Labels/Controls: 16px/font-medium
  - Status Text: 14px/font-normal
  - Helper Text: 12px/text-gray-600

## Layout System
**Spacing Units**: Tailwind units of 2, 4, 6, and 8 (p-4, m-6, gap-8, etc.)

**Structure**: Single-column mobile-first layout
- Max-width container: max-w-md centered
- Padding: p-6 on mobile, p-8 on desktop
- Consistent card spacing: gap-6 between major sections

## Core Components

### Status Header
- Connection indicator (dot + text: "Connected" / "Disconnected")
- Server URL display (truncated, monospace font)
- Position: top, subtle background

### Hero Section: Step Counter Display
- Massive numerical display (step count)
- Circular progress indicator around number showing recent activity
- Label "Steps Detected" below counter
- Pulsing animation on step detection (brief scale effect)

### Control Panel
**Start/Stop Button**:
- Large touch target (min 56px height)
- Full-width on mobile
- Two states: "Start Detection" (primary) / "Stop" (destructive red)
- Icon + text label

**Sensitivity Slider**:
- Range input with visible track
- Labels: "Less Sensitive" ← → "More Sensitive"
- Current value display (numeric)
- Helper text: "Adjust threshold for step detection"

### Real-Time Feedback Section
- Visual waveform or live Y-axis graph showing accelerometer data
- Threshold line overlay
- Peak detection markers (dots/indicators when step detected)
- Compact, 200px height

### Instructions Card
- Collapsible accordion or always-visible compact guide
- Icon-based steps:
  1. Click "Start Detection"
  2. Walk in place
  3. Run PC client script
- Background: subtle gray

## Color Strategy
Foundation will be established later. Focus on:
- High contrast for readability
- Clear state differentiation (active/inactive)
- Attention-grabbing pulse on step detection
- Success/error states for connection

## Layout Behavior
- Single viewport design (no scrolling needed)
- All controls immediately visible
- Vertical stacking on mobile
- Generous touch targets (minimum 44px)

## Animations
**Minimal, purposeful only**:
- Step detection: Brief scale pulse on counter (200ms)
- Connection status: Fade transition
- Slider: Smooth thumb movement
- NO decorative animations

## Images
**No hero image needed** - This is a functional dashboard, not a marketing page. Focus entirely on controls and real-time data display.

## Component Enrichment
- **Header**: Connection status + server info + settings icon
- **Footer**: Quick tips ("Keep phone steady", "Vertical movements work best")
- **Start Button**: Include icon (play/pause)
- **Counter**: Add "per minute" rate calculation
- **Slider**: Real-time preview of threshold effect

## Accessibility
- Large, readable step counter
- High contrast controls
- Keyboard navigation for all interactive elements
- Clear focus states
- Labels for all inputs
- Status announcements for screen readers

This creates a focused, professional utility interface that prioritizes immediate usability and real-time feedback over aesthetic flourish.