/**
 * Quantas tarefas rodam ao mesmo tempo. Cada envio de código abre consultas e uma trava no pool
 * do `app_auth`; poucas por vez deixam conexões livres para o login.
 */
export const BACKGROUND_MAX_RUNNING = 4;
/** Teto de tarefas pendentes (rodando + na fila). Acima dele a tarefa é descartada. */
export const BACKGROUND_MAX_PENDING = 100;

/** Trabalho que roda fora da requisição (ex.: envio do código), sem segurar a resposta. */
export interface BackgroundTasks {
  run(task: () => Promise<void>): void;
  /** Espera tudo o que está em andamento e na fila. Usado nos testes e no desligamento. */
  drain(): Promise<void>;
}

export interface BackgroundTasksOptions {
  /**
   * Erro de uma tarefa. Quem compõe decide o que logar: só o tipo do erro, nunca a mensagem,
   * que pode trazer e-mail ou parâmetros de SQL (regra 9).
   */
  onError(error: unknown): void;
  /** Tarefa descartada por excesso; recebe só a contagem de pendentes (sem dado da tarefa). */
  onDrop(pending: number): void;
  maxRunning?: number;
  maxPending?: number;
}

/**
 * Fila em memória com concorrência e tamanho limitados: pedidos em massa não abrem consultas
 * sem teto. Descartar um envio de código é seguro: quem pediu pede de novo (RF02.R4).
 */
export function createBackgroundTasks(options: BackgroundTasksOptions): BackgroundTasks {
  const maxRunning = options.maxRunning ?? BACKGROUND_MAX_RUNNING;
  const maxPending = options.maxPending ?? BACKGROUND_MAX_PENDING;
  const queue: (() => Promise<void>)[] = [];
  let running = 0;
  let idle: Promise<void> = Promise.resolve();
  let markIdle: () => void = () => undefined;

  function next(): void {
    while (running < maxRunning && queue.length > 0) {
      const task = queue.shift() as () => Promise<void>;
      running += 1;
      Promise.resolve()
        .then(task)
        .catch((error) => options.onError(error))
        .finally(() => {
          running -= 1;
          next();
          if (running === 0 && queue.length === 0) markIdle();
        });
    }
  }

  return {
    run(task) {
      const pending = running + queue.length;
      if (pending >= maxPending) {
        options.onDrop(pending);
        return;
      }
      if (pending === 0) {
        idle = new Promise((resolve) => {
          markIdle = resolve;
        });
      }
      queue.push(task);
      next();
    },
    async drain() {
      while (running + queue.length > 0) await idle;
    },
  };
}
