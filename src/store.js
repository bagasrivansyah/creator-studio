/**
 * Project persistence.
 *
 * Primary store: Firestore (`projects` collection, scoped per anonymous uid).
 * Fallback: localStorage, used automatically when Firebase is not configured
 * or Firestore is unreachable (e.g. offline). The UI always says which store
 * a project was saved to.
 */
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { getFirestoreDb, isConfigured } from "./firebase.js";

const LOCAL_KEY = "creator-studio-projects-v1";

function readLocal() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) || "[]");
  } catch {
    return [];
  }
}

function writeLocal(projects) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(projects));
  } catch {
    /* storage full / unavailable — saving silently degrades */
  }
}

export async function saveProject(uid, project) {
  const record = {
    ...project,
    uid: uid || "local",
    updatedAtLabel: new Date().toLocaleString(),
  };

  if (isConfigured && uid) {
    try {
      const db = getFirestoreDb();
      const ref = await addDoc(collection(db, "projects"), {
        ...record,
        createdAt: serverTimestamp(),
      });
      return { id: ref.id, store: "firestore" };
    } catch (err) {
      console.warn("[creator-studio] Firestore save failed, using local:", err);
    }
  }

  const local = readLocal();
  const id = `local-${Date.now()}`;
  local.unshift({ ...record, id, createdAt: Date.now() });
  writeLocal(local.slice(0, 20));
  return { id, store: "local" };
}

export async function listProjects(uid) {
  if (isConfigured && uid) {
    try {
      const db = getFirestoreDb();
      // NOTE: no orderBy here — a where(uid) + orderBy(createdAt) query needs
      // a composite index that may not exist in the project (Firestore
      // returns FAILED_PRECONDITION "The query requires an index").
      // Query by uid only (single-field, always indexed) and sort
      // client-side instead.
      const q = query(
        collection(db, "projects"),
        where("uid", "==", uid),
        limit(20)
      );
      const snap = await getDocs(q);
      const remote = snap.docs
        .map((d) => ({ id: d.id, ...d.data(), store: "firestore" }))
        .sort((a, b) => {
          const ta = a.createdAt?.toMillis?.() ?? a.createdAt ?? 0;
          const tb = b.createdAt?.toMillis?.() ?? b.createdAt ?? 0;
          return tb - ta;
        });
      // Merge in any local-only projects (saved while offline).
      return [...remote, ...readLocal().map((p) => ({ ...p, store: "local" }))];
    } catch (err) {
      console.warn("[creator-studio] Firestore list failed, using local:", err);
    }
  }
  return readLocal().map((p) => ({ ...p, store: "local" }));
}

export async function deleteProject(project) {
  if (project.store === "firestore" && isConfigured) {
    try {
      await deleteDoc(doc(getFirestoreDb(), "projects", project.id));
      return true;
    } catch (err) {
      console.warn("[creator-studio] Firestore delete failed:", err);
      return false;
    }
  }
  writeLocal(readLocal().filter((p) => p.id !== project.id));
  return true;
}
