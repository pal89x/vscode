/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vs/base/common/uri';
import { IFileSystemProviderWithFileReadWriteCapability, FileSystemProviderCapabilities, IFileChange, IWatchOptions, IStat, FileOverwriteOptions, FileType, FileDeleteOptions, FileWriteOptions, FileChangeType, FileSystemProviderErrorCode } from 'vs/platform/files/common/files';
import { Disposable, IDisposable } from 'vs/base/common/lifecycle';
import { Event, Emitter } from 'vs/base/common/event';
import { VSBuffer } from 'vs/base/common/buffer';
import { FileSystemError } from 'vs/workbench/api/common/extHostTypes';
import { isEqualOrParent, joinPath, relativePath } from 'vs/base/common/resources';

export abstract class KeyValueLogProvider extends Disposable implements IFileSystemProviderWithFileReadWriteCapability {

	readonly capabilities: FileSystemProviderCapabilities = FileSystemProviderCapabilities.FileReadWrite;
	readonly onDidChangeCapabilities: Event<void> = Event.None;

	private readonly _onDidChangeFile: Emitter<IFileChange[]> = this._register(new Emitter<IFileChange[]>());
	readonly onDidChangeFile: Event<IFileChange[]> = this._onDidChangeFile.event;

	private readonly versions: Map<string, number> = new Map<string, number>();

	constructor(private readonly scheme: string) {
		super();
	}

	watch(resource: URI, opts: IWatchOptions): IDisposable {
		return Disposable.None;
	}

	async mkdir(resource: URI): Promise<void> {
	}

	async stat(resource: URI): Promise<IStat> {
		try {
			const content = await this.readFile(resource);
			return {
				type: FileType.File,
				ctime: 0,
				mtime: this.versions.get(resource.toString()) || 0,
				size: content.byteLength
			};
		} catch (e) {
		}
		const files = await this.readdir(resource);
		if (files.length) {
			return {
				type: FileType.Directory,
				ctime: 0,
				mtime: 0,
				size: 0
			};
		}
		return Promise.reject(new FileSystemError(resource, FileSystemProviderErrorCode.FileNotFound));
	}

	async readdir(resource: URI): Promise<[string, FileType][]> {
		const hasKey = await this.hasKey(resource.path);
		if (hasKey) {
			return Promise.reject(new FileSystemError(resource, FileSystemProviderErrorCode.FileNotADirectory));
		}
		const keys = await this.getAllKeys();
		const files: [string, FileType][] = [];
		for (const key of keys) {
			const keyResource = this.toResource(key);
			if (isEqualOrParent(keyResource, resource, false)) {
				const path = relativePath(resource, keyResource, false);
				if (path) {
					const keySegments = path.split('/');
					files.push([keySegments[0], keySegments.length === 1 ? FileType.File : FileType.Directory]);
				}
			}
		}
		return files;
	}

	async readFile(resource: URI): Promise<Uint8Array> {
		const hasKey = await this.hasKey(resource.path);
		if (!hasKey) {
			return Promise.reject(new FileSystemError(resource, FileSystemProviderErrorCode.FileNotFound));
		}
		const value = await this.getValue(resource.path);
		return VSBuffer.fromString(value).buffer;
	}

	async writeFile(resource: URI, content: Uint8Array, opts: FileWriteOptions): Promise<void> {
		const hasKey = await this.hasKey(resource.path);
		if (!hasKey) {
			const files = await this.readdir(resource);
			if (files.length) {
				return Promise.reject(new FileSystemError(resource, FileSystemProviderErrorCode.FileIsADirectory));
			}
		}
		await this.setValue(resource.path, VSBuffer.wrap(content).toString());
		this.versions.set(resource.toString(), (this.versions.get(resource.toString()) || 0) + 1);
		this._onDidChangeFile.fire([{ resource, type: FileChangeType.UPDATED }]);
	}

	async delete(resource: URI, opts: FileDeleteOptions): Promise<void> {
		const hasKey = await this.hasKey(resource.path);
		if (hasKey) {
			await this.deleteKey(resource.path);
			this.versions.delete(resource.path);
			this._onDidChangeFile.fire([{ resource, type: FileChangeType.DELETED }]);
			return;
		}

		if (opts.recursive) {
			const files = await this.readdir(resource);
			await Promise.all(files.map(([key]) => this.delete(joinPath(resource, key), opts)));
		}
	}

	rename(from: URI, to: URI, opts: FileOverwriteOptions): Promise<void> {
		return Promise.reject(new Error('Not Supported'));
	}

	private toResource(key: string): URI {
		return URI.file(key).with({ scheme: this.scheme });
	}

	protected abstract getAllKeys(): Promise<string[]>;
	protected abstract hasKey(key: string): Promise<boolean>;
	protected abstract getValue(key: string): Promise<string>;
	protected abstract setValue(key: string, value: string): Promise<void>;
	protected abstract deleteKey(key: string): Promise<void>;
}
