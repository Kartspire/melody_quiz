import { useRef, useState } from 'react';
import type { AudioProject } from '../../model/types';

const MAX_HISTORY = 100;

type HistoryEntry = {
  past: AudioProject[];
  future: AudioProject[];
};

export function useAudioEditorHistory() {
  const historyRef = useRef<Record<string, HistoryEntry>>({});
  const [, forceRender] = useState(0);

  const push = (snapshot: AudioProject) => {
    const entry = historyRef.current[snapshot.id] ?? { past: [], future: [] };
    entry.past.push(cloneProject(snapshot));
    if (entry.past.length > MAX_HISTORY) entry.past.shift();
    entry.future = [];
    historyRef.current[snapshot.id] = entry;
    forceRender((value) => value + 1);
  };

  const undo = (current: AudioProject): AudioProject | null => {
    const entry = historyRef.current[current.id];
    const previous = entry?.past.pop();
    if (!entry || !previous) return null;
    entry.future.push(cloneProject(current));
    forceRender((value) => value + 1);
    return cloneProject(previous);
  };

  const redo = (current: AudioProject): AudioProject | null => {
    const entry = historyRef.current[current.id];
    const next = entry?.future.pop();
    if (!entry || !next) return null;
    entry.past.push(cloneProject(current));
    forceRender((value) => value + 1);
    return cloneProject(next);
  };

  const clear = (projectId: string) => {
    delete historyRef.current[projectId];
    forceRender((value) => value + 1);
  };

  const status = (projectId?: string | null) => {
    const entry = projectId ? historyRef.current[projectId] : undefined;
    return { canUndo: Boolean(entry?.past.length), canRedo: Boolean(entry?.future.length) };
  };

  return { push, undo, redo, clear, status };
}

export function cloneAudioProject(project: AudioProject): AudioProject {
  return cloneProject(project);
}

function cloneProject(project: AudioProject): AudioProject {
  return {
    ...project,
    markers: project.markers?.map((marker) => ({ ...marker })),
    lanes: project.lanes.map((lane) => ({ ...lane, clips: lane.clips.map((clip) => ({ ...clip })) })),
  };
}
