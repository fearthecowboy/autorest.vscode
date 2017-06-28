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
import { SourceMap, JsonPath } from "../lib/ref/source-map";
import { value, stringify, parse, nodes, paths } from "jsonpath";
import { safeDump } from "js-yaml";
import { DocumentAnalysis } from "./document-analysis";

import {
  IPCMessageReader, IPCMessageWriter,
  createConnection, IConnection, TextDocumentSyncKind,
  TextDocuments, TextDocument, Diagnostic, DiagnosticSeverity,
  InitializeParams, InitializeResult, TextDocumentPositionParams, DidChangeConfigurationParams, TextDocumentWillSaveEvent,
  CompletionItem, CompletionItemKind, Range, Position, DidChangeWatchedFilesParams, TextDocumentChangeEvent, Hover, Location,
  CodeLensParams, CodeLens, MarkedString
} from 'vscode-languageserver';

// Create a connection for the server. The connection uses Node's IPC as a transport
export const connection: IConnection = (<any>global).connection;
export const initializeParams: InitializeParams = (<any>global).initializeParams;
export let settings: Settings = (<any>global).settings;

//TODO: adding URL here temporarily, this should be coming either in the message coming from autorest or the plugin
const azureValidatorRulesDocUrl = "https://github.com/Azure/azure-rest-api-specs/blob/master/documentation/openapi-authoring-automated-guidelines.md";

export class AutoRestManager extends TextDocuments {
  private trackedFiles = new Map<string, TrackedFile>();

  public async GetFileContent(documentUri: string): Promise<string | null> {
    const file = this.trackedFiles.get(documentUri);
    const content = file && await file.content;
    if (!content) { console.warn(`file '${documentUri}' not found`); return null; }
    return content;
  }

  // Map of "path to file/folder" and its document context 
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

