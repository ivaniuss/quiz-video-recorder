import { chromium, Page } from "playwright";
import * as fs from 'fs';
import * as path from 'path';

// Configuration
const CONFIG = {
  API: {
    BASE_URL: 'http://localhost:3000',
    ENDPOINTS: {
      QUIZ_ANSWERS: '/api/quiz/answers'
    }
  },
  TIMING: {
    DEFAULT_ANSWER_DELAY: 3000, // 3 seconds
    DEFAULT_QUESTION_TIMEOUT: 10000, // 10 seconds
    DEFAULT_STABILIZATION_DELAY: 1000, // 1 second
    DEFAULT_CLOSE_DELAY: 3000 // 3 seconds
  },
  SELECTORS: {
    QUIZ_CONTAINER: '[data-testid="quiz-game-container"]',
    QUESTION_COUNTER: '[data-testid="question-counter"]',
    QUESTION_TEXT: '[data-testid="quiz-game-container"] .p-6 h2',
    OPTION: (index?: number) => `[data-testid^="option-"]${index !== undefined ? `:nth-child(${index + 1})` : ''}`,
    OPTION_TEXT: 'span.font-medium',
    SCORE: 'div:text("Score:")'
  }
} as const;

// Types
interface QuizAnswer {
  pregunta: string;
  respuesta: string;
}

interface AnswerBank {
  question: string;
  answer: string;
}

interface TimingConfig {
  answerDelay?: number; // Time to wait before answering (ms)
  questionTimeout?: number; // Max time to wait for question (ms)
  stabilizationDelay?: number; // Time to wait for UI to stabilize (ms)
  closeDelay?: number; // Time to wait before closing (ms)
}

// Make all timing properties required
type RequiredTimingConfig = Required<TimingConfig>;

interface GameConfig {
  automaticMode: boolean;
  specificGame?: string;
  enableTimer?: boolean;
  timerSeconds?: number;
  timing?: TimingConfig;
}

// State
let quizAnswers: AnswerBank[] = [];

// Utility Functions
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const log = (emoji: string, ...args: any[]) => {
  console.log(emoji, ...args);
};

const logError = (emoji: string, ...args: any[]) => {
  console.error(emoji, ...args);
};

