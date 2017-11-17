import { workspace, ExtensionContext, WorkspaceConfiguration, TextDocument, commands, window, Uri, ViewColumn, ProgressLocation } from 'vscode';
import { AutoRestLanguageService, GenerationResults } from "autorest"
import { normalize, join, basename, extname, } from 'path';
import { tmpdir } from 'os';
import { writeFile } from 'fs'

let languageService: AutoRestLanguageService;

export async function setupGenerator(service: AutoRestLanguageService) {
  languageService = service;
  commands.registerCommand("extension.autorest.generate", (args) => generate(args));
}

async function generate(args: any) {
  try {
    const currFile: string = window.activeTextEditor.document.fileName;
    const doc = window.activeTextEditor.document;

    window.withProgress({ location: ProgressLocation.Window, title: "generating..." }, async (p) => {
      p.report({ message: "working..." });

      if (await languageService.isSupportedDocument(doc.languageId, doc.uri.toString())) {
        // sure looks like it'll work.
        const language = workspace.getConfiguration("autorest").get("language", "csharp");
        const generated = await languageService.generate(doc.uri.toString(), language, {});

        await writeContentToMarkdown(language, generated);
      }
      p.report({ message: "preparing view..." });
    });


  } catch (E) {
    console.log(E);
  }
}

async function writeContentToMarkdown(language: string, generated: GenerationResults) {
  let content: string = '## Generated Code\n';

  for (const filePath in generated.files) {
    content += '### [' + basename(filePath) + '](' + filePath + ')' + '\n\n';
    content += '\n```' + language + ' \n' + generated.files[filePath] + '\n```\n';
  }

  const doc = await workspace.openTextDocument({ language: "markdown", content: content });
  // window.showTextDocument(doc);
  await commands.executeCommand("markdown.showPreview", doc.uri);
}
