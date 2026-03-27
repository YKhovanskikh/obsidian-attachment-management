import { App, Notice, Plugin, TFile, parseLinktext } from "obsidian";
import { path } from "./lib/path";
import { debugLog } from "./lib/log";
import { getOverrideSetting } from "./override";
import { md5sum, isAttachment, isCanvasFile, isMarkdownFile } from "./utils";
import { LinkMatch, getAllLinkMatchesInFile } from "./lib/linkDetector";
import { AttachmentManagementPluginSettings, AttachmentPathSettings } from "./settings/settings";
import { SETTINGS_VARIABLES_DATES, SETTINGS_VARIABLES_NOTENAME } from "./lib/constant";
import { deduplicateNewName } from "./lib/deduplicate";
import { getMetadata } from "./settings/metadata";
import { getActiveFile } from "./commons";
import { isExcluded } from "./exclude";
import { containOriginalNameVariable, loadOriginalName } from "./lib/originalStorage";
import { t } from "./i18n";

const bannerRegex = /!\[\[(.*?)\]\]/i;
const PROGRESS_NOTICE_THROTTLE_MS = 250;

export enum RearrangeType {
  ACTIVE,
  LINKS,
  FILE,
}

interface RearrangeProgressState {
  phase: "scan" | "arrange";
  totalFiles: number;
  scannedFiles: number;
  totalNotes: number;
  processedNotes: number;
  totalLinks: number;
  processedLinks: number;
  movedLinks: number;
  deduplicatedLinks: number;
}

export interface RearrangeStats {
  totalFilesScanned: number;
  totalNotes: number;
  processedNotes: number;
  totalLinks: number;
  processedLinks: number;
  movedLinks: number;
  deduplicatedLinks: number;
  deletedDuplicateFiles: number;
  unchangedLinks: number;
  skippedLinks: number;
  durationMs: number;
}

class RearrangeProgressNotice {
  notice: Notice;
  state: RearrangeProgressState;
  lastRenderAt: number;

  constructor() {
    this.state = {
      phase: "scan",
      totalFiles: 0,
      scannedFiles: 0,
      totalNotes: 0,
      processedNotes: 0,
      totalLinks: 0,
      processedLinks: 0,
      movedLinks: 0,
      deduplicatedLinks: 0,
    };
    this.notice = new Notice(this.renderMessage(), 0);
    this.lastRenderAt = Date.now();
  }

  update(partial: Partial<RearrangeProgressState>, force = false) {
    this.state = { ...this.state, ...partial };

    const now = Date.now();
    if (!force && now - this.lastRenderAt < PROGRESS_NOTICE_THROTTLE_MS) {
      return;
    }

    this.notice.setMessage(this.renderMessage());
    this.lastRenderAt = now;
  }

  hide() {
    this.notice.hide();
  }

  renderMessage(): string {
    if (this.state.phase === "scan") {
      return t("notifications.arrangeProgressScan", {
        scannedFiles: this.state.scannedFiles,
        totalFiles: this.state.totalFiles,
      });
    }

    return t("notifications.arrangeProgressRun", {
      processedNotes: this.state.processedNotes,
      totalNotes: this.state.totalNotes,
      processedLinks: this.state.processedLinks,
      totalLinks: this.state.totalLinks,
      movedLinks: this.state.movedLinks,
      deduplicatedLinks: this.state.deduplicatedLinks,
    });
  }
}

export class ArrangeHandler {
  settings: AttachmentManagementPluginSettings;
  app: App;
  plugin: Plugin;

  constructor(settings: AttachmentManagementPluginSettings, app: App, plugin: Plugin) {
    this.settings = settings;
    this.app = app;
    this.plugin = plugin;
  }

