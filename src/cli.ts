const USAGE = `agent-notify — desktop notifications for coding agents

Usage:
  node cli.js dispatch --agent claude --event notification|stop

Reads the agent's hook payload as JSON on stdin.`;

function main(): void {
  const args = process.argv.slice(2);
  if (args[0] !== "dispatch") {
    process.stdout.write(USAGE + "\n");
  }
  // Real dispatch arrives in Task 8.
}

main();
