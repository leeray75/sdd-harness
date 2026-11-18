import type { MouseEvent, ReactNode } from 'react';
import './Chip.css';

/** neutral: plain info. accent: user and environment. amber, green and red: status. */
export type ChipTone = 'neutral' | 'accent' | 'amber' | 'green' | 'red';

export interface ChipProps {
  tone?: ChipTone;
  children: ReactNode;
  /** With onClick the chip renders a real button (type="button"); without it, a span. */
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
}

export function Chip({ tone = 'neutral', children, onClick }: ChipProps) {
  if (onClick) {
    return (
      <button type="button" className={`chip chip--${tone} chip--button`} onClick={onClick}>
        {children}
      </button>
    );
  }
  return <span className={`chip chip--${tone}`}>{children}</span>;
}