  /**
   * Rearranges attachments that are linked by markdown or canvas.
   * Only rearranges attachments if autoRenameAttachment is enabled in settings.
   *
   * @param {RearrangeType} type - The type of attachments to rearrange.
   * @param {TFile} file - The file to which the attachments are linked (optional), if the type was "file", thi should be provided.
   * @param {string} oldPath - The old path of the file (optional), used for rename event.
   */
  async rearrangeAttachment(type: RearrangeType, file?: TFile, oldPath?: string): Promise<RearrangeStats> {
    const progress = type === RearrangeType.LINKS ? new RearrangeProgressNotice() : undefined;
    const startedAt = Date.now();
    let totalFilesScanned = 0;
    let totalNotes = 0;
    let totalLinks = 0;
    let processedNotes = 0;
    let processedLinks = 0;
    let movedLinks = 0;
    let deduplicatedLinks = 0;
    let deletedDuplicateFiles = 0;
    let unchangedLinks = 0;
    let skippedLinks = 0;

    try {
      // only rearrange attachment that linked by markdown or canvas
      const scanStats = { totalFilesScanned: 0 };
      const attachments = await this.getAttachmentsInVault(this.settings, type, file, oldPath, progress, scanStats);
      totalFilesScanned = scanStats.totalFilesScanned;
      debugLog("rearrangeAttachment - attachments:", Object.keys(attachments).length, Object.entries(attachments));
      const duplicateCandidates = new Set<string>();
      const notePaths = Object.keys(attachments).filter((obNote) => {
        const innerFile = this.app.vault.getAbstractFileByPath(obNote);
        return innerFile instanceof TFile && !isAttachment(this.settings, innerFile, this.app);
      });
      totalNotes = notePaths.length;
      totalLinks = this.countAttachmentLinks(attachments, notePaths);

      progress?.update(
        {
          phase: "arrange",
          totalNotes,
          totalLinks,
          processedNotes,
          processedLinks,
          movedLinks,
          deduplicatedLinks,
        },
        true
      );

      for (const obNote of notePaths) {
        try {
          const innerFile = this.app.vault.getAbstractFileByPath(obNote);
          if (!(innerFile instanceof TFile) || isAttachment(this.settings, innerFile, this.app)) {
            debugLog(`rearrangeAttachment - ${obNote} not exists or is attachment, skipped`);
            continue;
          }
          const { setting } = getOverrideSetting(this.settings, innerFile);

          if (attachments[obNote].size == 0) {
            continue;
          }

          // create attachment path if it's not exists
          const md = getMetadata(obNote);
          const attachPath = md.getAttachmentPath(setting, this.settings.dateFormat);
          if (!(await this.app.vault.adapter.exists(attachPath, true))) {
            // process the case where rename the filename to uppercase or lowercase
            if (oldPath != undefined && (await this.app.vault.adapter.exists(attachPath, false))) {
              const mdOld = getMetadata(oldPath);
              const attachPathOld = mdOld.getAttachmentPath(setting, this.settings.dateFormat);
              // this will trigger the rename event and cause the path of attachment change
              this.app.vault.adapter.rename(attachPathOld, attachPath);
            } else {
              await this.app.vault.adapter.mkdir(attachPath);
            }
          }

          for (let link of attachments[obNote]) {
            try {
              try {
                link = decodeURI(link);
              } catch (err) {
                console.log(`Invalid link: ${link}, err: ${err}`);
                skippedLinks += 1;
                continue;
              }
              debugLog(`rearrangeAttachment - article: ${obNote} links: ${link}`);
              const linkFile = this.app.vault.getAbstractFileByPath(link);
              if (linkFile === null || !(linkFile instanceof TFile)) {
                debugLog(`${link} not exists, skipped`);
                skippedLinks += 1;
                continue;
              }

              const metadata = getMetadata(obNote, linkFile);
              const md5 = await md5sum(this.app.vault.adapter, linkFile);
              const originalName = loadOriginalName(this.settings, setting, linkFile.extension, md5);
              debugLog("rearrangeAttachment - original name:", originalName);

              let attachName = "";
              if (containOriginalNameVariable(setting, linkFile.extension)) {
                attachName = await metadata.getAttachFileName(
                  setting,
                  this.settings.dateFormat,
                  originalName?.n ?? "",
                  this.app.vault.adapter,
                  path.basename(link, path.extname(link))
                );
              } else {
                attachName = await metadata.getAttachFileName(
                  setting,
                  this.settings.dateFormat,
                  path.basename(link, path.extname(link)),
                  this.app.vault.adapter
                );
              }

              // ignore if the path was equal to the link
              if (attachPath == path.dirname(link) && attachName === path.basename(link, path.extname(link))) {
                unchangedLinks += 1;
                continue;
              }

              const { name, duplicateOf } = await deduplicateNewName(
                this.app,
                this.settings,
                attachName + "." + path.extname(link),
                attachPath,
                linkFile
              );
              if (duplicateOf) {
                const updated = await this.replaceAttachmentReferenceInSource(innerFile, linkFile, duplicateOf);
                if (updated) {
                  duplicateCandidates.add(linkFile.path);
                  deduplicatedLinks += 1;
                }
                continue;
              }

              debugLog("rearrangeAttachment - deduplicated name:", name);
              const oldPath = linkFile.path;
              const oldMarkdownLink = this.app.fileManager.generateMarkdownLink(linkFile, innerFile.path);
              const newPath = path.join(attachPath, name);

              await this.app.fileManager.renameFile(linkFile, newPath);
              await this.updateSourceReferenceAfterRename(innerFile, oldPath, oldMarkdownLink, newPath);
              movedLinks += 1;
            } finally {
              processedLinks += 1;
              progress?.update({
                phase: "arrange",
                processedLinks,
                movedLinks,
                deduplicatedLinks,
              });
            }
          }
        } finally {
          processedNotes += 1;
          progress?.update({
            phase: "arrange",
            processedNotes,
            processedLinks,
            movedLinks,
            deduplicatedLinks,
          });
        }
      }

      deletedDuplicateFiles = await this.cleanupDuplicateAttachments(duplicateCandidates);
    } finally {
      progress?.hide();
    }

    return {
      totalFilesScanned,
      totalNotes,
      processedNotes,
      totalLinks,
      processedLinks,
      movedLinks,
      deduplicatedLinks,
      deletedDuplicateFiles,
      unchangedLinks,
      skippedLinks,
      durationMs: Date.now() - startedAt,
    };
  }

