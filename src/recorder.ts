import { chromium } from "playwright";

// Definir el tipo para las respuestas correctas
// Al principio del archivo, después de las importaciones
interface RespuestaCorrecta {
  pregunta: string | RegExp;
  respuesta: string;
}

// Mapa de preguntas a respuestas correctas
const respuestas: RespuestaCorrecta[] = [
  {
    pregunta: "Which country won the FIFA World Cup in 2022?",
    respuesta: "Argentina"
  },
  {
    pregunta: "Who is the all-time top scorer in UEFA Champions League history?",
    respuesta: "Cristiano Ronaldo"
  },
  {
    pregunta: "Which club has won the most Premier League titles?",
    respuesta: "Manchester United"
  },
  {
    pregunta: "In which year was the first FIFA World Cup held?",
    respuesta: "1930"
  },
  {
    pregunta: "Which player has won the most Ballon d'Or awards?",
    respuesta: "Lionel Messi"
  },
  {
    pregunta: "Which country hosted the 2018 FIFA World Cup?",
    respuesta: "Russia"
  },
  {
    pregunta: "What is the maximum number of players a team can have on the field during a match?",
    respuesta: "11"
  },
  {
    pregunta: 'Which club is known as "The Red Devils"?',
    respuesta: "Manchester United"
  },
  {
    pregunta: 'Who scored the "Hand of God" goal?',
    respuesta: "Diego Maradona"
  },
  {
    pregunta: 'Which stadium is known as "The Theatre of Dreams"?',
    respuesta: "Old Trafford"
  }
];

interface GameConfig {
  automaticMode: boolean;
  specificGame?: string; // 'daily-trivia' | 'player-guess' | etc.
  enableTimer?: boolean;
  timerSeconds?: number;
}

