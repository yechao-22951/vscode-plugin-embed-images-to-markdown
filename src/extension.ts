// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
//import * as uuid from 'uuid';
import * as crypto from 'crypto';
import * as util from 'util';
import { FORMERR } from 'dns';

const jimp = require('jimp');

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "md-pack" is now active!');

	let mdExtCheck: RegExp = new RegExp("\.md$");
	let idpMdExtCheck: RegExp = new RegExp("\.idp\.md$");
	const mdImageAnchor: RegExp = /\!\[(.*)\]\((.+)\)/g;

	function resolveImagePath(home: string, filePath: string) {
		return path.isAbsolute(filePath)
			? filePath
			: path.resolve(home, filePath);
	}

	async function makeImageText(filePath: string) {
		let image = await jimp.read(filePath);
		const w = image.getWidth();
		const h = image.getHeight();
		if (w > 600) {
			image = await image.resize(600, 600 * h / w);
		}
		let text = await image.quality(60).getBase64Async(jimp.MIME_JPEG);
		console.log(text);
		let md5 = crypto.createHash('md5');
		return [ md5.update(text).digest("hex"), text ];
		//return ["",text];
	}

	function generateNewDoc( content : string, replacements: any ) {
		content.replace( mdImageAnchor, ( substring:string, alt:string, path:string, offset:number ) : string => {
			let replacement = replacements[offset.toString()];
			util.format( "![%s][%s]", replacement.imageHash );
			return "";
		} );
	}

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	let disposable = vscode.commands.registerCommand('extension.packMarkdownImages', async () => {
		// The code you place here will be executed every time your command is executed
		let editor = vscode.window.activeTextEditor;
		if (!editor) return;
		const fileName: string = editor.document.fileName;
		
		if (!mdExtCheck.test(fileName)) {
			vscode.window.showInformationMessage(editor.document.fileName + ": Not a Markdown file.");
			return;
		}
		const homePath = path.dirname(fileName);
		let content: string = editor.document.getText();
		//const mdImageAnchor: RegExp = /\!\[(.*)\]\((.+)\)/g
		let imageStore: { [idx: string]: string } = {};			// md5 -> image
		let replaceMap: { [idx:number]: any} = {};					// offset -> md5
		let fileCache: {[idx:string]:boolean} = {};
		for(let result:any; result = mdImageAnchor.exec(content); ) {
			console.log(result);
			const offset = result.index;
			const filePath = resolveImagePath(homePath, result[2]);
			if (filePath in fileCache ) {
				replaceMap[result.index] = fileCache[filePath];
			}
			else {
				const [imageMD5, imageText] = await makeImageText(filePath);
				imageStore[imageMD5] = imageText;
				fileCache[filePath] = imageMD5;
				replaceMap[offset] = imageMD5;
			} 
		}
		content = content.replace( mdImageAnchor, ( substring:string, alt:string, path:string, offset:number ) : string => {
			let md5:string = replaceMap[offset];
			if( !md5 ) return substring; // not replace
			return util.format( "![%s][%s]", alt, md5 );
		} );

		let packedFileName = fileName.replace(/.md$/, ".idp.md");
		let output = fs.createWriteStream(packedFileName, {
			encoding : "utf8",
			autoClose : true
		})
		if( !output ) {
			vscode.window.showErrorMessage("Create " + packedFileName + " failed." );
			return ;
		}
		await output.write( content );
		await output.write( "\r\n".repeat(10) );
		for( let md5 in imageStore) {
			let text = util.format("\r\n[%s]:%s\r\n", md5, imageStore[md5]);
			await output.write( text );
		}
		output.close();
		let doc = await vscode.workspace.openTextDocument(packedFileName);
		vscode.window.showTextDocument(doc);
		vscode.window.showInformationMessage(packedFileName + " maked!");
		return;
	});

	context.subscriptions.push(disposable);
}

// this method is called when your extension is deactivated
export function deactivate() { }
