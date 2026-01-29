import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { useAuth } from '@/contexts/AuthContext';
import { calculateLevel, xpProgress, isTrialExpired } from '@/lib/supabase';
import { Footprints, Trophy, Users, Crown, Clock, Eye, Zap, Timer, Activity, Target, ArrowRight, Shield, LogOut, Gamepad2, BarChart3, UserPlus, Swords, QrCode, Camera } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ThemeToggle } from '@/components/theme-toggle';
import { QRScanner } from '@/components/qr-scanner';
import { AvatarUpload } from '@/components/avatar-upload';
import { useToast } from '@/hooks/use-toast';

export default function Dashboard() {
  const { user, profile, stats, loading, signOut, canUse, canFriend, isAdmin, refreshStats, refreshProfile, session } = useAuth();
  const [, setLocation] = useLocation();
  const [showQRScanner, setShowQRScanner] = useState(false);
  const [showAvatarUpload, setShowAvatarUpload] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const { toast } = useToast();

  const handleQRScan = (url: string) => {
    setShowQRScanner(false);

    try {
      new URL(url);
      window.location.href = url;
    } catch {
      toast({
        title: "Invalid QR Code",
        description: "The scanned QR code doesn't contain a valid URL",
        variant: "destructive"
      });
    }
  };

  useEffect(() => {
    if (!loading && !user) {
      setLocation('/login');
    }
  }, [user, loading, setLocation]);

  useEffect(() => {
    if (user && !profile && !profileLoading) {
      setProfileLoading(true);
      Promise.all([
        refreshProfile(),
        refreshStats()
      ]).finally(() => {
        setProfileLoading(false);
      });
    }
  }, [user, profile, profileLoading]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <Footprints className="w-12 h-12 mx-auto mb-4 animate-pulse text-primary" />
          <p className="text-muted-foreground">Loading your profile...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  if (profileLoading || !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <Footprints className="w-12 h-12 mx-auto mb-4 animate-pulse text-primary" />
          <p className="text-muted-foreground">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  const trialExpired = isTrialExpired(profile.trial_expires_at);
  const daysLeft = profile.trial_expires_at 
    ? Math.max(0, Math.ceil((new Date(profile.trial_expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : 0;

  const level = stats ? calculateLevel(stats.xp) : 1;
  const progress = stats ? xpProgress(stats.xp, level) : 0;

  const getAccountBadge = () => {
    switch (profile.account_type) {
      case 'ADMIN':
        return <Badge className="bg-red-500"><Crown className="w-3 h-3 mr-1" />Admin</Badge>;
      case 'SUBSCRIBED':
        return <Badge className="bg-green-500"><Crown className="w-3 h-3 mr-1" />Subscribed</Badge>;
      case 'DEMO':
        return trialExpired 
          ? <Badge variant="destructive"><Clock className="w-3 h-3 mr-1" />Trial Expired</Badge>
          : <Badge variant="secondary"><Clock className="w-3 h-3 mr-1" />Demo ({daysLeft} days left)</Badge>;
      case 'BASIC':
        return <Badge variant="outline"><Eye className="w-3 h-3 mr-1" />Basic (View Only)</Badge>;
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Footprints className="w-8 h-8 text-primary" />
            <span className="text-xl font-bold">VSteps</span>
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            {isAdmin && (
              <Button variant="outline" size="sm" onClick={() => setLocation('/admin')} data-testid="button-admin">
                <Shield className="w-4 h-4 mr-2" />
                Admin
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={signOut} data-testid="button-logout">
              <LogOut className="w-4 h-4 mr-2" />
              Logout
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-4 space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="relative">
              <Avatar 
                className="h-16 w-16 border-2 border-primary/30 cursor-pointer" 
                onClick={() => setShowAvatarUpload(true)}
                data-testid="avatar-user"
              >
                <AvatarImage src={profile.avatar_url || undefined} alt={profile.username} />
                <AvatarFallback className="text-xl bg-primary/20">
                  {profile.username?.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <Button 
                size="icon"
                variant="secondary"
                className="absolute -bottom-1 -right-1 h-7 w-7 rounded-full"
                onClick={() => setShowAvatarUpload(true)}
                data-testid="button-change-avatar"
              >
                <Camera className="w-3.5 h-3.5" />
              </Button>
            </div>
            <div>
              <h1 className="text-3xl font-bold">Welcome, {profile.username}!</h1>
              <div className="flex items-center gap-2 mt-2">
                {getAccountBadge()}
                <Badge variant="outline">Level {level}</Badge>
              </div>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <Button 
              size="lg" 
              onClick={() => setLocation('/controller')} 
              disabled={!canUse}
              data-testid="button-start-walking"
            >
              <Gamepad2 className="w-5 h-5 mr-2" />
              {canUse ? 'Start Walking' : 'Upgrade to Use'}
              <ArrowRight className="w-5 h-5 ml-2" />
            </Button>
            <Button 
              size="lg" 
              variant="outline"
              onClick={() => setLocation('/apex-gate')} 
              disabled={!canUse}
              data-testid="button-apex-gate"
            >
              <Zap className="w-5 h-5 mr-2" />
              Omni
            </Button>
            <Button 
              size="lg" 
              variant="secondary"
              onClick={() => setShowQRScanner(true)}
              data-testid="button-scan-qr"
            >
              <QrCode className="w-5 h-5 mr-2" />
              Scan QR
            </Button>
          </div>
        </div>

        {!canUse && (
          <Card className="border-yellow-500 bg-yellow-500/10">
            <CardContent className="py-4">
              <div className="flex items-center gap-3">
                <Clock className="w-6 h-6 text-yellow-500" />
                <div>
                  <p className="font-medium">
                    {profile.account_type === 'BASIC' 
                      ? 'You have a Basic account (view only)' 
                      : 'Your trial has expired'}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Upgrade to a Subscribed account to use all features
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
              <CardTitle className="text-sm font-medium">Total Steps</CardTitle>
              <Footprints className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.total_steps?.toLocaleString() || 0}</div>
              <p className="text-xs text-muted-foreground">Lifetime steps tracked</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
              <CardTitle className="text-sm font-medium">Level Progress</CardTitle>
              <Zap className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">Level {level}</div>
              <Progress value={progress} className="mt-2" />
              <p className="text-xs text-muted-foreground mt-1">{stats?.xp || 0} XP</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
              <CardTitle className="text-sm font-medium">Sprints</CardTitle>
              <Activity className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.total_sprints?.toLocaleString() || 0}</div>
              <p className="text-xs text-muted-foreground">Total sprint steps</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
              <CardTitle className="text-sm font-medium">Play Time</CardTitle>
              <Timer className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.play_time_minutes || 0} min</div>
              <p className="text-xs text-muted-foreground">Time spent walking</p>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="hover-elevate cursor-pointer border-2 border-primary/50 bg-primary/5" onClick={() => canFriend && setLocation('/pvp')}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Swords className="w-5 h-5 text-primary" />
                PVP Arena
                {!canFriend && <Badge variant="outline" className="ml-2">Subscribed Only</Badge>}
              </CardTitle>
              <CardDescription>Challenge friends to real-time step battles!</CardDescription>
            </CardHeader>
            <CardContent>
              <Button 
                className="w-full" 
                disabled={!canFriend}
                data-testid="button-pvp"
              >
                <Swords className="w-4 h-4 mr-2" />
                {canFriend ? 'Enter Arena' : 'Upgrade Required'}
              </Button>
            </CardContent>
          </Card>

          <Card className="hover-elevate cursor-pointer" onClick={() => setLocation('/leaderboard')}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-primary" />
                Leaderboard
              </CardTitle>
              <CardDescription>See how you rank against other players</CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" className="w-full" data-testid="button-leaderboard">
                View Rankings
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="hover-elevate cursor-pointer" onClick={() => canFriend && setLocation('/friends')}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="w-5 h-5 text-primary" />
                Friends
                {!canFriend && <Badge variant="outline" className="ml-2">Subscribed Only</Badge>}
              </CardTitle>
              <CardDescription>Connect with other VSteps users</CardDescription>
            </CardHeader>
            <CardContent>
              <Button 
                variant="outline" 
                className="w-full" 
                disabled={!canFriend}
                data-testid="button-friends"
              >
                <UserPlus className="w-4 h-4 mr-2" />
                {canFriend ? 'Manage Friends' : 'Upgrade Required'}
              </Button>
            </CardContent>
          </Card>

          <Card className="hover-elevate cursor-pointer" onClick={() => setLocation('/trophies')}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Trophy className="w-5 h-5 text-yellow-500" />
                Trophies
              </CardTitle>
              <CardDescription>Unlock achievements as you progress</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="secondary">{stats?.trophies?.length || 0} Earned</Badge>
              </div>
              <Button variant="outline" className="w-full" data-testid="button-trophies">
                View Trophies
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </CardContent>
          </Card>
        </div>

        {stats?.last_played && (
          <Card>
            <CardContent className="py-4">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Clock className="w-4 h-4" />
                <span>Last played: {new Date(stats.last_played).toLocaleString()}</span>
              </div>
            </CardContent>
          </Card>
        )}
      </main>

      {showQRScanner && (
        <QRScanner 
          onScan={handleQRScan} 
          onClose={() => setShowQRScanner(false)} 
        />
      )}

      {showAvatarUpload && session?.access_token && (
        <AvatarUpload
          userId={user.id}
          currentAvatarUrl={profile.avatar_url}
          username={profile.username}
          authToken={session.access_token}
          onAvatarUpdated={() => refreshProfile()}
          onClose={() => setShowAvatarUpload(false)}
        />
      )}
    </div>
  );
}
