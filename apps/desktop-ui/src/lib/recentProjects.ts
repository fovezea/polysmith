import { invoke } from "@tauri-apps/api/core";

const MAX_RECENT_PROJECTS = 24;

export interface RecentProject {
  path: string;
  name: string;
  updatedAt: number;
  thumbnailDataUrl: string | null;
}

export interface ProjectFolder {
  id: string;
  name: string;
  childFolderIds: string[];
  projectPaths: string[];
}

export interface RecentProjectsDocument {
  version: 3;
  rootFolderIds: string[];
  rootProjectPaths: string[];
  folders: ProjectFolder[];
  projects: RecentProject[];
}

type RecentProjectPayload = {
  path: string;
  name: string;
  updatedAt: number;
  thumbnailDataUrl: string | null;
};

const EMPTY_RECENT_PROJECTS_DOCUMENT: RecentProjectsDocument = {
  version: 3,
  rootFolderIds: [],
  rootProjectPaths: [],
  folders: [],
  projects: [],
};

export function projectNameFromPath(path: string): string {
  const fileName = path.split(/[\\/]/).pop() ?? path;
  return fileName.replace(/\.[^.]+$/, "") || fileName || "Untitled";
}

function normalizeRecentProject(entry: unknown): RecentProject | null {
  if (entry === null || typeof entry !== "object") {
    return null;
  }
  const record = entry as Partial<RecentProjectPayload>;
  if (
    typeof record.path !== "string" ||
    (record.name !== undefined && typeof record.name !== "string") ||
    (record.updatedAt !== undefined && typeof record.updatedAt !== "number") ||
    (typeof record.thumbnailDataUrl !== "string" &&
      record.thumbnailDataUrl !== null &&
      record.thumbnailDataUrl !== undefined)
  ) {
    return null;
  }
  return {
    path: record.path,
    name: record.name ?? projectNameFromPath(record.path),
    updatedAt: record.updatedAt ?? 0,
    thumbnailDataUrl: record.thumbnailDataUrl ?? null,
  };
}

function uniqueProjectPaths(paths: unknown[], allowedPaths: Set<string>) {
  const seen = new Set<string>();
  return paths.filter((path): path is string => {
    if (typeof path !== "string" || !allowedPaths.has(path) || seen.has(path)) {
      return false;
    }
    seen.add(path);
    return true;
  });
}

function uniqueFolderIds(paths: unknown[], allowedIds: Set<string>, selfId?: string) {
  const seen = new Set<string>();
  return paths.filter((path): path is string => {
    if (
      typeof path !== "string" ||
      path === selfId ||
      !allowedIds.has(path) ||
      seen.has(path)
    ) {
      return false;
    }
    seen.add(path);
    return true;
  });
}

function normalizeProjectFolders(
  folders: unknown,
  allowedPaths: Set<string>,
): ProjectFolder[] {
  if (!Array.isArray(folders)) {
    return [];
  }
  const usedFolderIds = new Set<string>();
  return folders.flatMap((entry) => {
    if (entry === null || typeof entry !== "object") {
      return [];
    }
    const record = entry as Partial<ProjectFolder>;
    if (
      typeof record.id !== "string" ||
      typeof record.name !== "string" ||
      usedFolderIds.has(record.id)
    ) {
      return [];
    }
    usedFolderIds.add(record.id);
    return [
      {
        id: record.id,
        name: record.name.trim(),
        childFolderIds: [],
        projectPaths: uniqueProjectPaths(
          Array.isArray(record.projectPaths) ? record.projectPaths : [],
          allowedPaths,
        ),
      },
    ];
  });
}

