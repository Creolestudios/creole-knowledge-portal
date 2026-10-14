# Google Cloud Service Account & Video Storage Setup Guide

This guide provides step-by-step instructions for configuring **Google Drive video storage** for the AI Mock Interview proctoring module using a **Google Cloud Service Account**.

Follow this guide if you are replacing the current developer/personal account with an organization or client account.

---

## 1. Overview & Architecture

### Why a Service Account?
In the AI Mock Interview system, continuous video (candidate webcam + screen share + audio) is recorded and uploaded directly to Google Drive. 

- Candidates and interviewees **never log into a Google account**.
- The server acts autonomously using a **Google Cloud Service Account** (a machine-to-machine robot identity) to issue secure resumable upload sessions.
- Videos are deposited directly into a designated **Google Drive folder** owned by your organization.

### Key Environment Variables Required
| Variable | Description | Example / Format |
| :--- | :--- | :--- |
| `DRIVE_FOLDER_ID` | The ID of the target Google Drive folder where videos will be stored. | `1A2b3C4d5E6f7G8h9I0jKLMNOPQRSTUVWXYZ` |
| `DRIVE_SERVICE_ACCOUNT_KEY_JSON` | The complete JSON private key for the Service Account. | `{"type":"service_account","project_id":"...","private_key":"..."}` |

---

## 2. Step-by-Step Setup: Creating a New Service Account

Follow these steps using the **new/target Google Account** (e.g. your company or organization account).

