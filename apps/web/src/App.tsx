import { KanbanBoard } from "./components/KanbanBoard";

// Placeholder: sostituire con fetch autenticato a /api/board una volta pronto login+API
const SAMPLE_TASKS = [
  { id: "1", title: "Definire schema Prisma", status: "done" as const },
  { id: "2", title: "Implementare login JWT", status: "in_progress" as const },
  { id: "3", title: "Board drag & drop", status: "draft" as const },
];

export function App() {
  return (
    <div>
      <h1 style={{ padding: "1rem 1rem 0" }}>my-planner</h1>
      <KanbanBoard tasks={SAMPLE_TASKS} />
    </div>
  );
}