// Core Functions
async function fetchQuizAnswers(): Promise<QuizAnswer[]> {
  const { API } = CONFIG;
  try {
    const response = await fetch(`${API.BASE_URL}${API.ENDPOINTS.QUIZ_ANSWERS}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch quiz answers: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    logError('❌', 'Error fetching quiz answers:', error);
    throw error;
  }
}

async function initializeQuiz(config: GameConfig) {
  const apiAnswers = await fetchQuizAnswers();
  quizAnswers = apiAnswers.map(({ pregunta, respuesta }) => ({
    question: pregunta,
    answer: respuesta
  }));
  log('✅', `Fetched ${quizAnswers.length} quiz answers from the API`);
}

async function setupBrowser() {
  const browser = await chromium.launch({
    headless: false,
    slowMo: 300,
    devtools: false
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: {
      dir: 'videos/',
      size: { width: 1280, height: 720 }
    }
  });

  return { browser, context, page: await context.newPage() };
}

async function setupAutomaticMode(page: Page, config: GameConfig) {
  const { API, TIMING } = CONFIG;
  
  await page.goto(`${API.BASE_URL}/games`);
  await page.waitForLoadState("networkidle");

  if (config.enableTimer) {
    log('⚙️', 'Configuring timer...');
    
    // Habilitar el timer si no está habilitado
    const timerToggle = page.locator('#timer-toggle');
    const isTimerEnabled = await timerToggle.getAttribute('aria-checked');
    
    if (isTimerEnabled === 'false') {
      log('🕒', 'Enabling timer...');
      await timerToggle.click();
      await delay(1000); // Dar tiempo a que se actualice la UI
    }
    
    // Configurar el tiempo por pregunta
    log('⏱️', `Configuring time per question to ${config.timerSeconds} seconds...`);
    
    // Hacer clic en el botón del selector de tiempo
    const timeSelector = page.locator('button[role="combobox"]').first();
    await timeSelector.click();
    await delay(500);
    
    // Seleccionar la opción correspondiente
    const timeOption = page.locator(`div[role="option"]:has-text("${config.timerSeconds} seconds")`);
    
    if (await timeOption.count() > 0) {
      await timeOption.click();
      log('✅', `Time set to ${config.timerSeconds} seconds`);
    } else {
      log('⚠️', `Time option ${config.timerSeconds} seconds not found, using default`);
      // Seleccionar la opción por defecto (15 segundos) si no se encuentra la opción
      const defaultOption = page.locator('div[role="option"]:has-text("15 seconds")');
      if (await defaultOption.count() > 0) {
        await defaultOption.click();
      }
    }
    
    await delay(500);
  }

  log('🎮', 'Starting game...');
  const gameButton = page.locator(`button:has-text("${config.specificGame || 'Daily Trivia'}")`);
  
  if (await gameButton.count() > 0) {
    log('🎮', `Starting ${config.specificGame || 'Daily Trivia'}...`);
    await gameButton.click();
  } else {
    log('🕹️', 'Starting the first available game...');
    const playButton = page.locator('button:has-text("Play Now")').first();
    await playButton.click();
  }
  
  await page.waitForLoadState("networkidle");
}

async function setupDirectMode(page: Page, config: GameConfig) {
  const { API } = CONFIG;
  const gamePath = config.specificGame || 'daily-trivia';
  log('🎮', `Starting game directly: ${gamePath}`);
  await page.goto(`${API.BASE_URL}/games/${gamePath}`);
  await page.waitForLoadState("networkidle");
}

async function answerQuestion(page: Page, questionNumber: number, timing: RequiredTimingConfig) {
  const { SELECTORS, TIMING: DEFAULT_TIMING } = CONFIG;
  const {
    answerDelay = DEFAULT_TIMING.DEFAULT_ANSWER_DELAY,
    questionTimeout = DEFAULT_TIMING.DEFAULT_QUESTION_TIMEOUT,
    stabilizationDelay = DEFAULT_TIMING.DEFAULT_STABILIZATION_DELAY
  } = timing;

  log('\n', `=== Question ${questionNumber} ===`);
  
  // Wait for options to be available
  await page.waitForSelector(SELECTORS.OPTION(), { state: 'visible', timeout: questionTimeout });
  await delay(stabilizationDelay);

  // Get question info
  const questionCounter = await page.locator(SELECTORS.QUESTION_COUNTER).textContent();
  const questionText = await page.locator(SELECTORS.QUESTION_TEXT).textContent() || '';
  
  log('📝', `Question ${questionCounter}: ${questionText}`);
  
  // Get score
  const scoreText = await page.locator(SELECTORS.SCORE).first().textContent();
  log('🏆', `Current score: ${scoreText}`);

  // Process options
  const options = page.locator(SELECTORS.OPTION());
  const optionCount = await options.count();
  
  if (optionCount === 0) {
    log('⚠️', 'No options found. Quiz finished.');
    return false;
  }

  log('📋', `Available options (${optionCount}):`);
  
  // Get all options with their text
  const optionsList = await Promise.all(
    Array.from({ length: optionCount }, async (_, i) => {
      const element = options.nth(i);
      const text = (await element.locator(SELECTORS.OPTION_TEXT).textContent() || '').trim();
      log(` ${i + 1}. ${text}`);
      return { text, element };
    })
  );

  // Find the correct answer
  const correctAnswer = quizAnswers.find(qa => questionText.includes(qa.question));
  let selectedOption = optionsList[Math.floor(Math.random() * optionCount)]; // Default to random

  if (correctAnswer) {
    log('🔍', `Looking for answer: "${correctAnswer.answer}"`);
    const correctOption = optionsList.find(op => 
      op.text === correctAnswer.answer.trim()
    );
    if (correctOption) selectedOption = correctOption;
  } else {
    log('⚠️', 'Correct answer not found in the answer bank, selecting randomly');
  }

  // Select the answer
  log('✅', `Selecting: "${selectedOption.text}"`);
  log('⏳', `Waiting ${answerDelay}ms before selecting...`);
  await delay(answerDelay);
  
  log('🖱️', 'Selecting option...');
  await selectedOption.element.click();

  // Wait for answer feedback
  log('⏳', 'Waiting for answer...');
  await delay(stabilizationDelay);

  // Wait for next question or end
  try {
    await page.waitForFunction(
      (args: { currentQuestion: string; selector: string }) => {
        const questionEl = document.querySelector(args.selector);
        return questionEl ? questionEl.textContent !== args.currentQuestion : false;
      },
      { currentQuestion: questionText, selector: SELECTORS.QUESTION_TEXT },
      { timeout: 2000 }
    );
    log('✅', 'Question changed');
  } catch (error) {
    log('⚠️', 'No question change detected, might be the last question');
  }

  return true;
}

async function takeScreenshot(page: Page, name: string) {
  try {
    const screenshotPath = `debug-${name}.png`;
    await page.screenshot({ path: screenshotPath, fullPage: true });
    log('📸', `Screenshot captured: ${screenshotPath}`);
  } catch (error) {
    logError('❌', 'Failed to capture screenshot:', error);
  }
}

// Main Function
export async function recordQuiz(config: GameConfig) {
  // Set up timing with defaults
  const timing: Required<TimingConfig> = {
    answerDelay: 3000,
    questionTimeout: 10000,
    stabilizationDelay: 1000,
    closeDelay: 3000,
    ...config.timing
  };

  try {
    // Initialize
    await initializeQuiz(config);
    
    // Ensure videos directory exists
    if (!fs.existsSync('videos')) {
      fs.mkdirSync('videos', { recursive: true });
    }

    // Set up browser and page
    const { browser, context, page } = await setupBrowser();

    try {
      // Set up game mode
      if (config.automaticMode) {
        await setupAutomaticMode(page, config);
      } else {
        await setupDirectMode(page, config);
      }

      // Start quiz
      await page.waitForSelector(CONFIG.SELECTORS.QUIZ_CONTAINER);
      log('🎮', 'Quiz started');

      // Answer questions
      let questionNumber = 1;
      const maxQuestions = 10;

      while (questionNumber <= maxQuestions) {
        try {
          const shouldContinue = await answerQuestion(page, questionNumber, timing);
          if (!shouldContinue) break;
          questionNumber++;
        } catch (error) {
          logError('⚠️', `Error on question ${questionNumber}:`, error);
          await takeScreenshot(page, `question-${questionNumber}-error`);
          break;
        }
      }

      log('✅', 'Quiz completed');
      log('⏳', `Closing in ${timing.closeDelay}ms...`);
      await delay(timing.closeDelay);

      // Save video
      const video = await page.video();
      if (video) {
        const videoPath = await video.path();
        log('🎥', `Video saved to: ${videoPath}`);
      }
    } finally {
      await context.close();
      await browser.close();
      log('✅', 'Browser closed');
    }
  } catch (error) {
    logError('❌', 'An error occurred:', error);
    throw error;
  }
}

// Example usage:

recordQuiz({
  automaticMode: true,
  specificGame: 'daily-trivia',
  enableTimer: true,
  timerSeconds: 15,
  timing: {
    answerDelay: 3000,       // 3 seconds before answering
    questionTimeout: 10000,  // 10 seconds max to load question
    stabilizationDelay: 1000, // 1 second for UI to stabilize
    closeDelay: 3000         // 3 seconds before closing
  }
}).catch(console.error);

