// Позиция трека по снимку состояния с сервера.
//
// Сервер присылает position, updatedAt и serverNow. position — точка, в
// которой трек находился на момент updatedAt. К ней добавляется время,
// прошедшее на сервере до отправки снимка, и время после его получения.
// Для каждого нового снимка receivedAt нужно обновлять: иначе время,
// прошедшее с предыдущего снимка, посчитается дважды и позиция прыгнет.
export function targetPosition(session, receivedAt, now = Date.now()) {
  if (!session) return 0;
  const base = Math.max(0, Number(session.position) || 0);
  if (session.source?.live) return 0;
  if (!session.playing) return base;
  const updatedAt = Number(session.updatedAt) || now;
  const serverNow = Number(session.serverNow) || updatedAt;
  const serverPart = Math.max(0, serverNow - updatedAt) / 1000;
  const localPart = Math.max(0, now - receivedAt) / 1000;
  return base + serverPart + localPart;
}

// Запоминает момент получения нового снимка. Одинаковый объект состояния
// (например, при обычном перерендере) не сбрасывает отсчёт.
export function noteSessionTiming(previous, session, now = Date.now()) {
  if (previous?.session === session) return previous || { session, receivedAt: now };
  return { session, receivedAt: now };
}
