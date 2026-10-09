import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { randomUUID, createHash } from 'node:crypto';

import express from 'express';
import sanitize from 'sanitize-filename';
import _ from 'lodash';

import validateAvatarUrlMiddleware from '../middleware/validateFileName.js';
import { createTextMatcher } from '../chat-search.js';
import { createChatInfoCache } from '../chat-info-cache.js';
import { createChatBackupScheduler } from '../chat-backup-scheduler.js';
import {
    withPathLock, withPathLocks, chatLockPaths, writeChatFile, recycleOldChatBackups, waitForChatIO,
    assertChatWritable, ChatLifecycleError, renameChatFile, recycleRetiredChat, recycleChatPath, createChatFileExclusive,
} from '../chat-io.js';
import {
    getConfigValue,
    humanizedDateTime,
    tryParse,
    generateTimestamp,
    formatBytes,
    readFirstLine,
    isPathUnderParent,
} from '../util.js';

const isBackupEnabled = !!getConfigValue('backups.chat.enabled', true, 'boolean');
const maxTotalChatBackups = Number(getConfigValue('backups.chat.maxTotalBackups', -1, 'number'));
const throttleInterval = Number(getConfigValue('backups.chat.throttleInterval', 10_000, 'number'));
const checkIntegrity = !!getConfigValue('backups.chat.checkIntegrity', true, 'boolean');
const maxChatBackups = Number(getConfigValue('backups.common.numberOfBackups', 50, 'number'));

export const CHAT_BACKUPS_PREFIX = 'chat_';

/**
 * Builds a stable filename key for a chat's backups.
 * Non-ASCII characters are replaced with underscores, so names such as CJK ones
 * would all collapse to the same key and share one backup quota. A short hash of
 * the raw name keeps those keys distinct while ASCII names stay unchanged (#5780).
 * @param {string} name The name of the chat.
 * @returns {string} Sanitized filename key for the backup files.
 */
export function getBackupKey(name) {
    const sanitized = sanitize(name).replace(/[^a-z0-9]/gi, '_').toLowerCase();
    if (/[^\x20-\x7E]/.test(name)) {
        const hash = crypto.createHash('sha256').update(name).digest('hex').slice(0, 8);
        return `${sanitized}_${hash}`;
    }
    return sanitized;
}

/**
 * Saves a chat to the backups directory.
 * @param {string} directory The user's backup directory.
 * @param {string} name The name of the chat.
 * @param {string} data The serialized chat to save.
 * @param {string} identity Stable hash of the user and canonical history path.
 * @returns
 */
async function backupChat(directory, name, data, identity) {
    try {
        if (!isBackupEnabled) return;
        await withPathLock(directory, async () => {
            name = sanitize(name).replace(/[^a-z0-9]/gi, '_').toLowerCase().slice(0, 80) || 'chat';
            const quotaPrefix = `${CHAT_BACKUPS_PREFIX}${name}_${identity}_`;
            const backupFile = path.join(directory, `${quotaPrefix}${generateTimestamp()}_${randomUUID()}.jsonl`);
            await writeChatFile(backupFile, data);
            await recycleOldChatBackups(directory, quotaPrefix, maxChatBackups);
            if (!isNaN(maxTotalChatBackups) && maxTotalChatBackups >= 0) {
                await recycleOldChatBackups(directory, CHAT_BACKUPS_PREFIX, maxTotalChatBackups);
            }
        });
    } catch (err) {
        console.error(`Could not backup chat for ${name}`, err);
    }
}

const backupScheduler = createChatBackupScheduler(backupChat, { interval: throttleInterval });

/** Match path-lock normalization, including Windows case-insensitive paths. */
function backupIdentity(handle, filePath) {
    const resolved = path.resolve(filePath);
    return JSON.stringify([handle, process.platform === 'win32' ? resolved.toLowerCase() : resolved]);
}

/**
 * Gets a preview message from a chat message string.
 * @param {string} [lastMessage] - The message to truncate
 * @returns {string} A truncated preview of the last message or empty string if no messages
 */
function getPreviewMessage(lastMessage) {
    const strlen = 400;

    if (!lastMessage) {
        return '';
    }

    return lastMessage.length > strlen
        ? '...' + lastMessage.substring(lastMessage.length - strlen)
        : lastMessage;
}

/** Flush throttled backups and await writes before a normal shutdown. */
export async function flushChatBackups() {
    // Queued chat saves can admit snapshots while their file writes finish.
    await waitForChatIO();
    await backupScheduler.flush();
    await waitForChatIO();
}

/**
 * Imports a chat from Ooba's format.
 * @param {string} userName User name
 * @param {string} characterName Character name
 * @param {object} jsonData JSON data
 * @returns {string} Chat data
 */
function importOobaChat(userName, characterName, jsonData) {
    /** @type {object[]} */
    const chat = [{
        chat_metadata: {},
        user_name: 'unused',
        character_name: 'unused',
    }];

    for (const arr of jsonData.data_visible) {
        if (arr[0]) {
            const userMessage = {
                name: userName,
                is_user: true,
                send_date: new Date().toISOString(),
                mes: arr[0],
                extra: {},
            };
            chat.push(userMessage);
        }
        if (arr[1]) {
            const charMessage = {
                name: characterName,
                is_user: false,
                send_date: new Date().toISOString(),
                mes: arr[1],
                extra: {},
            };
            chat.push(charMessage);
        }
    }

    return chat.map(obj => JSON.stringify(obj)).join('\n');
}

