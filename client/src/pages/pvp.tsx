import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ThemeToggle } from "@/components/theme-toggle";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { io, Socket } from "socket.io-client";
import { 
  Swords, 
  Users, 
  Trophy, 
  ArrowLeft, 
  Circle, 
  Footprints, 
  Crown,
  Timer,
  Zap,
  Send,
  X,
  Check,
  Play,
  Clock,
  Shield,
  Skull,
  Eye,
  EyeOff,
  Radio
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type GameMode = "1v1" | "2v2" | "3v3" | "4v4" | "5v5" | "10v10";

interface OnlineFriend {
  oderId: string;
  username: string;
  status: "online" | "in_pvp";
  avatarUrl?: string;
  inBattle?: boolean;
  battleRoomId?: string;
}

interface LobbyPlayer {
  oderId: string;
  username: string;
  isReady: boolean;
  isHost: boolean;
}

interface PVPRoom {
  roomId: string;
  oderId: string;
  opponentId: string;
  opponentUsername: string;
  mySteps: number;
  opponentSteps: number;
  startTime: number;
  durationMinutes: number;
  isActive: boolean;
  gameMode: GameMode;
  players: LobbyPlayer[];
}

interface PVPInvite {
  inviteId: string;
  fromUserId: string;
  fromUsername: string;
  durationMinutes: number;
  gameMode: GameMode;
  expiresAt: number;
}

interface LeaderboardEntry {
  oderId: string;
  username: string;
  steps: number;
  level?: number;
}

interface ActiveBattle {
  roomId: string;
  gameMode: string;
  player1: { username: string; steps: number };
  player2: { username: string; steps: number };
  spectatorCount: number;
  startTime: number;
  durationMinutes: number;
}

interface SpectateRoom {
  roomId: string;
  gameMode: string;
  player1: { oderId: string; username: string; steps: number };
  player2: { oderId: string; username: string; steps: number };
  spectatorCount: number;
}

type LobbyPhase = "waiting" | "setup" | "battle" | "results";

export default function PVP() {
  const [, navigate] = useLocation();
  const { user, profile } = useAuth();
  const { toast } = useToast();
  
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [onlineFriends, setOnlineFriends] = useState<OnlineFriend[]>([]);
  const [currentRoom, setCurrentRoom] = useState<PVPRoom | null>(null);
  const [pendingInvite, setPendingInvite] = useState<PVPInvite | null>(null);
  const [inviteCountdown, setInviteCountdown] = useState(30);
  const [todayLeaderboard, setTodayLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [allTimeLeaderboard, setAllTimeLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [battleTimeRemaining, setBattleTimeRemaining] = useState(0);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [selectedDuration, setSelectedDuration] = useState(5);
  const [gameMode, setGameMode] = useState<GameMode>("1v1");
  
  // Lobby state
  const [lobbyPhase, setLobbyPhase] = useState<LobbyPhase>("waiting");
  const [lobbyPlayers, setLobbyPlayers] = useState<LobbyPlayer[]>([]);
  const [isReady, setIsReady] = useState(false);
  const [setupTimeRemaining, setSetupTimeRemaining] = useState(120); // 2 minutes
  const [connectionTime, setConnectionTime] = useState(0);
  const [gameTime, setGameTime] = useState(0);
  
  // Spectator state
  const [isSpectating, setIsSpectating] = useState(false);
  const [spectateRoom, setSpectateRoom] = useState<SpectateRoom | null>(null);
  const [activeBattles, setActiveBattles] = useState<ActiveBattle[]>([]);
  const [spectatorCount, setSpectatorCount] = useState(0);
  const [activeTab, setActiveTab] = useState<string>("fight");
  
  const battleTimerRef = useRef<NodeJS.Timeout | null>(null);
  const setupTimerRef = useRef<NodeJS.Timeout | null>(null);
  const inviteTimerRef = useRef<NodeJS.Timeout | null>(null);
  const connectionTimerRef = useRef<NodeJS.Timeout | null>(null);
  const gameTimerRef = useRef<NodeJS.Timeout | null>(null);
  const knownFriendIdsRef = useRef<Set<string>>(new Set());

  const gameModeOptions: { value: GameMode; label: string; players: number }[] = [
    { value: "1v1", label: "1v1", players: 2 },
    { value: "2v2", label: "2v2", players: 4 },
    { value: "3v3", label: "3v3", players: 6 },
    { value: "4v4", label: "4v4", players: 8 },
    { value: "5v5", label: "5v5", players: 10 },
    { value: "10v10", label: "10v10", players: 20 },
  ];

  useEffect(() => {
    const checkDark = () => document.documentElement.classList.contains("dark");
    setIsDarkMode(checkDark());
    const observer = new MutationObserver(() => setIsDarkMode(checkDark()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!user) return;

    const serverUrl = window.location.origin;
    const newSocket = io(serverUrl, {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    newSocket.on("connect", () => {
      setIsConnected(true);
      newSocket.emit("user-online", {
        userId: user.id,
        username: profile?.username || user.email?.split("@")[0] || "Player"
      });
      
      fetchFriendsAndRequestOnlineStatus(newSocket);
    });
    
    const friendsInterval = setInterval(() => {
      if (newSocket.connected) {
        fetchFriendsAndRequestOnlineStatus(newSocket);
      }
    }, 10000);

    newSocket.on("disconnect", () => {
      setIsConnected(false);
    });

    newSocket.on("online-friends-list", (data: { friends: OnlineFriend[] }) => {
      setOnlineFriends(data.friends || []);
    });
    
    newSocket.on("user-status-changed", (data: { oderId: string; username?: string; online: boolean }) => {
      if (!knownFriendIdsRef.current.has(data.oderId)) return;
      
      if (data.online && data.username) {
        setOnlineFriends(prev => {
          if (prev.find(f => f.oderId === data.oderId)) return prev;
          return [...prev, { oderId: data.oderId, username: data.username!, status: "online" }];
        });
      } else {
        setOnlineFriends(prev => prev.filter(f => f.oderId !== data.oderId));
      }
    });

    newSocket.on("pvp-request", (data: { inviteId: string; from: string; fromId: string; durationMinutes?: number; gameMode?: GameMode }) => {
      const invite: PVPInvite = {
        inviteId: data.inviteId,
        fromUserId: data.fromId,
        fromUsername: data.from,
        durationMinutes: data.durationMinutes || 5,
        gameMode: data.gameMode || "1v1",
        expiresAt: Date.now() + 30000
      };
      setPendingInvite(invite);
      setInviteCountdown(30);
      
      // Start invite countdown
      if (inviteTimerRef.current) clearInterval(inviteTimerRef.current);
      inviteTimerRef.current = setInterval(() => {
        setInviteCountdown(prev => {
          if (prev <= 1) {
            if (inviteTimerRef.current) clearInterval(inviteTimerRef.current);
            setPendingInvite(null);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      
      toast({
        title: "PVP Challenge!",
        description: `${data.from} wants to battle you! (30s to accept)`,
      });
    });

    newSocket.on("pvp-lobby-update", (data: { players: LobbyPlayer[] }) => {
      setLobbyPlayers(data.players);
    });

    newSocket.on("pvp-started", (data: { 
      roomId: string; 
      durationMinutes: number; 
      gameMode: GameMode;
      player1: { oderId: string; username: string }; 
      player2: { oderId: string; username: string };
      players?: LobbyPlayer[];
    }) => {
      const isPlayer1 = data.player1.oderId === user.id;
      const opponent = isPlayer1 ? data.player2 : data.player1;
      const duration = data.durationMinutes || 5;
      
      const room: PVPRoom = {
        roomId: data.roomId,
        oderId: user.id,
        opponentId: opponent.oderId,
        opponentUsername: opponent.username,
        mySteps: 0,
        opponentSteps: 0,
        startTime: Date.now(),
        durationMinutes: duration,
        isActive: true,
        gameMode: data.gameMode || "1v1",
        players: data.players || []
      };
      
      setCurrentRoom(room);
      setPendingInvite(null);
      setLobbyPhase("setup");
      setSetupTimeRemaining(120);
      setIsReady(false);
      
      // Start 2-minute setup timer
      startSetupTimer();
      
      toast({
        title: "Lobby Joined!",
        description: `${duration} minute Last Man Standing - Get ready!`,
      });
    });

    newSocket.on("pvp-setup-complete", () => {
      setLobbyPhase("battle");
      startBattleTimer(currentRoom?.durationMinutes ? currentRoom.durationMinutes * 60 : 300);
      startConnectionTimer();
      startGameTimer();
      toast({
        title: "Battle Started!",
        description: "Last Man Standing - Winner takes all!",
      });
    });

    newSocket.on("pvp-ended", (data: { roomId: string; reason?: string; winner?: string }) => {
      // Handle spectator end
      if (isSpectating && spectateRoom?.roomId === data.roomId) {
        setIsSpectating(false);
        setSpectateRoom(null);
        toast({
          title: "Battle Ended",
          description: "The match you were watching has ended.",
        });
        return;
      }
      
      setLobbyPhase("results");
      if (currentRoom) {
        const isWinner = data.winner === user.id || currentRoom.mySteps > currentRoom.opponentSteps;
        toast({
          title: data.reason === "Player left" ? "Battle Ended" : (isWinner ? "Victory! Last Man Standing!" : "Defeat"),
          description: `Final score: You ${currentRoom.mySteps} - ${currentRoom.opponentSteps} Opponent`,
        });
      }
      
      setTimeout(() => {
        setCurrentRoom(null);
        setLobbyPhase("waiting");
        stopAllTimers();
      }, 5000);
    });

    newSocket.on("pvp-error", (error: { message: string }) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    });
    
    newSocket.on("pvp-declined", (data: { byUsername: string }) => {
      toast({
        title: "Challenge Declined",
        description: `${data.byUsername} declined your battle invite.`,
      });
    });

    // Spectator events
    newSocket.on("pvp-spectate-joined", (data: SpectateRoom) => {
      setSpectateRoom(data);
      setIsSpectating(true);
      setSpectatorCount(data.spectatorCount);
      toast({
        title: "Spectating!",
        description: `Watching ${data.player1.username} vs ${data.player2.username}`,
      });
    });

    newSocket.on("pvp-spectator-joined", (data: { username: string; spectatorCount: number }) => {
      setSpectatorCount(data.spectatorCount);
    });

    newSocket.on("pvp-spectator-left", (data: { spectatorCount: number }) => {
      setSpectatorCount(data.spectatorCount);
    });

    newSocket.on("active-battles-list", (data: { battles: ActiveBattle[] }) => {
      setActiveBattles(data.battles);
    });

    newSocket.on("friend-battle-found", (data: { roomId: string | null; gameMode?: string; player1?: any; player2?: any }) => {
      if (data.roomId && data.player1 && data.player2) {
        // Friend is in a battle, can spectate
        toast({
          title: "Friend in Battle!",
          description: `${data.player1.username} vs ${data.player2.username}`,
        });
      }
    });

    // Update spectate room on pvp-update events
    newSocket.on("pvp-update", (data: { roomId: string; player1: { oderId: string; steps: number; username?: string }; player2: { oderId: string; steps: number; username?: string } }) => {
      // Update for spectators
      if (isSpectating && spectateRoom?.roomId === data.roomId) {
        setSpectateRoom(prev => {
          if (!prev) return null;
          return {
            ...prev,
            player1: { ...prev.player1, steps: data.player1.steps },
            player2: { ...prev.player2, steps: data.player2.steps }
          };
        });
      }
      
      // Update for players (existing logic)
      setCurrentRoom(prev => {
        if (!prev || prev.roomId !== data.roomId) return prev;
        const isPlayer1 = data.player1.oderId === user?.id;
        return {
          ...prev,
          mySteps: isPlayer1 ? data.player1.steps : data.player2.steps,
          opponentSteps: isPlayer1 ? data.player2.steps : data.player1.steps
        };
      });
    });

    setSocket(newSocket);

    return () => {
      clearInterval(friendsInterval);
      stopAllTimers();
      newSocket.disconnect();
    };
  }, [user, profile, toast]);
  
  const fetchFriendsAndRequestOnlineStatus = async (socket: Socket) => {
    if (!user) return;
    
    try {
      const response = await fetch(`/api/user/${user.id}/friends`);
      if (response.ok) {
        const data = await response.json();
        const friendIds = (data.friends || []).map((f: any) => f.friend_id);
        
        knownFriendIdsRef.current = new Set(friendIds);
        
        if (friendIds.length > 0) {
          socket.emit("get-online-friends", {
            userId: user.id,
            friendIds
          });
        }
      }
    } catch (error) {
      console.error("Failed to fetch friends:", error);
    }
  };

  useEffect(() => {
    fetchLeaderboards();
    const interval = setInterval(fetchLeaderboards, 30000);
    return () => clearInterval(interval);
  }, []);

  const fetchLeaderboards = async () => {
    try {
      const [todayRes, allTimeRes] = await Promise.all([
        fetch("/api/leaderboard/today"),
        fetch("/api/leaderboard/all-time")
      ]);
      
      if (todayRes.ok) {
        const todayData = await todayRes.json();
        setTodayLeaderboard(todayData.leaderboard || []);
      }
      
      if (allTimeRes.ok) {
        const allTimeData = await allTimeRes.json();
        setAllTimeLeaderboard(allTimeData.leaderboard || []);
      }
    } catch (error) {
      console.error("Failed to fetch leaderboards:", error);
    }
  };

  const stopAllTimers = () => {
    if (battleTimerRef.current) clearInterval(battleTimerRef.current);
    if (setupTimerRef.current) clearInterval(setupTimerRef.current);
    if (inviteTimerRef.current) clearInterval(inviteTimerRef.current);
    if (connectionTimerRef.current) clearInterval(connectionTimerRef.current);
    if (gameTimerRef.current) clearInterval(gameTimerRef.current);
  };

  const startSetupTimer = () => {
    if (setupTimerRef.current) clearInterval(setupTimerRef.current);
    setSetupTimeRemaining(120);
    
    setupTimerRef.current = setInterval(() => {
      setSetupTimeRemaining(prev => {
        if (prev <= 1) {
          if (setupTimerRef.current) clearInterval(setupTimerRef.current);
          // Auto-start battle when setup time ends
          if (socket) {
            socket.emit("pvp-setup-done", { roomId: currentRoom?.roomId });
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const startBattleTimer = (seconds: number) => {
    setBattleTimeRemaining(seconds);
    if (battleTimerRef.current) clearInterval(battleTimerRef.current);
    
    battleTimerRef.current = setInterval(() => {
      setBattleTimeRemaining(prev => {
        if (prev <= 1) {
          if (battleTimerRef.current) clearInterval(battleTimerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const startConnectionTimer = () => {
    setConnectionTime(0);
    if (connectionTimerRef.current) clearInterval(connectionTimerRef.current);
    
    connectionTimerRef.current = setInterval(() => {
      setConnectionTime(prev => prev + 1);
    }, 1000);
  };

  const startGameTimer = () => {
    setGameTime(0);
    if (gameTimerRef.current) clearInterval(gameTimerRef.current);
    
    gameTimerRef.current = setInterval(() => {
      setGameTime(prev => prev + 1);
    }, 1000);
  };

  const sendPVPInvite = (friendId: string, friendUsername: string) => {
    if (!socket || !user) return;
    
    socket.emit("invite-to-pvp", {
      oderId: user.id,
      friendId: friendId,
      durationMinutes: selectedDuration,
      gameMode: gameMode
    });
    
    toast({
      title: "Invite Sent",
      description: `Waiting for ${friendUsername} to accept (30s)...`,
    });
  };

  const acceptInvite = () => {
    if (!socket || !pendingInvite || !user) return;
    
    if (inviteTimerRef.current) clearInterval(inviteTimerRef.current);
    
    socket.emit("accept-pvp", {
      inviteId: pendingInvite.inviteId,
      oderId: user.id,
      opponentId: pendingInvite.fromUserId
    });
  };

  const declineInvite = () => {
    if (!socket || !pendingInvite) return;
    
    if (inviteTimerRef.current) clearInterval(inviteTimerRef.current);
    
    socket.emit("pvp-decline", { 
      inviteId: pendingInvite.inviteId,
      fromId: pendingInvite.fromUserId 
    });
    setPendingInvite(null);
    toast({
      title: "Challenge Declined",
      description: "You declined the battle invite.",
    });
  };

  const toggleReady = () => {
    if (!socket || !currentRoom) return;
    
    const newReadyState = !isReady;
    setIsReady(newReadyState);
    socket.emit("pvp-ready", { 
      roomId: currentRoom.roomId, 
      oderId: user?.id,
      isReady: newReadyState 
    });
  };

  const startBattle = () => {
    if (!socket || !currentRoom) return;
    
    // Check if all players are ready
    const allReady = lobbyPlayers.every(p => p.isReady);
    if (!allReady) {
      toast({
        title: "Not Ready",
        description: "All players must be ready to start!",
        variant: "destructive",
      });
      return;
    }
    
    socket.emit("pvp-start-battle", { roomId: currentRoom.roomId });
  };

  const leaveRoom = () => {
    if (!socket || !currentRoom) return;
    
    socket.emit("leave-pvp", { roomId: currentRoom.roomId });
    setCurrentRoom(null);
    setLobbyPhase("waiting");
    stopAllTimers();
  };

  // Spectator functions
  const fetchActiveBattles = () => {
    if (!socket) return;
    socket.emit("get-active-battles");
  };

  const spectateMatch = (roomId: string) => {
    if (!socket || !user) return;
    socket.emit("pvp-spectate", { oderId: user.id, roomId });
  };

  const stopSpectating = () => {
    if (!socket || !user || !spectateRoom) return;
    socket.emit("pvp-stop-spectate", { oderId: user.id, roomId: spectateRoom.roomId });
    setIsSpectating(false);
    setSpectateRoom(null);
  };

  const watchFriend = (friendId: string) => {
    if (!socket) return;
    socket.emit("get-friend-battle", { friendId });
  };

  // Fetch active battles when switching to Watch tab
  useEffect(() => {
    if (activeTab === "watch" && socket) {
      fetchActiveBattles();
      const interval = setInterval(fetchActiveBattles, 5000);
      return () => clearInterval(interval);
    }
  }, [activeTab, socket]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const getRequiredPlayers = () => {
    const mode = gameModeOptions.find(m => m.value === gameMode);
    return mode ? mode.players : 2;
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-6 text-center">
            <p className="text-muted-foreground mb-4">Please log in to access PVP battles</p>
            <Button onClick={() => navigate("/login")} data-testid="button-login">
              Log In
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex items-center justify-between p-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/")} data-testid="button-back">
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div>
              <h1 className="text-lg font-bold flex items-center gap-2">
                <Skull className="w-5 h-5 text-red-500" />
                Last Man Standing
              </h1>
              <div className="flex items-center gap-2">
                {isConnected ? (
                  <Badge variant="outline" className="text-xs bg-green-500/10 text-green-600" data-testid="badge-connected">
                    <Circle className="w-2 h-2 fill-green-500 mr-1" />
                    Online
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-xs bg-red-500/10 text-red-600" data-testid="badge-disconnected">
                    <Circle className="w-2 h-2 fill-red-500 mr-1" />
                    Offline
                  </Badge>
                )}
              </div>
            </div>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <main className="p-4 space-y-4 max-w-2xl mx-auto">
        {/* Pending Invite with Countdown */}
        {pendingInvite && (
          <Card className="border-2 border-yellow-500 bg-yellow-500/5">
            <CardContent className="p-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Swords className="w-6 h-6 text-yellow-500 animate-pulse" />
                    <div>
                      <p className="font-medium">{pendingInvite.fromUsername} challenges you!</p>
                      <p className="text-sm text-muted-foreground">
                        {pendingInvite.gameMode} • {pendingInvite.durationMinutes} min • Last Man Standing
                      </p>
                    </div>
                  </div>
                  <Badge variant="destructive" className="text-lg font-mono animate-pulse">
                    {inviteCountdown}s
                  </Badge>
                </div>
                <Progress value={(inviteCountdown / 30) * 100} className="h-2" />
                <div className="flex gap-2">
                  <Button size="sm" variant="destructive" onClick={declineInvite} className="flex-1" data-testid="button-decline-invite">
                    <X className="w-4 h-4 mr-1" />
                    Decline
                  </Button>
                  <Button size="sm" onClick={acceptInvite} className="flex-1 bg-green-600 hover:bg-green-700" data-testid="button-accept-invite">
                    <Check className="w-4 h-4 mr-1" />
                    Accept
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Lobby Phase */}
        {currentRoom && lobbyPhase === "setup" && (
          <Card className="border-2 border-blue-500">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Shield className="w-5 h-5 text-blue-500" />
                  Lobby - Setup Phase
                </div>
                <Badge variant="outline" className="text-lg font-mono bg-blue-500/10 text-blue-600">
                  <Clock className="w-4 h-4 mr-1" />
                  {formatTime(setupTimeRemaining)}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="p-4 rounded-lg bg-blue-500/10 border border-blue-500/30">
                <p className="text-sm font-medium text-blue-600 dark:text-blue-400 text-center">
                  2 Minutes to setup your game and calibrate!
                </p>
                <p className="text-xs text-muted-foreground text-center mt-1">
                  Battle starts automatically when timer ends or when all players click Start
                </p>
              </div>
              
              <div className="space-y-2">
                <p className="text-sm font-medium">Game Mode: {currentRoom.gameMode} Last Man Standing</p>
                <p className="text-xs text-muted-foreground">Winner: Player who lasts the longest!</p>
              </div>

              {/* Ready Toggle */}
              <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                <div className="flex items-center gap-2">
                  <Check className={`w-5 h-5 ${isReady ? 'text-green-500' : 'text-muted-foreground'}`} />
                  <span className="font-medium">Ready Status</span>
                </div>
                <Switch
                  checked={isReady}
                  onCheckedChange={toggleReady}
                  data-testid="switch-ready"
                />
              </div>

              {/* Players Status */}
              <div className="space-y-2">
                <p className="text-sm font-medium">Players:</p>
                <div className="grid grid-cols-2 gap-2">
                  <div className={`p-3 rounded-lg ${isReady ? 'bg-green-500/20 border border-green-500/50' : 'bg-muted/50'}`}>
                    <p className="font-medium">You</p>
                    <Badge variant={isReady ? "default" : "secondary"} className={isReady ? 'bg-green-500' : ''}>
                      {isReady ? 'Ready' : 'Not Ready'}
                    </Badge>
                  </div>
                  <div className={`p-3 rounded-lg bg-muted/50`}>
                    <p className="font-medium">{currentRoom.opponentUsername}</p>
                    <Badge variant="secondary">Waiting...</Badge>
                  </div>
                </div>
              </div>

              <div className="flex gap-2">
                <Button 
                  className="flex-1 bg-green-600 hover:bg-green-700" 
                  onClick={startBattle}
                  disabled={!isReady}
                  data-testid="button-start-battle"
                >
                  <Play className="w-4 h-4 mr-2" />
                  Start Battle
                </Button>
                <Button variant="outline" onClick={leaveRoom} data-testid="button-leave-lobby">
                  Leave
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Active Battle */}
        {currentRoom && lobbyPhase === "battle" && (
          <Card className="border-2 border-red-500">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Skull className="w-5 h-5 text-red-500 animate-pulse" />
                  Last Man Standing
                </div>
                <Badge variant="destructive" className="text-lg font-mono animate-pulse" data-testid="badge-timer">
                  <Timer className="w-4 h-4 mr-1" />
                  {formatTime(battleTimeRemaining)}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Time Tracking */}
              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="p-2 rounded bg-muted/50">
                  <p className="text-xs text-muted-foreground">Connection Time</p>
                  <p className="font-mono font-bold" data-testid="text-connection-time">{formatTime(connectionTime)}</p>
                </div>
                <div className="p-2 rounded bg-muted/50">
                  <p className="text-xs text-muted-foreground">Game Time</p>
                  <p className="font-mono font-bold" data-testid="text-game-time">{formatTime(gameTime)}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="text-center p-4 bg-primary/10 rounded-lg border-2 border-primary">
                  <p className="text-sm text-muted-foreground mb-1">You</p>
                  <p className="text-4xl font-bold text-primary" data-testid="text-my-steps">
                    {currentRoom.mySteps}
                  </p>
                  <div className="flex items-center justify-center gap-1 mt-1">
                    <Footprints className="w-4 h-4" />
                    <span className="text-sm">steps</span>
                  </div>
                </div>
                
                <div className="text-center p-4 bg-muted rounded-lg">
                  <p className="text-sm text-muted-foreground mb-1">{currentRoom.opponentUsername}</p>
                  <p className="text-4xl font-bold" data-testid="text-opponent-steps">
                    {currentRoom.opponentSteps}
                  </p>
                  <div className="flex items-center justify-center gap-1 mt-1">
                    <Footprints className="w-4 h-4" />
                    <span className="text-sm">steps</span>
                  </div>
                </div>
              </div>
              
              <div className="flex items-center justify-center">
                {currentRoom.mySteps > currentRoom.opponentSteps ? (
                  <Badge className="bg-green-500 text-lg px-4 py-1">
                    <Crown className="w-4 h-4 mr-1" />
                    Leading!
                  </Badge>
                ) : currentRoom.mySteps < currentRoom.opponentSteps ? (
                  <Badge variant="destructive" className="text-lg px-4 py-1">
                    <Zap className="w-4 h-4 mr-1" />
                    Behind!
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-lg px-4 py-1">Tied!</Badge>
                )}
              </div>
              
              <p className="text-center text-sm text-muted-foreground">
                Go to the Controller page to count your steps!
              </p>
              
              <div className="flex gap-2">
                <Button className="flex-1" onClick={() => navigate("/controller")} data-testid="button-go-controller">
                  <Footprints className="w-4 h-4 mr-2" />
                  Open Controller
                </Button>
                <Button variant="outline" onClick={leaveRoom} data-testid="button-leave-battle">
                  Forfeit
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Spectator View - Watching a match */}
        {isSpectating && spectateRoom && (
          <Card className="border-2 border-purple-500">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Eye className="w-5 h-5 text-purple-500" />
                  Spectating
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="bg-purple-500/10 text-purple-600">
                    <Users className="w-3 h-3 mr-1" />
                    {spectatorCount} watching
                  </Badge>
                  <Badge variant="secondary">{spectateRoom.gameMode}</Badge>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="text-center p-4 bg-blue-500/10 rounded-lg border border-blue-500/30">
                  <p className="text-sm text-muted-foreground mb-1">{spectateRoom.player1.username}</p>
                  <p className="text-4xl font-bold text-blue-600" data-testid="text-spectate-p1-steps">
                    {spectateRoom.player1.steps}
                  </p>
                  <div className="flex items-center justify-center gap-1 mt-1">
                    <Footprints className="w-4 h-4" />
                    <span className="text-sm">steps</span>
                  </div>
                </div>
                
                <div className="text-center p-4 bg-red-500/10 rounded-lg border border-red-500/30">
                  <p className="text-sm text-muted-foreground mb-1">{spectateRoom.player2.username}</p>
                  <p className="text-4xl font-bold text-red-600" data-testid="text-spectate-p2-steps">
                    {spectateRoom.player2.steps}
                  </p>
                  <div className="flex items-center justify-center gap-1 mt-1">
                    <Footprints className="w-4 h-4" />
                    <span className="text-sm">steps</span>
                  </div>
                </div>
              </div>
              
              <div className="flex items-center justify-center">
                {spectateRoom.player1.steps > spectateRoom.player2.steps ? (
                  <Badge className="bg-blue-500 text-lg px-4 py-1">
                    <Crown className="w-4 h-4 mr-1" />
                    {spectateRoom.player1.username} Leading!
                  </Badge>
                ) : spectateRoom.player1.steps < spectateRoom.player2.steps ? (
                  <Badge className="bg-red-500 text-lg px-4 py-1">
                    <Crown className="w-4 h-4 mr-1" />
                    {spectateRoom.player2.username} Leading!
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-lg px-4 py-1">Tied!</Badge>
                )}
              </div>
              
              <Button variant="outline" onClick={stopSpectating} className="w-full" data-testid="button-stop-spectating">
                <EyeOff className="w-4 h-4 mr-2" />
                Stop Watching
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Mode Selection & Friends */}
        {!currentRoom && !isSpectating && (
          <>
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="fight" className="flex items-center gap-2" data-testid="tab-fight">
                  <Swords className="w-4 h-4" />
                  Fight
                </TabsTrigger>
                <TabsTrigger value="watch" className="flex items-center gap-2" data-testid="tab-watch">
                  <Eye className="w-4 h-4" />
                  Watch
                </TabsTrigger>
              </TabsList>

              <TabsContent value="fight" className="space-y-4 mt-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Users className="w-4 h-4" />
                      Challenge Friends
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Game Mode Selection */}
                    <div className="space-y-2">
                      <span className="text-sm font-medium">Game Mode:</span>
                      <div className="grid grid-cols-3 gap-2">
                        {gameModeOptions.map(mode => (
                          <Button
                            key={mode.value}
                            size="sm"
                            variant={gameMode === mode.value ? "default" : "outline"}
                            onClick={() => setGameMode(mode.value)}
                            data-testid={`button-mode-${mode.value}`}
                          >
                            {mode.label}
                          </Button>
                        ))}
                      </div>
                    </div>
                    
                    {/* Duration Selection */}
                    <div className="space-y-2">
                      <span className="text-sm font-medium">Duration:</span>
                      <div className="flex flex-wrap gap-2">
                        {[5, 10, 15, 30].map(min => (
                          <Button
                            key={min}
                            size="sm"
                            variant={selectedDuration === min ? "default" : "outline"}
                            onClick={() => setSelectedDuration(min)}
                            data-testid={`button-duration-${min}`}
                          >
                            {min}min
                          </Button>
                        ))}
                      </div>
                    </div>

                    {/* Game Rules Info */}
                    <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30">
                      <div className="flex items-center gap-2 mb-1">
                        <Skull className="w-4 h-4 text-red-500" />
                        <span className="font-medium text-red-600 dark:text-red-400">Last Man Standing</span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Winner is determined by who lasts the longest! Keep stepping to survive.
                      </p>
                    </div>
                    
                    {/* Online Friends List */}
                    {onlineFriends.length === 0 ? (
                  <div className="text-center py-6 text-muted-foreground">
                    <Users className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No friends online</p>
                    <p className="text-xs">Add friends to challenge them!</p>
                  </div>
                ) : (
                  <ScrollArea className="h-48">
                    <div className="space-y-2">
                      {onlineFriends.map(friend => (
                        <div 
                          key={friend.oderId}
                          className="flex items-center justify-between p-3 rounded-lg bg-muted/50"
                          data-testid={`friend-${friend.oderId}`}
                        >
                          <div className="flex items-center gap-3">
                            <Avatar className="h-10 w-10">
                              <AvatarFallback className="text-sm bg-primary/20">
                                {friend.username?.slice(0, 2).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <div>
                              <div className="flex items-center gap-2">
                                <Circle className={`w-2 h-2 ${friend.status === "in_pvp" ? "fill-yellow-500" : "fill-green-500"}`} />
                                <span className="font-medium">{friend.username}</span>
                              </div>
                              {friend.status === "in_pvp" && (
                                <Badge variant="secondary" className="text-xs">In Battle</Badge>
                              )}
                            </div>
                          </div>
                          <Button 
                            onClick={() => sendPVPInvite(friend.oderId, friend.username)}
                            disabled={friend.status === "in_pvp"}
                            className="bg-red-600 hover:bg-red-700"
                            data-testid={`button-challenge-${friend.oderId}`}
                          >
                            <Swords className="w-4 h-4 mr-1" />
                            Invite Battle
                          </Button>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>

            {/* Leaderboards */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Trophy className="w-4 h-4 text-yellow-500" />
                  Today's Leaders
                </CardTitle>
              </CardHeader>
              <CardContent>
                {todayLeaderboard.length === 0 ? (
                  <div className="text-center py-4 text-muted-foreground">
                    <p className="text-sm">No steps recorded today</p>
                    <p className="text-xs">Be the first!</p>
                  </div>
                ) : (
                  <ScrollArea className="h-48">
                    <div className="space-y-2">
                      {todayLeaderboard.slice(0, 10).map((entry, index) => (
                        <div 
                          key={entry.oderId}
                          className={`flex items-center justify-between p-2 rounded-lg ${index === 0 ? "bg-yellow-500/10" : "bg-muted/50"}`}
                          data-testid={`leaderboard-entry-${index}`}
                        >
                          <div className="flex items-center gap-3">
                            <span className={`w-6 text-center font-bold ${index === 0 ? "text-yellow-500" : "text-muted-foreground"}`}>
                              {index === 0 ? <Crown className="w-4 h-4" /> : `#${index + 1}`}
                            </span>
                            <span className="font-medium">{entry.username}</span>
                          </div>
                          <Badge variant="secondary" className="font-mono">
                            {entry.steps.toLocaleString()}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>
              </TabsContent>

              {/* Watch Tab - Spectate Battles */}
              <TabsContent value="watch" className="space-y-4 mt-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Radio className="w-4 h-4 text-purple-500 animate-pulse" />
                      Live Battles
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {activeBattles.length === 0 ? (
                      <div className="text-center py-6 text-muted-foreground">
                        <Eye className="w-8 h-8 mx-auto mb-2 opacity-50" />
                        <p className="text-sm">No active battles right now</p>
                        <p className="text-xs">Check back soon or start your own!</p>
                      </div>
                    ) : (
                      <ScrollArea className="h-64">
                        <div className="space-y-3">
                          {activeBattles.map(battle => (
                            <div 
                              key={battle.roomId}
                              className="p-4 rounded-lg bg-purple-500/5 border border-purple-500/20"
                              data-testid={`battle-${battle.roomId}`}
                            >
                              <div className="flex items-center justify-between mb-2">
                                <Badge variant="outline">{battle.gameMode}</Badge>
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                  <Users className="w-3 h-3" />
                                  {battle.spectatorCount} watching
                                </div>
                              </div>
                              <div className="flex items-center justify-between mb-3">
                                <div className="text-center flex-1">
                                  <p className="font-medium">{battle.player1.username}</p>
                                  <p className="text-2xl font-bold text-blue-600">{battle.player1.steps}</p>
                                </div>
                                <div className="px-4">
                                  <Swords className="w-6 h-6 text-muted-foreground" />
                                </div>
                                <div className="text-center flex-1">
                                  <p className="font-medium">{battle.player2.username}</p>
                                  <p className="text-2xl font-bold text-red-600">{battle.player2.steps}</p>
                                </div>
                              </div>
                              <Button 
                                className="w-full bg-purple-600 hover:bg-purple-700"
                                onClick={() => spectateMatch(battle.roomId)}
                                data-testid={`button-spectate-${battle.roomId}`}
                              >
                                <Eye className="w-4 h-4 mr-2" />
                                Watch Match
                              </Button>
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    )}
                  </CardContent>
                </Card>

                {/* Friends in Battle */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Users className="w-4 h-4" />
                      Friends in Battle
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {onlineFriends.filter(f => f.status === "in_pvp").length === 0 ? (
                      <div className="text-center py-4 text-muted-foreground">
                        <p className="text-sm">No friends currently battling</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {onlineFriends.filter(f => f.status === "in_pvp").map(friend => (
                          <div 
                            key={friend.oderId}
                            className="flex items-center justify-between p-3 rounded-lg bg-yellow-500/10"
                          >
                            <div className="flex items-center gap-3">
                              <Avatar className="h-8 w-8">
                                <AvatarFallback className="text-xs bg-yellow-500/20">
                                  {friend.username?.slice(0, 2).toUpperCase()}
                                </AvatarFallback>
                              </Avatar>
                              <div>
                                <span className="font-medium">{friend.username}</span>
                                <Badge variant="secondary" className="ml-2 text-xs">In Battle</Badge>
                              </div>
                            </div>
                            <Button 
                              size="sm"
                              variant="outline"
                              onClick={() => watchFriend(friend.oderId)}
                              data-testid={`button-watch-friend-${friend.oderId}`}
                            >
                              <Eye className="w-4 h-4 mr-1" />
                              Watch
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>

            {/* All-Time Leaders - Always visible */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Trophy className="w-4 h-4 text-purple-500" />
                  All-Time Leaders
                </CardTitle>
              </CardHeader>
              <CardContent>
                {allTimeLeaderboard.length === 0 ? (
                  <div className="text-center py-4 text-muted-foreground">
                    <p className="text-sm">No data yet</p>
                  </div>
                ) : (
                  <ScrollArea className="h-48">
                    <div className="space-y-2">
                      {allTimeLeaderboard.slice(0, 10).map((entry, index) => (
                        <div 
                          key={entry.oderId}
                          className={`flex items-center justify-between p-2 rounded-lg ${index === 0 ? "bg-purple-500/10" : "bg-muted/50"}`}
                          data-testid={`alltime-entry-${index}`}
                        >
                          <div className="flex items-center gap-3">
                            <span className={`w-6 text-center font-bold ${index === 0 ? "text-purple-500" : "text-muted-foreground"}`}>
                              {index === 0 ? <Crown className="w-4 h-4" /> : `#${index + 1}`}
                            </span>
                            <span className="font-medium">{entry.username}</span>
                            {entry.level && (
                              <Badge variant="outline" className="text-xs">Lv.{entry.level}</Badge>
                            )}
                          </div>
                          <Badge variant="secondary" className="font-mono">
                            {entry.steps.toLocaleString()}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}
