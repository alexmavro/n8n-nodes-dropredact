import { cpSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

cpSync(
  join(root, 'nodes', 'Dropredact', 'dropredact.svg'),
  join(root, 'dist', 'nodes', 'Dropredact', 'dropredact.svg'),
);