/**
 * Imports a chat from Agnai's format.
 * @param {string} userName User name
 * @param {string} characterName Character name
 * @param {object} jsonData Chat data
 * @returns {string} Chat data
 */
function importAgnaiChat(userName, characterName, jsonData) {
    /** @type {object[]} */
    const chat = [{
        chat_metadata: {},
        user_name: 'unused',
        character_name: 'unused',
    }];

    for (const message of jsonData.messages) {
        const isUser = !!message.userId;
        chat.push({
            name: isUser ? userName : characterName,
            is_user: isUser,
            send_date: new Date().toISOString(),
            mes: message.msg,
            extra: {},
        });
    }

    return chat.map(obj => JSON.stringify(obj)).join('\n');
}

/**
 * Imports a chat from CAI Tools format.
 * @param {string} userName User name
 * @param {string} characterName Character name
 * @param {object} jsonData JSON data
 * @returns {string[]} Converted data
 */
function importCAIChat(userName, characterName, jsonData) {
    /**
     * Converts the chat data to suitable format.
     * @param {object} history Imported chat data
     * @returns {object[]} Converted chat data
     */
    function convert(history) {
        const starter = {
            chat_metadata: {},
            user_name: 'unused',
            character_name: 'unused',
        };

        const historyData = history.msgs.map((msg) => ({
            name: msg.src.is_human ? userName : characterName,
            is_user: msg.src.is_human,
            send_date: new Date().toISOString(),
            mes: msg.text,
            extra: {},
        }));

        return [starter, ...historyData];
    }

    const newChats = (jsonData.histories.histories ?? []).map(history => convert(history).map(obj => JSON.stringify(obj)).join('\n'));
    return newChats;
}

/**
 * Imports a chat from Kobold Lite format.
 * @param {string} _userName User name
 * @param {string} _characterName Character name
 * @param {object} data JSON data
 * @returns {string} Chat data
 */
function importKoboldLiteChat(_userName, _characterName, data) {
    const inputToken = '{{[INPUT]}}';
    const outputToken = '{{[OUTPUT]}}';

    /** @type {function(string): object} */
    function processKoboldMessage(msg) {
        const isUser = msg.includes(inputToken);
        return {
            name: isUser ? userName : characterName,
            is_user: isUser,
            mes: msg.replaceAll(inputToken, '').replaceAll(outputToken, '').trim(),
            send_date: new Date().toISOString(),
            extra: {},
        };
    }

    // Create the header
    const userName = String(data.savedsettings.chatname);
    const characterName = String(data.savedsettings.chatopponent).split('||$||')[0];
    const header = {
        chat_metadata: {},
        user_name: 'unused',
        character_name: 'unused',
    };
    // Format messages
    const formattedMessages = data.actions.map(processKoboldMessage);
    // Add prompt if available
    if (data.prompt) {
        formattedMessages.unshift(processKoboldMessage(data.prompt));
    }
    // Combine header and messages
    const chatData = [header, ...formattedMessages];
    return chatData.map(obj => JSON.stringify(obj)).join('\n');
}

/**
 * Flattens `msg` and `swipes` data from Chub Chat format.
 * Only changes enough to make it compatible with the standard chat serialization format.
 * @param {string} userName User name
 * @param {string} characterName Character name
 * @param {string[]} lines serialised JSONL data
 * @returns {string} Converted data
 */
function flattenChubChat(userName, characterName, lines) {
    function flattenSwipe(swipe) {
        return swipe.message ? swipe.message : swipe;
    }

    function convert(line) {
        const lineData = tryParse(line);
        if (!lineData) return line;

        if (lineData.mes && lineData.mes.message) {
            lineData.mes = lineData?.mes.message;
        }

        if (lineData?.swipes && Array.isArray(lineData.swipes)) {
            lineData.swipes = lineData.swipes.map(swipe => flattenSwipe(swipe));
        }

        return JSON.stringify(lineData);
    }

    return (lines ?? []).map(convert).join('\n');
}

/**
 * Imports a chat from RisuAI format.
 * @param {string} userName User name
 * @param {string} characterName Character name
 * @param {object} jsonData Imported chat data
 * @returns {string} Chat data
 */
function importRisuChat(userName, characterName, jsonData) {
    /** @type {object[]} */
    const chat = [{
        chat_metadata: {},
        user_name: 'unused',
        character_name: 'unused',
    }];

    for (const message of jsonData.data.message) {
        const isUser = message.role === 'user';
        chat.push({
            name: message.name ?? (isUser ? userName : characterName),
            is_user: isUser,
            send_date: new Date(Number(message.time ?? Date.now())).toISOString(),
            mes: message.data ?? '',
            extra: {},
        });
    }

    return chat.map(obj => JSON.stringify(obj)).join('\n');
}

/**
 * Checks if the chat being saved has the same integrity as the one being loaded.
 * @param {string} filePath Path to the chat file
 * @param {string} integritySlug Integrity slug
 * @returns {Promise<boolean>} Whether the chat is intact
 */
