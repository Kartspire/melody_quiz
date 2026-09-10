import { createEvent } from 'effector';
import { $audioProjects } from '../../model/core/state';
import type { AudioProject } from '../../model/types';

export const audioProjectAdded = createEvent<AudioProject>();
export const audioProjectReplaced = createEvent<AudioProject>();
export const audioProjectDeleted = createEvent<string>();

$audioProjects
  .on(audioProjectAdded, (projects, project) => projects.some((item) => item.id === project.id) ? projects : [...projects, project])
  .on(audioProjectReplaced, (projects, project) => projects.map((item) => item.id === project.id ? project : item))
  .on(audioProjectDeleted, (projects, projectId) => projects.filter((project) => project.id !== projectId));
