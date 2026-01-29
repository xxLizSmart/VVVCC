import type { Express } from "express";
import { type Server } from "http";
import { Server as SocketIOServer, Socket } from "socket.io";
import { Bonjour } from "bonjour-service";
import { log } from "./index";
import { updateUserStats, getUserProfile, updateUserProfile, getAllUsers, deleteUser, createAdminUser, createUser } from "./supabase";
import { supabaseAdmin } from "./supabase";

let stepCount = 0;
let directionCounts = {
  forward: 0,
};

let bonjourInstance: Bonjour | null = null;

// Online presence tracking: Map<userId, { socketId, username, lastSeen }>
const onlineUsers = new Map<string, { socketId: string; username: string; lastSeen: number }>();

// VSteps Session Pairing: Map<sessionId, { desktopSocketId, phoneSocketId, createdAt }>
interface VStepsSession {
  sessionId: string;
  desktopSocketId: string;
  phoneSocketId: string | null;
  createdAt: number;
}
const vstepsSessions = new Map<string, VStepsSession>();

// Generate a short, unique session ID (6 characters)
function generateSessionId(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Removed confusing chars like 0/O, 1/I
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Clean up old sessions (older than 24 hours)
function cleanupOldSessions() {
  const now = Date.now();
  const maxAge = 24 * 60 * 60 * 1000; // 24 hours
  Array.from(vstepsSessions.entries()).forEach(([sessionId, session]) => {
    if (now - session.createdAt > maxAge) {
      vstepsSessions.delete(sessionId);
    }
  });
}

// Run cleanup every hour
setInterval(cleanupOldSessions, 60 * 60 * 1000);

// PVP Room state: Map<roomId, { player1, player2, steps, startTime }>
interface PVPRoom {
  id: string;
  player1: { oderId: string; username: string; steps: number };
  player2: { oderId: string; username: string; steps: number };
  startTime: number;
  durationMinutes: number;
  active: boolean;
  gameMode: string;
  setupPhase: boolean;
  setupEndTime: number;
  spectators: { oderId: string; username: string }[];
}
const pvpRooms = new Map<string, PVPRoom>();

// Active battles index for spectator discovery: Map<oderId, roomId>
const playerToRoom = new Map<string, string>();

// Daily step counts for leaderboard: Map<oderId, { username, steps, date }>
const dailySteps = new Map<string, { username: string; steps: number; date: string }>();

// Pending PVP invites: key = inviteId (fromId-toId), value = { fromId, toId, fromUsername, durationMinutes, gameMode }
const pendingInvites = new Map<string, { inviteId: string; fromId: string; toId: string; fromUsername: string; durationMinutes: number; gameMode: string }>();

function generateInviteId(fromId: string, toId: string): string {
  return `invite-${fromId}-${toId}`;
}

function getTodayDateString(): string {
  return new Date().toISOString().split('T')[0];
}

function getSocketByUserId(io: SocketIOServer, oderId: string): Socket | null {
  const userInfo = onlineUsers.get(oderId);
  if (!userInfo) return null;
  const socket = io.sockets.sockets.get(userInfo.socketId);
  return socket || null;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
    transports: ["websocket", "polling"],
  });

  io.on("connection", (socket) => {
    log(`Client connected: ${socket.id}`, "socket.io");

    socket.emit("step-count-update", { count: stepCount });
    socket.emit("direction-counts-update", directionCounts);

    // Legacy step-detected handler - only for backward compatibility with old clients
    // Note: Modern clients should use movement-detected instead
    socket.on("step-detected", () => {
      // Don't increment stepCount here - let movement-detected handle it
      // Just log for debugging
      log(`Legacy step-detected received (forwarding as movement)`, "socket.io");
      // Forward to movement-detected handler logic
      socket.emit("movement-detected", { direction: "forward" });
    });

    socket.on("movement-detected", (data: { 
      direction: "forward"; 
      isSprint?: boolean; 
      holdDuration?: number;
      cameraControl?: boolean;
      mouseSensitivity?: number;
    }) => {
      const direction = data.direction || "forward";
      const isSprint = data.isSprint || false;
      const holdDuration = data.holdDuration || 2000;
      const cameraControl = data.cameraControl || false;
      const mouseSensitivity = data.mouseSensitivity || 50;
      stepCount++;
      directionCounts[direction]++;
      
      const sprintLabel = isSprint ? " (SPRINT)" : "";
      const cameraLabel = cameraControl ? " +CAMERA" : "";
      const sessionId = socket.data.sessionId;
      
      log(`>>> MOVEMENT: ${direction.toUpperCase()}${sprintLabel}${cameraLabel} | Steps: ${stepCount} | Session: ${sessionId || 'global'} | From: ${socket.id.slice(0,8)}`, "socket.io");
      
      const eventData = { 
        direction, 
        isSprint,
        holdDuration,
        cameraControl,
        mouseSensitivity,
        count: stepCount,
        directionCounts 
      };
      
      // Route to session if available, otherwise broadcast globally
      if (sessionId) {
        io.to(`session-${sessionId}`).emit("movement-detected", eventData);
        io.to(`session-${sessionId}`).emit("step-detected", { count: stepCount, direction });
        io.to(`session-${sessionId}`).emit("step-count-update", { count: stepCount });
        io.to(`session-${sessionId}`).emit("direction-counts-update", directionCounts);
      } else {
        // Fallback to global broadcast for backward compatibility
        io.emit("movement-detected", eventData);
        io.emit("step-detected", { count: stepCount, direction });
        io.emit("step-count-update", { count: stepCount });
        io.emit("direction-counts-update", directionCounts);
      }
    });

    socket.on("jump-detected", () => {
      const sessionId = socket.data.sessionId;
      log(`Jump detected! | Session: ${sessionId || 'global'}`, "socket.io");
      if (sessionId) {
        io.to(`session-${sessionId}`).emit("jump-detected");
      } else {
        io.emit("jump-detected");
      }
    });

    // Apex-Gate: Press/Release protocol for strict mutual exclusion
    socket.on("input", (data: { press?: string[]; release?: string[] }) => {
      const press = data.press || [];
      const release = data.release || [];
      const sessionId = socket.data.sessionId;
      log(`>>> INPUT: press=[${press.join(',')}] release=[${release.join(',')}] | Session: ${sessionId || 'global'} | From: ${socket.id.slice(0,8)}`, "socket.io");
      
      if (sessionId) {
        io.to(`session-${sessionId}`).emit("input", { press, release });
      } else {
        io.emit("input", { press, release });
      }
    });

    // Pocket-Pro: Lateral movement (A/D keys)
    socket.on("lateral-movement", (data: { 
      direction: 'left' | 'right' | null;
      angleDiff?: string;
    }) => {
      const direction = data.direction;
      const angleDiff = data.angleDiff || '0';
      const key = direction === 'left' ? 'A' : direction === 'right' ? 'D' : 'RELEASE';
      const sessionId = socket.data.sessionId;
      log(`>>> LATERAL: ${key} (${angleDiff}°) | Session: ${sessionId || 'global'} | From: ${socket.id.slice(0,8)}`, "socket.io");
      
      const eventData = { direction, angleDiff };
      if (sessionId) {
        io.to(`session-${sessionId}`).emit("lateral-movement", eventData);
      } else {
        io.emit("lateral-movement", eventData);
      }
    });

    socket.on("sensor-data", (data) => {
      const sessionId = socket.data.sessionId;
      if (sessionId) {
        io.to(`session-${sessionId}`).emit("sensor-data", data);
      } else {
        io.emit("sensor-data", data);
      }
    });

    socket.on("tilt-detected", (data: { 
      tilt: number; 
      rawGamma: number; 
      adjustedTilt: number;
      sensitivity: number;
      deadzone: number;
    }) => {
      const sessionId = socket.data.sessionId;
      if (sessionId) {
        io.to(`session-${sessionId}`).emit("tilt-detected", data);
      } else {
        io.emit("tilt-detected", data);
      }
    });

    socket.on("phone-settings", (data) => {
      const sessionId = socket.data.sessionId;
      if (sessionId) {
        io.to(`session-${sessionId}`).emit("phone-settings", data);
      } else {
        io.emit("phone-settings", data);
      }
    });

    socket.on("desktop-settings", (data) => {
      const sessionId = socket.data.sessionId;
      if (sessionId) {
        io.to(`session-${sessionId}`).emit("desktop-settings", data);
      } else {
        io.emit("desktop-settings", data);
      }
    });

    // Relay VSteps config updates from mobile to PC
    socket.on("vsteps-config-update", (data) => {
      const sessionId = socket.data.sessionId;
      log(`VSteps config update from ${socket.id} | Session: ${sessionId || 'global'}`, "socket");
      if (sessionId) {
        io.to(`session-${sessionId}`).emit("vsteps-config-update", data);
      } else {
        io.emit("vsteps-config-update", data);
      }
    });

    socket.on("webrtc-offer", (data: { targetId: string; offer: RTCSessionDescriptionInit }) => {
      log(`WebRTC offer from ${socket.id} to ${data.targetId}`, "webrtc");
      io.to(data.targetId).emit("webrtc-offer", { 
        fromId: socket.id, 
        offer: data.offer 
      });
    });

    socket.on("webrtc-answer", (data: { targetId: string; answer: RTCSessionDescriptionInit }) => {
      log(`WebRTC answer from ${socket.id} to ${data.targetId}`, "webrtc");
      io.to(data.targetId).emit("webrtc-answer", { 
        fromId: socket.id, 
        answer: data.answer 
      });
    });

    socket.on("webrtc-ice-candidate", (data: { targetId: string; candidate: RTCIceCandidateInit }) => {
      io.to(data.targetId).emit("webrtc-ice-candidate", { 
        fromId: socket.id, 
        candidate: data.candidate 
      });
    });

    socket.on("webrtc-register-pc", () => {
      socket.join("pc-receivers");
      log(`PC receiver registered: ${socket.id}`, "webrtc");
      io.emit("pc-receiver-available", { id: socket.id });
    });

    socket.on("webrtc-request-pc-list", () => {
      const pcRoom = io.sockets.adapter.rooms.get("pc-receivers");
      const pcList = pcRoom ? Array.from(pcRoom) : [];
      socket.emit("webrtc-pc-list", { pcs: pcList });
    });

    // === VSTEPS SESSION PAIRING ===
    
    // Desktop creates a new session
    socket.on("create-session", () => {
      // Check if this socket already has a session
      const existingSession = Array.from(vstepsSessions.entries()).find(
        ([_, session]) => session.desktopSocketId === socket.id
      );
      
      if (existingSession) {
        const [sessionId] = existingSession;
        socket.emit("session-created", { sessionId, existing: true });
        log(`Returning existing session ${sessionId} for desktop ${socket.id}`, "session");
        return;
      }
      
      // Create new session
      let sessionId = generateSessionId();
      while (vstepsSessions.has(sessionId)) {
        sessionId = generateSessionId();
      }
      
      const session: VStepsSession = {
        sessionId,
        desktopSocketId: socket.id,
        phoneSocketId: null,
        createdAt: Date.now()
      };
      
      vstepsSessions.set(sessionId, session);
      socket.join(`session-${sessionId}`);
      socket.data.sessionId = sessionId;
      
      socket.emit("session-created", { sessionId, existing: false });
      log(`Session ${sessionId} created by desktop ${socket.id}`, "session");
    });
    
    // Phone joins an existing session
    socket.on("join-session", (data: { sessionId: string }) => {
      const sessionId = data.sessionId?.toUpperCase();
      
      if (!sessionId) {
        socket.emit("session-error", { message: "Session ID required" });
        return;
      }
      
      const session = vstepsSessions.get(sessionId);
      
      if (!session) {
        socket.emit("session-error", { message: "Session not found. Check the code and try again." });
        log(`Phone ${socket.id} tried to join invalid session ${sessionId}`, "session");
        return;
      }
      
      // Update session with phone
      session.phoneSocketId = socket.id;
      vstepsSessions.set(sessionId, session);
      
      socket.join(`session-${sessionId}`);
      socket.data.sessionId = sessionId;
      
      socket.emit("session-joined", { sessionId });
      
      // Notify desktop that phone connected
      io.to(session.desktopSocketId).emit("phone-connected", { sessionId });
      
      log(`Phone ${socket.id} joined session ${sessionId}`, "session");
    });
    
    // Get session info
    socket.on("get-session-info", () => {
      const sessionId = socket.data.sessionId;
      if (sessionId && vstepsSessions.has(sessionId)) {
        const session = vstepsSessions.get(sessionId)!;
        socket.emit("session-info", {
          sessionId,
          hasPhone: !!session.phoneSocketId,
          hasDesktop: !!session.desktopSocketId
        });
      } else {
        socket.emit("session-info", { sessionId: null });
      }
    });

    // === PVP SYSTEM ===
    
    // User goes online (authenticate with userId and username)
    socket.on("user-online", (data: { userId: string; username: string }) => {
      const { userId, username } = data;
      if (!userId || !username) return;
      
      onlineUsers.set(userId, { socketId: socket.id, username, lastSeen: Date.now() });
      socket.data.oderId = userId;
      socket.data.username = username;
      
      log(`User online: ${username} (${userId})`, "pvp");
      
      // Broadcast to all connected clients that this user is online
      io.emit("user-status-changed", { oderId: userId, username, online: true });
    });
    
    // Get list of online friends
    socket.on("get-online-friends", async (data: { userId: string; friendIds: string[] }) => {
      const { friendIds } = data;
      const onlineFriends = friendIds
        .filter(id => onlineUsers.has(id))
        .map(id => ({
          oderId: id,
          username: onlineUsers.get(id)?.username || 'Unknown',
          online: true
        }));
      
      socket.emit("online-friends-list", { friends: onlineFriends });
    });
    
    // Send PVP invite to a friend
    socket.on("invite-to-pvp", async (data: { oderId: string; friendId: string; durationMinutes?: number; gameMode?: string }) => {
      const { oderId, friendId, durationMinutes = 3, gameMode = "1v1" } = data;
      const user = onlineUsers.get(oderId);
      
      if (!user) {
        socket.emit("pvp-error", { message: "You must be online to invite" });
        return;
      }
      
      // Check if friend is online
      const friendInfo = onlineUsers.get(friendId);
      if (!friendInfo) {
        socket.emit("pvp-error", { message: "Friend is not online" });
        return;
      }
      
      // Verify friendship in Supabase
      const { data: friendship, error } = await supabaseAdmin
        .from("friendships")
        .select("*")
        .or(`and(user_id.eq.${oderId},friend_id.eq.${friendId}),and(user_id.eq.${friendId},friend_id.eq.${oderId})`)
        .eq("status", "accepted")
        .single();
      
      if (error || !friendship) {
        socket.emit("pvp-error", { message: "You must be friends to play PVP!" });
        return;
      }
      
      // Store pending invite with unique ID
      const inviteId = generateInviteId(oderId, friendId);
      pendingInvites.set(inviteId, { 
        inviteId,
        fromId: oderId, 
        toId: friendId,
        fromUsername: user.username, 
        durationMinutes,
        gameMode
      });
      
      // Send invite to friend
      const friendSocket = getSocketByUserId(io, friendId);
      if (friendSocket) {
        friendSocket.emit("pvp-request", { 
          inviteId,
          from: user.username, 
          fromId: oderId,
          durationMinutes,
          gameMode
        });
        log(`PVP invite: ${user.username} -> ${friendInfo.username} (${gameMode})`, "pvp");
      }
    });
    
    // Decline PVP invite
    socket.on("pvp-decline", (data: { inviteId: string; fromId: string }) => {
      const { inviteId, fromId } = data;
      const oderId = socket.data.oderId;
      
      if (!oderId) {
        socket.emit("pvp-error", { message: "You must be online to decline" });
        return;
      }
      
      // Validate invite exists
      const invite = pendingInvites.get(inviteId);
      if (!invite || invite.toId !== oderId) {
        socket.emit("pvp-error", { message: "Invalid or expired invite" });
        return;
      }
      
      // Remove pending invite
      pendingInvites.delete(inviteId);
      
      // Notify inviter
      const inviterSocket = getSocketByUserId(io, fromId);
      if (inviterSocket) {
        inviterSocket.emit("pvp-declined", { byUsername: socket.data.username || 'Someone' });
      }
      
      log(`PVP invite declined: ${socket.data.username} declined ${fromId}`, "pvp");
    });
    
    // Accept PVP invite
    socket.on("accept-pvp", (data: { inviteId: string; oderId: string; opponentId: string }) => {
      const { inviteId, oderId, opponentId } = data;
      const user = onlineUsers.get(oderId);
      const opponent = onlineUsers.get(opponentId);
      
      if (!user || !opponent) {
        socket.emit("pvp-error", { message: "User or opponent not found" });
        return;
      }
      
      // Validate invite exists and matches
      const invite = pendingInvites.get(inviteId);
      if (!invite || invite.toId !== oderId || invite.fromId !== opponentId) {
        socket.emit("pvp-error", { message: "Invalid or expired invite" });
        return;
      }
      
      const durationMinutes = invite.durationMinutes || 3;
      const gameMode = invite.gameMode || "1v1";
      pendingInvites.delete(inviteId);
      
      // Create a new PVP room with setup phase
      const roomId = `pvp-${oderId}-${opponentId}-${Date.now()}`;
      const room: PVPRoom = {
        id: roomId,
        player1: { oderId, username: user.username, steps: 0 },
        player2: { oderId: opponentId, username: opponent.username, steps: 0 },
        startTime: Date.now(),
        durationMinutes,
        active: true,
        gameMode,
        setupPhase: true,
        setupEndTime: Date.now() + 120000, // 2 minutes setup
        spectators: []
      };
      
      pvpRooms.set(roomId, room);
      playerToRoom.set(oderId, roomId);
      playerToRoom.set(opponentId, roomId);
      
      // Join both players to the Socket.io room
      socket.join(roomId);
      const opponentSocket = getSocketByUserId(io, opponentId);
      if (opponentSocket) {
        opponentSocket.join(roomId);
      }
      
      // Store room in socket data
      socket.data.pvpRoom = roomId;
      if (opponentSocket) opponentSocket.data.pvpRoom = roomId;
      
      // Notify both players
      io.to(roomId).emit("pvp-started", {
        roomId,
        durationMinutes,
        gameMode,
        setupPhase: true,
        player1: { oderId, username: user.username },
        player2: { oderId: opponentId, username: opponent.username }
      });
      
      log(`PVP room created: ${roomId} (${user.username} vs ${opponent.username}) - ${gameMode}`, "pvp");
    });
    
    // Player ready toggle in lobby
    socket.on("pvp-ready", (data: { roomId: string; oderId: string; isReady: boolean }) => {
      const { roomId, oderId, isReady } = data;
      const room = pvpRooms.get(roomId);
      
      if (!room) return;
      
      // Broadcast ready status to all in room (including spectators)
      io.to(roomId).emit("pvp-ready-update", { oderId, isReady });
      log(`PVP ready: ${oderId} = ${isReady}`, "pvp");
    });
    
    // Start battle (host only, after both ready)
    socket.on("pvp-start-battle", (data: { roomId: string }) => {
      const { roomId } = data;
      const room = pvpRooms.get(roomId);
      
      if (!room || !room.setupPhase) return;
      
      room.setupPhase = false;
      room.startTime = Date.now();
      
      io.to(roomId).emit("pvp-setup-complete", { 
        roomId,
        startTime: room.startTime
      });
      
      log(`PVP battle started: ${roomId}`, "pvp");
    });
    
    // Spectator joins a battle
    socket.on("pvp-spectate", (data: { oderId: string; roomId: string }) => {
      const { oderId, roomId } = data;
      const room = pvpRooms.get(roomId);
      const user = onlineUsers.get(oderId);
      
      if (!room || !room.active) {
        socket.emit("pvp-error", { message: "Battle not found or ended" });
        return;
      }
      
      if (!user) {
        socket.emit("pvp-error", { message: "You must be online to spectate" });
        return;
      }
      
      // Add spectator to room
      room.spectators.push({ oderId, username: user.username });
      socket.join(roomId);
      socket.data.spectatingRoom = roomId;
      
      // Send current battle state to spectator
      socket.emit("pvp-spectate-joined", {
        roomId,
        gameMode: room.gameMode,
        durationMinutes: room.durationMinutes,
        setupPhase: room.setupPhase,
        player1: room.player1,
        player2: room.player2,
        spectatorCount: room.spectators.length
      });
      
      // Notify room of new spectator
      io.to(roomId).emit("pvp-spectator-joined", { 
        username: user.username,
        spectatorCount: room.spectators.length 
      });
      
      log(`Spectator ${user.username} joined ${roomId}`, "pvp");
    });
    
    // Leave spectating
    socket.on("pvp-stop-spectate", (data: { oderId: string; roomId: string }) => {
      const { oderId, roomId } = data;
      const room = pvpRooms.get(roomId);
      
      if (room) {
        room.spectators = room.spectators.filter(s => s.oderId !== oderId);
        io.to(roomId).emit("pvp-spectator-left", { spectatorCount: room.spectators.length });
      }
      
      socket.leave(roomId);
      socket.data.spectatingRoom = null;
    });
    
    // Get active battles (for spectator discovery)
    socket.on("get-active-battles", () => {
      const activeBattles = Array.from(pvpRooms.entries())
        .filter(([_, room]) => room.active && !room.setupPhase)
        .map(([roomId, room]) => ({
          roomId,
          gameMode: room.gameMode,
          player1: { username: room.player1.username, steps: room.player1.steps },
          player2: { username: room.player2.username, steps: room.player2.steps },
          spectatorCount: room.spectators.length,
          startTime: room.startTime,
          durationMinutes: room.durationMinutes
        }));
      
      socket.emit("active-battles-list", { battles: activeBattles });
    });
    
    // Get friend's active battle (to watch)
    socket.on("get-friend-battle", (data: { friendId: string }) => {
      const { friendId } = data;
      const roomId = playerToRoom.get(friendId);
      
      if (roomId) {
        const room = pvpRooms.get(roomId);
        if (room && room.active) {
          socket.emit("friend-battle-found", {
            roomId,
            gameMode: room.gameMode,
            player1: room.player1,
            player2: room.player2
          });
          return;
        }
      }
      
      socket.emit("friend-battle-found", { roomId: null });
    });
    
    // PVP step detected (only counts in PVP room, doesn't trigger W key)
    socket.on("pvp-step", (data: { roomId: string; oderId: string }) => {
      const { roomId, oderId } = data;
      const room = pvpRooms.get(roomId);
      
      if (!room || !room.active) return;
      
      // Increment step count for the player
      if (room.player1.oderId === oderId) {
        room.player1.steps++;
      } else if (room.player2.oderId === oderId) {
        room.player2.steps++;
      }
      
      // Update daily leaderboard
      const today = getTodayDateString();
      const current = dailySteps.get(oderId);
      if (!current || current.date !== today) {
        dailySteps.set(oderId, { 
          username: socket.data.username || 'Unknown', 
          steps: 1, 
          date: today 
        });
      } else {
        current.steps++;
      }
      
      // Broadcast updated scores to the room only
      io.to(roomId).emit("pvp-update", {
        roomId,
        player1: { oderId: room.player1.oderId, username: room.player1.username, steps: room.player1.steps },
        player2: { oderId: room.player2.oderId, username: room.player2.username, steps: room.player2.steps }
      });
    });
    
    // Leave PVP room
    socket.on("leave-pvp", (data: { roomId: string }) => {
      const { roomId } = data;
      const room = pvpRooms.get(roomId);
      
      if (room) {
        // Clean up playerToRoom mappings
        playerToRoom.delete(room.player1.oderId);
        playerToRoom.delete(room.player2.oderId);
        
        room.active = false;
        io.to(roomId).emit("pvp-ended", { roomId, reason: "Player left" });
        pvpRooms.delete(roomId);
        log(`PVP room ended: ${roomId}`, "pvp");
      }
      
      socket.leave(roomId);
      socket.data.pvpRoom = null;
    });

    socket.on("disconnect", () => {
      // Remove from online users
      const oderId = socket.data.oderId;
      if (oderId) {
        onlineUsers.delete(oderId);
        playerToRoom.delete(oderId);
        io.emit("user-status-changed", { oderId, online: false });
        
        // End any active PVP rooms
        const roomId = socket.data.pvpRoom;
        if (roomId) {
          const room = pvpRooms.get(roomId);
          if (room) {
            playerToRoom.delete(room.player1.oderId);
            playerToRoom.delete(room.player2.oderId);
            room.active = false;
            io.to(roomId).emit("pvp-ended", { roomId, reason: "Player disconnected" });
            pvpRooms.delete(roomId);
          }
        }
        
        // Leave spectating room
        const spectatingRoom = socket.data.spectatingRoom;
        if (spectatingRoom) {
          const room = pvpRooms.get(spectatingRoom);
          if (room) {
            room.spectators = room.spectators.filter(s => s.oderId !== oderId);
          }
        }
      }
      
      log(`Client disconnected: ${socket.id}`, "socket.io");
    });
  });

  app.get("/api/stats", (_req, res) => {
    res.json({ stepCount, directionCounts });
  });

  app.post("/api/reset", (_req, res) => {
    stepCount = 0;
    directionCounts = { forward: 0 };
    io.emit("step-count-update", { count: stepCount });
    io.emit("direction-counts-update", directionCounts);
    res.json({ success: true, stepCount, directionCounts });
  });

  app.post("/api/sync-stats", async (req, res) => {
    const { userId, steps, sprints, jumps, playTimeMinutes } = req.body;
    
    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }

    const updatedStats = await updateUserStats(userId, {
      steps: steps || 0,
      sprints: sprints || 0,
      jumps: jumps || 0,
      playTimeMinutes: playTimeMinutes || 0,
    });

    if (!updatedStats) {
      return res.status(500).json({ error: "Failed to sync stats" });
    }

    res.json({ success: true, stats: updatedStats });
  });

  app.get("/api/user/:userId/profile", async (req, res) => {
    const { userId } = req.params;
    const profile = await getUserProfile(userId);
    
    if (!profile) {
      return res.status(404).json({ error: "Profile not found" });
    }

    res.json(profile);
  });

  app.patch("/api/user/:userId/profile", async (req, res) => {
    const { userId } = req.params;
    const updates = req.body;
    
    const profile = await updateUserProfile(userId, updates);
    
    if (!profile) {
      return res.status(500).json({ error: "Failed to update profile" });
    }

    res.json(profile);
  });

  app.get("/api/admin/users", async (_req, res) => {
    const users = await getAllUsers();
    res.json(users);
  });

  app.patch("/api/admin/user/:userId/type", async (req, res) => {
    const { userId } = req.params;
    const updates = req.body;
    
    const profile = await updateUserProfile(userId, updates);
    
    if (!profile) {
      return res.status(500).json({ error: "Failed to update user type" });
    }

    res.json(profile);
  });

  app.delete("/api/admin/user/:userId", async (req, res) => {
    const { userId } = req.params;
    const success = await deleteUser(userId);
    
    if (!success) {
      return res.status(500).json({ error: "Failed to delete user" });
    }

    res.json({ success: true });
  });

  // Get user's friends list (both directions)
  app.get("/api/user/:userId/friends", async (req, res) => {
    const { userId } = req.params;
    
    // Get friendships where user is either user_id or friend_id
    const { data: outgoing, error: outError } = await supabaseAdmin
      .from("friendships")
      .select(`
        id,
        friend_id,
        status,
        created_at,
        profiles:friend_id(username)
      `)
      .eq("user_id", userId)
      .eq("status", "accepted");
    
    const { data: incoming, error: inError } = await supabaseAdmin
      .from("friendships")
      .select(`
        id,
        user_id,
        status,
        created_at,
        profiles:user_id(username)
      `)
      .eq("friend_id", userId)
      .eq("status", "accepted");
    
    if (outError || inError) {
      return res.status(500).json({ error: "Failed to fetch friends" });
    }
    
    // Normalize to friend_id for consistency
    const friends = [
      ...(outgoing || []).map(f => ({ ...f, friend_id: f.friend_id })),
      ...(incoming || []).map(f => ({ ...f, friend_id: f.user_id, profiles: f.profiles }))
    ];
    
    res.json({ friends });
  });

  app.post("/api/auth/signup", async (req, res) => {
    const { email, password, username } = req.body;
    
    if (!email || !password || !username) {
      return res.status(400).json({ error: "Email, password, and username are required" });
    }

    if (username.length < 3) {
      return res.status(400).json({ error: "Username must be at least 3 characters" });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    const result = await createUser(email, password, username);
    
    if (result.error) {
      return res.status(500).json({ error: result.error });
    }

    res.json({ success: true, userId: result.userId });
  });

  app.post("/api/setup/create-admin", async (req, res) => {
    const { email, password, username, setupKey } = req.body;
    
    const adminSetupKey = process.env.ADMIN_SETUP_KEY;
    if (!adminSetupKey || setupKey !== adminSetupKey) {
      return res.status(403).json({ error: "Invalid setup key" });
    }

    const result = await createAdminUser(email, password, username);
    
    if (result.error) {
      return res.status(500).json({ error: result.error });
    }

    res.json({ success: true, userId: result.userId });
  });

  // === LEADERBOARD ENDPOINTS ===
  
  // Get today's leaderboard (top step counts for today)
  app.get("/api/leaderboard/today", async (_req, res) => {
    const today = getTodayDateString();
    
    // Get daily steps from in-memory cache
    const todaySteps = Array.from(dailySteps.entries())
      .filter(([, data]) => data.date === today)
      .map(([oderId, data]) => ({
        oderId,
        username: data.username,
        steps: data.steps
      }))
      .sort((a, b) => b.steps - a.steps)
      .slice(0, 50);
    
    res.json({ leaderboard: todaySteps, date: today });
  });
  
  // Get all-time leaderboard from Supabase
  app.get("/api/leaderboard/all-time", async (_req, res) => {
    const { data, error } = await supabaseAdmin
      .from("user_stats")
      .select(`
        user_id,
        total_steps,
        level,
        profiles!inner(username)
      `)
      .order("total_steps", { ascending: false })
      .limit(50);
    
    if (error) {
      return res.status(500).json({ error: "Failed to fetch leaderboard" });
    }
    
    const leaderboard = (data || []).map((entry: any) => ({
      oderId: entry.user_id,
      username: entry.profiles?.username || "Unknown",
      steps: entry.total_steps,
      level: entry.level
    }));
    
    res.json({ leaderboard });
  });
  
  // Get online users count
  app.get("/api/online-users", (_req, res) => {
    res.json({ count: onlineUsers.size });
  });

  // === AVATAR UPLOAD ===
  app.post("/api/avatar/upload", async (req, res) => {
    const { userId, avatarData, authToken } = req.body;
    
    if (!userId || !avatarData) {
      return res.status(400).json({ error: "Missing userId or avatarData" });
    }

    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(authToken);
    if (authError || !user || user.id !== userId) {
      return res.status(403).json({ error: "Unauthorized: You can only update your own avatar" });
    }

    const validMimes = ['data:image/jpeg', 'data:image/png', 'data:image/webp', 'data:image/gif'];
    const hasValidMime = validMimes.some(mime => avatarData.startsWith(mime));
    if (!hasValidMime) {
      return res.status(400).json({ error: "Invalid image format. Allowed: JPEG, PNG, WebP, GIF" });
    }

    try {
      const base64Data = avatarData.split(',')[1];
      if (!base64Data) {
        return res.status(400).json({ error: "Invalid base64 data" });
      }
      const decoded = Buffer.from(base64Data, 'base64');
      if (decoded.length > 500 * 1024) {
        return res.status(400).json({ error: "Image too large. Max 500KB allowed." });
      }
    } catch {
      return res.status(400).json({ error: "Invalid image data" });
    }

    const result = await updateUserProfile(userId, { avatar_url: avatarData });
    
    if (!result) {
      return res.status(500).json({ error: "Failed to update avatar" });
    }

    res.json({ success: true, avatar_url: avatarData });
  });

  // Get user avatar
  app.get("/api/avatar/:userId", async (req, res) => {
    const { userId } = req.params;
    const profile = await getUserProfile(userId);
    
    if (!profile) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({ avatar_url: profile.avatar_url });
  });

  if (process.env.NODE_ENV !== 'production') {
    try {
      bonjourInstance = new Bonjour();
      const port = parseInt(process.env.PORT || "5000", 10);

      bonjourInstance.publish({
        name: "VSteps Server",
        type: "vsteps",
        port: port,
        txt: { version: "1.0" }
      });

      log(`mDNS service published: VSteps on port ${port}`, "bonjour");
    } catch (err) {
      log(`mDNS publish failed: ${(err as Error).message}`, "bonjour");
    }
  }

  return httpServer;
}
