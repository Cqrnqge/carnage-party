import React, { useState } from 'react';
import { assetUrl } from '../../api';
import { STATUS_META } from '../../constants';
import { cx, gradientStyle, initials } from '../../utils';
import logoEmblem from '../../assets/logo-emblem.png';

export default function Avatar({
  user,
  size = 40,
  status = null,
  showStatus = false,
  className = '',
  square = false,
  onClick,
  style: extraStyle,
}) {
  const [failed, setFailed] = useState(false);
  const src = user?.avatar ? assetUrl(user.avatar) : null;
  const meta = STATUS_META[status] || null;
  const style = {
    width: size,
    height: size,
    borderRadius: square ? Math.max(8, size * 0.3) : '50%',
    fontSize: Math.max(10, size * 0.34),
  };
  return (
    <div
      className={cx('avatar', square && 'avatar-square', className)}
      style={{
        ...style,
        ...(src && !failed ? {} : gradientStyle(user)),
        ...extraStyle,
      }}
      onClick={onClick}
      title={user?.displayName || user?.username || ''}
    >
      {src && !failed ? (
        <img src={src} alt="" draggable={false} onError={() => setFailed(true)} />
      ) : (
        <span>{initials(user?.displayName || user?.username || '?')}</span>
      )}
      {showStatus && meta ? (
        <span
          className="status-dot"
          style={{ background: meta.color, width: Math.max(10, size * 0.3), height: Math.max(10, size * 0.3) }}
          title={meta.label}
        />
      ) : null}
    </div>
  );
}

export function ServerIcon({ server, size = 48, className = '' }) {
  const [failed, setFailed] = useState(false);
  const icon = server?.icon ? assetUrl(server.icon) : null;
  return (
    <div
      className={cx('avatar avatar-square server-icon', className)}
      style={{ width: size, height: size, borderRadius: Math.max(12, size * 0.3), ...gradientStyle({ accentColor: server?.accentColor, username: server?.name }) }}
    >
      {icon && !failed ? (
        <img src={icon} alt="" draggable={false} onError={() => setFailed(true)} />
      ) : (
        <span>{initials(server?.name || 'S')}</span>
      )}
    </div>
  );
}

export function BrandMark({ size = 46, className = '' }) {
  return (
    <div className={cx('brand-mark', className)} style={{ width: size, height: size }}>
      <img src={logoEmblem} alt="" draggable={false} />
    </div>
  );
}

export { Avatar };

export function ChannelIcon({ type, size = 20, className = '' }) {
  return type === 'voice' ? (
    <span className={cx('channel-symbol', className)} style={{ fontSize: size }}>
      <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M11 5 6 9H2v6h4l5 4V5z" />
        <path d="M15.5 8.5a5 5 0 0 1 0 7" />
        <path d="M18.5 5.5a9 9 0 0 1 0 13" />
      </svg>
    </span>
  ) : (
    <span className={cx('channel-symbol', className)} style={{ fontSize: size }}>
      <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18" />
      </svg>
    </span>
  );
}
