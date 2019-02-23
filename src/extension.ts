import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as util from 'util';
import * as jimp from 'jimp';

export function activate(context: vscode.ExtensionContext) {

	const mdExtCheck: RegExp = new RegExp("\.md$");
	const idpMdExtCheck: RegExp = new RegExp("\.idp\.md$");
	const mdImageAnchor: RegExp = /\!\[(.*)\]\((.+)\)/g;
	const embededImagePattern = /\[embeded-image-\w+\]:\sdata:image\//g;

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
		let text = await image.quality(80).getBase64Async(jimp.MIME_JPEG);
		let md5 = crypto.createHash('md5');
		return [md5.update(text).digest("hex"), text];
	}

	class FoldEmbededImage implements vscode.FoldingRangeProvider {
		provideFoldingRanges(
			document: vscode.TextDocument,
			context: vscode.FoldingContext,
			token: vscode.CancellationToken): vscode.ProviderResult<vscode.FoldingRange[]> {
			let results: vscode.FoldingRange[] = [];
			const content = document.getText();
			for (let result: any; result = embededImagePattern.exec(content);) {
				const offset = result.index;
				const lineNum = document.positionAt(offset).line
				results.push(new vscode.FoldingRange(lineNum, lineNum + 1));
			}
			return results;
		}
	}

	let disposable = vscode.languages.registerFoldingRangeProvider({ pattern: "**/*.md" }, new FoldEmbededImage);
	context.subscriptions.push(disposable);

	disposable = vscode.commands.registerCommand('extension.embedImageToMarkdown', async () => {
		let editor = vscode.window.activeTextEditor;
		if (!editor) return;
		const fileName: string = editor.document.fileName;
		if (!mdExtCheck.test(fileName)) {
			vscode.window.showInformationMessage("Not a Markdown file.");
			return;
		}
		const homePath = path.dirname(fileName);
		let content: string = editor.document.getText();
		let imageStore: { [idx: string]: string } = {};			// md5 -> image
		let replaceMap: { [idx: number]: any } = {};			// offset -> md5
		let fileCache: { [idx: string]: string } = {};
		for (let result: any; result = mdImageAnchor.exec(content);) {
			const offset = result.index;
			const filePath = resolveImagePath(homePath, result[2]);
			if (filePath in fileCache) {
				replaceMap[result.index] = fileCache[filePath];
			}
			else {
				const [imageMD5, imageText] = await makeImageText(filePath);
				imageStore[imageMD5] = imageText;
				fileCache[filePath] = imageMD5;
				replaceMap[offset] = imageMD5;
			}
		}
		if (!Object.keys(imageStore).length) {
			vscode.window.showWarningMessage("No image to embed.");
			return;
		}
		content = content.replace(mdImageAnchor, (substring: string, alt: string, path: string, offset: number): string => {
			let md5: string = replaceMap[offset];
			if (!md5) return substring;
			return util.format("![%s][embeded-image-%s]", alt, md5);
		});

		let packedFileName = fileName.replace(/.md$/, ".idp.md");
		let output = fs.createWriteStream(packedFileName, {
			flags: 'w',
			encoding: "utf8",
			autoClose: true
		})
		if (!output) {
			vscode.window.showErrorMessage("Create " + packedFileName + " failed.");
			return;
		}
		await output.write(content);
		await output.write("\r\n".repeat(10));
		for (let md5 in imageStore) {
			let text = util.format("\r\n[embeded-image-%s]:\r\n%s\r\n", md5, imageStore[md5]);
			await output.write(text);
		}
		output.close();
		let uri = vscode.Uri.file(packedFileName);
		await vscode.commands.executeCommand('vscode.open', uri);
		await vscode.window.showInformationMessage( packedFileName + " maked!");
		return;
	});

	context.subscriptions.push(disposable);
}

// this method is called when your extension is deactivated
export function deactivate() { }
