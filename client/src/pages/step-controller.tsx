import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Play, Square, Footprints, Wifi, WifiOff, Monitor, Smartphone, ArrowUp, Copy, Check, Link, Zap, Lock, Unlock, Home, User, Target, AlertTriangle, Crosshair, MoveHorizontal, FastForward } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { ThemeToggle } from "@/components/theme-toggle";
import { io, Socket } from "socket.io-client";
import { useAuth } from "@/contexts/AuthContext";
import { apiRequest } from "@/lib/queryClient";

interface IMUSample {
  timestamp: number;
  ax: number;
  ay: number;
  az: number;
  gx: number;
  gy: number;
  gz: number;
}

type Direction = "forward" | null;

type WebRTCStatus = "disconnected" | "connecting" | "connected";

interface StepLogEntry {
  id: number;
  timestamp: Date;
  direction: "forward";
  isSprint?: boolean;
}

interface CalibrationData {
  ax: number;
  ay: number;
  az: number;
  gx: number;
  gy: number;
  gz: number;
  samples: number;
  calibrated: boolean;
  // StepL Auto-Pro: Track maximum magnitude during calibration
  maxMagnitude: number;
  startTime: number;
}

interface DynamicThresholdState {
  magnitudeWindow: number[];
  dynamicThreshold: number;
  previousMag: number;
  stepBufferCount: number;
  isStepBufferActive: boolean;
  validatedSteps: number;
  inPeakPhase: boolean;
  peakMagnitude: number;
  peakTime: number;
}

