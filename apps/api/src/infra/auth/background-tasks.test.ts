import { describe, expect, it } from "vitest";
import {
  BACKGROUND_MAX_PENDING,
  BACKGROUND_MAX_RUNNING,
  createBackgroundTasks,
} from "./background-tasks";

const quiet = { onError: () => undefined, onDrop: () => undefined };

/** Tarefa que só termina quando o teste mandar. */
function gate() {
  let open: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, wait: () => opened };
}

describe("createBackgroundTasks", () => {
  it("run não espera a tarefa; drain espera todas, inclusive as criadas por outra tarefa", async () => {
    const tasks = createBackgroundTasks(quiet);
    const done: string[] = [];
    tasks.run(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      done.push("a");
      tasks.run(async () => {
        done.push("b");
      });
    });
    expect(done).toEqual([]);
    await tasks.drain();
    expect(done).toEqual(["a", "b"]);
  });

  it("erro da tarefa vai para onError e não derruba o drain", async () => {
    const errors: unknown[] = [];
    const tasks = createBackgroundTasks({ ...quiet, onError: (error) => errors.push(error) });
    tasks.run(async () => {
      throw new TypeError("falhou");
    });
    await tasks.drain();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(TypeError);
  });

  it("os limites são constantes únicas: poucas rodando e um teto de pendentes", () => {
    expect(BACKGROUND_MAX_RUNNING).toBe(4);
    expect(BACKGROUND_MAX_PENDING).toBe(100);
  });

  it("no máximo maxRunning ao mesmo tempo; acima de maxPending a tarefa é descartada e o resto segue", async () => {
    const drops: number[] = [];
    const tasks = createBackgroundTasks({
      onError: () => undefined,
      onDrop: (pending) => drops.push(pending),
      maxRunning: 2,
      maxPending: 3,
    });
    const g = gate();
    let running = 0;
    let peak = 0;
    const ran: number[] = [];
    for (let i = 0; i < 5; i++) {
      tasks.run(async () => {
        running += 1;
        peak = Math.max(peak, running);
        await g.wait();
        ran.push(i);
        running -= 1;
      });
    }
    // 2 rodando + 1 na fila = 3 pendentes; o 4º e o 5º são descartados.
    expect(drops).toEqual([3, 3]);
    g.open();
    await tasks.drain();
    expect(ran.sort()).toEqual([0, 1, 2]);
    expect(peak).toBe(2);

    // Com a fila livre de novo, tarefas novas voltam a rodar.
    let after = false;
    tasks.run(async () => {
      after = true;
    });
    await tasks.drain();
    expect(after).toBe(true);
  });
});
