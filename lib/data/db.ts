import fs from 'fs/promises';
import path from 'path';

export interface ValidationReport {
  qualityScore: number; // 0 to 100
  gibberishDetected: boolean;
  lowQualityDetected: boolean;
  aiSpamDetected: boolean;
  plagiarismOverlap: number; // percentage 0 to 100
  reason?: string;
}

export interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  correctOptionIndex: number;
}

export interface SubmissionQuiz {
  questions: QuizQuestion[];
  userSelection?: Record<string, number>; // maps question ID to selected index
  score?: number; // count of correct answers
}

export interface Submission {
  id: string;
  title: string;
  content: string;
  author: string;
  status: 'PENDING_QUIZ' | 'APPROVED' | 'REJECTED_QUIZ' | 'REJECTED_AI' | 'FLAGGED';
  validationReport?: ValidationReport;
  quiz?: SubmissionQuiz;
  createdAt: string;
  updatedAt: string;
}

export interface AuditLog {
  id: string;
  submissionId?: string;
  action: 'SUBMITTED' | 'AI_VALIDATED' | 'QUIZ_TAKEN' | 'MODERATOR_APPROVED' | 'MODERATOR_REJECTED';
  performedBy: string; // 'system' | user email | admin email
  timestamp: string;
  details?: string;
}

interface DBStructure {
  submissions: Submission[];
  auditLogs: AuditLog[];
}

const DB_FILE_PATH = path.join(process.cwd(), 'lib/data/db.json');

async function ensureDBFile(): Promise<void> {
  try {
    await fs.mkdir(path.dirname(DB_FILE_PATH), { recursive: true });
    try {
      await fs.access(DB_FILE_PATH);
    } catch {
      // File does not exist, initialize with empty structures
      const initialData: DBStructure = { submissions: [], auditLogs: [] };
      await fs.writeFile(DB_FILE_PATH, JSON.stringify(initialData, null, 2), 'utf-8');
    }
  } catch (error) {
    console.error('Failed to ensure database directory/file exists:', error);
  }
}

async function readDB(): Promise<DBStructure> {
  await ensureDBFile();
  try {
    const data = await fs.readFile(DB_FILE_PATH, 'utf-8');
    return JSON.parse(data) as DBStructure;
  } catch (error) {
    console.error('Failed to read database JSON file:', error);
    return { submissions: [], auditLogs: [] };
  }
}

async function writeDB(db: DBStructure): Promise<void> {
  await ensureDBFile();
  try {
    await fs.writeFile(DB_FILE_PATH, JSON.stringify(db, null, 2), 'utf-8');
  } catch (error) {
    console.error('Failed to write to database JSON file:', error);
  }
}

// Submissions API helpers
export async function getSubmissions(): Promise<Submission[]> {
  const db = await readDB();
  return db.submissions || [];
}

export async function getSubmissionById(id: string): Promise<Submission | null> {
  const submissions = await getSubmissions();
  return submissions.find((s) => s.id === id) || null;
}

export async function saveSubmission(submission: Submission): Promise<void> {
  const db = await readDB();
  const index = db.submissions.findIndex((s) => s.id === submission.id);
  if (index !== -1) {
    db.submissions[index] = {
      ...db.submissions[index],
      ...submission,
      updatedAt: new Date().toISOString(),
    };
  } else {
    db.submissions.push({
      ...submission,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }
  await writeDB(db);
}

export async function deleteSubmission(id: string): Promise<boolean> {
  const db = await readDB();
  const initialLength = db.submissions.length;
  db.submissions = db.submissions.filter((s) => s.id !== id);
  if (db.submissions.length < initialLength) {
    await writeDB(db);
    return true;
  }
  return false;
}

// Audit Logs API helpers
export async function getAuditLogs(): Promise<AuditLog[]> {
  const db = await readDB();
  return db.auditLogs || [];
}

export async function addAuditLog(
  action: AuditLog['action'],
  performedBy: string,
  submissionId?: string,
  details?: string
): Promise<AuditLog> {
  const db = await readDB();
  const newLog: AuditLog = {
    id: crypto.randomUUID(),
    submissionId,
    action,
    performedBy,
    timestamp: new Date().toISOString(),
    details,
  };
  db.auditLogs.push(newLog);
  await writeDB(db);
  return newLog;
}
