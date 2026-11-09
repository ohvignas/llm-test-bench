// Only document content belongs in the executable preview. CLI providers also
// emit progress prose, and models sometimes wrap the answer in Markdown.
export function extractHtmlDocument(value) {
  let text = String(value || '').trim();
  // Strip reasoning wrappers only before the document, never inside its code.
  while (/^<(think|thinking|analysis|reasoning)\b/i.test(text)) {
    const tag = text.match(/^<([a-z]+)\b/i)[1];
    const close = new RegExp(`</${tag}\\s*>`, 'i').exec(text);
    if (!close) return '';
    text = text.slice(close.index + close[0].length).trimStart();
  }
  const start = /(?:^|\n)[ \t]*(?=<!doctype\s+html\b|<html(?:\s|>))/i.exec(text);
  if (!start) return '';
  text = text.slice(start.index).trimStart();
  // The last closing tag retains literal HTML examples inside script strings.
  const endings = [...text.matchAll(/<\/html\s*>/gi)];
  const end = endings.at(-1);
  return end ? text.slice(0, end.index + end[0].length) : text;
}

/** Accumulated provider output → HTML-only progress and a validated result. */
export async function streamHtmlDocument(stream, { onChunk, ...options }) {
  let accumulated = '';
  try {
    const result = await stream({
      ...options,
      onChunk: text => {
        accumulated = text || '';
        onChunk?.(extractHtmlDocument(accumulated));
      },
    });
    const document = requireHtmlDocument(typeof result === 'string' ? result : accumulated);
    onChunk?.(document);
    return document;
  } catch (error) {
    onChunk?.('');
    throw error;
  }
}

// Also used inside the spending guard, so invalid HTML blocks an identical retry.
export function requireHtmlDocument(value) {
  const document=extractHtmlDocument(value);
  if(!document || !/<html(?:\s|>)/i.test(document) || !/<\/html\s*>\s*$/i.test(document)) {
    throw Object.assign(new Error('Le modèle n’a pas renvoyé de document HTML complet. Aucun nouvel appel automatique ; vérifiez le budget avant de relancer.'),{code:'INCOMPLETE_HTML',retryable:false});
  }
  return document;
}
