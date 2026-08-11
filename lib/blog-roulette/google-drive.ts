import { google } from 'googleapis';
import { Readable } from 'stream';

/**
 * Parses and loads the Google Service Account Credentials from the environment.
 * Supports inline JSON strings or paths to a credentials JSON file.
 */
function getCredentials() {
  const envKey =
    process.env.DRIVE_SERVICE_ACCOUNT_KEY_JSON ||
    process.env.DRIVE_SERVICE_ACCOUNT_KEY;

  if (!envKey) {
    throw new Error(
      'Google Drive service account credentials (DRIVE_SERVICE_ACCOUNT_KEY_JSON) are not configured in environment variables.'
    );
  }

  const trimmed = envKey.trim();
  if (trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed);
    } catch (err: any) {
      throw new Error(`Failed to parse DRIVE_SERVICE_ACCOUNT_KEY_JSON: ${err.message}`);
    }
  }

  // Fallback: Read credentials from path
  try {
    const fs = require('fs');
    const path = require('path');
    const resolvedPath = path.resolve(trimmed);
    const content = fs.readFileSync(resolvedPath, 'utf8');
    return JSON.parse(content);
  } catch (err: any) {
    throw new Error(
      `Failed to load Google Drive credentials from path "${trimmed}": ${err.message}`
    );
  }
}

/**
 * Initializes and returns a Google Drive API client authorized with service account JWT.
 */
function getDriveClient() {
  const credentials = getCredentials();
  
  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ['https://www.googleapis.com/auth/drive.file'],
  });

  return google.drive({ version: 'v3', auth });
}

/**
 * Uploads a document Buffer to a configured Google Drive folder.
 */
export async function uploadBlogToDrive(
  blog: { title: string; slug: string | null },
  authorEmail: string,
  docxBuffer: Buffer
): Promise<{ fileId: string; webViewLink: string }> {
  const folderId = process.env.DRIVE_FOLDER_ID;
  if (!folderId) {
    throw new Error('DRIVE_FOLDER_ID is not configured in the environment.');
  }

  const drive = getDriveClient();

  // Create standard naming convention: <author>-<slug>.docx
  const cleanAuthor = authorEmail.split('@')[0] || 'author';
  const cleanSlug = blog.slug || 'untitled';
  const fileName = `${cleanAuthor}-${cleanSlug}.docx`;

  // Convert Buffer to readable stream for googleapis compatibility
  const bufferStream = new Readable();
  bufferStream.push(docxBuffer);
  bufferStream.push(null);

  console.log(`[google-drive] Uploading "${fileName}" to folder "${folderId}"...`);

  const response = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [folderId],
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    },
    media: {
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      body: bufferStream,
    },
    fields: 'id, webViewLink',
  });

  if (!response.data.id || !response.data.webViewLink) {
    throw new Error('Upload to Google Drive succeeded, but returned no file metadata.');
  }

  console.log(`[google-drive] Upload successful. File ID: ${response.data.id}`);
  return {
    fileId: response.data.id,
    webViewLink: response.data.webViewLink,
  };
}

/**
 * Uploads blog HTML content to a configured Google Drive folder as a native
 * Google Doc. Drive converts the HTML source directly to Docs format on
 * upload, so no Pandoc/.docx intermediate step is required.
 */
export async function uploadBlogAsGoogleDoc(
  blog: { title: string; slug: string | null },
  authorEmail: string,
  htmlContent: string
): Promise<{ fileId: string; webViewLink: string }> {
  const folderId = process.env.DRIVE_FOLDER_ID;
  if (!folderId) {
    throw new Error('DRIVE_FOLDER_ID is not configured in the environment.');
  }

  const drive = getDriveClient();

  const cleanAuthor = authorEmail.split('@')[0] || 'author';
  const cleanSlug = blog.slug || 'untitled';
  const fileName = `${cleanAuthor}-${cleanSlug}`;

  const fullHtml = `<html><body><h1>${blog.title}</h1>${htmlContent}</body></html>`;
  const bufferStream = new Readable();
  bufferStream.push(Buffer.from(fullHtml, 'utf-8'));
  bufferStream.push(null);

  console.log(`[google-drive] Uploading "${fileName}" as Google Doc to folder "${folderId}"...`);

  const response = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [folderId],
      mimeType: 'application/vnd.google-apps.document',
    },
    media: {
      mimeType: 'text/html',
      body: bufferStream,
    },
    fields: 'id, webViewLink',
  });

  if (!response.data.id || !response.data.webViewLink) {
    throw new Error('Upload to Google Drive succeeded, but returned no file metadata.');
  }

  console.log(`[google-drive] Google Doc created. File ID: ${response.data.id}`);
  return {
    fileId: response.data.id,
    webViewLink: response.data.webViewLink,
  };
}

/**
 * Loop permissions to share file with marketing emails and send notification.
 */
export async function shareBlogWithMarketing(
  fileId: string,
  authorEmail: string
): Promise<string[]> {
  const emailsString = process.env.MARKETING_NOTIFY_EMAILS || '';
  const emails = emailsString
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);

  if (emails.length === 0) {
    console.warn('[google-drive] No emails configured in MARKETING_NOTIFY_EMAILS.');
    return [];
  }

  const drive = getDriveClient();
  const cleanAuthor = authorEmail.split('@')[0] || 'A developer';

  console.log(`[google-drive] Sharing file ${fileId} with:`, emails);

  for (const email of emails) {
    try {
      await drive.permissions.create({
        fileId: fileId,
        sendNotificationEmail: true,
        emailMessage: `New blog from ${cleanAuthor} (${authorEmail}) ready for marketing review.`,
        requestBody: {
          role: 'reader',
          type: 'user',
          emailAddress: email,
        },
      });
      console.log(`[google-drive] Successfully shared with ${email}`);
    } catch (err: any) {
      console.error(`[google-drive] Failed to share with ${email}:`, err.message);
      // If a single email address fails, don't fail the entire pipeline
      // unless it's a authorization error for the service account itself.
      if (err.status === 401 || err.status === 403) {
        throw new Error(`Google API authorization failure sharing with ${email}: ${err.message}`);
      }
    }
  }

  return emails;
}
