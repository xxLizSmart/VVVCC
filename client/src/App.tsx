import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import StepController from "@/pages/step-controller";
import Dashboard from "@/pages/dashboard";
import Login from "@/pages/login";
import Signup from "@/pages/signup";
import Admin from "@/pages/admin";
import Leaderboard from "@/pages/leaderboard";
import Friends from "@/pages/friends";
import Trophies from "@/pages/trophies";
import PVP from "@/pages/pvp";
import ApexGate from "@/pages/apex-gate";
// Apex Gate is now called Omni internally but file name kept for compatibility
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/controller" component={StepController} />
      <Route path="/apex-gate" component={ApexGate} />
      <Route path="/login" component={Login} />
      <Route path="/signup" component={Signup} />
      <Route path="/admin" component={Admin} />
      <Route path="/leaderboard" component={Leaderboard} />
      <Route path="/friends" component={Friends} />
      <Route path="/trophies" component={Trophies} />
      <Route path="/pvp" component={PVP} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <Toaster />
          <Router />
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
