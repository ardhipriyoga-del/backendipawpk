import React from 'react';

const TRAKCARE_ANLT_URL =
  'https://apps.emc.id/trakcare/dokumen/print/dokumen/trakcareANLT?episode=';

export function getTrakCareEpisodeUrl(episode: string | null | undefined): string | null {
  const value = episode?.trim();
  if (!value || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) return null;
  return `${TRAKCARE_ANLT_URL}${encodeURIComponent(value)}`;
}

export function EpisodeLink({
  episode,
  className = '',
}: {
  episode: string | null | undefined;
  className?: string;
}) {
  const value = episode?.trim();
  const href = getTrakCareEpisodeUrl(value);
  if (!value || !href) {
    return <span className={className}>{value || '—'}</span>;
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`text-blue-600 hover:text-blue-800 hover:underline cursor-pointer ${className}`}
      title="Buka Episode di TrakCare ANLT"
    >
      {value}
    </a>
  );
}