async function checkChatIntegrity(filePath, integritySlug) {
    // If the chat file doesn't exist, assume it's intact
    if (!fs.existsSync(filePath)) {
        return true;
    }

    // An empty file has no history that could be lost by overwriting it.
    if ((await fs.promises.stat(filePath)).size === 0) {
        return true;
    }

    // Strip a UTF-8 BOM an external editor may have added before parsing the header.
    const firstLine = await readFirstLine(filePath);
    const jsonData = tryParse(String(firstLine ?? '').replace(/^\uFEFF/, ''));

    // Nonempty malformed headers need the existing explicit overwrite flow.
    if (typeof jsonData !== 'object' || jsonData === null || Array.isArray(jsonData)) {
        console.warn(`File "${filePath}" is not empty, but its first line could not be parsed as a chat header. Overwriting it requires an explicit confirmation.`);
        return false;
    }
    const chatIntegrity = jsonData?.chat_metadata?.integrity;

    // Parsed legacy object headers without integrity metadata remain compatible.
    if (!chatIntegrity) {
        console.debug(`File "${filePath}" does not have integrity metadata matching "${integritySlug}". The integrity validation has been skipped.`);
        return true;
    }

    // Check if the integrity matches
    return chatIntegrity === integritySlug;
}

/**
 * @typedef {Object} ChatInfo
 * @property {string} [file_id] - The name of the chat file (without extension)
 * @property {string} [file_name] - The name of the chat file (with extension)
 * @property {string} [file_size] - The size of the chat file in a human-readable format
 * @property {number} [chat_items] - The number of chat items in the file
 * @property {string} [mes] - The last message in the chat
 * @property {number|string} [last_mes] - The timestamp of the last message
 * @property {object} [chat_metadata] - Additional chat metadata
 * @property {boolean} [match] - Whether the chat matches the search criteria
 */

/**
 * Reads the information from a chat file.
 * @param {string} pathToFile - Path to the chat file
 * @param {object} additionalData - Additional data to include in the result
 * @param {boolean} withMetadata - Whether to read chat metadata
 * @param {ChatMatchFunction|null} matcher - Optional function to match messages
 * @returns {Promise<ChatInfo>}
 *
 * @typedef {(textArray: string[]) => boolean} ChatMatchFunction
 */
export async function getChatInfo(pathToFile, additionalData = {}, withMetadata = false, matcher = null) {
    const parsedPath = path.parse(pathToFile);
    const hasMatcher = (typeof matcher === 'function');

    // A chat that is deleted while a scan is running is not an error: treat it like a corrupted chat and move on.
    const chatVanished = () => {
        console.warn('Chat file was deleted while it was being scanned:', pathToFile);
        return { match: false };
    };

    let stats;
    try {
        stats = await fs.promises.stat(pathToFile);
    } catch (error) {
        if (error.code === 'ENOENT') {
            return chatVanished();
        }
        throw error;
    }

    const chatData = {
        match: false,
        file_id: parsedPath.name,
        file_name: parsedPath.base,
        file_size: formatBytes(stats.size),
        chat_items: 0,
        mes: '[The chat is empty]',
        last_mes: stats.mtimeMs,
        ...additionalData,
    };
    if (stats.size === 0) return chatData;

    return new Promise((resolve, reject) => {
        const fileStream = fs.createReadStream(pathToFile);
        const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
        let lastLine;
        let itemCounter = 0;
        let hasAnyMatch = false;
        let matchBuffer = [];
        let failed = false;
        const fail = error => {
            failed = true;
            if (error.code === 'ENOENT') {
                // The file can still disappear between the stat above and the stream opening or while scanning.
                resolve(chatVanished());
            } else {
                reject(error);
            }
            rl.close();
            fileStream.destroy();
        };
        fileStream.once('error', fail);
        rl.once('error', fail);
        rl.on('line', line => {
            if (failed || !line.trim()) return;
            try {
                if (withMetadata && itemCounter === 0) {
                    const jsonData = tryParse(line);
                    if (jsonData && _.isObjectLike(jsonData.chat_metadata)) chatData.chat_metadata = jsonData.chat_metadata;
                }
                if (hasMatcher && !hasAnyMatch && itemCounter > 0) {
                    const jsonData = tryParse(line);
                    if (jsonData) {
                        if (typeof matcher.accept === 'function') {
                            hasAnyMatch = matcher.accept(jsonData.mes || '');
                        } else {
                            // Preserve support for existing array-based callbacks.
                            matchBuffer.push(jsonData.mes || '');
                            hasAnyMatch = matcher(matchBuffer);
                        }
                        if (hasAnyMatch) matchBuffer = [];
                    }
                }
                itemCounter++;
                lastLine = line;
            } catch (error) {
                fail(error);
            }
        });
        rl.on('close', () => {
            if (failed) return;
            if (!lastLine) return resolve(chatData);
            const jsonData = tryParse(lastLine);
            if (jsonData && (jsonData.name || jsonData.character_name || jsonData.chat_metadata)) {
                chatData.chat_items = Math.max(0, itemCounter - 1);
                chatData.mes = jsonData.mes || '[The message is empty]';
                chatData.last_mes = jsonData.send_date || new Date(Math.round(stats.mtimeMs)).toISOString();
                chatData.match = hasMatcher ? hasAnyMatch : true;
                resolve(chatData);
            } else {
                console.warn('Found an invalid or corrupted last line in a chat file:', pathToFile);
                // Keep identity, stat data, metadata and earlier matches visible without repairing the file.
                // The counter includes nonblank rows; exclude the header and unreadable trailing row.
                chatData.chat_items = Math.max(0, itemCounter - 2);
                chatData.mes = '[The message is empty]';
                chatData.match = hasMatcher ? hasAnyMatch : true;
                resolve(chatData);
            }
        });
    });
}