  /**
   * Retrieves the attachments in the vault based on the specified settings and type.
   * If a file is provided, only attachments related to that file will be returned.
   *
   * @param {AttachmentManagementPluginSettings} settings - The settings for the attachment management plugin.
   * @param {RearrangeType} type - The type of attachments to retrieve.
   * @param {TFile} [file] - The file to filter attachments by. Optional.
   * @return {Promise<Record<string, Set<string>>>} - A promise that resolves to a record of attachments, where each key is a file name and each value is a set of associated attachment names.
   */
  async getAttachmentsInVault(
    settings: AttachmentManagementPluginSettings,
    type: RearrangeType,
    file?: TFile,
    oldPath?: string,
    progress?: RearrangeProgressNotice,
    scanStats?: { totalFilesScanned: number }
  ): Promise<Record<string, Set<string>>> {
    let attachmentsRecord: Record<string, Set<string>> = {};

    attachmentsRecord = await this.getAttachmentsInVaultByLinks(settings, type, file, oldPath, progress, scanStats);

    return attachmentsRecord;
  }

  /**
   * Modified from https://github.com/ozntel/oz-clear-unused-images-obsidian/blob/master/src/util.ts#LL48C21-L48C21
   * Retrieves a record of attachments in the vault based on the given settings and type.
   *
   * @param {AttachmentManagementPluginSettings} settings - The settings for the attachment management plugin.
   * @param {RearrangeType} type - The type of attachments to retrieve.
   * @param {TFile} file - The file to retrieve attachments for (optional).
   * @return {Promise<Record<string, Set<string>>>} - A promise that resolves to a record of attachments.
   */
  async getAttachmentsInVaultByLinks(
    settings: AttachmentManagementPluginSettings,
    type: RearrangeType,
    file?: TFile,
    oldPath?: string,
    progress?: RearrangeProgressNotice,
    scanStats?: { totalFilesScanned: number }
  ): Promise<Record<string, Set<string>>> {
    const attachmentsRecord: Record<string, Set<string>> = {};
    let resolvedLinks: Record<string, Record<string, number>> = {};
    let allFiles: TFile[] = [];
    if (type == RearrangeType.LINKS) {
      // resolvedLinks was not working for canvas file
      resolvedLinks = this.app.metadataCache.resolvedLinks;
      allFiles = this.app.vault.getFiles();
    } else if (type == RearrangeType.ACTIVE) {
      const file = getActiveFile(this.app);
      if (file) {
        if ((file.parent && isExcluded(file.parent.path, this.settings)) || isAttachment(this.settings, file, this.app)) {
          allFiles = [];
          new Notice(t("notifications.fileExcludedSkipped", { path: file.path }));
        } else {
          debugLog("getAttachmentsInVaultByLinks - active:", file.path);
          allFiles = [file];
          if (this.app.metadataCache.resolvedLinks[file.path]) {
            resolvedLinks[file.path] = this.app.metadataCache.resolvedLinks[file.path];
          }
          debugLog("getAttachmentsInVaultByLinks - resolvedLinks:", resolvedLinks);
        }
      }
    } else if (type == RearrangeType.FILE && file != undefined) {
      if ((file.parent && isExcluded(file.parent.path, this.settings)) || isAttachment(this.settings, file, this.app)) {
        allFiles = [];
        new Notice(t("notifications.fileExcludedSkipped", { path: file.path }));
      } else {
        debugLog("getAttachmentsInVaultByLinks - file:", file.path);
        allFiles = [file];
        const rlinks = this.app.metadataCache.resolvedLinks[file.path];
        if (rlinks) {
          debugLog("getAttachmentsInVaultByLinks - rlinks:", rlinks);
          resolvedLinks[file.path] = rlinks;
        } else if (oldPath) {
          debugLog("getAttachmentsInVaultByLinks - oldPath:", oldPath);
          // in some cases, this.app.metadataCache.resolvedLinks[file.path] will be empty since the cache is not updated
          resolvedLinks[file.path] = this.app.metadataCache.resolvedLinks[oldPath];
        }
        debugLog("getAttachmentsInVaultByLinks - resolvedLinks:", resolvedLinks);
      }
    }

    debugLog("getAttachmentsInVaultByLinks - allFiles:", allFiles.length, allFiles);
    if (scanStats) {
      scanStats.totalFilesScanned = allFiles.length;
    }
    progress?.update(
      {
        phase: "scan",
        totalFiles: allFiles.length,
        scannedFiles: 0,
      },
      true
    );

    if (resolvedLinks) {
      for (const [mdFile, links] of Object.entries(resolvedLinks)) {
        const attachmentsSet: Set<string> = new Set();
        if (links) {
          for (const [filePath] of Object.entries(links)) {
            if (isAttachment(settings, filePath, this.app)) {
              this.addToSet(attachmentsSet, filePath);
            }
          }
          this.addToRecord(attachmentsRecord, mdFile, attachmentsSet);
        }
      }
    }
    // Loop Files and Check Frontmatter/Canvas
    for (let i = 0; i < allFiles.length; i++) {
      const obsFile = allFiles[i];
      const attachmentsSet: Set<string> = new Set();

      try {
        if (obsFile.parent && isExcluded(obsFile.parent.path, this.settings)) {
          continue;
        }

        // Check Frontmatter for md files and additional links that might be missed in resolved links
        if (isMarkdownFile(obsFile.extension)) {
          // Frontmatter
          const fileCache = this.app.metadataCache.getFileCache(obsFile);
          if (fileCache === null) {
            continue;
          }
          if (fileCache.frontmatter) {
            const frontmatter = fileCache.frontmatter;
            for (const k of Object.keys(frontmatter)) {
              if (typeof frontmatter[k] === "string") {
                const formatMatch = frontmatter[k].match(bannerRegex);
                if (formatMatch && formatMatch[1]) {
                  const fileName = formatMatch[1];
                  const file = this.app.metadataCache.getFirstLinkpathDest(fileName, obsFile.path);
                  if (file && isAttachment(settings, file.path, this.app)) {
                    this.addToSet(attachmentsSet, file.path);
                  }
                }
              }
            }
          }
          // Any Additional Link
          const linkMatches: LinkMatch[] = await getAllLinkMatchesInFile(obsFile, this.app);
          for (const linkMatch of linkMatches) {
            if (isAttachment(settings, linkMatch.linkText, this.app)) {
              this.addToSet(attachmentsSet, linkMatch.linkText);
            }
          }
        } else if (isCanvasFile(obsFile.extension)) {
          // check canvas for links
          const fileRead = await this.app.vault.cachedRead(obsFile);
          if (!fileRead || fileRead.length === 0) {
            continue;
          }
          let canvasData;
          try {
            canvasData = JSON.parse(fileRead);
          } catch (e) {
            debugLog("getAttachmentsInVaultByLinks - parse canvas data error", e);
            continue;
          }
          // debugLog("canvasData", canvasData);
          if (canvasData.nodes && canvasData.nodes.length > 0) {
            for (const node of canvasData.nodes) {
              // node.type: 'text' | 'file'
              if (node.type === "file") {
                if (isAttachment(settings, node.file, this.app)) {
                  this.addToSet(attachmentsSet, node.file);
                }
              } else if (node.type == "text") {
                const linkMatches: LinkMatch[] = await getAllLinkMatchesInFile(obsFile, this.app, node.text);
                for (const linkMatch of linkMatches) {
                  if (isAttachment(settings, linkMatch.linkText, this.app)) {
                    this.addToSet(attachmentsSet, linkMatch.linkText);
                  }
                }
              }
            }
          }
        }
        this.addToRecord(attachmentsRecord, obsFile.path, attachmentsSet);
      } finally {
        progress?.update({
          phase: "scan",
          scannedFiles: i + 1,
        });
      }
    }
    return attachmentsRecord;
  }

