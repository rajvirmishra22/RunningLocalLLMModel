import { useEffect } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Layout from "@/components/Layout";
import Dashboard from "@/pages/Dashboard";
import Chat from "@/pages/Chat";
import Models from "@/pages/Models";
import Tuning from "@/pages/Tuning";
import Settings from "@/pages/Settings";
import KnowledgeBase from "@/pages/KnowledgeBase";
import NotFound from "@/pages/not-found";
import { storageService } from "@/services/storageService";

const queryClient = new QueryClient();

function AppRoutes() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/chat" component={Chat} />
        <Route path="/models" component={Models} />
        <Route path="/tuning" component={Tuning} />
        <Route path="/settings" component={Settings} />
        <Route path="/knowledge-base" component={KnowledgeBase} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  useEffect(() => {
    const saved = localStorage.getItem("lms_theme");
    if (saved === "light") {
      document.documentElement.classList.remove("dark");
    } else {
      document.documentElement.classList.add("dark");
    }
    storageService.seedInitialData();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AppRoutes />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