export default function StepController() {
  const [, setLocation] = useLocation();
  const { user, canUse, profile } = useAuth();
  const [isRunning, setIsRunning] = useState(false);
  const [stepCount, setStepCount] = useState(0);
  const sessionStepsRef = useRef(0);
  const sessionSprintsRef = useRef(0);
  const sessionStartTimeRef = useRef<number | null>(null);
  // Detection Threshold for 3-axis Euclidean Norm (default 12.0 m/s²)
  const [detectionThreshold, setDetectionThreshold] = useState(() => {
    const saved = localStorage.getItem('vsteps-detection-threshold');
    return saved !== null ? parseFloat(saved) : 12.0;
  });
  const detectionThresholdRef = useRef(12.0);
  
  const [isMoving, setIsMoving] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [serverUrl, setServerUrl] = useState("");
  const [stepsPerMinute, setStepsPerMinute] = useState(0);
  const [showPulse, setShowPulse] = useState(false);
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [permissionError, setPermissionError] = useState("");
  const [lastDirection, setLastDirection] = useState<Direction>(null);
  const [directionCounts, setDirectionCounts] = useState({ forward: 0 });
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [calibrationProgress, setCalibrationProgress] = useState(0);
  const [dynamicThreshold, setDynamicThreshold] = useState(0);
  const [stepBufferStatus, setStepBufferStatus] = useState({ count: 0, active: true });
  const [precisionFloor, setPrecisionFloor] = useState(() => {
    const saved = localStorage.getItem('vsteps-precision-floor');
    return saved !== null ? parseFloat(saved) : 0.2;
  });
  const [stepHistory, setStepHistory] = useState<StepLogEntry[]>([]);
  const [urlCopied, setUrlCopied] = useState(false);
  const [holdDuration, setHoldDuration] = useState(() => {
    const saved = localStorage.getItem('vsteps-hold-duration');
    return saved !== null ? parseInt(saved) : 800;
  });
  const [sprintThreshold, setSprintThreshold] = useState(18);
  const [sprintCount, setSprintCount] = useState(0);
  const [transmittedSteps, setTransmittedSteps] = useState(0);
  const [sprintEnabled, setSprintEnabled] = useState(() => {
    const saved = localStorage.getItem('vsteps-sprint-enabled');
    return saved !== null ? saved === 'true' : true;
  });
  const [sensorRate, setSensorRate] = useState(0);
  const [emaAlpha, setEmaAlpha] = useState(() => {
    const saved = localStorage.getItem('vsteps-ema-alpha');
    return saved !== null ? parseFloat(saved) : 0.2;
  });
  const [stepDuration, setStepDuration] = useState(() => {
    const saved = localStorage.getItem('vsteps-step-duration');
    return saved !== null ? parseInt(saved) : 800;
  });
  const [tuningPreset, setTuningPreset] = useState<'quick' | 'balanced' | 'stable' | 'pocket' | 'custom'>(() => {
    const saved = localStorage.getItem('vsteps-tuning-preset');
    return (saved as 'quick' | 'balanced' | 'stable' | 'pocket' | 'custom') || 'balanced';
  });
  const [burstMode, setBurstMode] = useState(() => {
    const saved = localStorage.getItem('vsteps-burst-mode');
    return saved !== null ? saved === 'true' : false;
  });
  const [burstPresses, setBurstPresses] = useState(() => {
    const saved = localStorage.getItem('vsteps-burst-presses');
    return saved !== null ? parseInt(saved) : 16;
  });
  const [webrtcStatus, setWebrtcStatus] = useState<WebRTCStatus>("disconnected");
  const [webrtcEnabled, setWebrtcEnabled] = useState(() => {
    const saved = localStorage.getItem('vsteps-webrtc-enabled');
    return saved !== null ? saved === 'true' : false;
  });
  const [availablePCs, setAvailablePCs] = useState<string[]>([]);
  const [connectedPCId, setConnectedPCId] = useState<string | null>(null);
  const [pocketLocked, setPocketLocked] = useState(false);
  
  // Omni-Axis Steering Mode: Works in any pocket orientation
  const [steeringEnabled, setSteeringEnabled] = useState(() => {
    const saved = localStorage.getItem('vsteps-steering-enabled');
    return saved === 'true';
  });
  const [steeringDirection, setSteeringDirection] = useState<'left' | 'right' | null>(null);
  const steeringDirectionRef = useRef<'left' | 'right' | null>(null);
  const steeringEnabledRef = useRef(steeringEnabled);
  
  // Omni-Axis Calibration: Detect which axis is lateral based on shake
  type LateralAxis = 'x' | 'y' | 'z';
  const [lateralAxisCalibrated, setLateralAxisCalibrated] = useState(() => {
    const saved = localStorage.getItem('vsteps-lateral-axis-calibrated');
    return saved === 'true';
  });
  const [lateralAxis, setLateralAxis] = useState<LateralAxis>(() => {
    const saved = localStorage.getItem('vsteps-lateral-axis');
    return (saved as LateralAxis) || 'x';
  });
  const [lateralAxisSign, setLateralAxisSign] = useState<1 | -1>(() => {
    const saved = localStorage.getItem('vsteps-lateral-axis-sign');
    return saved === '-1' ? -1 : 1;
  });
  const lateralAxisRef = useRef<LateralAxis>('x');
  const lateralAxisSignRef = useRef<1 | -1>(1);
  const lateralAxisCalibratedRef = useRef(false);
  
  // Calibration state for shake detection
  const [isCalibratingSteering, setIsCalibratingSteering] = useState(false);
  const [calibrationPhase, setCalibrationPhase] = useState<'idle' | 'shaking' | 'done'>('idle');
  const steeringCalibrationRef = useRef<{
    samples: { x: number; y: number; z: number }[];
    startTime: number;
  }>({
    samples: [],
    startTime: 0
  });
  
  // Live lateral acceleration for display
  const [currentLateralAccel, setCurrentLateralAccel] = useState<number>(0);
  
  // Apex-Pro Turning Sensitivity: threshold for lateral ANGLE (degrees)
  const TURNING_HYSTERESIS = 3; // 3° hysteresis for stable steering (anti-jitter)
  const ULTRA_TURNING_THRESHOLD = 2; // ULTRA mode: 2° - maximum sensitivity
  const STEERING_EMA_ALPHA = 0.3; // EMA smoothing factor (0-1, lower = smoother)
  const smoothedGammaRef = useRef(0); // Smoothed gamma for anti-jitter
  const [turningSensitivity, setTurningSensitivity] = useState(() => {
    const saved = localStorage.getItem('vsteps-turning-sensitivity');
    return saved !== null ? parseFloat(saved) : 90; // Default 90° - full turn
  });
  const turningSensitivityRef = useRef(turningSensitivity);
  
  // Apex-Pro: "Set Forward" calibration - zeroes current orientation
  const [forwardCalibrated, setForwardCalibrated] = useState(false);
  const forwardGammaRef = useRef(0); // Reference gamma angle for "forward" (frozen on calibration)
  const latestGammaRef = useRef(0); // Live gamma value from DeviceOrientationEvent
  const orientationSupportedRef = useRef(true); // Track if DeviceOrientation is supported
  const [orientationMode, setOrientationMode] = useState<'gamma' | 'accel'>('gamma'); // Display mode
  
  // Legacy compatibility alias
  const steeringSensitivity = turningSensitivity;
  const setSteeringSensitivity = setTurningSensitivity;
  const steeringSensitivityRef = turningSensitivityRef;
  
  // Ultra Lateral Mode toggle - now uses 2° angle threshold
  const [ultraLateralMode, setUltraLateralMode] = useState(() => {
    return localStorage.getItem('vsteps-ultra-lateral') === 'true';
  });
  const ultraLateralModeRef = useRef(ultraLateralMode);
  
  // Live gamma angle for display
  const [currentGammaAngle, setCurrentGammaAngle] = useState<number>(0);
  
  // Allow Diagonal toggle - when ON, allows W+A or W+D simultaneously
  // When OFF, only one key active at a time (steering priority)
  const [allowDiagonal, setAllowDiagonal] = useState(() => {
    return localStorage.getItem('vsteps-allow-diagonal') === 'true'; // Default OFF - A/D cancels W
  });
  const allowDiagonalRef = useRef(allowDiagonal);
  
  // Pure Locomotion Mode - no tilt/steering controls
  
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const connectedPCIdRef = useRef<string | null>(null);
  
  const lastSensorTimeRef = useRef(0);
  const sensorRateCountRef = useRef(0);
  const lastSensorStreamRef = useRef(0);
  const stepIdRef = useRef(0);
  
  const emaFilteredRef = useRef(0);
  const magnitudeHistoryRef = useRef<number[]>([]);
  const movingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const emaAlphaRef = useRef(emaAlpha);
  const stepDurationRef = useRef(stepDuration);
  
  const dynamicThresholdRef = useRef<DynamicThresholdState>({
    magnitudeWindow: [],
    dynamicThreshold: 0,
    previousMag: 0,
    stepBufferCount: 0,
    isStepBufferActive: true,
    validatedSteps: 0,
    inPeakPhase: false,
    peakMagnitude: 0,
    peakTime: 0
  });
  const calibrationRef = useRef<CalibrationData>({
    ax: 0, ay: 0, az: 0,
    gx: 0, gy: 0, gz: 0,
    samples: 0, calibrated: false,
    maxMagnitude: 0, startTime: 0
  });
  const lastStepTimeRef = useRef(0);
  const inactivityTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const precisionFloorRef = useRef(precisionFloor);
  
  const MAGNITUDE_WINDOW_SIZE = 50;
  const MAX_STEP_INTERVAL = 2000;
  const VALIDATION_STEPS_REQUIRED = 3;
  const INACTIVITY_RESET_TIME = 3000;
  
  // Omni-Motion Engine: 2-second Silent Check calibration
  const CALIBRATION_DURATION_MS = 2000; // 2 seconds
  
  // Ultra-Sensitivity Mode: Hair-trigger detection
  const [ultraMode, setUltraMode] = useState(() => {
    const saved = localStorage.getItem('vsteps-ultra-mode');
    return saved === 'true';
  });
  
  // Level 10 Mode: Maximum sensitivity - matches StepL rapid-fire response
  const [level10Mode, setLevel10Mode] = useState(() => {
    const saved = localStorage.getItem('vsteps-level10-mode');
    return saved === 'true';
  });
  
  // Omni-Motion Engine: Triple-Tier Hair-Trigger System
  type OmniMotionMode = 'default' | 'game' | 'cruise';
  const [omniMotionMode, setOmniMotionMode] = useState<OmniMotionMode>(() => {
    const saved = localStorage.getItem('vsteps-omnimotion-mode');
    return (saved as OmniMotionMode) || 'game'; // Default to "game" (Level 2.7) for better experience
  });
  
  // Ultra-Sensitive Toggle: Forces Cruise Mode (Level 3.0) regardless of preset
  const [ultraSensitiveToggle, setUltraSensitiveToggle] = useState(() => {
    const saved = localStorage.getItem('vsteps-ultrasensitive-toggle');
    return saved === 'true';
  });
  
  // Apex-Pro Presets (Baseline + offset thresholds)
  // Level 2.4 (Default): Baseline + 0.8 - Stable walking
  // Level 2.7 (Game): Baseline + 0.4 - Responsive gaming
  // Level 3.0 (Cruise/Ultra): Baseline + 0.1 - Maximum Hair-Trigger
  const omniMotionPresets = {
    default: { offset: 0.8, buffer: 800, debounce: 30, label: 'Hard', level: '2.4', description: 'Stable, reliable step detection' },
    game: { offset: 0.4, buffer: 800, debounce: 25, label: 'Default', level: '2.7', description: 'Responsive for competitive gaming' },
    cruise: { offset: 0.1, buffer: 800, debounce: 20, label: 'Novice', level: '3.0', description: 'Maximum Hair-Trigger (Ultra-Sensitive)' }
  };
  
  // Omni-Motion Sliders with Basic Names
  // Trigger Force: How easy it is to start walking (threshold offset)
  // Default to "game" preset (Level 2.7) for better out-of-box experience
  const [triggerForceSlider, setTriggerForceSlider] = useState(() => {
    const saved = localStorage.getItem('vsteps-trigger-force');
    return saved !== null ? parseFloat(saved) : omniMotionPresets.game.offset;
  });
  // Walking Flow: How smooth the 'W' key stays held (buffer timer)
  const [walkingFlowSlider, setWalkingFlowSlider] = useState(() => {
    const saved = localStorage.getItem('vsteps-walking-flow');
    return saved !== null ? parseInt(saved) : omniMotionPresets.game.buffer;
  });
  // Reaction Speed: How fast it detects the next shake (debounce)
  const [reactionSpeedSlider, setReactionSpeedSlider] = useState(() => {
    const saved = localStorage.getItem('vsteps-reaction-speed');
    return saved !== null ? parseInt(saved) : omniMotionPresets.game.debounce;
  });
  
  // Apply Omni-Motion preset when mode changes
  const applyOmniMotionPreset = useCallback((mode: OmniMotionMode) => {
    const preset = omniMotionPresets[mode];
    setTriggerForceSlider(preset.offset);
    setWalkingFlowSlider(preset.buffer);
    setReactionSpeedSlider(preset.debounce);
    setOmniMotionMode(mode);
    // All modes use raw detection (no extra filtering)
    setUltraMode(true);
  }, []);
  
  // Apex-Pro: Use Baseline + offset for threshold
  // Ultra-Sensitive ON: Baseline + 0.1 (Cruise 3.0 Logic)
  // Ultra-Sensitive OFF: Level 2.7 (Game) = +0.4, Level 2.4 (Default) = +0.8
  const STEP_THRESHOLD_OFFSET = ultraSensitiveToggle ? 0.1 : triggerForceSlider;
  // STEP COOLDOWN: 350ms minimum - humanly impossible to step faster than this
  // This filters out device shaking/jitter from actual walking steps
  const STEP_COOLDOWN = 350; // Milliseconds
  // Reaction Speed slider is the internal debounce (for algorithm), STEP_COOLDOWN is the step filter
  const MIN_STEP_INTERVAL = Math.max(reactionSpeedSlider, STEP_COOLDOWN);
  
  const tuningPresets = {
    quick: { alpha: 0.5, duration: 500, precisionFloor: 0.3, label: 'Quick Response' },
    balanced: { alpha: 0.2, duration: 800, precisionFloor: 0.3, label: 'Balanced' },
    stable: { alpha: 0.1, duration: 1000, precisionFloor: 0.3, label: 'Stable' },
    pocket: { alpha: 0.15, duration: 1000, precisionFloor: 0.5, label: 'Pocket Mode' }
  };
  
  useEffect(() => {
    emaAlphaRef.current = emaAlpha;
  }, [emaAlpha]);
  
  useEffect(() => {
    stepDurationRef.current = stepDuration;
  }, [stepDuration]);
  
  useEffect(() => {
    localStorage.setItem('vsteps-ema-alpha', String(emaAlpha));
  }, [emaAlpha]);
  
  useEffect(() => {
    localStorage.setItem('vsteps-step-duration', String(stepDuration));
  }, [stepDuration]);
  
  useEffect(() => {
    localStorage.setItem('vsteps-tuning-preset', tuningPreset);
  }, [tuningPreset]);
  
  useEffect(() => {
    localStorage.setItem('vsteps-burst-mode', String(burstMode));
  }, [burstMode]);
  
  useEffect(() => {
    localStorage.setItem('vsteps-burst-presses', String(burstPresses));
  }, [burstPresses]);
  
  useEffect(() => {
    localStorage.setItem('vsteps-webrtc-enabled', String(webrtcEnabled));
  }, [webrtcEnabled]);

  useEffect(() => {
    localStorage.setItem('vsteps-ultra-mode', String(ultraMode));
  }, [ultraMode]);

  useEffect(() => {
    localStorage.setItem('vsteps-level10-mode', String(level10Mode));
    // Level 10 implies Ultra Mode
    if (level10Mode && !ultraMode) {
      setUltraMode(true);
    }
  }, [level10Mode, ultraMode]);

  useEffect(() => {
    localStorage.setItem('vsteps-hold-duration', String(holdDuration));
  }, [holdDuration]);
  
  // Omni-Motion persistence
  useEffect(() => {
    localStorage.setItem('vsteps-omnimotion-mode', omniMotionMode);
  }, [omniMotionMode]);
  
  useEffect(() => {
    localStorage.setItem('vsteps-ultrasensitive-toggle', String(ultraSensitiveToggle));
  }, [ultraSensitiveToggle]);
  
  useEffect(() => {
    localStorage.setItem('vsteps-trigger-force', String(triggerForceSlider));
  }, [triggerForceSlider]);
  
  useEffect(() => {
    localStorage.setItem('vsteps-walking-flow', String(walkingFlowSlider));
    // Sync walking flow slider with hold duration for PC transmission
    setHoldDuration(walkingFlowSlider);
  }, [walkingFlowSlider]);
  
  useEffect(() => {
    localStorage.setItem('vsteps-reaction-speed', String(reactionSpeedSlider));
  }, [reactionSpeedSlider]);
  
  // Omni-Axis Steering: Persistence
  useEffect(() => {
    localStorage.setItem('vsteps-steering-enabled', String(steeringEnabled));
    steeringEnabledRef.current = steeringEnabled;
  }, [steeringEnabled]);
  
  useEffect(() => {
    localStorage.setItem('vsteps-lateral-axis', lateralAxis);
    lateralAxisRef.current = lateralAxis;
  }, [lateralAxis]);
  
  useEffect(() => {
    localStorage.setItem('vsteps-lateral-axis-sign', String(lateralAxisSign));
    lateralAxisSignRef.current = lateralAxisSign;
  }, [lateralAxisSign]);
  
  useEffect(() => {
    localStorage.setItem('vsteps-lateral-axis-calibrated', String(lateralAxisCalibrated));
    lateralAxisCalibratedRef.current = lateralAxisCalibrated;
  }, [lateralAxisCalibrated]);
  
  // Turning Sensitivity persistence (Apex-Pro)
  useEffect(() => {
    localStorage.setItem('vsteps-turning-sensitivity', String(turningSensitivity));
    turningSensitivityRef.current = turningSensitivity;
  }, [turningSensitivity]);
  
  // Ultra Lateral Mode persistence
  useEffect(() => {
    localStorage.setItem('vsteps-ultra-lateral', String(ultraLateralMode));
    ultraLateralModeRef.current = ultraLateralMode;
  }, [ultraLateralMode]);
  
  // Allow Diagonal persistence
  useEffect(() => {
    localStorage.setItem('vsteps-allow-diagonal', String(allowDiagonal));
    allowDiagonalRef.current = allowDiagonal;
  }, [allowDiagonal]);
  
  // Save My Setup - Auto-save to localStorage
  const [settingsSaved, setSettingsSaved] = useState(false);
  const saveMySetup = useCallback(() => {
    const settings = {
      mode: omniMotionMode,
      ultraSensitive: ultraSensitiveToggle,
      triggerForce: triggerForceSlider,
      walkingFlow: walkingFlowSlider,
      reactionSpeed: reactionSpeedSlider,
      turningSensitivity: turningSensitivity,
      // Legacy compatibility for PC receiver
      buffer: walkingFlowSlider,
      debounce: reactionSpeedSlider
    };
    localStorage.setItem('vsteps-omnimotion-settings', JSON.stringify(settings));
    localStorage.setItem('vsteps-omnimotion-mode', omniMotionMode);
    localStorage.setItem('vsteps-ultrasensitive-toggle', String(ultraSensitiveToggle));
    localStorage.setItem('vsteps-trigger-force', String(triggerForceSlider));
    localStorage.setItem('vsteps-walking-flow', String(walkingFlowSlider));
    localStorage.setItem('vsteps-reaction-speed', String(reactionSpeedSlider));
    localStorage.setItem('vsteps-turning-sensitivity', String(turningSensitivity));
    
    // Emit config to PC via Socket.io for persistent saving
    if (socketRef.current?.connected) {
      socketRef.current.emit('vsteps-config-update', settings);
      console.log('[VSteps Precision Pocket] Config sent to PC:', settings);
    }
    
    setSettingsSaved(true);
    setTimeout(() => setSettingsSaved(false), 2000);
    console.log('[VSteps Precision Pocket] Settings saved:', settings);
  }, [omniMotionMode, ultraSensitiveToggle, triggerForceSlider, walkingFlowSlider, reactionSpeedSlider, steeringSensitivity]);
  
  useEffect(() => {
    localStorage.setItem('vsteps-precision-floor', String(precisionFloor));
    precisionFloorRef.current = precisionFloor;
  }, [precisionFloor]);
  
  // Detection Threshold persistence
  useEffect(() => {
    localStorage.setItem('vsteps-detection-threshold', String(detectionThreshold));
    detectionThresholdRef.current = detectionThreshold;
  }, [detectionThreshold]);
  
  const applyPreset = useCallback((preset: 'quick' | 'balanced' | 'stable' | 'pocket') => {
    const config = tuningPresets[preset];
    setEmaAlpha(config.alpha);
    setStepDuration(config.duration);
    setHoldDuration(config.duration);
    setPrecisionFloor(config.precisionFloor);
    setTuningPreset(preset);
    if (preset === 'pocket') {
      setSprintEnabled(false);
    }
  }, []);

  const requestWakeLock = useCallback(async () => {
    if ('wakeLock' in navigator) {
      try {
        wakeLockRef.current = await navigator.wakeLock.request('screen');
        console.log('[WakeLock] Screen will stay awake');
      } catch (err) {
        console.log('[WakeLock] Failed to acquire wake lock:', err);
      }
    }
  }, []);

  const releaseWakeLock = useCallback(() => {
    if (wakeLockRef.current) {
      wakeLockRef.current.release();
      wakeLockRef.current = null;
      console.log('[WakeLock] Released');
    }
  }, []);

  const togglePocketLock = useCallback(() => {
    setPocketLocked(prev => {
      const newState = !prev;
      if (newState) {
        requestWakeLock();
      } else {
        releaseWakeLock();
      }
      return newState;
    });
  }, [requestWakeLock, releaseWakeLock]);
  
  // Omni-Axis Steering: Calibration is handled by startSteeringCalibration callback
  
  const lastTapTimeRef = useRef(0);
  
  const handleLockOverlayPointerUp = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    const now = Date.now();
    const timeSinceLastTap = now - lastTapTimeRef.current;
    
    if (timeSinceLastTap < 400 && timeSinceLastTap > 50) {
      setPocketLocked(false);
      releaseWakeLock();
      lastTapTimeRef.current = 0;
    } else {
      lastTapTimeRef.current = now;
    }
  }, [releaseWakeLock]);

  useEffect(() => {
    if (!isRunning && pocketLocked) {
      setPocketLocked(false);
      releaseWakeLock();
    }
  }, [isRunning, pocketLocked, releaseWakeLock]);

  useEffect(() => {
    return () => {
      if (wakeLockRef.current) {
        wakeLockRef.current.release();
        wakeLockRef.current = null;
      }
    };
  }, []);

  const socketRef = useRef<Socket | null>(null);
  const stepTimesRef = useRef<number[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imuHistoryRef = useRef<IMUSample[]>([]);
  const gravityRef = useRef({ x: 0, y: 0, z: 0 });
  const lpfRef = useRef({ ax: 0, ay: 0, az: 0 });
  const lastVerticalMagnitudeRef = useRef(0);

  // Session-based pairing
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionJoined, setSessionJoined] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);

  useEffect(() => {
    const url = `${window.location.protocol}//${window.location.host}`;
    setServerUrl(url);
    
    // Parse session ID from URL query parameter
    const urlParams = new URLSearchParams(window.location.search);
    const sessionFromUrl = urlParams.get('session');
    if (sessionFromUrl) {
      setSessionId(sessionFromUrl.toUpperCase());
    }

    const socket = io(url, {
      transports: ["websocket", "polling"],
    });

    socket.on("connect", () => {
      setIsConnected(true);
      
      // Join session if we have a session ID
      if (sessionFromUrl) {
        socket.emit('join-session', { sessionId: sessionFromUrl.toUpperCase() });
      }
    });
    
    // Session joined successfully
    socket.on("session-joined", (data: { sessionId: string }) => {
      setSessionJoined(true);
      setSessionError(null);
      console.log(`[VSteps] Joined session: ${data.sessionId}`);
    });
    
    // Session error
    socket.on("session-error", (data: { message: string }) => {
      setSessionError(data.message);
      setSessionJoined(false);
      console.error(`[VSteps] Session error: ${data.message}`);
    });

    socket.on("disconnect", () => {
      setIsConnected(false);
    });

    socket.on("step-count-update", (data: { count: number }) => {
      setStepCount(data.count);
    });

    socket.on("direction-counts-update", (data: { forward: number }) => {
      setDirectionCounts(data);
    });

    socket.on("desktop-settings", (data: any) => {
      if (data.detectionThreshold !== undefined) setDetectionThreshold(data.detectionThreshold);
      if (data.holdDuration !== undefined) {
        setHoldDuration(data.holdDuration);
        setStepDuration(data.holdDuration);
        setTuningPreset('custom');
      }
      if (data.sprintThreshold !== undefined) setSprintThreshold(data.sprintThreshold);
      if (data.sprintEnabled !== undefined) setSprintEnabled(data.sprintEnabled);
      if (data.emaAlpha !== undefined) {
        setEmaAlpha(data.emaAlpha);
        setTuningPreset('custom');
      }
      if (data.stepDuration !== undefined) {
        setStepDuration(data.stepDuration);
        setHoldDuration(data.stepDuration);
        setTuningPreset('custom');
      }
      if (data.tuningPreset !== undefined && data.tuningPreset !== 'custom') {
        applyPreset(data.tuningPreset);
      }
      if (data.burstMode !== undefined) setBurstMode(data.burstMode);
      if (data.burstPresses !== undefined) setBurstPresses(data.burstPresses);
    });

    socket.on("webrtc-pc-list", (data: { pcs: string[] }) => {
      setAvailablePCs(data.pcs);
    });

    socket.on("pc-receiver-available", (data: { id: string }) => {
      setAvailablePCs((prev) => {
        if (!prev.includes(data.id)) return [...prev, data.id];
        return prev;
      });
    });

    socket.on("webrtc-answer", async (data: { fromId: string; answer: RTCSessionDescriptionInit }) => {
      if (peerConnectionRef.current && data.fromId === connectedPCIdRef.current) {
        try {
          await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(data.answer));
          console.log("[WebRTC] Remote description set");
        } catch (err) {
          console.error("[WebRTC] Error setting remote description:", err);
        }
      }
    });

    socket.on("webrtc-ice-candidate", async (data: { fromId: string; candidate: RTCIceCandidateInit }) => {
      if (peerConnectionRef.current && data.fromId === connectedPCIdRef.current) {
        try {
          await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (err) {
          console.error("[WebRTC] Error adding ICE candidate:", err);
        }
      }
    });

    socketRef.current = socket;

    return () => {
      socket.disconnect();
    };
  }, [applyPreset]);

  const connectToPC = useCallback(async (pcId: string) => {
    if (!socketRef.current?.connected) {
      console.error("[WebRTC] Socket not connected");
      return;
    }

    setWebrtcStatus("connecting");
    setConnectedPCId(pcId);
    connectedPCIdRef.current = pcId;

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" }
      ]
    });

    pc.onicecandidate = (event) => {
      if (event.candidate && socketRef.current) {
        socketRef.current.emit("webrtc-ice-candidate", {
          targetId: pcId,
          candidate: event.candidate
        });
      }
    };

    pc.onconnectionstatechange = () => {
      console.log("[WebRTC] Connection state:", pc.connectionState);
      if (pc.connectionState === "connected") {
        setWebrtcStatus("connected");
      } else if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
        setWebrtcStatus("disconnected");
        setConnectedPCId(null);
        connectedPCIdRef.current = null;
      }
    };

    const dataChannel = pc.createDataChannel("vsteps_movement", {
      ordered: false,
      maxRetransmits: 0
    });

    dataChannel.onopen = () => {
      console.log("[WebRTC] Data channel open - P2P connection established!");
      setWebrtcStatus("connected");
    };

    dataChannel.onclose = () => {
      console.log("[WebRTC] Data channel closed");
      setWebrtcStatus("disconnected");
    };

    dataChannel.onerror = (err) => {
      console.error("[WebRTC] Data channel error:", err);
    };

    peerConnectionRef.current = pc;
    dataChannelRef.current = dataChannel;

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      socketRef.current.emit("webrtc-offer", {
        targetId: pcId,
        offer: pc.localDescription
      });

      console.log("[WebRTC] Offer sent to PC:", pcId);
    } catch (err) {
      console.error("[WebRTC] Error creating offer:", err);
      setWebrtcStatus("disconnected");
      setConnectedPCId(null);
    }
  }, []);

  const disconnectWebRTC = useCallback(() => {
    if (dataChannelRef.current) {
      dataChannelRef.current.close();
      dataChannelRef.current = null;
    }
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    setWebrtcStatus("disconnected");
    setConnectedPCId(null);
    connectedPCIdRef.current = null;
    console.log("[WebRTC] Disconnected");
  }, []);

  const refreshPCList = useCallback(() => {
    if (socketRef.current?.connected) {
      socketRef.current.emit("webrtc-request-pc-list");
    }
  }, []);

  const sendViaP2P = useCallback((data: object) => {
    if (dataChannelRef.current?.readyState === "open") {
      dataChannelRef.current.send(JSON.stringify(data));
      return true;
    }
    return false;
  }, []);
  
  // Omni-Axis Steering: Start calibration process
  const startSteeringCalibration = useCallback(() => {
    setIsCalibratingSteering(true);
    setCalibrationPhase('shaking');
    steeringCalibrationRef.current = {
      samples: [],
      startTime: Date.now()
    };
    
    // Haptic to start
    if ('vibrate' in navigator) {
      navigator.vibrate([100, 50, 100]);
    }
    
    // Collect samples for 2 seconds while user shakes left-right
    setTimeout(() => {
      const samples = steeringCalibrationRef.current.samples;
      if (samples.length < 10) {
        console.log('[Omni-Axis] Not enough samples, try again');
        if ('vibrate' in navigator) {
          navigator.vibrate([200, 100, 200]); // Error haptic
        }
        setIsCalibratingSteering(false);
        setCalibrationPhase('idle');
        return;
      }
      
      // Calculate variance for each axis
      const calcVariance = (arr: number[]) => {
        const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
        return arr.reduce((sum, v) => sum + (v - mean) ** 2, 0) / arr.length;
      };
      
      const xVals = samples.map(s => s.x);
      const yVals = samples.map(s => s.y);
      const zVals = samples.map(s => s.z);
      
      const xVar = calcVariance(xVals);
      const yVar = calcVariance(yVals);
      const zVar = calcVariance(zVals);
      
      console.log(`[Omni-Axis] Variance - X: ${xVar.toFixed(2)}, Y: ${yVar.toFixed(2)}, Z: ${zVar.toFixed(2)}`);
      
      // Find dominant axis (highest variance = lateral movement axis)
      let dominantAxis: LateralAxis = 'x';
      let maxVar = xVar;
      if (yVar > maxVar) { dominantAxis = 'y'; maxVar = yVar; }
      if (zVar > maxVar) { dominantAxis = 'z'; }
      
      // Default sign to +1, user can swap if reversed
      const sign: 1 | -1 = 1;
      
      setLateralAxis(dominantAxis);
      setLateralAxisSign(sign);
      setLateralAxisCalibrated(true);
      setIsCalibratingSteering(false);
      setCalibrationPhase('done');
      
      // Success haptic
      if ('vibrate' in navigator) {
        navigator.vibrate([50, 30, 50, 30, 50]);
      }
      
      console.log(`[Omni-Axis] Calibrated! Lateral axis: ${dominantAxis}. User can swap direction if needed.`);
      
      // Reset phase after showing "done"
      setTimeout(() => setCalibrationPhase('idle'), 1500);
    }, 2000);
  }, []);
  
  // Omni-Axis Steering: Swap A/D direction (flip sign)
  const swapSteeringDirection = useCallback(() => {
    setLateralAxisSign(prev => {
      const newSign: 1 | -1 = prev === 1 ? -1 : 1;
      lateralAxisSignRef.current = newSign;
      console.log(`[Omni-Axis] Direction swapped: ${newSign > 0 ? '+' : '-'}`);
      if ('vibrate' in navigator) {
        navigator.vibrate(50);
      }
      return newSign;
    });
  }, []);
  
  // Apex-Pro: "Set Forward" calibration - capture current gamma as reference
  const setForwardCalibration = useCallback(() => {
    // Freeze current gamma as the forward reference
    forwardGammaRef.current = latestGammaRef.current;
    // Reset EMA smoothing state to avoid stale values
    smoothedGammaRef.current = 0;
    setForwardCalibrated(true);
    if ('vibrate' in navigator) {
      navigator.vibrate([30, 20, 30]); // Confirmation haptic
    }
    console.log(`[Apex-Pro] Forward calibrated at gamma: ${forwardGammaRef.current.toFixed(1)}°`);
  }, []);
  
  // Apex-Pro Steering: Process device orientation for angle-based steering
  const processOrientationSteering = useCallback((gamma: number) => {
    // Only process if enabled and running
    if (!steeringEnabledRef.current || !isRunning) {
      return;
    }
    
    // Apply forward calibration offset (always subtract reference, even if 0)
    const calibratedGamma = gamma - forwardGammaRef.current;
    
    // Apply axis sign for direction swap
    const adjustedGamma = calibratedGamma * lateralAxisSignRef.current;
    
    // Apply EMA smoothing to reduce jitter
    smoothedGammaRef.current = STEERING_EMA_ALPHA * adjustedGamma + (1 - STEERING_EMA_ALPHA) * smoothedGammaRef.current;
    const smoothedGamma = smoothedGammaRef.current;
    
    setCurrentLateralAccel(smoothedGamma / 5.7); // Legacy display compatibility
    setCurrentGammaAngle(smoothedGamma);
    
    const currentSteering = steeringDirectionRef.current;
    // Apex-Pro: Use angle-based threshold (degrees)
    // Ultra Mode: 2° threshold, Normal: Use Turning Sensitivity slider (5°-90°)
    const triggerAngle = ultraLateralModeRef.current ? ULTRA_TURNING_THRESHOLD : turningSensitivityRef.current;
    const stopAngle = Math.max(1, triggerAngle - TURNING_HYSTERESIS);
    let newDirection: 'left' | 'right' | null = null;
    
    // Positive gamma = right (D), Negative gamma = left (A)
    // Use smoothed values for more stable steering
    if (smoothedGamma > triggerAngle) {
      newDirection = 'right';
    } else if (smoothedGamma < -triggerAngle) {
      newDirection = 'left';
    } else if (currentSteering === 'right' && smoothedGamma > stopAngle) {
      newDirection = 'right'; // Hysteresis
    } else if (currentSteering === 'left' && smoothedGamma < -stopAngle) {
      newDirection = 'left'; // Hysteresis
    }
    
    // Only emit if direction changed
    if (newDirection !== currentSteering) {
      steeringDirectionRef.current = newDirection;
      setSteeringDirection(newDirection);
      
      // Emit lateral movement event
      const steeringData = {
        direction: newDirection,
        angle: adjustedGamma.toFixed(1),
        allowDiagonal: allowDiagonalRef.current
      };
      
      const sentViaP2P = sendViaP2P({ type: "lateral", ...steeringData });
      
      if (!sentViaP2P && socketRef.current?.connected) {
        socketRef.current.emit("lateral-movement", steeringData);
        console.log(`[Apex-Pro Steering] ${newDirection || 'center'} (gamma: ${adjustedGamma.toFixed(1)}°)`);
      }
      
      // Haptic Compass: 20ms trigger, double-tap on release
      if ('vibrate' in navigator) {
        if (newDirection) {
          navigator.vibrate(20);
        } else {
          navigator.vibrate([10, 30, 10]);
        }
      }
    }
  }, [isRunning, sendViaP2P]);
  
  // Apex-Pro: DeviceOrientationEvent handler for gamma-based steering
  const handleOrientation = useCallback((event: DeviceOrientationEvent) => {
    const gamma = event.gamma || 0; // Left/right tilt angle (-90 to 90)
    
    // Store latest gamma for "Set Forward" calibration (don't overwrite reference)
    latestGammaRef.current = gamma;
    
    // Process orientation for steering if enabled
    if (steeringEnabledRef.current) {
      processOrientationSteering(gamma);
    }
  }, [processOrientationSteering]);
  
  // Omni-Axis Steering: Process lateral acceleration in motion handler (fallback)
  const processLateralSteering = useCallback((ax: number, ay: number, az: number) => {
    // If calibrating, collect samples
    if (isCalibratingSteering) {
      steeringCalibrationRef.current.samples.push({ x: ax, y: ay, z: az });
      return;
    }
    
    // Fallback: Use accelerometer if DeviceOrientation is not supported
    if (!orientationSupportedRef.current && steeringEnabledRef.current && isRunning) {
      // Get lateral acceleration - use calibrated axis if available, default to X axis
      const axis = lateralAxisCalibratedRef.current ? lateralAxisRef.current : 'x';
      const sign = lateralAxisSignRef.current;
      let lateralAccel = axis === 'x' ? ax : axis === 'y' ? ay : az;
      lateralAccel *= sign;
      
      // Estimate angle from acceleration (1 m/s² ≈ 5.7° for gravity component)
      const angleEstimate = lateralAccel * 5.7;
      latestGammaRef.current = angleEstimate;
      
      // Use the same orientation processing logic
      processOrientationSteering(angleEstimate);
    }
  }, [isCalibratingSteering, isRunning, processOrientationSteering]);

  useEffect(() => {
    localStorage.setItem('vsteps-sprint-enabled', String(sprintEnabled));
  }, [sprintEnabled]);


  const classifyDirection = useCallback((_currentSample: IMUSample): Direction => {
    return "forward";
  }, []);

  const mapSensitivityToThreshold = useCallback((sens: number): number => {
    const minThreshold = 0.5;
    const maxThreshold = 4.0;
    return maxThreshold - ((sens - 1) / 99) * (maxThreshold - minThreshold);
  }, []);

  const detectStep = useCallback(
    (sample: IMUSample, rawMagnitude: number) => {
      const now = Date.now();
      const state = dynamicThresholdRef.current;
      
      // Store magnitude for visualization
      state.magnitudeWindow.push(rawMagnitude);
      if (state.magnitudeWindow.length > MAGNITUDE_WINDOW_SIZE) {
        state.magnitudeWindow.shift();
      }
      
      lastVerticalMagnitudeRef.current = rawMagnitude;
      
      // Update dynamic threshold display (for UI feedback)
      setDynamicThreshold(rawMagnitude);
      
      // PEAK-VALLEY STEP DETECTION: More accurate, less sensitive
      // A step is only counted when we see a complete peak-valley cycle:
      // 1. Magnitude rises above threshold (peak phase)
      // 2. Magnitude falls back below threshold (valley phase)
      // 3. Step is counted when valley is confirmed
      
      const threshold = detectionThresholdRef.current;
      const valleyThreshold = threshold * 0.7; // Valley must drop to 70% of threshold
      const isAboveThreshold = rawMagnitude > threshold;
      const isBelowValley = rawMagnitude < valleyThreshold;
      
      // Track peak-valley state
      if (!state.inPeakPhase && isAboveThreshold) {
        // Entering peak phase - magnitude crossed above threshold
        state.inPeakPhase = true;
        state.peakMagnitude = rawMagnitude;
        state.peakTime = now;
      } else if (state.inPeakPhase) {
        // In peak phase - track the maximum
        if (rawMagnitude > state.peakMagnitude) {
          state.peakMagnitude = rawMagnitude;
        }
        
        // Check for valley (step completion)
        if (isBelowValley) {
          // Valley detected - complete the step
          state.inPeakPhase = false;
          
          const timeSinceLastStep = now - lastStepTimeRef.current;
          const isFirstStep = lastStepTimeRef.current === 0;
          const isValidTiming = isFirstStep || (timeSinceLastStep > MIN_STEP_INTERVAL && timeSinceLastStep < MAX_STEP_INTERVAL);
          
          if (isValidTiming) {
            // Level 10 Mode: Bypass validation buffer
            const bypassValidation = level10Mode;
            
            if (bypassValidation) {
              triggerValidatedStep(sample, now, true);
            } else if (state.isStepBufferActive) {
              state.stepBufferCount++;
              setStepBufferStatus({ count: state.stepBufferCount, active: true });
              
              if (state.stepBufferCount >= VALIDATION_STEPS_REQUIRED) {
                state.isStepBufferActive = false;
                setStepBufferStatus({ count: 0, active: false });
                triggerValidatedStep(sample, now, true);
              }
            } else {
              triggerValidatedStep(sample, now, true);
            }
            
            lastStepTimeRef.current = now;
            
            if (inactivityTimeoutRef.current) {
              clearTimeout(inactivityTimeoutRef.current);
            }
            inactivityTimeoutRef.current = setTimeout(() => {
              state.isStepBufferActive = true;
              state.stepBufferCount = 0;
              lastStepTimeRef.current = 0;
              setStepBufferStatus({ count: 0, active: true });
            }, INACTIVITY_RESET_TIME);
          } else if (timeSinceLastStep >= MAX_STEP_INTERVAL) {
            lastStepTimeRef.current = 0;
          }
        }
      }
      
      state.previousMag = rawMagnitude;
    },
    [detectionThreshold, level10Mode]
  );
  
  const triggerValidatedStep = useCallback((sample: IMUSample, timestamp: number, emitEvent: boolean) => {
    const direction = classifyDirection(sample);
    
    // Simple Pro: Haptic feedback on every detected step (10ms vibration)
    if ('vibrate' in navigator) {
      navigator.vibrate(10);
    }
    
    const rawMagnitude = Math.sqrt(sample.ax ** 2 + sample.ay ** 2 + sample.az ** 2);
    const isSprint = sprintEnabled && rawMagnitude > sprintThreshold;
    if (isSprint) {
      setSprintCount((prev) => prev + 1);
      sessionSprintsRef.current += 1;
    }
    
    sessionStepsRef.current += 1;
    
    // Update local step count immediately for responsive UI
    setStepCount((prev) => prev + 1);
    setDirectionCounts((prev) => ({ ...prev, forward: prev.forward + 1 }));
    
    stepTimesRef.current.push(timestamp);
    stepTimesRef.current = stepTimesRef.current.filter(
      (t) => Date.now() - t < 60000
    );
    setStepsPerMinute(stepTimesRef.current.length);

    setShowPulse(true);
    setLastDirection(direction);
    setIsMoving(true);
    
    if (movingTimeoutRef.current) {
      clearTimeout(movingTimeoutRef.current);
    }
    movingTimeoutRef.current = setTimeout(() => {
      setIsMoving(false);
    }, stepDurationRef.current);
    
    stepIdRef.current += 1;
    const logEntry: StepLogEntry = {
      id: stepIdRef.current,
      timestamp: new Date(timestamp),
      direction: direction as "forward",
      isSprint,
    };
    setStepHistory((prev) => [logEntry, ...prev].slice(0, 50));
    
    setTimeout(() => {
      setShowPulse(false);
      setLastDirection(null);
    }, 400);

    if (emitEvent) {
      const movementData = { 
        direction, 
        isSprint,
        holdDuration,
        burstMode,
        burstPresses,
        allowDiagonal: allowDiagonalRef.current
      };

      const sentViaP2P = sendViaP2P({ type: "movement", ...movementData });
      
      if (!sentViaP2P && socketRef.current?.connected) {
        console.log("[VSteps] >>> Emitting FORWARD step via socket");
        socketRef.current.emit("movement-detected", movementData);
        setTransmittedSteps((prev) => prev + 1);
      } else if (sentViaP2P) {
        console.log("[VSteps] >>> Sent FORWARD step via P2P");
        setTransmittedSteps((prev) => prev + 1);
      } else {
        console.warn("[VSteps] WARNING: Cannot emit - socket not connected!");
      }
    }
  }, [classifyDirection, sprintThreshold, holdDuration, sprintEnabled, burstMode, burstPresses, sendViaP2P, level10Mode]);

  const handleMotion = useCallback(
    (event: DeviceMotionEvent) => {
      const accelWithGravity = event.accelerationIncludingGravity;
      const accelWithoutGravity = event.acceleration;
      const rotation = event.rotationRate;
      
      if (!accelWithGravity) return;

      const now = Date.now();
      
      if (lastSensorTimeRef.current > 0) {
        sensorRateCountRef.current++;
        const elapsed = now - lastSensorTimeRef.current;
        if (elapsed >= 1000) {
          const rate = Math.round((sensorRateCountRef.current / elapsed) * 1000);
          setSensorRate(rate);
          sensorRateCountRef.current = 0;
          lastSensorTimeRef.current = now;
        }
      } else {
        lastSensorTimeRef.current = now;
      }

      let ax: number, ay: number, az: number;

      if (accelWithoutGravity && accelWithoutGravity.x !== null) {
        ax = accelWithoutGravity.x || 0;
        ay = accelWithoutGravity.y || 0;
        az = accelWithoutGravity.z || 0;
      } else {
        const rawX = accelWithGravity.x || 0;
        const rawY = accelWithGravity.y || 0;
        const rawZ = accelWithGravity.z || 0;

        const alpha = 0.8;
        gravityRef.current.x = alpha * gravityRef.current.x + (1 - alpha) * rawX;
        gravityRef.current.y = alpha * gravityRef.current.y + (1 - alpha) * rawY;
        gravityRef.current.z = alpha * gravityRef.current.z + (1 - alpha) * rawZ;

        ax = rawX - gravityRef.current.x;
        ay = rawY - gravityRef.current.y;
        az = rawZ - gravityRef.current.z;
      }

      const gx = rotation?.alpha || 0;
      const gy = rotation?.beta || 0;
      const gz = rotation?.gamma || 0;

      // StepL Auto-Pro: Time-based calibration (3 seconds)
      // Track maximum magnitude during idle to set noise floor
      if (!calibrationRef.current.calibrated) {
        const elapsedMs = now - calibrationRef.current.startTime;
        
        // Level 10/Ultra Mode: Use raw magnitude, Normal: Apply LPF for cleaner reading
        let calibMagnitude: number;
        if (level10Mode || ultraMode) {
          // Level 10/Ultra Mode: Raw magnitude - no filtering
          calibMagnitude = Math.sqrt(ax ** 2 + ay ** 2 + az ** 2);
        } else {
          // Normal Mode: Apply LPF for cleaner magnitude reading during calibration
          const LPF_ALPHA_CAL = 0.34;
          lpfRef.current.ax = LPF_ALPHA_CAL * ax + (1 - LPF_ALPHA_CAL) * lpfRef.current.ax;
          lpfRef.current.ay = LPF_ALPHA_CAL * ay + (1 - LPF_ALPHA_CAL) * lpfRef.current.ay;
          lpfRef.current.az = LPF_ALPHA_CAL * az + (1 - LPF_ALPHA_CAL) * lpfRef.current.az;
          calibMagnitude = Math.sqrt(
            lpfRef.current.ax ** 2 + 
            lpfRef.current.ay ** 2 + 
            lpfRef.current.az ** 2
          );
        }
        
        // Track maximum magnitude (noise floor detection)
        if (calibMagnitude > calibrationRef.current.maxMagnitude) {
          calibrationRef.current.maxMagnitude = calibMagnitude;
        }
        
        // Also accumulate averages for offset calibration
        calibrationRef.current.samples++;
        const n = calibrationRef.current.samples;
        calibrationRef.current.ax = calibrationRef.current.ax + (ax - calibrationRef.current.ax) / n;
        calibrationRef.current.ay = calibrationRef.current.ay + (ay - calibrationRef.current.ay) / n;
        calibrationRef.current.az = calibrationRef.current.az + (az - calibrationRef.current.az) / n;
        calibrationRef.current.gx = calibrationRef.current.gx + (gx - calibrationRef.current.gx) / n;
        calibrationRef.current.gy = calibrationRef.current.gy + (gy - calibrationRef.current.gy) / n;
        calibrationRef.current.gz = calibrationRef.current.gz + (gz - calibrationRef.current.gz) / n;
        
        // Update progress based on elapsed time (3 seconds)
        const progress = Math.min(100, Math.round((elapsedMs / CALIBRATION_DURATION_MS) * 100));
        setCalibrationProgress(progress);
        
        // Complete calibration after 2-second Silent Check
        if (elapsedMs >= CALIBRATION_DURATION_MS) {
          calibrationRef.current.calibrated = true;
          
          // Omni-Motion Engine: Use Baseline (maxMagnitude) + Offset
          // Cruise (3.0): +0.1, Game (2.7): +0.4, Default (2.4): +0.8
          const baseline = calibrationRef.current.maxMagnitude;
          const autoThreshold = baseline + STEP_THRESHOLD_OFFSET;
          setDetectionThreshold(autoThreshold);
          console.log(`[VSteps Omni-Motion] Calibration complete: Baseline=${baseline.toFixed(2)}, Offset=+${STEP_THRESHOLD_OFFSET.toFixed(2)}, Threshold=${autoThreshold.toFixed(2)} m/s²`);
          
          setIsCalibrating(false);
          setCalibrationProgress(100);
          
          // Clear timeout since calibration completed normally
          if ((window as any).vstepsCalibrationTimeout) {
            clearTimeout((window as any).vstepsCalibrationTimeout);
          }
        }
        return; // Skip step detection during calibration
      }

      if (calibrationRef.current.calibrated) {
        ax -= calibrationRef.current.ax;
        ay -= calibrationRef.current.ay;
        az -= calibrationRef.current.az;
      }

      // Level 10/Ultra Mode: Use raw data, Normal Mode: Apply LPF
      let filteredAx: number, filteredAy: number, filteredAz: number;
      if (level10Mode || ultraMode) {
        // Level 10/Ultra Mode: Raw sensor data - maximum sensitivity
        filteredAx = ax;
        filteredAy = ay;
        filteredAz = az;
      } else {
        // Normal Mode: Apply Low-Pass Filter
        const LPF_ALPHA = 0.34;
        lpfRef.current.ax = LPF_ALPHA * ax + (1 - LPF_ALPHA) * lpfRef.current.ax;
        lpfRef.current.ay = LPF_ALPHA * ay + (1 - LPF_ALPHA) * lpfRef.current.ay;
        lpfRef.current.az = LPF_ALPHA * az + (1 - LPF_ALPHA) * lpfRef.current.az;
        filteredAx = lpfRef.current.ax;
        filteredAy = lpfRef.current.ay;
        filteredAz = lpfRef.current.az;
      }

      const calibratedGx = calibrationRef.current.calibrated ? gx - calibrationRef.current.gx : gx;
      const calibratedGy = calibrationRef.current.calibrated ? gy - calibrationRef.current.gy : gy;
      const calibratedGz = calibrationRef.current.calibrated ? gz - calibrationRef.current.gz : gz;

      const sample: IMUSample = {
        timestamp: now,
        ax: filteredAx,
        ay: filteredAy,
        az: filteredAz,
        gx: calibratedGx,
        gy: calibratedGy,
        gz: calibratedGz,
      };

      imuHistoryRef.current.push(sample);
      if (imuHistoryRef.current.length > 100) {
        imuHistoryRef.current = imuHistoryRef.current.slice(-100);
      }

      const rawMagnitude = Math.sqrt(filteredAx ** 2 + filteredAy ** 2 + filteredAz ** 2);
      
      // Level 10/Ultra Mode: Skip EMA smoothing for maximum responsiveness
      let filteredMagnitude: number;
      if (level10Mode || ultraMode) {
        // Level 10/Ultra Mode: Raw magnitude - no EMA smoothing
        filteredMagnitude = rawMagnitude;
        emaFilteredRef.current = rawMagnitude; // Keep ref updated for visualization
      } else {
        // Normal Mode: Apply EMA smoothing
        const alpha = emaAlphaRef.current;
        emaFilteredRef.current = alpha * rawMagnitude + (1 - alpha) * emaFilteredRef.current;
        filteredMagnitude = emaFilteredRef.current;
      }
      
      magnitudeHistoryRef.current.push(filteredMagnitude);
      if (magnitudeHistoryRef.current.length > 100) {
        magnitudeHistoryRef.current.shift();
      }

      if (socketRef.current?.connected && now - lastSensorStreamRef.current > 50) {
        lastSensorStreamRef.current = now;
        socketRef.current.emit("sensor-data", {
          ax: sample.ax,
          ay: sample.ay,
          az: sample.az,
          gz: sample.gz,
          magnitude: filteredMagnitude,
          threshold: dynamicThresholdRef.current.dynamicThreshold + precisionFloorRef.current,
          dynamicThreshold: dynamicThresholdRef.current.dynamicThreshold,
          precisionFloor: precisionFloorRef.current,
          stepBufferActive: dynamicThresholdRef.current.isStepBufferActive,
          stepBufferCount: dynamicThresholdRef.current.stepBufferCount,
          sensorRate
        });
      }

      if (isRunning && calibrationRef.current.calibrated) {
        detectStep(sample, filteredMagnitude);
      }
      
      // Omni-Axis Steering: Process lateral acceleration for A/D control
      if (steeringEnabledRef.current || isCalibratingSteering) {
        processLateralSteering(filteredAx, filteredAy, filteredAz);
      }
    },
    [isRunning, detectStep, detectionThreshold, mapSensitivityToThreshold, sensorRate, ultraMode, level10Mode, isCalibratingSteering, processLateralSteering]
  );

  useEffect(() => {
    if (permissionGranted) {
      window.addEventListener("devicemotion", handleMotion);
      return () => {
        window.removeEventListener("devicemotion", handleMotion);
      };
    }
  }, [permissionGranted, handleMotion]);
  
  // Apex-Pro: DeviceOrientationEvent listener for gamma-based steering with fallback detection
  useEffect(() => {
    if (permissionGranted && steeringEnabled) {
      let orientationReceived = false;
      
      const orientationHandler = (event: DeviceOrientationEvent) => {
        orientationReceived = true;
        orientationSupportedRef.current = true;
        handleOrientation(event);
      };
      
      window.addEventListener("deviceorientation", orientationHandler);
      
      // Timeout: If no orientation event in 2 seconds, fall back to accelerometer
      const fallbackTimeout = setTimeout(() => {
        if (!orientationReceived) {
          orientationSupportedRef.current = false;
          setOrientationMode('accel');
          console.log('[Apex-Pro] DeviceOrientation not supported - using accelerometer fallback');
        }
      }, 2000);
      
      return () => {
        window.removeEventListener("deviceorientation", orientationHandler);
        clearTimeout(fallbackTimeout);
      };
    }
  }, [permissionGranted, steeringEnabled, handleOrientation]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    ctx.fillStyle = "hsl(var(--muted))";
    ctx.fillRect(0, 0, rect.width, rect.height);

    const history = imuHistoryRef.current;
    if (history.length < 2) return;

    const maxVal = 30;
    const sectionHeight = rect.height / 3;

    const drawAxis = (
      data: number[],
      yOffset: number,
      color: string,
      threshold: number,
      label: string
    ) => {
      const centerY = yOffset + sectionHeight / 2;

      ctx.strokeStyle = "hsl(var(--destructive) / 0.4)";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      const thresholdY1 = centerY - (threshold / maxVal) * (sectionHeight / 2);
      const thresholdY2 = centerY + (threshold / maxVal) * (sectionHeight / 2);
      ctx.beginPath();
      ctx.moveTo(0, thresholdY1);
      ctx.lineTo(rect.width, thresholdY1);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, thresholdY2);
      ctx.lineTo(rect.width, thresholdY2);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();

      data.forEach((val, index) => {
        const x = (index / (data.length - 1)) * rect.width;
        const y = centerY - (val / maxVal) * (sectionHeight / 2);
        if (index === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });

      ctx.stroke();

      ctx.fillStyle = "hsl(var(--muted-foreground))";
      ctx.font = "10px Inter, sans-serif";
      ctx.fillText(label, 4, yOffset + 12);
    };

    const magnitudeData = magnitudeHistoryRef.current;
    const threshold = detectionThreshold;

    drawAxis(magnitudeData, 0, "hsl(var(--primary))", threshold, `Magnitude (threshold: ${threshold.toFixed(1)})`);
    drawAxis(history.map((s) => s.ay), sectionHeight, "hsl(142 76% 36%)", threshold, "Y (Vertical)");
    drawAxis(history.map((s) => s.gz), sectionHeight * 2, "hsl(262 83% 58%)", 2, "Gyro Z (Yaw)");
  }, [imuHistoryRef.current.length, detectionThreshold]);

  useEffect(() => {
    if (!permissionGranted) return;
    
    const interval = setInterval(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);

      // Obsidian Black background for Laser Pulse Monitor
      ctx.fillStyle = "#0B0C10";
      ctx.fillRect(0, 0, rect.width, rect.height);
      
      // Subtle grid lines
      ctx.strokeStyle = "rgba(255, 0, 0, 0.1)";
      ctx.lineWidth = 0.5;
      const gridSpacing = rect.height / 4;
      for (let i = 1; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(0, i * gridSpacing);
        ctx.lineTo(rect.width, i * gridSpacing);
        ctx.stroke();
      }

      const magnitudeData = magnitudeHistoryRef.current;

      const maxVal = 30;
      const centerY = rect.height / 2;
      const amplitude = rect.height / 2.5;
      const time = Date.now() / 1000;
      
      // Draw threshold line (dashed) - subtle
      const thresholdY = centerY - (detectionThreshold / maxVal) * amplitude;
      ctx.strokeStyle = "rgba(255, 0, 0, 0.2)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, thresholdY);
      ctx.lineTo(rect.width, thresholdY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Always draw continuous idle wave animation + actual data
      ctx.strokeStyle = showPulse ? "#FF3333" : "#FF0000";
      ctx.lineWidth = showPulse ? 3 : 2;
      ctx.shadowColor = "#FF0000";
      ctx.shadowBlur = showPulse ? 15 : 8;
      ctx.beginPath();

      const points = Math.max(magnitudeData.length, 100);
      for (let i = 0; i < points; i++) {
        const x = (i / (points - 1)) * rect.width;
        
        // Combine actual data with idle sine wave animation
        const actualValue = magnitudeData[Math.floor(i / points * magnitudeData.length)] || 0;
        // Idle animation: subtle sine wave that constantly moves
        const idleWave = Math.sin(time * 2 + i * 0.08) * 1.5 + Math.sin(time * 3.5 + i * 0.12) * 0.8;
        // Combine: if no significant motion, show idle wave; otherwise blend
        const combinedValue = Math.max(actualValue, 9.8) + idleWave;
        
        const y = centerY - ((combinedValue - 9.8) / maxVal * 2) * amplitude;
        
        if (i === 0) {
          ctx.moveTo(x, Math.max(2, Math.min(rect.height - 2, y)));
        } else {
          ctx.lineTo(x, Math.max(2, Math.min(rect.height - 2, y)));
        }
      }

      ctx.stroke();
      ctx.shadowBlur = 0;

      // Add glow dot at the end of the line (pulsing)
      const lastVal = magnitudeData[magnitudeData.length - 1] || 9.8;
      const lastIdleWave = Math.sin(time * 2 + points * 0.08) * 1.5;
      const lastCombined = Math.max(lastVal, 9.8) + lastIdleWave;
      const lastX = rect.width;
      const lastY = centerY - ((lastCombined - 9.8) / maxVal * 2) * amplitude;
      const dotSize = 3 + Math.sin(time * 4) * 0.5; // Subtle pulse
      ctx.beginPath();
      ctx.arc(lastX - 2, Math.max(4, Math.min(rect.height - 4, lastY)), showPulse ? 5 : dotSize, 0, Math.PI * 2);
      ctx.fillStyle = showPulse ? "#FFFFFF" : "#FF0000";
      ctx.shadowColor = "#FF0000";
      ctx.shadowBlur = showPulse ? 15 : 10;
      ctx.fill();
      ctx.shadowBlur = 0;
    }, 50);

    return () => clearInterval(interval);
  }, [permissionGranted, detectionThreshold, showPulse]);

  const requestMotionPermission = async (): Promise<boolean> => {
    if (
      typeof DeviceMotionEvent !== "undefined" &&
      typeof (DeviceMotionEvent as any).requestPermission === "function"
    ) {
      try {
        const permission = await (DeviceMotionEvent as any).requestPermission();
        if (permission === "granted") {
          setPermissionGranted(true);
          setPermissionError("");
          return true;
        } else {
          setPermissionError("Motion permission denied. Please allow access.");
          return false;
        }
      } catch (err) {
        setPermissionError("Failed to request motion permission.");
        return false;
      }
    } else {
      setPermissionGranted(true);
      return true;
    }
  };

  const syncSessionStats = useCallback(async () => {
    if (!user) return;
    
    const steps = sessionStepsRef.current;
    const sprints = sessionSprintsRef.current;
    const startTime = sessionStartTimeRef.current;
    
    if (steps === 0 && sprints === 0) return;
    
    let playTimeMinutes = 0;
    if (startTime) {
      playTimeMinutes = Math.floor((Date.now() - startTime) / 60000);
    }
    
    try {
      await apiRequest('POST', '/api/sync-stats', {
        userId: user.id,
        steps,
        sprints,
        jumps: 0,
        playTimeMinutes,
      });
      
      sessionStepsRef.current = 0;
      sessionSprintsRef.current = 0;
      sessionStartTimeRef.current = null;
    } catch (error) {
      console.error('Failed to sync stats:', error);
    }
  }, [user]);

  const handleStart = async () => {
    let granted = permissionGranted;
    if (!granted) {
      granted = await requestMotionPermission();
    }
    if (granted) {
      const now = Date.now();
      // StepL Auto-Pro: Initialize calibration with time-based approach
      calibrationRef.current = { 
        ax: 0, ay: 0, az: 0, 
        gx: 0, gy: 0, gz: 0, 
        samples: 0, 
        calibrated: false,
        maxMagnitude: 0,  // Track max magnitude during idle
        startTime: now    // Start time for 3-second calibration
      };
      dynamicThresholdRef.current = {
        magnitudeWindow: [],
        dynamicThreshold: 0,
        previousMag: 0,
        stepBufferCount: 0,
        isStepBufferActive: false,  // Disable step buffer for Auto-Pro
        validatedSteps: 0,
        inPeakPhase: false,
        peakMagnitude: 0,
        peakTime: 0
      };
      gravityRef.current = { x: 0, y: 0, z: 0 };
      setCalibrationProgress(0);
      setStepBufferStatus({ count: 0, active: false });
      setIsCalibrating(true);
      setIsRunning(true);
      sessionStartTimeRef.current = now;
      
      // Add calibration timeout fallback (5 seconds) in case no sensor data
      const calibrationTimeout = setTimeout(() => {
        if (!calibrationRef.current.calibrated) {
          console.log('[VSteps] Calibration timeout - auto-skipping (no sensor data)');
          calibrationRef.current.calibrated = true;
          // Set default threshold if no sensor data received
          setDetectionThreshold(12.0);
          setIsCalibrating(false);
          setCalibrationProgress(100);
        }
      }, 5000);
      
      (window as any).vstepsCalibrationTimeout = calibrationTimeout;
    }
  };

  const handleStop = async () => {
    // Clear calibration timeout if exists
    if ((window as any).vstepsCalibrationTimeout) {
      clearTimeout((window as any).vstepsCalibrationTimeout);
    }
    setIsRunning(false);
    await syncSessionStats();
  };

  useEffect(() => {
    return () => {
      if (sessionStepsRef.current > 0 || sessionSprintsRef.current > 0) {
        syncSessionStats();
      }
    };
  }, [syncSessionStats]);

  const getDirectionIcon = () => {
    switch (lastDirection) {
      case "forward":
        return <ArrowUp className="w-8 h-8" />;
      default:
        return <Footprints className="w-8 h-8" />;
    }
  };

  const getDirectionColor = () => {
    switch (lastDirection) {
      case "forward":
        return "text-primary";
      default:
        return "text-muted-foreground";
    }
  };

  return (
    <div className={`min-h-screen bg-background flex flex-col ${isRunning ? 'controller-active' : ''}`}>
      {pocketLocked && (
        <div 
          className="fixed inset-0 z-[100] bg-black/95 flex flex-col items-center justify-center select-none"
          style={{ touchAction: 'none', overscrollBehavior: 'contain' }}
          onPointerUp={handleLockOverlayPointerUp}
          data-testid="overlay-pocket-lock"
        >
          <Lock className="w-24 h-24 text-white/50 mb-6" />
          <h2 className="text-2xl font-bold text-white mb-2">Pocket Lock Active</h2>
          <p className="text-white/70 text-center px-8 mb-8">
            Motion detection is running.<br/>
            Screen is protected from accidental touches.
          </p>
          <div className="flex items-center gap-2 text-white/50 text-sm">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            {isMoving ? 'Moving...' : 'Detecting steps...'}
          </div>
          <div className="mt-4 text-white/30 text-xs">
            Steps: {stepCount} | Sent to PC: {transmittedSteps}
          </div>
          <div className="absolute bottom-12 text-center">
            <p className="text-white/40 text-sm mb-2">Double-tap to unlock</p>
            <Unlock className="w-8 h-8 text-white/30 mx-auto" />
          </div>
        </div>
      )}
      <header className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-md mx-auto px-4 py-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setLocation('/')}
              data-testid="button-back-dashboard"
            >
              <Home className="w-5 h-5" />
            </Button>
            <span className="font-semibold text-lg" data-testid="text-app-name">VSteps</span>
          </div>
          <div className="flex items-center gap-2">
            {user && (
              <Badge variant="outline" className="gap-1" data-testid="badge-user">
                <User className="w-3 h-3" />
                {profile?.username || 'User'}
              </Badge>
            )}
            <Badge
              variant={isConnected ? "default" : "secondary"}
              className="gap-1"
              data-testid="badge-connection-status"
            >
              {isConnected ? (
                <Wifi className="w-3 h-3" />
              ) : (
                <WifiOff className="w-3 h-3" />
              )}
              {isConnected ? "Connected" : "Disconnected"}
            </Badge>
            {sessionId && (
              <Badge
                variant={sessionJoined ? "default" : sessionError ? "destructive" : "secondary"}
                className="gap-1"
                data-testid="badge-session-status"
              >
                <Link className="w-3 h-3" />
                {sessionJoined ? `Session: ${sessionId}` : sessionError ? "Session Error" : `Joining ${sessionId}...`}
              </Badge>
            )}
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-md mx-auto w-full px-4 py-6 flex flex-col gap-5">
        {/* Laser Pulse Monitor - Full Width Hero */}
        <div className="flex flex-col items-center" data-testid="container-laser-pulse">
          {/* Laser Pulse Canvas - No Border */}
          <div className="relative w-full h-32 laser-pulse-monitor overflow-hidden rounded-lg">
            <canvas 
              ref={canvasRef} 
              className="w-full h-full"
              data-testid="canvas-sensors" 
            />
            {/* Overlay glow effect when step detected */}
            {showPulse && (
              <div className="absolute inset-0 bg-[#FF0000]/15 pointer-events-none apex-pulse-flash" />
            )}
          </div>
          
          {/* Step Count Below Laser Pulse */}
          <div className="flex flex-col items-center mt-4">
            <div className={`flex items-center gap-2 transition-all duration-300 ${showPulse ? 'text-[#FF0000] scale-105' : 'text-muted-foreground'}`}>
              <Footprints className="w-6 h-6" />
            </div>
            <span
              className={`text-5xl font-bold tabular-nums mt-1 transition-all duration-200 ${showPulse ? 'text-[#FF0000]' : 'text-foreground'}`}
              data-testid="text-step-count"
            >
              {stepCount}
            </span>
            <span className="text-sm text-muted-foreground">
              steps
            </span>
          </div>
        </div>

        {/* Stats Row - Minimal Design */}
        <div className="flex items-center justify-center gap-8">
          {sprintEnabled && (
            <div className="flex flex-col items-center">
              <div className="relative w-14 h-14 flex items-center justify-center">
                <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 100 100">
                  <circle cx="50" cy="50" r="40" fill="none" stroke="currentColor" strokeWidth="4" className="text-muted/20" />
                  <circle cx="50" cy="50" r="40" fill="none" stroke="hsl(25, 95%, 53%)" strokeWidth="4" strokeLinecap="round" strokeDasharray={`${Math.min((sprintCount / 100) * 251, 251)} 251`} />
                </svg>
                <Zap className="w-5 h-5 text-orange-500" />
              </div>
              <span className="text-lg font-semibold tabular-nums mt-1" data-testid="text-sprint-count">{sprintCount}</span>
              <span className="text-xs text-muted-foreground">sprints</span>
            </div>
          )}
          <div className="flex flex-col items-center">
            <div className="relative w-14 h-14 flex items-center justify-center">
              <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="40" fill="none" stroke="currentColor" strokeWidth="4" className="text-muted/20" />
                <circle cx="50" cy="50" r="40" fill="none" stroke="hsl(142, 76%, 36%)" strokeWidth="4" strokeLinecap="round" strokeDasharray={`${Math.min((transmittedSteps / stepCount || 0) * 251, 251)} 251`} />
              </svg>
              <Wifi className="w-5 h-5 text-green-500" />
            </div>
            <span className="text-lg font-semibold tabular-nums mt-1" data-testid="text-transmitted-count">{transmittedSteps}</span>
            <span className="text-xs text-muted-foreground">sent to PC</span>
          </div>
          <div className="flex flex-col items-center">
            <div className="relative w-14 h-14 flex items-center justify-center">
              <Footprints className="w-5 h-5 text-muted-foreground" />
            </div>
            <span className="text-sm tabular-nums mt-1" data-testid="text-steps-per-minute">{stepsPerMinute}</span>
            <span className="text-xs text-muted-foreground">steps/min</span>
          </div>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <Zap className="w-4 h-4 text-yellow-500" />
              Walk Mode
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Triple-Tier Hair-Trigger Presets */}
            <div className="grid grid-cols-3 gap-2">
              <Button
                variant={omniMotionMode === 'default' && !ultraSensitiveToggle ? 'default' : 'outline'}
                size="sm"
                onClick={() => { applyOmniMotionPreset('default'); setUltraSensitiveToggle(false); }}
                disabled={isRunning}
                className="flex-col h-auto py-2"
                data-testid="button-mode-default"
              >
                <span className="font-medium">Hard</span>
                <span className="text-xs opacity-70">Level 2.4</span>
              </Button>
              <Button
                variant={omniMotionMode === 'game' && !ultraSensitiveToggle ? 'default' : 'outline'}
                size="sm"
                onClick={() => { applyOmniMotionPreset('game'); setUltraSensitiveToggle(false); }}
                disabled={isRunning}
                className="flex-col h-auto py-2"
                data-testid="button-mode-game"
              >
                <span className="font-medium">Default</span>
                <span className="text-xs opacity-70">Level 2.7</span>
              </Button>
              <Button
                variant={omniMotionMode === 'cruise' || ultraSensitiveToggle ? 'default' : 'outline'}
                size="sm"
                onClick={() => { applyOmniMotionPreset('cruise'); setUltraSensitiveToggle(false); }}
                disabled={isRunning}
                className={`flex-col h-auto py-2 ${(omniMotionMode === 'cruise' || ultraSensitiveToggle) ? 'bg-purple-600 dark:bg-purple-600 text-white hover:bg-purple-700 dark:hover:bg-purple-700' : ''}`}
                data-testid="button-mode-cruise"
              >
                <span className="font-medium">Novice</span>
                <span className="text-xs opacity-70">Level 3.0</span>
              </Button>
            </div>
            
            {/* Ultra-Sensitive Toggle */}
            <div className="flex items-center justify-between p-3 rounded-md bg-muted/50">
              <div className="flex items-center gap-2">
                <Target className={`w-4 h-4 ${ultraSensitiveToggle ? 'text-purple-500' : 'text-muted-foreground'}`} />
                <span className="text-sm font-medium">Ultra-Sensitive</span>
                {ultraSensitiveToggle && <Badge variant="secondary" className="text-xs bg-purple-500/20 text-purple-600">ON</Badge>}
              </div>
              <Switch
                checked={ultraSensitiveToggle}
                onCheckedChange={(checked) => {
                  setUltraSensitiveToggle(checked);
                  if (checked) {
                    applyOmniMotionPreset('cruise');
                  }
                }}
                disabled={isRunning}
                data-testid="switch-ultra-sensitive"
              />
            </div>
            
            {(omniMotionMode === 'cruise' || ultraSensitiveToggle) && (
              <div className="flex items-start gap-2 p-3 rounded-md bg-purple-500/10 border border-purple-500/30">
                <Zap className="w-4 h-4 text-purple-500 mt-0.5 flex-shrink-0" />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-purple-600 dark:text-purple-400">
                    Hair-Trigger Mode (Level 3.0)
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Ultra-Sensitive: Baseline + 0.1 threshold. Almost zero force required for step detection.
                  </p>
                </div>
              </div>
            )}
            
            
            {/* Sliders with Basic Names */}
            <div className="space-y-3 pt-2">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">G Force</span>
                  <span className="text-xs text-muted-foreground tabular-nums">+{triggerForceSlider.toFixed(2)}</span>
                </div>
                <Slider
                  value={[triggerForceSlider]}
                  onValueChange={([v]) => { setTriggerForceSlider(v); }}
                  min={0.01}
                  max={1.0}
                  step={0.01}
                  disabled={isRunning || ultraSensitiveToggle}
                  className="slider-neon-red"
                  data-testid="slider-trigger-force"
                />
                <p className="text-xs text-muted-foreground">Higher=faster response but may trigger accidentally. Lower=smoother but may feel laggy.</p>
              </div>
              
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Hold Window</span>
                  <span className="text-xs text-muted-foreground tabular-nums">{walkingFlowSlider}ms</span>
                </div>
                <Slider
                  value={[walkingFlowSlider]}
                  onValueChange={([v]) => { setWalkingFlowSlider(v); }}
                  min={200}
                  max={2000}
                  step={50}
                  disabled={isRunning}
                  className="slider-neon-red"
                  data-testid="slider-walking-flow"
                />
                <p className="text-xs text-muted-foreground">How long 'W' stays held after each step. If character stutters, increase this value.</p>
              </div>
              
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Response Speed</span>
                  <span className="text-xs text-muted-foreground tabular-nums">{reactionSpeedSlider}ms</span>
                </div>
                <Slider
                  value={[reactionSpeedSlider]}
                  onValueChange={([v]) => { setReactionSpeedSlider(v); }}
                  min={10}
                  max={200}
                  step={5}
                  disabled={isRunning}
                  className="slider-neon-red"
                  data-testid="slider-reaction-speed"
                />
                <p className="text-xs text-muted-foreground">How fast it detects the next shake.</p>
              </div>
            </div>
            
            <Button
              variant="outline"
              size="sm"
              className="w-full gap-2"
              onClick={saveMySetup}
              disabled={isRunning}
              data-testid="button-save-setup"
            >
              {settingsSaved ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
              {settingsSaved ? 'Setup Saved!' : 'Save Setup'}
            </Button>
          </CardContent>
        </Card>

        {/* Sprint Feature Section */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <FastForward className="w-4 h-4 text-orange-500" />
              Sprint Feature
              {sprintEnabled && <Badge variant="secondary" className="text-xs bg-orange-500/20 text-orange-600">ON</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between p-3 rounded-md bg-muted/50">
              <div className="flex items-center gap-2">
                <FastForward className={`w-4 h-4 ${sprintEnabled ? 'text-orange-500' : 'text-muted-foreground'}`} />
                <div>
                  <span className="text-sm font-medium">Sprint</span>
                  <p className="text-xs text-muted-foreground">Intense steps will enable sprinting</p>
                </div>
              </div>
              <Switch
                checked={sprintEnabled}
                onCheckedChange={setSprintEnabled}
                disabled={isRunning}
                data-testid="switch-sprint-enabled"
              />
            </div>
            {sprintEnabled && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Sprint Sensitivity</span>
                  <span className="text-xs text-muted-foreground tabular-nums">{sprintThreshold} m/s²</span>
                </div>
                <Slider
                  value={[sprintThreshold]}
                  onValueChange={([v]) => setSprintThreshold(v)}
                  min={12}
                  max={30}
                  step={1}
                  disabled={isRunning}
                  data-testid="slider-sprint-sensitivity"
                />
                <p className="text-xs text-muted-foreground">
                  Lower = easier to trigger sprint. Higher = requires more intense shaking.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* A/D Keys - Pivot body to turn */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <MoveHorizontal className="w-4 h-4" />
              A/D Keys
              {steeringEnabled && <Badge variant="secondary" className="text-xs bg-blue-500/20 text-blue-600">A/D</Badge>}
              {lateralAxisCalibrated && <Badge variant="secondary" className="text-xs bg-green-500/20 text-green-600">{lateralAxis.toUpperCase()}</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* A/D Keys Toggle */}
            <div className="flex items-center justify-between p-3 rounded-md bg-muted/50">
              <div className="flex items-center gap-2">
                <MoveHorizontal className={`w-4 h-4 ${steeringEnabled ? 'text-blue-500' : 'text-muted-foreground'}`} />
                <div>
                  <span className="text-sm font-medium">A/D Keys</span>
                  <p className="text-xs text-muted-foreground">Pivot body to turn character</p>
                </div>
              </div>
              <Switch
                checked={steeringEnabled}
                onCheckedChange={setSteeringEnabled}
                disabled={isRunning}
                data-testid="switch-steering-enabled"
              />
            </div>
            
            {steeringEnabled && (
              <>
                {/* CALIBRATE SHAKE Button */}
                <Button
                  size="lg"
                  className={`w-full gap-3 h-16 text-lg text-white ${
                    isCalibratingSteering 
                      ? 'bg-orange-600 hover:bg-orange-700 animate-pulse' 
                      : lateralAxisCalibrated 
                        ? 'bg-green-600 hover:bg-green-700'
                        : 'bg-blue-600 hover:bg-blue-700'
                  }`}
                  onClick={startSteeringCalibration}
                  disabled={isRunning || isCalibratingSteering}
                  data-testid="button-calibrate-steering"
                >
                  <Crosshair className="w-6 h-6" />
                  {isCalibratingSteering 
                    ? 'SHAKE LEFT-RIGHT NOW!' 
                    : lateralAxisCalibrated 
                      ? `RECALIBRATE (${lateralAxis.toUpperCase()}-axis)`
                      : 'CALIBRATE STEERING'
                  }
                </Button>
                <p className="text-xs text-muted-foreground text-center">
                  {calibrationPhase === 'shaking' && 'Shake your body left-right for 2 seconds...'}
                  {calibrationPhase === 'done' && 'Calibration complete! Test and swap if A/D are reversed.'}
                  {calibrationPhase === 'idle' && (lateralAxisCalibrated 
                    ? `Using ${lateralAxis.toUpperCase()}-axis for steering. Tap SWAP if A/D are reversed.`
                    : 'Put phone in pocket, then shake left-right to calibrate.'
                  )}
                </p>
                
                {/* SWAP DIRECTION Button - only visible after calibration */}
                {lateralAxisCalibrated && !isCalibratingSteering && (
                  <Button
                    variant="outline"
                    className="w-full gap-2"
                    onClick={swapSteeringDirection}
                    disabled={isRunning}
                    data-testid="button-swap-direction"
                  >
                    <MoveHorizontal className="w-4 h-4" />
                    SWAP A/D DIRECTION
                  </Button>
                )}
                
                {/* SET FORWARD Button - Apex-Pro: Calibrate current orientation as forward */}
                <Button
                  variant={forwardCalibrated ? "secondary" : "default"}
                  className="w-full gap-2"
                  onClick={setForwardCalibration}
                  disabled={isCalibratingSteering}
                  data-testid="button-set-forward"
                >
                  <Target className="w-4 h-4" />
                  {forwardCalibrated ? 'FORWARD SET' : 'SET FORWARD'}
                </Button>
                <p className="text-xs text-muted-foreground text-center">
                  {forwardCalibrated 
                    ? 'Hold phone in walking position, then tap to recalibrate.' 
                    : 'Hold phone in your normal walking position, then tap to set "forward".'
                  }
                </p>
                
                {/* Current Angle Display (Apex-Pro) */}
                <div className="grid grid-cols-2 gap-3 text-center">
                  <div className="p-3 rounded-md bg-muted/50">
                    <p className="text-xs text-muted-foreground">Tilt Angle {orientationMode === 'accel' && '(Accel)'}</p>
                    <p className={`text-lg font-mono tabular-nums ${
                      Math.abs(currentGammaAngle) > (ultraLateralMode ? ULTRA_TURNING_THRESHOLD : turningSensitivity) ? 'text-blue-500 font-bold' : ''
                    }`}>{currentGammaAngle.toFixed(1)}°</p>
                  </div>
                  <div className="p-3 rounded-md bg-muted/50">
                    <p className="text-xs text-muted-foreground">Axis</p>
                    <p className="text-lg font-mono tabular-nums">
                      {lateralAxisCalibrated ? `${lateralAxis.toUpperCase()} (${lateralAxisSign > 0 ? '+' : '-'})` : 'Not Set'}
                    </p>
                  </div>
                </div>
                
                {/* Steering Direction Indicator */}
                {(isRunning || isCalibratingSteering) && (
                  <div className="flex justify-center gap-4 py-2">
                    <div className={`px-6 py-3 rounded-md text-center transition-colors ${
                      steeringDirection === 'left' 
                        ? 'bg-blue-600 text-white' 
                        : 'bg-muted/50 text-muted-foreground'
                    }`}>
                      <span className="text-lg font-bold">A</span>
                      <p className="text-xs">Left</p>
                    </div>
                    <div className={`px-6 py-3 rounded-md text-center transition-colors ${
                      steeringDirection === null 
                        ? 'bg-green-600 text-white' 
                        : 'bg-muted/50 text-muted-foreground'
                    }`}>
                      <span className="text-lg font-bold">W</span>
                      <p className="text-xs">Forward</p>
                    </div>
                    <div className={`px-6 py-3 rounded-md text-center transition-colors ${
                      steeringDirection === 'right' 
                        ? 'bg-blue-600 text-white' 
                        : 'bg-muted/50 text-muted-foreground'
                    }`}>
                      <span className="text-lg font-bold">D</span>
                      <p className="text-xs">Right</p>
                    </div>
                  </div>
                )}
                
                {/* Turning Sensitivity Slider (Apex-Pro: Angle-based) */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Turning Sensitivity</span>
                    <Badge variant="secondary" className="text-xs font-mono">
                      {ultraLateralMode ? ULTRA_TURNING_THRESHOLD : turningSensitivity}°
                    </Badge>
                  </div>
                  <Slider
                    value={[turningSensitivity]}
                    onValueChange={(value) => setTurningSensitivity(value[0])}
                    min={5}
                    max={90}
                    step={5}
                    disabled={isRunning || ultraLateralMode}
                    className={ultraLateralMode ? 'opacity-50' : ''}
                    data-testid="slider-turning-sensitivity"
                  />
                  <p className="text-xs text-muted-foreground">
                    How far to tilt for left/right turns (5°-90°)
                  </p>
                  
                  {/* Ultra-Sensitive Peak Toggle (Apex-Pro) */}
                  <div className="flex items-center justify-between p-3 rounded-lg bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/30">
                    <div className="flex flex-col">
                      <span className="font-semibold text-sm">Ultra-Sensitive Peak</span>
                      <span className="text-xs text-muted-foreground">W: +0.1 offset | A/D: 2° trigger</span>
                    </div>
                    <Switch
                      checked={ultraLateralMode}
                      onCheckedChange={(checked) => {
                        setUltraLateralMode(checked);
                        setUltraSensitiveToggle(checked); // Sync with forward W threshold
                      }}
                      disabled={isRunning}
                      data-testid="switch-ultra-sensitive-peak"
                    />
                  </div>
                  
                  {/* Allow Diagonal Toggle */}
                  <div className="flex items-center justify-between p-3 rounded-lg bg-gradient-to-r from-green-500/10 to-cyan-500/10 border border-green-500/30">
                    <div className="flex flex-col">
                      <span className="font-semibold text-sm">Allow Diagonal</span>
                      <span className="text-xs text-muted-foreground">
                        {allowDiagonal ? 'W+A/W+D together' : 'One key at a time'}
                      </span>
                    </div>
                    <Switch
                      checked={allowDiagonal}
                      onCheckedChange={setAllowDiagonal}
                      disabled={isRunning}
                      data-testid="switch-allow-diagonal"
                    />
                  </div>
                </div>
                
                {/* Apex-Pro Info */}
                <div className="flex items-start gap-2 p-3 rounded-md bg-blue-500/10 border border-blue-500/30">
                  <MoveHorizontal className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-blue-600 dark:text-blue-400">
                      Steering
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Angle-based steering (5°-40°). Ultra-Sensitive: 2° turn trigger + 0.1 W offset. Haptic Compass: 20ms trigger, double-tap [10ms x 2] on release.
                    </p>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="hidden">
          <CardContent className="pt-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Target className={`w-4 h-4 ${level10Mode ? 'text-red-500' : 'text-muted-foreground'}`} />
                <span className="text-sm font-medium">Level 10 Sensitivity</span>
                {level10Mode && <Badge variant="destructive" className="text-xs">MAX</Badge>}
              </div>
              <Switch
                checked={level10Mode}
                onCheckedChange={(checked) => {
                  setLevel10Mode(checked);
                  if (checked) setUltraMode(true);
                }}
                disabled={isRunning}
                data-testid="switch-level10-mode"
              />
            </div>
            
            {level10Mode && (
              <div className="flex items-start gap-2 p-3 rounded-md bg-red-500/10 border border-red-500/30">
                <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0 animate-pulse" />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-red-600 dark:text-red-400">
                    Level 10 MAXIMUM SENSITIVITY
                  </p>
                  <p className="text-xs text-muted-foreground">
                    StepL rapid-fire mode: 0.05 threshold, 10ms debounce (100 signals/sec), haptic feedback on every peak. Any micro-vibration triggers a step!
                  </p>
                </div>
              </div>
            )}
            
            {!level10Mode && (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Zap className={`w-4 h-4 ${ultraMode ? 'text-orange-500' : 'text-muted-foreground'}`} />
                  <span className="text-sm font-medium">Ultra-Sensitivity Mode</span>
                </div>
                <Switch
                  checked={ultraMode}
                  onCheckedChange={setUltraMode}
                  disabled={isRunning}
                  data-testid="switch-ultra-mode"
                />
              </div>
            )}
            
            {ultraMode && !level10Mode && (
              <div className="flex items-start gap-2 p-3 rounded-md bg-orange-500/10 border border-orange-500/30">
                <AlertTriangle className="w-4 h-4 text-orange-500 mt-0.5 flex-shrink-0" />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-orange-600 dark:text-orange-400">
                    Ultra-Mode Active
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Even breathing may trigger steps. Threshold: IdleMax + 0.2 m/s², 50ms debounce, no filters.
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Start/Stop Detection Controls */}
        <Card>
          <CardContent className="pt-6 space-y-4">
            {!isRunning ? (
              <Button
                size="lg"
                className="w-full gap-2"
                onClick={handleStart}
                data-testid="button-start-detection"
              >
                <Play className="w-5 h-5" />
                Start Detection
              </Button>
            ) : isCalibrating ? (
              <div className="space-y-3">
                <Button
                  size="lg"
                  variant="secondary"
                  className="w-full gap-2"
                  disabled
                  data-testid="button-calibrating"
                >
                  <div className="w-5 h-5 border-2 border-t-transparent border-foreground rounded-full animate-spin" />
                  Calibrating... {calibrationProgress}%
                </Button>
                <div className="w-full bg-muted rounded-full h-2">
                  <div 
                    className="bg-primary h-2 rounded-full transition-all duration-200"
                    style={{ width: `${calibrationProgress}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground text-center">
                  Hold your phone still for 3 seconds...
                </p>
              </div>
            ) : (
              <Button
                size="lg"
                variant="destructive"
                className="w-full gap-2"
                onClick={handleStop}
                data-testid="button-stop-detection"
              >
                <Square className="w-5 h-5" />
                Stop
              </Button>
            )}
            {permissionError && (
              <p className="mt-2 text-sm text-destructive text-center" data-testid="text-permission-error">
                {permissionError}
              </p>
            )}
            {isRunning && !isCalibrating && (
              <p className="mt-2 text-sm text-muted-foreground text-center">
                Hold phone upright. Walk in place for step detection.
              </p>
            )}
          </CardContent>
        </Card>

        {isRunning && !isCalibrating && (
          <Button
            size="lg"
            variant={pocketLocked ? "default" : "outline"}
            className="h-16 gap-3"
            onClick={togglePocketLock}
            data-testid="button-pocket-lock"
          >
            {pocketLocked ? <Lock className="w-6 h-6" /> : <Unlock className="w-6 h-6" />}
            <span>{pocketLocked ? 'Pocket Lock Active' : 'Enable Pocket Lock'}</span>
          </Button>
        )}

        {/* Detection Threshold Slider - Always visible at bottom */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Target className="w-4 h-4 text-blue-500" />
                Detection Threshold
              </div>
              <Badge variant="secondary" className="font-mono text-blue-600" data-testid="badge-detection-threshold">
                {detectionThreshold.toFixed(1)} m/s²
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              <Slider
                value={[detectionThreshold]}
                onValueChange={(value) => setDetectionThreshold(value[0])}
                min={5.0}
                max={25.0}
                step={0.5}
                className="w-full"
                disabled={isRunning}
                data-testid="slider-detection-threshold"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Sensitive (5)</span>
                <span>Default (12)</span>
                <span>Firm (25)</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Low = sensitive (good for slow walking). High = firm (good for running or loose pocket).
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Hidden: P2P Mode - Advanced feature, not needed for most users */}
        
        {/* Detection Threshold Card - Hidden, using walk mode presets instead */}
        <Card className="hidden">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Target className="w-4 h-4 text-blue-500" />
                Detection Threshold
              </div>
              <div className="flex items-center gap-2">
                {stepBufferStatus.active ? (
                  <Badge variant="outline" className="text-xs bg-yellow-500/10 text-yellow-600 border-yellow-500/30" data-testid="badge-step-buffer">
                    Validating: {stepBufferStatus.count}/{VALIDATION_STEPS_REQUIRED}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-xs bg-green-500/10 text-green-600 border-green-500/30" data-testid="badge-step-validated">
                    Validated
                  </Badge>
                )}
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="p-3 bg-muted rounded-md space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span>Current Accel (XYZ)</span>
                <Badge variant="secondary" className="font-mono" data-testid="badge-current-accel">
                  {dynamicThreshold.toFixed(1)} m/s²
                </Badge>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span>Detection Threshold</span>
                <Badge variant="secondary" className="font-mono text-blue-600" data-testid="badge-detection-threshold">
                  {detectionThreshold.toFixed(1)} m/s²
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                Uses Euclidean Norm: √(x² + y² + z²). Step detected when magnitude exceeds threshold.
              </p>
            </div>
            
            <div className="space-y-3 pt-2 border-t">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Detection Threshold</span>
                <Badge variant="secondary" className="font-mono" data-testid="badge-threshold-value">
                  {detectionThreshold.toFixed(1)} m/s²
                </Badge>
              </div>
              <Slider
                value={[detectionThreshold]}
                onValueChange={(value) => setDetectionThreshold(value[0])}
                min={5.0}
                max={25.0}
                step={0.5}
                className="w-full"
                data-testid="slider-detection-threshold"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Sensitive (5)</span>
                <span>Default (12)</span>
                <span>Firm (25)</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Low = sensitive (good for slow walking). High = firm (good for running or loose pocket).
              </p>
            </div>
            
            {isMoving && (
              <Badge className="bg-green-500 animate-pulse">MOVING</Badge>
            )}
          </CardContent>
        </Card>
      </main>

      <footer className="border-t bg-card/50 backdrop-blur-sm">
        <div className="max-w-md mx-auto px-4 py-3">
          <p className="text-xs text-muted-foreground text-center">
            Hold phone upright. Walk in place to move forward in your game.
          </p>
        </div>
      </footer>
    </div>
  );
}
