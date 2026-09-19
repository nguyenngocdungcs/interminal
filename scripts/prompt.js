import readline from 'node:readline/promises';

async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const name = await rl.question('What is your name? ');
  const age = await rl.question('How old are you? ');

  rl.close();

  console.log(`Your name is ${name} and you are ${age} years old.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});