async function recordQuiz(
  respuestasCorrectas: RespuestaCorrecta[] = [],
  config: GameConfig = { automaticMode: false, enableTimer: true, timerSeconds: 15 }
) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const videoPath = `videos/quiz-${timestamp}.mp4`;
  
  // Crear directorio de videos si no existe
  const fs = require('fs');
  if (!fs.existsSync('videos')) {
    fs.mkdirSync('videos', { recursive: true });
  }

  const browser = await chromium.launch({
    headless: false,
    slowMo: 300, // Reducido para mayor velocidad
    devtools: false // Desactivar devtools para mejor rendimiento
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: {
      dir: 'videos/',
      size: { width: 1280, height: 720 }
    }
  });

  const page = await context.newPage();

  try {
    if (config.automaticMode) {
      // Modo automático: ir a la página de juegos y configurar
      await page.goto("http://localhost:3000/games");
      await page.waitForLoadState("networkidle");
      
      // Configurar temporizador si está habilitado
      if (config.enableTimer) {
        console.log("⚙️ Configurando temporizador...");
        
        // Habilitar el temporizador
        const timerToggle = page.locator('#timer-toggle');
        const isTimerEnabled = await timerToggle.getAttribute('aria-checked');
        
        if (isTimerEnabled === 'false') {
          console.log("🕒 Activando temporizador...");
          await timerToggle.click();
          await page.waitForTimeout(500);
        }
        
        // Configurar el tiempo
        console.log(`⏱️ Configurando tiempo por pregunta a ${config.timerSeconds} segundos...`);
        
        // Esperar y hacer clic en el menú desplegable del temporizador
        await page.waitForSelector('button[role="combobox"]', { timeout: 10000 });
        const timerDropdown = await page.waitForSelector('button[role="combobox"]', { state: 'visible' });
        await timerDropdown?.click();
        
        // Seleccionar el tiempo configurado
        await page.waitForSelector('div[role="option"]', { timeout: 5000 });
        const options = await page.$$('div[role="option"]');
        
        for (const option of options) {
          const text = await option.textContent();
          if (text?.includes(`${config.timerSeconds} seconds`)) {
            await option.click();
            console.log(`✅ Tiempo configurado a ${config.timerSeconds} segundos`);
            break;
          }
        }
        
        await page.waitForTimeout(1000);
      }
      
      // Iniciar el juego específico o el primero disponible
      if (config.specificGame) {
        console.log(`🕹️ Iniciando ${config.specificGame}...`);
        const gameButton = page.locator(`button:has-text("${config.specificGame}")`).first();
        await gameButton.click();
      } else {
        console.log("🕹️ Iniciando el primer juego disponible...");
        const playButton = page.locator('button:has-text("Play Now")').first();
        await playButton.click();
      }
      
      await page.waitForLoadState("networkidle");
    } else {
      // Modo directo: ir directamente al juego especificado
      const gamePath = config.specificGame || 'daily-trivia';
      console.log(`🎮 Iniciando juego directamente: ${gamePath}`);
      await page.goto(`http://localhost:3000/games/${gamePath}`);
      await page.waitForLoadState("networkidle");
    }

    await page.waitForSelector('[data-testid="quiz-game-container"]');
    console.log("🎮 Quiz iniciado");

    let questionNumber = 1;
    const maxQuestions = 10;

    while (questionNumber <= maxQuestions) {
      console.log(`\n=== Pregunta ${questionNumber} ===`);

      try {
        await page.waitForSelector('[data-testid^="option-q"]');

        const questionCounter = await page
          .locator('[data-testid="question-counter"]')
          .textContent();
        const questionTextLocator = page.locator(
          '[data-testid="quiz-game-container"] .p-6 h2'
        );
        const questionText = await questionTextLocator.textContent();
        const preguntaActual = questionText || '';

        console.log(`Contador: ${questionCounter}`);
        console.log(`Pregunta: ${questionText}`);

        const scoreText = await page
          .locator('div:text("Score:")')
          .first()
          .textContent();
        console.log(`Puntuación actual: ${scoreText}`);

        const options = page.locator('[data-testid^="option-q"]');
        const optionCount = await options.count();

        if (optionCount === 0) {
          console.log("⚠️ No se encontraron opciones. Quiz finalizado.");
          break;
        }

        console.log(`Opciones disponibles (${optionCount}):`);
        
        // Obtener todas las opciones con su texto
        const opciones: {texto: string, elemento: any}[] = [];
        for (let i = 0; i < optionCount; i++) {
          const elemento = options.nth(i);
          const texto = await elemento.locator("span.font-medium").textContent() || '';
          opciones.push({texto, elemento});
          console.log(` ${i + 1}. ${texto}`);
        }

        // Buscar la respuesta correcta para esta pregunta
        let indiceCorrecto = -1;
        const respuestaCorrecta = respuestasCorrectas.find(r => 
          typeof r.pregunta === 'string' 
            ? preguntaActual.includes(r.pregunta)
            : r.pregunta.test(preguntaActual)
        );

        if (respuestaCorrecta) {
          console.log(`🔍 Buscando respuesta: "${respuestaCorrecta.respuesta}"`);
          indiceCorrecto = opciones.findIndex(op => 
            op.texto.trim() === respuestaCorrecta.respuesta.trim()
          );
        }

        // Si no se encontró la respuesta correcta, seleccionar una al azar
        if (indiceCorrecto === -1) {
          console.log("⚠️ No se encontró la respuesta correcta en el banco de respuestas");
          indiceCorrecto = Math.floor(Math.random() * optionCount);
        }

        const opcionSeleccionada = opciones[indiceCorrecto];
        console.log(`✅ Seleccionando: "${opcionSeleccionada.texto}"`);
        
        // Hacer clic en la opción seleccionada
        const selectedOption = opcionSeleccionada.elemento;
        console.log("⏳ Esperando 3 segundos antes de seleccionar...");
        await new Promise(resolve => setTimeout(resolve, 3000));
        console.log("🖱️ Seleccionando opción...");
        await selectedOption.click();

        // Esperar feedback visual de la respuesta
        console.log("⏳ Esperando respuesta...");
        await page.waitForTimeout(1000);

        // Esperar a que la pregunta cambie
        console.log("🔄 Esperando cambio de pregunta...");
        try {
          await page.waitForFunction(
            (currentQuestion) => {
              const questionEl = document.querySelector('[data-testid="quiz-game-container"] .p-6 h2');
              return questionEl && questionEl.textContent !== currentQuestion;
            },
            await questionTextLocator.textContent(),
            { timeout: 10000 }
          );
          console.log("✅ Pregunta cambiada");
        } catch (error) {
          console.log("⚠️ No se detectó cambio de pregunta, continuando...");
        }

        // Pequeña pausa para asegurar que todo se ha estabilizado
        await page.waitForTimeout(1000);

        questionNumber++;
      } catch (error) {
        console.error(`⚠️ Error en la pregunta ${questionNumber}:`, error);
        try {
          await page.screenshot({
            path: `debug-question-${questionNumber}.png`,
            fullPage: true,
          });
          console.log(
            `📸 Screenshot capturada: debug-question-${questionNumber}.png`
          );
        } catch (screenshotError) {
          console.error("Error al capturar screenshot:", screenshotError);
        }
        break;
      }
    }

    console.log("\n✅ Quiz completado");
    console.log("⏳ Cerrando en 3 segundos...");
  } catch (err) {
    console.error("❌ Error general:", err);
  } finally {
    // Esperar 3 segundos antes de cerrar
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    try {
      // Cerrar el contexto para finalizar la grabación
      await context.close();
      
      // Obtener la ruta del video grabado
      const video = await page.video();
      if (video) {
        const videoPath = await video.path();
        console.log(`🎥 Video guardado en: ${videoPath}`);
      }
    } catch (error) {
      console.error('Error al guardar el video:', error);
    } finally {
      // Cerrar el navegador
      await browser.close();
      console.log("✅ Navegador cerrado");
    }
  }
}

// Ejemplos de uso:

// 1. Modo automático con configuración personalizada
recordQuiz(respuestas, {
  automaticMode: true,
  enableTimer: true,
  timerSeconds: 15,
  // specificGame: 'Daily Trivia' // Opcional: nombre exacto del juego
}).catch(console.error);

// 2. Modo directo (como estaba antes)
// recordQuiz(respuestas, {
//   automaticMode: false,
//   specificGame: 'daily-trivia' // o 'player-guess', etc.
// }).catch(console.error);