  countAttachmentLinks(attachments: Record<string, Set<string>>, notePaths?: string[]): number {
    const sourcePaths = notePaths ?? Object.keys(attachments);
    return sourcePaths.reduce((total, notePath) => total + (attachments[notePath]?.size ?? 0), 0);
  }

  addToRecord(record: Record<string, Set<string>>, key: string, value: Set<string>) {
    if (record[key] === undefined) {
      record[key] = value;
      return;
    }
    const valueSet = record[key];

    for (const val of value) {
      this.addToSet(valueSet, val);
    }

    record[key] = valueSet;
  }

  addToSet(setObj: Set<string>, value: string) {
    if (!setObj.has(value)) {
      setObj.add(value);
    }
  }

  async replaceAttachmentReferenceInSource(source: TFile, oldAttach: TFile, newAttach: TFile): Promise<boolean> {
    if (isMarkdownFile(source.extension)) {
      const { text, updated } = await this.rewriteAttachmentLinks(source, oldAttach, newAttach);
      if (!updated) {
        return false;
      }

      await this.app.vault.modify(source, text);
      return true;
    }

    if (isCanvasFile(source.extension)) {
      const fileRead = await this.app.vault.cachedRead(source);
      if (!fileRead || fileRead.length === 0) {
        return false;
      }

      let canvasData;
      try {
        canvasData = JSON.parse(fileRead);
      } catch (e) {
        debugLog("replaceAttachmentReferenceInSource - parse canvas data error", e);
        return false;
      }

      let updated = false;
      if (canvasData.nodes && canvasData.nodes.length > 0) {
        for (const node of canvasData.nodes) {
          if (node.type === "file" && node.file === oldAttach.path) {
            node.file = newAttach.path;
            updated = true;
            continue;
          }

          if (node.type === "text" && typeof node.text === "string") {
            const rewritten = await this.rewriteAttachmentLinks(source, oldAttach, newAttach, node.text);
            if (rewritten.updated) {
              node.text = rewritten.text;
              updated = true;
            }
          }
        }
      }

      if (!updated) {
        return false;
      }

      await this.app.vault.modify(source, JSON.stringify(canvasData, null, 2));
      return true;
    }

    return false;
  }

