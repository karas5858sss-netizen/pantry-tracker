import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function getAllFiles(dirPath: string, arrayOfFiles: string[] = []): string[] {
  if (!fs.existsSync(dirPath)) return arrayOfFiles;
  const files = fs.readdirSync(dirPath);

  for (const file of files) {
    const fullPath = path.join(dirPath, file);
    if (fs.statSync(fullPath).isDirectory()) {
      getAllFiles(fullPath, arrayOfFiles);
    } else {
      arrayOfFiles.push(fullPath);
    }
  }

  return arrayOfFiles;
}

describe('Security Guard Tests', () => {
  const srcFiles = getAllFiles(path.resolve(process.cwd(), 'src')).filter(
    (f) => f.endsWith('.ts') || f.endsWith('.tsx') || f.endsWith('.js')
  );

  it('ensures no service role key is ever referenced in frontend (src/)', () => {
    for (const file of srcFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      expect(content).not.toContain('service_role');
      expect(content).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
    }
  });

  it('ensures initDataUnsafe is never used for authorization headers or auth requests in src/', () => {
    for (const file of srcFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      // initDataUnsafe can only be used for cosmetic display (user info), never in Authorization
      expect(content).not.toMatch(/Authorization:\s*`?[a-zA-Z0-9_\s]*initDataUnsafe/i);
      expect(content).not.toMatch(/headers:[\s\S]*initDataUnsafe/i);
    }
  });
});
