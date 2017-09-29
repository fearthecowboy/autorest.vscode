/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import {
  createConnection, TextDocuments, TextDocument, Diagnostic, DiagnosticSeverity,
  InitializeResult, DidChangeConfigurationNotification, Proposed, ProposedFeatures,
  TextDocumentSyncKind, IConnection, IPCMessageReader, IPCMessageWriter, InitializeParams
} from 'vscode-languageserver';
import { AutoRestSettings, Settings } from '../lib/interfaces';
import { initialize as initAutoRestCore } from "autorest";

import { OpenApiDocumentManager } from "./document-manager"

// Create a connection for the server. The connection uses Node's IPC as a transport
let connection: IConnection = createConnection(new IPCMessageReader(process), new IPCMessageWriter(process));
// our vscode document manager.
let documentManager = new OpenApiDocumentManager(connection);
console.log = (t) => documentManager.information(t);
console.trace = (t) => documentManager.debug(t);
console.info = (t) => documentManager.verbose(t);
console.error = (t) => documentManager.error(t);

process.on("unhandledRejection", function (err) {
  // documentManager.debug(`Unhandled Rejection Suppressed: ${err}`);
});

// if we get an initialization message, we should tell it what we can do, and tell AutoRest where our root is.
connection.onInitialize((params): InitializeResult => {
  documentManager.onInit(params);
  documentManager.SetRootUri(params.rootPath);

  return {
    capabilities: {
      // TODO: provide code lens handlers to preview generated code and such!
      // codeLensProvider: <CodeLensOptions>{
      //   resolveProvider: false
      // },
      // completionProvider: {
      //		resolveProvider: true
      // }

      definitionProvider: true,
      hoverProvider: true,

      // Tell the client that the server works in FULL text document sync mode
      textDocumentSync: TextDocumentSyncKind.Full,
    }
  }
});

// Listen on the connection
connection.listen();