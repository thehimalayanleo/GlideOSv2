import { copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();
const dist = join(root, 'dist');

await mkdir(dist, { recursive: true });
await copyFile(join(root, 'orchestrator-v4.html'), join(dist, 'index.html'));
await copyFile(join(root, 'orchestrator-v4.html'), join(dist, 'orchestrator-v4.html'));

console.log('Built GlideOS Cloudflare Pages output in dist/');