const getRecentChatInfo = createChatInfoCache((file, metadata) => getChatInfo(file, {}, metadata));

export const router = express.Router();

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error
class IntegrityMismatchError extends Error {
    constructor(...params) {
        // Pass remaining arguments (including vendor specific ones) to parent constructor
        super(...params);
        // Maintains proper stack trace for where our error was thrown (non-standard)
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, IntegrityMismatchError);
        }
        this.date = new Date();
    }
}

/**
 * Tries to save the chat data to a file, performing an integrity check if required.
 * @param {Array} chatData The chat array to save.
 * @param {string} filePath Target file path for the data.
 * @param {boolean} skipIntegrityCheck If undefined, the chat's integrity will not be checked.
 * @param {string} handle The user's handle, part of the backup identity.
 * @param {string} cardName Passed to backupChat.
 * @param {string} backupDirectory Passed to backupChat.
 */
export async function trySaveChat(chatData, filePath, skipIntegrityCheck = false, handle, cardName, backupDirectory, lifecycleRoot = path.dirname(filePath)) {
    await withPathLocks(chatLockPaths([filePath]), async () => {
        await assertChatWritable(filePath, lifecycleRoot);
        const doIntegrityCheck = checkIntegrity && !skipIntegrityCheck;
        const chatIntegritySlug = doIntegrityCheck ? chatData?.[0]?.chat_metadata?.integrity : undefined;
        if (chatIntegritySlug && !await checkChatIntegrity(filePath, chatIntegritySlug)) {
            throw new IntegrityMismatchError(`Chat integrity check failed for "${filePath}". The expected integrity slug was "${chatIntegritySlug}".`);
        }
        const jsonlData = chatData?.map(m => JSON.stringify(m)).join('\n');
        await writeChatFile(filePath, jsonlData);
        if (isBackupEnabled) {
            const key = backupIdentity(handle, filePath);
            const identity = createHash('sha256').update(key).digest('hex');
            backupScheduler.schedule(key, backupDirectory, cardName, jsonlData, identity);
        }
    });
}

router.post('/save', validateAvatarUrlMiddleware, async function (request, response) {
    try {
        const handle = request.user.profile.handle;
        const cardName = String(request.body.avatar_url).replace('.png', '');
        const chatData = request.body.chat;
        const chatFileName = `${String(request.body.file_name)}.jsonl`;
        const chatFilePath = path.join(request.user.directories.chats, cardName, sanitize(chatFileName));
        if (!isPathUnderParent(request.user.directories.chats, chatFilePath)) {
            return response.sendStatus(400);
        }

        if (Array.isArray(chatData)) {
            await trySaveChat(chatData, chatFilePath, request.body.force, handle, cardName, request.user.directories.backups, request.user.directories.chats);
            return response.send({ ok: true });
        } else {
            return response.status(400).send({ error: 'The request\'s body.chat is not an array.' });
        }
    } catch (error) {
        if (error instanceof ChatLifecycleError) return response.status(409).send({ error: 'chat_lifecycle', reason: error.reason, action: 'reload_or_save_as' });
        if (error instanceof IntegrityMismatchError) {
            console.error(error.message);
            return response.status(400).send({ error: 'integrity' });
        }
        console.error(error);
        return response.status(500).send({ error: 'An error has occurred, see the console logs for more information.' });
    }
});

/**
 * Gets the chat as an object.
 * @param {string} chatFilePath The full chat file path.
 * @returns {Array}} If the chatFilePath cannot be read, this will return [].
 */
export async function getChatData(chatFilePath) {
    try {
        const chatJSON = await fs.promises.readFile(chatFilePath, 'utf8');
        if (chatJSON.length > 0) return chatJSON.split('\n').map(line => tryParse(line)).filter(Boolean);
    } catch (error) {
        if (error.code !== 'ENOENT') console.error(`Error reading ${chatFilePath}: ${error.message}`);
    }
    console.warn(`File not found: ${chatFilePath}. The chat does not exist or is empty.`);
    return [];
}

router.post('/get', validateAvatarUrlMiddleware, async function (request, response) {
    try {
        const dirName = String(request.body.avatar_url).replace('.png', '');
        const directoryPath = path.join(request.user.directories.chats, dirName);
        if (!isPathUnderParent(request.user.directories.chats, directoryPath)) {
            return response.sendStatus(400);
        }
        const chatFileName = `${String(request.body.file_name)}.jsonl`;
        const chatFilePath = path.join(directoryPath, sanitize(chatFileName));
        return await withPathLocks(chatLockPaths([chatFilePath]), async () => {
            await assertChatWritable(chatFilePath, request.user.directories.chats);
            if (!fs.existsSync(directoryPath)) {
                await fs.promises.mkdir(directoryPath, { recursive: true });
                return response.send({});
            }
            if (!request.body.file_name) return response.send({});
            return response.send(await getChatData(chatFilePath));
        });
    } catch (error) {
        if (error instanceof ChatLifecycleError) return response.status(409).send({ error: 'chat_lifecycle', reason: error.reason, action: 'reload_or_save_as' });
        console.error(error);
        return response.send({});
    }
});

