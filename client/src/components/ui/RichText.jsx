import React, { useState } from 'react';
import { cx, openExternal } from '../../utils';

function Spoiler({ children }) {
  const [open, setOpen] = useState(false);
  return (
    <span
      className={cx('spoiler', open && 'spoiler-open')}
      onClick={() => setOpen((v) => !v)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') setOpen((v) => !v);
      }}
    >
      {open ? children : 'Показать спойлер'}
    </span>
  );
}

const TOKEN =
  /```([\s\S]*?)```|`([^`\n]+)`|\|\|([\s\S]*?)\|\||\*\*([^*]+)\*\*|__([^_]+)__|~~([^~]+)~~|\*([^*\n]+)\*|_([^_\n]+)_|(https?:\/\/[^\s<]+)|(@[a-zA-Zа-яА-Я0-9_.@-]+)/g;

function renderText(text, keyPrefix, mentionClass) {
  return text.split('\n').map((line, index) => (
    <React.Fragment key={`${keyPrefix}-l${index}`}>
      {index > 0 ? '\n' : null}
      {line}
    </React.Fragment>
  ));
}

export default function RichText({ text, currentUsername, className = '' }) {
  if (!text) return null;
  const result = [];
  let lastIndex = 0;
  let match;
  let index = 0;
  const username = String(currentUsername || '').toLowerCase();
  TOKEN.lastIndex = 0;

  while ((match = TOKEN.exec(text)) !== null) {
    if (match.index > lastIndex) {
      result.push(
        <span key={`t${index++}`}>{renderText(text.slice(lastIndex, match.index), `t${index}`, '')}</span>
      );
    }
    const [full, codeBlock, inlineCode, spoiler, bold, underline, strike, italic, italic2, link, mention] = match;
    const key = `m${index++}`;
    if (codeBlock !== undefined) {
      result.push(
        <pre className="code-block" key={key}>
          <code>{codeBlock.trim()}</code>
        </pre>
      );
    } else if (inlineCode !== undefined) {
      result.push(
        <code className="inline-code" key={key}>
          {inlineCode}
        </code>
      );
    } else if (spoiler !== undefined) {
      result.push(<Spoiler key={key}>{spoiler}</Spoiler>);
    } else if (bold !== undefined) {
      result.push(<strong key={key}>{renderText(bold, key)}</strong>);
    } else if (underline !== undefined) {
      result.push(<u key={key}>{renderText(underline, key)}</u>);
    } else if (strike !== undefined) {
      result.push(<s key={key}>{renderText(strike, key)}</s>);
    } else if (italic !== undefined) {
      result.push(<em key={key}>{renderText(italic, key)}</em>);
    } else if (italic2 !== undefined) {
      result.push(<em key={key}>{renderText(italic2, key)}</em>);
    } else if (link !== undefined) {
      let href = link;
      let tail = '';
      while (/[.,!?;:)]$/.test(href)) {
        tail = href.slice(-1) + tail;
        href = href.slice(0, -1);
      }
      result.push(
        <a
          key={key}
          href={href}
          className="message-link"
          onClick={(event) => {
            event.preventDefault();
            openExternal(href);
          }}
        >
          {href}
        </a>
      );
      if (tail) result.push(<React.Fragment key={`${key}-tail`}>{tail}</React.Fragment>);
    } else if (mention !== undefined) {
      const lower = mention.toLowerCase();
      const isEveryone = lower === '@everyone' || lower === '@here';
      const isMe = username && (lower === `@${username}` || lower.includes(username));
      result.push(
        <span
          key={key}
          className={cx('mention', isEveryone && 'mention-everyone', isMe && 'mention-me')}
        >
          {mention}
        </span>
      );
    } else {
      result.push(<React.Fragment key={key}>{full}</React.Fragment>);
    }
    lastIndex = match.index + full.length;
  }
  if (lastIndex < text.length) {
    result.push(
      <span key={`t${index++}`}>{renderText(text.slice(lastIndex), `t${index}`, '')}</span>
    );
  }
  return <div className={cx('rich-text', className)}>{result}</div>;
}
