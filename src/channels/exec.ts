import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type Exec = (command: string, args: string[]) => Promise<void>;

export async function defaultExec(command: string, args: string[]): Promise<void> {
  await execFileAsync(command, args, { timeout: 1500 });
}
