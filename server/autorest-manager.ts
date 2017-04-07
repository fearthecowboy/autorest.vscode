// ---------------------------------------------------------------------------------------------
//  Copyright (c) Microsoft Corporation. All rights reserved.
//  Licensed under the MIT License. See License.txt in the project root for license information.
// ---------------------------------------------------------------------------------------------

import { EventEmitter, IEvent, IFileSystem, AutoRest, Message, Channel } from "autorest";

import { ResolveUri, CreateFileUri, NormalizeUri, FileUriToPath, GetExtension } from '../lib/ref/uri';
import * as asynch from '../lib/ref/async'
import { From } from '../lib/ref/linq'

import { TrackedFile } from "./tracked-file"
import { DocumentContext } from './document-context';
import { Settings, AutoRestSettings } from './interfaces'
import * as path from "path"

import {
  IPCMessageReader, IPCMessageWriter,
  createConnection, IConnection, TextDocumentSyncKind,
  TextDocuments, TextDocument, Diagnostic, DiagnosticSeverity,
  InitializeParams, InitializeResult, TextDocumentPositionParams, DidChangeConfigurationParams, TextDocumentWillSaveEvent,
  CompletionItem, CompletionItemKind, Range, Position, DidChangeWatchedFilesParams, TextDocumentChangeEvent
} from 'vscode-languageserver';

// Create a connection for the server. The connection uses Node's IPC as a transport
export const connection: IConnection = (<any>global).connection;
export const initializeParams: InitializeParams = (<any>global).initializeParams;
export let settings: Settings = (<any>global).settings;

export class AutoRestManager extends TextDocuments {
  private trackedFiles = new Map<string, TrackedFile>();
  private activeContexts = new Map<string, DocumentContext>();
  private _rootUri: string | null = null;
  public get settings(): Settings {
    return <Settings>((<any>global).settings);
  }
  public get RootUri(): string {
    return this._rootUri;
  }

  public information(text: string) {
    if (this.settings.autorest.information) {
      this.connection.console.log(`[INFO: ${AutoRestManager.DateStamp}] ${text}`)
    }
  }

  public verbose(text: string) {
    if (this.settings.autorest.verbose) {
      this.connection.console.log(`[${AutoRestManager.DateStamp}] ${text}`)
    }
  }

  public debug(text: string) {
    if (this.settings.autorest.debug) {
      this.connection.console.log(`[DEBUG: ${AutoRestManager.DateStamp}] ${text}`)
    }
  }

  public warn(text: string) {
    this.connection.console.log(`[WARN: ${AutoRestManager.DateStamp}] ${text}`)
  }

  public error(text: string) {
    this.connection.console.log(`[ERROR: ${AutoRestManager.DateStamp}] ${text}`)
  }
  public async SetRootUri(uri: string): Promise<void> {
    // when we set the RootURI we look to see if we have a configuration file 
    // there, and then we automatically start validating that folder.

    if (!uri || uri.length == 0) {
      this.warn(`No workspace uri.`);
      return;
    }

    if (this._rootUri) {
      // I'm assuming that this doesn't happen...
      throw new Error("BAD ASSUMPTION DUDE.")
    }

    let ctx = this.activeContexts.get(uri);
    if (ctx) {
      // we already have this as an active context. That's ok
    } else {
      // not an active context -- this is the expectation.
      try {
        ctx = new DocumentContext(this, uri);
        this.activeContexts.set(uri, ctx);
        ctx.Activate();
      } catch (exception) {
        // that's not good. 
        this.error(`Exception setting Workspace URI ${uri} `)
      }
    }
  }

  // The settings have changed. Is send on server activation
  // as well.
  configurationChanged(configuration: DidChangeConfigurationParams) {
    (<any>global).settings = <Settings>configuration.settings;
    // Revalidate any open text documents
    // documents.all().forEach(validateTextDocument);
  };

  // This handler resolve additional information for the item selected in
  // the completion list.
  onCompletionResolve(item: CompletionItem): CompletionItem {
    if (item.data === 1) {
      item.detail = 'TypeScript details',
        item.documentation = 'TypeScript documentation'
    } else if (item.data === 2) {
      item.detail = 'JavaScript details',
        item.documentation = 'JavaScript documentation'
    }
    return item;
  };

  onCompletion(textDocumentPosition: TextDocumentPositionParams): CompletionItem[] {
    // The pass parameter contains the position of the text document in 
    // which code complete got requested. For the example we ignore this
    // info and always provide the same completion items.
    return [
      {
        label: 'TypeScript',
        kind: CompletionItemKind.Text,
        data: 1
      },
      {
        label: 'JavaScript',
        kind: CompletionItemKind.Text,
        data: 2
      }
    ]
  };

