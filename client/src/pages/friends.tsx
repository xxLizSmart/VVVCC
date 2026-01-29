import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { supabase, calculateLevel, Profile } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Users, UserPlus, ArrowLeft, Search, Check, X, Clock, Footprints, Zap, UserMinus } from 'lucide-react';

interface FriendWithProfile {
  id: string;
  friend_id: string;
  user_id: string;
  status: 'pending' | 'accepted' | 'rejected';
  created_at: string;
  profile: {
    username: string;
    avatar_url: string | null;
  };
  stats: {
    total_steps: number;
    xp: number;
    last_played: string | null;
  } | null;
}

export default function Friends() {
  const [, setLocation] = useLocation();
  const { user, canFriend, loading } = useAuth();
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<Profile[]>([]);
  const [friends, setFriends] = useState<FriendWithProfile[]>([]);
  const [pendingReceived, setPendingReceived] = useState<FriendWithProfile[]>([]);
  const [pendingSent, setPendingSent] = useState<FriendWithProfile[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!loading && !canFriend) {
      setLocation('/');
    }
  }, [canFriend, loading, setLocation]);

  useEffect(() => {
    if (user) {
      fetchFriends();
    }
  }, [user]);

  const fetchFriends = async () => {
    if (!user) return;
    setIsLoading(true);

    const { data: acceptedFriends } = await supabase
      .from('friendships')
      .select(`
        id,
        friend_id,
        user_id,
        status,
        created_at
      `)
      .or(`user_id.eq.${user.id},friend_id.eq.${user.id}`)
      .eq('status', 'accepted');

    const { data: received } = await supabase
      .from('friendships')
      .select(`
        id,
        friend_id,
        user_id,
        status,
        created_at
      `)
      .eq('friend_id', user.id)
      .eq('status', 'pending');

    const { data: sent } = await supabase
      .from('friendships')
      .select(`
        id,
        friend_id,
        user_id,
        status,
        created_at
      `)
      .eq('user_id', user.id)
      .eq('status', 'pending');

    const enrichFriendships = async (friendships: any[], isSent: boolean) => {
      if (!friendships) return [];
      
      const enriched = await Promise.all(friendships.map(async (f) => {
        const otherId = isSent ? f.friend_id : (f.user_id === user.id ? f.friend_id : f.user_id);
        
        const { data: profile } = await supabase
          .from('profiles')
          .select('username, avatar_url')
          .eq('id', otherId)
          .single();

        const { data: stats } = await supabase
          .from('user_stats')
          .select('total_steps, xp, last_played')
          .eq('user_id', otherId)
          .single();

        return {
          ...f,
          profile: profile || { username: 'Unknown', avatar_url: null },
          stats: stats,
        };
      }));
      
      return enriched;
    };

    const enrichedFriends = await enrichFriendships(acceptedFriends || [], false);
    const enrichedReceived = await enrichFriendships(received || [], false);
    const enrichedSent = await enrichFriendships(sent || [], true);

    setFriends(enrichedFriends);
    setPendingReceived(enrichedReceived);
    setPendingSent(enrichedSent);
    setIsLoading(false);
  };

  const searchUsers = async () => {
    if (!searchTerm.trim()) return;
    setIsSearching(true);

    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .ilike('username', `%${searchTerm}%`)
      .neq('id', user?.id)
      .limit(10);

    if (data) {
      setSearchResults(data as Profile[]);
    }
    setIsSearching(false);
  };

  const sendFriendRequest = async (friendId: string) => {
    if (!user) return;

    const { data: existing } = await supabase
      .from('friendships')
      .select('*')
      .or(`and(user_id.eq.${user.id},friend_id.eq.${friendId}),and(user_id.eq.${friendId},friend_id.eq.${user.id})`)
      .single();

    if (existing) {
      toast({
        title: 'Already Connected',
        description: 'A friend request already exists with this user.',
        variant: 'destructive',
      });
      return;
    }

    const { error } = await supabase
      .from('friendships')
      .insert({
        user_id: user.id,
        friend_id: friendId,
        status: 'pending',
      });

    if (error) {
      toast({
        title: 'Error',
        description: 'Failed to send friend request.',
        variant: 'destructive',
      });
    } else {
      toast({
        title: 'Request Sent',
        description: 'Friend request sent successfully!',
      });
      setSearchResults([]);
      setSearchTerm('');
      fetchFriends();
    }
  };

  const respondToRequest = async (friendshipId: string, accept: boolean) => {
    const { error } = await supabase
      .from('friendships')
      .update({ status: accept ? 'accepted' : 'rejected' })
      .eq('id', friendshipId);

    if (error) {
      toast({
        title: 'Error',
        description: 'Failed to respond to request.',
        variant: 'destructive',
      });
    } else {
      toast({
        title: accept ? 'Friend Added' : 'Request Declined',
        description: accept ? 'You are now friends!' : 'Friend request declined.',
      });
      fetchFriends();
    }
  };

  const removeFriend = async (friendshipId: string) => {
    const { error } = await supabase
      .from('friendships')
      .delete()
      .eq('id', friendshipId);

    if (error) {
      toast({
        title: 'Error',
        description: 'Failed to remove friend.',
        variant: 'destructive',
      });
    } else {
      toast({
        title: 'Friend Removed',
        description: 'Friend has been removed.',
      });
      fetchFriends();
    }
  };

  if (loading || !canFriend) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => setLocation('/')} data-testid="button-back">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Users className="w-6 h-6 text-primary" />
              Friends
            </h1>
            <p className="text-muted-foreground">Connect with other VSteps users</p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserPlus className="w-5 h-5" />
              Add Friend
            </CardTitle>
            <CardDescription>Search for users by username</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search username..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && searchUsers()}
                  className="pl-10"
                  data-testid="input-search-friends"
                />
              </div>
              <Button onClick={searchUsers} disabled={isSearching} data-testid="button-search">
                Search
              </Button>
            </div>
            {searchResults.length > 0 && (
              <div className="mt-4 space-y-2">
                {searchResults.map((result) => (
                  <div key={result.id} className="flex items-center justify-between p-3 border rounded-lg">
                    <div className="flex items-center gap-3">
                      <Avatar>
                        <AvatarImage src={result.avatar_url || undefined} alt={result.username} />
                        <AvatarFallback>{result.username?.slice(0, 2).toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <span className="font-medium">{result.username}</span>
                    </div>
                    <Button size="sm" onClick={() => sendFriendRequest(result.id)} data-testid={`button-add-${result.id}`}>
                      <UserPlus className="w-4 h-4 mr-2" />
                      Add
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Tabs defaultValue="friends">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="friends" data-testid="tab-friends">
              Friends ({friends.length})
            </TabsTrigger>
            <TabsTrigger value="pending" data-testid="tab-pending">
              Pending ({pendingReceived.length})
            </TabsTrigger>
            <TabsTrigger value="sent" data-testid="tab-sent">
              Sent ({pendingSent.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="friends" className="mt-4">
            <Card>
              <CardContent className="pt-6">
                {isLoading ? (
                  <div className="text-center py-8 text-muted-foreground">Loading friends...</div>
                ) : friends.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Users className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>No friends yet. Start searching to add some!</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {friends.map((friend) => (
                      <div key={friend.id} className="flex items-center justify-between p-4 border rounded-lg" data-testid={`friend-${friend.id}`}>
                        <div className="flex items-center gap-3">
                          <Avatar>
                            <AvatarImage src={friend.profile.avatar_url || undefined} alt={friend.profile.username} />
                            <AvatarFallback>{friend.profile.username?.slice(0, 2).toUpperCase()}</AvatarFallback>
                          </Avatar>
                          <div>
                            <div className="font-medium">{friend.profile.username}</div>
                            <div className="flex items-center gap-3 text-sm text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <Footprints className="w-3 h-3" />
                                {friend.stats?.total_steps?.toLocaleString() || 0} steps
                              </span>
                              <span className="flex items-center gap-1">
                                <Zap className="w-3 h-3" />
                                Lvl {friend.stats ? calculateLevel(friend.stats.xp) : 1}
                              </span>
                            </div>
                            {friend.stats?.last_played && (
                              <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                                <Clock className="w-3 h-3" />
                                Last played: {new Date(friend.stats.last_played).toLocaleDateString()}
                              </div>
                            )}
                          </div>
                        </div>
                        <Button variant="ghost" size="icon" onClick={() => removeFriend(friend.id)} data-testid={`button-remove-${friend.id}`}>
                          <UserMinus className="w-4 h-4 text-muted-foreground" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="pending" className="mt-4">
            <Card>
              <CardContent className="pt-6">
                {pendingReceived.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">No pending requests</div>
                ) : (
                  <div className="space-y-3">
                    {pendingReceived.map((request) => (
                      <div key={request.id} className="flex items-center justify-between p-4 border rounded-lg">
                        <div className="flex items-center gap-3">
                          <Avatar>
                            <AvatarImage src={request.profile.avatar_url || undefined} alt={request.profile.username} />
                            <AvatarFallback>{request.profile.username?.slice(0, 2).toUpperCase()}</AvatarFallback>
                          </Avatar>
                          <span className="font-medium">{request.profile.username}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button size="sm" onClick={() => respondToRequest(request.id, true)} data-testid={`button-accept-${request.id}`}>
                            <Check className="w-4 h-4" />
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => respondToRequest(request.id, false)} data-testid={`button-reject-${request.id}`}>
                            <X className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="sent" className="mt-4">
            <Card>
              <CardContent className="pt-6">
                {pendingSent.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">No sent requests</div>
                ) : (
                  <div className="space-y-3">
                    {pendingSent.map((request) => (
                      <div key={request.id} className="flex items-center justify-between p-4 border rounded-lg">
                        <div className="flex items-center gap-3">
                          <Avatar>
                            <AvatarImage src={request.profile.avatar_url || undefined} alt={request.profile.username} />
                            <AvatarFallback>{request.profile.username?.slice(0, 2).toUpperCase()}</AvatarFallback>
                          </Avatar>
                          <span className="font-medium">{request.profile.username}</span>
                        </div>
                        <Badge variant="secondary">
                          <Clock className="w-3 h-3 mr-1" />
                          Pending
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