    return f;
  }

  // Finds the folder the document is in, creates or returns existing document context based on folder path 
  // (there should only be one config file per folder)
  private async GetDocumentContextForDocument(documentUri: string): Promise<DocumentContext> {
    documentUri = NormalizeUri(documentUri);
    // get the folder for this documentUri
    let folder = ResolveUri(documentUri, ".");

    let configFile = await AutoRest.DetectConfigurationFile(new DocumentContext(this, folder), folder);
    if (configFile) {
      this.debug(`Configuration File Selected: ${configFile}`);


      folder = path.dirname(configFile);  // updating folder, in case config file was found in another folder in the hierarchy
      // do we have this config already?
      let ctx = this.activeContexts.get(folder);
      if (!ctx) {
        ctx = new DocumentContext(this, folder, configFile);
        this.activeContexts.set(folder, ctx);
        this.activeContexts.set(documentUri, ctx);
      }
      // if the file is the config file itself.
      if (configFile === documentUri) {
        // look into acquiring the rest of the files in this config file
        let files = [...(await ctx.autorest.view).InputFileUris]
        for (const fn of files) {
          // acquire each of the docs in the config file
          ctx.ReadFile(fn);
          this.activeContexts.set(fn, ctx);
          ctx.Track(await this.AcquireTrackedFile(fn));
        }
        return ctx;
      }

      // is the documentUri in the config file?
      let files = [...(await ctx.autorest.view).InputFileUris];
      for (const fn of files) {
        if (fn == documentUri) {
          // found the document inside this context.
          this.activeContexts.set(fn, ctx);
          ctx.Track(await this.AcquireTrackedFile(configFile));
          return ctx;
        }
      }
    }
    // there was no configuration file for that file.
    // or the configuration that we found didn't contain that file.

    // let's look for or create a faux one at that level
    //creating this file in a folder under the name of the file, so it's unique to this file
    configFile = this.GetFakeConfigFileUri(documentUri);
    //check if file context (the file or files related to this config) is opened in VS Code
    let ctx = this.activeContexts.get(configFile);
    if (ctx) {
      ctx.Track(await this.AcquireTrackedFile(configFile));
      return ctx;
    }

    // we don't have one here - create a faux file
    let file = await this.AcquireTrackedFile(configFile, "#Fake config file \n > see https://aka.ms/autorest \n``` yaml \ninput-file: \n - " + documentUri);
    //mark it active, as if it was opened in VS Code
    file.IsActive = true;
    ctx = new DocumentContext(this, folder, configFile);
    ctx.autorest.AddConfiguration({ "input-file": documentUri, "azure-validator": true });
    this.activeContexts.set(configFile, ctx);
    this.activeContexts.set(documentUri, ctx);
    ctx.Track(file);
    return ctx;
  }

  private GetFakeConfigFileUri(documentUri: string): string {
    return ResolveUri(documentUri + "/", "readme.md");
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
        let ctx = await this.GetDocumentContextForDocument(documentUri);
        this.activeContexts.set(documentUri, ctx);
        return;
      }

      // not before this, but now we should
      //let's acquire the tracked file first, then get its document context
      doc = await this.AcquireTrackedFile(documentUri)
      doc.IsActive = true;
      let ctx = await this.GetDocumentContextForDocument(documentUri);
      ctx.Track(doc);
      ctx.Activate();

    }
  }

  private async changed(change: TextDocumentChangeEvent) {
    if (AutoRest.IsConfigurationExtension(change.document.languageId) || AutoRest.IsSwaggerExtension(change.document.languageId)) {
      var documentUri = NormalizeUri(change.document.uri);
      if (!documentUri.startsWith("file://")) {
        return;
      }
      let doc = this.trackedFiles.get(documentUri);
      if (doc) {
        // set the document content.
        doc.IsActive = true;
        doc.SetContent(change.document.getText());
        let ctx = await this.GetDocumentContextForDocument(documentUri);
        ctx.Track(doc);
        ctx.Activate();
      }
    }
  }

  private async closed(close: TextDocumentChangeEvent) {
    // if we have this document, we can mark it 
    let docUri = NormalizeUri(close.document.uri);
    let doc = this.trackedFiles.get(docUri);
    if (doc) {

      // config files need some different treatment
      // if config file is left opened, we do not want to clear diagnostics for referenced files
      // if config file is closed and no other referenced files are opened, then we should clear diagnostics.
      let folder = path.dirname(docUri);
      let ctx = this.activeContexts.get(docUri);
      let configFile = await AutoRest.DetectConfigurationFile(ctx, folder);

      if (configFile === docUri) {
        let files = [...(await ctx.autorest.view).InputFileUris];
        let docfile;
        for (const fn of files) {
          docfile = this.trackedFiles.get(NormalizeUri(fn));
          if (!docfile.IsActive) {
            this.activeContexts.delete(fn);
            this.unTrackAndClearDiagnotics(ctx, docfile);
          }
        }
      }
      // we're not tracking this file from vscode anymore.
      doc.IsActive = false;

      //if the document is not the config file but it has a real config file associated with it
      if (configFile) {
        this.activeContexts.delete(docUri);
        this.unTrackAndClearDiagnotics(ctx, doc);
      }
      // if the file is an individual file
      else {
        configFile = this.GetFakeConfigFileUri(docUri)
        ctx = this.activeContexts.get(configFile);
        this.activeContexts.delete(configFile);
        this.activeContexts.delete(docUri);
        this.unTrackAndClearDiagnotics(ctx, doc);
      }

    }
  }

  private unTrackAndClearDiagnotics(docContext: DocumentContext, file: TrackedFile) {
    docContext.UnTrack(file);
    file.ClearDiagnostics();
    file.FlushDiagnostics(true);
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
    let moreInfo = "";
    if (args.Plugin === "azure-validator") {
      moreInfo = "\n More info: " + azureValidatorRulesDocUrl + "#" + args.Key[1] + "-" + args.Key[0] + "\n";
    }
    if (args.Range) {
      for (const each of args.Range) {
        // get the file reference first
        let file = this.trackedFiles.get(each.document);
        if (file) {
          file.PushDiagnostic({
            severity: severity,
            range: Range.create(Position.create(each.start.line - 1, each.start.column), Position.create(each.end.line - 1, each.end.column)),
            message: args.Text + moreInfo,
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

  /**
   * Retrieves the fully resolved, fully merged Swagger definition representing the currently inspected service.
   */
  public GetFullyResolvedAndMergedDefinitionOf(documentUri: string): { openapiDefinition: any, openapiDefinitionMap: sourceMap.RawSourceMap } {
    const context = this.activeContexts.get(documentUri);

    if (!context) {
      console.warn("no context found", documentUri, [...this.activeContexts.keys()]);
      return null;
    }

    const result = context.fullyResolvedAndMergedDefinition;

    if (!result.openapiDefinition || !result.openapiDefinitionMap) {
      console.log("waiting for AutoRest to provide data");
      return null;
    }

    return result;
  }

  private * onHoverRef(docAnalysis: DocumentAnalysis, position: Position): Iterable<MarkedString> {
    const refValueJsonPath = docAnalysis.GetJsonPathFromJsonReferenceAt(position);
    if (!refValueJsonPath) { console.log("found nothing that looks like a JSON reference"); return null; }

    for (const location of docAnalysis.GetDefinitionLocations(refValueJsonPath)) {
      yield {
        language: "yaml",
        value: safeDump(location.value)
      };
    }
  }

  private * onHoverJsonPath(docAnalysis: DocumentAnalysis, position: Position): Iterable<MarkedString> {
    const potentialQuery: string = docAnalysis.GetJsonQueryAt(position);
    if (!potentialQuery) { console.log("found nothing that looks like a JSON path"); return null; }

    const queryNodes = [...docAnalysis.GetDefinitionLocations(potentialQuery)];
    yield {
      language: "plaintext",
      value: `${queryNodes.length} matches\n${queryNodes.map(node => node.jsonPath).join("\n")}`
    };
  }

  private async onHover(position: TextDocumentPositionParams): Promise<Hover | null> {
    const docAnalysis = await DocumentAnalysis.Create(this, position.textDocument.uri);
    if (!docAnalysis) {
      return null;
    }

    return <Hover>{
      contents: [
        ...this.onHoverRef(docAnalysis, position.position),
        ...this.onHoverJsonPath(docAnalysis, position.position)
      ]
    };
  }

  private onDefinitionRef(docAnalysis: DocumentAnalysis, position: Position): Iterable<Location> {
    const refValueJsonPath = docAnalysis.GetJsonPathFromJsonReferenceAt(position);
    if (!refValueJsonPath) { console.log("found nothing that looks like a JSON reference"); return []; }

    return docAnalysis.GetDocumentLocations(refValueJsonPath);
  }

  private onDefinitionJsonPath(docAnalysis: DocumentAnalysis, position: Position): Iterable<Location> {
    const potentialQuery: string = docAnalysis.GetJsonQueryAt(position);
    if (!potentialQuery) { console.log("found nothing that looks like a JSON path"); return []; }

    return docAnalysis.GetDocumentLocations(potentialQuery);
  }

  private async onDefinition(position: TextDocumentPositionParams): Promise<Location[] | null> {
    const docAnalysis = await DocumentAnalysis.Create(this, position.textDocument.uri);
    if (!docAnalysis) {
      return null;
    }

    return [
      ...this.onDefinitionRef(docAnalysis, position.position),
      ...this.onDefinitionJsonPath(docAnalysis, position.position)
    ];
  }

  constructor(private connection: IConnection) {
    super();
    this.debug("setting up AutoRestManager.");
    this.SetRootUri(NormalizeUri(initializeParams.rootUri));

    // ask vscode to track 
    this.onDidOpen((p) => this.opened(p));
    this.onDidChangeContent((p) => this.changed(p));
    this.onDidClose((p) => this.closed(p));

    // we also get change notifications of files on disk:
    connection.onDidChangeWatchedFiles((p) => this.changedOnDisk(p));

    // take over configuration file change notifications.
    connection.onDidChangeConfiguration((p) => this.configurationChanged(p));

    connection.onHover((position, cancel) => this.onHover(position));

    connection.onDefinition((position, cancel) => this.onDefinition(position));

    // on save
    this.onDidSave((p) => this.onSaving(p));
    this.listen(connection);

    this.verbose("AutoRestManager is Listening.")
  }
}

let manager: AutoRestManager = new AutoRestManager(connection);
