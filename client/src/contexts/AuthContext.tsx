import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase, Profile, UserStats, canUseFeatures, canAddFriends } from '@/lib/supabase';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  stats: UserStats | null;
  loading: boolean;
  signUp: (email: string, password: string, username: string) => Promise<{ error: Error | null }>;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  refreshStats: () => Promise<void>;
  canUse: boolean;
  canFriend: boolean;
  isAdmin: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();
      
      if (error) {
        console.error('Error fetching profile:', error);
      }
      if (data) {
        setProfile(data as Profile);
      }
      return data;
    } catch (err) {
      console.error('Network error fetching profile:', err);
      return null;
    }
  };

  const fetchStats = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('user_stats')
        .select('*')
        .eq('user_id', userId)
        .single();
      
      if (error) {
        console.error('Error fetching stats:', error);
      }
      if (data) {
        setStats(data as UserStats);
      }
      return data;
    } catch (err) {
      console.error('Network error fetching stats:', err);
      return null;
    }
  };

  const refreshProfile = async () => {
    if (user) {
      await fetchProfile(user.id);
    }
  };

  const refreshStats = async () => {
    if (user) {
      await fetchStats(user.id);
    }
  };

  useEffect(() => {
    const initAuth = async () => {
      try {
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Auth timeout')), 10000)
        );
        
        const sessionPromise = supabase.auth.getSession();
        
        const { data: { session } } = await Promise.race([
          sessionPromise,
          timeoutPromise
        ]) as { data: { session: Session | null } };
        
        setSession(session);
        setUser(session?.user ?? null);
        
        if (session?.user) {
          await Promise.all([
            fetchProfile(session.user.id),
            fetchStats(session.user.id)
          ]).catch(err => {
            console.error('Error fetching profile/stats:', err);
          });
        }
      } catch (err) {
        console.error('Auth initialization error:', err);
        setSession(null);
        setUser(null);
      } finally {
        setLoading(false);
      }
    };
    
    initAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          setLoading(false);
          await Promise.all([
            fetchProfile(session.user.id),
            fetchStats(session.user.id)
          ]).catch(console.error);
        } else {
          setProfile(null);
          setStats(null);
          setLoading(false);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const signUp = async (email: string, password: string, username: string) => {
    try {
      const response = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, username }),
      });

      const data = await response.json();

      if (!response.ok) {
        return { error: new Error(data.error || 'Signup failed') };
      }

      const { error: signInError, data: signInData } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) {
        return { error: signInError };
      }

      if (signInData?.user) {
        setUser(signInData.user);
        setSession(signInData.session);
        await Promise.all([
          fetchProfile(signInData.user.id),
          fetchStats(signInData.user.id)
        ]).catch(console.error);
      }

      return { error: null };
    } catch (err) {
      console.error('Signup error:', err);
      return { error: new Error('Network error. Please check your connection and try again.') };
    }
  };

  const signIn = async (email: string, password: string) => {
    try {
      const { error, data } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (!error && data?.user) {
        setUser(data.user);
        setSession(data.session);
        await Promise.all([
          fetchProfile(data.user.id),
          fetchStats(data.user.id)
        ]).catch(console.error);
      }
      return { error };
    } catch (err) {
      console.error('Sign in error:', err);
      return { error: new Error('Network error. Please try again.') };
    }
  };

  const signInWithGoogle = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/`,
      },
    });
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setProfile(null);
    setStats(null);
  };

  const canUse = canUseFeatures(profile);
  const canFriend = canAddFriends(profile);
  const isAdmin = profile?.account_type === 'ADMIN';

  return (
    <AuthContext.Provider value={{
      user,
      session,
      profile,
      stats,
      loading,
      signUp,
      signIn,
      signInWithGoogle,
      signOut,
      refreshProfile,
      refreshStats,
      canUse,
      canFriend,
      isAdmin,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
