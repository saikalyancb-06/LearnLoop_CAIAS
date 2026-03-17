import { createBrowserRouter } from "react-router";
import { RootLayout } from "./components/RootLayout";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { PublicOnlyRoute } from "./components/PublicOnlyRoute";
import { LoginPage } from "./pages/LoginPage";
import { SignupPage } from "./pages/SignupPage";
import { Dashboard } from "./pages/Dashboard";
import { DocumentsExplorer } from "./pages/DocumentsExplorer";
import { DocumentWorkspace } from "./pages/DocumentWorkspace";
import { FlashcardsPage } from "./pages/FlashcardsPage";
import { FeynmanMode } from "./pages/FeynmanMode";
import { FeynmanResults } from "./pages/FeynmanResults";
import { ProgressAnalytics } from "./pages/ProgressAnalytics";
import { SettingsPage } from "./pages/SettingsPage";

export const router = createBrowserRouter([
  {
    Component: PublicOnlyRoute,
    children: [
      {
        path: "/login",
        Component: LoginPage,
      },
      {
        path: "/signup",
        Component: SignupPage,
      },
    ],
  },
  {
    Component: ProtectedRoute,
    children: [
      {
        path: "/",
        Component: RootLayout,
        children: [
          { index: true, Component: Dashboard },
          { path: "notes", Component: DocumentsExplorer },
          { path: "notes/:documentId", Component: DocumentWorkspace },
          { path: "notes/:documentId/feynman", Component: FeynmanMode },
          { path: "notes/:documentId/feynman/:sessionId/results", Component: FeynmanResults },
          { path: "flashcards", Component: FlashcardsPage },
          { path: "flashcards/:deckId", Component: FlashcardsPage },
          { path: "analytics", Component: ProgressAnalytics },
          { path: "settings", Component: SettingsPage },
        ],
      },
    ],
  },
]);