router.post('/rename', validateAvatarUrlMiddleware, async function (request, response) {
    try {
        if (!request.body || !request.body.original_file || !request.body.renamed_file) {
            return response.sendStatus(400);
        }

        const pathToFolder = request.body.is_group
            ? request.user.directories.groupChats
            : path.join(request.user.directories.chats, String(request.body.avatar_url).replace('.png', ''));
        if (!request.body.is_group && !isPathUnderParent(request.user.directories.chats, pathToFolder)) {
            return response.sendStatus(400);
        }
        const pathToOriginalFile = path.join(pathToFolder, sanitize(request.body.original_file));
        const pathToRenamedFile = path.join(pathToFolder, sanitize(request.body.renamed_file));
        const sanitizedFileName = path.parse(pathToRenamedFile).name;
        console.debug('Old chat name', pathToOriginalFile);
        console.debug('New chat name', pathToRenamedFile);

        const lifecycleRoot = request.body.is_group ? request.user.directories.groupChats : request.user.directories.chats;
        await withPathLocks(chatLockPaths([pathToOriginalFile, pathToRenamedFile]), async () => {
            await renameChatFile(pathToOriginalFile, pathToRenamedFile, lifecycleRoot);
        });
        console.info('Successfully renamed chat file.');
        return response.send({ ok: true, sanitizedFileName });
    } catch (error) {
        if (error instanceof ChatLifecycleError) return response.status(409).send({ error: 'chat_lifecycle', reason: error.reason, action: 'reload_or_save_as' });
        console.error('Error renaming chat file:', error);
        return response.status(500).send({ error: true });
    }
});

router.post('/delete', validateAvatarUrlMiddleware, async function (request, response) {
    try {
        if (!path.extname(request.body.chatfile)) {
            request.body.chatfile += '.jsonl';
        }

        const dirName = String(request.body.avatar_url).replace('.png', '');
        const chatFileName = String(request.body.chatfile);
        const chatFilePath = path.join(request.user.directories.chats, dirName, sanitize(chatFileName));
        if (!isPathUnderParent(request.user.directories.chats, chatFilePath)) {
            return response.sendStatus(400);
        }
        await withPathLocks(chatLockPaths([chatFilePath]), async () => {
            await recycleRetiredChat(chatFilePath, request.user.directories.chats);
        });
        return response.send({ ok: true });
    } catch (error) {
        if (error instanceof ChatLifecycleError) return response.status(409).send({ error: 'chat_lifecycle', reason: error.reason, action: 'reload_or_save_as' });
        if (error.code === 'ENOENT') return response.sendStatus(400);
        console.error(error);
        return response.sendStatus(500);
    }
});

router.post('/export', validateAvatarUrlMiddleware, async function (request, response) {
    if (!request.body.file || (!request.body.avatar_url && request.body.is_group === false)) {
        return response.sendStatus(400);
    }
    const pathToFolder = request.body.is_group
        ? request.user.directories.groupChats
        : path.join(request.user.directories.chats, String(request.body.avatar_url).replace('.png', ''));
    const filename = path.join(pathToFolder, sanitize(request.body.file));
    if (!request.body.is_group && !isPathUnderParent(request.user.directories.chats, filename)) {
        return response.sendStatus(400);
    }
    let exportfilename = request.body.exportfilename;
    if (!fs.existsSync(filename)) {
        const errorMessage = {
            message: `Could not find JSONL file to export. Source chat file: ${filename}.`,
        };
        console.error(errorMessage.message);
        return response.status(404).json(errorMessage);
    }
    try {
        // Short path for JSONL files
        if (request.body.format === 'jsonl') {
            try {
                const rawFile = fs.readFileSync(filename, 'utf8');
                const successMessage = {
                    message: `Chat saved to ${exportfilename}`,
                    result: rawFile,
                };

                console.info(`Chat exported as ${exportfilename}`);
                return response.status(200).json(successMessage);
            } catch (err) {
                console.error(err);
                const errorMessage = {
                    message: `Could not read JSONL file to export. Source chat file: ${filename}.`,
                };
                console.error(errorMessage.message);
                return response.status(500).json(errorMessage);
            }
        }

        const readStream = fs.createReadStream(filename);
        const rl = readline.createInterface({
            input: readStream,
        });
        let buffer = '';
        rl.on('line', (line) => {
            const data = JSON.parse(line);
            // Skip non-printable/prompt-hidden messages
            if (data.is_system) {
                return;
            }
            if (data.mes) {
                const name = data.name;
                const message = (data?.extra?.display_text || data?.mes || '').replace(/\r?\n/g, '\n');
                buffer += (`${name}: ${message}\n\n`);
            }
        });
        rl.on('close', () => {
            const successMessage = {
                message: `Chat saved to ${exportfilename}`,
                result: buffer,
            };
            console.info(`Chat exported as ${exportfilename}`);
            return response.status(200).json(successMessage);
        });
    } catch (err) {
        console.error('chat export failed.', err);
        return response.sendStatus(400);
    }
});

function validateImportedChat(data) {
    const lines = data.split('\n').filter(line => line.trim());
    if (!lines.length) throw new Error('Empty chat import');
    const objects = lines.map(line => JSON.parse(line));
    if (objects.some(value => !value || typeof value !== 'object' || Array.isArray(value))) throw new Error('Invalid chat JSONL object');
    const header = objects[0];
    if (!(header.user_name !== undefined || header.name !== undefined || header.chat_metadata !== undefined)) throw new Error('Invalid chat header');
    return data;
}

