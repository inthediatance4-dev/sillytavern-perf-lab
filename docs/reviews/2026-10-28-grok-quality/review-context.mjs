import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const materialDirectory = path.dirname(fileURLToPath(import.meta.url));
export const repository = path.resolve(materialDirectory, '../../..');
export const source = path.resolve(process.env.REVIEW_SOURCE || repository);
// Keep every run's synthetic files. No production data root is used.
export const review = process.env.REVIEW_OUTPUT
    ? path.resolve(process.env.REVIEW_OUTPUT)
    : fs.mkdtempSync(path.join(os.tmpdir(), 'st-grok-review-'));
process.env.REVIEW_OUTPUT = review;
fs.mkdirSync(path.join(review, 'temp'), { recursive: true });
// Child Node processes also retain deletions instead of permanently removing files.
const guard = new URL('./preserve-deletions.mjs', import.meta.url).href;
if (!(process.env.NODE_OPTIONS || '').includes(guard)) {
    process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS || ''} --import=${guard}`.trim();
}
