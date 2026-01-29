import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { useAuth } from '@/contexts/AuthContext';
import { Trophy as TrophyIcon, ArrowLeft, Footprints, Zap, Users, Timer, Activity, Target, Lock, Check } from 'lucide-react';

interface TrophyDef {
  id: string;
  name: string;
  description: string;
  icon: 'steps' | 'level' | 'friends' | 'playtime' | 'sprints' | 'jumps';
  requirement_type: 'steps' | 'level' | 'friends' | 'playtime' | 'sprints' | 'jumps';
  requirement_value: number;
}

const TROPHIES: TrophyDef[] = [
  { id: 'first_steps', name: 'First Steps with Jesus', description: 'Take your first 100 steps', icon: 'steps', requirement_type: 'steps', requirement_value: 100 },
  { id: 'walker', name: 'Crooked Way Straight', description: 'Accumulate 1,000 steps', icon: 'steps', requirement_type: 'steps', requirement_value: 1000 },
  { id: 'strider', name: 'Love Yourself as Your Neighbor', description: 'Accumulate 10,000 steps', icon: 'steps', requirement_type: 'steps', requirement_value: 10000 },
  { id: 'marathon', name: 'Jesus Loves You', description: 'Accumulate 50,000 steps', icon: 'steps', requirement_type: 'steps', requirement_value: 50000 },
  { id: 'legend', name: 'Eternal Life', description: 'Accumulate 100,000 steps', icon: 'steps', requirement_type: 'steps', requirement_value: 100000 },
  { id: 'lvl5', name: 'Getting Stronger', description: 'Reach Level 5', icon: 'level', requirement_type: 'level', requirement_value: 5 },
  { id: 'lvl10', name: 'Unshakable Faith', description: 'Reach Level 10', icon: 'level', requirement_type: 'level', requirement_value: 10 },
  { id: 'lvl25', name: 'OG Vet', description: 'Reach Level 25', icon: 'level', requirement_type: 'level', requirement_value: 25 },
  { id: 'lvl50', name: 'Kingdom Minded', description: 'Reach Level 50', icon: 'level', requirement_type: 'level', requirement_value: 50 },
  { id: 'sprinter', name: 'Run Back to Jesus', description: 'Sprint 100 times', icon: 'sprints', requirement_type: 'sprints', requirement_value: 100 },
  { id: 'speed_demon', name: 'Sharp as Iron', description: 'Sprint 1,000 times', icon: 'sprints', requirement_type: 'sprints', requirement_value: 1000 },
  { id: 'playtime_1h', name: 'To Love is Life', description: 'Play for 60 minutes total', icon: 'playtime', requirement_type: 'playtime', requirement_value: 60 },
  { id: 'playtime_10h', name: 'Committed to Christ', description: 'Play for 10 hours total', icon: 'playtime', requirement_type: 'playtime', requirement_value: 600 },
  { id: 'playtime_100h', name: 'Well Done, Child', description: 'Play for 100 hours total', icon: 'playtime', requirement_type: 'playtime', requirement_value: 6000 },
];

export default function Trophies() {
  const [, setLocation] = useLocation();
  const { stats, loading } = useAuth();

  const getIcon = (type: string) => {
    switch (type) {
      case 'steps': return <Footprints className="w-6 h-6" />;
      case 'level': return <Zap className="w-6 h-6" />;
      case 'friends': return <Users className="w-6 h-6" />;
      case 'playtime': return <Timer className="w-6 h-6" />;
      case 'sprints': return <Activity className="w-6 h-6" />;
      case 'jumps': return <Target className="w-6 h-6" />;
      default: return <TrophyIcon className="w-6 h-6" />;
    }
  };

  const getCurrentValue = (type: string): number => {
    if (!stats) return 0;
    switch (type) {
      case 'steps': return stats.total_steps;
      case 'level': return stats.level;
      case 'sprints': return stats.total_sprints;
      case 'jumps': return stats.total_jumps;
      case 'playtime': return stats.play_time_minutes;
      default: return 0;
    }
  };

  const isUnlocked = (trophy: TrophyDef): boolean => {
    return getCurrentValue(trophy.requirement_type) >= trophy.requirement_value;
  };

  const getProgress = (trophy: TrophyDef): number => {
    const current = getCurrentValue(trophy.requirement_type);
    return Math.min(100, (current / trophy.requirement_value) * 100);
  };

  const unlockedCount = TROPHIES.filter(isUnlocked).length;

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => setLocation('/')} data-testid="button-back">
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <TrophyIcon className="w-6 h-6 text-yellow-500" />
                Trophies
              </h1>
              <p className="text-muted-foreground">Unlock achievements as you progress</p>
            </div>
          </div>
          <Badge variant="secondary" className="text-lg px-4 py-2">
            {unlockedCount} / {TROPHIES.length}
          </Badge>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {TROPHIES.map((trophy) => {
            const unlocked = isUnlocked(trophy);
            const progress = getProgress(trophy);
            const current = getCurrentValue(trophy.requirement_type);

            return (
              <Card 
                key={trophy.id} 
                className={`transition-all ${unlocked ? 'border-yellow-500 bg-yellow-500/5' : 'opacity-75'}`}
                data-testid={`trophy-${trophy.id}`}
              >
                <CardContent className="p-4">
                  <div className="flex items-start gap-4">
                    <div className={`p-3 rounded-full ${unlocked ? 'bg-yellow-500 text-yellow-950' : 'bg-muted text-muted-foreground'}`}>
                      {unlocked ? getIcon(trophy.icon) : <Lock className="w-6 h-6" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold">{trophy.name}</h3>
                        {unlocked && (
                          <Badge className="bg-yellow-500 text-yellow-950">
                            <Check className="w-3 h-3 mr-1" />
                            Unlocked
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">{trophy.description}</p>
                      {!unlocked && (
                        <div className="mt-3">
                          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                            <span>{current.toLocaleString()} / {trophy.requirement_value.toLocaleString()}</span>
                            <span>{Math.round(progress)}%</span>
                          </div>
                          <Progress value={progress} className="h-2" />
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