router.post('/group/import', async function (request, response) {
    try {
        const filedata = request.file;

        if (!filedata) {
            return response.sendStatus(400);
        }

        const chatname = `${humanizedDateTime()}-${randomUUID()}`;
        const pathToUpload = path.join(filedata.destination, filedata.filename);
        const pathToNewFile = path.join(request.user.directories.groupChats, `${chatname}.jsonl`);
        const data = validateImportedChat(await fs.promises.readFile(pathToUpload, 'utf8'));
        await withPathLocks(chatLockPaths([pathToNewFile]), async () => {
            await assertChatWritable(pathToNewFile, request.user.directories.groupChats);
            await createChatFileExclusive(pathToNewFile, data);
        });
        // Publication is complete. Failure to archive the upload leaves it in place.
        await recycleChatPath(pathToUpload).catch(error => console.error('Imported upload retained in place', error));
        return response.send({ res: chatname });
    } catch (error) {
        if (error instanceof ChatLifecycleError) return response.status(409).send({ error: 'chat_lifecycle', reason: error.reason, action: 'reload_or_save_as' });
        console.error(error);
        return response.status(400).send({ error: true });
    }
});

router.post('/import', validateAvatarUrlMiddleware, async function (request, response) {
    if (!request.body || typeof request.body.avatar_url !== 'string' || !request.body.avatar_url
        || (request.body.character_name !== undefined && typeof request.body.character_name !== 'string')
        || (request.body.user_name !== undefined && typeof request.body.user_name !== 'string')) return response.sendStatus(400);

    const format = request.body.file_type;
    if (!['json', 'jsonl'].includes(format)) return response.status(400).send({ error: 'unsupported_format' });
    const avatarUrl = (request.body.avatar_url).replace('.png', '');
    const characterName = sanitize(request.body.character_name ?? '') || 'Character';
    const userName = sanitize(request.body.user_name ?? '') || 'User';
    const fileNames = [];

    if (!request.file) {
        return response.sendStatus(400);
    }

    const directoryPath = path.join(request.user.directories.chats, avatarUrl);
    if (!isPathUnderParent(request.user.directories.chats, directoryPath)) {
        return response.sendStatus(400);
    }

    try {
        const pathToUpload = path.join(request.file.destination, request.file.filename);
        const data = await fs.promises.readFile(pathToUpload, 'utf8');
        let importedChats;

        if (format === 'json') {
            const jsonData = JSON.parse(data);

            /** @type {function(string, string, object): string|string[]} */
            let importFunc;

            if (jsonData.savedsettings !== undefined) { // Kobold Lite format
                importFunc = importKoboldLiteChat;
            } else if (jsonData.histories !== undefined) { // CAI Tools format
                importFunc = importCAIChat;
            } else if (Array.isArray(jsonData.data_visible)) { // oobabooga's format
                importFunc = importOobaChat;
            } else if (Array.isArray(jsonData.messages)) { // Agnai's format
                importFunc = importAgnaiChat;
            } else if (jsonData.type === 'risuChat') { // RisuAI format
                importFunc = importRisuChat;
            } else { // Unknown format
                console.error('Incorrect chat format .json');
                return response.status(400).send({ error: true });
            }

            const chat = importFunc(userName, characterName, jsonData);
            importedChats = Array.isArray(chat) ? chat : [chat];
        }

        if (format === 'jsonl') {
            let lines = data.split('\n');
            const header = lines[0];

            const jsonData = JSON.parse(header);

            if (!(jsonData.user_name !== undefined || jsonData.name !== undefined || jsonData.chat_metadata !== undefined)) {
                console.error('Incorrect chat format .jsonl');
                return response.status(400).send({ error: true });
            }

            // Do a tiny bit of work to import Chub Chat data
            // Processing the entire file is so fast that it's not worth checking if it's a Chub chat first
            let flattenedChat = data;
            try {
                // flattening is unlikely to break, but it's not worth failing to
                // import normal chats in an attempt to import a Chub chat
                flattenedChat = flattenChubChat(userName, characterName, lines);
            } catch (error) {
                console.warn('Failed to flatten Chub Chat data: ', error);
            }

            importedChats = [flattenedChat];
        }
        if (!importedChats?.length) return response.status(400).send({ error: 'empty_import' });
        // Validate the complete batch before publishing any destination.
        importedChats.forEach(validateImportedChat);
        importedChats.forEach(() => fileNames.push(`${characterName} - ${humanizedDateTime()}-${randomUUID()} imported.jsonl`));
        const paths = fileNames.map(name => path.join(directoryPath, name));
        await withPathLocks(chatLockPaths(paths), async () => {
            const published = [];
            try {
                for (let index = 0; index < paths.length; index++) {
                    await assertChatWritable(paths[index], request.user.directories.chats);
                    await createChatFileExclusive(paths[index], importedChats[index]);
                    published.push(paths[index]);
                }
            } catch (error) {
                for (const candidate of published) await recycleChatPath(candidate, request.user.directories.chats).catch(recoveryError => console.error('Failed import candidate retained in place', recoveryError));
                throw error;
            }
        });
        await recycleChatPath(pathToUpload).catch(error => console.error('Imported upload retained in place', error));
        return response.send({ res: true, fileNames });
    } catch (error) {
        if (error instanceof ChatLifecycleError) return response.status(409).send({ error: 'chat_lifecycle', reason: error.reason, action: 'reload_or_save_as' });
        console.error(error);
        return response.status(400).send({ error: true });
    }
});

