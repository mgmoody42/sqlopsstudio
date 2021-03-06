/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { assign } from 'vs/base/common/objects';
import { memoize } from 'vs/base/common/decorators';
import { IDisposable, toDisposable, dispose } from 'vs/base/common/lifecycle';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { TPromise } from 'vs/base/common/winjs.base';
import { IProcessEnvironment } from 'vs/base/common/platform';
import { BrowserWindow, ipcMain } from 'electron';
import { PromiseSource } from 'vs/base/common/async';
import { ISharedProcess } from 'vs/platform/windows/electron-main/windows';

export class SharedProcess implements ISharedProcess {

	private spawnPromiseSource: PromiseSource<void>;

	private window: Electron.BrowserWindow;
	private disposables: IDisposable[] = [];

	@memoize
	private get _whenReady(): TPromise<void> {
		this.window = new BrowserWindow({
			show: false,
			webPreferences: {
				images: false,
				webaudio: false,
				webgl: false
			}
		});
		const config = assign({
			appRoot: this.environmentService.appRoot,
			nodeCachedDataDir: this.environmentService.nodeCachedDataDir,
			userEnv: this.userEnv
		});

		const url = `${require.toUrl('vs/code/electron-browser/sharedProcess.html')}?config=${encodeURIComponent(JSON.stringify(config))}`;
		this.window.loadURL(url);

		// Prevent the window from dying
		const onClose = e => {
			if (this.window.isVisible()) {
				e.preventDefault();
				this.window.hide();
			}
		};

		this.window.on('close', onClose);
		this.disposables.push(toDisposable(() => this.window.removeListener('close', onClose)));

		this.disposables.push(toDisposable(() => {

			// Electron seems to crash on Windows without this setTimeout :|
			setTimeout(() => {
				try {
					this.window.close();
				} catch (err) {
					// ignore, as electron is already shutting down
				}

				this.window = null;
			}, 0);
		}));

		return new TPromise<void>((c, e) => {
			ipcMain.once('handshake:hello', ({ sender }) => {
				sender.send('handshake:hey there', {
					sharedIPCHandle: this.environmentService.sharedIPCHandle,
					args: this.environmentService.args
				});

				ipcMain.once('handshake:im ready', () => c(null));
			});
		});
	}

	constructor(
		private environmentService: IEnvironmentService,
		private userEnv: IProcessEnvironment
	) {
		this.spawnPromiseSource = new PromiseSource<void>();
	}

	public spawn(): void {
		this.spawnPromiseSource.complete();
	}

	public whenReady(): TPromise<void> {
		return this.spawnPromiseSource.value.then(() => this._whenReady);
	}

	public toggle(): void {
		if (this.window.isVisible()) {
			this.hide();
		} else {
			this.show();
		}
	}

	public show(): void {
		this.window.show();
		this.window.webContents.openDevTools();
	}

	public hide(): void {
		this.window.webContents.closeDevTools();
		this.window.hide();
	}

	public dispose(): void {
		this.disposables = dispose(this.disposables);
	}
}