  private changedOnDisk(changes: DidChangeWatchedFilesParams) {

    // files on disk changed in the workspace. Let's see if we care.
    // changes.changes[0].type 1/2/3 == created/changed/deleted
    // changes.changes[0].uri
    for (const each of changes.changes) {
      let documentUri = NormalizeUri(each.uri);
      if (!documentUri.startsWith("file://")) {
        return;
      }

      this.debug(`Changed On Disk: ${documentUri}`);
      let doc = this.trackedFiles.get(documentUri);
      if (doc) {
        // we are currently tracking this file already.
        if (doc.IsActive) {
          // the document is active, which means that we take orders from VSCode, not the disk.
          // (the file may be modified on the disk, but from our perspective, vscode owns the file until its closed.)
        } else {
          // lets reset the content, and it'll reload it at some other time.
          doc.SetContent(null);
        }
      }
      // we didn't track this file before, so unless something asks for it, we're not going to do anything.
    }
  }

  public async AcquireTrackedFile(documentUri: string, documentContent?: string): Promise<TrackedFile> {
    documentUri = NormalizeUri(documentUri);
    let doc = this.trackedFiles.get(documentUri);
    if (doc) {
      return doc;
    }
    // not tracked yet, let's do that now.
    this.debug(`Tracking file: ${documentUri}`);

    const f = new TrackedFile(documentUri);
    this.trackedFiles.set(documentUri, f);
    f.DiagnosticsToSend.Subscribe((file, diags) => this.connection.sendDiagnostics({ uri: file.fullPath, diagnostics: [...diags.values()] }));

    if (documentContent) {
      f.SetContent(documentContent);
    }

    // check if it's a swagger?
    let content = await (await f).content; // get the content to see if we should be doing something with this.
    return f;
  }

  private async GetDocumentContextForDocument(documentUri: string): Promise<DocumentContext> {
    documentUri = NormalizeUri(documentUri);
    // get the folder for this documentUri
    let folder = ResolveUri(documentUri, ".");

    let configFile = await AutoRest.DetectConfigurationFile(new DocumentContext(this, folder), folder);
    if (configFile) {
      this.debug(`Configuration File Selected: ${configFile}`);


      folder = path.dirname(configFile);
      // do we have this config already?
      let ctx = this.activeContexts.get(folder);
      if (!ctx) {
        ctx = new DocumentContext(this, folder, configFile);
        this.activeContexts.set(folder, ctx);
      }
      // if the file is the config file itself.
      if (configFile == documentUri) {
        // since we're creating a new context, might as well activate it now.
        ctx.Track(await this.AcquireTrackedFile(configFile));
        ctx.Activate();
        return ctx;
      }

      // or is in in this found configuration file?
      let files = [...(await ctx.autorest.view).InputFileUris];
      for (const fn of files) {
        if (fn == documentUri) {
          // found the document inside this context.
          // since we're creating a new context, might as well activate it now.
          ctx.Track(await this.AcquireTrackedFile(configFile));
          ctx.Activate();
          return ctx;
        }
      }
    }
    // there was no configuration file for that file.
    // or the configuration that we found didn't contain that file.

    // let's look for or create a faux one at that level
    configFile = ResolveUri(documentUri + "/", "readme.md");
    let ctx = this.activeContexts.get(configFile);
    if (ctx) {
      // we found the previous faux one for this file ctx.Activate();
      ctx.Track(await this.AcquireTrackedFile(configFile));
      ctx.Activate();
      return ctx;
    }

    // we don't have one here - create a faux file
    let file = await this.AcquireTrackedFile(configFile, "");
    file.IsActive = true;
    ctx = new DocumentContext(this, folder, configFile);
    ctx.autorest.AddConfiguration({ "input-file": documentUri, "azure-arm": true });
    this.activeContexts.set(configFile, ctx);
    ctx.Activate();
    return ctx;
  }

  private async opened(open: TextDocumentChangeEvent): Promise<void> {
    if (AutoRest.IsConfigurationExtension(open.document.languageId) || AutoRest.IsSwaggerExtension(open.document.languageId)) {
      var documentUri = NormalizeUri(open.document.uri);
      if (!documentUri.startsWith("file://")) {
        return;
      }
      let doc = this.trackedFiles.get(documentUri);
      // are we tracking this file?
      if (doc) {
        // yes we are. 
        doc.SetContent(open.document.getText());
        doc.IsActive = true;
        return;
      }

      // not before this, but now we should
      let ctx = await this.GetDocumentContextForDocument(documentUri);
      doc = await this.AcquireTrackedFile(documentUri)
      doc.IsActive = true;
      ctx.Track(doc);
    }
  }

