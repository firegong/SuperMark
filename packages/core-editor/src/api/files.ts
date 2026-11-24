import { CreateFileOptions, DirectoryType, FileInfo, FileObject, MoveFileOptions } from 'markedit-api';

export async function openFile(path: string): Promise<boolean> {
  return window.nativeModules.api.openFile({ path });
}

export async function createFile(options: CreateFileOptions): Promise<boolean> {
  return window.nativeModules.api.createFile({ options });
}

export async function deleteFile(path: string): Promise<boolean> {
  return window.nativeModules.api.deleteFile({ path });
}

export async function moveFile(options: MoveFileOptions): Promise<boolean> {
  return window.nativeModules.api.moveFile({ options });
}

export async function revealFile(path?: string): Promise<boolean> {
  return window.nativeModules.api.revealFile({ path });
}

export async function listFiles(path: string): Promise<string[] | undefined> {
  return window.nativeModules.api.listFiles({ path });
}

export async function getFileContent(path?: string): Promise<string | undefined> {
  return window.nativeModules.api.getFileContent({ path });
}

/** Parses a JSON string from the host; `null`/`undefined`/invalid JSON mean "not found". */
function parseHostJson<T>(value: unknown): T | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === 'object' && parsed !== null ? parsed as T : undefined;
  } catch {
    return undefined;
  }
}

export async function getFileObject(path?: string): Promise<FileObject | undefined> {
  return parseHostJson<FileObject>(await window.nativeModules.api.getFileObject({ path }));
}

export async function getFileInfo(path?: string): Promise<FileInfo | undefined> {
  const json = parseHostJson<{
    filePath: string;
    fileSize: number;
    creationDate: number;
    modificationDate: number;
    parentPath: string;
    isDirectory: boolean;
  }>(await window.nativeModules.api.getFileInfo({ path }));
  return json === undefined ? undefined : {
    filePath: json.filePath,
    fileSize: json.fileSize,
    creationDate: new Date(json.creationDate * 1000),
    modificationDate: new Date(json.modificationDate * 1000),
    parentPath: json.parentPath,
    isDirectory: json.isDirectory,
  };
}

export function getDirectoryPath(type: DirectoryType): string {
  return window.config.standardDirectories[type];
}
