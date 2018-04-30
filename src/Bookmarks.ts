"use strict";

import * as vscode from "vscode";
import fs = require("fs");
import {BookmarkedFile, JUMP_DIRECTION, JUMP_FORWARD, NO_MORE_BOOKMARKS} from "./Bookmark";

interface BookmarkAdded {
    bookmark: BookmarkedFile;
    line: number;
    preview: string;
}

interface BookmarkRemoved {
    bookmark: BookmarkedFile;
    line: number;
}

interface BookmarkUpdated {
    bookmark: BookmarkedFile;
    index: number;
    line: number;
    preview: string;
}

export class BookmarksController {

    private onDidClearBookmarkEmitter = new vscode.EventEmitter<BookmarkedFile>();
    get onDidClearBookmark(): vscode.Event<BookmarkedFile> { return this.onDidClearBookmarkEmitter.event; }

    private onDidClearAllBookmarksEmitter = new vscode.EventEmitter<BookmarkedFile>();
    get onDidClearAllBookmarks(): vscode.Event<BookmarkedFile> { return this.onDidClearAllBookmarksEmitter.event; }

    private onDidAddBookmarkEmitter = new vscode.EventEmitter<BookmarkAdded>();
    get onDidAddBookmark(): vscode.Event<BookmarkAdded> { return this.onDidAddBookmarkEmitter.event; }

    private onDidRemoveBookmarkEmitter = new vscode.EventEmitter<BookmarkRemoved>();
    get onDidRemoveBookmark(): vscode.Event<BookmarkRemoved> { return this.onDidRemoveBookmarkEmitter.event; }

    private onDidUpdateBookmarkEmitter = new vscode.EventEmitter<BookmarkUpdated>();
    get onDidUpdateBookmark(): vscode.Event<BookmarkUpdated> { return this.onDidUpdateBookmarkEmitter.event; }

    public static normalize(uri: string): string {
            // a simple workaround for what appears to be a vscode.Uri bug
            // (inconsistent fsPath values for the same document, ex. ///foo/x.cpp and /foo/x.cpp)
            return uri.replace("///", "/");
        }
        
        public bookmarks: BookmarkedFile[];
        public activeBookmark: BookmarkedFile = undefined;

        constructor(jsonObject) {
            this.bookmarks = [];
        }

        public dispose() {
            this.zip();
        }
        
        public loadFrom(jsonObject, relativePath?: boolean) {
            if (jsonObject === "") {
                return;
            }
            
            let jsonBookmarks = jsonObject.bookmarks;
            for (let idx = 0; idx < jsonBookmarks.length; idx++) {
              let jsonBookmark = jsonBookmarks[idx];
              
              // each bookmark (line)
              this.add(jsonBookmark.fsPath);
              for (let element of jsonBookmark.bookmarks) {
                  this.bookmarks[idx].bookmarks.push(element); 
              }
            }

            // it replaced $ROOTPATH$ for the rootPath itself 
            if (relativePath) {
                for (let element of this.bookmarks) {
                    element.fsPath = element.fsPath.replace("$ROOTPATH$", vscode.workspace.workspaceFolders[0].uri.fsPath);
                }
            }
        }

        public fromUri(uri: string) {
            uri = BookmarksController.normalize(uri);
            for (let element of this.bookmarks) {
                if (element.fsPath === uri) {
                    return element;
                }
            }
        }

        public add(uri: string) {
            uri = BookmarksController.normalize(uri);
            
            let existing: BookmarkedFile = this.fromUri(uri);
            if (typeof existing === "undefined") {
                let bookmark = new BookmarkedFile(uri);
                this.bookmarks.push(bookmark);
            }
        }

