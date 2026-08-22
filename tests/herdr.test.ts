import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type Socket } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createHerdrChannel } from "../src/channels/herdr.js";
import { DEFAULT_CONFIG } from "../src/config.js";

const tmp = mkdtempSync(join(tmpdir(), "agent-notify-herdr-"));
test.after(() => rmSync(tmp, { recursive: true, force: true }));

const EV = {
  type: "needs_attention" as const,
  title: "Claude needs your attention",
  body: "Claude needs your permission to use Bash",
  sessionId: "s1",
  cwd: "/tmp",
};

test("no-op (false) when herdr env is absent", async () => {
  const ch = createHerdrChannel(DEFAULT_CONFIG, {});
  assert.equal(await ch.deliver(EV), false);
});

test("forwards agent-notify.event request to the socket", async () => {
  const sockPath = join(tmp, "herdr.sock");
  const received: string[] = [];
  const sockets: Socket[] = [];
  const server = createServer((sock) => {
    sockets.push(sock);
    sock.on("error", () => {}); // swallow EPIPE after client destroy
    sock.on("data", (d) => { received.push(String(d)); sock.write("{}\n"); });
  });
  server.listen(sockPath);
  await once(server, "listening");
  try {
    const ch = createHerdrChannel(DEFAULT_CONFIG, {
      HERDR_SOCKET_PATH: sockPath, HERDR_PANE_ID: "%5",
    });
    assert.equal(await ch.deliver(EV), true);

    const req = JSON.parse(received[0].trim());
    assert.equal(req.method, "agent-notify.event");
    assert.equal(req.params.pane_id, "%5");
    assert.equal(req.params.source, "agent-notify:claude");
    assert.equal(req.params.event, "needs_attention");
    assert.equal(req.params.title, "Claude needs your attention");
  } finally {
    for (const sock of sockets) sock.destroy();
    server.close();
  }
});

test("dead socket path -> false, no throw", async () => {
  const ch = createHerdrChannel(DEFAULT_CONFIG, {
    HERDR_SOCKET_PATH: join(tmp, "missing.sock"), HERDR_PANE_ID: "%5",
  });
  assert.equal(await ch.deliver(EV), false);
});
