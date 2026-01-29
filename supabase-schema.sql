-- VSteps Supabase Database Schema
-- Run this in the Supabase SQL Editor to create all required tables

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Profiles table (linked to Supabase Auth)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  username TEXT UNIQUE NOT NULL,
  account_type TEXT NOT NULL DEFAULT 'DEMO' CHECK (account_type IN ('DEMO', 'BASIC', 'SUBSCRIBED', 'ADMIN')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  trial_expires_at TIMESTAMP WITH TIME ZONE,
  avatar_url TEXT
);

-- User stats table
CREATE TABLE IF NOT EXISTS user_stats (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  total_steps INTEGER DEFAULT 0,
  level INTEGER DEFAULT 1,
  xp INTEGER DEFAULT 0,
  trophies TEXT[] DEFAULT '{}',
  last_played TIMESTAMP WITH TIME ZONE,
  total_distance_meters NUMERIC DEFAULT 0,
  total_jumps INTEGER DEFAULT 0,
  total_sprints INTEGER DEFAULT 0,
  play_time_minutes INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id)
);

-- Friendships table
CREATE TABLE IF NOT EXISTS friendships (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  friend_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, friend_id)
);

-- Trophies definition table (optional - for admin to manage trophies)
CREATE TABLE IF NOT EXISTS trophy_definitions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  icon TEXT NOT NULL,
  requirement_type TEXT NOT NULL CHECK (requirement_type IN ('steps', 'level', 'friends', 'playtime', 'sprints', 'jumps')),
  requirement_value INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Row Level Security Policies

-- Enable RLS on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE friendships ENABLE ROW LEVEL SECURITY;
ALTER TABLE trophy_definitions ENABLE ROW LEVEL SECURITY;

-- Helper function to check if current user is admin (avoids RLS recursion)
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND account_type = 'ADMIN'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Profiles policies
CREATE POLICY "Users can view all profiles" ON profiles
  FOR SELECT USING (true);

CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile" ON profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Admin can do everything with profiles (uses security definer function to avoid recursion)
CREATE POLICY "Admins can manage all profiles" ON profiles
  FOR ALL USING (public.is_admin());

-- User stats policies
CREATE POLICY "Users can view all stats" ON user_stats
  FOR SELECT USING (true);

CREATE POLICY "Users can update own stats" ON user_stats
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own stats" ON user_stats
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Friendships policies
CREATE POLICY "Users can view their friendships" ON friendships
  FOR SELECT USING (auth.uid() = user_id OR auth.uid() = friend_id);

CREATE POLICY "Users can insert friendships" ON friendships
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update friendships they received" ON friendships
  FOR UPDATE USING (auth.uid() = friend_id);

CREATE POLICY "Users can delete their friendships" ON friendships
  FOR DELETE USING (auth.uid() = user_id OR auth.uid() = friend_id);

-- Trophy definitions are public read
CREATE POLICY "Anyone can view trophy definitions" ON trophy_definitions
  FOR SELECT USING (true);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_profiles_username ON profiles(username);
CREATE INDEX IF NOT EXISTS idx_profiles_account_type ON profiles(account_type);
CREATE INDEX IF NOT EXISTS idx_user_stats_user_id ON user_stats(user_id);
CREATE INDEX IF NOT EXISTS idx_user_stats_total_steps ON user_stats(total_steps DESC);
CREATE INDEX IF NOT EXISTS idx_user_stats_xp ON user_stats(xp DESC);
CREATE INDEX IF NOT EXISTS idx_friendships_user_id ON friendships(user_id);
CREATE INDEX IF NOT EXISTS idx_friendships_friend_id ON friendships(friend_id);
CREATE INDEX IF NOT EXISTS idx_friendships_status ON friendships(status);

-- Insert default trophies
INSERT INTO trophy_definitions (id, name, description, icon, requirement_type, requirement_value) VALUES
  ('first_steps', 'First Steps', 'Take your first 100 steps', 'steps', 'steps', 100),
  ('walker', 'Casual Walker', 'Accumulate 1,000 steps', 'steps', 'steps', 1000),
  ('strider', 'Strider', 'Accumulate 10,000 steps', 'steps', 'steps', 10000),
  ('marathon', 'Marathon Runner', 'Accumulate 50,000 steps', 'steps', 'steps', 50000),
  ('legend', 'Walking Legend', 'Accumulate 100,000 steps', 'steps', 'steps', 100000),
  ('lvl5', 'Rising Star', 'Reach Level 5', 'level', 'level', 5),
  ('lvl10', 'Experienced', 'Reach Level 10', 'level', 'level', 10),
  ('lvl25', 'Veteran', 'Reach Level 25', 'level', 'level', 25),
  ('lvl50', 'Master', 'Reach Level 50', 'level', 'level', 50),
  ('sprinter', 'Sprinter', 'Sprint 100 times', 'sprints', 'sprints', 100),
  ('speed_demon', 'Speed Demon', 'Sprint 1,000 times', 'sprints', 'sprints', 1000),
  ('jumper', 'Bunny Hop', 'Jump 50 times', 'jumps', 'jumps', 50),
  ('kangaroo', 'Kangaroo', 'Jump 500 times', 'jumps', 'jumps', 500),
  ('playtime_1h', 'Dedicated', 'Play for 60 minutes total', 'playtime', 'playtime', 60),
  ('playtime_10h', 'Committed', 'Play for 10 hours total', 'playtime', 'playtime', 600)
ON CONFLICT (id) DO NOTHING;

-- Create a function to automatically create user_stats when a profile is created
CREATE OR REPLACE FUNCTION public.handle_new_profile()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_stats (user_id, total_steps, level, xp, trophies, total_jumps, total_sprints, play_time_minutes)
  VALUES (NEW.id, 0, 1, 0, '{}', 0, 0, 0);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for new profiles
DROP TRIGGER IF EXISTS on_profile_created ON profiles;
CREATE TRIGGER on_profile_created
  AFTER INSERT ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_profile();
