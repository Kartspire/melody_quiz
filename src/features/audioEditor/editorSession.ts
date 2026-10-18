import { createEvent, createStore } from 'effector';
import { useUnit } from 'effector-react';
import { $audioProjects, $mediaTracks } from '../../model/core/state';
import { persistedStateImported } from '../../model/app/storage';
import type { AudioProject, AudioTimeRange } from '../../model/types';
import { audioProjectDeleted } from './model';

export type EditorSession = {
  selectedClipIds: string[]; activeClipId: string | null; selectedLaneId: string | null;
  zoom: number; playheadMs: number; range: AudioTimeRange | null; loop: boolean;
};
export const emptyEditorSession: EditorSession = {
  selectedClipIds: [], activeClipId: null, selectedLaneId: null, zoom: 36,
  playheadMs: 0, range: null, loop: false,
};
export const editorProjectSelected = createEvent<string | null>();
export const $editorProjectId = createStore<string | null>(null).on(editorProjectSelected, (_, id) => id).reset(persistedStateImported);
export const editorSessionChanged = createEvent<{ id: string; patch: Partial<EditorSession> }>();
export const $editorSessions = createStore<Record<string, EditorSession>>({})
  .on(editorSessionChanged, (all, { id, patch }) => ({ ...all, [id]: { ...(all[id] ?? emptyEditorSession), ...patch } }))
  .on(audioProjectDeleted, (all, id) => Object.fromEntries(Object.entries(all).filter(([key]) => key !== id)))
  .reset(persistedStateImported);

type HistoryEntry = { past: AudioProject[]; future: AudioProject[] };
const historyChanged = createEvent<{ id: string; entry?: HistoryEntry }>();
const historyReset = createEvent();
export const $editorHistory = createStore<Record<string, HistoryEntry>>({})
  .on(historyChanged, (all, { id, entry }) => entry ? { ...all, [id]: entry } : Object.fromEntries(Object.entries(all).filter(([key]) => key !== id)))
  .on(audioProjectDeleted, (all, id) => Object.fromEntries(Object.entries(all).filter(([key]) => key !== id)))
  .reset(persistedStateImported, historyReset);

// Source replacement changes the meaning of old offsets, even while unmounted.
let previousTracks = $mediaTracks.getState();
$mediaTracks.watch((tracks) => {
  if (previousTracks.some((old) => !tracks.some((track) => track.id === old.id && track.audioId === old.audioId))) historyReset();
  previousTracks = tracks;
});

export function cloneAudioProject(project: AudioProject): AudioProject {
  return { ...project, markers: project.markers?.map((marker) => ({ ...marker })),
    ranges: project.ranges?.map((range) => ({ ...range })),
    lanes: project.lanes.map((lane) => ({ ...lane, clips: lane.clips.map((clip) => ({ ...clip })) })),
  };
}
export const editorHistory = {
  push(snapshot: AudioProject) {
    const entry = $editorHistory.getState()[snapshot.id] ?? { past: [], future: [] };
    historyChanged({ id: snapshot.id, entry: { past: [...entry.past, cloneAudioProject(snapshot)].slice(-100), future: [] } });
  },
  undo(current: AudioProject) { return travel(current, 'past'); },
  redo(current: AudioProject) { return travel(current, 'future'); },
  clear(id: string) { historyChanged({ id }); },
  status(id?: string | null) {
    const entry = id ? $editorHistory.getState()[id] : undefined;
    return { canUndo: Boolean(entry?.past.length), canRedo: Boolean(entry?.future.length) };
  },
};
function travel(current: AudioProject, direction: 'past' | 'future') {
  const entry = $editorHistory.getState()[current.id];
  const next = entry?.[direction].at(-1);
  if (!entry || !next || !$audioProjects.getState().some((p) => p.id === current.id)) return null;
  const opposite = direction === 'past' ? 'future' : 'past';
  historyChanged({ id: current.id, entry: { ...entry, [direction]: entry[direction].slice(0, -1), [opposite]: [...entry[opposite], cloneAudioProject(current)].slice(-100) } });
  return cloneAudioProject(next);
}
export function useAudioEditorHistory() {
  useUnit($editorHistory);
  return editorHistory;
}
