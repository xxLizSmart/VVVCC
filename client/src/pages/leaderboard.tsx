import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { supabase, calculateLevel } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Trophy, Footprints, Zap, ArrowLeft, Medal, Crown } from 'lucide-react';

interface LeaderboardEntry {
  user_id: string;
  username: string;
  total_steps: number;
  level: number;
  xp: number;
  avatar_url: string | null;
}

export default function Leaderboard() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const [stepLeaders, setStepLeaders] = useState<LeaderboardEntry[]>([]);
  const [levelLeaders, setLevelLeaders] = useState<LeaderboardEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchLeaderboards();
  }, []);

  const fetchLeaderboards = async () => {
    setIsLoading(true);

    const { data: stepsData } = await supabase
      .from('user_stats')
      .select(`
        user_id,
        total_steps,
        level,
        xp,
        profiles!inner(username, avatar_url)
      `)
      .order('total_steps', { ascending: false })
      .limit(50);

    const { data: levelData } = await supabase
      .from('user_stats')
      .select(`
        user_id,
        total_steps,
        level,
        xp,
        profiles!inner(username, avatar_url)
      `)
      .order('xp', { ascending: false })
      .limit(50);

    if (stepsData) {
      setStepLeaders(stepsData.map((entry: any) => ({
        user_id: entry.user_id,
        username: entry.profiles.username,
        total_steps: entry.total_steps,
        level: calculateLevel(entry.xp),
        xp: entry.xp,
        avatar_url: entry.profiles.avatar_url,
      })));
    }

    if (levelData) {
      setLevelLeaders(levelData.map((entry: any) => ({
        user_id: entry.user_id,
        username: entry.profiles.username,
        total_steps: entry.total_steps,
        level: calculateLevel(entry.xp),
        xp: entry.xp,
        avatar_url: entry.profiles.avatar_url,
      })));
    }

    setIsLoading(false);
  };

  const getRankIcon = (rank: number) => {
    switch (rank) {
      case 1:
        return <Crown className="w-5 h-5 text-yellow-500" />;
      case 2:
        return <Medal className="w-5 h-5 text-gray-400" />;
      case 3:
        return <Medal className="w-5 h-5 text-amber-600" />;
      default:
        return <span className="w-5 h-5 flex items-center justify-center text-sm font-medium text-muted-foreground">{rank}</span>;
    }
  };

  const getRankBadge = (rank: number) => {
    switch (rank) {
      case 1:
        return <Badge className="bg-yellow-500">1st</Badge>;
      case 2:
        return <Badge className="bg-gray-400">2nd</Badge>;
      case 3:
        return <Badge className="bg-amber-600">3rd</Badge>;
      default:
        return <Badge variant="outline">{rank}th</Badge>;
    }
  };

  const LeaderboardList = ({ entries, type }: { entries: LeaderboardEntry[], type: 'steps' | 'level' }) => (
    <div className="space-y-2">
      {entries.map((entry, index) => {
        const isCurrentUser = entry.user_id === user?.id;
        return (
          <div
            key={entry.user_id}
            className={`flex items-center gap-4 p-3 rounded-lg border ${
              isCurrentUser ? 'bg-primary/10 border-primary' : 'bg-card'
            }`}
            data-testid={`leaderboard-entry-${entry.user_id}`}
          >
            <div className="w-8 flex justify-center">
              {getRankIcon(index + 1)}
            </div>
            <Avatar className="h-10 w-10">
              <AvatarImage src={entry.avatar_url || undefined} alt={entry.username} />
              <AvatarFallback className="bg-primary/20">
                {entry.username?.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium truncate">{entry.username}</span>
                {isCurrentUser && <Badge variant="secondary">You</Badge>}
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Badge variant="outline" className="text-xs">Lvl {entry.level}</Badge>
              </div>
            </div>
            <div className="text-right">
              {type === 'steps' ? (
                <div className="flex items-center gap-2">
                  <Footprints className="w-4 h-4 text-muted-foreground" />
                  <span className="font-bold">{entry.total_steps.toLocaleString()}</span>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-muted-foreground" />
                  <span className="font-bold">{entry.xp.toLocaleString()} XP</span>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => setLocation('/')} data-testid="button-back">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Trophy className="w-6 h-6 text-yellow-500" />
              Leaderboard
            </h1>
            <p className="text-muted-foreground">Top VSteps players worldwide</p>
          </div>
        </div>

        <Tabs defaultValue="steps">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="steps" className="flex items-center gap-2" data-testid="tab-steps">
              <Footprints className="w-4 h-4" />
              Most Steps
            </TabsTrigger>
            <TabsTrigger value="level" className="flex items-center gap-2" data-testid="tab-level">
              <Zap className="w-4 h-4" />
              Highest Level
            </TabsTrigger>
          </TabsList>

          <TabsContent value="steps" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Footprints className="w-5 h-5" />
                  Step Champions
                </CardTitle>
                <CardDescription>Players with the most lifetime steps</CardDescription>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="text-center py-8 text-muted-foreground">Loading leaderboard...</div>
                ) : stepLeaders.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">No players yet. Be the first!</div>
                ) : (
                  <LeaderboardList entries={stepLeaders} type="steps" />
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="level" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Zap className="w-5 h-5" />
                  Level Masters
                </CardTitle>
                <CardDescription>Players with the highest XP and level</CardDescription>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="text-center py-8 text-muted-foreground">Loading leaderboard...</div>
                ) : levelLeaders.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">No players yet. Be the first!</div>
                ) : (
                  <LeaderboardList entries={levelLeaders} type="level" />
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
