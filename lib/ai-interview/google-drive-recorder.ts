import { google } from 'googleapis';

export interface DriveCredentials {
  client_email: string;
  private_key: string;
  project_id?: string;
}

/**
 * Loads and parses Google Drive service account credentials from environment variables.
 * Fallbacks across standard naming conventions:
 * 1. DRIVE_SERVICE_ACCOUNT_KEY_JSON
 * 2. DRIVE_SERVICE_ACCOUNT_KEY
 * 3. GOOGLE_SERVICE_ACCOUNT_KEY
 */
export function getDriveCredentials(): DriveCredentials | null {
  const envKey =
    process.env.DRIVE_SERVICE_ACCOUNT_KEY_JSON ||
    process.env.DRIVE_SERVICE_ACCOUNT_KEY ||
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS;

  // Check separate environment variables if provided
  if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
    return {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    };
  }

  if (!envKey) {
    return null;
  }

  const trimmed = envKey.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed.client_email && parsed.private_key) {
        return {
          client_email: parsed.client_email,
          private_key: parsed.private_key.replace(/\\n/g, '\n'),
          project_id: parsed.project_id,
        };
      }
    } catch (err: unknown) {
      console.warn('[google-drive-recorder] Failed to parse credentials JSON string:', err);
    }
  }

  // Fallback: Check if environment variable points to a file path
  try {
    const fs = require('fs');
    const path = require('path');
    const resolvedPath = path.resolve(trimmed);
    if (fs.existsSync(resolvedPath)) {
      const content = fs.readFileSync(resolvedPath, 'utf8');
      const parsed = JSON.parse(content);
      if (parsed.client_email && parsed.private_key) {
        return {
          client_email: parsed.client_email,
          private_key: parsed.private_key.replace(/\\n/g, '\n'),
          project_id: parsed.project_id,
        };
      }
    }
  } catch (err: unknown) {
    console.warn('[google-drive-recorder] Failed to load credentials from file path:', err);
  }

  return null;
}

/**
 * Returns an authorized Google Drive client.
 */
export function getDriveClient() {
  const credentials = getDriveCredentials();
  if (!credentials) {
    throw new Error('Google Drive credentials are not configured in environment variables.');
  }

  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ['https://www.googleapis.com/auth/drive'],
  });

  return google.drive({ version: 'v3', auth });
}

/**
 * Resolves the Google Drive folder ID for interview recordings.
 */
export function getRecordingFolderId(): string | null {
  return (
    process.env.INTERVIEW_RECORDING_DRIVE_FOLDER_ID ||
    process.env.RECORDING_DRIVE_FOLDER_ID ||
    process.env.DRIVE_FOLDER_ID ||
    null
  );
}

/**
 * Initiates a Resumable Upload Session with Google Drive.
 * Returns the resumable upload URL where the browser can directly PUT the whole video file.
 */
export async function createDriveResumableUploadSession(params: {
  interviewId: string;
  candidateName?: string;
  mimeType?: string;
  fileSize?: number;
}): Promise<{ uploadUrl: string; fileName: string }> {
  const credentials = getDriveCredentials();
  if (!credentials) {
    throw new Error('Google Drive service account credentials are missing.');
  }

  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ['https://www.googleapis.com/auth/drive'],
  });

  const tokenRes = await auth.getAccessToken();
  const accessToken = tokenRes?.token;
  if (!accessToken) {
    throw new Error('Failed to obtain Google Drive OAuth access token.');
  }

  const safeName = (params.candidateName || 'candidate')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .toLowerCase();
  const dateStr = new Date().toISOString().slice(0, 10);
  const fileName = `interview_${safeName}_${params.interviewId.slice(0, 8)}_${dateStr}.webm`;
  const mimeType = params.mimeType || 'video/webm';

  const folderId = getRecordingFolderId();
  const metadata: Record<string, unknown> = {
    name: fileName,
    mimeType,
    description: `Full AI Interview video recording for session ${params.interviewId}`,
  };

  if (folderId) {
    metadata.parents = [folderId];
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json; charset=UTF-8',
    'X-Upload-Content-Type': mimeType,
  };

  if (typeof params.fileSize === 'number' && Number.isFinite(params.fileSize) && params.fileSize > 0) {
    headers['X-Upload-Content-Length'] = params.fileSize.toString();
  }

  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true', {
    method: 'POST',
    headers,
    body: JSON.stringify(metadata),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    throw new Error(`Google Drive API failed to initiate resumable upload session (${res.status}): ${errorText}`);
  }

  const uploadUrl = res.headers.get('Location');
  if (!uploadUrl) {
    throw new Error('Google Drive did not return a Location header for the resumable session.');
  }

  return { uploadUrl, fileName };
}

/**
 * Sets file permissions to anyone-with-link read-only and retrieves webViewLink & webContentLink.
 */
export async function finalizeDriveFile(fileId: string): Promise<{
  fileId: string;
  webViewLink: string;
  previewUrl: string;
  webContentLink?: string;
}> {
  const drive = getDriveClient();

  // Make file viewable by anyone with the link (or domain) so HR can review smoothly
  try {
    await drive.permissions.create({
      fileId,
      requestBody: {
        role: 'reader',
        type: 'anyone',
      },
    });
  } catch (err: unknown) {
    console.warn(`[google-drive-recorder] Setting permission for file ${fileId} notice:`, err);
  }

  // Fetch file metadata with webViewLink and webContentLink
  const fileMeta = await drive.files.get({
    fileId,
    fields: 'id, name, webViewLink, webContentLink',
  });

  const webViewLink = fileMeta.data.webViewLink || `https://drive.google.com/file/d/${fileId}/view`;
  const previewUrl = `https://drive.google.com/file/d/${fileId}/preview`;
  const webContentLink = fileMeta.data.webContentLink || undefined;

  return {
    fileId,
    webViewLink,
    previewUrl,
    webContentLink,
  };
}
