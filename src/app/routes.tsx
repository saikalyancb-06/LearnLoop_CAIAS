import { Suspense, lazy } from "react";
import { createBrowserRouter } from "react-router";

const RootLayout = lazy(() =>
  import("./components/RootLayout").then((module) => ({ default: module.RootLayout })),
);
const ProtectedRoute = lazy(() =>
  import("./components/ProtectedRoute").then((module) => ({ default: module.ProtectedRoute })),
);
const PublicOnlyRoute = lazy(() =>
  import("./components/PublicOnlyRoute").then((module) => ({ default: module.PublicOnlyRoute })),
);
const LoginPage = lazy(() =>
  import("./pages/LoginPage").then((module) => ({ default: module.LoginPage })),
);
const SignupPage = lazy(() =>
  import("./pages/SignupPage").then((module) => ({ default: module.SignupPage })),
);
const Dashboard = lazy(() =>
  import("./pages/Dashboard").then((module) => ({ default: module.Dashboard })),
);
const DocumentsExplorer = lazy(() =>
  import("./pages/DocumentsExplorer").then((module) => ({ default: module.DocumentsExplorer })),
);
const DocumentWorkspace = lazy(() =>
  import("./pages/DocumentWorkspace").then((module) => ({ default: module.DocumentWorkspace })),
);
const FlashcardsPage = lazy(() =>
  import("./pages/FlashcardsPage").then((module) => ({ default: module.FlashcardsPage })),
);
const FeynmanMode = lazy(() =>
  import("./pages/FeynmanMode").then((module) => ({ default: module.FeynmanMode })),
);
const FeynmanResults = lazy(() =>
  import("./pages/FeynmanResults").then((module) => ({ default: module.FeynmanResults })),
);
const ProgressAnalytics = lazy(() =>
  import("./pages/ProgressAnalytics").then((module) => ({ default: module.ProgressAnalytics })),
);
const SettingsPage = lazy(() =>
  import("./pages/SettingsPage").then((module) => ({ default: module.SettingsPage })),
);

function RouteLoader() {
  return <div className="p-8 text-sm text-gray-500">Loading...</div>;
}

function withSuspense(Component: React.ComponentType) {
  return function SuspendedRouteComponent() {
    return (
      <Suspense fallback={<RouteLoader />}>
        <Component />
      </Suspense>
    );
  };
}

export const router = createBrowserRouter([
  {
    Component: withSuspense(PublicOnlyRoute),
    children: [
      {
        path: "/login",
        Component: withSuspense(LoginPage),
      },
      {
        path: "/signup",
        Component: withSuspense(SignupPage),
      },
    ],
  },
  {
    Component: withSuspense(ProtectedRoute),
    children: [
      {
        path: "/",
        Component: withSuspense(RootLayout),
        children: [
          { index: true, Component: withSuspense(Dashboard) },
          { path: "notes", Component: withSuspense(DocumentsExplorer) },
          { path: "notes/:documentId", Component: withSuspense(DocumentWorkspace) },
          { path: "notes/:documentId/feynman", Component: withSuspense(FeynmanMode) },
          { path: "notes/:documentId/feynman/:sessionId/results", Component: withSuspense(FeynmanResults) },
          { path: "flashcards", Component: withSuspense(FlashcardsPage) },
          { path: "flashcards/:deckId", Component: withSuspense(FlashcardsPage) },
          { path: "analytics", Component: withSuspense(ProgressAnalytics) },
          { path: "settings", Component: withSuspense(SettingsPage) },
        ],
      },
    ],
  },
]);
