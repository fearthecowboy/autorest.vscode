/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as path from 'path';

import { workspace, ExtensionContext, WorkspaceConfiguration, TextDocument, commands } from 'vscode';
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from 'vscode-languageclient';
import { AutoRestSettings } from "./interfaces";
import { getLanguageServiceEntrypoint, AutoRestLanguageService } from "autorest"
import { setupGenerator } from "./generator";

import { setupStatusBar, setStatus, startActivity, endActivity } from './statusbar';

let languageService: AutoRestLanguageService;

export async function activate(context: ExtensionContext) {
  // bootstrap autorest-core module

  // pull version from configuration
  const version = workspace.getConfiguration("autorest").get("version", "latest-installed");

  // minimum is the version we have as a dependency (or worst-worst-case fall back to .4184)
  const minimum = ((require("../package.json").dependencies.autorest) || "2.0.4184").replace("^", "").replace("~", "");

  let serverModule = await getLanguageServiceEntrypoint(version, minimum);
  // The debug options for the server

  // If the extension is launched in debug mode then the debug server options are used
  // Otherwise the run options are used
  let serverOptions: ServerOptions = {
    // NOTE : use the first 'run' when shipping.
    run: { module: serverModule, transport: TransportKind.ipc, options: {} },
    // this 'run' is for enabling the ability to attach a debugger.

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
        workspace.createFileSystemWatcher('**/*.md'),
        workspace.createFileSystemWatcher('**/*.markdown'),
        workspace.createFileSystemWatcher('**/*.yaml'),
        workspace.createFileSystemWatcher('**/*.yml'),
        workspace.createFileSystemWatcher('**/*.json')
      ]
    },
  }

  // Create the language client and start the client.
  let client = new LanguageClient('autorest', 'Autorest Language Service', serverOptions, clientOptions);

  // spin up the language service 
  languageService = new AutoRestLanguageService(client);

  // do our statusbar thing.
  setupStatusBar(languageService);

  // Push the disposable to the context's subscriptions so that the 
  // client can be deactivated on extension deactivation
  context.subscriptions.push(client.start());

  // we have to wait for the client to be ready before we can do anything else.
  await client.onReady();

  // wire up our client services 
  client.onNotification("status", setStatus);
  client.onNotification("startActivity", startActivity);
  client.onNotification("endActivity", endActivity);

  await setupGenerator(languageService);
}
