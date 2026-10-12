import { describe, it, expect } from 'vitest';
import { validateDocumentFile, generateAccessCode, MAX_DOCUMENT_SIZE } from './validators';

function makeFile(name: string, type: string, content = 'x'.repeat(10)) {
  return new File([content], name, { type });
}

describe('validateDocumentFile', () => {
  it('rejects a missing file', () => {
    expect(validateDocumentFile(null, 'Resume')).toEqual({ error: 'Resume is required' });
  });

  it('rejects an unsupported type', () => {
    const result = validateDocumentFile(makeFile('a.exe', 'application/x-msdownload'), 'Resume');
    expect(result?.error).toMatch(/unsupported file type/i);
  });

  it('rejects a file over the size limit', () => {
    const big = 'x'.repeat(MAX_DOCUMENT_SIZE + 1);
    const result = validateDocumentFile(makeFile('a.pdf', 'application/pdf', big), 'Resume');
    expect(result?.error).toMatch(/too large/i);
  });

  it('accepts a valid PDF', () => {
    expect(validateDocumentFile(makeFile('a.pdf', 'application/pdf'), 'Resume')).toBeNull();
  });

  it('accepts a valid DOCX', () => {
    expect(
      validateDocumentFile(
        makeFile('a.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
        'Resume',
      ),
    ).toBeNull();
  });
});

describe('generateAccessCode', () => {
  it('always returns a 6-digit numeric string', () => {
    for (let i = 0; i < 50; i++) {
      const code = generateAccessCode();
      expect(code).toMatch(/^\d{6}$/);
    }
  });

  it('produces varied codes across calls', () => {
    const codes = new Set(Array.from({ length: 20 }, () => generateAccessCode()));
    expect(codes.size).toBeGreaterThan(1);
  });
});
