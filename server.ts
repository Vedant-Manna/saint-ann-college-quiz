import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { QuizState, AllScores, VALID_USERS, ADMIN_USER, PASSWORD } from './src/types';

// In-memory state tracking
let quizState: QuizState = {
  cmd: 'idle',
  round: 0,
  question: 0,
  ts: Date.now()
};

let allScores: AllScores = {};
let activeStudents: { [username: string]: { lastSeen: number } } = {};

async function startServer() {
  const app = express();
  const PORT = 3000;

  // JSON request body parser
  app.use(express.json());

  // ─── API ROUTES ───

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', serverTime: new Date().toISOString() });
  });

  // Login handler
  app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Please enter both username and password.' });
    }

    const trimmedUser = username.trim().toLowerCase();
    const trimmedPass = password.trim();

    if (trimmedPass !== PASSWORD) {
      return res.status(401).json({ error: 'Invalid username or password. Please try again.' });
    }

    if (trimmedUser === ADMIN_USER) {
      return res.json({ role: 'admin', username: trimmedUser });
    } else if (VALID_USERS.includes(trimmedUser)) {
      // Initialize score entry for this student if it does not exist yet
      if (!allScores[trimmedUser]) {
        allScores[trimmedUser] = {
          correct: 0,
          incorrect: 0,
          skipped: 0,
          details: []
        };
      }
      activeStudents[trimmedUser] = { lastSeen: Date.now() };
      return res.json({ role: 'student', username: trimmedUser });
    } else {
      return res.status(401).json({ error: 'Invalid username or password. Please try again.' });
    }
  });

  // Get active quiz state
  app.get('/api/state', (req, res) => {
    // Also parse heartbeat if student polls this
    const student = req.query.student as string;
    if (student && VALID_USERS.includes(student.toLowerCase())) {
      activeStudents[student.toLowerCase()] = { lastSeen: Date.now() };
    }
    res.json(quizState);
  });

  // Update active quiz state (Admin control)
  app.post('/api/state', (req, res) => {
    const { cmd, round, question } = req.body as Partial<QuizState>;
    
    quizState = {
      cmd: cmd || 'idle',
      round: typeof round === 'number' ? round : quizState.round,
      question: typeof question === 'number' ? question : quizState.question,
      ts: Date.now()
    };

    res.json({ success: true, quizState });
  });

  // Get scoreboard answers and stats (Admin & candidates poll)
  app.get('/api/scores', (req, res) => {
    res.json({
      scores: allScores,
      activeStudents: Object.keys(activeStudents).filter(username => {
        // Keep active if seen within the last 15 seconds
        return Date.now() - activeStudents[username].lastSeen < 15000;
      })
    });
  });

  // Record an answer (Candidate post)
  app.post('/api/score', (req, res) => {
    const { student, result, round, roundLabel, question, selected, correct } = req.body;
    
    if (!student || !VALID_USERS.includes(student.toLowerCase())) {
      return res.status(400).json({ error: 'Valid candidate name is required.' });
    }

    const sUser = student.toLowerCase();
    
    // Lazy initialize score mapping
    if (!allScores[sUser]) {
      allScores[sUser] = {
        correct: 0,
        incorrect: 0,
        skipped: 0,
        details: []
      };
    }

    const currentStudentScore = allScores[sUser];

    // Check if this specific round-question combination was already answered to avoid double-accounting
    const alreadyAnswered = currentStudentScore.details.some(d => d.round === round && d.question === question);
    
    if (!alreadyAnswered) {
      if (result === 'correct') {
        currentStudentScore.correct++;
      } else if (result === 'incorrect') {
        currentStudentScore.incorrect++;
      } else if (result === 'skipped') {
        currentStudentScore.skipped++;
      }

      currentStudentScore.details.push({
        student: student,
        round,
        roundLabel,
        question,
        selected,
        correct,
        result,
        ts: Date.now()
      });
    }

    activeStudents[sUser] = { lastSeen: Date.now() };
    res.json({ success: true, score: currentStudentScore });
  });

  // Reset quiz state and scores (Admin command)
  app.post('/api/reset', (req, res) => {
    quizState = {
      cmd: 'idle',
      round: 0,
      question: 0,
      ts: Date.now()
    };
    allScores = {};
    activeStudents = {};
    res.json({ success: true });
  });

  // Periodic heartbeat route to keep a candidate's light active
  app.post('/api/heartbeat', (req, res) => {
    const { username } = req.body;
    if (username && VALID_USERS.includes(username.toLowerCase())) {
      activeStudents[username.toLowerCase()] = { lastSeen: Date.now() };
    }
    res.json({ success: true });
  });

  // Serve static assets OR handle Vite reload
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Saint Ann Quiz Server running at http://0.0.0.0:${PORT}`);
  });
}

startServer();
