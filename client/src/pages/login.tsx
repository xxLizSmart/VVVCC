import { useState, useCallback, useEffect } from 'react';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { LogIn, UserPlus, Mail, Lock, Loader2 } from 'lucide-react';
import vstepsLogo from '@assets/VSteps_LOGO_1769337913003.png';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [mounted, setMounted] = useState(false);
  const [, setLocation] = useLocation();
  const { signIn, user, loading: authLoading } = useAuth();
  const { toast } = useToast();

  // Smooth mount animation
  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), 50);
    return () => clearTimeout(timer);
  }, []);

  // Redirect if already logged in
  useEffect(() => {
    if (!authLoading && user) {
      setLocation('/controller');
    }
  }, [user, authLoading, setLocation]);

  const validateEmail = useCallback((email: string) => {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
  }, []);

  const handleEmailChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setEmail(value);
    // Clear error immediately when typing, validate on blur
    if (emailError) setEmailError('');
  }, [emailError]);

  const handleEmailBlur = useCallback(() => {
    if (email && !validateEmail(email)) {
      setEmailError('Please enter a valid email address');
    }
  }, [email, validateEmail]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateEmail(email)) {
      setEmailError('Please enter a valid email address');
      return;
    }

    if (password.length < 6) {
      toast({
        title: 'Invalid Password',
        description: 'Password must be at least 6 characters',
        variant: 'destructive',
      });
      return;
    }

    setIsLoading(true);
    
    try {
      const { error } = await signIn(email, password);

      if (error) {
        toast({
          title: 'Login Failed',
          description: error.message,
          variant: 'destructive',
        });
      } else {
        toast({
          title: 'Welcome back!',
          description: 'Redirecting to controller...',
        });
        // Immediate redirect for better UX
        setLocation('/controller');
      }
    } catch (err) {
      toast({
        title: 'Connection Error',
        description: 'Please check your internet connection',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  }, [email, password, signIn, toast, setLocation, validateEmail]);

  // Show loading state while checking auth
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#0B0C10' }}>
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 text-red-500 animate-spin" />
          <p className="text-gray-400 text-sm">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden" style={{ backgroundColor: '#0B0C10' }}>
      {/* Subtle Red Radial Glow - Top Right */}
      <div 
        className="absolute top-0 right-0 w-[500px] h-[500px] opacity-[0.08] pointer-events-none"
        style={{
          background: 'radial-gradient(circle at center, #FF0000 0%, transparent 60%)',
          transform: 'translate(30%, -30%)',
        }}
      />

      {/* Glassmorphism Card with smooth fade-in */}
      <div 
        className={`relative w-full max-w-md p-8 rounded-2xl border border-white/10 backdrop-blur-md transition-all duration-500 ${
          mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
        }`}
        style={{
          background: 'linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(0,0,0,0.2) 100%)',
        }}
      >
        {/* Logo with Subtle Glow */}
        <div className="flex flex-col items-center mb-8">
          <div 
            className={`w-20 h-20 rounded-2xl flex items-center justify-center mb-4 overflow-hidden transition-all duration-700 ${
              mounted ? 'scale-100 opacity-100' : 'scale-90 opacity-0'
            }`}
            style={{
              boxShadow: '0 0 20px rgba(255,0,0,0.25)',
            }}
          >
            <img src={vstepsLogo} alt="VSteps" className="w-full h-full object-cover" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-white">
            VSteps
          </h1>
          <p className="text-xs uppercase tracking-widest text-gray-400 mt-2">
            Step Into The Game
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="email" className="text-gray-300 uppercase text-xs tracking-wider font-medium">
              Email
            </Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <Input
                id="email"
                type="email"
                placeholder="player@vsteps.io"
                value={email}
                onChange={handleEmailChange}
                onBlur={handleEmailBlur}
                required
                autoComplete="email"
                className="pl-10 bg-white/5 border-white/10 text-white placeholder:text-gray-500 focus:ring-2 focus:ring-red-600 focus:border-transparent h-12 transition-all duration-200"
                data-testid="input-email"
              />
            </div>
            <div className={`transition-all duration-200 overflow-hidden ${emailError ? 'max-h-6 opacity-100' : 'max-h-0 opacity-0'}`}>
              <p className="text-red-500 text-xs" data-testid="text-email-error">{emailError}</p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="password" className="text-gray-300 uppercase text-xs tracking-wider font-medium">
              Password
            </Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <Input
                id="password"
                type="password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="pl-10 bg-white/5 border-white/10 text-white placeholder:text-gray-500 focus:ring-2 focus:ring-red-600 focus:border-transparent h-12 transition-all duration-200"
                data-testid="input-password"
              />
            </div>
          </div>

          <Button 
            type="submit" 
            className="w-full h-14 text-lg font-bold uppercase tracking-wider transition-all duration-300 hover:scale-[1.02] active:scale-[0.98]"
            style={{
              backgroundColor: isLoading ? '#991b1b' : '#FF0000',
              color: 'white',
              boxShadow: isLoading ? 'none' : '0 0 12px rgba(255,0,0,0.25)',
            }}
            disabled={isLoading || !email || !password}
            data-testid="button-login"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                Signing in...
              </>
            ) : (
              <>
                <LogIn className="w-5 h-5 mr-2" />
                Sign In
              </>
            )}
          </Button>
        </form>

        <div className="mt-6 text-center">
          <p className="text-sm text-gray-400">
            Don't have an account?{' '}
            <button
              onClick={() => setLocation('/signup')}
              className="font-semibold transition-all duration-200 hover:brightness-125"
              style={{ color: '#FF0000' }}
              data-testid="link-signup"
            >
              <UserPlus className="w-3 h-3 inline mr-1" />
              Sign up free
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
