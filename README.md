# OpenAPI Visual Studio Code extension

This tool assists in writing/validating OpenAPI specs in Visual Studio Code.

### Be aware: 

 - This extension is currently in "Preview" stage, feel free to provide feedack and open issues in this repo. 
 - If you don't see any validation errors reported for a file, please validate this is the case by running [AutoRest](https://github.com/Azure/autorest/blob/ceef1e6acf6e2f82458a5b2b606f842e6049fe52/docs/developer/validation-rules/readme.md) from the commandline. 

## Installing Extension

Download [https://marketplace.visualstudio.com/items?itemName=ms-vscode.autorest](https://marketplace.visualstudio.com/items?itemName=ms-vscode.autorest)

## Updating this extension and/or AutoRest

- Extension: Updates to the extension itself will be published to the Marketplace and a notification should be shown in VS Code. 
- AutoRest updates: Validation errors reported by this extension rely on AutoRest. The extension consumes the globally installed version of AutoRest on the machine (if you followed [Installing Autorest](https://github.com/Azure/autorest#installing-autorest)). To update your AutoRest version, please refer to [Updating AutoRest](https://github.com/Azure/autorest#updating-autorest).

## What to expect?

### Linting

This extension currently uses AutoRest to surface validation errors in OpenAPI specs. It provides json schema validation and linting for [Azure Resource Management specs](https://github.com/Azure/azure-rest-api-specs).

After installing the extension, opening an OpenAPI spec, will kick off AutoRest validation and report any errors/warning in the "Problems" window of Visual Studio Code, squiggles will also show up for errors/warnings and hovering over the item will provide more information. 

![alt text](https://github.com/Azure/openapi-lint-extension/blob/master/images/VScode-extension.PNG)

### Editing OpenAPI specs - Templates
To assist in creating and editing OpenAPI specs, the extension provides a set of templates/snippets. 
For example, typing 'swagger' generates a starter skeleton for the spec including swagger, info,host, schemes, consumes/produces, paths, definitions and paramaters properties. 

Other snippets include: 'operation', 'responses', 'body', 'statusCode', 'enumProperty'. 'x-ms-enum', 'x-ms-pageable', 'x-ms-pageableModel', 'x-ms-long-running-operation', 'modeldefinition',  'parameterdefinition', 'property', 'defaultResponse'. 
Snippets can be looked at [here](https://github.com/Azure/openapi-lint-extension/blob/master/snippets/swagger.json).


### Advanced usage

To customize validation please use AutoRest [configuration file](https://github.com/Azure/autorest/tree/97b68250afd96111f79047e24e22eeb82a30426f/src/autorest-core/test/variations/suppressions):
- Input files: If you're working with a "composite" spec, please list the files under "input-file" setting. See [configuration file](https://github.com/Azure/autorest/tree/97b68250afd96111f79047e24e22eeb82a30426f/src/autorest-core/test/variations/suppressions) example.
- Validation to use: If you're validating Azure Resource Management Specs be sure to include "azure-validator: true". 
- Suppressions: If you'd like to suppress a reported error, please follow [Suppression configuration](https://github.com/Azure/autorest/tree/97b68250afd96111f79047e24e22eeb82a30426f/src/autorest-core/test/variations/suppressions#suppressions).

We're actively working to improve this extension, adding more validation and features to make OpenAPI editing experience easier.

---
_This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/). For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments._