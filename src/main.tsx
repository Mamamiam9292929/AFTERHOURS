import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { AppErrorBoundary, SetupScreen } from "@/app/errors";
import { router } from "@/app/router";
import { ToastProvider } from "@/components/ui/Toast";
import { AuthProvider } from "@/features/auth/AuthProvider";
import { PollDraftProvider } from "@/features/polls/draft";
import { queryClient } from "@/lib/query";
import { isSupabaseConfigured } from "@/lib/supabase";
import "@/styles/index.css";

const root = document.getElementById("root");
if (!root) throw new Error("Root element missing");

createRoot(root).render(
  <StrictMode>
    <AppErrorBoundary>
      {isSupabaseConfigured ? (
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <ToastProvider>
              <PollDraftProvider>
                <RouterProvider router={router} future={{ v7_startTransition: true }} />
              </PollDraftProvider>
            </ToastProvider>
          </AuthProvider>
        </QueryClientProvider>
      ) : (
        <SetupScreen />
      )}
    </AppErrorBoundary>
  </StrictMode>,
);