  async updateSourceReferenceAfterRename(source: TFile, oldPath: string, oldMarkdownLink: string, newPath: string) {
    const renamedAttach = this.app.vault.getAbstractFileByPath(newPath);
    if (!(renamedAttach instanceof TFile)) {
      return;
    }

    if (isMarkdownFile(source.extension)) {
      const newMarkdownLink = this.app.fileManager.generateMarkdownLink(renamedAttach, source.path);
      await this.app.vault.process(source, (data) => data.split(oldMarkdownLink).join(newMarkdownLink));
      return;
    }

    if (isCanvasFile(source.extension)) {
      await this.app.vault.process(source, (data) => data.split(oldPath).join(newPath));
    }
  }

  async rewriteAttachmentLinks(
    source: TFile,
    oldAttach: TFile,
    newAttach: TFile,
    fileText?: string
  ): Promise<{ text: string; updated: boolean }> {
    const originalText = fileText ?? (await this.app.vault.read(source));
    const linkMatches = await getAllLinkMatchesInFile(source, this.app, originalText);

    let text = originalText;
    let updated = false;
    for (const linkMatch of linkMatches) {
      if (linkMatch.linkText !== oldAttach.path) {
        continue;
      }

      const replacement = this.buildReplacementLink(source, newAttach, linkMatch);
      if (replacement === linkMatch.match) {
        continue;
      }

      text = text.split(linkMatch.match).join(replacement);
      updated = true;
    }

    return { text, updated };
  }