router.post('/group/get', async (request, response) => {
    if (!request.body || !request.body.id) {
        return response.sendStatus(400);
    }

    const id = request.body.id;
    const chatFilePath = path.join(request.user.directories.groupChats, sanitize(`${id}.jsonl`));

    try {
        return await withPathLocks(chatLockPaths([chatFilePath]), async () => {
            await assertChatWritable(chatFilePath, request.user.directories.groupChats);
            return response.send(await getChatData(chatFilePath));
        });
    } catch (error) {
        if (error instanceof ChatLifecycleError) return response.status(409).send({ error: 'chat_lifecycle', reason: error.reason, action: 'reload_or_save_as' });
        console.error(error); return response.sendStatus(500);
    }
});

router.post('/group/info', async (request, response) => {
    try {
        if (!request.body || !request.body.id) {
            return response.sendStatus(400);
        }

        const id = request.body.id;
        const chatFilePath = path.join(request.user.directories.groupChats, sanitize(`${id}.jsonl`));

        const chatInfo = await getChatInfo(chatFilePath);
        return response.send(chatInfo);
    } catch (error) {
        console.error(error);
        return response.sendStatus(500);
    }
});

router.post('/group/delete', async (request, response) => {
    try {
        if (!request.body || !request.body.id) {
            return response.sendStatus(400);
        }

        const id = request.body.id;
        const chatFilePath = path.join(request.user.directories.groupChats, sanitize(`${id}.jsonl`));

        await withPathLocks(chatLockPaths([chatFilePath]), async () => {
            await recycleRetiredChat(chatFilePath, request.user.directories.groupChats);
        });
        return response.send({ ok: true });
    } catch (error) {
        if (error instanceof ChatLifecycleError) return response.status(409).send({ error: 'chat_lifecycle', reason: error.reason, action: 'reload_or_save_as' });
        if (error.code === 'ENOENT') return response.sendStatus(400);
        console.error(error);
        return response.sendStatus(500);
    }
});

router.post('/group/save', async function (request, response) {
    try {
        if (!request.body || !request.body.id) {
            return response.sendStatus(400);
        }

        const id = request.body.id;
        const handle = request.user.profile.handle;
        const chatFilePath = path.join(request.user.directories.groupChats, sanitize(`${id}.jsonl`));
        const chatData = request.body.chat;

        if (Array.isArray(chatData)) {
            await trySaveChat(chatData, chatFilePath, request.body.force, handle, String(id), request.user.directories.backups, request.user.directories.groupChats);
            return response.send({ ok: true });
        } else {
            return response.status(400).send({ error: 'The request\'s body.chat is not an array.' });
        }
    } catch (error) {
        if (error instanceof ChatLifecycleError) return response.status(409).send({ error: 'chat_lifecycle', reason: error.reason, action: 'reload_or_save_as' });
        if (error instanceof IntegrityMismatchError) {
            console.error(error.message);
            return response.status(400).send({ error: 'integrity' });
        }
        console.error(error);
        return response.status(500).send({ error: 'An error has occurred, see the console logs for more information.' });
    }
});

router.post('/search', validateAvatarUrlMiddleware, async function (request, response) {
    try {
        const { query, avatar_url, group_id } = request.body;

        /** @type {string[]} */
        let chatFiles = [];

        if (group_id) {
            // Find group's chat IDs first
            const groupDir = path.join(request.user.directories.groups);
            const groupFiles = fs.readdirSync(groupDir)
                .filter(file => path.extname(file) === '.json');

            let targetGroup;
            for (const groupFile of groupFiles) {
                try {
                    const groupData = JSON.parse(fs.readFileSync(path.join(groupDir, groupFile), 'utf8'));
                    if (groupData.id === group_id) {
                        targetGroup = groupData;
                        break;
                    }
                } catch (error) {
                    console.warn(groupFile, 'group file is corrupted:', error);
                }
            }

            if (!Array.isArray(targetGroup?.chats)) {
                return response.send([]);
            }

            // Find group chat files for given group ID
            const groupChatsDir = path.join(request.user.directories.groupChats);
            chatFiles = targetGroup.chats
                .map(chatId => path.join(groupChatsDir, `${chatId}.jsonl`))
                .filter(fileName => fs.existsSync(fileName));
        } else {
            // Regular character chat directory
            const character_name = avatar_url.replace('.png', '');
            const directoryPath = path.join(request.user.directories.chats, character_name);

            if (!fs.existsSync(directoryPath)) {
                return response.send([]);
            }

            chatFiles = fs.readdirSync(directoryPath)
                .filter(file => path.extname(file) === '.jsonl')
                .map(fileName => path.join(directoryPath, fileName));
        }

        /**
         * @type {SearchChatResult[]}
         * @typedef {object} SearchChatResult
         * @property {string} [file_name] - The name of the chat file
         * @property {string} [file_size] - The size of the chat file in a human-readable format
         * @property {number} [message_count] - The number of messages in the chat
         * @property {number|string} [last_mes] - The timestamp of the last message
         * @property {string} [preview_message] - A preview of the last message
         */
        const results = [];

        /** @type {string[]} */
        const fragments = query ? query.trim().toLowerCase().split(/\s+/).filter(x => x) : [];

        /** @type {ChatMatchFunction} */
        const hasTextMatch = (textArray) => {
            if (fragments.length === 0) {
                return true;
            }
            return fragments.every(fragment => textArray.some(text => String(text ?? '').toLowerCase().includes(fragment)));
        };

        for (const chatFile of chatFiles) {
            const matcher = query ? createTextMatcher(fragments) : null;
            const chatInfo = await getChatInfo(chatFile, {}, false, matcher);
            const hasMatch = chatInfo.match || hasTextMatch([chatInfo.file_id ?? '']);

            // Skip corrupted or invalid chat files
            if (!chatInfo.file_name) {
                continue;
            }

            // Empty chats without a file name match are skipped when searching with a query
            if (query && chatInfo.chat_items === 0 && !hasMatch) {
                continue;
            }

            // If no search query or a match was found, include the chat in results
            if (!query || hasMatch) {
                results.push({
                    file_name: chatInfo.file_id,
                    file_size: chatInfo.file_size,
                    message_count: chatInfo.chat_items,
                    last_mes: chatInfo.last_mes,
                    preview_message: getPreviewMessage(chatInfo.mes),
                });
            }
        }

        return response.send(results);
    } catch (error) {
        console.error('Chat search error:', error);
        return response.status(500).json({ error: 'Search failed' });
    }
});