        public nextDocumentWithBookmarks(active: BookmarkedFile, direction: JUMP_DIRECTION = JUMP_FORWARD) {

            let currentBookmark: BookmarkedFile = active;
            let currentBookmarkId: number;
            for (let index = 0; index < this.bookmarks.length; index++) {
                let element = this.bookmarks[index];
                if (element === active) {
                    currentBookmarkId = index;
                }
            }

            return new Promise((resolve, reject) => {

                if (direction === JUMP_FORWARD) {
                  currentBookmarkId++;
                  if (currentBookmarkId === this.bookmarks.length) {
                      currentBookmarkId = 0;
                  }
                } else {
                  currentBookmarkId--;
                  if (currentBookmarkId === -1) {
                      currentBookmarkId = this.bookmarks.length - 1;
                  }
                }
                
                currentBookmark = this.bookmarks[currentBookmarkId];
                
                if (currentBookmark.bookmarks.length === 0) {                    
                    if (currentBookmark === this.activeBookmark) {
                        resolve(NO_MORE_BOOKMARKS);
                        return;
                    } else {
                        this.nextDocumentWithBookmarks(currentBookmark, direction)
                            .then((nextDocument) => {
                                resolve(nextDocument);
                                return;
                            })
                            .catch((error) => {
                                reject(error);
                                return;
                            });
                    }                   
                } else {
                    if (fs.existsSync(currentBookmark.fsPath)) {
                        resolve(currentBookmark.fsPath);
                        return;
                    } else {
                        this.nextDocumentWithBookmarks(currentBookmark, direction)
                            .then((nextDocument) => {
                                resolve(nextDocument);
                                return;
                            })
                            .catch((error) => {
                                reject(error);
                                return;
                            });
                    }
                }

            });

        }

        public nextBookmark(active: BookmarkedFile, currentLine: number) {

            let currentBookmark: BookmarkedFile = active;
            let currentBookmarkId: number;
            for (let index = 0; index < this.bookmarks.length; index++) {
                let element = this.bookmarks[index];
                if (element === active) {
                    currentBookmarkId = index;
                }
            }

            return new Promise((resolve, reject) => {

                currentBookmark.nextBookmark(currentLine)
                    .then((newLine) => {
                        resolve(newLine);
                        return;
                    })
                    .catch((error) => {
                        // next document                  
                        currentBookmarkId++;
                        if (currentBookmarkId === this.bookmarks.length) {
                            currentBookmarkId = 0;
                        }
                        currentBookmark = this.bookmarks[currentBookmarkId];

                    });

            });
        }
        
        public zip(relativePath?: boolean): BookmarksController {
            function isNotEmpty(book: BookmarkedFile): boolean {
                return book.bookmarks.length > 0;
            }
            
            let newBookmarks: BookmarksController = new BookmarksController("");
            newBookmarks.bookmarks = JSON.parse(JSON.stringify(this.bookmarks)).filter(isNotEmpty);

            if (!relativePath) {
                return newBookmarks;
            }

            for (let element of newBookmarks.bookmarks) {
                let wsPath: vscode.WorkspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(element.fsPath));
                if (wsPath) {
                    element.fsPath = element.fsPath.replace(wsPath.uri.fsPath, "$ROOTPATH$"); 
                }
            }
            return newBookmarks;
        }

        public clear(book?: BookmarkedFile): void {
            let b: BookmarkedFile = book ? book : this.activeBookmark;
            b.clear();
            this.onDidClearBookmarkEmitter.fire(b);
        }

        public clearAll(): void {
            for (let element of this.bookmarks) {
                element.clear();
            }     
            this.onDidClearAllBookmarksEmitter.fire();       
        }

        public addBookmark(aline: number): void {
            this.activeBookmark.bookmarks.push(aline);
            this.onDidAddBookmarkEmitter.fire({
                bookmark: this.activeBookmark, 
                line: aline + 1,
                preview: vscode.window.activeTextEditor.document.lineAt(aline).text
            });
        }

        public removeBookmark(index, aline: number, book?: BookmarkedFile): void {
            let b: BookmarkedFile = book ? book : this.activeBookmark;
            b.bookmarks.splice(index, 1);
            this.onDidRemoveBookmarkEmitter.fire({
                bookmark: b, 
                line: aline + 1
            });
        }

        public updateBookmark(index, oldLine, newLine: number, book?: BookmarkedFile): void {
            let b: BookmarkedFile = book ? book : this.activeBookmark;
            b.bookmarks[index] = newLine;
            this.onDidUpdateBookmarkEmitter.fire({
                bookmark: b,
                index: index,
                line: newLine + 1,
                preview: vscode.window.activeTextEditor.document.lineAt(newLine).text
            })
        }

        public hasAnyBookmark(): boolean {
            let totalBookmarkCount: number = 0;
            for (let element of this.bookmarks) {
                totalBookmarkCount = totalBookmarkCount + element.bookmarks.length; 
            }
            return totalBookmarkCount > 0;
        }
    }
