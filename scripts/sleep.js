const seconds = parseInt(process.argv[2], 10);

if (isNaN(seconds) || seconds < 0) {
  console.error('Usage: node scripts/sleep.js <seconds>');
  process.exit(1);
}

const start = Date.now();
const randomNumberInterval = setInterval(() => {
  console.log(`Random number: ${Math.random()}`);
}, 3000);

setTimeout(() => {
  clearInterval(randomNumberInterval);
  const elapsed = Math.round((Date.now() - start) / 1000);
  console.log(`You'd slept for ${elapsed} seconds`);
  process.exit(0);
}, seconds * 1000);