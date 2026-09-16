import { randomInt } from 'crypto';

export const ALLOWED_DOCUMENT_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
]);

export const MAX_DOCUMENT_SIZE = 10 * 1024 * 1024; // 10 MB
export const MAX_JD_TEXT_LENGTH = 20000;

export interface IFileValidationError {
  error: string;
}

/** Validates a resume/JD upload's type and size. Returns null when valid. */
export function validateDocumentFile(file: File | null, label: string): IFileValidationError | null {
  if (!file) {
    return { error: `${label} is required` };
  }
  if (!ALLOWED_DOCUMENT_TYPES.has(file.type)) {
    return { error: `${label}: unsupported file type "${file.type}". Allowed: PDF, DOC, DOCX, TXT` };
  }
  if (file.size > MAX_DOCUMENT_SIZE) {
    return { error: `${label}: file too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max: 10 MB` };
  }
  return null;
}

/**
 * 6-digit numeric passcode — easy for a candidate to type in, not guessable
 * in a handful of tries given the link itself is unguessable. Uses a CSPRNG
 * rather than Math.random() since this is a security credential.
 */
export function generateAccessCode(): string {
  return randomInt(100000, 1000000).toString();
}
