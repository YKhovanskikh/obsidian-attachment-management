import { App, TFile, normalizePath } from "obsidian";
import { AttachmentManagementPluginSettings } from "../settings/settings";
import { md5sum, sha256sum } from "../utils";
import { debugLog } from "./log";
import { path } from "./path";

export interface NameObj {
  name: string;
  basename: string;
  extension: string;
}

export interface DeduplicateNameResult extends NameObj {
  duplicateOf?: TFile;
}

// ref: https://stackoverflow.com/a/6969486/596206
function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toNameObj(name: string): NameObj {
  const extension = path.extname(name);
  const basename = name.slice(0, name.length - extension.length - 1);

  return {
    name,
    basename,
    extension,
  };
}

function getSha256ComparisonLimitBytes(settings: AttachmentManagementPluginSettings): number {
  if (settings.deduplicateSha256MaxSizeMb <= 0) {
    return Number.POSITIVE_INFINITY;
  }

  return settings.deduplicateSha256MaxSizeMb * 1024 * 1024;
}

async function isDuplicateAttachment(
  app: App,
  settings: AttachmentManagementPluginSettings,
  incomingFile: TFile,
  existingFile: TFile
): Promise<boolean> {
  const adapter = app.vault.adapter;
  const incomingMd5 = await md5sum(adapter, incomingFile);
  const existingMd5 = await md5sum(adapter, existingFile);

  if (incomingMd5 === "" || existingMd5 === "" || incomingMd5 !== existingMd5) {
    return false;
  }

  if (incomingFile.stat.size !== existingFile.stat.size) {
    return false;
  }

  if (incomingFile.stat.size > getSha256ComparisonLimitBytes(settings)) {
    debugLog(
      "deduplicateNewName - skipped sha256 comparison due to size limit:",
      incomingFile.path,
      existingFile.path,
      incomingFile.stat.size,
      settings.deduplicateSha256MaxSizeMb
    );
    return false;
  }

  const incomingSha256 = await sha256sum(adapter, incomingFile);
  const existingSha256 = await sha256sum(adapter, existingFile);

  return incomingSha256 !== "" && incomingSha256 === existingSha256;
}

export async function deduplicateNewName(
  app: App,
  settings: AttachmentManagementPluginSettings,
  newName: string,
  dir: string,
  incomingFile: TFile
): Promise<DeduplicateNameResult> {
  const listed = await app.vault.adapter.list(dir);
  debugLog("deduplicateNewName - sibling files", listed);

  const newNameObj = toNameObj(newName);
  const newNameStemEscaped = escapeRegExp(newNameObj.basename);
  const newNameExtensionEscaped = escapeRegExp(newNameObj.extension);
  const delimiter = "-";
  const delimiterEscaped = escapeRegExp(delimiter);

  const dupNameRegex = new RegExp(
    `^(?<name>${newNameStemEscaped})${delimiterEscaped}(?<number>\\d{1,3})\\.${newNameExtensionEscaped}$`
  );

  debugLog("dupNameRegex", dupNameRegex);

  const dupNameNumbers: number[] = [];
  let isNewNameExist = false;

  for (let siblingPath of listed.files) {
    siblingPath = path.basename(siblingPath);
    if (siblingPath === newName) {
      isNewNameExist = true;
      continue;
    }

    const match = dupNameRegex.exec(siblingPath);
    if (!match?.groups?.number) {
      continue;
    }

    dupNameNumbers.push(parseInt(match.groups.number, 10));
  }

  if (!isNewNameExist) {
    return newNameObj;
  }

  const existingPath = normalizePath(path.join(dir, newName));
  const existingFile = app.vault.getAbstractFileByPath(existingPath);
  if (existingFile instanceof TFile && existingFile.path !== incomingFile.path) {
    const duplicate = await isDuplicateAttachment(app, settings, incomingFile, existingFile);
    if (duplicate) {
      debugLog("deduplicateNewName - found duplicate attachment:", incomingFile.path, existingFile.path);
      return {
        ...toNameObj(existingFile.name),
        duplicateOf: existingFile,
      };
    }
  }

  const newNumber = dupNameNumbers.length > 0 ? Math.max(...dupNameNumbers) + 1 : 1;
  const deduplicatedName = `${newNameObj.basename}${delimiter}${newNumber}.${newNameObj.extension}`;

  return toNameObj(deduplicatedName);
}
