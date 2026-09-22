// Usage:
//   node scripts/loading.js         -> Spinner (default, runs for ~10s)
//   node scripts/loading.js bar     -> Progress Bar (runs for ~10s from 1% to 100%)
//   node scripts/loading.js bar 5   -> Progress Bar for 5s
//   node scripts/loading.js 5       -> Spinner for 5s

const args = process.argv.slice(2);
const isBar = args.some(arg => arg.toLowerCase() === 'bar' || arg.toLowerCase() === '--bar');
const durationArg = args.find(arg => !isNaN(parseFloat(arg)));
const durationSeconds = durationArg ? parseFloat(durationArg) : 10;
const totalDurationMs = durationSeconds * 1000;
const startTime = Date.now();

if (isBar) {
  // --- Progress Bar Mode ---
  const totalSteps = 100;
  const intervalMs = totalDurationMs / totalSteps;
  const barWidth = 30;
  let currentStep = 0;

  function renderProgressBar(percent, elapsedSec) {
    const filledWidth = Math.round((barWidth * percent) / 100);
    const emptyWidth = barWidth - filledWidth;
    const filledBar = '█'.repeat(filledWidth);
    const emptyBar = '░'.repeat(emptyWidth);
    const formattedPercent = String(percent).padStart(3, ' ');
    const formattedTime = elapsedSec.toFixed(1);

    process.stdout.write(`\r[${filledBar}${emptyBar}] ${formattedPercent}% | ${formattedTime}s / ${durationSeconds.toFixed(1)}s`);
  }

  renderProgressBar(0, 0);

  const timer = setInterval(() => {
    currentStep++;
    const elapsedSec = (Date.now() - startTime) / 1000;

    renderProgressBar(currentStep, elapsedSec);

    if (currentStep >= totalSteps) {
      clearInterval(timer);
      process.stdout.write('\n✨ Done!\n');
      process.exit(0);
    }
  }, intervalMs);

} else {
  // --- Spinner Mode (Default) ---
  const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let frameIndex = 0;
  const intervalMs = 80;

  const timer = setInterval(() => {
    const elapsedMs = Date.now() - startTime;
    const elapsedSec = (elapsedMs / 1000).toFixed(1);
    const frame = spinnerFrames[frameIndex];
    frameIndex = (frameIndex + 1) % spinnerFrames.length;

    process.stdout.write(`\r${frame} Loading... (${elapsedSec}s / ${durationSeconds.toFixed(1)}s)`);

    if (elapsedMs >= totalDurationMs) {
      clearInterval(timer);
      process.stdout.write('\r✔ Loading complete!               \n');
      process.exit(0);
    }
  }, intervalMs);
}
