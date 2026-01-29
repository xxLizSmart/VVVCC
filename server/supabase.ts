import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

// Validate required environment variables at startup
if (!supabaseUrl || !supabaseServiceKey) {
  console.error('FATAL: SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables are required');
  // Don't exit in production - allow graceful degradation
}

export const supabaseAdmin = createClient(supabaseUrl || '', supabaseServiceKey || '', {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

export async function updateUserStats(
  userId: string,
  updates: {
    steps?: number;
    sprints?: number;
    jumps?: number;
    playTimeMinutes?: number;
  }
) {
  const { data: currentStats, error: fetchError } = await supabaseAdmin
    .from('user_stats')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (fetchError) {
    console.error('Error fetching user stats:', fetchError);
    return null;
  }

  const newSteps = (currentStats?.total_steps || 0) + (updates.steps || 0);
  const newSprints = (currentStats?.total_sprints || 0) + (updates.sprints || 0);
  const newJumps = (currentStats?.total_jumps || 0) + (updates.jumps || 0);
  const newPlayTime = (currentStats?.play_time_minutes || 0) + (updates.playTimeMinutes || 0);
  
  const xpGained = (updates.steps || 0) + (updates.sprints || 0) * 2 + (updates.jumps || 0);
  const newXp = (currentStats?.xp || 0) + xpGained;
  const newLevel = Math.floor(Math.sqrt(newXp / 100)) + 1;

  const { data, error } = await supabaseAdmin
    .from('user_stats')
    .update({
      total_steps: newSteps,
      total_sprints: newSprints,
      total_jumps: newJumps,
      play_time_minutes: newPlayTime,
      xp: newXp,
      level: newLevel,
      last_played: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .select()
    .single();

  if (error) {
    console.error('Error updating user stats:', error);
    return null;
  }

  return data;
}

export async function getUserProfile(userId: string) {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (error) {
    console.error('Error fetching profile:', error);
    return null;
  }

  return data;
}

export async function updateUserProfile(userId: string, updates: Record<string, any>) {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .update(updates)
    .eq('id', userId)
    .select()
    .single();

  if (error) {
    console.error('Error updating profile:', error);
    return null;
  }

  return data;
}

export async function getAllUsers() {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching users:', error);
    return [];
  }

  return data;
}

export async function deleteUser(userId: string) {
  await supabaseAdmin.from('user_stats').delete().eq('user_id', userId);
  await supabaseAdmin.from('friendships').delete().or(`user_id.eq.${userId},friend_id.eq.${userId}`);
  
  const { error } = await supabaseAdmin
    .from('profiles')
    .delete()
    .eq('id', userId);

  if (error) {
    console.error('Error deleting user:', error);
    return false;
  }

  return true;
}

export async function createUser(email: string, password: string, username: string, accountType: string = 'DEMO') {
  try {
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { username }
    });

    if (authError) {
      console.error('Error creating auth user:', authError);
      return { error: authError.message };
    }

    if (!authData.user) {
      return { error: 'Failed to create user' };
    }

    const trialExpires = accountType === 'DEMO' ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() : null;

    const { error: profileError } = await supabaseAdmin.from('profiles').insert({
      id: authData.user.id,
      email: email,
      username: username,
      account_type: accountType,
      trial_expires_at: trialExpires,
    });

    if (profileError) {
      console.error('Error creating profile:', profileError);
      return { error: profileError.message };
    }

    return { success: true, userId: authData.user.id };
  } catch (err) {
    console.error('Create user error:', err);
    return { error: (err as Error).message };
  }
}

export async function createAdminUser(email: string, password: string, username: string) {
  try {
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { username }
    });

    if (authError) {
      console.error('Error creating auth user:', authError);
      return { error: authError.message };
    }

    if (!authData.user) {
      return { error: 'Failed to create user' };
    }

    const { error: profileError } = await supabaseAdmin.from('profiles').insert({
      id: authData.user.id,
      email: email,
      username: username,
      account_type: 'ADMIN',
      trial_expires_at: null,
    });

    if (profileError) {
      console.error('Error creating profile:', profileError);
      return { error: profileError.message };
    }

    return { success: true, userId: authData.user.id };
  } catch (err) {
    console.error('Create admin error:', err);
    return { error: (err as Error).message };
  }
}