  private changed(change: TextDocumentChangeEvent) {
    if (AutoRest.IsConfigurationExtension(change.document.languageId) || AutoRest.IsSwaggerExtension(change.document.languageId)) {
      var documentUri = NormalizeUri(change.document.uri);
      if (!documentUri.startsWith("file://")) {
        return;
      }

      let doc = this.trackedFiles.get(documentUri);
      if (doc) {
        // set the document content.
        doc.SetContent(change.document.getText());
      }
    }
  }

  private closed(close: TextDocumentChangeEvent) {
    // if we have this document, we can mark it 
    let doc = this.trackedFiles.get(NormalizeUri(close.document.uri));
    if (doc) {
      // we're not tracking this from vscode anymore.
      doc.IsActive = false;
    }
  }

  static PadDigits(number: number, digits: number): string {
    return Array(Math.max(digits - String(number).length + 1, 0)).join('0') + number;
  }

  static get DateStamp(): string {
    let d = new Date();
    return `${this.PadDigits(d.getHours(), 2)}:${this.PadDigits(d.getMinutes(), 2)}:${this.PadDigits(d.getSeconds(), 2)}.${this.PadDigits(d.getMilliseconds(), 4)}`;
  }

  listenForResults(autorest: AutoRest) {
    autorest.Message.Subscribe((_, m) => {
      switch (m.Channel) {
        case Channel.Debug:
          this.debug(m.Text)
          break;
        case Channel.Fatal:
          this.error(m.Text)
          break;
        case Channel.Verbose:
          this.verbose(m.Text)
          break;

        case Channel.Warning:
          this.PushDiagnostic(m, DiagnosticSeverity.Warning);
          break;
        case Channel.Error:
          this.PushDiagnostic(m, DiagnosticSeverity.Error);
          break;
        case Channel.Information:
          this.PushDiagnostic(m, DiagnosticSeverity.Warning);
          break;
      }
    });
  }

  PushDiagnostic(args: Message, severity: DiagnosticSeverity) {
    if (args.Range) {
      for (const each of args.Range) {
        // get the file reference first
        let file = this.trackedFiles.get(each.document);
        if (file) {
          file.PushDiagnostic({
            severity: severity,
            range: Range.create(Position.create(each.start.line - 1, each.start.column), Position.create(each.end.line - 1, each.end.column)),
            message: args.Text,
            source: args.Key ? [...args.Key].join("/") : ""
          });
        }
      }
    }
  }

  /**
   * When the extension saves a literate swagger document, we want to save a shadow .json or .yaml file if it exists (or if instructed to in the configuration)
   * @param saving - the vscode TextDocumentChangeEvent containing the information about the document that was saved.
   */
  async onSaving(saving: TextDocumentChangeEvent) {
    let documentUri = saving.document.uri;
    let documentContent = saving.document.getText();
    if (AutoRest.IsSwaggerExtension(GetExtension(documentUri))) {
      let content = await AutoRest.LiterateToJson(saving.document.getText());
      if (content && await AutoRest.IsSwaggerFile(content)) {

        const ctx = await this.GetDocumentContextForDocument(documentUri);
        const settings = (await ctx.autorest.view).GetEntry("vscode");
        let localPath = FileUriToPath(documentUri.replace(".md", ".json"));
        if ((settings && settings.sync == true) ||
          (await asynch.exists(localPath) && !(settings && settings.sync == false))) {
          await asynch.writeFile(localPath, content);
        }
      }
    }
  }

  constructor(private connection: IConnection) {
    super();
    this.debug("setting up AutoRestManager.");
    this.SetRootUri(initializeParams.rootUri);

    // ask vscode to track 
    this.onDidOpen((p) => this.opened(p));
    this.onDidChangeContent((p) => this.opened(p));
    this.onDidClose((p) => this.closed(p));

    // we also get change notifications of files on disk:
    connection.onDidChangeWatchedFiles((p) => this.changedOnDisk(p));

    // other events we want to handle:
    // connection.onInitialize((p) => this.initialize(p));
    connection.onCompletion((p) => this.onCompletion(p));
    connection.onCompletionResolve((p) => this.onCompletionResolve(p));

    // take over configuration file change notifications.
    connection.onDidChangeConfiguration((p) => this.configurationChanged(p));

    // on save
    this.onDidSave((p) => this.onSaving(p));
    this.listen(connection);

    this.verbose("AutoRestManager is Listening.")
  }
}

let manager: AutoRestManager = new AutoRestManager(connection);
