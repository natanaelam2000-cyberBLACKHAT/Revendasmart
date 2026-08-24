/**
 * RELEASE-QUALITY-02 §1 — multiplexador genérico e provider-agnostic de subscriptions. Não sabe nada de
 * Firestore: recebe uma função `startSource` que abre a fonte real (chamada só quando o PRIMEIRO
 * consumer pede a chave) e devolve um `unsubscribe`; o registry por `key` faz ref-count dos consumers e
 * só desliga a fonte real quando o ÚLTIMO consumer sai. Isso é o que reduz N listeners duplicados (um
 * por tela/hook) para 1 por dataset+tenant, sem introduzir uma state library nova — o resto do app
 * continua usando os hooks normais, só a fonte por baixo passa a ser compartilhada.
 */

interface SharedSubscriptionEntry<T> {
  refCount: number;
  unsubscribeSource: () => void;
  data: T | undefined;
  hasData: boolean;
  readonly listeners: Set<(data: T) => void>;
}

const registry = new Map<string, SharedSubscriptionEntry<unknown>>();

/**
 * `key` deve incluir o identificador do tenant (ex.: `users/{uid}/products`) — chaves diferentes nunca
 * compartilham dados, o que é o que garante que trocar de usuário nunca vaza cache de um tenant para
 * outro (a troca de uid naturalmente produz uma chave nova; a entrada antiga é desligada quando seu
 * último consumer se desinscreve, o que acontece no mesmo efeito que detecta a troca de usuário).
 */
export function subscribeShared<T>(
  key: string,
  startSource: (onData: (data: T) => void) => () => void,
  onUpdate: (data: T) => void,
): () => void {
  let entry = registry.get(key) as SharedSubscriptionEntry<T> | undefined;
  if (!entry) {
    // A entrada precisa existir no registry ANTES de chamar `startSource` — algumas fontes (ex.: um
    // Firestore onSnapshot que já tem cache local) chamam `onData` SINCRONAMENTE, ainda dentro da
    // própria chamada de `startSource`. Se a entrada só fosse criada depois, esse primeiro dado síncrono
    // seria perdido (o `registry.get(key)` dentro do callback ainda não encontraria nada).
    const listeners = new Set<(data: T) => void>();
    entry = { refCount: 0, unsubscribeSource: () => {}, data: undefined, hasData: false, listeners };
    registry.set(key, entry as SharedSubscriptionEntry<unknown>);
    entry.unsubscribeSource = startSource((data) => {
      const current = registry.get(key) as SharedSubscriptionEntry<T> | undefined;
      if (!current) return;
      current.data = data;
      current.hasData = true;
      current.listeners.forEach((listener) => listener(data));
    });
  }

  entry.refCount += 1;
  entry.listeners.add(onUpdate);
  if (entry.hasData) onUpdate(entry.data as T);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const current = registry.get(key) as SharedSubscriptionEntry<T> | undefined;
    if (!current) return;
    current.listeners.delete(onUpdate);
    current.refCount -= 1;
    if (current.refCount <= 0) {
      current.unsubscribeSource();
      registry.delete(key);
    }
  };
}

/** Só para testes — nunca chamado em código de produção. */
export function __resetSharedSubscriptionsForTests(): void {
  registry.clear();
}
export function __getSharedSubscriptionRefCountForTests(key: string): number {
  return registry.get(key)?.refCount ?? 0;
}
export function __hasSharedSubscriptionForTests(key: string): boolean {
  return registry.has(key);
}
