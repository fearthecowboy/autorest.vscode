/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import { workspace, Disposable, window, commands, Uri, ViewColumn, TextDocument } from 'vscode';
import { LanguageClient } from 'vscode-languageclient';
import { IPlugin, IPluginResult } from '../client/plugin'
const fs = require('fs'),
  path = require('path'),
  os = require('os');

module SplitPane {

  // Map commands and their corresponding autorest args
  const registeredCommandsAndArgs = {
    "extension.autoGenCode.csharp": ["csharp"],
    "extension.autoGenCode.nodejs": ["nodejs"],
    "extension.autoGenCode.ruby": ["ruby"],
    "extension.autoGenCode.python": ["python"],
    "extension.autoGenCode.go": ["go"],
    "extension.autoGenCode.java": ["java"],
    "extension.autoGenCode.csharp.azure": ["csharp", "azure-arm"],
    "extension.autoGenCode.ruby.azure": ["ruby", "azure-arm"],
    "extension.autoGenCode.nodejs.azure": ["nodejs", "azure-arm"],
    "extension.autoGenCode.python.azure": ["python", "azure-arm"],
    "extension.autoGenCode.java.azure": ["java", "azure-arm"]
  };

  const markdownSyntaxHighlightMap = {
    ".cs": "csharp",
    ".rb": "ruby",
    ".js": "js",
    ".go": "go",
    ".java": "java",
    ".py": "python"
  };

  export function setup(client: LanguageClient): IPluginResult {
    console.info('Registering command to launch split pane for autogened code');
    // for each command, register handlers that can send requests to server
    Object.keys(registeredCommandsAndArgs).forEach(key => {
      commands.registerCommand(key, () => generateCode(client, registeredCommandsAndArgs[key]));
    });
    return null;
  }

  function generateCode(client: LanguageClient, args: Array<string>) {
    const currFile: string = window.activeTextEditor.document.fileName;
    if (!(currFile.endsWith('.json') || currFile.endsWith('.md'))) {
      window.showErrorMessage(currFile + ' is not a valid OpenAPI specification file format.');
      return;
    }
    let autorestArgs: object = {};
    autorestArgs['inputFile'] = window.activeTextEditor.document.fileName;
    autorestArgs['additionalConfig'] = {};
    if (args) {
      args.forEach(element => autorestArgs['additionalConfig'][element] = true);
    }

    client.sendRequest('autorest.generateCode', autorestArgs).then(result => displayGeneratedCode(<string>result, args));
  }

  async function writeFilesToDisk(resultObj: any) {
    let opDirPath: string = path.normalize(resultObj['outputFolder']);
    if (opDirPath.startsWith(opDirPath)) {
      opDirPath = opDirPath.replace('file:' + path.sep, '');
    }
    deleteFolderRecursive(opDirPath);

    const generatedFiles = resultObj['generatedFiles'];
    await Object.keys(generatedFiles).forEach(async key => {
      let filePath = path.normalize(key);
      if (filePath.startsWith('file:')) {
        filePath = filePath.replace('file:' + path.sep, '');
      }
      let dirName: string = path.dirname(filePath);
      while (!fs.existsSync(dirName)) {
        await fs.mkdir(dirName);
        dirName = path.dirname(dirName);
      }
      await writeToDisk(filePath, generatedFiles[key]);
    });
    window.showInformationMessage('Code generated under directory ' + opDirPath);
  }

  async function deleteFolderRecursive(dirPath: string) {
    if (await fs.exists(dirPath)) {
      await fs.readdir(dirPath).forEach(async function (file, index) {
        var curPath = path.join(dirPath, file);
        if (await fs.lstat(curPath).isDirectory()) { // recurse
          deleteFolderRecursive(curPath);
        } else { // delete file
          await fs.unlink(curPath);
        }
      });
      await fs.rmdir(dirPath);
    }
  };

  async function writeContentToMarkdown(resultObj: any, args: Array<string>) {
    // dump generated code received into a temp file and show that file on the split pane!!!!
    // this fname is going to basically be the autorest output
    let opfname = 'output.md';
    if (args) {
      opfname = args.join('.') + '.' + opfname;
    }

    const filePath: string = path.normalize(path.join(os.tmpdir(), opfname));
    let content: string = '## Generated Code\n';
    const generatedFiles = resultObj['generatedFiles'];

    Object.keys(generatedFiles).forEach(filePath => {
      content += '### [' + path.basename(filePath) + '](' + filePath + ')' + '\n\n';
      content += '\n```' + markdownSyntaxHighlightMap[path.extname(filePath)] + ' \n' + generatedFiles[filePath] + '\n```\n';
    });
    await writeToDisk(filePath, content);
    const openPath: Uri = Uri.file(filePath);
    // By default dump everything in column 2
    workspace.openTextDocument(openPath).then(doc => {
      window.showTextDocument(doc, ViewColumn.Two);
      commands.executeCommand('markdown.showPreview', openPath);
    });
  }

  async function writeToDisk(filePath: string, content: string): Promise<void> {
    return new Promise<void>((r, _j) => {
      fs.writeFile(filePath, content, { flag: 'w+' }, (err) => {
        if (err) {
          window.showErrorMessage('Unable to write to local temp file: ' + filePath);
        }
        r();
      })
    });
  }

  async function displayGeneratedCode(result: string, args: Array<string>) {
    if (!result) {
      window.showErrorMessage('Failed to generate code for given file. Please check AutoRest server log for more information.');
      return;
    }
    const resultObj = JSON.parse(result);
    await writeFilesToDisk(resultObj);
    await writeContentToMarkdown(resultObj, args);
  }
}
var splitPane: IPlugin = SplitPane;
export default splitPane;