import { useEffect, useState } from "react";
import type { Project, UserAccount, UserRole } from "@my-planner/core";
import {
  ApiRequestError,
  createUser,
  deleteUser,
  listProjects,
  listUsers,
  updateUser,
} from "../api";
import { useI18n } from "../i18n";

interface UsersModalProps {
  currentUserId: string;
  projects: Project[];
  onClose: () => void;
  onChanged: () => void;
}

interface UserFormState {
  username: string;
  password: string;
  role: UserRole;
  projectIds: string[];
}

const EMPTY_FORM: UserFormState = {
  username: "",
  password: "",
  role: "manager",
  projectIds: [],
};

/**
 * Gestione utenti riservata agli admin: elenco, creazione con ruolo e
 * progetti, modifica di ruolo/progetti/password e cancellazione.
 */
export function UsersModal({ currentUserId, projects, onClose, onChanged }: UsersModalProps) {
  const { t } = useI18n();
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [allProjects, setAllProjects] = useState<Project[]>(projects);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<UserFormState | null>(null);
  const [editing, setEditing] = useState<UserAccount | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadUsers() {
    try {
      setUsers(await listUsers());
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof ApiRequestError ? err.message : t.users.loadError);
    }
  }

  useEffect(() => {
    loadUsers();
    // Include anche i progetti archiviati: un manager potrebbe essere gia'
    // associato a un progetto archiviato e non vogliamo perderlo in modifica.
    listProjects(true)
      .then(setAllProjects)
      .catch(() => setAllProjects(projects));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startCreate() {
    setEditing(null);
    setError(null);
    setForm({ ...EMPTY_FORM, projectIds: [] });
  }

  function startEdit(user: UserAccount) {
    setEditing(user);
    setError(null);
    setForm({
      username: user.username,
      password: "",
      role: user.role,
      projectIds: [...user.projectIds],
    });
  }

  function cancelForm() {
    setForm(null);
    setEditing(null);
    setError(null);
  }

  function toggleProject(projectId: string) {
    setForm((current) => {
      if (!current) return current;
      const selected = current.projectIds.includes(projectId)
        ? current.projectIds.filter((id) => id !== projectId)
        : [...current.projectIds, projectId];
      return { ...current, projectIds: selected };
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setError(null);
    if (form.role === "manager" && form.projectIds.length === 0) {
      setError(t.users.managerNeedsProject);
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await updateUser(editing.id, {
          role: form.role,
          projectIds: form.role === "manager" ? form.projectIds : [],
          password: form.password ? form.password : undefined,
        });
      } else {
        await createUser({
          username: form.username.trim(),
          password: form.password,
          role: form.role,
          projectIds: form.role === "manager" ? form.projectIds : undefined,
        });
      }
      await loadUsers();
      cancelForm();
      onChanged();
    } catch (err) {
      setError(
        err instanceof ApiRequestError
          ? err.message
          : editing
            ? t.users.saveError
            : t.users.createError,
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(user: UserAccount) {
    if (!window.confirm(t.users.deleteConfirm.replace("{username}", user.username))) return;
    setError(null);
    try {
      await deleteUser(user.id);
      if (editing?.id === user.id) cancelForm();
      await loadUsers();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t.users.deleteError);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal settings-modal users-modal" onClick={(e) => e.stopPropagation()}>
        <h2>{t.users.title}</h2>

        {!form && (
          <div className="users-toolbar">
            <button type="button" onClick={startCreate}>
              {t.users.newUser}
            </button>
          </div>
        )}

        {loadError && <p className="login-error">{loadError}</p>}

        {form && (
          <form className="user-form" onSubmit={handleSubmit}>
            <h3>{editing ? t.users.editUser : t.users.newUser}</h3>
            <label>
              {t.users.username}
              <input
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                required
                autoFocus={!editing}
                disabled={!!editing}
                maxLength={100}
                autoComplete="off"
              />
            </label>
            <label>
              {editing ? t.users.newPassword : t.users.password}
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required={!editing}
                minLength={8}
                autoComplete="new-password"
              />
            </label>
            <label>
              {t.users.role}
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value as UserRole })}
              >
                <option value="manager">{t.users.roleManager}</option>
                <option value="admin">{t.users.roleAdmin}</option>
              </select>
            </label>

            {form.role === "admin" ? (
              <p className="user-form-hint">{t.users.adminHint}</p>
            ) : (
              <div className="user-projects">
                <span className="field-label">{t.users.projects}</span>
                <p className="user-form-hint">{t.users.managerHint}</p>
                {allProjects.length === 0 ? (
                  <p className="user-form-hint">{t.users.noProjectsAvailable}</p>
                ) : (
                  <div className="user-project-list">
                    {allProjects.map((project) => (
                      <label key={project.id} className="user-project-option">
                        <input
                          type="checkbox"
                          checked={form.projectIds.includes(project.id)}
                          onChange={() => toggleProject(project.id)}
                        />
                        <span>
                          {project.name}
                          {project.archived ? ` (${t.users.archived})` : ""}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}

            {error && <p className="login-error">{error}</p>}

            <div className="modal-actions">
              <button type="button" onClick={cancelForm} disabled={saving}>
                {t.users.cancel}
              </button>
              <button type="submit" disabled={saving}>
                {saving ? t.users.saving : editing ? t.users.save : t.users.create}
              </button>
            </div>
          </form>
        )}

        {!form && (
          <div className="user-list">
            {users.length === 0 && !loadError && <p className="user-form-hint">{t.users.empty}</p>}
            {users.map((user) => (
              <div key={user.id} className="user-row">
                <div className="user-row-main">
                  <div className="user-row-name">
                    <strong>{user.username}</strong>
                    {user.id === currentUserId && (
                      <span className="user-you">{t.users.currentUser}</span>
                    )}
                    <span className={`role-badge role-${user.role}`}>
                      {user.role === "admin" ? t.users.roleAdmin : t.users.roleManager}
                    </span>
                  </div>
                  <div className="user-row-projects">
                    {user.role === "admin"
                      ? t.users.allProjects
                      : user.projects.length > 0
                        ? user.projects.map((p) => p.name).join(", ")
                        : t.users.noProjects}
                  </div>
                </div>
                <div className="user-row-actions">
                  <button type="button" onClick={() => startEdit(user)}>
                    {t.users.edit}
                  </button>
                  {user.id !== currentUserId && (
                    <button type="button" className="danger-button" onClick={() => handleDelete(user)}>
                      {t.users.delete}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {!form && (
          <div className="modal-actions">
            <button type="button" onClick={onClose}>
              {t.users.close}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
