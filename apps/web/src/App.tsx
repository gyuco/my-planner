import { useState } from "react";
import { KanbanBoard } from "./components/KanbanBoard";
import { LoginPage } from "./pages/LoginPage";
import { clearToken, hasValidToken } from "./auth";

// Placeholder: sostituire con fetch autenticato a /api/board una volta pronto
// il collegamento reale alla board dinamica (F3/F4).
const SAMPLE_TASKS = [
  { id: "1", title: "Definire schema Prisma", status: "done" as const },
  { id: "2", title: "Implementare login JWT", status: "in_progress" as const },
  { id: "3", title: "Board drag & drop", status: "draft" as const },
];

export function App() {
  const [loggedIn, setLoggedIn] = useState(hasValidToken());

  if (!loggedIn) {
    return <LoginPage onLoggedIn={() => setLoggedIn(true)} />;
  }

  function handleLogout() {
    clearToken();
    setLoggedIn(false);
  }

  return (
    <div>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "1rem" }}>
        <h1 style={{ margin: 0 }}>my-planner</h1>
        <button onClick={handleLogout}>Logout</button>
      </header>
      <KanbanBoard tasks={SAMPLE_TASKS} />
    </div>
  );
}
