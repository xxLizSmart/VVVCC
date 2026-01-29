import { createClient } from '@supabase/supabase-js';

// Supabase credentials must be set via environment variables in production
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase credentials not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY environment variables.');
}

export const supabase = createClient(supabaseUrl || '', supabaseAnonKey || '');

export type AccountType = 'DEMO' | 'BASIC' | 'SUBSCRIBED' | 'ADMIN';

export interface Profile {
  id: string;
  email: string;
  username: string;
  account_type: AccountType;
  created_at: string;
  trial_expires_at: string | null;
  avatar_url: string | null;
}

export interface UserStats {
  id: string;
  user_id: string;
  total_steps: number;
  level: number;
  xp: number;
  trophies: string[];
  last_played: string | null;
  total_distance_meters: number;
  total_jumps: number;
  total_sprints: number;
  play_time_minutes: number;
}

export interface Friendship {
  id: string;
  user_id: string;
  friend_id: string;
  status: 'pending' | 'accepted' | 'rejected';
  created_at: string;
}

export interface Trophy {
  id: string;
  name: string;
  description: string;
  icon: string;
  requirement_type: 'steps' | 'level' | 'friends' | 'playtime' | 'sprints' | 'jumps';
  requirement_value: number;
}

export function calculateLevel(xp: number): number {
  return Math.floor(Math.sqrt(xp / 100)) + 1;
}

export function xpForNextLevel(currentLevel: number): number {
  return Math.pow(currentLevel, 2) * 100;
}

export function xpProgress(xp: number, level: number): number {
  const currentLevelXp = Math.pow(level - 1, 2) * 100;
  const nextLevelXp = Math.pow(level, 2) * 100;
  return ((xp - currentLevelXp) / (nextLevelXp - currentLevelXp)) * 100;
}

export function isTrialExpired(trialExpiresAt: string | null): boolean {
  if (!trialExpiresAt) return false;
  return new Date(trialExpiresAt) < new Date();
}

export function canUseFeatures(profile: Profile | null): boolean {
  if (!profile) return false;
  if (profile.account_type === 'ADMIN') return true;
  if (profile.account_type === 'SUBSCRIBED') return true;
  if (profile.account_type === 'DEMO') {
    return !isTrialExpired(profile.trial_expires_at);
  }
  return false;
}

export function canAddFriends(profile: Profile | null): boolean {
  if (!profile) return false;
  return profile.account_type === 'SUBSCRIBED' || profile.account_type === 'ADMIN';
}