function normalizeRecentProjectsDocument(
  payload: unknown,
): RecentProjectsDocument {
  const rawProjects = Array.isArray(payload)
    ? payload
    : payload !== null &&
        typeof payload === "object" &&
        Array.isArray((payload as { projects?: unknown }).projects)
      ? (payload as { projects: unknown[] }).projects
      : [];
  const projects = rawProjects
    .map(normalizeRecentProject)
    .filter((project): project is RecentProject => project !== null)
    .slice(0, MAX_RECENT_PROJECTS);
  const allowedPaths = new Set(projects.map((project) => project.path));

  if (Array.isArray(payload)) {
    return {
      version: 3,
      rootFolderIds: [],
      rootProjectPaths: projects.map((project) => project.path),
      folders: [],
      projects,
    };
  }

  const record =
    payload !== null && typeof payload === "object"
      ? (payload as {
          folders?: unknown;
          rootFolderIds?: unknown;
          rootProjectPaths?: unknown;
        })
      : {};
  const folders = normalizeProjectFolders(record.folders, allowedPaths);
  const allowedFolderIds = new Set(folders.map((folder) => folder.id));
  const foldersWithChildren = folders.map((folder) => {
    const source = Array.isArray(record.folders)
      ? record.folders.find(
          (entry) =>
            entry !== null &&
            typeof entry === "object" &&
            (entry as Partial<ProjectFolder>).id === folder.id,
        )
      : null;
    return {
      ...folder,
      childFolderIds: uniqueFolderIds(
        source !== null &&
          typeof source === "object" &&
          Array.isArray((source as { childFolderIds?: unknown }).childFolderIds)
          ? (source as { childFolderIds: unknown[] }).childFolderIds
          : [],
        allowedFolderIds,
        folder.id,
      ),
    };
  });
  const nestedFolderIds = new Set<string>();
  for (const folder of foldersWithChildren) {
    for (const childId of folder.childFolderIds) {
      nestedFolderIds.add(childId);
    }
  }
  const rootFolderIds = uniqueFolderIds(
    Array.isArray(record.rootFolderIds)
      ? record.rootFolderIds
      : foldersWithChildren
          .filter((folder) => !nestedFolderIds.has(folder.id))
          .map((folder) => folder.id),
    allowedFolderIds,
  );
  const assignedPaths = new Set<string>();
  for (const folder of foldersWithChildren) {
    for (const path of folder.projectPaths) {
      assignedPaths.add(path);
    }
  }
  const rootProjectPaths = uniqueProjectPaths(
    Array.isArray(record.rootProjectPaths) ? record.rootProjectPaths : [],
    allowedPaths,
  );
  for (const path of rootProjectPaths) {
    assignedPaths.add(path);
  }
  for (const project of projects) {
    if (!assignedPaths.has(project.path)) {
      rootProjectPaths.push(project.path);
    }
  }

  return {
    version: 3,
    rootFolderIds,
    rootProjectPaths,
    folders: foldersWithChildren,
    projects,
  };
}

export async function loadRecentProjects(): Promise<RecentProjectsDocument> {
  const payload = await invoke<unknown>("load_recent_projects");
  return normalizeRecentProjectsDocument(payload);
}

export async function saveRecentProjects(document: RecentProjectsDocument) {
  const projects = document.projects.slice(0, MAX_RECENT_PROJECTS);
  const knownPaths = new Set(projects.map((project) => project.path));
  await invoke("save_recent_projects", {
    document: {
      ...document,
      version: 3,
      rootFolderIds: document.rootFolderIds.filter((folderId) =>
        document.folders.some((folder) => folder.id === folderId),
      ),
      rootProjectPaths: document.rootProjectPaths.filter((path) =>
        knownPaths.has(path),
      ),
      folders: document.folders.map((folder) => ({
        ...folder,
        childFolderIds: folder.childFolderIds.filter((folderId) =>
          document.folders.some((candidate) => candidate.id === folderId),
        ),
        projectPaths: folder.projectPaths.filter((path) => knownPaths.has(path)),
      })),
      projects,
    },
  });
}

export async function readProjectThumbnail(
  filePath: string,
): Promise<string | null> {
  return invoke<string | null>("read_project_thumbnail", { filePath });
}

