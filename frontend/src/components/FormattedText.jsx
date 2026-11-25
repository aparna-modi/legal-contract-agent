/**
 * Safe lightweight formatter for AI answers that renders bold emphasis,
 * bulleted lists, numbered lists, and paragraphs without using innerHTML.
 */

function renderInline(text) {
  const parts = String(text || "").split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, idx) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={idx}>{part.slice(2, -2)}</strong>;
    }
    return <span key={idx}>{part}</span>;
  });
}

export default function FormattedText({ text, className = "qa-answer-body" }) {
  const raw = String(text || "").trim();
  if (!raw) return null;

  const lines = raw.split(/\r?\n/);
  const blocks = [];
  let listItems = [];
  let listType = null;

  const flushList = () => {
    if (!listItems.length) return;
    blocks.push({ type: listType, items: listItems });
    listItems = [];
    listType = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushList();
      continue;
    }

    const bulletMatch = line.match(/^[-*•]\s+(.+)$/);
    const numberedMatch = line.match(/^\d+[.)]\s+(.+)$/);

    if (bulletMatch) {
      if (listType && listType !== "ul") flushList();
      listType = "ul";
      listItems.push(bulletMatch[1]);
    } else if (numberedMatch) {
      if (listType && listType !== "ol") flushList();
      listType = "ol";
      listItems.push(numberedMatch[1]);
    } else {
      flushList();
      blocks.push({ type: "p", text: line });
    }
  }
  flushList();

  return (
    <div className={className}>
      {blocks.map((block, i) => {
        if (block.type === "ul") {
          return (
            <ul key={i} className="formatted-list">
              {block.items.map((item, j) => (
                <li key={j}>{renderInline(item)}</li>
              ))}
            </ul>
          );
        }
        if (block.type === "ol") {
          return (
            <ol key={i} className="formatted-list formatted-list-ordered">
              {block.items.map((item, j) => (
                <li key={j}>{renderInline(item)}</li>
              ))}
            </ol>
          );
        }
        return <p key={i} className="formatted-para">{renderInline(block.text)}</p>;
      })}
    </div>
  );
}
