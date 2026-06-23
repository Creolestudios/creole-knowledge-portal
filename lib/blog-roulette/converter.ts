import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

const execAsync = promisify(exec);

/**
 * Converts HTML to Markdown using Turndown.
 */
export function convertHtmlToMarkdown(htmlContent: string): string {
  const turndownService = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
  });
  turndownService.use(gfm);
  return turndownService.turndown(htmlContent);
}

/**
 * Converts Markdown content to a .docx Buffer using the system's Pandoc installation.
 * If Pandoc is not installed, it throws an error.
 */
export async function convertMarkdownToDocx(
  blog: { id: string; title: string; body_md?: string | null; body_html?: string | null }
): Promise<Buffer> {
  // Extract or generate markdown content
  let markdown = blog.body_md || '';
  if (!markdown && blog.body_html) {
    markdown = convertHtmlToMarkdown(blog.body_html);
  }

  // Prepend title as an H1 if it's not already there
  if (blog.title && !markdown.startsWith('# ')) {
    markdown = `# ${blog.title}\n\n${markdown}`;
  }

  const tempDir = os.tmpdir();
  const fileId = `${blog.id}_${Date.now()}`;
  const tempMdPath = path.join(tempDir, `roulette_${fileId}.md`);
  const tempDocxPath = path.join(tempDir, `roulette_${fileId}.docx`);

  try {
    // 1. Write markdown to temp file
    await fs.writeFile(tempMdPath, markdown, 'utf-8');

    // 2. Execute Pandoc to convert to .docx
    try {
      await execAsync(`pandoc "${tempMdPath}" -o "${tempDocxPath}"`);
    } catch (err: any) {
      console.error('[converter] Pandoc execution failed:', err);
      throw new Error(
        `Pandoc conversion failed. Ensure pandoc is installed on the host system. Error: ${err.message}`
      );
    }

    // 3. Read generated docx file into buffer
    const docxBuffer = await fs.readFile(tempDocxPath);
    return docxBuffer;
  } finally {
    // 4. Clean up temporary files
    await fs.unlink(tempMdPath).catch(() => {});
    await fs.unlink(tempDocxPath).catch(() => {});
  }
}