  buildReplacementLink(source: TFile, newAttach: TFile, linkMatch: LinkMatch): string {
    if (linkMatch.type === "wiki" || linkMatch.type === "wikiTransclusion") {
      const wikiMatch = /^\[\[(.*)\]\]$/.exec(linkMatch.match);
      if (!wikiMatch) {
        return linkMatch.match;
      }

      const body = wikiMatch[1];
      const pipeIndex = body.indexOf("|");
      const rawLinkText = pipeIndex >= 0 ? body.slice(0, pipeIndex) : body;
      const alias = pipeIndex >= 0 ? body.slice(pipeIndex + 1) : undefined;
      const { subpath } = parseLinktext(rawLinkText);
      const newLinkText = this.app.metadataCache.fileToLinktext(newAttach, source.path, false);

      return `[[${newLinkText}${subpath}${alias !== undefined ? `|${alias}` : ""}]]`;
    }

    if (linkMatch.type === "markdown" || linkMatch.type === "mdTransclusion") {
      const markdownMatch = /^\[(.*)\]\((.*)\)$/.exec(linkMatch.match);
      if (!markdownMatch) {
        return linkMatch.match;
      }

      const alias = markdownMatch[1];
      const { subpath } = parseLinktext(markdownMatch[2]);
      const newLinkText = this.app.metadataCache.fileToLinktext(newAttach, source.path, false);

      return `[${alias}](${newLinkText}${subpath})`;
    }

    return linkMatch.match;
  }

  async cleanupDuplicateAttachments(duplicateCandidates: Set<string>): Promise<number> {
    if (duplicateCandidates.size === 0) {
      return 0;
    }

    let deletedDuplicateFiles = 0;
    const referencedAttachments = await this.collectReferencedAttachments();
    for (const duplicatePath of duplicateCandidates) {
      if (referencedAttachments.has(duplicatePath)) {
        continue;
      }

      const duplicateFile = this.app.vault.getAbstractFileByPath(duplicatePath);
      if (!(duplicateFile instanceof TFile)) {
        continue;
      }

      await this.app.vault.delete(duplicateFile, true);
      deletedDuplicateFiles += 1;
      debugLog("cleanupDuplicateAttachments - deleted duplicate:", duplicatePath);
    }

    return deletedDuplicateFiles;
  }

