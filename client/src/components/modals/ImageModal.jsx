import React from 'react';
import { Download, ExternalLink, X } from 'lucide-react';
import { assetUrl } from '../../api';
import { useApp } from '../../store';
import { openExternal } from '../../utils';

export default function ImageModal({ url, name }) {
  const closeModal = useApp((state) => state.closeModal);
  const src = assetUrl(url);
  return (
    <div className="image-modal" onClick={closeModal}>
      <div className="image-modal-toolbar" onClick={(event) => event.stopPropagation()}>
        <span>{name || 'Изображение'}</span>
        <div>
          <a className="icon-btn" href={src} download={name || 'image'} title="Скачать">
            <Download size={19} />
          </a>
          <button className="icon-btn" onClick={() => openExternal(src)} title="Открыть в браузере">
            <ExternalLink size={19} />
          </button>
          <button className="icon-btn" onClick={closeModal} title="Закрыть">
            <X size={22} />
          </button>
        </div>
      </div>
      <img
        src={src}
        alt={name || ''}
        onClick={(event) => event.stopPropagation()}
        draggable={false}
      />
    </div>
  );
}
