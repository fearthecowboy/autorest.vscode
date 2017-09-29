/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as path from 'path';

import { workspace, ExtensionContext, WorkspaceConfiguration } from 'vscode';
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from 'vscode-languageclient';
import { AutoRestSettings } from "../lib/interfaces";
import StatusBar from '../client/statusbar';

export function activate(context: ExtensionContext) {

  // The server is implemented in node
  let serverModule = context.asAbsolutePath(path.join('dist', 'server', 'server.js'));
  // The debug options for the server

  // If the extension is launched in debug mode then the debug server options are used
  // Otherwise the run options are used
  let serverOptions: ServerOptions = {
    // NOTE : use the first 'run' when shipping.
    run: { module: serverModule, transport: TransportKind.ipc },

    // this 'run' is for enabling the ability to attach a debugger.
    // run: { module: serverModule, transport: TransportKind.ipc, options: { execArgv: ["--nolazy", "--inspect-brk=6009"] } },

    // this is for stopping the service at startup. used if you debug the client (the service will block and wait...)
    debug: { module: serverModule, transport: TransportKind.ipc, options: { execArgv: ["--nolazy", "--inspect-brk=6009"] } }
  }

  // Options to control the language client
  let clientOptions: LanguageClientOptions = {
    // Register the server for plain text documents
    documentSelector: ['json', 'yaml', 'markdown'],

    synchronize: {
      configurationSection: 'autorest',
      // Notify the server about file changes to file types that are used.
      fileEvents: [
        workspace.createFileSystemWatcher('** /*.md'),
        workspace.createFileSystemWatcher('** /*.markdown'),
        workspace.createFileSystemWatcher('** /*.yaml'),
        workspace.createFileSystemWatcher('** /*.yml'),
        workspace.createFileSystemWatcher('** /*.json')
      ]
    },
  }
  // Create the language client and start the client.
  let disposable = new LanguageClient('autorest', 'Autorest Language Service', serverOptions, clientOptions).start();

  // Push the disposable to the context's subscriptions so that the 
  // client can be deactivated on extension deactivation
  context.subscriptions.push(disposable);

  // do our statusbar thing.
  StatusBar.setup();
}