  async collectReferencedAttachments(): Promise<Set<string>> {
    const referencedAttachments = new Set<string>();

    for (const file of this.app.vault.getFiles()) {
      if (isAttachment(this.settings, file, this.app)) {
        continue;
      }

      if (isMarkdownFile(file.extension)) {
        const linkMatches = await getAllLinkMatchesInFile(file, this.app);
        for (const linkMatch of linkMatches) {
          if (isAttachment(this.settings, linkMatch.linkText, this.app)) {
            referencedAttachments.add(linkMatch.linkText);
          }
        }
        continue;
      }

      if (!isCanvasFile(file.extension)) {
        continue;
      }

      const fileRead = await this.app.vault.cachedRead(file);
      if (!fileRead || fileRead.length === 0) {
        continue;
      }

      let canvasData;
      try {
        canvasData = JSON.parse(fileRead);
      } catch (e) {
        debugLog("collectReferencedAttachments - parse canvas data error", e);
        continue;
      }

      if (!canvasData.nodes || canvasData.nodes.length === 0) {
        continue;
      }

      for (const node of canvasData.nodes) {
        if (node.type === "file" && isAttachment(this.settings, node.file, this.app)) {
          referencedAttachments.add(node.file);
          continue;
        }

        if (node.type === "text" && typeof node.text === "string") {
          const linkMatches = await getAllLinkMatchesInFile(file, this.app, node.text);
          for (const linkMatch of linkMatches) {
            if (isAttachment(this.settings, linkMatch.linkText, this.app)) {
              referencedAttachments.add(linkMatch.linkText);
            }
          }
        }
      }
    }

    return referencedAttachments;
  }

  needToRename(
    settings: AttachmentPathSettings,
    attachPath: string,
    attachName: string,
    noteName: string,
    link: string
  ): boolean {
    const linkPath = path.dirname(link);
    const linkName = path.basename(link, path.extname(link));

    if (linkName.length !== attachName.length) {
      return true;
    }

    if (attachPath !== linkPath) {
      return true;
    } else {
      if (settings.attachFormat.includes(SETTINGS_VARIABLES_NOTENAME) && !linkName.includes(noteName)) {
        return true;
      }
      // suppose the ${notename} was in format
      const noNoteNameAttachFormat = settings.attachFormat.split(SETTINGS_VARIABLES_NOTENAME);
      if (settings.attachFormat.includes(SETTINGS_VARIABLES_DATES)) {
        for (const formatPart in noNoteNameAttachFormat) {
          // suppose the ${date} was in format, split each part and search in linkName
          const splited = formatPart.split(SETTINGS_VARIABLES_DATES);
          for (const part in splited) {
            if (!linkName.includes(part)) {
              return true;
            }
          }
        }
      }
    }

    return false;
  }
}

export function formatArrangeDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }

  const totalSeconds = Math.floor(durationMs / 1000);
  if (totalSeconds < 60) {
    const seconds = durationMs / 1000;
    return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`;
  }

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }

  return `${minutes}m ${seconds}s`;
}

export function formatArrangeCompletedMessage(stats: RearrangeStats): DocumentFragment {
  const duration = formatArrangeDuration(stats.durationMs);

  return createFragment((frag: DocumentFragment) => {
    frag.createDiv({ text: t("notifications.arrangeCompletedTitle", { duration }) });
    frag.createDiv({
      text: t("notifications.arrangeCompletedScanned", {
        scannedFiles: stats.totalFilesScanned,
        processedNotes: stats.processedNotes,
        totalNotes: stats.totalNotes,
        processedLinks: stats.processedLinks,
        totalLinks: stats.totalLinks,
      }),
    });
    frag.createDiv({
      text: t("notifications.arrangeCompletedResults", {
        movedLinks: stats.movedLinks,
        deduplicatedLinks: stats.deduplicatedLinks,
        deletedDuplicateFiles: stats.deletedDuplicateFiles,
        unchangedLinks: stats.unchangedLinks,
        skippedLinks: stats.skippedLinks,
      }),
    });
  });
}