### Step 1: Open Google Cloud Console
1. Navigate to the [Google Cloud Console](https://console.cloud.google.com/).
2. Sign in with the **new Google account** that will own the project.
3. In the top project selector dropdown, click **New Project**.
4. Name the project (e.g., `creole-portal-video-storage`) and click **Create**.
5. Once created, select the project from the notification bell or dropdown.

---

### Step 2: Enable the Google Drive API
1. In the search bar at the top, type **Google Drive API** and select it from the results.
2. (Or navigate to **APIs & Services** → **Library** → Search for `Google Drive API`).
3. Click **Enable**.
4. Wait a few seconds until the API is enabled for your project.

---

### Step 3: Create the Service Account
1. In the left navigation menu, go to **IAM & Admin** → **Service Accounts**.
2. Click **+ Create Service Account** at the top.
3. Fill in the details:
   - **Service account name**: `interview-recorder` (or similar).
   - **Service account ID**: Automatically populates (e.g., `interview-recorder@<your-project-id>.iam.gserviceaccount.com`).
   - **Description**: `Service account for uploading mock interview recordings to Google Drive`.
4. Click **Create and Continue**.
5. *(Optional)* Role: You can leave this blank or assign `Basic` → `Viewer` (the actual upload permissions are granted inside Google Drive itself in Step 5).
6. Click **Done**.

> [!NOTE]
> Copy the **Service Account Email** address you just created (e.g. `interview-recorder@your-project-id.iam.gserviceaccount.com`). You will need it in Step 5.

---

### Step 4: Generate and Download the JSON Private Key
1. In the **Service Accounts** table, click on the three dots (⋮) under **Actions** next to your new service account, or click directly on the service account email.
2. Go to the **Keys** tab.
3. Click **Add Key** → **Create new key**.
4. Choose **JSON** as the key type.
5. Click **Create**.
6. A `.json` credentials file will download to your computer.

> [!CAUTION]
> **Keep this JSON key file private!** Anyone with this file can act on behalf of the service account. Never commit this file to GitHub or send it over unencrypted channels.

The downloaded file will contain content similar to this:
```json
{
  "type": "service_account",
  "project_id": "creole-portal-video-storage",
  "private_key_id": "abcd1234efgh5678...",
  "private_key": "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC...\n-----END PRIVATE KEY-----\n",
  "client_email": "interview-recorder@creole-portal-video-storage.iam.gserviceaccount.com",
  "client_id": "109876543210987654321",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
  "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/interview-recorder..."
}
```

---

## 3. Configuring the Google Drive Destination Folder

### Step 5: Create the Folder & Copy the Folder ID
1. Log into [Google Drive](https://drive.google.com/) using the **new/target Google Account** where videos should be stored.
2. Click **New** → **New folder**.
3. Name it (e.g., `Candidate Interview Recordings`).
4. Double-click to open the folder.
5. Look at the browser URL bar:
   ```text
   https://drive.google.com/drive/folders/1A2b3C4d5E6f7G8h9I0jKLMNOPQRSTUVWXYZ
   ```
6. The string of characters after `/folders/` is your **Folder ID**:
   - In the example above, the ID is `1A2b3C4d5E6f7G8h9I0jKLMNOPQRSTUVWXYZ`.

---

### Step 6: Share the Folder with the Service Account (CRITICAL!)

> [!IMPORTANT]
> **Why this step is mandatory**: Google Cloud Service Accounts have **0 GB of storage quota** on their own. If the service account tries to upload a video without sharing the folder first, Google Drive will reject the upload with `403 Forbidden` or `Storage quota exceeded`.

1. In Google Drive, with the folder open, click the folder name at the top (or right-click the folder) → select **Share** (or click the Share icon).
2. In the "Add people, groups, and calendar events" field, paste your **Service Account Email** copied from Step 3:
   ```text
   interview-recorder@your-project-id.iam.gserviceaccount.com
   ```
3. Set the permission role to **Editor** (must be Editor so the service account can write and upload files).
4. Uncheck the "Notify people" box (since service accounts cannot receive emails).
5. Click **Share** (or **Save**).

---

## 4. Updating Environment Variables (`.env.local`)

Now update your `.env.local` file with the credentials from the new account:

### 1. Update `DRIVE_FOLDER_ID`
Replace the existing folder ID with your new folder ID:
```env
DRIVE_FOLDER_ID="1A2b3C4d5E6f7G8h9I0jKLMNOPQRSTUVWXYZ"
```

### 2. Update `DRIVE_SERVICE_ACCOUNT_KEY_JSON`
Open the `.json` file you downloaded in Step 4 in any text editor, minify it to a single line (or leave as JSON string), and paste it inside single quotes (`'...'`):

```env
DRIVE_SERVICE_ACCOUNT_KEY_JSON='{"type":"service_account","project_id":"creole-portal-video-storage","private_key_id":"...","private_key":"-----BEGIN PRIVATE KEY-----\\nMIIEvgI...\\n-----END PRIVATE KEY-----\\n","client_email":"interview-recorder@creole-portal-video-storage.iam.gserviceaccount.com","client_id":"...","auth_uri":"https://accounts.google.com/o/oauth2/auth","token_uri":"https://oauth2.googleapis.com/token","auth_provider_x509_cert_url":"https://www.googleapis.com/oauth2/v1/certs","client_x509_cert_url":"..."}'
```

*(Alternatively: You can save the downloaded `.json` file on your server and point `GOOGLE_APPLICATION_CREDENTIALS` to its absolute path).*

---

## 5. Verification & Testing

1. **Restart your development server**:
   ```bash
   # Press Ctrl+C in your running dev server terminal, then run:
   npm run dev
   ```
2. **Execute tests for the Google Drive recorder**:
   ```bash
   npx vitest run lib/ai-interview/google-drive-recorder.test.ts
   ```
3. **Perform a Test Interview Recording**:
   - Open [http://localhost:3000/assess](http://localhost:3000/assess) or navigate to an active interview link.
   - Complete an interview test session for 15-30 seconds.
   - Open your Google Drive folder in the browser: you should see a `.webm` or `.mp4` video file appearing with the candidate's name and interview timestamp.

---

## 6. Troubleshooting Common Issues

| Error Message / Symptom | Root Cause | Solution |
| :--- | :--- | :--- |
| **`403 Forbidden: The user does not have sufficient permissions for this file`** | The destination Google Drive folder was not shared with the service account email. | Open the folder in Google Drive → Share → Add the `client_email` as an **Editor**. |
| **`404 File not found: <folder_id>`** | `DRIVE_FOLDER_ID` is incorrect, contains extra spaces, or points to a deleted folder. | Copy the exact alphanumeric string from the folder's URL bar and update `DRIVE_FOLDER_ID`. |
| **`Failed to parse credentials JSON string`** | The JSON string in `DRIVE_SERVICE_ACCOUNT_KEY_JSON` has broken quotes or unescaped newlines. | Wrap the entire JSON value in single quotes: `DRIVE_SERVICE_ACCOUNT_KEY_JSON='{...}'`. |
| **`Storage quota exceeded for this account`** | The video is being uploaded to root Drive instead of the shared folder. | Ensure `DRIVE_FOLDER_ID` is set and valid in `.env.local`. |
| **`Google Drive API has not been used in project... or it is disabled`** | The Google Drive API was not enabled in Google Cloud Console. | Go to Google Cloud Console → APIs & Services → Enable **Google Drive API**. |