router.post('/recent', async function (request, response) {
    try {
        /** @typedef {{pngFile?: string, groupId?: string, filePath: string, mtime: number}} ChatFile */
        /** @type {ChatFile[]} */
        const allChatFiles = [];
        /** @type {import('../../public/scripts/welcome-screen.js').PinnedChat[]} */
        const pinnedChats = Array.isArray(request.body.pinned) ? request.body.pinned : [];

        const getCharacterChatFiles = async () => {
            const pngDirents = await fs.promises.readdir(request.user.directories.characters, { withFileTypes: true });
            const pngFiles = pngDirents.filter(e => e.isFile() && path.extname(e.name) === '.png').map(e => e.name);

            for (const pngFile of pngFiles) {
                const chatsDirectory = pngFile.replace('.png', '');
                const pathToChats = path.join(request.user.directories.chats, chatsDirectory);
                if (!fs.existsSync(pathToChats)) {
                    continue;
                }
                const pathStats = await fs.promises.stat(pathToChats);
                if (pathStats.isDirectory()) {
                    const chatFiles = await fs.promises.readdir(pathToChats);
                    const jsonlFiles = chatFiles.filter(file => path.extname(file) === '.jsonl');

                    for (const file of jsonlFiles) {
                        const filePath = path.join(pathToChats, file);
                        const stats = await fs.promises.stat(filePath);
                        allChatFiles.push({ pngFile, filePath, mtime: stats.mtimeMs });
                    }
                }
            }
        };

        const getGroupChatFiles = async () => {
            const groupDirents = await fs.promises.readdir(request.user.directories.groups, { withFileTypes: true });
            const groups = groupDirents.filter(e => e.isFile() && path.extname(e.name) === '.json').map(e => e.name);

            for (const group of groups) {
                try {
                    const groupPath = path.join(request.user.directories.groups, group);
                    const groupContents = await fs.promises.readFile(groupPath, 'utf8');
                    const groupData = JSON.parse(groupContents);

                    if (Array.isArray(groupData.chats)) {
                        for (const chat of groupData.chats) {
                            const filePath = path.join(request.user.directories.groupChats, `${chat}.jsonl`);
                            if (!fs.existsSync(filePath)) {
                                continue;
                            }
                            const stats = await fs.promises.stat(filePath);
                            allChatFiles.push({ groupId: groupData.id, filePath, mtime: stats.mtimeMs });
                        }
                    }
                } catch (error) {
                    // Skip group files that can't be read or parsed
                    continue;
                }
            }
        };

        const getRootChatFiles = async () => {
            const dirents = await fs.promises.readdir(request.user.directories.chats, { withFileTypes: true });
            const chatFiles = dirents.filter(e => e.isFile() && path.extname(e.name) === '.jsonl').map(e => e.name);

            for (const file of chatFiles) {
                const filePath = path.join(request.user.directories.chats, file);
                const stats = await fs.promises.stat(filePath);
                allChatFiles.push({ filePath, mtime: stats.mtimeMs });
            }
        };

        await Promise.allSettled([getCharacterChatFiles(), getGroupChatFiles(), getRootChatFiles()]);

        const max = parseInt(request.body.max ?? Number.MAX_SAFE_INTEGER) + pinnedChats.length;
        const isPinned = (/** @type {ChatFile} */ chatFile) => pinnedChats.some(p => p.file_name === path.basename(chatFile.filePath) && (p.avatar === chatFile.pngFile || p.group === chatFile.groupId));
        const recentChats = allChatFiles.sort((a, b) => {
            const isAPinned = isPinned(a);
            const isBPinned = isPinned(b);

            if (isAPinned && !isBPinned) return -1;
            if (!isAPinned && isBPinned) return 1;

            return b.mtime - a.mtime;
        }).slice(0, max);
        const jsonFilesPromise = recentChats.map((file) => {
            const withMetadata = !!request.body.metadata;
            return file.groupId
                ? getRecentChatInfo(file.filePath, { group: file.groupId }, withMetadata)
                : getRecentChatInfo(file.filePath, { avatar: file.pngFile }, withMetadata);
        });

        const chatData = (await Promise.allSettled(jsonFilesPromise)).filter(x => x.status === 'fulfilled').map(x => x.value);
        const validFiles = chatData.filter(i => i.file_name);

        return response.send(validFiles);
    } catch (error) {
        console.error(error);
        return response.sendStatus(500);
    }
});
