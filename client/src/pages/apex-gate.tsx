import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Slider } from "@/components/ui/slider";
import { Play, Square, Home, ArrowUp, ArrowLeft, ArrowRight, Zap, Crosshair, ChevronDown, ChevronUp } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { io, Socket } from "socket.io-client";

// Apex-Gate Default Thresholds
const DEFAULT_WALK_OFFSET = 0.4;      // Baseline + 0.4 = Level 2.7
const SPRINT_MULTIPLIER = 3;          // Sprint = Walk offset * 3
const DEFAULT_DEADZONE = 15;          // 15° deadzone (relative heading)
const DEFAULT_HOLD_WINDOW = 800;      // 800ms hold window
const CALIBRATION_DURATION = 2000;    // 2 seconds

// Movement states - combined forward + strafe
type MotionState = 'idle' | 'walk' | 'sprint';
type StrafeState = 'A' | 'D' | null;  // null = inside deadzone (straight)

interface InputMessage {
  press?: string[];
  release?: string[];
}

export default function Omni() {
  const [, setLocation] = useLocation();
  const [isRunning, setIsRunning] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [serverUrl, setServerUrl] = useState("");
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [permissionError, setPermissionError] = useState("");
  
  // Calibration
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [calibrationProgress, setCalibrationProgress] = useState(0);
  const [baseline, setBaseline] = useState(0);
  const baselineRef = useRef(0);
  const calibrationSamplesRef = useRef<number[]>([]);
  const calibrationStartRef = useRef(0);
  
  // Current state - separate motion and strafe for combined movement
  const [motionState, setMotionState] = useState<MotionState>('idle');
  const motionStateRef = useRef<MotionState>('idle');
  const [strafeState, setStrafeState] = useState<StrafeState>(null);
  const strafeStateRef = useRef<StrafeState>(null);
  const [currentMagnitude, setCurrentMagnitude] = useState(0);
  const [currentAlpha, setCurrentAlpha] = useState(0);
  const [walkCount, setWalkCount] = useState(0);
  const [sprintCount, setSprintCount] = useState(0);
  
  // Slider settings with persistence
  const [triggerForce, setTriggerForce] = useState(() => {
    const saved = localStorage.getItem('apex-gate-trigger-force');
    return saved !== null ? parseFloat(saved) : DEFAULT_WALK_OFFSET;
  });
  const [holdWindow, setHoldWindow] = useState(() => {
    const saved = localStorage.getItem('apex-gate-hold-window');
    return saved !== null ? parseInt(saved) : DEFAULT_HOLD_WINDOW;
  });
  const [deadzoneThreshold, setDeadzoneThreshold] = useState(() => {
    const saved = localStorage.getItem('apex-gate-deadzone');
    return saved !== null ? parseFloat(saved) : DEFAULT_DEADZONE;
  });
  
  // Refs for settings (used in event handlers)
  const triggerForceRef = useRef(triggerForce);
  const holdWindowRef = useRef(holdWindow);
  const deadzoneRef = useRef(deadzoneThreshold);
  
  // Sync refs with state
  useEffect(() => {
    triggerForceRef.current = triggerForce;
    localStorage.setItem('apex-gate-trigger-force', triggerForce.toString());
  }, [triggerForce]);
  
  useEffect(() => {
    holdWindowRef.current = holdWindow;
    localStorage.setItem('apex-gate-hold-window', holdWindow.toString());
  }, [holdWindow]);
  
  useEffect(() => {
    deadzoneRef.current = deadzoneThreshold;
    localStorage.setItem('apex-gate-deadzone', deadzoneThreshold.toString());
  }, [deadzoneThreshold]);
  
  // Hold window timer ref
  const holdTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastActiveMotionRef = useRef<'walk' | 'sprint' | null>(null);
  
  // Refs
  const socketRef = useRef<Socket | null>(null);
  const isRunningRef = useRef(false);
  const initialAlphaRef = useRef<number | null>(null);
  
  // Anti-jitter: Smoothing and hysteresis
  const smoothedAlphaRef = useRef<number>(0);
  const lastStrafeDecisionRef = useRef<StrafeState>(null);
  const ALPHA_SMOOTHING = 0.3; // EMA factor (0-1, lower = smoother)
  const HYSTERESIS = 3; // Extra degrees to exit strafe (prevents bouncing)
  
  // Settings panel collapsed state
  const [settingsOpen, setSettingsOpen] = useState(false);
  
  // Set server URL
  useEffect(() => {
    const url = `${window.location.protocol}//${window.location.host}`;
    setServerUrl(url);
  }, []);
  
  // Socket.IO connection
  useEffect(() => {
    const socket = io(serverUrl || window.location.origin, {
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      transports: ['websocket', 'polling']
    });
    
    socketRef.current = socket;
    
    socket.on('connect', () => {
      console.log('[APEX-GATE] Connected to server');
      setIsConnected(true);
    });
    
    socket.on('disconnect', () => {
      console.log('[APEX-GATE] Disconnected from server');
      setIsConnected(false);
    });
    
    return () => {
      socket.disconnect();
    };
  }, [serverUrl]);
  
  // Send input to server (uses apex-gate-input event for PC receiver)
  const sendInput = useCallback((msg: InputMessage) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('apex-gate-input', msg);
      console.log('[APEX-GATE] Sent:', JSON.stringify(msg));
    }
  }, []);
  
  // Transition motion state (walk/sprint/idle)
  // MUTUALLY EXCLUSIVE: W only pressed if NOT strafing (inside deadzone)
  const transitionMotion = useCallback((newMotion: MotionState) => {
    if (motionStateRef.current === newMotion) return;
    
    const oldMotion = motionStateRef.current;
    motionStateRef.current = newMotion;
    setMotionState(newMotion);
    
    const msg: InputMessage = { press: [], release: [] };
    const isStrafing = strafeStateRef.current !== null;
    
    // Release old motion keys
    if (oldMotion === 'walk') {
      msg.release!.push('w');
    } else if (oldMotion === 'sprint') {
      msg.release!.push('shift', 'w');
    }
    
    // Press new motion keys ONLY if not strafing (mutually exclusive)
    if (newMotion === 'walk') {
      if (!isStrafing) {
        msg.press!.push('w');
      }
      msg.release!.push('shift');
      if (oldMotion === 'idle') {
        setWalkCount(c => c + 1);
        if (navigator.vibrate) navigator.vibrate(10);
      }
    } else if (newMotion === 'sprint') {
      if (!isStrafing) {
        msg.press!.push('shift', 'w');
      }
      if (oldMotion === 'idle') {
        setSprintCount(c => c + 1);
        if (navigator.vibrate) navigator.vibrate(30);
      }
    } else if (newMotion === 'idle') {
      msg.release!.push('w', 'shift');
      // Immediately release strafe when going idle
      if (strafeStateRef.current !== null) {
        msg.release!.push('a', 'd');
        strafeStateRef.current = null;
        setStrafeState(null);
      }
    }
    
    // Clean up duplicates
    msg.release = Array.from(new Set(msg.release));
    msg.release = msg.release.filter(k => !msg.press!.includes(k));
    
    if (msg.press!.length > 0 || msg.release!.length > 0) {
      sendInput(msg);
    }
  }, [sendInput]);

  // Transition strafe state (A/D/null based on deadzone)
  // MUTUALLY EXCLUSIVE: Strafe (A/D) cancels W, W only when inside deadzone
  const transitionStrafe = useCallback((newStrafe: StrafeState) => {
    // If idle, always force strafe to null (no strafe while stationary)
    if (motionStateRef.current === 'idle') {
      newStrafe = null;
    }
    
    if (strafeStateRef.current === newStrafe) return;
    
    const oldStrafe = strafeStateRef.current;
    strafeStateRef.current = newStrafe;
    setStrafeState(newStrafe);
    
    const msg: InputMessage = { press: [], release: [] };
    
    // Release old strafe key
    if (oldStrafe === 'A') {
      msg.release!.push('a');
    } else if (oldStrafe === 'D') {
      msg.release!.push('d');
    }
    
    // Mutually exclusive: Strafe cancels W (and shift), deadzone restores W
    if (newStrafe === 'A') {
      // Strafing left: release W and shift, press A only
      msg.release!.push('w', 'shift', 'd');
      msg.press!.push('a');
      if (navigator.vibrate) navigator.vibrate(25);
    } else if (newStrafe === 'D') {
      // Strafing right: release W and shift, press D only
      msg.release!.push('w', 'shift', 'a');
      msg.press!.push('d');
      if (navigator.vibrate) navigator.vibrate([10, 20, 10]);
    } else {
      // null = inside deadzone, release A/D and restore W if moving
      msg.release!.push('a', 'd');
      if (motionStateRef.current === 'walk') {
        msg.press!.push('w');
      } else if (motionStateRef.current === 'sprint') {
        msg.press!.push('w', 'shift');
      }
    }
    
    // Clean up duplicates
    msg.release = Array.from(new Set(msg.release));
    msg.release = msg.release.filter(k => !msg.press!.includes(k));
    
    if (msg.press!.length > 0 || msg.release!.length > 0) {
      sendInput(msg);
    }
  }, [sendInput]);

  // Stop all movement
  const stopAll = useCallback(() => {
    motionStateRef.current = 'idle';
    strafeStateRef.current = null;
    setMotionState('idle');
    setStrafeState(null);
    sendInput({ release: ['w', 'shift', 'a', 'd'] });
  }, [sendInput]);
  
  // Handle motion event
  const handleMotion = useCallback((event: DeviceMotionEvent) => {
    if (!isRunningRef.current) return;
    
    const accel = event.accelerationIncludingGravity;
    if (!accel) return;
    
    // Accept zero values - they're valid accelerometer readings
    const x = accel.x ?? 0;
    const y = accel.y ?? 0;
    const z = accel.z ?? 0;
    
    // Calculate magnitude (XYZ Vector)
    const magnitude = Math.sqrt(x * x + y * y + z * z);
    setCurrentMagnitude(magnitude);
    
    // Calibration phase
    if (calibrationStartRef.current > 0) {
      calibrationSamplesRef.current.push(magnitude);
      const elapsed = Date.now() - calibrationStartRef.current;
      setCalibrationProgress(Math.min(100, (elapsed / CALIBRATION_DURATION) * 100));
      
      if (elapsed >= CALIBRATION_DURATION) {
        // Calculate average baseline
        const avg = calibrationSamplesRef.current.reduce((a, b) => a + b, 0) / calibrationSamplesRef.current.length;
        baselineRef.current = avg;
        setBaseline(avg);
        calibrationStartRef.current = 0;
        setIsCalibrating(false);
        setCalibrationProgress(100);
        console.log(`[APEX-GATE] Calibrated baseline: ${avg.toFixed(2)}`);
        if (navigator.vibrate) navigator.vibrate([30, 50, 30]);
      }
      return;
    }
    
    // Not calibrated yet
    if (baselineRef.current === 0) return;
    
    // Determine motion state based on magnitude
    const walkOffset = triggerForceRef.current;
    const sprintOffset = walkOffset * SPRINT_MULTIPLIER;
    const walkThreshold = baselineRef.current + walkOffset;
    const sprintThreshold = baselineRef.current + sprintOffset;
    
    if (magnitude > sprintThreshold) {
      // Clear hold timer - active motion
      if (holdTimerRef.current) {
        clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }
      lastActiveMotionRef.current = 'sprint';
      transitionMotion('sprint');
    } else if (magnitude > walkThreshold) {
      // Clear hold timer - active motion
      if (holdTimerRef.current) {
        clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }
      lastActiveMotionRef.current = 'walk';
      transitionMotion('walk');
    } else {
      // Below threshold - use Hold Window to delay idle transition
      if ((motionStateRef.current === 'walk' || motionStateRef.current === 'sprint') && !holdTimerRef.current) {
        holdTimerRef.current = setTimeout(() => {
          holdTimerRef.current = null;
          transitionMotion('idle');
          // Also release strafe when idle
          transitionStrafe(null);
        }, holdWindowRef.current);
      }
    }
  }, [transitionMotion, transitionStrafe]);
  
  // Handle orientation event (Alpha = Yaw) - Deadzone logic with anti-jitter
  const handleOrientation = useCallback((event: DeviceOrientationEvent) => {
    if (!isRunningRef.current) return;
    if (baselineRef.current === 0) return; // Not calibrated
    
    let alpha = event.alpha;
    if (alpha === null) return;
    
    // Set initial alpha as reference on first read (calibrated yaw)
    if (initialAlphaRef.current === null) {
      initialAlphaRef.current = alpha;
      smoothedAlphaRef.current = 0;
    }
    
    // Calculate relative alpha (centered around calibrated position)
    let diff = alpha - initialAlphaRef.current;
    
    // Normalize to -180 to 180
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;
    
    // Apply EMA smoothing to reduce noise/jitter
    smoothedAlphaRef.current = ALPHA_SMOOTHING * diff + (1 - ALPHA_SMOOTHING) * smoothedAlphaRef.current;
    const smoothedDiff = smoothedAlphaRef.current;
    
    setCurrentAlpha(smoothedDiff);
    
    // Deadzone logic with hysteresis to prevent bouncing
    const deadzone = deadzoneRef.current;
    const currentStrafe = lastStrafeDecisionRef.current;
    
    let newStrafe: StrafeState = null;
    
    if (currentStrafe === null) {
      // Currently not strafing - need to exceed deadzone to start
      if (smoothedDiff > deadzone) {
        newStrafe = 'D';
      } else if (smoothedDiff < -deadzone) {
        newStrafe = 'A';
      }
    } else {
      // Currently strafing - need hysteresis to stop (go back further into deadzone)
      const exitThreshold = deadzone - HYSTERESIS;
      
      if (currentStrafe === 'D') {
        // Keep strafing right unless we go back past exit threshold
        if (smoothedDiff > exitThreshold) {
          newStrafe = 'D';
        } else if (smoothedDiff < -deadzone) {
          newStrafe = 'A'; // Switch to left
        }
      } else if (currentStrafe === 'A') {
        // Keep strafing left unless we go back past exit threshold
        if (smoothedDiff < -exitThreshold) {
          newStrafe = 'A';
        } else if (smoothedDiff > deadzone) {
          newStrafe = 'D'; // Switch to right
        }
      }
    }
    
    // Only transition if decision changed
    if (newStrafe !== lastStrafeDecisionRef.current) {
      lastStrafeDecisionRef.current = newStrafe;
      transitionStrafe(newStrafe);
    }
  }, [transitionStrafe]);
  
  // Request permission and start
  const requestPermission = async () => {
    try {
      // iOS 13+ requires permission request
      if (typeof (DeviceMotionEvent as any).requestPermission === 'function') {
        const motionPermission = await (DeviceMotionEvent as any).requestPermission();
        if (motionPermission !== 'granted') {
          setPermissionError('Motion permission denied');
          return;
        }
      }
      
      if (typeof (DeviceOrientationEvent as any).requestPermission === 'function') {
        const orientPermission = await (DeviceOrientationEvent as any).requestPermission();
        if (orientPermission !== 'granted') {
          setPermissionError('Orientation permission denied');
          return;
        }
      }
      
      setPermissionGranted(true);
      setPermissionError("");
    } catch (err) {
      setPermissionError(`Permission error: ${err}`);
    }
  };
  
  // Start calibration
  const startCalibration = useCallback(() => {
    calibrationSamplesRef.current = [];
    calibrationStartRef.current = Date.now();
    setIsCalibrating(true);
    setCalibrationProgress(0);
    initialAlphaRef.current = null; // Reset alpha reference
    smoothedAlphaRef.current = 0; // Reset smoothing
    lastStrafeDecisionRef.current = null; // Reset hysteresis
    console.log('[APEX-GATE] Starting calibration...');
  }, []);
  
  // Toggle running
  const toggleRunning = useCallback(() => {
    if (!permissionGranted) {
      requestPermission();
      return;
    }
    
    if (isRunning) {
      // Stop
      isRunningRef.current = false;
      setIsRunning(false);
      window.removeEventListener('devicemotion', handleMotion as any);
      window.removeEventListener('deviceorientation', handleOrientation as any);
      // Clear any pending hold timer
      if (holdTimerRef.current) {
        clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }
      // Release all keys
      stopAll();
    } else {
      // Start - begin with calibration
      isRunningRef.current = true;
      setIsRunning(true);
      window.addEventListener('devicemotion', handleMotion as any);
      window.addEventListener('deviceorientation', handleOrientation as any);
      startCalibration();
    }
  }, [permissionGranted, isRunning, handleMotion, handleOrientation, startCalibration, stopAll]);
  
  // Set forward (recalibrate alpha and reset smoothing)
  const setForward = useCallback(() => {
    initialAlphaRef.current = null;
    smoothedAlphaRef.current = 0;
    lastStrafeDecisionRef.current = null;
    setCurrentAlpha(0);
    if (navigator.vibrate) navigator.vibrate([20, 30, 20]);
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Minimal Header */}
      <header className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setLocation("/")}
            data-testid="button-home"
          >
            <Home className="w-5 h-5" />
          </Button>
          <span className="text-xl font-bold text-white">VSteps</span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div 
            className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}
            data-testid="indicator-connection"
            aria-label={isConnected ? 'Connected' : 'Disconnected'}
          />
          <span className="sr-only" data-testid="text-connection-status">
            {isConnected ? 'Online' : 'Offline'}
          </span>
          <ThemeToggle />
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 px-4 pb-6 space-y-6 overflow-auto">
        
        {/* Visual Compass with Deadzone */}
        <div className="flex justify-center py-4" data-testid="compass-container">
          <div className="relative w-40 h-40">
            {/* Compass Ring */}
            <div className="absolute inset-0 rounded-full border-2 border-muted" />
            
            {/* Deadzone Arc Indicator */}
            <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100">
              {/* Deadzone wedge (green = safe zone) */}
              <path
                d={`M 50 50 L 50 10 A 40 40 0 0 1 ${50 + 40 * Math.sin(deadzoneThreshold * Math.PI / 180)} ${50 - 40 * Math.cos(deadzoneThreshold * Math.PI / 180)} Z`}
                fill="rgba(34, 197, 94, 0.2)"
              />
              <path
                d={`M 50 50 L 50 10 A 40 40 0 0 0 ${50 - 40 * Math.sin(deadzoneThreshold * Math.PI / 180)} ${50 - 40 * Math.cos(deadzoneThreshold * Math.PI / 180)} Z`}
                fill="rgba(34, 197, 94, 0.2)"
              />
              
              {/* Needle showing current heading */}
              <line
                x1="50"
                y1="50"
                x2={50 + 35 * Math.sin(currentAlpha * Math.PI / 180)}
                y2={50 - 35 * Math.cos(currentAlpha * Math.PI / 180)}
                stroke={Math.abs(currentAlpha) > deadzoneThreshold ? '#FF0000' : '#22C55E'}
                strokeWidth="3"
                strokeLinecap="round"
              />
              
              {/* Center dot */}
              <circle cx="50" cy="50" r="4" fill="currentColor" className="text-foreground" />
            </svg>
            
            {/* Direction Labels */}
            <div className="absolute top-1 left-1/2 -translate-x-1/2 text-xs font-bold text-muted-foreground">W</div>
            <div className={`absolute left-1 top-1/2 -translate-y-1/2 text-xs font-bold transition-colors ${strafeState === 'A' ? 'text-red-500' : 'text-muted-foreground'}`}>A</div>
            <div className={`absolute right-1 top-1/2 -translate-y-1/2 text-xs font-bold transition-colors ${strafeState === 'D' ? 'text-red-500' : 'text-muted-foreground'}`}>D</div>
          </div>
        </div>

        {/* Motion + Strafe State Indicators */}
        <div className="flex flex-wrap justify-center gap-3 py-2" data-testid="gate-status-panel">
          <div 
            className={`flex flex-col items-center justify-center w-14 h-14 rounded-xl transition-all ${
              motionState === 'idle' ? 'bg-muted text-muted-foreground' : 'bg-muted/20 text-muted-foreground/40'
            }`}
            data-testid="gate-state-idle"
          >
            <span className="text-[10px] font-medium">IDLE</span>
          </div>
          <div 
            className={`flex flex-col items-center justify-center w-14 h-14 rounded-xl transition-all ${
              motionState === 'walk' ? 'bg-green-500/20 text-green-500 ring-2 ring-green-500' : 'bg-muted/20 text-muted-foreground/40'
            }`}
            data-testid="gate-state-walk"
          >
            <ArrowUp className="w-5 h-5" />
            <span className="text-[10px] font-medium mt-0.5">W</span>
          </div>
          <div 
            className={`flex flex-col items-center justify-center w-14 h-14 rounded-xl transition-all ${
              motionState === 'sprint' ? 'bg-orange-500/20 text-orange-500 ring-2 ring-orange-500' : 'bg-muted/20 text-muted-foreground/40'
            }`}
            data-testid="gate-state-sprint"
          >
            <Zap className="w-5 h-5" />
            <span className="text-[10px] font-medium mt-0.5">RUN</span>
          </div>
          <div 
            className={`flex flex-col items-center justify-center w-14 h-14 rounded-xl transition-all ${
              strafeState === 'A' ? 'bg-red-500/20 text-red-500 ring-2 ring-red-500' : 'bg-muted/20 text-muted-foreground/40'
            }`}
            data-testid="gate-state-strafe-left"
          >
            <ArrowLeft className="w-5 h-5" />
            <span className="text-[10px] font-medium mt-0.5">A</span>
          </div>
          <div 
            className={`flex flex-col items-center justify-center w-14 h-14 rounded-xl transition-all ${
              strafeState === 'D' ? 'bg-red-500/20 text-red-500 ring-2 ring-red-500' : 'bg-muted/20 text-muted-foreground/40'
            }`}
            data-testid="gate-state-strafe-right"
          >
            <ArrowRight className="w-5 h-5" />
            <span className="text-[10px] font-medium mt-0.5">D</span>
          </div>
        </div>

        {/* Step Counters - Clean */}
        <div className="flex flex-wrap justify-center gap-8">
          <div className="text-center">
            <div className="text-4xl font-bold text-green-500 tabular-nums" data-testid="text-walk-count">{walkCount}</div>
            <div className="text-xs text-muted-foreground mt-1">WALK</div>
          </div>
          <div className="text-center">
            <div className="text-4xl font-bold text-orange-500 tabular-nums" data-testid="text-sprint-count">{sprintCount}</div>
            <div className="text-xs text-muted-foreground mt-1">SPRINT</div>
          </div>
        </div>

        {/* Sensor Data - Compact */}
        <div className="flex flex-wrap justify-center gap-6 text-center">
          <div>
            <div className="text-2xl font-mono tabular-nums" data-testid="text-xyz-magnitude">{currentMagnitude.toFixed(1)}</div>
            <div className="text-[10px] text-muted-foreground">XYZ</div>
          </div>
          <div className="w-px bg-border" />
          <div>
            <div className="text-2xl font-mono tabular-nums" data-testid="text-yaw-angle">{currentAlpha.toFixed(0)}°</div>
            <div className="text-[10px] text-muted-foreground">YAW</div>
          </div>
          {baseline > 0 && (
            <>
              <div className="w-px bg-border" />
              <div>
                <div className="text-2xl font-mono tabular-nums" data-testid="text-baseline">{baseline.toFixed(1)}</div>
                <div className="text-[10px] text-muted-foreground">BASE</div>
              </div>
            </>
          )}
        </div>
        
        {/* Calibration Progress */}
        {isCalibrating && (
          <div className="py-4" data-testid="calibration-status">
            <div className="text-center text-sm text-muted-foreground mb-2" data-testid="text-calibration-message">Calibrating... Hold Still</div>
            <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
              <div 
                className="bg-yellow-500 h-full transition-all"
                style={{ width: `${calibrationProgress}%` }}
                data-testid="progress-calibration"
              />
            </div>
          </div>
        )}
        
        {/* Main Control Button */}
        <Button
          className="w-full h-16 text-lg font-semibold"
          variant={isRunning ? "destructive" : "default"}
          onClick={toggleRunning}
          disabled={!isConnected}
          data-testid="button-toggle"
        >
          {isRunning ? (
            <>
              <Square className="w-6 h-6 mr-3" />
              Stop
            </>
          ) : (
            <>
              <Play className="w-6 h-6 mr-3" />
              Start
            </>
          )}
        </Button>
        
        {/* Secondary Controls - Inline */}
        {isRunning && !isCalibrating && (
          <div className="flex flex-wrap gap-3">
            <Button
              className="flex-1"
              variant="outline"
              onClick={setForward}
              data-testid="button-set-forward"
            >
              <Crosshair className="w-4 h-4 mr-2" />
              Set Forward
            </Button>
            <Button
              className="flex-1"
              variant="outline"
              onClick={startCalibration}
              data-testid="button-recalibrate"
            >
              Recalibrate
            </Button>
          </div>
        )}
        
        {/* Permission Error */}
        {permissionError && (
          <div className="p-3 bg-destructive/10 text-destructive text-sm rounded-lg" data-testid="text-permission-error">
            {permissionError}
          </div>
        )}
        
        {/* Collapsible Settings */}
        <Collapsible open={settingsOpen} onOpenChange={setSettingsOpen} className="border-t pt-4">
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              className="w-full flex items-center justify-between"
              data-testid="button-settings-toggle"
            >
              <span>Settings</span>
              {settingsOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </Button>
          </CollapsibleTrigger>
          
          <CollapsibleContent className="space-y-6 pt-4">
            {/* Trigger Force */}
            <div className="space-y-2">
              <div className="flex justify-between items-baseline">
                <span className="text-sm font-medium">Trigger Force</span>
                <span className="text-sm font-mono text-muted-foreground">{triggerForce.toFixed(1)}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Higher=faster response but may trigger accidentally. Lower=smoother but may feel laggy.
              </p>
              <Slider
                value={[triggerForce]}
                onValueChange={(v) => setTriggerForce(v[0])}
                min={0.1}
                max={1.0}
                step={0.1}
                className="w-full"
                data-testid="slider-trigger-force"
              />
            </div>
            
            {/* Hold Window */}
            <div className="space-y-2">
              <div className="flex justify-between items-baseline">
                <span className="text-sm font-medium">Hold Window</span>
                <span className="text-sm font-mono text-muted-foreground">{holdWindow}ms</span>
              </div>
              <p className="text-xs text-muted-foreground">
                How long 'W' stays held after each step. If character stutters, increase this value.
              </p>
              <Slider
                value={[holdWindow]}
                onValueChange={(v) => setHoldWindow(v[0])}
                min={200}
                max={2000}
                step={100}
                className="w-full"
                data-testid="slider-hold-window"
              />
            </div>
            
            {/* Deadzone Threshold */}
            <div className="space-y-2">
              <div className="flex justify-between items-baseline">
                <span className="text-sm font-medium">Deadzone</span>
                <span className="text-sm font-mono text-muted-foreground">±{deadzoneThreshold}°</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Angle range for straight walking. Outside this = strafe A/D.
              </p>
              <Slider
                value={[deadzoneThreshold]}
                onValueChange={(v) => setDeadzoneThreshold(v[0])}
                min={5}
                max={40}
                step={1}
                className="w-full"
                data-testid="slider-deadzone"
              />
            </div>
            
            {/* Gate Rules - Minimal */}
            <div className="text-xs text-muted-foreground pt-2 border-t space-y-1" data-testid="text-gate-rules">
              <div>Walk: {(baseline + triggerForce).toFixed(1)} | Sprint: {(baseline + triggerForce * SPRINT_MULTIPLIER).toFixed(1)} | Deadzone: ±{deadzoneThreshold}°</div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </main>
    </div>
  );
}