export async function writeProjectThumbnail(
  filePath: string,
  thumbnailDataUrl: string | null,
) {
  await invoke("write_project_thumbnail", {
    filePath,
    thumbnailDataUrl,
  });
}

export async function deleteProjectFile(filePath: string) {
  await invoke("delete_project_file", { filePath });
}

export async function projectFileExists(filePath: string): Promise<boolean> {
  return invoke<boolean>("project_file_exists", { filePath });
}

function projectFolderId() {
  return `folder-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createProjectFolder(
  document: RecentProjectsDocument,
  name: string,
  parentFolderId: string | null,
): RecentProjectsDocument {
  if (
    parentFolderId !== null &&
    !document.folders.some((folder) => folder.id === parentFolderId)
  ) {
    return document;
  }
  const nextFolder: ProjectFolder = {
    id: projectFolderId(),
    name: name.trim(),
    childFolderIds: [],
    projectPaths: [],
  };
  return {
    ...document,
    rootFolderIds:
      parentFolderId === null
        ? [...document.rootFolderIds, nextFolder.id]
        : document.rootFolderIds,
    folders: [
      ...document.folders.map((folder) =>
        folder.id === parentFolderId
          ? {
              ...folder,
              childFolderIds: [...folder.childFolderIds, nextFolder.id],
            }
          : folder,
      ),
      nextFolder,
    ],
  };
}

function removeProjectFromAllLocations(
  document: RecentProjectsDocument,
  projectPath: string,
) {
  return {
    rootProjectPaths: document.rootProjectPaths.filter(
      (path) => path !== projectPath,
    ),
    folders: document.folders.map((folder) => ({
      ...folder,
      projectPaths: folder.projectPaths.filter((path) => path !== projectPath),
    })),
  };
}

export function moveProjectToFolder(
  document: RecentProjectsDocument,
  projectPath: string,
  folderId: string | null,
): RecentProjectsDocument {
  const projectExists = document.projects.some(
    (project) => project.path === projectPath,
  );
  if (!projectExists) {
    return document;
  }
  if (
    folderId !== null &&
    !document.folders.some((folder) => folder.id === folderId)
  ) {
    return document;
  }
  const withoutProject = removeProjectFromAllLocations(document, projectPath);
  if (folderId === null) {
    return {
      ...document,
      rootProjectPaths: [projectPath, ...withoutProject.rootProjectPaths],
      folders: withoutProject.folders,
    };
  }
  return {
    ...document,
    rootProjectPaths: withoutProject.rootProjectPaths,
    folders: withoutProject.folders.map((folder) =>
      folder.id === folderId
        ? {
            ...folder,
            projectPaths: [...folder.projectPaths, projectPath],
          }
        : folder,
    ),
  };
}

export function renameRecentProject(
  document: RecentProjectsDocument,
  projectPath: string,
  name: string,
): RecentProjectsDocument {
  const nextName = name.trim();
  if (nextName.length === 0) {
    return document;
  }
  return {
    ...document,
    projects: document.projects.map((project) =>
      project.path === projectPath ? { ...project, name: nextName } : project,
    ),
  };
}

export function renameProjectFolder(
  document: RecentProjectsDocument,
  folderId: string,
  name: string,
): RecentProjectsDocument {
  const nextName = name.trim();
  if (nextName.length === 0) {
    return document;
  }
  return {
    ...document,
    folders: document.folders.map((folder) =>
      folder.id === folderId ? { ...folder, name: nextName } : folder,
    ),
  };
}

export function deleteProjectFolder(
  document: RecentProjectsDocument,
  folderId: string,
): RecentProjectsDocument {
  const folderToDelete = document.folders.find((folder) => folder.id === folderId);
  if (!folderToDelete) {
    return document;
  }
  const parentFolder = document.folders.find((folder) =>
    folder.childFolderIds.includes(folderId),
  );
  const spliceChildFolders = (folderIds: string[]) => {
    const index = folderIds.indexOf(folderId);
    if (index === -1) {
      return folderIds;
    }
    return [
      ...folderIds.slice(0, index),
      ...folderToDelete.childFolderIds,
      ...folderIds.slice(index + 1),
    ];
  };
  return {
    ...document,
    rootFolderIds:
      parentFolder === undefined
        ? spliceChildFolders(document.rootFolderIds)
        : document.rootFolderIds,
    rootProjectPaths:
      parentFolder === undefined
        ? [...folderToDelete.projectPaths, ...document.rootProjectPaths]
        : document.rootProjectPaths,
    folders: document.folders
      .filter((folder) => folder.id !== folderId)
      .map((folder) => {
        if (folder.id !== parentFolder?.id) {
          return folder;
        }
        return {
          ...folder,
          childFolderIds: spliceChildFolders(folder.childFolderIds),
          projectPaths: [...folderToDelete.projectPaths, ...folder.projectPaths],
        };
      }),
  };
}

export function removeProjectFromRecentProjects(
  document: RecentProjectsDocument,
  projectPath: string,
): RecentProjectsDocument {
  const withoutProject = removeProjectFromAllLocations(document, projectPath);
  return {
    ...document,
    rootProjectPaths: withoutProject.rootProjectPaths,
    folders: withoutProject.folders,
    projects: document.projects.filter((project) => project.path !== projectPath),
  };
}

export function upsertRecentProject(
  document: RecentProjectsDocument,
  nextProject: Omit<RecentProject, "name" | "updatedAt"> &
    Partial<Pick<RecentProject, "name" | "updatedAt">> & {
      parentFolderId?: string | null;
    },
): RecentProjectsDocument {
  const normalized: RecentProject = {
    path: nextProject.path,
    name: nextProject.name ?? projectNameFromPath(nextProject.path),
    updatedAt: nextProject.updatedAt ?? Date.now(),
    thumbnailDataUrl: nextProject.thumbnailDataUrl ?? null,
  };
  const projects = [
    normalized,
    ...document.projects.filter((project) => project.path !== normalized.path),
  ].slice(0, MAX_RECENT_PROJECTS);
  const knownPaths = new Set(projects.map((project) => project.path));
  const folders = document.folders.map((folder) => ({
    ...folder,
    projectPaths: folder.projectPaths.filter((path) => knownPaths.has(path)),
  }));
  const hasExplicitParent =
    nextProject.parentFolderId === null ||
    (typeof nextProject.parentFolderId === "string" &&
      document.folders.some((folder) => folder.id === nextProject.parentFolderId));
  const isAlreadyPlaced =
    document.rootProjectPaths.includes(normalized.path) ||
    folders.some((folder) => folder.projectPaths.includes(normalized.path));
  let rootProjectPaths = document.rootProjectPaths.filter((path) =>
    knownPaths.has(path),
  );
  let nextFolders = folders;

  if (hasExplicitParent) {
    const withoutProject = removeProjectFromAllLocations(
      {
        ...document,
        folders,
        rootProjectPaths,
      },
      normalized.path,
    );
    rootProjectPaths = withoutProject.rootProjectPaths;
    nextFolders = withoutProject.folders;
    if (nextProject.parentFolderId === null) {
      rootProjectPaths.unshift(normalized.path);
    } else {
      nextFolders = nextFolders.map((folder) =>
        folder.id === nextProject.parentFolderId
          ? {
              ...folder,
              projectPaths: [normalized.path, ...folder.projectPaths],
            }
          : folder,
      );
    }
  } else if (!isAlreadyPlaced) {
    rootProjectPaths.unshift(normalized.path);
  }

  return {
    version: 3,
    rootFolderIds: document.rootFolderIds.filter((folderId) =>
      nextFolders.some((folder) => folder.id === folderId),
    ),
    rootProjectPaths,
    folders: nextFolders,
    projects,
  };
}
