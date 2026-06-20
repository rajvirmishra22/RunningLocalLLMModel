import { useEffect } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Layout from "@/components/Layout";
import Home from "@/pages/Home";
import Assignments from "@/pages/Assignments";
import Planner from "@/pages/Planner";
import Grades from "@/pages/Grades";
import Growth from "@/pages/Growth";
import CourseLibrary from "@/pages/CourseLibrary";
import StudySpace from "@/pages/Chat";
import RubricChecker from "@/pages/RubricChecker";
import Models from "@/pages/Models";
import Connections from "@/pages/Connections";
import Privacy from "@/pages/Privacy";
import Settings from "@/pages/Settings";
import NotFound from "@/pages/not-found";
import { storageService } from "@/services/storageService";
import { seedStudyCore } from "@/services/studycore/seed";

const queryClient = new QueryClient();

function AppRoutes() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/assignments/:id" component={Assignments} />
        <Route path="/assignments" component={Assignments} />
        <Route path="/planner" component={Planner} />
        <Route path="/grades" component={Grades} />
        <Route path="/growth" component={Growth} />
        <Route path="/library" component={CourseLibrary} />
        <Route path="/study-space" component={StudySpace} />
        <Route path="/rubric" component={RubricChecker} />
        <Route path="/models" component={Models} />
        <Route path="/connections" component={Connections} />
        <Route path="/privacy" component={Privacy} />
        <Route path="/settings" component={Settings} />
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
    seedStudyCore();
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
